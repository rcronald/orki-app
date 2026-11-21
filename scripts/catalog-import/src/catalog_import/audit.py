"""Resumen de cada carga con ``--escribir`` en la auditoría del catálogo (#132, parte de #23).

Las cargas por script se conectan sin token de usuario, así que el disparador de la auditoría
no registra sus cambios fila a fila (ver la migración
``20261121140000_auditoria_del_catalogo.sql``). En su lugar, cada carga que escribe deja
**una** fila de resumen con ``private.log_catalog_action()``, en la misma transacción que la
carga: si la carga falla y se revierte, el resumen también.

La fila tiene ``action = 'catalog_import'``, ``actor`` = el identificador de la carga (ver
:func:`load_actor`) y en ``details``:

- ``load_type``: ``catalogo`` (Catalogue of Life) o ``hibridos`` (lista curada).
- ``environment``: ``local``, ``dev`` o ``prod``.
- ``source``: la fuente y su versión (ver :func:`col_source` y :func:`hybrids_source`).
- ``counts``: por tabla (``genera``, ``species`` y ``species_names``), cuántas filas se
  crearon (``created``), se actualizaron (``updated``) y se quedaron sin cambios
  (``unchanged``).
- ``run``: en GitHub Actions, los datos de la ejecución del workflow; en local, ``null``.

Nada de datos personales: ni el usuario del sistema, ni el de GitHub, ni el nombre de la
máquina.
"""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import psycopg

from .load import COMMON_NAME, GENUS, NEW, SPECIES, SYNONYM, UNCHANGED, UPDATED, Plan

ACTION = 'catalog_import'
LOG_FUNCTION = 'private.log_catalog_action(text, jsonb, text, uuid, text)'
AUDIT_MIGRATION = '20261121140000_auditoria_del_catalogo.sql'

CATALOG_LOAD = 'catalogo'
HYBRIDS_LOAD = 'hibridos'

# fuente.json está en la raíz de scripts/catalog-import (el paquete se instala editable).
PINNED_SOURCE = Path(__file__).resolve().parents[2] / 'fuente.json'

# Tabla de la base de cada entidad del reporte. genus_abbreviations no la toca ninguna carga.
TABLE_OF_ENTITY = {
    GENUS: 'genera',
    SPECIES: 'species',
    SYNONYM: 'species_names',
    COMMON_NAME: 'species_names',
}
COUNTED = {NEW: 'created', UPDATED: 'updated', UNCHANGED: 'unchanged'}

LOCAL_PREFIX = 'local:'
GITHUB_PREFIX = 'github-actions:'


class AuditError(Exception):
    """No se puede preparar el resumen de la auditoría. No se ha conectado a nada."""


@dataclass(frozen=True, slots=True)
class LoadAudit:
    """Lo que la carga deja en su fila de resumen, salvo los recuentos (salen del plan)."""

    actor: str
    load_type: str
    environment: str
    source: Mapping[str, Any]
    run: Mapping[str, Any] | None


# Identificador de la carga -------------------------------------------------------------------


def load_actor(environ: Mapping[str, str]) -> tuple[str, dict[str, Any] | None]:
    """Identificador de la carga y, en GitHub Actions, los datos de la ejecución.

    - En GitHub Actions (``GITHUB_ACTIONS=true``): ``github-actions:<GITHUB_RUN_ID>:<intento>``.
      Con el id se llega a la ejecución (``/actions/runs/<id>``); el intento distingue una
      repetición de la misma ejecución. Las variables las pone el propio ejecutor.
    - En cualquier otro caso: ``local:`` y un uuid aleatorio, distinto en cada ejecución.

    Nunca usa ``GITHUB_ACTOR`` ni el usuario o el nombre de la máquina.
    """
    if environ.get('GITHUB_ACTIONS') != 'true':
        return f'{LOCAL_PREFIX}{uuid.uuid4()}', None
    run_id = environ.get('GITHUB_RUN_ID', '')
    run_number = environ.get('GITHUB_RUN_NUMBER', '')
    attempt = environ.get('GITHUB_RUN_ATTEMPT', '') or '1'
    commit = environ.get('GITHUB_SHA', '')
    if not (run_id.isdecimal() and run_number.isdecimal() and attempt.isdecimal()):
        raise AuditError(
            'Se está ejecutando en GitHub Actions, pero GITHUB_RUN_ID, GITHUB_RUN_NUMBER o '
            'GITHUB_RUN_ATTEMPT no son números: no se puede identificar la carga en la auditoría.'
        )
    run: dict[str, Any] = {
        'github_run_id': int(run_id),
        'github_run_number': int(run_number),
        'github_run_attempt': int(attempt),
    }
    if re.fullmatch(r'[0-9a-f]{40}', commit):
        run['commit'] = commit
    return f'{GITHUB_PREFIX}{run_id}:{attempt}', run


