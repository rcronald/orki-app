"""Reporte de la carga: un CSV con una fila por registro y un resumen para la pantalla.

Columnas del CSV (separado por comas, UTF-8 con BOM para que una hoja de cálculo lea bien
las tildes y el «×»):

- ``entidad``: ``carga`` (datos de la ejecución), ``genero``, ``especie`` o ``sinonimo``.
- ``resultado``: ``info`` (solo en ``carga``), ``nuevo``, ``actualizado``, ``sin_cambios``,
  ``conflicto``, ``rechazado`` o ``no_en_fuente``, y para lo que la normalización dejó
  fuera o cambió, ``descartado`` o ``ajustado``.
- ``codigo``: código estable del motivo (``ESPECIE_NUEVA``, ``ESPECIE_PROTEGIDA``,
  ``FORMULA_HIBRIDA``…).
- ``source_ref``: identificador de COL del registro.
- ``nombre``: nombre del registro (sin autoría).
- ``especie``: en los sinónimos, la especie a la que pertenecen, «Nombre (clave)».
- ``detalle``: qué cambió o por qué se rechazó o se descartó.
- ``id_base``: id de la fila en la base, si existe.

Las filas ``sin_cambios`` solo se escriben una a una si se pide; siempre se cuentan en el
resumen.
"""

from __future__ import annotations

import csv
from collections.abc import Iterable
from datetime import datetime
from pathlib import Path
from typing import Any

from .load import (
    CATALOG_TABLES,
    CONFLICT,
    GENUS,
    INFO,
    NEW,
    NOT_IN_SOURCE,
    REJECTED,
    RUN,
    SPECIES,
    SYNONYM,
    UNCHANGED,
    UPDATED,
    LoadResult,
    ReportRow,
)
from .model import Action, Catalog, Issue
from .normalize import SYNONYM_STATUSES

HEADER = ('entidad', 'resultado', 'codigo', 'source_ref', 'nombre', 'especie', 'detalle', 'id_base')

_ENTITY_LABELS = {GENUS: 'Géneros', SPECIES: 'Especies', SYNONYM: 'Sinónimos'}
_RESULT_LABELS = {
    NEW: 'nuevos',
    UPDATED: 'actualizados',
    UNCHANGED: 'sin cambios',
    CONFLICT: 'en conflicto',
    REJECTED: 'rechazados',
    NOT_IN_SOURCE: 'en la base y no en la fuente',
}


def megabytes(size: int) -> str:
    return f'{size / 1024 / 1024:.1f} MB'.replace('.', ',')


def issue_rows(issues: Iterable[Issue]) -> list[ReportRow]:
    """Descartes y ajustes de la normalización, como filas del reporte."""
    rows = []
    for issue in issues:
        if issue.rank == 'genus':
            entity = GENUS
        elif issue.status in SYNONYM_STATUSES:
            entity = SYNONYM
        else:
            entity = SPECIES
        detail = issue.message
        if issue.authorship:
            detail = f'{detail} Autoría: {issue.authorship}.'
        detail = f'{detail} Rango: {issue.rank}; estado: {issue.status}.'
        rows.append(
            ReportRow(
                entity,
                'descartado' if issue.action is Action.DISCARDED else 'ajustado',
                issue.code.value,
                issue.source_ref,
                issue.name,
                detail=detail,
            )
        )
    return rows


def run_rows(context: dict[str, Any], result: LoadResult) -> list[ReportRow]:
    """Filas de la entidad «carga»: fuente, ambiente, modo, recuentos, tamaños y tiempos."""
    source = context['source']
    m = result.measures
    rows = [
        ReportRow(
            RUN,
            INFO,
            'FUENTE',
            source.get('key', ''),
            source.get('alias', ''),
            detail=(
                f'archivo: {source.get("file", "")}; versión: {source.get("version", "")}; '
                f'publicada: {source.get("issued", "")}; DOI: {source.get("doi", "")}'
            ),
        ),
        ReportRow(RUN, INFO, 'AMBIENTE', name=context['environment'], detail=context['target']),
        ReportRow(
            RUN,
            INFO,
            'MODO',
            name='escritura' if result.written else 'simulacion',
            detail=(
                'Cambios confirmados.'
                if result.written
                else 'Simulación: todo se hizo dentro de una transacción que se revirtió. '
                'No se escribió nada.'
            ),
        ),
        ReportRow(RUN, INFO, 'FECHA', name=context['started'].isoformat(timespec='seconds')),
    ]
    for (entity, outcome), count in sorted(result.plan.counts.items()):
        rows.append(ReportRow(RUN, INFO, 'TOTAL', name=f'{entity} {outcome}', detail=str(count)))
    rows.append(
        ReportRow(
            RUN,
            INFO,
            'TOTAL',
            name='sinonimo no_en_fuente',
            detail=str(result.plan.synonyms_not_in_source),
        )
    )
    rows += [
        ReportRow(RUN, INFO, 'RECUENTO', name='generos', detail=str(m.genera)),
        ReportRow(RUN, INFO, 'RECUENTO', name='especies', detail=str(m.species)),
        ReportRow(RUN, INFO, 'RECUENTO', name='especies de COL', detail=str(m.species_col)),
        ReportRow(RUN, INFO, 'RECUENTO', name='sinonimos', detail=str(m.synonyms)),
        ReportRow(RUN, INFO, 'RECUENTO', name='nombres comunes', detail=str(m.common_names)),
        ReportRow(RUN, INFO, 'TAMANO', name='base de datos', detail=str(m.database_bytes)),
    ]
    rows += [
        ReportRow(RUN, INFO, 'TAMANO', name=table, detail=str(m.table_bytes[table]))
        for table in CATALOG_TABLES
    ]
    rows += [
        ReportRow(RUN, INFO, 'TIEMPO', name=phase, detail=f'{seconds:.2f} s')
        for phase, seconds in context['timings'].items()
    ]
    return rows


