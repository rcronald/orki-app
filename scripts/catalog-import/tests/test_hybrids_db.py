"""Pruebas de integración de la carga de la lista curada de híbridos contra una base desechable.

Necesitan ORKI_TEST_DB_URL, como las de la carga de COL (test_load_db.py); sin ella se saltan.
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

import pytest

from catalog_import.cli import main
from catalog_import.hybrids import HEADER
from catalog_import.target import Target

from .basedatos import catalog_state, execute, rows, url_of
from .conftest import SAMPLE
from .test_load_db import names_of, select, species, total

BASE_ROWS = (
    'HIB-0001,Phalaenopsis Sogo Yukidian,Phalaenopsis,orquídea mariposa blanca,'
    'Doritaenopsis Sogo Yukidian,sí,',
    'HIB-0002,Oncidium Sharry Baby,Oncidium,orquídea chocolate,'
    "Oncidium Sharry Baby 'Sweet Fragrance',sí,",
    # Género sin el signo en la lista; en la base (tras la importación de COL) va con él.
    'HIB-0003,Brassocattleya Binosa,Brassocattleya,,,sí,',
    # Género con el signo en la lista; en la base (migración de abreviaturas) va sin él.
    'HIB-0004,Laeliocattleya Mini Purple,× Laeliocattleya,,,sí,',
    # Género que no está en la base: se crea.
    'HIB-0005,Burrageara Nelly Isler,Burrageara,,,sí,',
    # Sin revisar: no se carga.
    'HIB-0006,Cattleya Bow Bells,Cattleya,,,no,Pendiente de revisar.',
)


def write_list(tmp_path: Path, *lines: str, name: str = 'hibridos.csv') -> Path:
    path = tmp_path / name
    path.write_text('\n'.join((','.join(HEADER), *lines)) + '\n', encoding='utf-8')
    return path


def load_hybrids(
    db: Target,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    lines: tuple[str, ...] = BASE_ROWS,
    *,
    write: bool = True,
    name: str = 'reporte.csv',
    extra: tuple[str, ...] = (),
) -> tuple[int, list[dict[str, str]]]:
    """Ejecuta «orki-catalogo cargar-hibridos» y devuelve el código y el reporte."""
    monkeypatch.setenv('ORKI_CATALOG_DB_URL', url_of(db))
    report = tmp_path / name
    source = write_list(tmp_path, *lines, name=f'lista-{name}')
    args = ['cargar-hibridos', str(source), '--ambiente', 'local', '--reporte', str(report), *extra]
    if write:
        args.append('--escribir')
    code = main(args)
    if not report.exists():
        return code, []
    with report.open(encoding='utf-8-sig', newline='') as handle:
        return code, list(csv.DictReader(handle))


def load_col(db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv('ORKI_CATALOG_DB_URL', url_of(db))
    report = tmp_path / 'col.csv'
    assert main(['cargar', str(SAMPLE), '--ambiente', 'local', '--escribir', '--reporte',
                 str(report)]) == 0  # fmt: skip


def curated(db: Target) -> list[tuple[Any, ...]]:
    return rows(
        db,
        'select s.source_ref, s.scientific_name, g.name, s.type::text, s.status::text '
        'from public.species s join public.genera g on g.id = s.genus_id '
        "where s.source = 'curated' order by s.source_ref",
    )


def rows_of(db: Target, table: str, ids: list[Any]) -> list[tuple[Any, ...]]:
    return rows(db, f'select * from public.{table} where id = any(%s) order by id', (ids,))


# Carga --------------------------------------------------------------------------------------


def test_loads_reviewed_entries(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    load_col(db, tmp_path, monkeypatch)
    genera_before = rows(db, 'select id, name from public.genera order by id')
    code, report = load_hybrids(db, tmp_path, monkeypatch, extra=('--detalle-sin-cambios',))
    assert code == 0

    assert curated(db) == [
        ('HIB-0001', 'Phalaenopsis Sogo Yukidian', 'Phalaenopsis', 'hybrid', 'validated'),
        ('HIB-0002', 'Oncidium Sharry Baby', 'Oncidium', 'hybrid', 'validated'),
        ('HIB-0003', 'Brassocattleya Binosa', '× Brassocattleya', 'hybrid', 'validated'),
        ('HIB-0004', 'Laeliocattleya Mini Purple', 'Laeliocattleya', 'hybrid', 'validated'),
        ('HIB-0005', 'Burrageara Nelly Isler', 'Burrageara', 'hybrid', 'validated'),
    ]
    assert names_of(db, 'Phalaenopsis Sogo Yukidian') == [
        ('Doritaenopsis Sogo Yukidian', 'synonym'),
        ('orquídea mariposa blanca', 'common'),
    ]
    assert rows(
        db,
        "select count(*) from public.species_names where type = 'common' and language is null",
    ) == [(2,)]

    # Los géneros existentes no se renombran: solo se crea Burrageara.
    genera_after = rows(db, 'select id, name from public.genera order by id')
    assert sorted(set(genera_after) - set(genera_before), key=str) == [
        (rows(db, "select id from public.genera where name = 'Burrageara'")[0][0], 'Burrageara')
    ]
    [new_genus] = select(report, entidad='genero', resultado='nuevo')
    assert new_genus['codigo'] == 'GENERO_NUEVO'
    assert new_genus['nombre'] == 'Burrageara'
    spelled = {
        r['nombre']: r['detalle'] for r in select(report, entidad='genero', resultado='sin_cambios')
    }
    assert '«× Brassocattleya»' in spelled['Brassocattleya']
    assert '«Laeliocattleya»' in spelled['× Laeliocattleya']

    # La no revisada sale como omitida y no se carga.
    [omitted] = select(report, resultado='omitido')
    assert (omitted['codigo'], omitted['source_ref']) == ('NO_REVISADA', 'HIB-0006')
    assert rows(db, "select count(*) from public.species where scientific_name = "
                "'Cattleya Bow Bells'") == [(0,)]  # fmt: skip

    assert total(report, 'especie', 'nuevo') == 5
    assert total(report, 'nombre_comun', 'nuevo') == 2
    assert total(report, 'sinonimo', 'nuevo') == 2
    assert select(report, entidad='carga', codigo='FUENTE')[0]['nombre'] == (
        'Lista curada de híbridos'
    )
    recount = {r['nombre']: r['detalle'] for r in select(report, codigo='RECUENTO')}
    assert recount['especies de la lista curada'] == '5'

    # El autocompletado los encuentra como híbridos, también por la abreviatura y por el
    # nombre común.
    assert rows(
        db,
        "select scientific_name, type::text from public.search_species('bc binosa') limit 1",
    ) == [('Brassocattleya Binosa', 'hybrid')]
    assert rows(
        db, "select scientific_name from public.search_species('orquídea chocolate') limit 1"
    ) == [('Oncidium Sharry Baby',)]


def test_second_load_changes_nothing(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert load_hybrids(db, tmp_path, monkeypatch, name='1.csv')[0] == 0
    before = catalog_state(db)
    code, report = load_hybrids(db, tmp_path, monkeypatch, name='2.csv')
    assert code == 0
    assert catalog_state(db) == before  # Ni una fila distinta, tampoco updated_at.
    for entity in ('genero', 'especie', 'nombre_comun', 'sinonimo'):
        assert total(report, entity, 'nuevo') == 0
        assert total(report, entity, 'actualizado') == 0
        assert total(report, entity, 'conflicto') == 0
    assert total(report, 'especie', 'sin_cambios') == 5
    assert total(report, 'genero', 'sin_cambios') == 5
    assert total(report, 'especie', 'omitido') == 1


def test_added_row_is_loaded_without_touching_the_others(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert load_hybrids(db, tmp_path, monkeypatch, name='1.csv')[0] == 0
    ids = [r[0] for r in rows(db, "select id from public.species where source = 'curated'")]
    names = [r[0] for r in rows(db, 'select id from public.species_names')]
    before = (rows_of(db, 'species', ids), rows_of(db, 'species_names', names))

    added = (*BASE_ROWS, "HIB-0007,Vanda Robert's Delight,Vanda,,,sí,")
    code, report = load_hybrids(db, tmp_path, monkeypatch, added, name='2.csv')
    assert code == 0
    assert (rows_of(db, 'species', ids), rows_of(db, 'species_names', names)) == before
    assert [r['source_ref'] for r in select(report, entidad='especie', resultado='nuevo')] == [
        'HIB-0007'
    ]
    assert len(curated(db)) == 6
    assert total(report, 'especie', 'sin_cambios') == 5


def test_reviewed_later_is_loaded(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert load_hybrids(db, tmp_path, monkeypatch, name='1.csv')[0] == 0
    reviewed = tuple(r.replace(',no,Pendiente', ',sí,Pendiente') for r in BASE_ROWS)
    code, report = load_hybrids(db, tmp_path, monkeypatch, reviewed, name='2.csv')
    assert code == 0
    assert [r['nombre'] for r in select(report, entidad='especie', resultado='nuevo')] == [
        'Cattleya Bow Bells'
    ]
    assert not select(report, resultado='omitido')


# Conflictos ---------------------------------------------------------------------------------


def test_name_of_a_col_species_is_a_conflict(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Para especies manda el Catalogue of Life: el nombre, sin distinguir mayúsculas ni el
    signo «×», no se carga y la especie de COL no se toca."""
    load_col(db, tmp_path, monkeypatch)
    before = catalog_state(db)
    lines = (
        'HIB-0001,Phalaenopsis Amabilis,Phalaenopsis,orquídea luna,,sí,',
        # «× Anacamptorchis bassoulsii» en la base; género sin el signo en la lista.
        'HIB-0002,Anacamptorchis Bassoulsii,Anacamptorchis,,Otro nombre,sí,',
    )
    code, report = load_hybrids(db, tmp_path, monkeypatch, lines)
    assert code == 0
    assert catalog_state(db) == before
    conflicts = {
        r['source_ref']: r for r in select(report, entidad='especie', resultado='conflicto')
    }
    assert {r['codigo'] for r in conflicts.values()} == {'NOMBRE_DE_OTRA_FUENTE'}
    assert '«Phalaenopsis amabilis»' in conflicts['HIB-0001']['detalle']
    assert 'col' in conflicts['HIB-0001']['detalle']
    assert '«× Anacamptorchis bassoulsii»' in conflicts['HIB-0002']['detalle']
    rejected = select(report, resultado='rechazado', codigo='NOMBRE_SIN_ESPECIE')
    assert {(r['entidad'], r['nombre']) for r in rejected} == {
        ('nombre_comun', 'orquídea luna'),
        ('sinonimo', 'Otro nombre'),
    }


