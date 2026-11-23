"""Emparejamiento de solo lectura de las especies del catálogo con los taxones de iNaturalist.

Entradas (una o varias, ver ``read_catalog``):

- La exportación de COL (``export.zip`` o su TSV), que se lee y normaliza como en
  ``orki-catalogo`` (las mismas funciones).
- La salida normalizada de ``orki-catalogo ARCHIVO --salida catalogo.json``.
- La lista curada de híbridos (``data/hibridos.csv``), con la validación de siempre.
- Una exportación del catálogo de la base como CSV, con la cabecera :data:`EXPORT_HEADER`.

Los nombres se comparan con :func:`catalog_import.names.match_key` sobre
:func:`catalog_import.names.normalize_name`, como casa la carga los géneros y la lista curada:
sin mayúsculas, con los espacios limpios y sin el signo «×».

No se descarga ninguna imagen ni se escribe en ninguna base: el resultado es un reporte CSV y
un resumen.
"""

from __future__ import annotations

import csv
import io
import json
from collections import Counter, defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any

from .hybrids import HEADER as HYBRIDS_HEADER
from .hybrids import read_hybrids
from .inaturalist import Photo, Taxon
from .names import match_key, name_shape, normalize_name, strip_hybrid_sign

# Exportación del catálogo de la base, un CSV UTF-8 (con o sin BOM) separado por comas.
# ``sinonimos`` va separado por «|»; ``plantas`` (cuántas plantas de usuarios tiene la especie)
# puede ir vacío.
EXPORT_HEADER = ('id', 'nombre', 'genero', 'tipo', 'sinonimos', 'plantas')
LIST_SEPARATOR = '|'
# Alcance inicial (#180): los géneros más comunes en cultivo.
COMMON_GENERA = (
    'Phalaenopsis',
    'Cattleya',
    'Dendrobium',
    'Oncidium',
    'Vanda',
    'Cymbidium',
    'Paphiopedilum',
    'Masdevallia',
)


class CatalogFormatError(Exception):
    """El archivo del catálogo no tiene un formato reconocido."""


class Match(StrEnum):
    ACCEPTED = 'nombre_aceptado'
    SYNONYM = 'sinonimo'
    AMBIGUOUS = 'ambiguo'
    NO_TAXON = 'sin_taxon'
    # Filas de taxones de iNaturalist que ninguna especie del catálogo tomó.
    NO_SPECIES = 'sin_especie'


class DefaultPhoto(StrEnum):
    ACCEPTED = 'aceptada'
    NOT_ACCEPTED = 'no_aceptada'
    NONE = 'sin_foto'


class Chosen(StrEnum):
    DEFAULT = 'por_defecto'
    TAXON = 'del_taxon'
    OBSERVATION = 'de_observacion'
    NONE = 'ninguna'
    # No se llegó a buscar una alternativa (tope de peticiones o --alternativas ninguna).
    NOT_SEARCHED = 'no_buscada'


@dataclass(frozen=True, slots=True)
class CatalogEntry:
    """Una especie (o híbrido) del catálogo, lo justo para emparejarla."""

    ref: str
    name: str
    genus: str
    type: str
    synonyms: tuple[str, ...]
    # Plantas de usuarios con esta especie (solo en la exportación de la base).
    plants: int | None
    source: str

    @property
    def genus_key(self) -> str:
        return match_key(self.genus or name_shape(self.name).genus)


# Lectura del catálogo -----------------------------------------------------------------------


