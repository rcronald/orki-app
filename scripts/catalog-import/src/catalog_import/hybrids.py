"""Lista curada de híbridos: formato del CSV y validación, sin base de datos.

La lista (``data/hibridos.csv``) complementa el catálogo del Catalogue of Life con los
híbridos de vivero (grex) y los nombres con los que se venden. La cura una persona; la carga
(:mod:`catalog_import.hybrids_load`) solo usa las filas marcadas como revisadas.

Formato (el README de la carpeta lo documenta con un ejemplo):

- UTF-8, con o sin BOM; separado por comas; comillas dobles solo para encerrar una celda,
  como las escribe cualquier hoja de cálculo. Cabecera fija, en este orden: :data:`HEADER`.
- ``id``: identificador estable de la fila, ``HIB-`` y cuatro cifras (``HIB-0001``). Es el
  ``source_ref`` de la especie en la base: no se cambia ni se reutiliza nunca.
- ``nombre``: nombre aceptado, el grex completo con el género («Phalaenopsis Sogo
  Yukidian»), sin el signo «×» y sin nombre de clon entre comillas.
- ``genero``: el género del nombre, con o sin «× » delante («× Brassocattleya» o
  «Brassocattleya»).
- ``nombres_comunes`` y ``otros_nombres``: listas separadas por «|» (los espacios junto a la
  barra no cuentan). Los primeros se cargan como nombres comunes; los segundos (grafías y
  géneros antiguos, etiquetas con el clon) como sinónimos.
- ``revisado``: ``sí`` o ``no``. Solo se cargan las filas con ``sí``.
- ``notas``: texto libre (fuente, dudas). No se carga.

La validación junta **todos** los errores, cada uno con su fila (la de la hoja de cálculo:
la cabecera es la fila 1) y su columna. Con un solo error, la carga no se conecta a la base.
"""

from __future__ import annotations

import csv
import hashlib
import io
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from .names import HYBRID_SIGN, match_key

HEADER = ('id', 'nombre', 'genero', 'nombres_comunes', 'otros_nombres', 'revisado', 'notas')
LIST_SEPARATOR = '|'
REVIEWED = {'sí': True, 'no': False}
ID_PATTERN = re.compile(r'^HIB-[0-9]{4}$')
# Un género: una palabra latina con mayúscula inicial, con «× » delante si es un nothogénero.
GENUS_PATTERN = re.compile(rf'^(?:{HYBRID_SIGN} )?[A-Z][a-z]+$')
# Tope de longitud de un nombre. La base no pone uno, pero la búsqueda no acepta consultas de
# más de 100 caracteres: un nombre más largo no se podría escribir entero en el buscador.
NAME_MAX = 100
NOTES_MAX = 500

# Caracteres que no van en un nombre: el signo de híbrido y sus parecidos (en el nombre de un
# grex no se escribe), las comillas tipográficas que ponen las hojas de cálculo (el apóstrofo
# es «'»), las comillas dobles y la barra que separa las listas.
_FORBIDDEN = {
    HYBRID_SIGN: 'el signo «×» (en el nombre de un grex no se escribe; va solo en la columna '
    'genero)',
    chr(0x2715): 'un aspa parecida al signo «×»',
    chr(0x2716): 'un aspa parecida al signo «×»',
    chr(0x2A2F): 'un aspa parecida al signo «×»',
    # Comillas simples y dobles tipográficas (U+2018, U+2019, U+201C y U+201D), por su código
    # para que se vean en el código fuente.
    chr(0x2018): "una comilla tipográfica (usa el apóstrofo recto «'»)",
    chr(0x2019): "una comilla tipográfica (usa el apóstrofo recto «'»)",
    chr(0x201C): 'comillas dobles tipográficas',
    chr(0x201D): 'comillas dobles tipográficas',
    '"': 'comillas dobles',
    LIST_SEPARATOR: f'la barra «{LIST_SEPARATOR}», que separa los nombres de una lista',
}


