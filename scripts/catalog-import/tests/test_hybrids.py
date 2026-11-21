"""Formato y validación de la lista curada de híbridos (sin base de datos)."""

from __future__ import annotations

from pathlib import Path

import pytest

from catalog_import.cli import main
from catalog_import.hybrids import HEADER, HybridList, read_hybrids

LIST = Path(__file__).resolve().parents[1] / 'data' / 'hibridos.csv'
HEADER_LINE = ','.join(HEADER)


def write(tmp_path: Path, *lines: str, header: str = HEADER_LINE, encoding: str = 'utf-8') -> Path:
    path = tmp_path / 'hibridos.csv'
    path.write_text('\n'.join((header, *lines)) + '\n', encoding=encoding)
    return path


def validate(tmp_path: Path, *lines: str, **kwargs: str) -> HybridList:
    return read_hybrids(write(tmp_path, *lines, **kwargs))


def codes(hybrids: HybridList) -> list[tuple[int, str, str]]:
    return [(p.row, p.column, p.code) for p in hybrids.problems]


GOOD = (
    'HIB-0001,Phalaenopsis Sogo Yukidian,Phalaenopsis,orquídea mariposa,'
    'Doritaenopsis Sogo Yukidian,sí,'
)


# El archivo versionado -----------------------------------------------------------------------


def test_versioned_list_is_valid() -> None:
    """El borrador tiene que pasar la validación de formato aunque no esté revisado."""
    hybrids = read_hybrids(LIST)
    assert hybrids.problems == ()
    assert len(hybrids.entries) >= 50
    assert len({e.ref for e in hybrids.entries}) == len(hybrids.entries)


def test_validate_command(capsys: pytest.CaptureFixture[str], tmp_path: Path) -> None:
    assert main(['validar-hibridos', str(LIST)]) == 0
    assert 'Sin errores de formato.' in capsys.readouterr().out

    bad = write(tmp_path, 'HIB-1,Phalaenopsis Doris,Phalaenopsis,,,sí,')
    assert main(['validar-hibridos', str(bad)]) == 1
    out = capsys.readouterr().out
    assert 'fila 2, columna id [ID_FORMATO]' in out
    assert 'no se carga nada' in out


# Lectura correcta -----------------------------------------------------------------------------


def test_reads_entries(tmp_path: Path) -> None:
    hybrids = validate(
        tmp_path,
        GOOD,
        'HIB-0002,Brassocattleya Binosa,× Brassocattleya,,,no,"Nota, con coma"',
        "HIB-0003,Vanda Robert's Delight,Vanda,,Vanda Robert's Delight 'Azul' | Ascocenda Robert's"
        ' Delight,sí,',
    )
    assert hybrids.problems == ()
    first, second, third = hybrids.entries
    assert first.ref == 'HIB-0001'
    assert first.row == 2
    assert first.common_names == ('orquídea mariposa',)
    assert first.other_names == ('Doritaenopsis Sogo Yukidian',)
    assert first.reviewed is True
    assert second.genus == '× Brassocattleya'
    assert second.notes == 'Nota, con coma'
    assert second.reviewed is False
    assert third.other_names == ("Vanda Robert's Delight 'Azul'", "Ascocenda Robert's Delight")
    assert hybrids.summary()['reviewed'] == 2


def test_bom_and_crlf_are_accepted(tmp_path: Path) -> None:
    path = tmp_path / 'hibridos.csv'
    path.write_bytes((chr(0xFEFF) + HEADER_LINE + '\r\n' + GOOD + '\r\n').encode())
    hybrids = read_hybrids(path)
    assert hybrids.problems == ()
    assert hybrids.entries[0].name == 'Phalaenopsis Sogo Yukidian'


# Errores del archivo ----------------------------------------------------------------------------


