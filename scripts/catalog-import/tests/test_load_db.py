"""Pruebas de integración de la carga contra una base desechable con todas las migraciones.

Necesitan ORKI_TEST_DB_URL (un Postgres local con superusuario); sin ella se saltan. Cada
prueba trabaja en una base nueva, copia de una plantilla con las migraciones aplicadas.
"""

from __future__ import annotations

import csv
import dataclasses
from pathlib import Path
from typing import Any

import pytest

from catalog_import.cli import main
from catalog_import.load import LoadResult, run_load
from catalog_import.model import Action, Catalog, Code, Issue
from catalog_import.target import Target

from .basedatos import catalog_state, connect, execute, rows, url_of
from .conftest import SAMPLE


def load(
    db: Target,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    *,
    write: bool = True,
    name: str = 'reporte.csv',
    extra: tuple[str, ...] = (),
) -> tuple[int, list[dict[str, str]]]:
    """Ejecuta «orki-catalogo cargar» sobre la muestra y devuelve el código y el reporte."""
    monkeypatch.setenv('ORKI_CATALOG_DB_URL', url_of(db))
    report = tmp_path / name
    args = ['cargar', str(SAMPLE), '--ambiente', 'local', '--reporte', str(report), *extra]
    if write:
        args.append('--escribir')
    code = main(args)
    if not report.exists():
        return code, []
    with report.open(encoding='utf-8-sig', newline='') as handle:
        return code, list(csv.DictReader(handle))


def select(report: list[dict[str, str]], **filters: str) -> list[dict[str, str]]:
    return [r for r in report if all(r[k] == v for k, v in filters.items())]


def total(report: list[dict[str, str]], entity: str, result: str) -> int:
    found = select(report, entidad='carga', codigo='TOTAL', nombre=f'{entity} {result}')
    return int(found[0]['detalle']) if found else 0


def genus_id(db: Target, name: str) -> Any:
    return rows(db, 'select id from public.genera where name = %s', (name,))[0][0]


def species(db: Target, name: str) -> tuple[Any, ...]:
    return rows(
        db,
        'select s.id, s.scientific_name, g.name, s.type::text, s.status::text, '
        's.source::text, s.source_ref, s.updated_at from public.species s '
        'join public.genera g on g.id = s.genus_id where s.scientific_name = %s',
        (name,),
    )[0]


def names_of(db: Target, scientific_name: str) -> list[tuple[str, str]]:
    return rows(
        db,
        'select n.name, n.type::text from public.species_names n '
        'join public.species s on s.id = n.species_id where s.scientific_name = %s '
        'order by n.name',
        (scientific_name,),
    )


def run_catalog(db: Target, catalog: Catalog, *, write: bool = True) -> LoadResult:
    with connect(db, autocommit=False) as conn:
        return run_load(conn, catalog, write=write)


# Carga de la muestra ------------------------------------------------------------------------