def test_curated_species_without_reference_is_a_conflict(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Como en los datos de ejemplo de desarrollo: una especie curada sin source_ref."""
    execute(
        db,
        """
        insert into public.species (scientific_name, genus_id, type, status, source)
        select 'Phalaenopsis Sogo Yukidian', id, 'hybrid', 'validated', 'curated'
          from public.genera where name = 'Phalaenopsis';
        """,
    )
    before = species(db, 'Phalaenopsis Sogo Yukidian')
    code, report = load_hybrids(db, tmp_path, monkeypatch)
    assert code == 0
    assert species(db, 'Phalaenopsis Sogo Yukidian') == before
    assert names_of(db, 'Phalaenopsis Sogo Yukidian') == []
    [conflict] = select(report, entidad='especie', resultado='conflicto')
    assert conflict['codigo'] == 'NOMBRE_DE_OTRA_ENTRADA'
    assert 'source_ref = HIB-0001' in conflict['detalle']


def test_protected_entry_is_not_changed(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert load_hybrids(db, tmp_path, monkeypatch, name='1.csv')[0] == 0
    execute(db, "update public.species set status = 'observed' where source_ref = 'HIB-0001'")
    before = species(db, 'Phalaenopsis Sogo Yukidian')
    changed = (BASE_ROWS[0].replace('Phalaenopsis Sogo Yukidian,', 'Phalaenopsis Sogo Yukidiann,'),
               *BASE_ROWS[1:])  # fmt: skip
    code, report = load_hybrids(db, tmp_path, monkeypatch, changed, name='2.csv')
    assert code == 0
    assert species(db, 'Phalaenopsis Sogo Yukidian') == before
    [conflict] = select(report, entidad='especie', resultado='conflicto')
    assert conflict['codigo'] == 'ESPECIE_PROTEGIDA'
    assert 'observed' in conflict['detalle']


# Cambios de una entrada entre cargas ------------------------------------------------------------


def test_changed_entry_is_updated_and_names_are_never_removed(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert load_hybrids(db, tmp_path, monkeypatch, name='1.csv')[0] == 0
    before = species(db, 'Oncidium Sharry Baby')
    changed = (
        BASE_ROWS[0],
        # Nombre corregido, un nombre común nuevo y el sinónimo quitado.
        'HIB-0002,Oncidium Sharry Babe,Oncidium,orquídea chocolate | chocolate,,sí,',
        *BASE_ROWS[2:],
    )
    code, report = load_hybrids(db, tmp_path, monkeypatch, changed, name='2.csv')
    assert code == 0
    after = species(db, 'Oncidium Sharry Babe')
    assert after[0] == before[0]  # La misma fila, con el nombre corregido.
    [updated] = select(report, entidad='especie', resultado='actualizado')
    assert updated['detalle'] == 'nombre: «Oncidium Sharry Baby» → «Oncidium Sharry Babe»'
    assert names_of(db, 'Oncidium Sharry Babe') == [
        ('chocolate', 'common'),
        ("Oncidium Sharry Baby 'Sweet Fragrance'", 'synonym'),
        ('orquídea chocolate', 'common'),
    ]
    [kept] = select(report, resultado='no_en_fuente', codigo='NOMBRE_NO_EN_LISTA')
    assert (kept['entidad'], kept['nombre']) == (
        'sinonimo',
        "Oncidium Sharry Baby 'Sweet Fragrance'",
    )


def test_removed_entry_is_kept(db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    assert load_hybrids(db, tmp_path, monkeypatch, name='1.csv')[0] == 0
    before = catalog_state(db)
    code, report = load_hybrids(db, tmp_path, monkeypatch, BASE_ROWS[1:], name='2.csv')
    assert code == 0
    assert catalog_state(db) == before
    [kept] = select(report, entidad='especie', resultado='no_en_fuente')
    assert (kept['codigo'], kept['source_ref']) == ('ENTRADA_NO_EN_LISTA', 'HIB-0001')


def test_admin_edit_of_a_validated_entry_is_reverted(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Limitación documentada: para híbridos manda la lista. Una entrada que sigue
    «validada» vuelve a lo que dice el CSV; para protegerla hay que marcarla observada."""
    assert load_hybrids(db, tmp_path, monkeypatch, name='1.csv')[0] == 0
    execute(db, "update public.species set type = 'species' where source_ref = 'HIB-0005'")
    code, report = load_hybrids(db, tmp_path, monkeypatch, name='2.csv')
    assert code == 0
    assert species(db, 'Burrageara Nelly Isler')[3] == 'hybrid'
    [updated] = select(report, entidad='especie', resultado='actualizado')
    assert updated['detalle'] == 'tipo: species → hybrid'


def test_name_of_another_type_is_a_conflict(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert load_hybrids(db, tmp_path, monkeypatch, name='1.csv')[0] == 0
    # El nombre común pasa a la columna de otros nombres: no se cambia su tipo.
    moved = ('HIB-0001,Phalaenopsis Sogo Yukidian,Phalaenopsis,,Doritaenopsis Sogo Yukidian | '
             'orquídea mariposa blanca,sí,', *BASE_ROWS[1:])  # fmt: skip
    code, report = load_hybrids(db, tmp_path, monkeypatch, moved, name='2.csv')
    assert code == 0
    assert ('orquídea mariposa blanca', 'common') in names_of(db, 'Phalaenopsis Sogo Yukidian')
    [conflict] = select(report, resultado='conflicto')
    assert conflict['codigo'] == 'NOMBRE_DE_OTRO_TIPO'


# Simulación y fallo ---------------------------------------------------------------------------


def test_simulation_writes_nothing_and_reports_exactly(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    before = catalog_state(db)
    code, simulated = load_hybrids(db, tmp_path, monkeypatch, write=False, name='sim.csv')
    assert code == 0
    assert catalog_state(db) == before
    assert select(simulated, codigo='MODO')[0]['nombre'] == 'simulacion'

    code, written = load_hybrids(db, tmp_path, monkeypatch, name='real.csv')
    assert code == 0

    def comparable(report: list[dict[str, str]]) -> list[tuple[str, ...]]:
        return sorted(
            (r['entidad'], r['resultado'], r['codigo'], r['source_ref'], r['nombre'], r['detalle'])
            for r in report
            if r['entidad'] != 'carga'
        )

    assert comparable(simulated) == comparable(written)


def test_failure_halfway_leaves_nothing(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # Falla al insertar un nombre: para entonces ya se crearon el género y las especies.
    execute(
        db,
        """
        create function public.falla_a_mitad() returns trigger language plpgsql as $$
        begin
          if new.name = 'orquídea chocolate' then
            raise exception 'fallo provocado';
          end if;
          return new;
        end $$;
        create trigger falla_a_mitad before insert on public.species_names
          for each row execute function public.falla_a_mitad();
        """,
    )
    before = catalog_state(db)
    code, report = load_hybrids(db, tmp_path, monkeypatch)
    assert code == 1
    assert report == []
    assert catalog_state(db) == before
    err = capsys.readouterr().err
    assert 'fallo provocado' in err
    assert 'no se ha escrito nada' in err


def test_invalid_list_writes_nothing(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    before = catalog_state(db)
    bad = (*BASE_ROWS, 'HIB-0001,Phalaenopsis Doris,Phalaenopsis,,,sí,')
    code, report = load_hybrids(db, tmp_path, monkeypatch, bad)
    assert code == 1
    assert report == []
    assert catalog_state(db) == before


def test_versioned_list_loads_only_reviewed_rows(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """La lista versionada se carga: cada fila revisada da su resultado y las demás se omiten."""
    monkeypatch.setenv('ORKI_CATALOG_DB_URL', url_of(db))
    lista = Path(__file__).resolve().parents[1] / 'data' / 'hibridos.csv'
    with lista.open(encoding='utf-8-sig', newline='') as handle:
        entries = list(csv.DictReader(handle))
    reviewed = len([e for e in entries if e['revisado'] == 'sí'])
    report = tmp_path / 'lista.csv'
    assert main(['cargar-hibridos', str(lista), '--ambiente', 'local', '--escribir',
                 '--reporte', str(report)]) == 0  # fmt: skip
    with report.open(encoding='utf-8-sig', newline='') as handle:
        loaded = list(csv.DictReader(handle))
    hybrids = [r for r in loaded if r['entidad'] == 'especie']
    omitted = [r for r in hybrids if r['resultado'] == 'omitido']
    assert reviewed > 0
    assert len(omitted) == len(entries) - reviewed
    assert {r['codigo'] for r in omitted} <= {'NO_REVISADA'}
    assert len(hybrids) - len(omitted) == reviewed
    assert total(loaded, 'especie', 'nuevo') > 0
    assert not [r for r in loaded if r['resultado'] == 'rechazado' and r['entidad'] == 'especie']
