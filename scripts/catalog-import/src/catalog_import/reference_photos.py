"""Fotos de referencia de las especies: lectura de la base, elección, plan y escritura.

Cumple el contrato de ``supabase/README.md`` («Fotos de referencia», «Contrato de la carga»):

1. Lee de la base, con la conexión directa de las demás cargas, las especies (con sus
   sinónimos y cuántas plantas tienen), las fotos actuales y **todas** las retiradas
   (:func:`read_state`). Sin ``species_photos`` se niega a seguir (:func:`check_schema`).
2. Elige, por especie, la primera foto **utilizable** entre la foto por defecto del taxón de
   iNaturalist emparejado, las demás fotos del taxón y, si se pide, la de una observación
   (:func:`decide`): licencia ``cc0``, ``pd``, ``cc-by`` o ``cc-by-sa``, sin marcas, con autor,
   descargable del bucket abierto, no retirada para esa especie y no retirada a petición de su
   autor en ninguna especie. Si la especie ya tiene una foto y sigue siendo utilizable, la
   conserva (no cambia de foto sin motivo).
3. Las imágenes se descargan, se convierten y se suben antes (en
   :mod:`catalog_import.reference_photos_cli`).
4. Las filas se escriben en **una transacción** (:func:`write_rows`): se bloquean
   ``species_photos`` y ``species_photo_rejections``, se vuelve a leer lo actual y se replanifica
   (:func:`plan_rows`: una retirada o un cambio que llegó mientras se descargaba gana), se deja la
   fila de resumen en la auditoría (``catalog_import`` con ``load_type = fotos_referencia``) y se
   aplican ``insert … on conflict (species_id) do update``, las actualizaciones de metadatos y las
   bajas. Sin ``--escribir``, la transacción se revierte.

Nada de esto descarga ni sube nada: es lectura de la base, decisiones puras y la escritura.
"""

from __future__ import annotations

import csv
import json
import re
from collections import Counter, defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Any

import psycopg

from .audit import ACTION, LoadAudit, audit_ready, missing_audit_message
from .inaturalist import ACCEPTED_LICENSES, Photo, Taxon
from .inaturalist_match import (
    COMMON_GENERA,
    CatalogEntry,
    Match,
    MatchResult,
    _entry,
    license_label,
)
from .load import LoadError
from .names import match_key
from .reference_images import Converted, is_downloadable

LOAD_TYPE = 'fotos_referencia'
SOURCE = 'inaturalist'
MIGRATION = '20261124110000_fotos_de_referencia.sql'
AUTHOR_REQUEST = 'author_request'
MAX_AUTHOR = 200
MAX_ATTRIBUTION = 500
# Enlaces de cada licencia. La API da solo el código, sin versión (docs/inaturalist.md,
# «Versión de la licencia»): se enlaza la 4.0, como en el texto propuesto, y la atribución
# enlaza además la página de la foto, que muestra la licencia exacta.
LICENSE_URLS = {
    'cc0': 'https://creativecommons.org/publicdomain/zero/1.0/',
    'pd': 'https://creativecommons.org/publicdomain/mark/1.0/',
    'cc-by': 'https://creativecommons.org/licenses/by/4.0/',
    'cc-by-sa': 'https://creativecommons.org/licenses/by-sa/4.0/',
}


# Estado de la base ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class DbSpecies:
    id: str
    name: str
    genus: str
    type: str
    synonyms: tuple[str, ...]
    plants: int

    def entry(self) -> CatalogEntry:
        return _entry(self.id, self.name, self.genus, self.type, self.synonyms, self.plants, 'base')


@dataclass(frozen=True, slots=True)
class CurrentPhoto:
    species_id: str
    source_photo_id: str
    medium_path: str
    thumbnail_path: str
    license: str
    author_name: str
    attribution: str
    source_selection: str | None
    source_observation_id: str | None
    source_taxon_id: str | None


@dataclass(slots=True)
class PhotoState:
    """Fotos actuales y retiradas (lo que puede cambiar mientras dura la carga)."""

    photos: dict[str, CurrentPhoto] = field(default_factory=dict)
    # Especie → ids de foto retirados para ella.
    rejected: dict[str, set[str]] = field(default_factory=lambda: defaultdict(set))
    # Ids de foto retirados a petición de su autor en alguna especie: no se usan en ninguna.
    author_requests: set[str] = field(default_factory=set)
    species_ids: set[str] = field(default_factory=set)

    def retired(self, species_id: str, photo_id: str) -> Skip | None:
        if photo_id in self.author_requests:
            return Skip.AUTHOR_REQUEST
        if photo_id in self.rejected.get(species_id, ()):
            return Skip.RETIRED
        return None


