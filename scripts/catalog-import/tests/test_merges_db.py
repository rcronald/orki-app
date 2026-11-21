"""Pruebas de la carga después de una fusión de especies (#137, parte de #21) contra una base
desechable con todas las migraciones.

La fusión se hace de verdad, con ``public.merge_species()`` como un administrador del catálogo
(rol ``authenticated`` y las claims del token en ``request.jwt.claims``, como en
``supabase/tests/fusion_especies.sql``), y después se vuelve a cargar.

Necesitan ORKI_TEST_DB_URL, como las de la carga (test_load_db.py); sin ella se saltan.
"""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path
from typing import Any

import pytest

from catalog_import.audit import ACTION
from catalog_import.load import (
    MERGED,
    SPECIES,
    LoadResult,
    merges_ready,
    plan_load,
    read_snapshot,
)
from catalog_import.model import Catalog, Species
from catalog_import.target import Target

from .basedatos import catalog_state, connect, execute, rows
from .test_audit_db import audit_rows
from .test_hybrids_db import BASE_ROWS, load_col, load_hybrids
from .test_load_db import load, names_of, run_catalog, select, species, total

ADMIN_CLAIMS = {'sub': 'user_admin', 'role': 'authenticated', 'app_role': 'catalog_admin'}


def merge(db: Target, merged_name: str, kept_name: str) -> tuple[Any, ...]:
    """Fusiona ``merged_name`` en ``kept_name`` como un administrador del catálogo."""
    merged_id, kept_id = species(db, merged_name)[0], species(db, kept_name)[0]
    with connect(db) as conn, conn.transaction():
        conn.execute('set local role authenticated')
        conn.execute(
            "select set_config('request.jwt.claims', %s, true)", (json.dumps(ADMIN_CLAIMS),)
        )
        row = conn.execute(
            'select * from public.merge_species(%s, %s)', (merged_id, kept_id)
        ).fetchone()
    assert row is not None
    return row


def with_synonyms(catalog: Catalog, changes: dict[str, tuple[str, ...]]) -> Catalog:
    """El catálogo con los sinónimos de algunas especies (por clave) añadidos."""
    template = next(sp for sp in catalog.species if sp.synonyms).synonyms[0]

    def changed(sp: Species) -> Species:
        extra = tuple(
            dataclasses.replace(template, name=name, source_ref=f'{sp.source_ref}-S{i}')
            for i, name in enumerate(changes.get(sp.source_ref, ()))
        )
        return dataclasses.replace(sp, synonyms=sp.synonyms + extra)

    return dataclasses.replace(catalog, species=tuple(changed(sp) for sp in catalog.species))


def import_summaries(db: Target) -> list[dict[str, Any]]:
    """Los resúmenes de las cargas en la auditoría (la fusión deja además los suyos)."""
    return [r for r in audit_rows(db) if r['action'] == ACTION]


def plan_rows(result: LoadResult, **filters: str) -> list[Any]:
    return [
        r
        for r in result.plan.rows
        if all(getattr(r, key) == value for key, value in filters.items())
    ]


# Carga de COL -------------------------------------------------------------------------------