@dataclass(frozen=True, slots=True)
class HybridEntry:
    """Una fila válida de la lista."""

    # Fila de la hoja de cálculo (la cabecera es la 1).
    row: int
    ref: str
    name: str
    genus: str
    common_names: tuple[str, ...]
    other_names: tuple[str, ...]
    reviewed: bool
    notes: str


@dataclass(frozen=True, slots=True)
class Problem:
    """Un error de formato: fila (0 si es del archivo entero), columna y motivo."""

    row: int
    column: str
    code: str
    message: str

    def __str__(self) -> str:
        where = f'fila {self.row}' if self.row else 'archivo'
        if self.column:
            where += f', columna {self.column}'
        return f'{where} [{self.code}]: {self.message}'


@dataclass(frozen=True, slots=True)
class HybridList:
    path: Path
    sha256: str
    entries: tuple[HybridEntry, ...]
    problems: tuple[Problem, ...]

    @property
    def valid(self) -> bool:
        return not self.problems

    def summary(self) -> dict[str, object]:
        genera = Counter(e.genus for e in self.entries)
        return {
            'entries': len(self.entries),
            'reviewed': sum(e.reviewed for e in self.entries),
            'not_reviewed': sum(not e.reviewed for e in self.entries),
            'common_names': sum(len(e.common_names) for e in self.entries),
            'other_names': sum(len(e.other_names) for e in self.entries),
            'genera': dict(sorted(genera.items(), key=lambda item: match_key(item[0]))),
        }


def read_hybrids(path: Path) -> HybridList:
    """Lee y valida el archivo. Si hay errores, ``entries`` va vacío."""
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    problems: list[Problem] = []
    entries = _parse(data, problems)
    if problems:
        entries = []
    return HybridList(path, digest, tuple(entries), tuple(problems))


# Lectura ------------------------------------------------------------------------------------


def _parse(data: bytes, problems: list[Problem]) -> list[HybridEntry]:
    try:
        text = data.decode('utf-8-sig')
    except UnicodeDecodeError as error:
        line = data[: error.start].count(b'\n') + 1
        problems.append(
            Problem(
                0,
                '',
                'CODIFICACION',
                f'el archivo no está en UTF-8 (byte no válido en la línea {line}). Guárdalo como '
                '«CSV UTF-8».',
            )
        )
        return []
    if chr(0xFEFF) in text:
        problems.append(Problem(0, '', 'CODIFICACION', 'hay un BOM (U+FEFF) en medio del archivo.'))
        return []

    reader = csv.reader(io.StringIO(text, newline=''), strict=True)
    try:
        records = list(reader)
    except csv.Error as error:
        problems.append(
            Problem(
                reader.line_num,
                '',
                'COMILLAS',
                f'el CSV está mal formado cerca de la línea {reader.line_num} del archivo '
                f'({error}). Suele ser una comilla doble sin cerrar.',
            )
        )
        return []

    if not records:
        problems.append(Problem(0, '', 'CABECERA', 'el archivo está vacío.'))
        return []
    header = tuple(records[0])
    if header != HEADER:
        hint = ''
        if len(header) == 1 and ';' in header[0]:
            hint = ' Parece separado por punto y coma: guárdalo separado por comas.'
        problems.append(
            Problem(
                1,
                '',
                'CABECERA',
                f'la cabecera tiene que ser exactamente «{",".join(HEADER)}», y es '
                f'«{",".join(header)}».{hint}',
            )
        )
        return []

    entries: list[HybridEntry] = []
    for index, record in enumerate(records[1:], start=2):
        entry = _parse_row(index, record, problems)
        if entry is not None:
            entries.append(entry)
    _check_across_rows(entries, problems)
    return entries