@dataclass(slots=True)
class DbState:
    species: list[DbSpecies]
    photos: PhotoState


def check_schema(conn: psycopg.Connection[Any]) -> None:
    """La base tiene las fotos de referencia y la carga puede leer todas las retiradas.

    Leer las retiradas enteras exige el permiso ``select`` y que RLS no se aplique al usuario
    (como la memoria de las fusiones): con RLS solo las ve un administrador con token, y la
    carga creería que no hay ninguna.
    """
    row = conn.execute(
        "select to_regclass('public.species_photos') is not null, "
        "r is not null and has_table_privilege(r, 'select') and not row_security_active(r) "
        "from to_regclass('public.species_photo_rejections') as r"
    ).fetchone()
    if row is None or not row[0]:
        raise LoadError(
            f'La base no tiene public.species_photos (migración {MIGRATION}): aplícala antes de '
            'cargar fotos de referencia.'
        )
    if not row[1]:
        raise LoadError(
            'El usuario de la conexión no puede leer todas las fotos retiradas '
            '(public.species_photo_rejections): sin ellas se podría reponer una foto retirada.'
        )


def read_photo_state(conn: psycopg.Connection[Any]) -> PhotoState:
    state = PhotoState()
    for r in conn.execute(
        """
        select species_id, source_photo_id, medium_path, thumbnail_path, license, author_name,
               attribution, source_selection, source_observation_id, source_taxon_id
        from public.species_photos
        where source = 'inaturalist'
        """
    ):
        state.photos[str(r[0])] = CurrentPhoto(str(r[0]), *r[1:])
    for species_id, photo_id, reason in conn.execute(
        'select species_id, source_photo_id, reason from public.species_photo_rejections '
        "where source = 'inaturalist'"
    ):
        state.rejected[str(species_id)].add(photo_id)
        if reason == AUTHOR_REQUEST:
            state.author_requests.add(photo_id)
    state.species_ids = {str(r[0]) for r in conn.execute('select id from public.species')}
    return state


def read_state(conn: psycopg.Connection[Any]) -> DbState:
    check_schema(conn)
    synonyms: dict[str, list[str]] = defaultdict(list)
    for species_id, name in conn.execute(
        "select species_id, name from public.species_names where type = 'synonym' "
        'order by species_id, name'
    ):
        synonyms[str(species_id)].append(name)
    plants = {
        str(species_id): count
        for species_id, count in conn.execute(
            'select species_id, count(*) from public.plants '
            'where species_id is not null group by species_id'
        )
    }
    species = [
        DbSpecies(
            str(r[0]),
            r[1],
            r[2],
            r[3],
            tuple(synonyms.get(str(r[0]), ())),
            plants.get(str(r[0]), 0),
        )
        for r in conn.execute(
            """
            select s.id, s.scientific_name, g.name, s.type::text
            from public.species s join public.genera g on g.id = s.genus_id
            order by s.scientific_name, s.id
            """
        )
    ]
    return DbState(species, read_photo_state(conn))


# Alcance -------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Scope:
    """Qué especies entran. Por defecto, las que están en alguna colección y las de los
    géneros comunes (#180); con ``genera``, solo las de esos géneros; con ``everything``, todo
    el catálogo. ``limit`` se queda con las primeras (más plantas antes, después por nombre)."""

    genera: tuple[str, ...] = ()
    everything: bool = False
    limit: int | None = None

    def describe(self) -> str:
        if self.everything:
            what = 'todo el catálogo'
        elif self.genera:
            what = 'géneros ' + ', '.join(self.genera)
        else:
            what = (
                'especies en alguna colección y géneros comunes (' + ', '.join(COMMON_GENERA) + ')'
            )
        return what + (f', como mucho {self.limit} especies' if self.limit else '')

    def to_dict(self) -> dict[str, Any]:
        return {'genera': list(self.genera), 'all': self.everything, 'limit': self.limit}


