"""Pruebas del resumen de cada carga en la auditoría del catálogo (#132) contra una base
desechable con todas las migraciones.

Necesitan ORKI_TEST_DB_URL, como las de la carga (test_load_db.py); sin ella se saltan.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest

from catalog_import.audit import ACTION, PINNED_SOURCE
from catalog_import.load import run_load

from .basedatos import catalog_state, connect, execute, rows
from .conftest import SAMPLE
from .test_hybrids_db import load_col, load_hybrids
from .test_load_db import TEST_AUDIT, load, select, total

LOCAL_ACTOR = re.compile(
    r'local:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
)
PINNED = json.loads(PINNED_SOURCE.read_text(encoding='utf-8'))


def audit_rows(db: Any) -> list[dict[str, Any]]:
    """Todas las filas de la auditoría, en orden, con sus columnas por nombre."""
    columns = (
        'id',
        'action_id',
        'actor',
        'action',
        'table_name',
        'row_id',
        'old_values',
        'new_values',
        'details',
    )
    found = rows(db, f'select {", ".join(columns)} from public.catalog_audit_log order by id')
    return [dict(zip(columns, row, strict=True)) for row in found]


def counts_from_report(report: list[dict[str, str]], *entities: str) -> dict[str, int]:
    return {
        key: sum(total(report, entity, outcome) for entity in entities)
        for key, outcome in (
            ('created', 'nuevo'),
            ('updated', 'actualizado'),
            ('unchanged', 'sin_cambios'),
        )
    }


# Carga del catálogo de COL ------------------------------------------------------------------


def test_write_leaves_exactly_one_summary(
    db: Any, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    code, report = load(db, tmp_path, monkeypatch)
    assert code == 0
    [row] = audit_rows(db)
    assert row['action'] == ACTION == 'catalog_import'
    assert LOCAL_ACTOR.fullmatch(row['actor'])
    assert (row['table_name'], row['row_id'], row['old_values'], row['new_values']) == (
        None,
        None,
        None,
        None,
    )
    assert row['details'] == {
        'load_type': 'catalogo',
        'environment': 'local',
        'source': {
            'name': 'Catalogue of Life',
            'alias': PINNED['alias'],
            'key': PINNED['clave'],
            'doi': PINNED['doi'],
            'published': PINNED['publicada'],
            'sha256': PINNED['sha256'],
            'file': SAMPLE.name,
            'file_sha256': row['details']['source']['file_sha256'],
            # La muestra no es la exportación fijada en fuente.json.
            'file_matches_pinned': False,
        },
        'counts': {
            'genera': {'created': 3, 'updated': 1, 'unchanged': 4},
            'species': {'created': 10, 'updated': 0, 'unchanged': 0},
            'species_names': {'created': 8, 'updated': 0, 'unchanged': 0},
        },
        'run': None,
    }
    assert re.fullmatch(r'[0-9a-f]{64}', row['details']['source']['file_sha256'])

    # El reporte y la salida dan el mismo identificador y el id de la acción.
    [audit] = select(report, entidad='carga', codigo='AUDITORIA')
    assert audit['nombre'] == row['actor']
    assert str(row['action_id']) in audit['detalle']
    out = capsys.readouterr().out
    assert row['actor'] in out
    assert str(row['action_id']) in out


def test_repeated_load_leaves_a_second_summary_without_changes(
    db: Any, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert load(db, tmp_path, monkeypatch, name='1.csv')[0] == 0
    code, report = load(db, tmp_path, monkeypatch, name='2.csv')
    assert code == 0
    first, second = audit_rows(db)
    assert first['actor'] != second['actor']
    assert first['action_id'] != second['action_id']
    assert second['details']['counts'] == {
        'genera': {'created': 0, 'updated': 0, 'unchanged': 8},
        'species': {'created': 0, 'updated': 0, 'unchanged': 10},
        'species_names': {'created': 0, 'updated': 0, 'unchanged': 8},
    }
    assert second['details']['counts']['species'] == counts_from_report(report, 'especie')


def test_simulation_leaves_no_record(
    db: Any, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    code, report = load(db, tmp_path, monkeypatch, write=False)
    assert code == 0
    assert audit_rows(db) == []
    [audit] = select(report, entidad='carga', codigo='AUDITORIA')
    assert 'se insertó y se revirtió' in audit['detalle']
    assert 'no queda registro' in capsys.readouterr().out


def test_failure_halfway_leaves_no_summary(
    db: Any, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # El resumen se inserta antes de escribir el catálogo; el fallo llega después.
    execute(
        db,
        """
        create function public.falla_a_mitad() returns trigger language plpgsql as $$
        begin
          if new.scientific_name = 'Phalaenopsis aphrodite' then
            raise exception 'fallo provocado';
          end if;
          return new;
        end $$;
        create trigger falla_a_mitad before insert on public.species
          for each row execute function public.falla_a_mitad();
        """,
    )
    code, _ = load(db, tmp_path, monkeypatch)
    assert code == 1
    assert audit_rows(db) == []


def test_load_rows_are_not_audited_one_by_one(db: Any, sample_catalog: Any) -> None:
    """Sin token de usuario, el disparador no registra las filas: solo queda el resumen,
    también si la carga se conecta con el rol postgres (el de Supabase), no superusuario."""
    with connect(db, autocommit=False) as conn:
        conn.execute('set role postgres')
        result = run_load(conn, sample_catalog, write=True, audit=TEST_AUDIT)
    [row] = audit_rows(db)
    assert (row['actor'], row['action']) == ('local:pruebas', ACTION)
    assert str(row['action_id']) == result.audit_action_id
    assert rows(db, "select count(*) from public.species where source = 'col'") == [(10,)]


# Sin la auditoría en la base ----------------------------------------------------------------


def drop_audit_function(db: Any) -> None:
    execute(db, 'drop function private.log_catalog_action(text, jsonb, text, uuid, text)')


def test_without_audit_function_write_is_refused_before_writing(
    db: Any, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    drop_audit_function(db)
    before = catalog_state(db)
    code, report = load(db, tmp_path, monkeypatch)
    assert code == 1
    assert report == []
    assert catalog_state(db) == before
    err = capsys.readouterr().err
    assert 'private.log_catalog_action()' in err
    assert '20261121140000_auditoria_del_catalogo.sql' in err
    assert 'No se ha escrito nada.' in err


def test_without_audit_function_simulation_warns(
    db: Any, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    drop_audit_function(db)
    code, report = load(db, tmp_path, monkeypatch, write=False)
    assert code == 0
    assert 'Con --escribir, esta carga se negaría.' in capsys.readouterr().out
    [audit] = select(report, entidad='carga', codigo='AUDITORIA')
    assert 'no tiene la auditoría' in audit['detalle']


# Identificador de la carga en GitHub Actions ------------------------------------------------


def test_github_actions_run_identifies_the_load(
    db: Any, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    commit = 'a' * 40
    for name, value in {
        'GITHUB_ACTIONS': 'true',
        'GITHUB_RUN_ID': '19876543210',
        'GITHUB_RUN_NUMBER': '42',
        'GITHUB_RUN_ATTEMPT': '2',
        'GITHUB_SHA': commit,
        'GITHUB_ACTOR': 'persona-de-prueba',
        'GITHUB_TRIGGERING_ACTOR': 'persona-de-prueba',
    }.items():
        monkeypatch.setenv(name, value)
    assert load(db, tmp_path, monkeypatch)[0] == 0
    [row] = audit_rows(db)
    assert row['actor'] == 'github-actions:19876543210:2'
    assert row['details']['run'] == {
        'github_run_id': 19876543210,
        'github_run_number': 42,
        'github_run_attempt': 2,
        'commit': commit,
    }
    assert 'persona-de-prueba' not in json.dumps(row, default=str)


def test_github_actions_without_run_id_connects_to_nothing(
    db: Any, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv('GITHUB_ACTIONS', 'true')
    before = catalog_state(db)
    code, report = load(db, tmp_path, monkeypatch)
    assert code == 1
    assert report == []
    assert catalog_state(db) == before
    assert 'No se ha conectado a nada.' in capsys.readouterr().err


# Carga de la lista curada de híbridos -------------------------------------------------------


def test_hybrids_write_leaves_one_summary(
    db: Any, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    load_col(db, tmp_path, monkeypatch)
    code, report = load_hybrids(db, tmp_path, monkeypatch)
    assert code == 0
    _, row = audit_rows(db)
    details = row['details']
    assert LOCAL_ACTOR.fullmatch(row['actor'])
    assert details['load_type'] == 'hibridos'
    assert details['environment'] == 'local'
    assert details['source'] == {
        'name': 'Lista curada de híbridos',
        'file': 'lista-reporte.csv',
        'sha256': details['source']['sha256'],
        'entries': 6,
        'reviewed': 5,
    }
    [source] = select(report, entidad='carga', codigo='FUENTE')
    assert details['source']['sha256'] in source['detalle']
    assert details['counts'] == {
        'genera': counts_from_report(report, 'genero'),
        'species': counts_from_report(report, 'especie'),
        'species_names': counts_from_report(report, 'sinonimo', 'nombre_comun'),
    }
    assert details['counts']['species']['created'] == 5
    assert details['counts']['species_names']['created'] == 4


def test_hybrids_simulation_leaves_no_record(
    db: Any, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    code, _ = load_hybrids(db, tmp_path, monkeypatch, write=False)
    assert code == 0
    assert audit_rows(db) == []
