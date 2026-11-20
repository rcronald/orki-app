"""Protección de ambiente y credenciales. Sin base de datos: ninguna de estas pruebas llega a
conectarse (las que conectan apuntan a un puerto local cerrado)."""

from __future__ import annotations

from pathlib import Path

import pytest

from catalog_import.cli import main
from catalog_import.target import (
    DEV_REF,
    PROD_REF,
    URL_VARIABLE,
    Environment,
    TargetError,
    parse_target,
    scrub,
)

from .conftest import SAMPLE

SECRET = 'Clave-Secreta-987'
DEV_DIRECT = f'postgresql://postgres:{SECRET}@db.{DEV_REF}.supabase.co:5432/postgres'
DEV_POOLER = (
    f'postgresql://postgres.{DEV_REF}:{SECRET}@aws-0-sa-east-1.pooler.supabase.com:5432/postgres'
)
PROD_DIRECT = f'postgresql://postgres:{SECRET}@db.{PROD_REF}.supabase.co:5432/postgres'
PROD_POOLER = (
    f'postgresql://postgres.{PROD_REF}:{SECRET}@aws-0-sa-east-1.pooler.supabase.com:6543/postgres'
)
LOCAL = f'postgresql://supabase_admin:{SECRET}@127.0.0.1:5432/orki'


@pytest.mark.parametrize(
    ('url', 'environment', 'ref'),
    [
        (LOCAL, Environment.LOCAL, None),
        ('postgresql://yo@localhost/orki', Environment.LOCAL, None),
        (f'postgresql://u:{SECRET}@[::1]:5433/orki?sslmode=disable', Environment.LOCAL, None),
        (DEV_DIRECT, Environment.DEV, DEV_REF),
        (DEV_POOLER, Environment.DEV, DEV_REF),
        (PROD_DIRECT, Environment.PROD, PROD_REF),
        (PROD_POOLER, Environment.PROD, PROD_REF),
    ],
)
def test_accepts_matching_target(url: str, environment: Environment, ref: str | None) -> None:
    target = parse_target(url, environment)
    assert target.project_ref == ref
    assert SECRET not in target.describe()
    if environment is not Environment.LOCAL:
        assert target.sslmode == 'require'


@pytest.mark.parametrize(
    ('url', 'environment', 'message'),
    [
        (DEV_DIRECT, Environment.LOCAL, 'apunta a Supabase'),
        (DEV_POOLER, Environment.LOCAL, 'apunta a Supabase'),
        ('postgresql://u:p@10.0.0.5/orki', Environment.LOCAL, 'no es de esta máquina'),
        ('postgresql://u:p@db.example.com/orki', Environment.LOCAL, 'no es de esta máquina'),
        (LOCAL, Environment.DEV, 'no apunta a un proyecto de Supabase'),
        (LOCAL, Environment.PROD, 'no apunta a un proyecto de Supabase'),
        (PROD_DIRECT, Environment.DEV, 'el proyecto de prod'),
        (PROD_POOLER, Environment.DEV, 'el proyecto de prod'),
        (DEV_DIRECT, Environment.PROD, 'el proyecto de dev'),
        (DEV_POOLER, Environment.PROD, 'el proyecto de dev'),
        (
            'postgresql://postgres:p@db.abcdefghijklmnopqrst.supabase.co/postgres',
            Environment.DEV,
            'no es de Orki',
        ),
        (
            f'postgresql://postgres.{DEV_REF}:p@db.{PROD_REF}.supabase.co/postgres',
            Environment.PROD,
            'proyectos de Supabase distintos',
        ),
        (f'{LOCAL}?host=db.{PROD_REF}.supabase.co', Environment.LOCAL, 'parámetro no admitido'),
        (f'{LOCAL}?hostaddr=10.0.0.5', Environment.LOCAL, 'parámetro no admitido'),
        ('mysql://u:p@localhost/orki', Environment.LOCAL, 'postgresql://'),
        ('postgresql://localhost/orki', Environment.LOCAL, 'usuario'),
        ('', Environment.LOCAL, URL_VARIABLE),
        (None, Environment.DEV, URL_VARIABLE),
    ],
)
def test_rejects_wrong_target(url: str | None, environment: Environment, message: str) -> None:
    with pytest.raises(TargetError) as error:
        parse_target(url, environment)
    assert message in str(error.value)
    assert SECRET not in str(error.value)
    assert 'p@' not in str(error.value)


def test_scrub_removes_password() -> None:
    target = parse_target(LOCAL, Environment.LOCAL)
    assert scrub(f'fallo con {SECRET} dentro', target) == 'fallo con *** dentro'


def run_cli(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    url: str | None,
    *args: str,
) -> tuple[int, str]:
    if url is None:
        monkeypatch.delenv(URL_VARIABLE, raising=False)
    else:
        monkeypatch.setenv(URL_VARIABLE, url)
    code = main(['cargar', str(SAMPLE), *args])
    captured = capsys.readouterr()
    return code, captured.out + captured.err


@pytest.mark.parametrize(
    ('url', 'args', 'message'),
    [
        (DEV_DIRECT, ('--ambiente', 'local'), 'apunta a Supabase'),
        (LOCAL, ('--ambiente', 'dev'), 'no apunta a un proyecto de Supabase'),
        (PROD_DIRECT, ('--ambiente', 'dev', '--escribir'), 'el proyecto de prod'),
        (PROD_DIRECT, ('--ambiente', 'prod', '--escribir'), '--confirmar-produccion'),
        (
            PROD_DIRECT,
            ('--ambiente', 'prod', '--escribir', '--confirmar-produccion', DEV_REF),
            '--confirmar-produccion',
        ),
        (
            DEV_DIRECT,
            ('--ambiente', 'dev', '--confirmar-produccion', PROD_REF),
            'solo se usa con --ambiente prod',
        ),
        (None, ('--ambiente', 'local'), f'Falta la variable de entorno {URL_VARIABLE}'),
    ],
)
def test_cli_refuses_before_connecting(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
    url: str | None,
    args: tuple[str, ...],
    message: str,
) -> None:
    report = tmp_path / 'r.csv'
    code, output = run_cli(monkeypatch, capsys, url, *args, '--reporte', str(report))
    assert code == 1
    assert message in output
    assert SECRET not in output
    assert not report.exists()


def test_cli_requires_environment(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    with pytest.raises(SystemExit) as error:
        run_cli(monkeypatch, capsys, LOCAL)
    assert error.value.code == 2
    assert SECRET not in capsys.readouterr().err


def test_connection_error_does_not_print_credentials(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    # Puerto 1 de la propia máquina: nadie escucha, la conexión falla enseguida.
    url = f'postgresql://supabase_admin:{SECRET}@127.0.0.1:1/orki'
    report = tmp_path / 'r.csv'
    code, output = run_cli(
        monkeypatch, capsys, url, '--ambiente', 'local', '--reporte', str(report)
    )
    assert code == 1
    assert 'no se ha escrito nada' in output
    assert SECRET not in output
    assert not report.exists()