def _genus_key(name: str) -> str:
    return match_key(name)


def select_scope(species: Sequence[DbSpecies], scope: Scope) -> list[DbSpecies]:
    if scope.everything:
        chosen = list(species)
    elif scope.genera:
        keys = {_genus_key(g) for g in scope.genera}
        chosen = [s for s in species if _genus_key(s.genus) in keys]
    else:
        keys = {_genus_key(g) for g in COMMON_GENERA}
        chosen = [s for s in species if s.plants > 0 or _genus_key(s.genus) in keys]
    chosen.sort(key=lambda s: (-s.plants, match_key(s.name), s.id))
    return chosen[: scope.limit] if scope.limit else chosen


# Elección ------------------------------------------------------------------------------------


class Selection(StrEnum):
    """Cómo se eligió la foto (columna ``source_selection``)."""

    DEFAULT = 'taxon_default'
    TAXON = 'taxon_photo'
    OBSERVATION = 'observation'


class Skip(StrEnum):
    """Por qué no se usó una foto candidata."""

    LICENSE = 'licencia_no_aceptada'
    FLAGGED = 'con_marcas'
    RETIRED = 'retirada'
    AUTHOR_REQUEST = 'peticion_del_autor'
    NO_AUTHOR = 'sin_autor'
    URL = 'url_no_admitida'
    DOWNLOAD = 'error_descarga'
    CONVERSION = 'error_conversion'
    UPLOAD = 'error_subida'


class Outcome(StrEnum):
    """Qué le pasa a la especie (columna ``resultado`` del reporte)."""

    NEW = 'nueva'
    REPLACED = 'sustituida'
    UPDATED = 'actualizada'
    UNCHANGED = 'sin_cambios'
    REMOVED = 'quitada'
    KEPT = 'conservada_sin_verificar'
    NO_PHOTO = 'sin_foto'
    UNMATCHED = 'sin_taxon'
    AMBIGUOUS = 'ambigua'
    FAILED = 'error'
    # Planificada, pero en la transacción ya no procedía (retirada o cambio entre medias).
    SKIPPED = 'omitida'


@dataclass(frozen=True, slots=True)
class Candidate:
    photo: Photo
    selection: Selection
    taxon_id: int

    @property
    def id(self) -> str:
        return str(self.photo.id)


def candidates(
    taxon: Taxon, taxon_photos: Sequence[Photo] | None, observation: Photo | None
) -> list[Candidate]:
    """Todas las fotos posibles del taxón, en orden de preferencia y sin repetir."""
    found: dict[int, Candidate] = {}
    if taxon.default_photo is not None:
        found[taxon.default_photo.id] = Candidate(taxon.default_photo, Selection.DEFAULT, taxon.id)
    for photo in taxon_photos or ():
        found.setdefault(photo.id, Candidate(photo, Selection.TAXON, taxon.id))
    if observation is not None:
        found.setdefault(observation.id, Candidate(observation, Selection.OBSERVATION, taxon.id))
    return list(found.values())


_NOTICE_AUTHOR = re.compile(r'^\s*(?:\(c\)|©)\s*([^,]+),', re.IGNORECASE)


def author_of(photo: Photo) -> str | None:
    """El autor como hay que nombrarlo: el de iNaturalist o, si falta, el del aviso «(c) X,»."""
    author = (photo.author or '').strip()
    if not author and (found := _NOTICE_AUTHOR.match(photo.attribution or '')):
        author = found.group(1).strip()
    return author[:MAX_AUTHOR].strip() or None


def stored_attribution(photo: Photo, author: str) -> str:
    """Texto de atribución que se guarda: el aviso de la fuente, el autor, la licencia con su
    enlace, el enlace a la original y que está modificada. Con CC BY-SA, además, que la versión
    reducida se publica con la misma licencia (CC BY-SA 3(b) y la decisión del #180)."""
    code = photo.license or ''
    tail = [
        f'Licencia: {license_label(code)} ({LICENSE_URLS[code]})',
        f'Original: {photo.page_url}, vía iNaturalist',
        'Modificada: reducida y convertida a WebP',
    ]
    if code == 'cc-by-sa':
        tail.append('La versión reducida se publica con la misma licencia, CC BY-SA')
    rest = '. '.join(tail) + '.'
    notice = (photo.attribution or '').strip() or f'(c) {author}'
    if author.casefold() not in notice.casefold():
        notice = f'{author}: {notice}'
    room = MAX_ATTRIBUTION - len(rest) - 2
    if len(notice) > room:
        notice = notice[: room - 1].rstrip() + '…'
    return f'{notice}. {rest}'