def test_not_utf8(tmp_path: Path) -> None:
    hybrids = validate(tmp_path, GOOD, 'HIB-0002,Cattleya Portia,Cattleya,orquídea,,sí,',
                       encoding='latin-1')  # fmt: skip
    assert codes(hybrids) == [(0, '', 'CODIFICACION')]
    assert 'línea 2' in hybrids.problems[0].message
    assert hybrids.entries == ()


def test_bom_in_the_middle(tmp_path: Path) -> None:
    assert codes(validate(tmp_path, chr(0xFEFF) + GOOD)) == [(0, '', 'CODIFICACION')]


def test_unclosed_quote(tmp_path: Path) -> None:
    hybrids = validate(tmp_path, GOOD, 'HIB-0002,Cattleya Portia,Cattleya,,,sí,"sin cerrar')
    assert [p.code for p in hybrids.problems] == ['COMILLAS']


@pytest.mark.parametrize(
    ('header', 'hint'),
    [
        ('id,nombre,genero,nombres_comunes,otros_nombres,revisado', False),
        ('id,genero,nombre,nombres_comunes,otros_nombres,revisado,notas', False),
        ('id;nombre;genero;nombres_comunes;otros_nombres;revisado;notas', True),
    ],
)
def test_wrong_header(tmp_path: Path, header: str, hint: bool) -> None:
    hybrids = validate(tmp_path, GOOD, header=header)
    assert codes(hybrids) == [(1, '', 'CABECERA')]
    assert ('punto y coma' in hybrids.problems[0].message) is hint


def test_empty_file(tmp_path: Path) -> None:
    path = tmp_path / 'hibridos.csv'
    path.write_bytes(b'')
    assert codes(read_hybrids(path)) == [(0, '', 'CABECERA')]


def test_empty_rows_and_wrong_column_count(tmp_path: Path) -> None:
    hybrids = validate(tmp_path, GOOD, ',,,,,,', '', 'HIB-0002,Cattleya Portia,Cattleya,,sí,')
    assert codes(hybrids) == [(3, '', 'FILA_VACIA'), (4, '', 'FILA_VACIA'), (5, '', 'COLUMNAS')]


def test_all_problems_are_reported_at_once(tmp_path: Path) -> None:
    hybrids = validate(
        tmp_path,
        'HIB-01,Phalaenopsis  Doris,Phalaenopsis,,,quizá,',
        'HIB-0002,Cattleya portia,Cattleya,,,sí,',
    )
    assert codes(hybrids) == [
        (2, 'id', 'ID_FORMATO'),
        (2, 'nombre', 'ESPACIOS'),
        (2, 'revisado', 'REVISADO'),
        (3, 'nombre', 'NOMBRE'),
    ]
    assert str(hybrids.problems[0]).startswith('fila 2, columna id [ID_FORMATO]')
    assert hybrids.entries == ()