def read_catalog(path: Path) -> list[CatalogEntry]:
    """Lee un archivo del catálogo según su tipo (ver el docstring del módulo)."""
    suffix = path.suffix.lower()
    if suffix in ('.zip', '.tsv'):
        from .cli import run

        catalog, _summary = run(path)
        return [
            _entry(
                sp.source_ref,
                sp.scientific_name,
                sp.genus,
                sp.type,
                [s.name for s in sp.synonyms],
                None,
                'col',
            )
            for sp in catalog.species
        ]
    if suffix == '.json':
        document = json.loads(path.read_text(encoding='utf-8'))
        try:
            return [
                _entry(
                    sp['source_ref'],
                    sp['scientific_name'],
                    sp['genus'],
                    sp['type'],
                    [s['name'] for s in sp.get('synonyms', [])],
                    None,
                    'col',
                )
                for sp in document['species']
            ]
        except (KeyError, TypeError) as error:
            raise CatalogFormatError(
                f'{path.name} no es la salida de «orki-catalogo --salida».'
            ) from error
    if suffix == '.csv':
        text = path.read_text(encoding='utf-8-sig')
        header = tuple(next(csv.reader(io.StringIO(text)), []))
        if header == HYBRIDS_HEADER:
            return _read_hybrids(path)
        if header == EXPORT_HEADER:
            return _read_export(path, text)
        raise CatalogFormatError(
            f'{path.name}: cabecera no reconocida. Se esperaba la de la lista curada '
            f'({",".join(HYBRIDS_HEADER)}) o la de la exportación ({",".join(EXPORT_HEADER)}).'
        )
    raise CatalogFormatError(f'{path.name}: tipo de archivo no reconocido (zip, tsv, json, csv).')


def _entry(
    ref: str,
    name: str,
    genus: str,
    kind: str,
    synonyms: Iterable[str],
    plants: int | None,
    source: str,
) -> CatalogEntry:
    accepted = normalize_name(name)
    seen = {match_key(accepted)}
    clean: list[str] = []
    for synonym in synonyms:
        normalized = normalize_name(synonym)
        key = match_key(normalized)
        if normalized and key not in seen:
            seen.add(key)
            clean.append(normalized)
    return CatalogEntry(
        ref=ref,
        name=accepted,
        genus=normalize_name(genus),
        type=kind,
        synonyms=tuple(clean),
        plants=plants,
        source=source,
    )


def _read_hybrids(path: Path) -> list[CatalogEntry]:
    hybrids = read_hybrids(path)
    if not hybrids.valid:
        problems = '; '.join(str(p) for p in hybrids.problems[:5])
        raise CatalogFormatError(f'{path.name} no pasa la validación: {problems}')
    return [
        _entry(e.ref, e.name, e.genus, 'hybrid', e.other_names, None, 'curated')
        for e in hybrids.entries
    ]


def _read_export(path: Path, text: str) -> list[CatalogEntry]:
    entries = []
    reader = csv.reader(io.StringIO(text))
    next(reader)
    for row_number, row in enumerate(reader, start=2):
        if not any(cell.strip() for cell in row):
            continue
        if len(row) != len(EXPORT_HEADER):
            raise CatalogFormatError(
                f'{path.name}, fila {row_number}: {len(row)} columnas en vez de '
                f'{len(EXPORT_HEADER)}.'
            )
        ref, name, genus, kind, synonyms, plants = (cell.strip() for cell in row)
        if not ref or not name:
            raise CatalogFormatError(f'{path.name}, fila {row_number}: falta id o nombre.')
        try:
            count = int(plants) if plants else None
        except ValueError:
            raise CatalogFormatError(
                f'{path.name}, fila {row_number}: «plantas» no es un número.'
            ) from None
        names = [s.strip() for s in synonyms.split(LIST_SEPARATOR) if s.strip()]
        entries.append(_entry(ref, name, genus, kind or 'species', names, count, 'base'))
    return entries


# Emparejamiento -----------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class MatchResult:
    entry: CatalogEntry
    match: Match
    taxon: Taxon | None = None
    # El nombre (del catálogo o de iNaturalist) por el que se emparejó.
    via: str = ''
    detail: str = ''