def skip_reason(candidate: Candidate, species_id: str, state: PhotoState) -> Skip | None:
    photo = candidate.photo
    if photo.license not in ACCEPTED_LICENSES:
        return Skip.LICENSE
    if photo.flagged:
        return Skip.FLAGGED
    if retired := state.retired(species_id, candidate.id):
        return retired
    if author_of(photo) is None:
        return Skip.NO_AUTHOR
    if not is_downloadable(photo.url('medium')):
        return Skip.URL
    return None


@dataclass(frozen=True, slots=True)
class Metadata:
    """Lo que se guarda de una foto aparte de las imágenes."""

    source_photo_id: str
    source_observation_id: str | None
    source_taxon_id: str
    source_selection: str
    source_url: str
    license: str
    author_name: str
    attribution: str

    @classmethod
    def of(cls, candidate: Candidate) -> Metadata:
        photo = candidate.photo
        author = author_of(photo) or ''
        return cls(
            source_photo_id=candidate.id,
            source_observation_id=str(photo.observation_id) if photo.observation_id else None,
            source_taxon_id=str(candidate.taxon_id),
            source_selection=candidate.selection.value,
            source_url=photo.page_url,
            license=photo.license or '',
            author_name=author,
            attribution=stored_attribution(photo, author),
        )

    def differs_from(self, current: CurrentPhoto) -> bool:
        return (
            self.license,
            self.author_name,
            self.attribution,
            self.source_selection,
            self.source_taxon_id,
            self.source_observation_id,
        ) != (
            current.license,
            current.author_name,
            current.attribution,
            current.source_selection,
            current.source_taxon_id,
            current.source_observation_id,
        )


class Action(StrEnum):
    NONE = 'ninguna'
    # Buscar una foto nueva entre ``usable`` (no hay actual, o la actual ya no vale).
    FETCH = 'buscar'
    UPDATE = 'actualizar'
    # Quitar la fila: la foto actual ya no vale y no hay otra.
    REMOVE = 'quitar'


@dataclass(slots=True)
class Decision:
    species: DbSpecies
    match: Match
    taxon: Taxon | None
    action: Action
    outcome: Outcome
    current: CurrentPhoto | None = None
    usable: list[Candidate] = field(default_factory=list)
    metadata: Metadata | None = None
    skipped: Counter[str] = field(default_factory=Counter)
    detail: str = ''
    # Lo que se preparó para escribir (tras descargar, convertir y, al escribir, subir).
    prepared: Prepared | None = None


@dataclass(frozen=True, slots=True)
class Prepared:
    metadata: Metadata
    converted: Converted
    obtained_at: datetime
    medium_path: str
    thumbnail_path: str


def photo_paths(species_id: str, photo_id: str) -> tuple[str, str]:
    """Rutas en el bucket, según la convención de la migración."""
    return f'{species_id}/medium-{photo_id}.webp', f'{species_id}/thumb-{photo_id}.webp'