def write_csv(
    path: Path,
    context: dict[str, Any],
    catalog: Catalog,
    result: LoadResult,
    *,
    include_unchanged: bool = False,
) -> int:
    """Escribe el reporte. Devuelve el número de filas escritas (sin la cabecera)."""
    rows = run_rows(context, result)
    rows += [r for r in result.plan.rows if include_unchanged or r.result != UNCHANGED]
    rows += issue_rows(catalog.issues)
    with path.open('w', encoding='utf-8-sig', newline='') as handle:
        writer = csv.writer(handle)
        writer.writerow(HEADER)
        for row in rows:
            writer.writerow(
                (
                    row.entity,
                    row.result,
                    row.code,
                    row.source_ref,
                    row.name,
                    row.species,
                    row.detail,
                    row.db_id,
                )
            )
    return len(rows)


def format_summary(context: dict[str, Any], catalog: Catalog, result: LoadResult) -> str:
    source = context['source']
    m = result.measures
    counts = result.plan.counts
    version = ', '.join(
        f'{label} {source[key]}'
        for key, label in (('key', 'clave'), ('doi', 'DOI'), ('issued', 'publicada'))
        if source.get(key)
    )
    lines = [
        f'Fuente: {source.get("alias", "sin metadatos de versión")}'
        + (f' ({version})' if version else '')
        + f', archivo {source["file"]}',
        f'Ambiente: {context["target"]}',
        'Modo: ESCRITURA (cambios confirmados)'
        if result.written
        else 'Modo: SIMULACIÓN (transacción revertida: no se escribió nada)',
        '',
    ]
    for entity, label in _ENTITY_LABELS.items():
        parts = [
            f'{counts[(entity, outcome)]} {text}'
            for outcome, text in _RESULT_LABELS.items()
            if counts[(entity, outcome)] or outcome in (NEW, UPDATED, UNCHANGED, CONFLICT)
        ]
        lines.append(f'{label}: ' + ', '.join(parts))
    lines.append(
        f'Sinónimos de especies de COL en la base que esta fuente no trae (se conservan): '
        f'{result.plan.synonyms_not_in_source}'
    )
    discarded = sum(1 for i in catalog.issues if i.action is Action.DISCARDED)
    adjusted = len(catalog.issues) - discarded
    lines += [
        f'Normalización: {discarded} registros descartados y {adjusted} ajustados (en el CSV).',
        '',
        'Base de datos tras la carga'
        + ('' if result.written else ' (medida dentro de la transacción, antes de revertirla)')
        + ':',
        f'  {m.genera} géneros, {m.species} especies ({m.species_col} de COL), '
        f'{m.synonyms} sinónimos y {m.common_names} nombres comunes',
        f'  Tamaño de la base: {megabytes(m.database_bytes)}',
        '  Tablas del catálogo (con índices): '
        + ', '.join(f'{t} {megabytes(m.table_bytes[t])}' for t in CATALOG_TABLES),
        '',
        'Tiempos: '
        + ', '.join(
            f'{phase.replace("_", " ")} {seconds:.1f} s'.replace('.', ',')
            for phase, seconds in context['timings'].items()
        ),
    ]
    return '\n'.join(lines)


def default_report_path(environment: str, started: datetime, written: bool) -> Path:
    mode = 'escritura' if written else 'simulacion'
    return Path(f'reporte-carga-{environment}-{mode}-{started:%Y%m%dT%H%M%SZ}.csv')