@dataclass(slots=True)
class TaxonIndex:
    """Índice de los taxones leídos de iNaturalist por clave de nombre."""

    active: dict[int, Taxon] = field(default_factory=dict)
    by_name: dict[str, list[Taxon]] = field(default_factory=lambda: defaultdict(list))
    # Clave de un sinónimo de iNaturalist → (taxón activo, nombre original del sinónimo).
    by_synonym: dict[str, dict[int, str]] = field(default_factory=lambda: defaultdict(dict))

    @classmethod
    def build(cls, taxa: Iterable[Taxon]) -> TaxonIndex:
        index = cls()
        inactive: list[Taxon] = []
        for taxon in taxa:
            if taxon.is_active:
                if taxon.id in index.active:
                    continue
                index.active[taxon.id] = taxon
                index.by_name[_key(taxon.name)].append(taxon)
            else:
                inactive.append(taxon)
        for taxon in index.active.values():
            for synonym in taxon.synonyms:
                index.by_synonym[_key(synonym)].setdefault(taxon.id, synonym)
        # Un taxón inactivo es un nombre antiguo: apunta a los activos que lo sustituyen. Solo
        # cuentan los que se han leído (los que se fueron a un género fuera del alcance, no).
        for taxon in inactive:
            for current in taxon.current_ids:
                if current in index.active:
                    index.by_synonym[_key(taxon.name)].setdefault(current, taxon.name)
        return index


def _key(name: str) -> str:
    return match_key(normalize_name(name))


def in_scope(
    entry: CatalogEntry, genus_keys: frozenset[str] | None, index: TaxonIndex | None = None
) -> bool:
    """Si la especie cae en lo leído de iNaturalist: su género o el de alguno de sus sinónimos
    es uno de los leídos, o alguno de sus nombres está en el índice (como nombre o sinónimo de
    un taxón leído: «Doritis pulcherrima» entra al leer Phalaenopsis). ``None`` es toda la
    familia."""
    if genus_keys is None:
        return True
    names = (entry.name, *entry.synonyms)
    if entry.genus_key in genus_keys or any(
        match_key(name_shape(n).genus) in genus_keys for n in names
    ):
        return True
    if index is None:
        return False
    return any(_key(n) in index.by_name or _key(n) in index.by_synonym for n in names)


def match_catalog(entries: Sequence[CatalogEntry], index: TaxonIndex) -> list[MatchResult]:
    """Empareja cada especie con un taxón activo de iNaturalist.

    1. Por el nombre aceptado: un único taxón activo con ese nombre es ``nombre_aceptado``;
       varios, ``ambiguo``.
    2. Si no, por sinónimo: un sinónimo del catálogo que es el nombre de un taxón activo, o el
       nombre aceptado del catálogo que iNaturalist tiene como sinónimo (o como taxón inactivo
       sustituido por uno activo). No cuentan los taxones que ya emparejó otra especie por su
       nombre aceptado (allí las dos taxonomías separan lo que la otra une). Un solo taxón
       posible es ``sinonimo``; varios, ``ambiguo``.
    3. Un mismo taxón al que llegan varias especies por sinónimo deja a todas en ``ambiguo``.
    4. Si no hay nada, ``sin_taxon``.
    """
    results: list[MatchResult | None] = [None] * len(entries)
    claimed: dict[int, str] = {}
    for i, entry in enumerate(entries):
        hits = index.by_name.get(_key(entry.name), [])
        if len(hits) == 1:
            results[i] = MatchResult(entry, Match.ACCEPTED, hits[0], hits[0].name)
            claimed.setdefault(hits[0].id, entry.name)
        elif hits:
            ids = ', '.join(f'{t.name} ({t.id})' for t in hits)
            results[i] = MatchResult(
                entry, Match.AMBIGUOUS, detail=f'Varios taxones con ese nombre: {ids}.'
            )
    by_synonym: dict[int, list[int]] = defaultdict(list)
    for i, entry in enumerate(entries):
        if results[i] is not None:
            continue
        candidates: dict[int, str] = {}
        for synonym in entry.synonyms:
            for taxon in index.by_name.get(_key(synonym), []):
                candidates.setdefault(taxon.id, synonym)
        for taxon_id, name in index.by_synonym.get(_key(entry.name), {}).items():
            candidates.setdefault(taxon_id, name)
        if not candidates:
            results[i] = MatchResult(entry, Match.NO_TAXON)
            continue
        free = {t: n for t, n in candidates.items() if t not in claimed}
        if len(free) == 1:
            ((taxon_id, via),) = free.items()
            results[i] = MatchResult(entry, Match.SYNONYM, index.active[taxon_id], via)
            by_synonym[taxon_id].append(i)
        elif not free:
            taken = '; '.join(
                f'{index.active[t].name} ({t}) ya es de {claimed[t]}' for t in sorted(candidates)
            )
            results[i] = MatchResult(entry, Match.AMBIGUOUS, detail=f'Por sinónimo: {taken}.')
        else:
            ids = ', '.join(f'{index.active[t].name} ({t})' for t in sorted(free))
            results[i] = MatchResult(
                entry, Match.AMBIGUOUS, detail=f'Varios taxones por sinónimo: {ids}.'
            )
    for taxon_id, positions in by_synonym.items():
        if len(positions) < 2:
            continue
        others = ', '.join(entries[p].name for p in positions)
        for p in positions:
            results[p] = MatchResult(
                entries[p],
                Match.AMBIGUOUS,
                detail=f'Varias especies llegan por sinónimo a {index.active[taxon_id].name} '
                f'({taxon_id}): {others}.',
            )
    return [r for r in results if r is not None]