# Fuente y versión ----------------------------------------------------------------------------


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def col_source(path: Path, pinned: Path = PINNED_SOURCE) -> dict[str, Any]:
    """Fuente de la carga de COL: la versión fijada en ``fuente.json`` y el archivo cargado.

    ``file_matches_pinned`` dice si el SHA-256 del archivo es el de ``fuente.json`` (el
    workflow lo comprueba antes de cargar; en local se puede cargar otro archivo, y entonces
    la versión de ``fuente.json`` no es la del archivo).
    """
    try:
        data = json.loads(pinned.read_text(encoding='utf-8'))
        fixed = {
            'name': 'Catalogue of Life',
            'alias': str(data['alias']),
            'key': int(data['clave']),
            'doi': str(data['doi']),
            'published': str(data['publicada']),
            'sha256': str(data['sha256']),
        }
    except (OSError, ValueError, KeyError, TypeError) as problem:
        raise AuditError(
            f'No se puede leer la versión fijada de la fuente ({pinned.name}): {problem}'
        ) from problem
    file_sha256 = _sha256(path)
    return {
        **fixed,
        'file': path.name,
        'file_sha256': file_sha256,
        'file_matches_pinned': file_sha256 == fixed['sha256'],
    }


def hybrids_source(path: Path, sha256: str, summary: Mapping[str, Any]) -> dict[str, Any]:
    """Fuente de la carga de híbridos: la lista curada, con su SHA-256 como versión."""
    return {
        'name': 'Lista curada de híbridos',
        'file': path.name,
        'sha256': sha256,
        'entries': summary['entries'],
        'reviewed': summary['reviewed'],
    }


# Recuentos y escritura -----------------------------------------------------------------------


def table_counts(plan: Plan) -> dict[str, dict[str, int]]:
    """Filas creadas, actualizadas y sin cambios por tabla, según el plan.

    El plan es lo que se escribe: :func:`catalog_import.load.apply_plan` comprueba que cada
    sentencia afecta exactamente a las filas previstas.
    """
    counts = {
        table: dict.fromkeys(COUNTED.values(), 0)
        for table in dict.fromkeys(TABLE_OF_ENTITY.values())
    }
    for (entity, outcome), count in plan.counts.items():
        table = TABLE_OF_ENTITY.get(entity)
        if table is not None and outcome in COUNTED:
            counts[table][COUNTED[outcome]] += count
    return counts


def details(audit: LoadAudit, plan: Plan) -> dict[str, Any]:
    return {
        'load_type': audit.load_type,
        'environment': audit.environment,
        'source': dict(audit.source),
        'counts': table_counts(plan),
        'run': dict(audit.run) if audit.run is not None else None,
    }


def audit_ready(conn: psycopg.Connection[Any]) -> bool:
    """¿Tiene la base ``private.log_catalog_action()`` y puede ejecutarla el usuario?"""
    row = conn.execute(
        'select p is not null and has_function_privilege(p, %s) from to_regprocedure(%s) as p',
        ('execute', LOG_FUNCTION),
    ).fetchone()
    return bool(row and row[0])


def missing_audit_message() -> str:
    return (
        'La base no tiene la auditoría del catálogo (falta private.log_catalog_action(), de la '
        f'migración {AUDIT_MIGRATION}) o el usuario no puede usarla. Una carga con --escribir '
        'deja su resumen en la auditoría, así que no se escribe nada hasta que la migración '
        'esté aplicada. La simulación sí funciona.'
    )


def log_load(conn: psycopg.Connection[Any], audit: LoadAudit, plan: Plan) -> str:
    """Inserta la fila de resumen en la transacción en curso. Devuelve su ``action_id``."""
    row = conn.execute(
        'select private.log_catalog_action(%s, %s::jsonb, null, null, %s)',
        (ACTION, json.dumps(details(audit, plan), ensure_ascii=False), audit.actor),
    ).fetchone()
    assert row is not None
    return str(row[0])