def test_reload_after_merge_does_not_recreate_the_absorbed_species(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    assert load(db, tmp_path, monkeypatch, name='1.csv')[0] == 0
    merge(db, 'Phalaenopsis aphrodite', 'Phalaenopsis amabilis')
    kept = species(db, 'Phalaenopsis amabilis')
    assert kept[4] == 'validated'  # La fusión la validó.
    before = catalog_state(db)
    capsys.readouterr()

    code, report = load(db, tmp_path, monkeypatch, name='2.csv')
    assert code == 0
    # Nada cambia: ni se recrea la absorbida ni se toca la conservada.
    assert catalog_state(db) == before
    assert rows(db, "select count(*) from public.species where source_ref = '4FR2M'") == [(0,)]

    [row] = select(report, entidad='especie', resultado=MERGED)
    assert (row['codigo'], row['source_ref'], row['nombre'], row['id_base']) == (
        'ESPECIE_FUSIONADA',
        '4FR2M',
        'Phalaenopsis aphrodite',
        str(kept[0]),
    )
    assert '«Phalaenopsis amabilis»' in row['detalle']
    assert 'validated' in row['detalle']
    assert total(report, 'especie', MERGED) == 1
    assert total(report, 'especie', 'nuevo') == 0
    assert total(report, 'especie', 'sin_cambios') == 9
    # Ni la absorbida sale como «no en la fuente».
    assert not select(report, codigo='ESPECIE_NO_EN_FUENTE')
    [fusions] = select(report, entidad='carga', codigo='FUSIONES')
    assert fusions['nombre'] == '1 claves en la memoria'
    assert '1 registros omitidos por fusión' in fusions['detalle']

    out = capsys.readouterr().out
    assert (
        'Especies: 0 nuevos, 0 actualizados, 9 sin cambios, 0 en conflicto, 1 omitidos por fusión'
        in out
    )
    assert 'Fusiones: 1 claves de esta fuente en la memoria de las fusiones; 1 registros' in out

    # El resumen de la auditoría también los cuenta.
    summary = import_summaries(db)[-1]
    assert summary['details']['omitted_by_merge'] == 1
    assert summary['details']['counts']['species'] == {'created': 0, 'updated': 0, 'unchanged': 9}


def test_names_of_an_absorbed_record_go_to_the_kept_species_without_duplicates(
    db: Target, sample_catalog: Catalog
) -> None:
    first = with_synonyms(
        sample_catalog,
        {'4FR2M': ('Phalaenopsis sanderiana', 'Cymbidium amabile')},
    )
    run_catalog(db, first)
    merge(db, 'Phalaenopsis aphrodite', 'Phalaenopsis amabilis')
    after_merge = names_of(db, 'Phalaenopsis amabilis')
    assert after_merge == [
        ('Cymbidium amabile', 'synonym'),
        ('Epidendrum amabile', 'synonym'),
        ('Phalaenopsis amabilis var. moluccana', 'synonym'),
        ('Phalaenopsis aphrodite', 'synonym'),
        ('Phalaenopsis celebica', 'synonym'),
        ('Phalaenopsis sanderiana', 'synonym'),
    ]
    kept = species(db, 'Phalaenopsis amabilis')

    # La nueva versión de la fuente trae, para la absorbida: los que ya pasaron, uno igual
    # solo sin tildes (lo que compara la fusión), otro igual solo en minúsculas (lo que compara
    # el índice), uno igual sin el «×», uno nuevo y uno que la conservada también trae nuevo.
    # Además le cambia el tipo: da igual, la absorbida no se crea ni se actualiza.
    second = with_synonyms(
        sample_catalog,
        {
            '4FR2M': (
                'Phalaenopsis sanderiana',
                'Cymbidium amabile',
                'Cymbidium amábile',
                'PHALAENOPSIS CELEBICA',
                'Phalaenopsis × sanderiana',
                'Doritis nueva',
                'Kingidium nuevo',
            ),
            '4FR2J': ('Kingidium nuevo',),
        },
    )
    second = dataclasses.replace(
        second,
        species=tuple(
            dataclasses.replace(sp, type='hybrid') if sp.source_ref == '4FR2M' else sp
            for sp in second.species
        ),
    )
    result = run_catalog(db, second)

    assert sorted(names_of(db, 'Phalaenopsis amabilis')) == sorted(
        [*after_merge, ('Doritis nueva', 'synonym'), ('Kingidium nuevo', 'synonym')]
    )
    # La conservada no cambia (ni su estado ni sus datos) y la absorbida no vuelve.
    assert species(db, 'Phalaenopsis amabilis') == kept
    assert rows(db, "select count(*) from public.species where source_ref = '4FR2M'") == [(0,)]

    absorbed = {r.name: r for r in plan_rows(result, species='Phalaenopsis aphrodite (4FR2M)')}
    assert {name: (r.result, r.code) for name, r in absorbed.items()} == {
        'Phalaenopsis aphrodite': ('sin_cambios', 'NOMBRE_EN_LA_CONSERVADA'),
        'Phalaenopsis sanderiana': ('sin_cambios', 'NOMBRE_EN_LA_CONSERVADA'),
        'Cymbidium amabile': ('sin_cambios', 'NOMBRE_EN_LA_CONSERVADA'),
        'Cymbidium amábile': ('sin_cambios', 'NOMBRE_EN_LA_CONSERVADA'),
        'PHALAENOPSIS CELEBICA': ('sin_cambios', 'NOMBRE_EN_LA_CONSERVADA'),
        'Phalaenopsis × sanderiana': ('sin_cambios', 'NOMBRE_EN_LA_CONSERVADA'),
        'Doritis nueva': ('nuevo', 'NOMBRE_A_LA_CONSERVADA'),
        'Kingidium nuevo': ('sin_cambios', 'NOMBRE_EN_LA_CONSERVADA'),
    }
    assert '«Cymbidium amabile» (sinónimo)' in absorbed['Cymbidium amábile'].detail
    assert 'que añade esta carga' in absorbed['Kingidium nuevo'].detail
    assert result.plan.counts[(SPECIES, MERGED)] == 1
    assert result.applied.names_inserted == 2
    assert result.applied.species_inserted == result.applied.species_updated == 0

    # Repetirla no cambia nada.
    before = catalog_state(db)
    again = run_catalog(db, second)
    assert catalog_state(db) == before
    assert again.applied.names_inserted == 0


def test_absorbed_name_with_a_new_key_is_a_conflict(db: Target, sample_catalog: Catalog) -> None:
    run_catalog(db, sample_catalog)
    merge(db, 'Phalaenopsis aphrodite', 'Phalaenopsis amabilis')
    # COL le cambia la clave a la absorbida: la memoria no la conoce, pero el nombre sí.
    changed = with_synonyms(sample_catalog, {'4FR2M': ('Doritis nueva',)})
    changed = dataclasses.replace(
        changed,
        species=tuple(
            dataclasses.replace(sp, source_ref='NUEVA') if sp.source_ref == '4FR2M' else sp
            for sp in changed.species
        ),
    )
    before = catalog_state(db)
    result = run_catalog(db, changed)
    assert catalog_state(db) == before
    [conflict] = plan_rows(result, code='NOMBRE_FUSIONADO')
    assert (conflict.result, conflict.source_ref) == ('conflicto', 'NUEVA')
    assert 'clave 4FR2M' in conflict.detail
    [rejected] = plan_rows(result, name='Doritis nueva')
    assert rejected.code == 'SINONIMO_SIN_ESPECIE'
    assert result.plan.counts[(SPECIES, MERGED)] == 0


def test_species_recreated_before_the_memory_is_left_alone(
    db: Target, sample_catalog: Catalog
) -> None:
    run_catalog(db, sample_catalog)
    merge(db, 'Phalaenopsis aphrodite', 'Phalaenopsis amabilis')
    # Una carga anterior a #137 la volvió a crear (con otro nombre, porque el absorbido ya es
    # sinónimo de la conservada y la búsqueda los confundiría).
    execute(
        db,
        'insert into public.species (scientific_name, genus_id, type, status, source, source_ref) '
        "select 'Phalaenopsis aphrodite recreada', genus_id, 'species', 'imported', 'col', '4FR2M' "
        "from public.species where scientific_name = 'Phalaenopsis amabilis'",
    )
    before = catalog_state(db)
    result = run_catalog(db, sample_catalog)
    assert catalog_state(db) == before
    [row] = plan_rows(result, code='ESPECIE_FUSIONADA')
    assert 'Phalaenopsis aphrodite recreada' in row.detail
    assert 'fusiónala otra vez' in row.detail
    assert not plan_rows(result, code='ESPECIE_NO_EN_FUENTE')


# Sin fusiones: el mismo resultado que antes -------------------------------------------------


def test_without_merges_the_plan_is_the_same(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, sample_catalog: Catalog
) -> None:
    """Con la memoria vacía, el plan es el mismo que sin el concepto de fusión (la memoria
    leída como vacía, que es lo que hacía la carga antes de #137), y el reporte y el resumen
    no tienen nada de fusiones."""
    assert load(db, tmp_path, monkeypatch, name='1.csv')[0] == 0
    code, report = load(db, tmp_path, monkeypatch, name='2.csv', write=False)
    assert code == 0
    assert not select(report, codigo='FUSIONES')
    assert not select(report, resultado=MERGED)
    assert all(not r['nombre'].endswith(MERGED) for r in select(report, codigo='TOTAL'))

    with connect(db, autocommit=False) as conn:
        snapshot = read_snapshot(conn)
        conn.rollback()
    assert snapshot.merge_keys == {}
    result = run_catalog(db, sample_catalog, write=False)
    assert result.merges_ready
    assert result.merge_keys == 0
    assert result.plan.rows == plan_load(sample_catalog, snapshot).rows

    # Una clave de otra fuente (la lista curada) no cambia nada en la carga de COL.
    load_hybrids(db, tmp_path, monkeypatch, name='h1.csv')
    code, before_merge = load(db, tmp_path, monkeypatch, name='3.csv', write=False)
    assert code == 0
    merge(db, 'Oncidium Sharry Baby', 'Phalaenopsis Sogo Yukidian')
    code, after_merge = load(db, tmp_path, monkeypatch, name='4.csv', write=False)
    assert code == 0
    assert not select(after_merge, codigo='FUSIONES')
    # Los géneros sí cambian (Oncidium tiene una especie menos), pero no por la carga.
    assert [r for r in after_merge if r['entidad'] in ('especie', 'sinonimo')] == [
        r for r in before_merge if r['entidad'] in ('especie', 'sinonimo')
    ]


# Sin la memoria en la base ------------------------------------------------------------------


def drop_merge_memory(db: Target) -> None:
    execute(
        db,
        'drop function public.merge_species(uuid, uuid); '
        'drop function public.preview_species_merge(uuid, uuid); '
        'drop table public.species_merge_keys',
    )


def test_without_merge_memory_write_is_refused_before_writing(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    drop_merge_memory(db)
    before = catalog_state(db)
    code, report = load(db, tmp_path, monkeypatch)
    assert code == 1
    assert report == []
    assert catalog_state(db) == before
    assert audit_rows(db) == []
    err = capsys.readouterr().err
    assert 'public.species_merge_keys' in err
    assert '20261121160000_fusion_de_especies.sql' in err
    assert 'No se ha escrito nada.' in err

    code, report = load_hybrids(db, tmp_path, monkeypatch, name='h.csv')
    assert code == 1
    assert catalog_state(db) == before


def test_without_merge_memory_simulation_warns(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    drop_merge_memory(db)
    code, report = load(db, tmp_path, monkeypatch, write=False)
    assert code == 0
    out = capsys.readouterr().out
    assert 'public.species_merge_keys' in out
    assert 'Con --escribir, esta carga se negaría.' in out
    [row] = select(report, entidad='carga', codigo='FUSIONES')
    assert row['nombre'] == 'sin memoria'
    assert total(report, 'especie', 'nuevo') == 10


def test_memory_hidden_by_rls_is_not_ready(db: Target) -> None:
    """Un usuario al que se aplica RLS leería una memoria vacía: no cuenta como lista."""
    with connect(db, autocommit=False) as conn:
        conn.execute('set role postgres')
        assert merges_ready(conn)
        conn.execute('set role authenticated')
        assert not merges_ready(conn)
        conn.rollback()


# Carga de la lista curada de híbridos -------------------------------------------------------


def test_hybrids_reload_after_merge(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    load_col(db, tmp_path, monkeypatch)
    assert load_hybrids(db, tmp_path, monkeypatch, name='1.csv')[0] == 0
    merge(db, 'Oncidium Sharry Baby', 'Phalaenopsis Sogo Yukidian')
    after_merge = names_of(db, 'Phalaenopsis Sogo Yukidian')
    assert after_merge == [
        ('Doritaenopsis Sogo Yukidian', 'synonym'),
        ('Oncidium Sharry Baby', 'synonym'),
        ("Oncidium Sharry Baby 'Sweet Fragrance'", 'synonym'),
        ('orquídea chocolate', 'common'),
        ('orquídea mariposa blanca', 'common'),
    ]
    before = catalog_state(db)

    # La lista no cambia: nada se recrea ni se duplica.
    code, report = load_hybrids(db, tmp_path, monkeypatch, name='2.csv')
    assert code == 0
    assert catalog_state(db) == before
    [row] = select(report, entidad='especie', resultado=MERGED)
    assert (row['codigo'], row['source_ref']) == ('ESPECIE_FUSIONADA', 'HIB-0002')
    assert total(report, 'especie', MERGED) == 1
    assert total(report, 'especie', 'sin_cambios') == 4
    assert not select(report, codigo='ENTRADA_NO_EN_LISTA')

    # La fila absorbida trae ahora el nombre común sin tilde y en mayúsculas (ya está, tras
    # normalizar) y uno nuevo, y la lista la corrige a otro género y otro nombre: la entrada
    # no se crea (ni su género, que no está en la base), y el nombre nuevo pasa a ser un
    # sinónimo de la conservada.
    changed = tuple(
        'HIB-0002,Aliceara Sharry Baby,Aliceara,ORQUIDEA CHOCOLATE|chocolate,,sí,'
        if line.startswith('HIB-0002,')
        else line
        for line in BASE_ROWS
    )
    code, report = load_hybrids(db, tmp_path, monkeypatch, changed, name='3.csv')
    assert code == 0
    assert sorted(names_of(db, 'Phalaenopsis Sogo Yukidian')) == sorted(
        [*after_merge, ('Aliceara Sharry Baby', 'synonym'), ('chocolate', 'common')]
    )
    assert rows(db, "select count(*) from public.genera where name = 'Aliceara'") == [(0,)]
    assert rows(db, "select count(*) from public.species where source_ref = 'HIB-0002'") == [(0,)]
    [row] = select(report, entidad='especie', source_ref='HIB-0002')
    assert (row['resultado'], row['nombre']) == (MERGED, 'Aliceara Sharry Baby')
    by_name = {
        r['nombre']: (r['entidad'], r['resultado'], r['codigo'])
        for r in report
        if r['source_ref'] == 'HIB-0002' and r['entidad'] != 'especie'
    }
    assert by_name == {
        'Aliceara Sharry Baby': ('sinonimo', 'nuevo', 'NOMBRE_A_LA_CONSERVADA'),
        'chocolate': ('nombre_comun', 'nuevo', 'NOMBRE_A_LA_CONSERVADA'),
        # Las filas sin cambios no van al CSV (sin --detalle-sin-cambios).
    }
    code, detailed = load_hybrids(
        db, tmp_path, monkeypatch, changed, name='4.csv', extra=('--detalle-sin-cambios',)
    )
    assert code == 0
    [same] = select(detailed, source_ref='HIB-0002', nombre='ORQUIDEA CHOCOLATE')
    assert (same['resultado'], same['codigo']) == ('sin_cambios', 'NOMBRE_EN_LA_CONSERVADA')
    assert '«orquídea chocolate» (nombre común)' in same['detalle']
    assert not select(report, entidad='genero', nombre='Aliceara')
    # Cargas: COL, 1.csv, 2.csv, 3.csv y 4.csv; la de 3.csv es la que añade los nombres.
    summary = import_summaries(db)[3]
    assert summary['details']['omitted_by_merge'] == 1
    assert summary['details']['counts']['species_names']['created'] == 2


def test_hybrid_absorbed_and_not_reviewed_is_only_omitted(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert load_hybrids(db, tmp_path, monkeypatch, name='1.csv')[0] == 0
    merge(db, 'Oncidium Sharry Baby', 'Phalaenopsis Sogo Yukidian')
    pending = tuple(
        line.replace(',sí,', ',no,') if line.startswith('HIB-0002,') else line for line in BASE_ROWS
    )
    code, report = load_hybrids(db, tmp_path, monkeypatch, pending, name='2.csv')
    assert code == 0
    omitted = {r['source_ref']: r for r in select(report, resultado='omitido')}
    assert 'se fusionó en «Phalaenopsis Sogo Yukidian»' in omitted['HIB-0002']['detalle']
    assert total(report, 'especie', MERGED) == 0
