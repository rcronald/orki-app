"""Cliente del bucket species-photos y sus credenciales, sin red (transporte de prueba)."""

from __future__ import annotations

import base64
import json
from collections.abc import Mapping
from datetime import UTC, datetime

import pytest

from catalog_import.inaturalist import BACKOFF, NO_RESPONSE, USER_AGENT
from catalog_import.species_storage import (
    StorageClient,
    StorageConfig,
    StorageConfigError,
    StorageError,
    StorageUnavailable,
    storage_config,
)
from catalog_import.target import DEV_REF, PROD_REF, Environment, parse_target

SECRET = 'sb_secret_prueba-no-es-una-clave'
DEV = parse_target(
    f'postgresql://postgres:x@db.{DEV_REF}.supabase.co:5432/postgres', Environment.DEV
)
LOCAL = parse_target('postgresql://u:x@127.0.0.1:5432/postgres', Environment.LOCAL)


def legacy(**claims: object) -> str:
    def part(data: object) -> str:
        return base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip('=')

    return f'{part({"alg": "HS256"})}.{part(claims)}.firma'


def test_config_for_dev_uses_the_project_of_the_database() -> None:
    config = storage_config(DEV, {'SUPABASE_SECRET_KEY': SECRET})
    assert config.base_url == f'https://{DEV_REF}.supabase.co'
    assert SECRET not in repr(config)
    assert SECRET not in config.describe()
    same = storage_config(DEV, {'SUPABASE_SECRET_KEY': SECRET, 'SUPABASE_PROJECT_REF': DEV_REF})
    assert same == config


@pytest.mark.parametrize(
    ('environ', 'message'),
    [
        ({}, 'Falta la variable de entorno SUPABASE_SECRET_KEY'),
        ({'SUPABASE_SECRET_KEY': 'sb_publishable_abc'}, 'publicable'),
        ({'SUPABASE_SECRET_KEY': legacy(role='anon', ref=DEV_REF)}, 'no es la service_role'),
        ({'SUPABASE_SECRET_KEY': legacy(role='service_role', ref=PROD_REF)}, 'otro proyecto'),
        (
            {'SUPABASE_SECRET_KEY': SECRET, 'SUPABASE_PROJECT_REF': PROD_REF},
            'no es el proyecto de la base',
        ),
    ],
)
def test_config_refuses_wrong_credentials(environ: Mapping[str, str], message: str) -> None:
    with pytest.raises(StorageConfigError, match=message) as raised:
        storage_config(DEV, environ)
    assert SECRET not in str(raised.value)


def test_config_for_local_needs_a_local_stack() -> None:
    environ = {'SUPABASE_SECRET_KEY': legacy(role='service_role')}
    with pytest.raises(StorageConfigError, match='ORKI_STORAGE_URL'):
        storage_config(LOCAL, environ)
    with pytest.raises(StorageConfigError, match='ORKI_STORAGE_URL'):
        storage_config(LOCAL, {**environ, 'ORKI_STORAGE_URL': 'https://abc.supabase.co'})
    config = storage_config(LOCAL, {**environ, 'ORKI_STORAGE_URL': 'http://127.0.0.1:54321/'})
    assert config.base_url == 'http://127.0.0.1:54321'


class Send:
    def __init__(self, *answers: tuple[int, bytes]) -> None:
        self.answers = list(answers)
        self.calls: list[tuple[str, str, dict[str, str], bytes | None]] = []

    def __call__(
        self, method: str, url: str, headers: Mapping[str, str], body: bytes | None
    ) -> tuple[int, bytes]:
        self.calls.append((method, url, dict(headers), body))
        return self.answers.pop(0)


def client(send: Send) -> StorageClient:
    return StorageClient(
        StorageConfig('https://ref.supabase.co', SECRET), send=send, sleep=lambda _: None
    )


def test_upload_request() -> None:
    send = Send((200, b'{"Key": "species-photos/x"}'))
    storage = client(send)
    storage.upload('0f6c1b6e-8b5a-4c3e-9b1a-2d3e4f5a6b7c/medium-12.webp', b'RIFF')
    [(method, url, headers, body)] = send.calls
    assert method == 'POST'
    assert url == (
        'https://ref.supabase.co/storage/v1/object/species-photos/'
        '0f6c1b6e-8b5a-4c3e-9b1a-2d3e4f5a6b7c/medium-12.webp'
    )
    assert headers == {
        'Authorization': f'Bearer {SECRET}',
        'apikey': SECRET,
        'User-Agent': USER_AGENT,
        'Content-Type': 'image/webp',
        'cache-control': 'max-age=31536000',
        'x-upsert': 'true',
    }
    assert body == b'RIFF'
    assert (storage.uploads, storage.uploaded_bytes) == (1, 4)


def test_retries_and_errors_never_carry_the_key() -> None:
    send = Send((503, b''), (NO_RESPONSE, b''), (200, b'{}'))
    client(send).upload('a/b.webp', b'x')
    assert len(send.calls) == 3
    failing = Send(*[(502, b'')] * (len(BACKOFF) + 1))
    with pytest.raises(StorageUnavailable):
        client(failing).upload('a/b.webp', b'x')
    rejected = Send((413, b'{"message": "The object exceeded the maximum allowed size"}'))
    with pytest.raises(StorageError, match=r'413.*maximum allowed size') as raised:
        client(rejected).upload('a/b.webp', b'x')
    assert raised.value.status == 413
    assert SECRET not in str(raised.value)


def test_list_walks_the_folders_and_delete_goes_in_batches() -> None:
    folder = '0f6c1b6e-8b5a-4c3e-9b1a-2d3e4f5a6b7c'
    send = Send(
        (
            200,
            json.dumps([{'name': folder, 'id': None}, {'name': 'suelto.webp', 'id': 'x'}]).encode(),
        ),
        (
            200,
            json.dumps(
                [{'name': 'medium-1.webp', 'id': 'a', 'created_at': '2026-11-20T10:00:00.000Z'}]
            ).encode(),
        ),
    )
    objects = client(send).list_objects()
    assert [(o.path, o.created_at) for o in objects] == [
        (f'{folder}/medium-1.webp', datetime(2026, 11, 20, 10, tzinfo=UTC)),
        ('suelto.webp', None),
    ]
    assert json.loads(send.calls[1][3] or b'{}')['prefix'] == folder
    deleting = Send((200, b'[]'), (200, b'[]'))
    client(deleting).delete(f'p/{i}.webp' for i in range(150))
    assert [len(json.loads(c[3] or b'{}')['prefixes']) for c in deleting.calls] == [100, 50]
    assert all(c[0] == 'DELETE' for c in deleting.calls)
