"""``orki-catalogo cargar``: carga el catálogo normalizado en la base de datos.

Por defecto es una **simulación**: hace todo el trabajo dentro de una transacción y la
revierte, así que el reporte es exacto y no se escribe nada. Para escribir hay que pasar
``--escribir``; en producción, además, ``--confirmar-produccion`` con el identificador del
proyecto de producción.

La URL de la base llega por la variable de entorno ``ORKI_CATALOG_DB_URL`` y nunca se
imprime. El ambiente (``--ambiente``) es obligatorio y tiene que coincidir con esa URL
(ver :mod:`catalog_import.target`).
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import psycopg

from .cli import run
from .load import LoadError, run_load
from .reader import SourceFormatError
from .report import default_report_path, format_summary, write_csv
from .target import (
    PROD_REF,
    URL_VARIABLE,
    Environment,
    TargetError,
    parse_target,
    scrub,
    without_pg_environment,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog='orki-catalogo cargar',
        description=(
            'Normaliza la exportación de ChecklistBank y la carga en la base de datos del '
            f'ambiente indicado. La URL de la base se lee de {URL_VARIABLE}. Por defecto es '
            'una simulación: hace todo dentro de una transacción, la revierte y escribe el '
            'reporte.'
        ),
    )
    parser.add_argument('archivo', type=Path, help='export.zip de ChecklistBank o su TSV.')
    parser.add_argument(
        '--ambiente',
        required=True,
        choices=[e.value for e in Environment],
        help=f'Base de destino. Tiene que coincidir con la de {URL_VARIABLE}.',
    )
    parser.add_argument(
        '--escribir',
        action='store_true',
        help='Confirma los cambios. Sin esta opción, la carga se simula y se revierte.',
    )
    parser.add_argument(
        '--confirmar-produccion',
        metavar='REF',
        help='Obligatoria para escribir en producción: el identificador del proyecto de '
        'producción de Supabase.',
    )
    parser.add_argument(
        '--reporte',
        type=Path,
        help='Ruta del reporte CSV. Por defecto, reporte-carga-<ambiente>-<modo>-<fecha>.csv '
        'en la carpeta actual.',
    )
    parser.add_argument(
        '--detalle-sin-cambios',
        action='store_true',
        help='Escribe también en el CSV una fila por cada registro sin cambios.',
    )
    return parser


def _error(message: str) -> int:
    print(f'Error: {message}', file=sys.stderr)
    return 1


def main(argv: list[str]) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    environment = Environment(args.ambiente)
    if not args.archivo.is_file():
        parser.error(f'No existe el archivo {args.archivo}.')
    if environment is Environment.PROD and args.escribir and args.confirmar_produccion != PROD_REF:
        return _error(
            'Para escribir en producción hace falta --confirmar-produccion con el identificador '
            'del proyecto de producción. No se ha conectado a nada.'
        )
    if args.confirmar_produccion and environment is not Environment.PROD:
        return _error('--confirmar-produccion solo se usa con --ambiente prod.')

    try:
        target = parse_target(os.environ.get(URL_VARIABLE), environment)
    except TargetError as error:
        return _error(str(error))

    started = datetime.now(UTC)
    mode = 'ESCRITURA' if args.escribir else 'SIMULACIÓN (no se escribirá nada)'
    print(f'Destino: {target.describe()}\nModo: {mode}\n')

    mark = time.perf_counter()
    try:
        catalog, summary = run(args.archivo)
    except SourceFormatError as error:
        return _error(f'formato de la fuente: {error}')
    timings = {'lectura_fuente': time.perf_counter() - mark}

    try:
        with without_pg_environment():
            connection = psycopg.connect(
                **target.connect_kwargs(), autocommit=False, prepare_threshold=None
            )
        with connection:
            result = run_load(connection, catalog, write=args.escribir)
    except psycopg.Error as error:
        detail = scrub(str(error).strip(), target)
        state = f' ({error.sqlstate})' if error.sqlstate else ''
        return _error(
            f'la base de datos respondió con un error{state}: {detail}\n'
            'La transacción se revirtió: no se ha escrito nada.'
        )
    except LoadError as error:
        return _error(f'{scrub(str(error), target)}\nNo se ha escrito nada.')

    timings |= result.timings
    context = {
        'source': summary['source'],
        'environment': environment.value,
        'target': target.describe(),
        'started': started,
        'timings': timings,
    }
    report = args.reporte or default_report_path(environment.value, started, args.escribir)
    rows = write_csv(report, context, catalog, result, include_unchanged=args.detalle_sin_cambios)
    print(format_summary(context, catalog, result))
    print(f'\nReporte: {report} ({rows} filas)')
    return 0
