"""``orki-catalogo validar-hibridos`` y ``orki-catalogo cargar-hibridos``.

``validar-hibridos`` comprueba el formato de la lista curada sin conectarse a nada (es lo que
ejecuta el CI con el CSV versionado). ``cargar-hibridos`` valida igual y, si no hay errores,
carga las entradas revisadas con el mismo flujo, las mismas opciones y la misma protección de
ambiente que ``orki-catalogo cargar`` (:mod:`catalog_import.load_cli`): simulación por
defecto, ``--escribir``, ``--confirmar-produccion`` en producción, la URL solo en
``ORKI_CATALOG_DB_URL`` y un reporte CSV.
"""

from __future__ import annotations

import argparse
import time
from datetime import UTC, datetime
from pathlib import Path

from .hybrids import HybridList, format_validation, read_hybrids
from .hybrids_load import CURATED_POLICY, plan_hybrids
from .load import COMMON_NAME, GENUS, SPECIES, SYNONYM, run_plan
from .load_cli import add_load_options, announce, connect_and_run, error, resolve_target
from .report import default_report_path, format_load_summary, write_csv
from .target import URL_VARIABLE

REPORT_PREFIX = 'reporte-carga-hibridos'
ENTITY_LABELS = {
    GENUS: 'Géneros',
    SPECIES: 'Híbridos',
    COMMON_NAME: 'Nombres comunes',
    SYNONYM: 'Otros nombres (sinónimos)',
}


def _read(parser: argparse.ArgumentParser, path: Path) -> HybridList:
    if not path.is_file():
        parser.error(f'No existe el archivo {path}.')
    return read_hybrids(path)


def validate_main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog='orki-catalogo validar-hibridos',
        description='Valida el formato de la lista curada de híbridos. No se conecta a ninguna '
        'base de datos.',
    )
    parser.add_argument('archivo', type=Path, help='CSV de la lista (data/hibridos.csv).')
    args = parser.parse_args(argv)
    hybrids = _read(parser, args.archivo)
    print(format_validation(hybrids))
    return 0 if hybrids.valid else 1


def load_main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog='orki-catalogo cargar-hibridos',
        description=(
            'Valida la lista curada de híbridos y carga sus entradas revisadas en la base de '
            f'datos del ambiente indicado. La URL de la base se lee de {URL_VARIABLE}. Por '
            'defecto es una simulación: hace todo dentro de una transacción, la revierte y '
            'escribe el reporte.'
        ),
    )
    parser.add_argument('archivo', type=Path, help='CSV de la lista (data/hibridos.csv).')
    add_load_options(parser, REPORT_PREFIX)
    args = parser.parse_args(argv)
    if not args.archivo.is_file():
        parser.error(f'No existe el archivo {args.archivo}.')
    target = resolve_target(args)
    if isinstance(target, int):
        return target

    mark = time.perf_counter()
    hybrids = read_hybrids(args.archivo)
    if not hybrids.valid:
        print(format_validation(hybrids))
        return error('la lista tiene errores de formato. No se ha conectado a nada.')
    timings = {'lectura_fuente': time.perf_counter() - mark}

    started = datetime.now(UTC)
    announce(target, args.escribir)
    entries = hybrids.entries
    result = connect_and_run(
        target,
        lambda conn: run_plan(
            conn,
            lambda snapshot: plan_hybrids(entries, snapshot),
            CURATED_POLICY,
            write=args.escribir,
        ),
    )
    if isinstance(result, int):
        return result

    summary = hybrids.summary()
    timings |= result.timings
    context = {
        'source': {
            'alias': 'Lista curada de híbridos',
            'key': hybrids.sha256[:12],
            'file': args.archivo.name,
            'detail': (
                f'archivo: {args.archivo.name}; SHA-256: {hybrids.sha256}; entradas: '
                f'{summary["entries"]} ({summary["reviewed"]} revisadas, '
                f'{summary["not_reviewed"]} sin revisar)'
            ),
        },
        'environment': target.environment.value,
        'target': target.describe(),
        'started': started,
        'timings': timings,
    }
    report = args.reporte or default_report_path(
        target.environment.value, started, args.escribir, REPORT_PREFIX
    )
    rows = write_csv(report, context, result, include_unchanged=args.detalle_sin_cambios)
    print(
        format_load_summary(
            context,
            result,
            ENTITY_LABELS,
            [
                f'Entradas de la lista: {summary["entries"]}, de ellas {summary["reviewed"]} '
                f'revisadas y {summary["not_reviewed"]} sin revisar (omitidas, no se cargan).'
            ],
        )
    )
    print(f'\nReporte: {report} ({rows} filas)')
    return 0