def decide(
    species: DbSpecies,
    result: MatchResult | None,
    options: Sequence[Candidate],
    state: PhotoState,
    *,
    observations_searched: bool,
    taxon_photos_searched: bool = True,
) -> Decision:
    """Qué hacer con una especie, sin red ni base.

    - Sin taxón emparejado: nada (si tenía foto, se conserva sin verificar).
    - Con foto actual que sigue siendo utilizable: se conserva; si cambiaron su licencia, su
      autor o su atribución, se actualizan esos datos (``actualizada``).
    - Con foto actual que ya no vale (licencia no aceptada, marcas, retirada a petición del
      autor o que el taxón ya no la tiene): se busca otra; si no hay, se quita la fila.
    - Si la actual salió de una observación (de ellas solo se pide la más votada), o es otra
      foto del taxón y esta vez no se leyeron las fotos del taxón (``--alternativas
      ninguna``), y no está entre las candidatas, se conserva sin verificar.
    - Sin foto actual: se busca la primera utilizable.
    """
    current = state.photos.get(species.id)
    if result is None or result.taxon is None:
        match = result.match if result else Match.NO_TAXON
        outcome = Outcome.AMBIGUOUS if match is Match.AMBIGUOUS else Outcome.UNMATCHED
        if current is not None:
            outcome = Outcome.KEPT
        return Decision(
            species,
            match,
            None,
            Action.NONE,
            outcome,
            current,
            detail=result.detail if result else '',
        )
    usable: list[Candidate] = []
    skipped: Counter[str] = Counter()
    for option in options:
        reason = skip_reason(option, species.id, state)
        if reason is None:
            usable.append(option)
        else:
            skipped[reason.value] += 1
    decision = Decision(species, result.match, result.taxon, Action.FETCH, Outcome.NEW, current)
    decision.skipped = skipped
    if current is not None:
        same = next((c for c in options if c.id == current.source_photo_id), None)
        still_usable = next((c for c in usable if c.id == current.source_photo_id), None)
        if still_usable is not None:
            metadata = Metadata.of(still_usable)
            if metadata.differs_from(current):
                decision.action, decision.outcome = Action.UPDATE, Outcome.UPDATED
                decision.metadata = metadata
            else:
                decision.action, decision.outcome = Action.NONE, Outcome.UNCHANGED
            return decision
        if same is None and current.source_selection == Selection.OBSERVATION.value:
            # De las observaciones solo se pide la más votada: que no salga no quiere decir que
            # la foto ya no valga, así que se conserva.
            decision.action, decision.outcome = Action.NONE, Outcome.KEPT
            decision.detail = (
                'Foto de una observación que ya no es la más votada: no se puede comprobar.'
                if observations_searched
                else 'Foto de una observación: sin --alternativas observaciones no se comprueba.'
            )
            return decision
        if same is None and not taxon_photos_searched:
            decision.action, decision.outcome = Action.NONE, Outcome.KEPT
            decision.detail = 'No se leyeron las fotos del taxón: no se puede comprobar.'
            return decision
        decision.detail = (
            f'La foto actual {current.source_photo_id} ya no vale: '
            + (
                (skip_reason(same, species.id, state) or Skip.LICENSE).value
                if same is not None
                else 'el taxón ya no la tiene'
            )
            + '.'
        )
        decision.outcome = Outcome.REPLACED
    decision.usable = [c for c in usable if current is None or c.id != current.source_photo_id]
    if not decision.usable:
        decision.action = Action.NONE if current is None else Action.REMOVE
        decision.outcome = Outcome.NO_PHOTO if current is None else Outcome.REMOVED
    return decision


def give_up(decision: Decision, detail: str) -> None:
    """Ninguna candidata se pudo descargar, convertir o subir: sin foto nueva."""
    decision.prepared = None
    if decision.current is not None:
        decision.action, decision.outcome = Action.REMOVE, Outcome.REMOVED
    else:
        decision.action, decision.outcome = Action.NONE, Outcome.FAILED
    decision.detail = ' '.join(part for part in (decision.detail, detail) if part)


# Plan de la transacción ----------------------------------------------------------------------


class Op(StrEnum):
    UPSERT = 'upsert'
    UPDATE = 'update'
    DELETE = 'delete'


@dataclass(frozen=True, slots=True)
class RowOp:
    op: Op
    species_id: str
    outcome: Outcome
    prepared: Prepared | None = None
    metadata: Metadata | None = None
    # La foto que tenía la especie al planificar (para la baja o el cambio de metadatos).
    previous_photo_id: str | None = None


ALREADY_THERE = 'La especie ya tiene esta foto.'


@dataclass(slots=True)
class RowPlan:
    ops: list[RowOp] = field(default_factory=list)
    # Especie → (resultado, motivo) cuando en la transacción ya no procedía lo planificado.
    skipped: dict[str, str] = field(default_factory=dict)
    counts: Counter[str] = field(default_factory=Counter)


