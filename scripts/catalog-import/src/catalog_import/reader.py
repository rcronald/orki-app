"""Lectura en flujo de la exportación plana de ChecklistBank.

La exportación ``/dataset/{clave}/export.zip?format=ColDP`` es un zip con dos archivos:

- ``dataset-{clave}.tsv``: un único TSV (unos 1,5 GB sin comprimir, 8,5 millones de filas en
  COL26.10 XR) con una fila por uso de nombre de todos los reinos y columnas ``col:…``.
- ``metadata.yaml``: metadatos de la versión (clave, alias, DOI, fecha).

El TSV no usa comillas: cada línea es un registro y los campos van separados por
tabuladores. Por eso se lee línea a línea directamente del zip, sin descomprimirlo en disco
ni cargarlo en memoria, y solo se convierten en registros las filas de la familia pedida.
"""

from __future__ import annotations

import io
import re
import zipfile
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import IO

# Columnas que se usan. La exportación trae más (reino, orden, tribu, epítetos…).
COLUMNS = {
    'id': 'col:ID',
    'parent_id': 'col:parentID',
    'status': 'col:status',
    'rank': 'col:rank',
    'scientific_name': 'col:scientificName',
    'authorship': 'col:authorship',
    'family': 'col:family',
}

# Metadatos de la versión que se conservan para el reporte.
METADATA_KEYS = ('key', 'alias', 'version', 'issued', 'doi')


class SourceFormatError(Exception):
    """El archivo no tiene la forma esperada de la exportación."""


@dataclass(frozen=True, slots=True)
class SourceRecord:
    """Una fila de la exportación, tal como viene (sin normalizar)."""

    id: str
    parent_id: str
    status: str
    rank: str
    scientific_name: str
    authorship: str
    family: str


@dataclass(slots=True)
class ReadStats:
    """Recuentos de la lectura."""

    rows: int = 0
    # Filas de otras familias (o sin familia). No se guardan una a una: son millones.
    other_family: int = 0
    metadata: dict[str, str] = field(default_factory=dict)


@contextmanager
def _open_text(path: Path) -> Iterator[tuple[IO[str], dict[str, str]]]:
    """Abre el TSV, dentro del zip o suelto, como texto, y lee los metadatos si los hay."""
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
            tsvs = [n for n in names if n.endswith('.tsv')]
            if len(tsvs) != 1:
                raise SourceFormatError(
                    f'El zip debe contener un único archivo .tsv y contiene {len(tsvs)}: '
                    f'{", ".join(names) or "(vacío)"}.'
                )
            metadata = {}
            if 'metadata.yaml' in names:
                metadata = parse_metadata(archive.read('metadata.yaml').decode('utf-8'))
            with archive.open(tsvs[0]) as raw:
                yield io.TextIOWrapper(raw, encoding='utf-8-sig', newline=''), metadata
    else:
        with path.open(encoding='utf-8-sig', newline='') as text:
            yield text, {}


def parse_metadata(text: str) -> dict[str, str]:
    """Lee las claves de primer nivel que interesan de ``metadata.yaml``.

    Solo hacen falta unos pocos valores escalares de primer nivel, así que basta con leer las
    líneas ``clave: valor`` sin sangría, sin depender de una biblioteca de YAML.
    """
    found: dict[str, str] = {}
    for line in text.splitlines():
        match = re.match(r'^([A-Za-z]+):\s*(.*?)\s*$', line)
        if match and match.group(1) in METADATA_KEYS and match.group(2):
            found[match.group(1)] = match.group(2).strip('\'"')
    return found


def read_family(path: Path, family: str, stats: ReadStats | None = None) -> Iterator[SourceRecord]:
    """Recorre la exportación y devuelve, en el orden del archivo, las filas de ``family``.

    Se comprueba que la columna ``col:family`` vale exactamente ``family``. En COL26.10 XR la
    traen rellena también los sinónimos y los rangos inferiores (comprobado: ninguna fila cuyo
    padre es de Orchidaceae tiene otra familia), así que no hace falta recorrer el árbol.
    La propia fila de la familia no se incluye: su columna ``col:family`` va vacía.
    """
    stats = stats if stats is not None else ReadStats()
    with _open_text(path) as (text, metadata):
        stats.metadata = metadata
        header = text.readline().rstrip('\r\n').split('\t')
        missing = [c for c in COLUMNS.values() if c not in header]
        if missing:
            raise SourceFormatError(
                f'Faltan columnas en la cabecera del TSV: {", ".join(missing)}.'
            )
        width = len(header)
        index = {key: header.index(column) for key, column in COLUMNS.items()}
        family_index = index['family']
        for line_number, line in enumerate(text, start=2):
            stats.rows += 1
            # Filtro rápido antes de partir la línea: casi todas las filas son de otra familia.
            if family not in line:
                stats.other_family += 1
                continue
            values = line.rstrip('\r\n').split('\t')
            if len(values) != width:
                raise SourceFormatError(
                    f'La línea {line_number} tiene {len(values)} campos y la cabecera {width}.'
                )
            if values[family_index] != family:
                stats.other_family += 1
                continue
            yield SourceRecord(**{key: values[i] for key, i in index.items()})
