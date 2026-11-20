from __future__ import annotations

import socket
from pathlib import Path
from typing import NoReturn

import pytest

from catalog_import.model import Catalog
from catalog_import.normalize import build_catalog
from catalog_import.reader import SourceRecord, read_family

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
