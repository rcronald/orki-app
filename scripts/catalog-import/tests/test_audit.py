"""Pruebas sin base del identificador de la carga y de los recuentos de la auditoría (#132)."""

from __future__ import annotations

import getpass
import socket

import pytest

from catalog_import.audit import AuditError, load_actor, table_counts
from catalog_import.load import (
    COMMON_NAME,
    CONFLICT,
    GENUS,
    NEW,
    SPECIES,
    SYNONYM,
    UNCHANGED,
    UPDATED,
    Plan,
)


def test_local_actor_is_generated_and_anonymous() -> None:
    first, run = load_actor({'USER': 'alguien', 'HOSTNAME': 'maquina'})
    second, _ = load_actor({})
    assert run is None
    assert first.startswith('local:')
    assert first != second
    for personal in ('alguien', 'maquina', getpass.getuser(), socket.gethostname()):
        assert personal not in first


def test_github_actions_actor_comes_from_the_run() -> None:
    actor, run = load_actor(
        {
            'GITHUB_ACTIONS': 'true',
            'GITHUB_RUN_ID': '123',
            'GITHUB_RUN_NUMBER': '7',
            'GITHUB_ACTOR': 'alguien',
        }
    )
    assert actor == 'github-actions:123:1'
    assert run == {'github_run_id': 123, 'github_run_number': 7, 'github_run_attempt': 1}


@pytest.mark.parametrize('run_id', ['', 'abc', '12; drop'])
def test_github_actions_actor_needs_a_numeric_run(run_id: str) -> None:
    with pytest.raises(AuditError, match='GITHUB_RUN_ID'):
        load_actor({'GITHUB_ACTIONS': 'true', 'GITHUB_RUN_ID': run_id, 'GITHUB_RUN_NUMBER': '1'})


def test_counts_by_table() -> None:
    plan = Plan()
    plan.counts.update(
        {
            (GENUS, NEW): 2,
            (GENUS, UNCHANGED): 5,
            (SPECIES, UPDATED): 3,
            (SPECIES, CONFLICT): 9,
            (SYNONYM, NEW): 4,
            (COMMON_NAME, NEW): 1,
            (COMMON_NAME, UNCHANGED): 6,
        }
    )
    assert table_counts(plan) == {
        'genera': {'created': 2, 'updated': 0, 'unchanged': 5},
        'species': {'created': 0, 'updated': 3, 'unchanged': 0},
        'species_names': {'created': 5, 'updated': 0, 'unchanged': 6},
    }