# Fotos --------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class PhotoChoice:
    default: DefaultPhoto
    chosen: Chosen
    photo: Photo | None = None


def default_status(taxon: Taxon) -> DefaultPhoto:
    if taxon.default_photo is None:
        return DefaultPhoto.NONE
    return DefaultPhoto.ACCEPTED if taxon.default_photo.accepted else DefaultPhoto.NOT_ACCEPTED


class Alternatives(StrEnum):
    """Dónde se busca otra foto si la por defecto no vale."""

    NONE = 'ninguna'
    TAXON = 'taxon'
    OBSERVATIONS = 'observaciones'


def needs_alternative(taxon: Taxon) -> bool:
    photo = taxon.default_photo
    return photo is None or not photo.accepted or photo.flagged


def choose_photo(
    taxon: Taxon,
    mode: Alternatives,
    taxon_photos: dict[int, list[Photo]],
    observation_photos: dict[int, Photo | None],
) -> PhotoChoice:
    """La foto que se usaría: la por defecto si su licencia es aceptada (y no tiene marcas);
    si no, la primera de las fotos del taxón con licencia aceptada; si no, la de una
    observación con grado de investigación.

    ``taxon_photos`` y ``observation_photos`` tienen solo los taxones en los que se llegó a
    buscar: los demás quedan como ``no_buscada``.
    """
    status = default_status(taxon)
    if not needs_alternative(taxon):
        return PhotoChoice(status, Chosen.DEFAULT, taxon.default_photo)
    if mode is Alternatives.NONE or taxon.id not in taxon_photos:
        return PhotoChoice(status, Chosen.NOT_SEARCHED)
    for photo in taxon_photos[taxon.id]:
        if photo.accepted and not photo.flagged:
            return PhotoChoice(status, Chosen.TAXON, photo)
    if mode is Alternatives.TAXON or taxon.observations_count == 0:
        return PhotoChoice(status, Chosen.NONE)
    if taxon.id not in observation_photos:
        return PhotoChoice(status, Chosen.NOT_SEARCHED)
    photo = observation_photos[taxon.id]
    return PhotoChoice(status, Chosen.OBSERVATION if photo else Chosen.NONE, photo)


LICENSE_LABELS = {
    'cc0': 'CC0',
    'cc-by': 'CC BY',
    'cc-by-nc': 'CC BY-NC',
    'cc-by-sa': 'CC BY-SA',
    'cc-by-nd': 'CC BY-ND',
    'cc-by-nc-sa': 'CC BY-NC-SA',
    'cc-by-nc-nd': 'CC BY-NC-ND',
    # Marca de dominio público: no está entre las aceptadas (solo CC0 y CC BY).
    'pd': 'dominio público (PD)',
}


