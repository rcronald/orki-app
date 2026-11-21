from __future__ import annotations

import os
import socket
from collections.abc import Iterator
from pathlib import Path
from typing import NoReturn

import pytest

from catalog_import.model import Catalog
from catalog_import.normalize import build_catalog
from catalog_import.reader import SourceRecord, read_family
from catalog_import.target import Target

from .basedatos import Server, cleanup_server, iterate, prepare_server, server_from_environment

DATA = Path(__file__).parent / 'data'
SAMPLE = DATA / 'muestra-col26.10xr.tsv'
EXPECTED = DATA / 'esperado-muestra.json'


@pytest.fixture(autouse=True)
def _no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    """Las pruebas no pueden usar la red: cualquier conexión falla."""

    def blocked(*_args: object, **_kwargs: object) -> NoReturn:
        raise RuntimeError('Las pruebas no pueden usar la red.')

    monkeypatch.setattr(socket.socket, 'connect', blocked)
    monkeypatch.setattr(socket.socket, 'connect_ex', blocked)


@pytest.fixture(autouse=True)
def _outside_github_actions(monkeypatch: pytest.MonkeyPatch) -> None:
    """Las pruebas se comportan igual en local y en el CI: sin las variables de GitHub Actions,
    la carga se identifica en la auditoría como local (las que prueban el workflow las ponen)."""
    for name in ('GITHUB_ACTIONS', 'GITHUB_RUN_ID', 'GITHUB_RUN_NUMBER', 'GITHUB_RUN_ATTEMPT'):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture(scope='session')
def sample_records() -> list[SourceRecord]:
    return list(read_family(SAMPLE, 'Orchidaceae'))


@pytest.fixture(scope='session')
def sample_catalog(sample_records: list[SourceRecord]) -> Catalog:
    return build_catalog(sample_records)


def record(
    id: str,
    parent_id: str,
    status: str,
    rank: str,
    name: str,
    authorship: str = '',
) -> SourceRecord:
    """Registro inventado para casos que la muestra real no cubre."""
    return SourceRecord(
        id=id,
        parent_id=parent_id,
        status=status,
        rank=rank,
        scientific_name=name,
        authorship=authorship,
        family='Orchidaceae',
    )


# Base de datos desechable (pruebas de integración de la carga) ----------------------------


@pytest.fixture(scope='session')
def db_server() -> Iterator[Server]:
    """Servidor de ORKI_TEST_DB_URL con una base plantilla que tiene todas las migraciones.

    Sin la variable, las pruebas que lo usan se saltan; en el CI (variable CI) fallan, para
    que no se salten sin que nadie lo vea.
    """
    target = server_from_environment()
    if target is None:
        if os.environ.get('CI'):
            pytest.fail('En el CI hace falta ORKI_TEST_DB_URL para las pruebas de la carga.')
        pytest.skip('Sin ORKI_TEST_DB_URL: se saltan las pruebas contra la base de datos.')
    server = prepare_server(target)
    try:
        yield server
    finally:
        cleanup_server(server)


@pytest.fixture
def db(db_server: Server) -> Iterator[Target]:
    """Una base nueva, copia de la plantilla, que se borra al terminar la prueba."""
    yield from iterate(db_server)
