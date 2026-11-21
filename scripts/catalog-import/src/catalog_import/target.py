"""Destino de la carga: ambiente explícito, URL de conexión y protección contra equivocarse.

La URL de la base llega solo por la variable de entorno :data:`URL_VARIABLE`, nunca por
argumento, y no se imprime nunca: los mensajes de error de este módulo no la incluyen, y
:func:`scrub` quita la contraseña de cualquier texto que se vaya a mostrar.

El ambiente se indica siempre (``--ambiente local|dev|prod``) y tiene que coincidir con la
base a la que apunta la URL:

- ``local``: un Postgres en esta máquina (localhost, 127.x.x.x o ::1). Nunca uno de Supabase.
- ``dev`` y ``prod``: el proyecto de Supabase de ese ambiente. El proyecto se reconoce por su
  identificador (ref), que va en el host de la conexión directa (``db.<ref>.supabase.co``) o
  en el usuario del pooler de conexiones (``postgres.<ref>`` en ``*.pooler.supabase.com``).
  Los identificadores son los mismos que comprueba ``scripts/supabase-db.mjs``.

Cualquier parámetro de la URL distinto de ``sslmode`` se rechaza, porque ``host``,
``hostaddr`` o ``service`` podrían llevar la conexión a otro servidor distinto del
comprobado. Por lo mismo, al conectar se ignoran las variables ``PG*`` del entorno.
"""

from __future__ import annotations

import ipaddress
import os
import re
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from enum import StrEnum
from typing import Any
from urllib.parse import parse_qsl, unquote, urlsplit

URL_VARIABLE = 'ORKI_CATALOG_DB_URL'

# Identificadores (ref) de los proyectos de Supabase, los mismos de scripts/supabase-db.mjs.
DEV_REF = 'xaitolsnmjlpyptntfwi'
PROD_REF = 'fzundhfxnbyjbxyhkgtg'

_SUPABASE_DOMAINS = ('supabase.co', 'supabase.com', 'supabase.net')
_DIRECT_HOST = re.compile(r'^db\.([a-z0-9]{20})\.supabase\.co$')
_POOLER_HOST = re.compile(r'^[a-z0-9-]+\.pooler\.supabase\.com$')
_POOLER_USER = re.compile(r'^[a-z_][a-z0-9_]*\.([a-z0-9]{20})$')


class Environment(StrEnum):
    LOCAL = 'local'
    DEV = 'dev'
    PROD = 'prod'


EXPECTED_REF = {Environment.DEV: DEV_REF, Environment.PROD: PROD_REF}


class TargetError(Exception):
    """El destino no es válido o no corresponde al ambiente. El mensaje nunca lleva la URL."""


@dataclass(frozen=True, slots=True)
class Target:
    environment: Environment
    host: str
    port: int
    user: str
    password: str
    database: str
    sslmode: str | None
    # Identificador del proyecto de Supabase, o None en local.
    project_ref: str | None

    def describe(self) -> str:
        """Descripción sin credenciales, para mostrar."""
        where = f'{self.host}:{self.port}/{self.database}'
        if self.project_ref:
            return f'{self.environment} (proyecto {self.project_ref}, {where})'
        return f'{self.environment} ({where})'

    def connect_kwargs(self) -> dict[str, Any]:
        kwargs: dict[str, Any] = {
            'host': self.host,
            'port': self.port,
            'user': self.user,
            'dbname': self.database,
            'connect_timeout': 15,
            'application_name': 'orki-catalogo',
        }
        if self.password:
            kwargs['password'] = self.password
        if self.sslmode:
            kwargs['sslmode'] = self.sslmode
        return kwargs


def is_supabase_host(host: str) -> bool:
    return any(host == d or host.endswith(f'.{d}') for d in _SUPABASE_DOMAINS)


