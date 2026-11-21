"""``orki-catalogo cargar``: carga el catálogo normalizado en la base de datos.

Por defecto es una **simulación**: hace todo el trabajo dentro de una transacción y la
revierte, así que el reporte es exacto y no se escribe nada. Para escribir hay que pasar
``--escribir``; en producción, además, ``--confirmar-produccion`` con el identificador del
proyecto de producción.

Cada carga deja una fila de resumen en la auditoría del catálogo (:mod:`catalog_import.audit`)
con el identificador de la carga; la de una simulación se revierte con todo lo demás.

La URL de la base llega por la variable de entorno ``ORKI_CATALOG_DB_URL`` y nunca se
imprime. El ambiente (``--ambiente``) es obligatorio y tiene que coincidir con esa URL
(ver :mod:`catalog_import.target`).

Las opciones, la protección de ambiente y la conexión (:func:`add_load_options`,
:func:`resolve_target` y :func:`connect_and_run`) son comunes con
``orki-catalogo cargar-hibridos`` (:mod:`catalog_import.hybrids_cli`).
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import psycopg

from .audit import (
    ACTION,
    CATALOG_LOAD,
    AuditError,
    LoadAudit,
    col_source,
    load_actor,
    missing_audit_message,
)
from .cli import run
from .load import LoadError, LoadResult, run_load
from .reader import SourceFormatError
from .report import default_report_path, format_summary, issue_rows, write_csv
from .target import (
    PROD_REF,
    URL_VARIABLE,
    Environment,
    Target,
    TargetError,
    parse_target,
    scrub,
    without_pg_environment,
)


def add_load_options(parser: argparse.ArgumentParser, report_prefix: str) -> None:
    """Opciones comunes a las dos cargas: ambiente, escritura, confirmación y reporte."""
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
        help=f'Ruta del reporte CSV. Por defecto, {report_prefix}-<ambiente>-<modo>-<fecha>.csv '
        'en la carpeta actual.',
    )
    parser.add_argument(
        '--detalle-sin-cambios',
        action='store_true',
        help='Escribe también en el CSV una fila por cada registro sin cambios.',
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
    add_load_options(parser, 'reporte-carga')
    return parser


def error(message: str) -> int:
    print(f'Error: {message}', file=sys.stderr)
    return 1


def resolve_target(args: argparse.Namespace) -> Target | int:
    """Protección de ambiente, antes de leer la fuente y de conectar.

    Devuelve el destino o, si no se puede cargar, el código de salida (ya con el error
    impreso).
    """
    environment = Environment(args.ambiente)
    if environment is Environment.PROD and args.escribir and args.confirmar_produccion != PROD_REF:
        return error(
            'Para escribir en producción hace falta --confirmar-produccion con el identificador '
            'del proyecto de producción. No se ha conectado a nada.'
        )
    if args.confirmar_produccion and environment is not Environment.PROD:
        return error('--confirmar-produccion solo se usa con --ambiente prod.')
    try:
        return parse_target(os.environ.get(URL_VARIABLE), environment)
    except TargetError as problem:
        return error(str(problem))


def announce(target: Target, write: bool) -> None:
    mode = 'ESCRITURA' if write else 'SIMULACIÓN (no se escribirá nada)'
    print(f'Destino: {target.describe()}\nModo: {mode}\n')


def prepare_audit(
    load_type: str, target: Target, source: Callable[[], dict[str, Any]]
) -> LoadAudit | int:
    """Identificador de la carga y fuente para el resumen de la auditoría, antes de conectar.

    Devuelve los datos o, si no se pueden preparar, el código de salida (con el error impreso).
    """
    try:
        actor, run_info = load_actor(os.environ)
        return LoadAudit(actor, load_type, target.environment.value, source(), run_info)
    except AuditError as problem:
        return error(f'{problem}\nNo se ha conectado a nada.')


def audit_notice(audit: LoadAudit, result: LoadResult) -> str:
    """Línea del resumen por pantalla sobre la fila de la auditoría."""
    if result.written:
        return (
            f'Auditoría: resumen registrado ({ACTION}) con el identificador de la carga '
            f'{audit.actor} (acción {result.audit_action_id}).'
        )
    if result.audit_ready:
        return (
            'Auditoría: la simulación insertó el resumen y lo revirtió con lo demás; no queda '
            'registro.'
        )
    return f'Aviso: {missing_audit_message()} Con --escribir, esta carga se negaría.'


def audit_row_detail(result: LoadResult) -> str:
    """Detalle de la fila AUDITORIA del reporte CSV."""
    if result.written:
        return f'Resumen registrado en la auditoría ({ACTION}), acción {result.audit_action_id}.'
    if result.audit_ready:
        return 'Simulación: el resumen de la auditoría se insertó y se revirtió.'
    return 'Simulación: la base no tiene la auditoría del catálogo; con --escribir se negaría.'


def connect_and_run(
    target: Target, work: Callable[[psycopg.Connection[Any]], LoadResult]
) -> LoadResult | int:
    """Conecta con la URL validada y ejecuta la carga. Los errores salen sin credenciales.

    Devuelve el resultado o, si la carga falló (y se revirtió), el código de salida.
    """
    try:
        with without_pg_environment():
            connection = psycopg.connect(
                **target.connect_kwargs(), autocommit=False, prepare_threshold=None
            )
        with connection:
            return work(connection)
    except psycopg.Error as problem:
        detail = scrub(str(problem).strip(), target)
        state = f' ({problem.sqlstate})' if problem.sqlstate else ''
        return error(
            f'la base de datos respondió con un error{state}: {detail}\n'
            'La transacción se revirtió: no se ha escrito nada.'
        )
    except LoadError as problem:
        return error(f'{scrub(str(problem), target)}\nNo se ha escrito nada.')


def main(argv: list[str]) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.archivo.is_file():
        parser.error(f'No existe el archivo {args.archivo}.')
    target = resolve_target(args)
    if isinstance(target, int):
        return target

    audit = prepare_audit(CATALOG_LOAD, target, lambda: col_source(args.archivo))
    if isinstance(audit, int):
        return audit

    started = datetime.now(UTC)
    announce(target, args.escribir)

    mark = time.perf_counter()
    try:
        catalog, summary = run(args.archivo)
    except SourceFormatError as problem:
        return error(f'formato de la fuente: {problem}')
    timings = {'lectura_fuente': time.perf_counter() - mark}

    result = connect_and_run(
        target, lambda conn: run_load(conn, catalog, write=args.escribir, audit=audit)
    )
    if isinstance(result, int):
        return result

    timings |= result.timings
    context = {
        'source': summary['source'],
        'environment': target.environment.value,
        'target': target.describe(),
        'started': started,
        'timings': timings,
        'audit': (audit.actor, audit_row_detail(result)),
    }
    report = args.reporte or default_report_path(target.environment.value, started, args.escribir)
    rows = write_csv(
        report,
        context,
        result,
        extra_rows=issue_rows(catalog.issues),
        include_unchanged=args.detalle_sin_cambios,
    )
    print(format_summary(context, catalog, result))
    print(audit_notice(audit, result))
    print(f'\nReporte: {report} ({rows} filas)')
    return 0