def test_loads_sample(db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    code, report = load(db, tmp_path, monkeypatch)
    assert code == 0

    assert sorted(
        rows(
            db,
            'select scientific_name, type::text, status::text, source_ref from public.species '
            "where source = 'col' order by scientific_name",
        )
    ) == [
        ('Brassocattleya hybrida', 'hybrid', 'imported', 'M592X'),
        ('Bulbophyllum fletcherianum', 'species', 'imported', '8W7QM'),
        ('Cattleya labiata', 'species', 'imported', 'RWFC'),
        ('Chamorchis alpina', 'species', 'imported', 'TLRN'),
        ('Dendrobium thyrsiflorum', 'species', 'imported', '6CJK4'),
        ('Phalaenopsis amabilis', 'species', 'imported', '4FR2J'),
        ('Phalaenopsis aphrodite', 'species', 'imported', '4FR2M'),
        ('Phalaenopsis × intermedia', 'hybrid', 'imported', '4FR3H'),
        ('× Anacamptorchis bassoulsii', 'hybrid', 'imported', '66JFS'),
        ('× Orchiserapias dhiorii', 'hybrid', 'imported', 'L2GFV'),
    ]
    assert species(db, 'Brassocattleya hybrida')[2] == '× Brassocattleya'
    assert species(db, 'Phalaenopsis amabilis')[2] == 'Phalaenopsis'
    assert names_of(db, 'Phalaenopsis amabilis') == [
        ('Cymbidium amabile', 'synonym'),
        ('Epidendrum amabile', 'synonym'),
        ('Phalaenopsis amabilis var. moluccana', 'synonym'),
        ('Phalaenopsis celebica', 'synonym'),
    ]
    assert rows(db, "select count(*) from public.species_names where type = 'synonym'") == [(8,)]

    # Géneros: 3 nuevos, × Brassocattleya renombrado y los otros 4 ya estaban.
    assert total(report, 'genero', 'nuevo') == 3
    assert total(report, 'genero', 'actualizado') == 1
    assert total(report, 'genero', 'sin_cambios') == 4
    assert total(report, 'especie', 'nuevo') == 10
    assert total(report, 'sinonimo', 'nuevo') == 8
    assert {r['nombre'] for r in select(report, entidad='genero', resultado='nuevo')} == {
        'Chamorchis',
        'Orchiserapias',
        '× Anacamptorchis',
    }
    # Las especies y sinónimos nuevos van uno a uno; los sin cambios no.
    assert len(select(report, entidad='especie', resultado='nuevo')) == 10
    assert len(select(report, entidad='sinonimo', resultado='nuevo')) == 8
    assert not select(report, resultado='sin_cambios')

    # Metadatos, descartes y ajustes de la normalización.
    [source] = select(report, entidad='carga', codigo='FUENTE')
    assert source['nombre'] == ''  # La muestra es un TSV suelto, sin metadata.yaml.
    assert select(report, entidad='carga', codigo='AMBIENTE')[0]['nombre'] == 'local'
    assert select(report, entidad='carga', codigo='MODO')[0]['nombre'] == 'escritura'
    assert len(select(report, resultado='descartado', codigo='FORMULA_HIBRIDA')) == 3
    assert len(select(report, resultado='ajustado', codigo='SINONIMO_REASIGNADO')) == 2
    assert {r['nombre'] for r in select(report, entidad='carga', codigo='TAMANO')} >= {
        'base de datos',
        'species',
        'species_names',
    }
    recount = {r['nombre']: r['detalle'] for r in select(report, codigo='RECUENTO')}
    assert recount['especies de COL'] == '10'
    assert recount['sinonimos'] == '8'


def test_genus_without_sign_gets_it_and_keeps_abbreviation(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    before = genus_id(db, 'Brassocattleya')
    execute(db, "update public.genera set is_quick_access = true where name = 'Brassocattleya'")
    code, report = load(db, tmp_path, monkeypatch)
    assert code == 0
    assert rows(
        db,
        'select g.id, g.name, g.is_quick_access, a.abbreviation from public.genera g '
        "join public.genus_abbreviations a on a.genus_id = g.id where a.abbreviation = 'Bc.'",
    ) == [(before, '× Brassocattleya', True, 'Bc.')]
    # No queda un «Brassocattleya» sin signo al lado del renombrado.
    assert rows(db, "select name from public.genera where name ilike '%brassocattleya'") == [
        ('× Brassocattleya',)
    ]
    [renamed] = select(report, entidad='genero', codigo='GENERO_RENOMBRADO')
    assert renamed['nombre'] == '× Brassocattleya'
    assert '«Brassocattleya» → «× Brassocattleya»' in renamed['detalle']
    assert 'Bc.' in renamed['detalle']
    # La búsqueda la encuentra por su abreviatura.
    assert rows(db, "select scientific_name from public.search_species('bc hybr')")[0] == (
        'Brassocattleya hybrida',
    )
    # Los géneros de la base que la fuente no trae se conservan y se listan.
    missing = {r['nombre'] for r in select(report, entidad='genero', resultado='no_en_fuente')}
    assert {'Rhyncholaeliocattleya', 'Sophronitis', 'Vanda'} <= missing


def test_discarded_nothogenus_names_existing_genus(db: Target, sample_catalog: Catalog) -> None:
    """Un nothogénero que la fuente acepta pero sin especies importadas no se crea; si ya
    existe sin el signo, se le pone."""
    execute(db, "insert into public.genera (name) values ('Aliceara')")
    extra = (
        Issue('AAAA1', '× Aliceara', 'hort.', 'genus', 'accepted', Action.DISCARDED,
              Code.GENUS_WITHOUT_SPECIES, 'Género aceptado sin ninguna especie importada.'),
        Issue('AAAA2', '× Mokara', 'hort.', 'genus', 'accepted', Action.DISCARDED,
              Code.GENUS_WITHOUT_SPECIES, 'Género aceptado sin ninguna especie importada.'),
    )  # fmt: skip
    catalog = dataclasses.replace(sample_catalog, issues=sample_catalog.issues + extra)
    result = run_catalog(db, catalog)
    assert rows(db, "select name from public.genera where name ilike '%aliceara'") == [
        ('× Aliceara',)
    ]
    assert rows(db, "select count(*) from public.genera where name ilike '%mokara'") == [(0,)]
    [row] = [r for r in result.plan.rows if r.code == 'GENERO_RENOMBRADO' and 'Aliceara' in r.name]
    assert 'sin especies importadas' in row.detail


# Repetible, simulación y fallo ---------------------------------------------------------------


def test_second_load_changes_nothing(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert load(db, tmp_path, monkeypatch, name='1.csv')[0] == 0
    before = catalog_state(db)
    code, report = load(db, tmp_path, monkeypatch, name='2.csv')
    assert code == 0
    assert catalog_state(db) == before  # Ni una fila distinta, tampoco updated_at.
    for entity in ('genero', 'especie', 'sinonimo'):
        assert total(report, entity, 'nuevo') == 0
        assert total(report, entity, 'actualizado') == 0
        assert total(report, entity, 'conflicto') == 0
    assert total(report, 'especie', 'sin_cambios') == 10
    assert total(report, 'sinonimo', 'sin_cambios') == 8
    assert total(report, 'genero', 'sin_cambios') == 8
    assert not select(report, resultado='nuevo')
    assert not select(report, resultado='actualizado')


def test_simulation_writes_nothing_and_reports_exactly(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    before = catalog_state(db)
    code, simulated = load(db, tmp_path, monkeypatch, write=False, name='sim.csv')
    assert code == 0
    assert catalog_state(db) == before
    assert select(simulated, codigo='MODO')[0]['nombre'] == 'simulacion'

    code, written = load(db, tmp_path, monkeypatch, name='real.csv')
    assert code == 0

    def comparable(report: list[dict[str, str]]) -> list[tuple[str, ...]]:
        # Los ids de las filas nuevas los genera la base en cada ejecución.
        return sorted(
            (r['entidad'], r['resultado'], r['codigo'], r['source_ref'], r['nombre'], r['detalle'])
            for r in report
            if r['entidad'] != 'carga' and r['resultado'] != 'nuevo'
        ) + sorted(
            (r['entidad'], r['codigo'], r['source_ref'], r['nombre'])
            for r in report
            if r['resultado'] == 'nuevo'
        )

    assert comparable(simulated) == comparable(written)
    for entity in ('genero', 'especie', 'sinonimo'):
        for result in ('nuevo', 'actualizado', 'conflicto'):
            assert total(simulated, entity, result) == total(written, entity, result)


def test_failure_halfway_leaves_nothing(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # Un disparador que falla al insertar una especie concreta: para entonces la carga ya ha
    # creado y renombrado géneros e insertado otras especies.
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
    before = catalog_state(db)
    code, report = load(db, tmp_path, monkeypatch)
    assert code == 1
    assert report == []
    assert catalog_state(db) == before
    err = capsys.readouterr().err
    assert 'fallo provocado' in err
    assert 'no se ha escrito nada' in err


# Trabajo del administrador ---------------------------------------------------------------------


def test_validated_or_observed_species_does_not_change(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert load(db, tmp_path, monkeypatch, name='1.csv')[0] == 0
    # Un administrador valida una especie y le cambia el género; marca otra como observada y
    # le cambia el tipo; valida una tercera sin tocar nada más.
    execute(
        db,
        """
        update public.species set status = 'validated',
          genus_id = (select id from public.genera where name = 'Cattleya')
          where scientific_name = 'Chamorchis alpina';
        update public.species set status = 'observed', type = 'species'
          where scientific_name = 'Phalaenopsis × intermedia';
        update public.species set status = 'validated'
          where scientific_name = 'Phalaenopsis amabilis';
        """,
    )
    before = catalog_state(db)
    code, report = load(db, tmp_path, monkeypatch, name='2.csv')
    assert code == 0
    assert catalog_state(db) == before

    conflicts = {
        r['nombre']: r['detalle'] for r in select(report, entidad='especie', resultado='conflicto')
    }
    assert set(conflicts) == {'Chamorchis alpina', 'Phalaenopsis × intermedia'}
    assert 'validated' in conflicts['Chamorchis alpina']
    assert 'género: «Cattleya» → «Chamorchis»' in conflicts['Chamorchis alpina']
    assert 'tipo: species → hybrid' in conflicts['Phalaenopsis × intermedia']
    assert all(r['codigo'] == 'ESPECIE_PROTEGIDA' for r in select(report, resultado='conflicto'))
    assert total(report, 'especie', 'actualizado') == 0


def test_imported_species_edited_without_status_change_is_overwritten(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Limitación documentada: sin auditoría, la única señal de trabajo del administrador es
    el estado. Una especie que sigue «importada» vuelve a lo que dice la fuente."""
    assert load(db, tmp_path, monkeypatch, name='1.csv')[0] == 0
    execute(
        db,
        "update public.species set type = 'species' "
        "where scientific_name = '× Orchiserapias dhiorii'",
    )
    code, report = load(db, tmp_path, monkeypatch, name='2.csv')
    assert code == 0
    assert species(db, '× Orchiserapias dhiorii')[3] == 'hybrid'
    [updated] = select(report, entidad='especie', resultado='actualizado')
    assert updated['detalle'] == 'tipo: species → hybrid'


def test_name_from_curated_list_is_a_conflict(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    execute(
        db,
        """
        insert into public.species (scientific_name, genus_id, type, status, source)
        select 'Cattleya labiata', id, 'species', 'imported', 'curated'
          from public.genera where name = 'Cattleya';
        insert into public.species (scientific_name, genus_id, type, status, source)
        select 'Phalaenopsis aphrodite', id, 'species', 'validated', 'user_proposal'
          from public.genera where name = 'Phalaenopsis';
        """,
    )
    before = {name: species(db, name) for name in ('Cattleya labiata', 'Phalaenopsis aphrodite')}
    code, report = load(db, tmp_path, monkeypatch)
    assert code == 0
    assert {name: species(db, name) for name in before} == before
    assert names_of(db, 'Cattleya labiata') == []
    conflicts = {
        r['nombre']: r for r in select(report, entidad='especie', codigo='NOMBRE_DE_OTRA_FUENTE')
    }
    assert set(conflicts) == {'Cattleya labiata', 'Phalaenopsis aphrodite'}
    assert 'curated' in conflicts['Cattleya labiata']['detalle']
    rejected = select(report, entidad='sinonimo', codigo='SINONIMO_SIN_ESPECIE')
    assert {r['especie'] for r in rejected} == {'Cattleya labiata (RWFC)'}
    assert len(rejected) == 3
    assert total(report, 'especie', 'nuevo') == 8


def test_manual_names_are_kept(db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    assert load(db, tmp_path, monkeypatch, name='1.csv')[0] == 0
    execute(
        db,
        """
        insert into public.species_names (species_id, name, type, language)
        select id, 'Orquídea mariposa', 'common', 'es' from public.species
          where scientific_name = 'Phalaenopsis amabilis';
        insert into public.species_names (species_id, name, type)
        select id, 'Phalaenopsis grandiflora', 'synonym' from public.species
          where scientific_name = 'Phalaenopsis amabilis';
        """,
    )
    before = catalog_state(db)
    code, report = load(db, tmp_path, monkeypatch, name='2.csv')
    assert code == 0
    assert catalog_state(db) == before
    assert ('Orquídea mariposa', 'common') in names_of(db, 'Phalaenopsis amabilis')
    assert ('Phalaenopsis grandiflora', 'synonym') in names_of(db, 'Phalaenopsis amabilis')
    assert total(report, 'sinonimo', 'no_en_fuente') == 1


def test_source_synonym_that_is_a_common_name(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    execute(
        db,
        """
        insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
        select 'Phalaenopsis amabilis', id, 'species', 'imported', 'col', '4FR2J'
          from public.genera where name = 'Phalaenopsis';
        insert into public.species_names (species_id, name, type, language)
        select id, 'Cymbidium amabile', 'common', 'es' from public.species
          where scientific_name = 'Phalaenopsis amabilis';
        """,
    )
    code, report = load(db, tmp_path, monkeypatch)
    assert code == 0
    assert ('Cymbidium amabile', 'common') in names_of(db, 'Phalaenopsis amabilis')
    [conflict] = select(report, entidad='sinonimo', resultado='conflicto')
    assert conflict['codigo'] == 'SINONIMO_ES_NOMBRE_COMUN'
    assert total(report, 'especie', 'sin_cambios') == 1


# Claves de COL que cambian ----------------------------------------------------------------------


def test_changed_key_is_updated(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    execute(
        db,
        """
        insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
        select 'Phalaenopsis amabilis', id, 'species', 'imported', 'col', 'CLAVEVIEJA'
          from public.genera where name = 'Phalaenopsis';
        """,
    )
    before = species(db, 'Phalaenopsis amabilis')
    code, report = load(db, tmp_path, monkeypatch)
    assert code == 0
    after = species(db, 'Phalaenopsis amabilis')
    assert after[0] == before[0]
    assert after[6] == '4FR2J'
    [row] = select(report, entidad='especie', codigo='CLAVE_ACTUALIZADA')
    assert row['detalle'] == 'clave: CLAVEVIEJA → 4FR2J'
    assert rows(db, "select count(*) from public.species where source_ref = 'CLAVEVIEJA'") == [(0,)]
    assert len(names_of(db, 'Phalaenopsis amabilis')) == 4


def test_changed_key_of_validated_species_is_a_conflict(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    execute(
        db,
        """
        insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
        select 'Phalaenopsis amabilis', id, 'species', 'validated', 'col', 'CLAVEVIEJA'
          from public.genera where name = 'Phalaenopsis';
        """,
    )
    before = species(db, 'Phalaenopsis amabilis')
    code, report = load(db, tmp_path, monkeypatch)
    assert code == 0
    assert species(db, 'Phalaenopsis amabilis') == before
    [row] = select(report, entidad='especie', resultado='conflicto')
    assert row['codigo'] == 'ESPECIE_PROTEGIDA'
    assert 'clave: CLAVEVIEJA → 4FR2J' in row['detalle']


def test_key_still_used_by_source_is_a_conflict(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # La base tiene «Phalaenopsis amabilis» con la clave de Phalaenopsis aphrodite.
    execute(
        db,
        """
        insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
        select 'Phalaenopsis amabilis', id, 'species', 'imported', 'col', '4FR2M'
          from public.genera where name = 'Phalaenopsis';
        """,
    )
    code, report = load(db, tmp_path, monkeypatch)
    assert code == 0
    by_code = {r['codigo']: r for r in select(report, entidad='especie', resultado='conflicto')}
    # 4FR2J (amabilis) encuentra su nombre ocupado por una fila cuya clave la fuente sigue
    # trayendo para otro registro: conflicto, no se inserta ni se toca esa fila.
    assert set(by_code) == {'CLAVE_DISTINTA'}
    assert by_code['CLAVE_DISTINTA']['nombre'] == 'Phalaenopsis amabilis'
    # Por su clave, la fila es de 4FR2M, que la renombra a «Phalaenopsis aphrodite» (sigue
    # «importada», así que se actualiza).
    assert species(db, 'Phalaenopsis aphrodite')[6] == '4FR2M'
    assert rows(db, "select count(*) from public.species where source = 'col'") == [(9,)]


# Plantas ---------------------------------------------------------------------------------------


def test_type_change_propagates_to_plants(db: Target, sample_catalog: Catalog) -> None:
    run_catalog(db, sample_catalog)
    execute(
        db,
        """
        insert into public.profiles (id) values ('user_a');
        insert into public.plants (user_id, entered_name, species_id)
        select 'user_a', 'Mi alpina', id from public.species
          where scientific_name = 'Chamorchis alpina';
        """,
    )
    changed = tuple(
        dataclasses.replace(sp, type='hybrid') if sp.source_ref == 'TLRN' else sp
        for sp in sample_catalog.species
    )
    result = run_catalog(db, dataclasses.replace(sample_catalog, species=changed))
    assert rows(db, 'select type::text from public.plants') == [('hybrid',)]
    [row] = [r for r in result.plan.rows if r.result == 'actualizado' and r.source_ref == 'TLRN']
    assert row.detail == 'tipo: species → hybrid; se propaga a 1 plantas de usuarios'


def test_successful_load_does_not_print_credentials(
    db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    assert db.password, 'La prueba necesita una URL con contraseña.'
    code, _ = load(db, tmp_path, monkeypatch, write=False)
    assert code == 0
    captured = capsys.readouterr()
    assert db.password not in captured.out + captured.err
    assert db.password not in (tmp_path / 'reporte.csv').read_text(encoding='utf-8-sig')