def is_local_host(host: str) -> bool:
    if host == 'localhost':
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def project_ref(host: str, user: str) -> str | None:
    """Identificador del proyecto de Supabase según el host o el usuario, si se reconoce."""
    refs: set[str] = set()
    if direct := _DIRECT_HOST.match(host):
        refs.add(direct.group(1))
    # El usuario «postgres.<ref>» es el del pooler, pero se mira en cualquier host de
    # Supabase: si no coincide con el del host, algo está mal.
    if is_supabase_host(host) and (pooled := _POOLER_USER.match(user)):
        refs.add(pooled.group(1))
    if _POOLER_HOST.match(host) and not refs:
        raise TargetError(
            'La URL apunta al pooler de Supabase pero el usuario no lleva el identificador del '
            'proyecto (postgres.<ref>). No se ha conectado a nada.'
        )
    if len(refs) > 1:
        raise TargetError(
            'El host y el usuario de la URL apuntan a proyectos de Supabase distintos '
            f'({", ".join(sorted(refs))}). No se ha conectado a nada.'
        )
    return refs.pop() if refs else None


def parse_target(url: str | None, environment: Environment) -> Target:
    """Valida la URL frente al ambiente pedido y devuelve los datos de conexión."""
    if not url or not url.strip():
        raise TargetError(
            f'Falta la variable de entorno {URL_VARIABLE} con la URL de la base de datos '
            '(postgresql://usuario:clave@host:puerto/base).'
        )
    try:
        parts = urlsplit(url.strip())
        raw_port = parts.port
    except ValueError:
        raise TargetError(f'{URL_VARIABLE} no es una URL válida.') from None
    if parts.scheme not in ('postgres', 'postgresql'):
        raise TargetError(f'{URL_VARIABLE} debe empezar por postgresql:// o postgres://.')
    host = (parts.hostname or '').lower().rstrip('.')
    if not host:
        raise TargetError(f'{URL_VARIABLE} debe indicar el host.')
    user = unquote(parts.username or '')
    if not user:
        raise TargetError(f'{URL_VARIABLE} debe indicar el usuario.')
    params = parse_qsl(parts.query, keep_blank_values=True)
    for key, _ in params:
        if key != 'sslmode':
            raise TargetError(
                f'{URL_VARIABLE} tiene un parámetro no admitido: «{key}». Solo se admite sslmode.'
            )
    sslmode = dict(params).get('sslmode') or None
    database = unquote(parts.path.lstrip('/')) or 'postgres'

    ref = project_ref(host, user)
    if environment is Environment.LOCAL:
        if is_supabase_host(host):
            raise TargetError(
                f'Se pidió el ambiente local, pero {URL_VARIABLE} apunta a Supabase ({host}). '
                'No se ha conectado a nada.'
            )
        if not is_local_host(host):
            raise TargetError(
                f'Se pidió el ambiente local, pero {URL_VARIABLE} apunta a un host que no es de '
                f'esta máquina ({host}). Solo se aceptan localhost, 127.x.x.x y ::1. '
                'No se ha conectado a nada.'
            )
    else:
        expected = EXPECTED_REF[environment]
        if ref is None:
            raise TargetError(
                f'Se pidió el ambiente {environment}, pero {URL_VARIABLE} no apunta a un proyecto '
                f'de Supabase reconocible (host {host}). Usa la conexión directa '
                '(db.<ref>.supabase.co) o la del pooler (usuario postgres.<ref>). '
                'No se ha conectado a nada.'
            )
        if ref != expected:
            other = next((env for env, r in EXPECTED_REF.items() if r == ref), None)
            what = f'el proyecto de {other}' if other else 'un proyecto que no es de Orki'
            raise TargetError(
                f'Se pidió el ambiente {environment} ({expected}), pero {URL_VARIABLE} apunta '
                f'a {what} ({ref}). No se ha conectado a nada.'
            )
        # Supabase acepta TLS; si la URL no dice nada, se exige.
        sslmode = sslmode or 'require'

    return Target(
        environment=environment,
        host=host,
        port=raw_port or 5432,
        user=user,
        password=unquote(parts.password or ''),
        database=database,
        sslmode=sslmode,
        project_ref=ref,
    )


def scrub(text: str, target: Target | None) -> str:
    """Quita la contraseña de un texto (por si un mensaje de error la arrastrara)."""
    if target is not None and target.password:
        text = text.replace(target.password, '***')
    return text


@contextmanager
def without_pg_environment() -> Iterator[None]:
    """Oculta las variables PG* mientras se conecta, para que libpq solo use la URL validada."""
    saved = {k: v for k, v in os.environ.items() if k.startswith('PG') or k == 'PSQLRC'}
    for key in saved:
        del os.environ[key]
    try:
        yield
    finally:
        os.environ.update(saved)