def plan_rows(decisions: Iterable[Decision], fresh: PhotoState) -> RowPlan:
    """Las filas que se escriben, comparando lo decidido con lo que hay en la base ahora."""
    plan = RowPlan()
    for d in decisions:
        sid = d.species.id
        now = fresh.photos.get(sid)
        if d.outcome is Outcome.UNCHANGED:
            plan.counts['unchanged'] += 1
            continue
        if d.action is Action.NONE:
            continue
        if sid not in fresh.species_ids:
            plan.skipped[sid] = 'La especie se borró durante la carga.'
            continue
        if d.action is Action.FETCH:
            if d.prepared is None:
                continue
            retired = fresh.retired(sid, d.prepared.metadata.source_photo_id)
            if retired is not None:
                plan.skipped[sid] = f'La foto se retiró durante la carga ({retired.value}).'
                continue
            if now is not None and now.source_photo_id == d.prepared.metadata.source_photo_id:
                plan.counts['unchanged'] += 1
                plan.skipped[sid] = ALREADY_THERE
                continue
            expected = d.current.source_photo_id if d.current else None
            if (now.source_photo_id if now else None) != expected:
                plan.skipped[sid] = 'La foto de la especie cambió durante la carga.'
                continue
            outcome = Outcome.NEW if now is None else Outcome.REPLACED
            plan.ops.append(
                RowOp(Op.UPSERT, sid, outcome, prepared=d.prepared, previous_photo_id=expected)
            )
            plan.counts['created' if now is None else 'replaced'] += 1
        elif d.action is Action.UPDATE and d.metadata is not None:
            if now is None or now.source_photo_id != d.metadata.source_photo_id:
                plan.skipped[sid] = 'La foto de la especie cambió durante la carga.'
                continue
            if fresh.retired(sid, now.source_photo_id) is not None:
                plan.skipped[sid] = 'La foto se retiró durante la carga.'
                continue
            plan.ops.append(
                RowOp(
                    Op.UPDATE,
                    sid,
                    Outcome.UPDATED,
                    metadata=d.metadata,
                    previous_photo_id=now.source_photo_id,
                )
            )
            plan.counts['updated'] += 1
        elif d.action is Action.REMOVE and d.current is not None:
            if now is None or now.source_photo_id != d.current.source_photo_id:
                plan.skipped[sid] = 'La foto de la especie cambió durante la carga.'
                continue
            plan.ops.append(
                RowOp(Op.DELETE, sid, Outcome.REMOVED, previous_photo_id=now.source_photo_id)
            )
            plan.counts['removed'] += 1
    return plan


# Escritura -----------------------------------------------------------------------------------

_UPSERT = """
insert into public.species_photos (
  species_id, medium_path, medium_width, medium_height, thumbnail_path, thumbnail_width,
  thumbnail_height, source, source_photo_id, source_observation_id, source_taxon_id,
  source_selection, source_url, license, author_name, attribution, is_modified, obtained_at
)
values (%s, %s, %s, %s, %s, %s, %s, 'inaturalist', %s, %s, %s, %s, %s, %s, %s, %s, true, %s)
on conflict (species_id) do update set
  medium_path = excluded.medium_path,
  medium_width = excluded.medium_width,
  medium_height = excluded.medium_height,
  thumbnail_path = excluded.thumbnail_path,
  thumbnail_width = excluded.thumbnail_width,
  thumbnail_height = excluded.thumbnail_height,
  source = excluded.source,
  source_photo_id = excluded.source_photo_id,
  source_observation_id = excluded.source_observation_id,
  source_taxon_id = excluded.source_taxon_id,
  source_selection = excluded.source_selection,
  source_url = excluded.source_url,
  license = excluded.license,
  author_name = excluded.author_name,
  attribution = excluded.attribution,
  is_modified = excluded.is_modified,
  obtained_at = excluded.obtained_at
"""

_UPDATE = """
update public.species_photos
set license = %s, author_name = %s, attribution = %s, source_selection = %s,
    source_taxon_id = %s, source_observation_id = %s
where species_id = %s and source = 'inaturalist' and source_photo_id = %s
"""

_DELETE = """
delete from public.species_photos
where species_id = %s and source = 'inaturalist' and source_photo_id = %s
"""


@dataclass(slots=True)
class WriteResult:
    plan: RowPlan
    written: bool
    audit_ready: bool
    audit_action_id: str | None


def audit_details(
    audit: LoadAudit, plan: RowPlan, extra: dict[str, Any], source: dict[str, Any]
) -> dict[str, Any]:
    counts = {
        k: plan.counts.get(k, 0) for k in ('created', 'replaced', 'updated', 'unchanged', 'removed')
    }
    return {
        'load_type': LOAD_TYPE,
        'environment': audit.environment,
        'source': source,
        'counts': {'species_photos': counts},
        **extra,
        'run': dict(audit.run) if audit.run is not None else None,
    }