def license_label(code: str | None) -> str:
    if code is None:
        return 'todos los derechos reservados'
    return LICENSE_LABELS.get(code, code)


def attribution(photo: Photo) -> str:
    """Texto de atribución propuesto (ver docs/inaturalist.md): autor, licencia y origen.

    Con CC0 no hace falta, pero se da igual. Si no se conoce el autor, el de iNaturalist.
    """
    author = photo.author or photo.attribution or 'autor desconocido'
    if photo.license == 'cc0':
        return f'Foto: {author}, sin derechos reservados (CC0), vía iNaturalist'
    return f'Foto: © {author}, {license_label(photo.license)}, vía iNaturalist'


# Reporte ------------------------------------------------------------------------------------

REPORT_HEADER = (
    'entidad',
    'emparejamiento',
    'ref',
    'nombre',
    'genero',
    'tipo',
    'plantas',
    'fuente',
    'nombre_emparejado',
    'inat_id',
    'inat_nombre',
    'inat_rango',
    'foto_por_defecto',
    'licencia_por_defecto',
    'foto_elegida',
    'foto_id',
    'licencia',
    'autor',
    'atribucion',
    'foto_url_medium',
    'foto_pagina',
    'observacion',
    'detalle',
)


@dataclass(frozen=True, slots=True)
class Row:
    entity: str
    match: Match
    entry: CatalogEntry | None
    taxon: Taxon | None
    via: str
    choice: PhotoChoice | None
    detail: str

    def cells(self) -> tuple[str, ...]:
        e, t, c = self.entry, self.taxon, self.choice
        photo = c.photo if c else None
        default = t.default_photo if t else None
        genus = e.genus if e else (strip_hybrid_sign(name_shape(t.name).genus) if t else '')
        return (
            self.entity,
            self.match.value,
            e.ref if e else '',
            e.name if e else (t.name if t else ''),
            genus,
            e.type if e else (t.rank if t else ''),
            '' if e is None or e.plants is None else str(e.plants),
            e.source if e else 'inaturalist',
            self.via,
            str(t.id) if t else '',
            t.name if t else '',
            t.rank if t else '',
            c.default.value if c else '',
            license_label(default.license) if default else '',
            c.chosen.value if c else '',
            str(photo.id) if photo else '',
            license_label(photo.license) if photo else '',
            (photo.author or '') if photo else '',
            attribution(photo) if photo else '',
            photo.url('medium') if photo else '',
            photo.page_url if photo else '',
            f'https://www.inaturalist.org/observations/{photo.observation_id}'
            if photo and photo.observation_id
            else '',
            self.detail,
        )


def write_report(path: Path, rows: Iterable[Row]) -> int:
    count = 0
    with path.open('w', encoding='utf-8-sig', newline='') as handle:
        writer = csv.writer(handle)
        writer.writerow(REPORT_HEADER)
        for row in rows:
            writer.writerow(row.cells())
            count += 1
    return count


# Resumen ------------------------------------------------------------------------------------


@dataclass(slots=True)
class Tally:
    """Recuentos de un grupo de especies del catálogo o de taxones de iNaturalist."""

    total: int = 0
    match: Counter[str] = field(default_factory=Counter)
    default: Counter[str] = field(default_factory=Counter)
    chosen: Counter[str] = field(default_factory=Counter)

    def add(self, row: Row) -> None:
        self.total += 1
        self.match[row.match.value] += 1
        if row.choice:
            self.default[row.choice.default.value] += 1
            self.chosen[row.choice.chosen.value] += 1

    @property
    def with_photo(self) -> int:
        return sum(self.chosen[c] for c in (Chosen.DEFAULT, Chosen.TAXON, Chosen.OBSERVATION))

    def to_dict(self) -> dict[str, Any]:
        return {
            'total': self.total,
            'emparejamiento': dict(sorted(self.match.items())),
            'foto_por_defecto': dict(sorted(self.default.items())),
            'foto_elegida': dict(sorted(self.chosen.items())),
            'con_foto_usable': self.with_photo,
        }