def _parse_row(row: int, record: list[str], problems: list[Problem]) -> HybridEntry | None:
    if not any(cell.strip() for cell in record):
        problems.append(Problem(row, '', 'FILA_VACIA', 'fila vacía: bórrala.'))
        return None
    if len(record) != len(HEADER):
        problems.append(
            Problem(
                row,
                '',
                'COLUMNAS',
                f'tiene {len(record)} columnas y tienen que ser {len(HEADER)} '
                f'({", ".join(HEADER)}). Si un valor lleva comas, va entre comillas dobles.',
            )
        )
        return None
    cells = dict(zip(HEADER, record, strict=True))
    before = len(problems)

    ref = cells['id']
    if _check_clean(row, 'id', ref, problems, required=True) and not ID_PATTERN.match(ref):
        problems.append(
            Problem(
                row,
                'id',
                'ID_FORMATO',
                f'«{ref}» no tiene el formato HIB-0000 (HIB- y cuatro cifras).',
            )
        )

    genus = cells['genero']
    genus_ok = _check_clean(row, 'genero', genus, problems, required=True) and _check_genus(
        row, genus, problems
    )

    name = cells['nombre']
    if _check_name(row, 'nombre', name, problems, required=True):
        _check_accepted_name(row, name, genus if genus_ok else None, problems)

    common_names = _parse_list(row, 'nombres_comunes', cells['nombres_comunes'], problems)
    other_names = _parse_list(row, 'otros_nombres', cells['otros_nombres'], problems)
    _check_entry_names(row, name, common_names, other_names, problems)

    reviewed = REVIEWED.get(cells['revisado'])
    if reviewed is None:
        problems.append(
            Problem(
                row,
                'revisado',
                'REVISADO',
                f'tiene que ser «sí» o «no», y es «{cells["revisado"]}».',
            )
        )

    notes = cells['notas']
    if len(notes) > NOTES_MAX:
        problems.append(
            Problem(
                row, 'notas', 'LONGITUD', f'tiene {len(notes)} caracteres; el tope es {NOTES_MAX}.'
            )
        )

    if len(problems) > before:
        return None
    return HybridEntry(
        row, ref, name, genus, tuple(common_names), tuple(other_names), bool(reviewed), notes
    )


# Comprobaciones de una celda ------------------------------------------------------------------


def _check_clean(
    row: int, column: str, value: str, problems: list[Problem], *, required: bool
) -> bool:
    """Vacía (si es obligatoria), espacios sobrantes y caracteres de control. Devuelve si
    el valor se puede seguir comprobando."""
    if not value:
        if required:
            problems.append(Problem(row, column, 'VACIO', 'es obligatoria.'))
        return False
    if any(unicodedata.category(ch) in ('Cc', 'Cf') for ch in value):
        problems.append(
            Problem(
                row,
                column,
                'CARACTER',
                'lleva caracteres invisibles o de control (saltos de '
                'línea, tabuladores, espacios de ancho cero…).',
            )
        )
        return False
    if value != ' '.join(value.split()):
        problems.append(
            Problem(
                row,
                column,
                'ESPACIOS',
                f'«{value}» tiene espacios sobrantes (al principio, '
                'al final, dobles o de no separación).',
            )
        )
        return False
    return True


def _check_name(
    row: int, column: str, value: str, problems: list[Problem], *, required: bool
) -> bool:
    if not _check_clean(row, column, value, problems, required=required):
        return False
    ok = True
    for character, what in _FORBIDDEN.items():
        if character in value:
            problems.append(Problem(row, column, 'CARACTER', f'«{value}» lleva {what}.'))
            ok = False
    if any(word in ('x', 'X') for word in value.split(' ')):
        problems.append(
            Problem(
                row,
                column,
                'FORMULA',
                f'«{value}» lleva una «x» suelta: parece una fórmula '
                '«A x B», no el nombre de un grex.',
            )
        )
        ok = False
    if len(value) > NAME_MAX:
        problems.append(
            Problem(
                row,
                column,
                'LONGITUD',
                f'«{value}» tiene {len(value)} caracteres; el tope es {NAME_MAX}.',
            )
        )
        ok = False
    return ok


