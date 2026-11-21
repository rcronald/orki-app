import zipfile
from pathlib import Path

import pytest

from catalog_import.reader import ReadStats, SourceFormatError, parse_metadata, read_family

from .conftest import SAMPLE

METADATA = """---
key: 316691
doi: 10.48580/dgzlf
title: Catalogue of Life
alias: COL26.10 XR
description: "Texto largo\\
  \\ en varias líneas"
issued: 2026-10-16
version: 2026-10-16 XR
contact:
  given: Alguien
"""


def _zip(tmp_path: Path, members: dict[str, bytes]) -> Path:
    path = tmp_path / 'export.zip'
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in members.items():
            archive.writestr(name, content)
    return path


def test_reads_only_the_family_from_tsv() -> None:
    stats = ReadStats()
    records = list(read_family(SAMPLE, 'Orchidaceae', stats))
    assert stats.rows == 49
    # Tillandsia usneoides (Bromeliaceae) y la fila de la propia familia, que trae
    # col:family vacía.
    assert stats.other_family == 2
    assert len(records) == 47
    assert {r.family for r in records} == {'Orchidaceae'}
    assert 'DPL' not in {r.id for r in records}
    assert stats.metadata == {}


def test_keeps_raw_values() -> None:
    records = {r.id: r for r in read_family(SAMPLE, 'Orchidaceae')}
    synonym = records['7THCP']
    assert synonym.scientific_name == '  Cattleya   bullieri '
    assert synonym.authorship == 'Carrière  '
    assert synonym.parent_id == 'RWFC'
    assert records['7VX9T'].status == 'ambiguous synonym'


def test_reads_from_zip_with_metadata(tmp_path: Path) -> None:
    path = _zip(
        tmp_path,
        {'dataset-316691.tsv': SAMPLE.read_bytes(), 'metadata.yaml': METADATA.encode()},
    )
    stats = ReadStats()
    from_zip = list(read_family(path, 'Orchidaceae', stats))
    assert from_zip == list(read_family(SAMPLE, 'Orchidaceae'))
    assert stats.metadata == {
        'key': '316691',
        'doi': '10.48580/dgzlf',
        'alias': 'COL26.10 XR',
        'issued': '2026-10-16',
        'version': '2026-10-16 XR',
    }


def test_rejects_zip_without_single_tsv(tmp_path: Path) -> None:
    path = _zip(tmp_path, {'a.tsv': b'', 'b.tsv': b''})
    with pytest.raises(SourceFormatError, match=r'único archivo \.tsv'):
        list(read_family(path, 'Orchidaceae'))


def test_rejects_missing_columns(tmp_path: Path) -> None:
    path = tmp_path / 'malo.tsv'
    path.write_text('col:ID\tcol:status\nA\taccepted\n', encoding='utf-8')
    with pytest.raises(SourceFormatError, match=r'col:parentID.*col:family'):
        list(read_family(path, 'Orchidaceae'))


def test_rejects_rows_with_wrong_width(tmp_path: Path) -> None:
    lines = SAMPLE.read_text(encoding='utf-8').splitlines(keepends=True)
    # Una fila de la familia con un campo de más.
    broken = lines[2].rstrip('\n') + '\textra\n'
    path = tmp_path / 'roto.tsv'
    path.write_text(lines[0] + lines[3] + broken, encoding='utf-8')
    with pytest.raises(SourceFormatError, match='La línea 3'):
        list(read_family(path, 'Orchidaceae'))


def test_parse_metadata_ignores_nested_and_unknown_keys() -> None:
    assert parse_metadata('title: X\ncontact:\n  key: 1\nkey: 2\n') == {'key': '2'}