def percent(part: int, whole: int) -> str:
    return f'{100 * part / whole:.1f} %'.replace('.', ',') if whole else '—'


def summarize(
    species_rows: Sequence[Row], taxon_rows: Sequence[Row], genera: Sequence[str]
) -> dict[str, Any]:
    catalog = Tally()
    collections = Tally()
    by_genus_catalog: dict[str, Tally] = {g: Tally() for g in genera}
    by_genus_inat: dict[str, Tally] = {g: Tally() for g in genera}
    keys = {match_key(g): g for g in genera}
    for row in species_rows:
        catalog.add(row)
        if row.entry and row.entry.plants:
            collections.add(row)
        if row.entry and (genus := keys.get(row.entry.genus_key)):
            by_genus_catalog[genus].add(row)
    inat = Tally()
    for row in taxon_rows:
        inat.add(row)
        if row.taxon and (genus := keys.get(match_key(name_shape(row.taxon.name).genus))):
            by_genus_inat[genus].add(row)
    return {
        'catalogo': catalog.to_dict(),
        'en_colecciones': collections.to_dict(),
        'inaturalist': inat.to_dict(),
        'por_genero': {
            g: {
                'catalogo': by_genus_catalog[g].to_dict(),
                'inaturalist': by_genus_inat[g].to_dict(),
            }
            for g in genera
        },
    }


def format_summary(summary: dict[str, Any]) -> str:
    lines: list[str] = []

    def block(title: str, data: dict[str, Any], *, taxa: bool = False) -> None:
        total = data['total']
        lines.append(f'{title}: {total}')
        if not total:
            return
        if not taxa:
            for kind in (Match.ACCEPTED, Match.SYNONYM, Match.AMBIGUOUS, Match.NO_TAXON):
                count = data['emparejamiento'].get(kind.value, 0)
                lines.append(f'  {kind.value}: {count} ({percent(count, total)})')
        matched = sum(data['foto_por_defecto'].values())
        lines.append(f'  con taxón de iNaturalist: {matched}')
        for status in DefaultPhoto:
            count = data['foto_por_defecto'].get(status.value, 0)
            lines.append(
                f'    foto por defecto {status.value}: {count} ({percent(count, matched)})'
            )
        for chosen in Chosen:
            count = data['foto_elegida'].get(chosen.value, 0)
            if count:
                lines.append(f'    foto elegida {chosen.value}: {count}')
        usable = data['con_foto_usable']
        lines.append(f'  con foto de licencia aceptada: {usable} ({percent(usable, total)})')

    block('Especies del catálogo en el alcance', summary['catalogo'])
    if summary['en_colecciones']['total']:
        block('  de ellas, en alguna colección', summary['en_colecciones'])
    block('Taxones activos de iNaturalist leídos', summary['inaturalist'], taxa=True)
    lines.append('')
    lines.append('Alcance inicial, por género (catálogo | iNaturalist):')
    for genus, data in summary['por_genero'].items():
        cat, inat = data['catalogo'], data['inaturalist']
        lines.append(
            f'  {genus}: catálogo {cat["total"]}, emparejadas '
            f'{cat["emparejamiento"].get("nombre_aceptado", 0)}+'
            f'{cat["emparejamiento"].get("sinonimo", 0)}, con foto {cat["con_foto_usable"]} | '
            f'iNaturalist {inat["total"]} taxones, por defecto aceptada '
            f'{inat["foto_por_defecto"].get("aceptada", 0)}, no aceptada '
            f'{inat["foto_por_defecto"].get("no_aceptada", 0)}, sin foto '
            f'{inat["foto_por_defecto"].get("sin_foto", 0)}, con foto usable '
            f'{inat["con_foto_usable"]} ({percent(inat["con_foto_usable"], inat["total"])})'
        )
    return '\n'.join(lines)