def _check_genus(row: int, genus: str, problems: list[Problem]) -> bool:
    if GENUS_PATTERN.match(genus):
        return True
    if re.match(r'^(?:[xX] |×(?=\S))', genus):
        message = (
            f'«{genus}»: el signo de nothogénero se escribe «× » (U+00D7 y un espacio), o no se '
            'escribe.'
        )
    else:
        message = (
            f'«{genus}» no es un nombre de género: una sola palabra con mayúscula inicial y sin '
            'tildes, con «× » delante si es un nothogénero.'
        )
    problems.append(Problem(row, 'genero', 'GENERO', message))
    return False


def _check_accepted_name(row: int, name: str, genus: str | None, problems: list[Problem]) -> None:
    """``genus`` es el de la columna genero si es válido; si no, no se compara."""
    words = name.split(' ')
    if len(words) < 2:
        problems.append(
            Problem(
                row,
                'nombre',
                'NOMBRE',
                f'«{name}»: el nombre aceptado es el género y el grex '
                '(«Phalaenopsis Sogo Yukidian»).',
            )
        )
        return
    plain_genus = genus.removeprefix(f'{HYBRID_SIGN} ') if genus else ''
    if genus and words[0] != plain_genus:
        problems.append(
            Problem(
                row,
                'nombre',
                'GENERO_DISTINTO',
                f'«{name}» no empieza por el género de la columna genero («{plain_genus}»).',
            )
        )
    epithet = words[1]
    if not (epithet[:1].isupper() or epithet[:1].isdigit()):
        problems.append(
            Problem(
                row,
                'nombre',
                'NOMBRE',
                f'«{name}»: el grex empieza por mayúscula; un epíteto '
                'en minúscula es de una especie botánica, que viene del Catalogue of Life.',
            )
        )
    if " '" in name or name.endswith("'"):
        problems.append(
            Problem(
                row,
                'nombre',
                'NOMBRE',
                f'«{name}»: el nombre aceptado es el grex, sin el clon '
                "entre comillas ('…'). La etiqueta con el clon puede ir en otros_nombres.",
            )
        )


def _parse_list(row: int, column: str, value: str, problems: list[Problem]) -> list[str]:
    if not value:
        return []
    if value != value.strip():
        problems.append(
            Problem(row, column, 'ESPACIOS', f'«{value}» tiene espacios al principio o al final.')
        )
        return []
    items = [item.strip() for item in value.split(LIST_SEPARATOR)]
    names: list[str] = []
    for item in items:
        if not item:
            problems.append(
                Problem(
                    row,
                    column,
                    'LISTA',
                    f'«{value}» tiene un elemento vacío (dos barras '
                    'seguidas o una barra al principio o al final).',
                )
            )
            continue
        if _check_name(row, column, item, problems, required=True):
            names.append(item)
    return names


def _check_entry_names(
    row: int,
    name: str,
    common_names: list[str],
    other_names: list[str],
    problems: list[Problem],
) -> None:
    """Dentro de una entrada, cada nombre una sola vez y distinto del aceptado (sin
    distinguir mayúsculas ni el signo «×»)."""
    seen: dict[str, str] = {match_key(name): 'nombre'} if name else {}
    for column, items in (('nombres_comunes', common_names), ('otros_nombres', other_names)):
        for item in items:
            key = match_key(item)
            where = seen.get(key)
            if where == 'nombre':
                problems.append(
                    Problem(
                        row,
                        column,
                        'REPETIDO_EN_ENTRADA',
                        f'«{item}» es el nombre aceptado de la entrada.',
                    )
                )
            elif where is not None:
                problems.append(
                    Problem(
                        row,
                        column,
                        'REPETIDO_EN_ENTRADA',
                        f'«{item}» está repetido en la entrada (también en {where}).',
                    )
                )
            else:
                seen[key] = column