def _expect_one(cursor: psycopg.Cursor[Any], what: str) -> None:
    if cursor.rowcount != 1:
        raise LoadError(
            f'{what} afectó a {cursor.rowcount} filas en vez de 1. No se escribió nada.'
        )


def write_rows(
    conn: psycopg.Connection[Any],
    decisions: Sequence[Decision],
    *,
    write: bool,
    audit: LoadAudit,
    extra: dict[str, Any],
    source: dict[str, Any],
) -> WriteResult:
    """La transacción de la carga. Sin ``write`` hace todo y lo revierte."""
    if conn.autocommit:
        raise LoadError('La conexión no debe estar en autocommit: la carga es una transacción.')
    try:
        conn.execute("set local lock_timeout = '15s'")
        conn.execute("set local statement_timeout = '15min'")
        check_schema(conn)
        ready = audit_ready(conn)
        if write and not ready:
            raise LoadError(missing_audit_message())
        # Nadie retira ni cambia una foto mientras se escriben las filas: lo que se lee aquí
        # sigue siendo cierto al escribir. La lectura del catálogo no se frena.
        conn.execute(
            'lock table public.species_photos, public.species_photo_rejections '
            'in share row exclusive mode'
        )
        plan = plan_rows(decisions, read_photo_state(conn))
        action_id = None
        if ready:
            row = conn.execute(
                'select private.log_catalog_action(%s, %s::jsonb, null, null, %s)',
                (
                    ACTION,
                    json.dumps(audit_details(audit, plan, extra, source), ensure_ascii=False),
                    audit.actor,
                ),
            ).fetchone()
            action_id = str(row[0]) if row else None
        with conn.cursor() as cur:
            for op in plan.ops:
                if op.op is Op.UPSERT and op.prepared is not None:
                    p, m = op.prepared, op.prepared.metadata
                    cur.execute(
                        _UPSERT,
                        (
                            op.species_id,
                            p.medium_path,
                            p.converted.medium.width,
                            p.converted.medium.height,
                            p.thumbnail_path,
                            p.converted.thumbnail.width,
                            p.converted.thumbnail.height,
                            m.source_photo_id,
                            m.source_observation_id,
                            m.source_taxon_id,
                            m.source_selection,
                            m.source_url,
                            m.license,
                            m.author_name,
                            m.attribution,
                            p.obtained_at,
                        ),
                    )
                    _expect_one(cur, 'La escritura de una foto')
                elif op.op is Op.UPDATE and op.metadata is not None:
                    m = op.metadata
                    cur.execute(
                        _UPDATE,
                        (
                            m.license,
                            m.author_name,
                            m.attribution,
                            m.source_selection,
                            m.source_taxon_id,
                            m.source_observation_id,
                            op.species_id,
                            op.previous_photo_id,
                        ),
                    )
                    _expect_one(cur, 'La actualización de una foto')
                elif op.op is Op.DELETE:
                    cur.execute(_DELETE, (op.species_id, op.previous_photo_id))
                    _expect_one(cur, 'La baja de una foto')
        if write:
            conn.commit()
        else:
            conn.rollback()
    except BaseException:
        conn.rollback()
        raise
    return WriteResult(plan, write, ready, action_id)


# Reporte -------------------------------------------------------------------------------------

REPORT_HEADER = (
    'especie_id',
    'nombre',
    'genero',
    'plantas',
    'emparejamiento',
    'inat_id',
    'inat_nombre',
    'resultado',
    'detalle',
    'foto_id',
    'seleccion',
    'licencia',
    'autor',
    'atribucion',
    'foto_pagina',
    'observacion',
    'medium_path',
    'medium_medidas',
    'thumbnail_path',
    'thumbnail_medidas',
    'bytes',
    'foto_anterior',
    'descartadas',
)


def final_outcome(decision: Decision, plan: RowPlan | None) -> tuple[Outcome, str]:
    sid = decision.species.id
    if plan is not None and sid in plan.skipped:
        reason = plan.skipped[sid]
        outcome = Outcome.UNCHANGED if reason == ALREADY_THERE else Outcome.SKIPPED
        return outcome, reason
    return decision.outcome, decision.detail