# Errores de una celda ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ('line', 'expected'),
    [
        # Identificador.
        (',Phalaenopsis Doris,Phalaenopsis,,,sí,', ('id', 'VACIO')),
        ('hib-0001,Phalaenopsis Doris,Phalaenopsis,,,sí,', ('id', 'ID_FORMATO')),
        ('HIB-00001,Phalaenopsis Doris,Phalaenopsis,,,sí,', ('id', 'ID_FORMATO')),
        (' HIB-0001,Phalaenopsis Doris,Phalaenopsis,,,sí,', ('id', 'ESPACIOS')),
        # Espacios sobrantes, de no separación e invisibles.
        ('HIB-0001,Phalaenopsis Doris ,Phalaenopsis,,,sí,', ('nombre', 'ESPACIOS')),
        ('HIB-0001,Phalaenopsis\u00a0Doris,Phalaenopsis,,,sí,', ('nombre', 'ESPACIOS')),
        ('HIB-0001,Phalaenopsis Do\u200bris,Phalaenopsis,,,sí,', ('nombre', 'CARACTER')),
        ('HIB-0001,Phalaenopsis Doris,Phalaenopsis,,,sí,', None),
        # Signo de híbrido.
        ('HIB-0001,× Brassocattleya Binosa,× Brassocattleya,,,sí,', ('nombre', 'CARACTER')),
        ('HIB-0001,Brassocattleya Binosa,x Brassocattleya,,,sí,', ('genero', 'GENERO')),
        ('HIB-0001,Brassocattleya Binosa,×Brassocattleya,,,sí,', ('genero', 'GENERO')),
        ('HIB-0001,Brassocattleya Binosa,Brassocattleya,,,sí,', None),
        ('HIB-0001,Phalaenopsis Doris x Cassandra,Phalaenopsis,,,sí,', ('nombre', 'FORMULA')),
        # Género coherente con el nombre.
        ('HIB-0001,Phalaenopsis Doris,,,,sí,', ('genero', 'VACIO')),
        ('HIB-0001,Phalaenopsis Doris,Doritaenopsis,,,sí,', ('nombre', 'GENERO_DISTINTO')),
        ('HIB-0001,Phalaenopsis Doris,phalaenopsis,,,sí,', ('genero', 'GENERO')),
        ('HIB-0001,Phalaenopsis Doris,Phalaenopsis Doris,,,sí,', ('genero', 'GENERO')),
        # Forma del nombre aceptado.
        ('HIB-0001,Phalaenopsis,Phalaenopsis,,,sí,', ('nombre', 'NOMBRE')),
        ('HIB-0001,Phalaenopsis amabilis,Phalaenopsis,,,sí,', ('nombre', 'NOMBRE')),
        ("HIB-0001,Oncidium Sharry Baby 'Sweet Fragrance',Oncidium,,,sí,", ('nombre', 'NOMBRE')),
        ('HIB-0001,Vanda Robert\u2019s Delight,Vanda,,,sí,', ('nombre', 'CARACTER')),
        ('HIB-0001,"Vanda ""Robert"" Delight",Vanda,,,sí,', ('nombre', 'CARACTER')),
        ('HIB-0001,' + 'Phalaenopsis ' + 'A' * 100 + ',Phalaenopsis,,,sí,', ('nombre', 'LONGITUD')),
        # Listas de nombres.
        ('HIB-0001,Phalaenopsis Doris,Phalaenopsis,a || b,,sí,', ('nombres_comunes', 'LISTA')),
        ('HIB-0001,Phalaenopsis Doris,Phalaenopsis,a |,,sí,', ('nombres_comunes', 'LISTA')),
        ('HIB-0001,Phalaenopsis Doris,Phalaenopsis, a,,sí,', ('nombres_comunes', 'ESPACIOS')),
        ('HIB-0001,Phalaenopsis Doris,Phalaenopsis,a  b,,sí,', ('nombres_comunes', 'ESPACIOS')),
        ('HIB-0001,Phalaenopsis Doris,Phalaenopsis,,Dtps. × Doris,sí,',
         ('otros_nombres', 'CARACTER')),
        ('HIB-0001,Phalaenopsis Doris,Phalaenopsis,' + 'a' * 101 + ',,sí,',
         ('nombres_comunes', 'LONGITUD')),
        # Repetidos dentro de la entrada (sin distinguir mayúsculas).
        ('HIB-0001,Phalaenopsis Doris,Phalaenopsis,phalaenopsis doris,,sí,',
         ('nombres_comunes', 'REPETIDO_EN_ENTRADA')),
        ('HIB-0001,Phalaenopsis Doris,Phalaenopsis,,Doritis | doritis,sí,',
         ('otros_nombres', 'REPETIDO_EN_ENTRADA')),
        ('HIB-0001,Phalaenopsis Doris,Phalaenopsis,Doritis,DORITIS,sí,',
         ('otros_nombres', 'REPETIDO_EN_ENTRADA')),
        # Revisado.
        ('HIB-0001,Phalaenopsis Doris,Phalaenopsis,,,si,', ('revisado', 'REVISADO')),
        ('HIB-0001,Phalaenopsis Doris,Phalaenopsis,,,,', ('revisado', 'REVISADO')),
        ('HIB-0001,Phalaenopsis Doris,Phalaenopsis,,,no,' + 'n' * 501, ('notas', 'LONGITUD')),
    ],
)  # fmt: skip
def test_cell_problems(tmp_path: Path, line: str, expected: tuple[str, str] | None) -> None:
    found = [(p.column, p.code) for p in validate(tmp_path, line).problems]
    assert found == ([expected] if expected else [])