# Comprobaciones entre filas -------------------------------------------------------------------


def _check_across_rows(entries: list[HybridEntry], problems: list[Problem]) -> None:
    """Identificadores únicos, nombres únicos en el archivo y cada género escrito igual."""
    refs: dict[str, int] = {}
    accepted: dict[str, HybridEntry] = {}
    synonyms: dict[str, HybridEntry] = {}
    genera: dict[str, tuple[str, int]] = {}
    for entry in entries:
        if entry.ref in refs:
            problems.append(
                Problem(
                    entry.row,
                    'id',
                    'ID_REPETIDO',
                    f'«{entry.ref}» ya lo usa la fila {refs[entry.ref]}.',
                )
            )
        else:
            refs[entry.ref] = entry.row

        key = match_key(entry.name)
        if key in accepted:
            problems.append(
                Problem(
                    entry.row,
                    'nombre',
                    'NOMBRE_REPETIDO',
                    f'«{entry.name}» ya está en la '
                    f'fila {accepted[key].row} («{accepted[key].name}»).',
                )
            )
        else:
            accepted[key] = entry

        genus_key = match_key(entry.genus)
        if genus_key in genera and genera[genus_key][0] != entry.genus:
            spelling, first = genera[genus_key]
            problems.append(
                Problem(
                    entry.row,
                    'genero',
                    'GENERO_ESCRITO_DISTINTO',
                    f'«{entry.genus}» está '
                    f'escrito como «{spelling}» en la fila {first}: escríbelo igual en todas.',
                )
            )
        genera.setdefault(genus_key, (entry.genus, entry.row))

    # Un nombre común o sinónimo no puede ser el nombre aceptado de otra entrada, y un
    # sinónimo no puede estar en dos entradas: la búsqueda no sabría a cuál llevar. Un
    # nombre común sí puede repetirse entre entradas.
    for entry in entries:
        for column, items in (
            ('nombres_comunes', entry.common_names),
            ('otros_nombres', entry.other_names),
        ):
            for item in items:
                key = match_key(item)
                other = accepted.get(key)
                if other is not None and other is not entry:
                    problems.append(
                        Problem(
                            entry.row,
                            column,
                            'NOMBRE_REPETIDO',
                            f'«{item}» es el nombre aceptado de la fila {other.row}.',
                        )
                    )
                    continue
                if column != 'otros_nombres':
                    continue
                first = synonyms.get(key)
                if first is not None and first is not entry:
                    problems.append(
                        Problem(
                            entry.row,
                            column,
                            'NOMBRE_REPETIDO',
                            f'«{item}» ya es otro nombre de la fila {first.row}.',
                        )
                    )
                else:
                    synonyms.setdefault(key, entry)
    problems.sort(key=lambda p: (p.row, HEADER.index(p.column) if p.column else -1))


def format_validation(hybrids: HybridList) -> str:
    """Resumen de la validación para la pantalla."""
    lines = [f'Archivo: {hybrids.path} (SHA-256 {hybrids.sha256})']
    if not hybrids.valid:
        lines.append(f'{len(hybrids.problems)} errores; no se carga nada:')
        lines += [f'  {problem}' for problem in hybrids.problems]
        return '\n'.join(lines)
    summary = hybrids.summary()
    genera: dict[str, int] = summary['genera']  # type: ignore[assignment]
    lines += [
        f'Entradas: {summary["entries"]} ({summary["reviewed"]} revisadas, '
        f'{summary["not_reviewed"]} sin revisar; solo se cargan las revisadas)',
        f'Nombres comunes: {summary["common_names"]}; otros nombres: {summary["other_names"]}',
        f'Géneros ({len(genera)}): ' + ', '.join(f'{g} {n}' for g, n in genera.items()),
        'Sin errores de formato.',
    ]
    return '\n'.join(lines)