def report_cells(decision: Decision, plan: RowPlan | None) -> tuple[str, ...]:
    outcome, detail = final_outcome(decision, plan)
    s, t, cur = decision.species, decision.taxon, decision.current
    prepared = decision.prepared
    meta = prepared.metadata if prepared else decision.metadata
    if meta is None and cur is not None and outcome in (Outcome.UNCHANGED, Outcome.KEPT):
        photo_id, selection, license_, author, text = (
            cur.source_photo_id,
            cur.source_selection or '',
            cur.license,
            cur.author_name,
            cur.attribution,
        )
        page = f'https://www.inaturalist.org/photos/{cur.source_photo_id}'
        observation = cur.source_observation_id
        medium, thumb = cur.medium_path, cur.thumbnail_path
    elif meta is not None:
        photo_id, selection, license_, author, text = (
            meta.source_photo_id,
            meta.source_selection,
            meta.license,
            meta.author_name,
            meta.attribution,
        )
        page, observation = meta.source_url, meta.source_observation_id
        medium = prepared.medium_path if prepared else (cur.medium_path if cur else '')
        thumb = prepared.thumbnail_path if prepared else (cur.thumbnail_path if cur else '')
    else:
        photo_id = selection = license_ = author = text = page = medium = thumb = ''
        observation = None
    skipped = '; '.join(f'{k} {v}' for k, v in sorted(decision.skipped.items()))
    replaced = cur.source_photo_id if cur and outcome in (Outcome.REPLACED, Outcome.REMOVED) else ''
    return (
        s.id,
        s.name,
        s.genus,
        str(s.plants),
        decision.match.value,
        str(t.id) if t else '',
        t.name if t else '',
        outcome.value,
        detail,
        photo_id,
        selection,
        license_label(license_) if license_ else '',
        author,
        text,
        page,
        f'https://www.inaturalist.org/observations/{observation}' if observation else '',
        medium,
        f'{prepared.converted.medium.width}×{prepared.converted.medium.height}' if prepared else '',
        thumb,
        f'{prepared.converted.thumbnail.width}×{prepared.converted.thumbnail.height}'
        if prepared
        else '',
        str(prepared.converted.bytes) if prepared else '',
        replaced,
        skipped,
    )


def write_report(path: Path, decisions: Sequence[Decision], plan: RowPlan | None) -> int:
    with path.open('w', encoding='utf-8-sig', newline='') as handle:
        writer = csv.writer(handle)
        writer.writerow(REPORT_HEADER)
        for decision in decisions:
            writer.writerow(report_cells(decision, plan))
    return len(decisions)


def tally(decisions: Sequence[Decision], plan: RowPlan | None) -> dict[str, Any]:
    """Recuentos del reporte final."""
    outcomes: Counter[str] = Counter()
    licenses: Counter[str] = Counter()
    selections: Counter[str] = Counter()
    skipped: Counter[str] = Counter()
    matches: Counter[str] = Counter()
    for d in decisions:
        outcome, _ = final_outcome(d, plan)
        outcomes[outcome.value] += 1
        matches[d.match.value] += 1
        skipped.update(d.skipped)
        meta = d.prepared.metadata if d.prepared else d.metadata
        if meta is not None:
            licenses[meta.license] += 1
            selections[meta.source_selection] += 1
        elif d.current is not None and outcome in (Outcome.UNCHANGED, Outcome.KEPT):
            licenses[d.current.license] += 1
            selections[d.current.source_selection or 'desconocida'] += 1
    with_photo = sum(licenses.values())
    prepared = [d.prepared for d in decisions if d.prepared]
    return {
        'en_alcance': len(decisions),
        'emparejamiento': dict(sorted(matches.items())),
        'con_foto': with_photo,
        'por_licencia': dict(sorted(licenses.items())),
        'por_seleccion': dict(sorted(selections.items())),
        'resultado': dict(sorted(outcomes.items())),
        'descartadas_por_motivo': dict(sorted(skipped.items())),
        'omitidas_por_retiradas': sum(
            1
            for d in decisions
            if d.skipped.get(Skip.RETIRED) or d.skipped.get(Skip.AUTHOR_REQUEST)
        ),
        'imagenes_preparadas': len(prepared),
        'bytes_preparados': sum(p.converted.bytes for p in prepared),
    }
