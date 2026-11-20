import json
from pathlib import Path

import pytest

from catalog_import.cli import main

from .conftest import EXPECTED, SAMPLE


def test_prints_summary(capsys: pytest.CaptureFixture[str]) -> None:
    assert main([str(SAMPLE)]) == 0
    out = capsys.readouterr().out
    for line in (
        'Filas leídas: 49',
        'Filas de otras familias (descartadas sin detalle): 2',
        'Registros de Orchidaceae: 47',
        'Géneros: 8',
        '  de ellos, nothogéneros (×): 2',
        'Especies aceptadas: 10',
        '  de ellas, híbridos: 4',
        'Sinónimos: 8',
        '  de ellos, ambiguos: 1',
        '  de ellos, reasignados desde un rango inferior: 2',
        'Descartes por motivo (total 21):',
        '  FORMULA_HIBRIDA: 3',
        '  MAL_APLICADO: 1',
        '  PROVISIONAL: 2',
        '  SIN_RANGO: 2',
        'Ajustes por motivo (total 5):',
        '  SINONIMO_REASIGNADO: 2',
    ):
        assert line in out.splitlines()


def test_output_file_matches_expected_and_is_stable(tmp_path: Path) -> None:
    first, second = tmp_path / 'a.json', tmp_path / 'b.json'
    assert main([str(SAMPLE), '--salida', str(first)]) == 0
    assert main([str(SAMPLE), '--salida', str(second)]) == 0
    assert first.read_bytes() == second.read_bytes()
    assert json.loads(first.read_text(encoding='utf-8')) == json.loads(
        EXPECTED.read_text(encoding='utf-8')
    )


def test_missing_file(tmp_path: Path) -> None:
    with pytest.raises(SystemExit) as error:
        main([str(tmp_path / 'no-existe.zip')])
    assert error.value.code == 2


def test_format_error(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    path = tmp_path / 'malo.tsv'
    path.write_text('col:ID\n', encoding='utf-8')
    assert main([str(path)]) == 1
    assert 'Error de formato' in capsys.readouterr().err