# Errores entre filas ---------------------------------------------------------------------------


def test_duplicates_across_rows(tmp_path: Path) -> None:
    hybrids = validate(
        tmp_path,
        'HIB-0001,Phalaenopsis Doris,Phalaenopsis,orquídea blanca,Doritis Doris,sí,',
        'HIB-0001,Phalaenopsis Cassandra,Phalaenopsis,,,sí,',
        'HIB-0003,Phalaenopsis DORIS,Phalaenopsis,,,sí,',
        # Un nombre común puede repetirse entre entradas; un sinónimo, no.
        'HIB-0004,Phalaenopsis Be Glad,Phalaenopsis,orquídea blanca,doritis doris,sí,',
        'HIB-0005,Phalaenopsis Mini Mark,Phalaenopsis,phalaenopsis cassandra,,sí,',
    )
    assert codes(hybrids) == [
        (3, 'id', 'ID_REPETIDO'),
        (4, 'nombre', 'NOMBRE_REPETIDO'),
        (5, 'otros_nombres', 'NOMBRE_REPETIDO'),
        (6, 'nombres_comunes', 'NOMBRE_REPETIDO'),
    ]
    assert 'fila 2' in hybrids.problems[1].message
    assert 'fila 3' in hybrids.problems[3].message


def test_genus_written_two_ways(tmp_path: Path) -> None:
    """El mismo género con y sin el signo «×» (o con otras mayúsculas) es un error."""
    hybrids = validate(
        tmp_path,
        'HIB-0001,Brassocattleya Binosa,× Brassocattleya,,,sí,',
        'HIB-0002,Brassocattleya Maikai,Brassocattleya,,,no,',
    )
    assert codes(hybrids) == [(3, 'genero', 'GENERO_ESCRITO_DISTINTO')]


# Carga: validación y protección antes de conectar ---------------------------------------------


def test_load_rejects_invalid_list_without_connecting(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # Una URL local que no existe: si se intentara conectar, fallaría con otro mensaje (y la
    # red está bloqueada en las pruebas).
    monkeypatch.setenv('ORKI_CATALOG_DB_URL', 'postgresql://nadie@127.0.0.1:1/nada')
    bad = write(tmp_path, 'HIB-0001,Phalaenopsis doris,Phalaenopsis,,,sí,')
    report = tmp_path / 'reporte.csv'
    code = main(['cargar-hibridos', str(bad), '--ambiente', 'local', '--reporte', str(report)])
    assert code == 1
    captured = capsys.readouterr()
    assert 'fila 2, columna nombre [NOMBRE]' in captured.out
    assert 'No se ha conectado a nada' in captured.err
    assert not report.exists()


def test_load_in_production_needs_confirmation(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv(
        'ORKI_CATALOG_DB_URL',
        'postgresql://postgres:clave@db.fzundhfxnbyjbxyhkgtg.supabase.co:5432/postgres',
    )
    code = main(['cargar-hibridos', str(LIST), '--ambiente', 'prod', '--escribir'])
    assert code == 1
    err = capsys.readouterr().err
    assert '--confirmar-produccion' in err
    assert 'clave' not in err


def test_load_refuses_url_of_another_environment(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv(
        'ORKI_CATALOG_DB_URL',
        'postgresql://postgres:clave@db.fzundhfxnbyjbxyhkgtg.supabase.co:5432/postgres',
    )
    assert main(['cargar-hibridos', str(LIST), '--ambiente', 'dev']) == 1
    assert 'No se ha conectado a nada' in capsys.readouterr().err
