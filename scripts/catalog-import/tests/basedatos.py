"""Bases de datos desechables para las pruebas de integración de la carga.

Hace lo mismo que ``scripts/db-desechable`` (que usa ``npm run db:test``), en Python, para
que el job de Python del CI no necesite Node: sobre el servidor de ``ORKI_TEST_DB_URL``
(un Postgres local con un superusuario) crea una base plantilla con lo mínimo de Supabase
(``scripts/db-desechable/supabase-minimo.sql``) y todas las migraciones de
``supabase/migrations``, cada una en su transacción y con el rol ``postgres``, como la CLI
de Supabase. Cada prueba trabaja en una copia nueva de esa plantilla, que se borra al
terminar.

Solo se aceptan servidores locales (las mismas reglas que ``--ambiente local``), nunca uno de
Supabase.
"""

from __future__ import annotations

import contextlib
import os
import secrets
from collections.abc import Iterator
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any
from urllib.parse import quote

import psycopg
from psycopg import sql

from catalog_import.target import Environment, Target, parse_target, without_pg_environment

REPO = Path(__file__).resolve().parents[3]
MIGRATIONS = REPO / 'supabase' / 'migrations'
SUPABASE_MINIMUM = REPO / 'scripts' / 'db-desechable' / 'supabase-minimo.sql'
SIMULATED_ROLES = ('anon', 'authenticated', 'service_role', 'postgres')
URL_VARIABLE = 'ORKI_TEST_DB_URL'


def connect(target: Target, *, autocommit: bool = True) -> psycopg.Connection[Any]:
    with without_pg_environment():
        return psycopg.connect(**target.connect_kwargs(), autocommit=autocommit)


def url_of(target: Target) -> str:
    """URL de una base de pruebas, para pasarla al comando en ORKI_CATALOG_DB_URL."""
    password = f':{quote(target.password, safe="")}' if target.password else ''
    host = f'[{target.host}]' if ':' in target.host else target.host
    return (
        f'postgresql://{quote(target.user, safe="")}{password}@{host}:{target.port}/'
        f'{quote(target.database, safe="")}'
    )


@dataclass
class Server:
    target: Target
    template: str
    created_roles: list[str]

    def new_database(self) -> Target:
        name = f'orki_carga_{secrets.token_hex(6)}'
        with connect(self.target) as conn:
            conn.execute(
                sql.SQL('create database {} template {}').format(
                    sql.Identifier(name), sql.Identifier(self.template)
                )
            )
        return replace(self.target, database=name)

    def drop_database(self, name: str) -> None:
        with connect(self.target) as conn:
            conn.execute(
                sql.SQL('drop database if exists {} with (force)').format(sql.Identifier(name))
            )


def server_from_environment() -> Target | None:
    url = os.environ.get(URL_VARIABLE)
    if not url:
        return None
    return parse_target(url, Environment.LOCAL)


def prepare_server(target: Target) -> Server:
    with connect(target) as conn:
        row = conn.execute('select rolsuper from pg_roles where rolname = current_user').fetchone()
        if not row or not row[0]:
            raise RuntimeError(f'El usuario de {URL_VARIABLE} tiene que ser superusuario.')
        existing = {
            r[0]
            for r in conn.execute(
                'select rolname from pg_roles where rolname = any(%s)', (list(SIMULATED_ROLES),)
            )
        }
        template = f'orki_carga_plantilla_{secrets.token_hex(6)}'
        conn.execute(
            sql.SQL("create database {} template template0 encoding 'UTF8'").format(
                sql.Identifier(template)
            )
        )
    server = Server(target, template, [r for r in SIMULATED_ROLES if r not in existing])
    try:
        with connect(replace(target, database=template), autocommit=False) as conn:
            with conn.transaction():
                conn.execute(SUPABASE_MINIMUM.read_text(encoding='utf-8'))
            for migration in sorted(MIGRATIONS.glob('*.sql')):
                with conn.transaction():
                    conn.execute('set local role postgres')
                    conn.execute(migration.read_text(encoding='utf-8'))
    except BaseException:
        cleanup_server(server)
        raise
    return server


def cleanup_server(server: Server) -> None:
    server.drop_database(server.template)
    with connect(server.target) as conn:
        for role in server.created_roles:
            # Si otra base del servidor los usa todavía, se quedan.
            with contextlib.suppress(psycopg.Error):
                conn.execute(sql.SQL('drop role if exists {}').format(sql.Identifier(role)))


def rows(target: Target, query: Any, params: Any = None) -> list[tuple[Any, ...]]:
    with connect(target) as conn:
        return conn.execute(query, params).fetchall()


def execute(target: Target, statements: str, params: Any = None) -> None:
    with connect(target) as conn:
        conn.execute(statements, params)


def catalog_state(target: Target) -> dict[str, list[tuple[Any, ...]]]:
    """Todas las filas del catálogo y de las plantas, con todas sus columnas (también
    updated_at), para comparar antes y después."""
    state = {}
    for table in ('genera', 'genus_abbreviations', 'species', 'species_names', 'plants'):
        state[table] = rows(
            target, sql.SQL('select * from public.{} order by id').format(sql.Identifier(table))
        )
    return state


def iterate(server: Server) -> Iterator[Target]:
    target = server.new_database()
    try:
        yield target
    finally:
        server.drop_database(target.database)
