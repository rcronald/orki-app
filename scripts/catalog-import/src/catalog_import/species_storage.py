"""Bucket ``species-photos`` de Supabase Storage, por su API y con la clave de servicio.

El bucket no tiene políticas (ver ``supabase/README.md``, «Bucket species-photos»): solo la
clave de servicio sube, lista y borra. La clave llega solo por la variable de entorno
:data:`KEY_VARIABLE` (la misma que ``scripts/fotos-huerfanas.mjs`` y
``scripts/datos-sin-dueno``), nunca por argumento ni de un archivo, y no se imprime nunca.

El proyecto de Storage es el de la base: en ``dev`` y ``prod``, ``https://<ref>.supabase.co``
con el identificador que ya comprobó :mod:`catalog_import.target`; si además está
``SUPABASE_PROJECT_REF``, tiene que ser el mismo. En ``local``, la URL de una pila local de
Supabase en :data:`LOCAL_URL_VARIABLE` (solo un host de esta máquina).

Peticiones (las mismas que hace ``@supabase/storage-js``):

- Comprobar la clave: ``GET /storage/v1/bucket/species-photos`` (los datos del bucket; solo
  lee). Distingue una clave que Storage no acepta (401 o 403, también dentro del cuerpo de un
  400, como el «Invalid Compact JWS» de una clave de otro proyecto o mal copiada) de un bucket
  que no existe (404, o «Bucket not found»).
- Subir: ``POST /storage/v1/object/species-photos/<ruta>`` con ``x-upsert: true`` (repetir una
  subida es inofensivo: el nombre depende solo de la foto) y ``cache-control`` largo.
- Listar: ``POST /storage/v1/object/list/species-photos`` por carpeta.
- Borrar: ``DELETE /storage/v1/object/species-photos`` con la lista de rutas.

Ante un 429, un 5xx o un fallo de red se espera y se reintenta, como con iNaturalist.
"""

from __future__ import annotations

import base64
import contextlib
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol

from .inaturalist import BACKOFF, NO_RESPONSE, RETRY_STATUSES, USER_AGENT
from .target import Environment, Target, is_local_host

BUCKET = 'species-photos'
KEY_VARIABLE = 'SUPABASE_SECRET_KEY'
REF_VARIABLE = 'SUPABASE_PROJECT_REF'
LOCAL_URL_VARIABLE = 'ORKI_STORAGE_URL'
# El contenido de una ruta no cambia nunca (el nombre lleva el id de la foto): un año.
CACHE_CONTROL = '31536000'
LIST_PAGE = 1000
DELETE_BATCH = 100
TIMEOUT = 60.0


class StorageError(Exception):
    """Storage rechazó la operación (no se arregla reintentando). Nunca lleva la clave.

    ``status`` es el estado HTTP y ``detail``, el mensaje de Storage (sin la ruta), para
    comparar dos errores sin que importe a qué archivo afectaron.
    """

    def __init__(self, message: str, status: int | None = None, detail: str = '') -> None:
        super().__init__(message)
        self.status = status
        self.detail = detail


class StorageAuthError(StorageError):
    """Storage no acepta la clave (401 o 403, o un 400 por el token): no depende del archivo,
    así que ninguna otra petición con esa clave va a salir bien."""


class StorageBucketMissing(StorageError):
    """Storage aceptó la clave, pero el proyecto no tiene el bucket."""


class StorageUnavailable(Exception):
    """Storage no respondió tras los reintentos. Hay que volver a ejecutar."""


class StorageConfigError(Exception):
    """Faltan las credenciales de Storage o no son del proyecto de la base."""


@dataclass(frozen=True, slots=True)
class StoredObject:
    path: str
    created_at: datetime | None


class Storage(Protocol):
    """Lo que la carga necesita del bucket. En las pruebas, un doble en memoria."""

    def check(self) -> None: ...

    def upload(self, path: str, data: bytes) -> None: ...

    def list_objects(self) -> list[StoredObject]: ...

    def delete(self, paths: Iterable[str]) -> None: ...


# Credenciales --------------------------------------------------------------------------------


def _jwt_claims(key: str) -> dict[str, Any] | None:
    parts = key.split('.')
    if len(parts) != 3:
        return None
    try:
        padded = parts[1] + '=' * (-len(parts[1]) % 4)
        claims = json.loads(base64.urlsafe_b64decode(padded))
    except (ValueError, json.JSONDecodeError):
        return None
    return claims if isinstance(claims, dict) else None


@dataclass(frozen=True, slots=True)
class StorageConfig:
    base_url: str
    key: str = field(repr=False)

    def describe(self) -> str:
        return f'{self.base_url}/storage/v1 (bucket {BUCKET})'


def storage_config(target: Target, environ: Mapping[str, str]) -> StorageConfig:
    """La URL de Storage del proyecto de la base y la clave de servicio, comprobadas."""
    key = (environ.get(KEY_VARIABLE) or '').strip()
    if not key:
        raise StorageConfigError(
            f'Falta la variable de entorno {KEY_VARIABLE} con la clave secreta del proyecto '
            '(sb_secret_..., o la service_role heredada). Solo hace falta para escribir.'
        )
    if key.startswith('sb_publishable_'):
        raise StorageConfigError(
            f'{KEY_VARIABLE} es una clave publicable: hace falta la secreta (sb_secret_...).'
        )
    claims = _jwt_claims(key)
    if claims is not None:
        if claims.get('role') != 'service_role':
            raise StorageConfigError(
                f'{KEY_VARIABLE} es una clave heredada que no es la service_role.'
            )
        if target.project_ref and claims.get('ref') not in (None, target.project_ref):
            raise StorageConfigError(
                f'{KEY_VARIABLE} es de otro proyecto de Supabase, no de {target.project_ref}.'
            )
    if target.environment is Environment.LOCAL:
        url = (environ.get(LOCAL_URL_VARIABLE) or '').strip().rstrip('/')
        parts = urllib.parse.urlsplit(url)
        if parts.scheme not in ('http', 'https') or not is_local_host(parts.hostname or ''):
            raise StorageConfigError(
                f'En el ambiente local, {LOCAL_URL_VARIABLE} tiene que ser la URL de una pila '
                'local de Supabase (por ejemplo http://127.0.0.1:54321).'
            )
        return StorageConfig(f'{parts.scheme}://{parts.netloc}', key)
    ref = target.project_ref
    declared = (environ.get(REF_VARIABLE) or '').strip()
    if declared and declared != ref:
        raise StorageConfigError(
            f'{REF_VARIABLE} ({declared}) no es el proyecto de la base ({ref}).'
        )
    return StorageConfig(f'https://{ref}.supabase.co', key)


# Cliente HTTP --------------------------------------------------------------------------------

# El transporte recibe método, URL, cabeceras y cuerpo; devuelve el estado y el cuerpo.
Send = Callable[[str, str, Mapping[str, str], bytes | None], tuple[int, bytes]]


def urllib_send(
    method: str, url: str, headers: Mapping[str, str], body: bytes | None
) -> tuple[int, bytes]:
    request = urllib.request.Request(url, data=body, method=method, headers=dict(headers))
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()
    except (urllib.error.URLError, OSError):
        return NO_RESPONSE, b''


# Último recurso para reconocer un error de la clave cuando ni el estado HTTP ni el
# «statusCode» del cuerpo lo dicen: palabras del token o de la autorización en el mensaje.
_AUTH_WORDS = re.compile(
    r'\b(jwt|jws|token|signature|api ?key|unauthori[sz]ed|forbidden)\b', re.IGNORECASE
)


def _rejection(status: int, data: bytes, key: str) -> tuple[type[StorageError], str]:
    """La clase de error y el mensaje de Storage (sin la clave) de una respuesta 4xx.

    Storage responde a veces 400 con el estado real en el cuerpo: por ejemplo, a una clave que
    no es de ese proyecto, ``{"statusCode": "403", "error": "Unauthorized", "message": "Invalid
    Compact JWS"}``; y a un bucket que no existe, ``{"statusCode": "404", "error": "Bucket not
    found", ...}``.
    """
    body: dict[str, Any] = {}
    with contextlib.suppress(ValueError):
        parsed = json.loads(data)
        if isinstance(parsed, dict):
            body = parsed
    message = str(body.get('message') or body.get('error') or '').strip()
    if key:
        message = message.replace(key, '[clave]')
    codes = {status}
    with contextlib.suppress(TypeError, ValueError):
        codes.add(int(body.get('statusCode')))  # type: ignore[arg-type]
    text = f'{body.get("error") or ""} {message}'
    if codes & {401, 403} or _AUTH_WORDS.search(text):
        return StorageAuthError, message
    if re.search(r'bucket not found', text, re.IGNORECASE):
        return StorageBucketMissing, message
    return StorageError, message


def _parse_time(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None


@dataclass(slots=True)
class StorageClient:
    config: StorageConfig
    send: Send = urllib_send
    sleep: Callable[[float], None] = field(default=lambda seconds: time.sleep(seconds))
    uploads: int = 0
    uploaded_bytes: int = 0

    def _request(
        self, method: str, path: str, body: bytes | None, headers: Mapping[str, str]
    ) -> bytes:
        url = f'{self.config.base_url}/storage/v1/{path}'
        full = {
            'Authorization': f'Bearer {self.config.key}',
            'apikey': self.config.key,
            'User-Agent': USER_AGENT,
            **headers,
        }
        for attempt in range(len(BACKOFF) + 1):
            status, data = self.send(method, url, full, body)
            if 200 <= status < 300:
                return data
            if status in RETRY_STATUSES:
                if attempt < len(BACKOFF):
                    self.sleep(BACKOFF[attempt])
                    continue
                what = 'no respondió' if status == NO_RESPONSE else f'respondió {status}'
                raise StorageUnavailable(f'Storage {what} a {method} {path}.')
            kind, message = _rejection(status, data, self.config.key)
            raise kind(
                f'Storage respondió {status} a {method} {path}'
                + (f': {message}' if message else '.'),
                status,
                message,
            )
        raise AssertionError('inalcanzable')  # pragma: no cover

    def check(self) -> None:
        """Comprueba, solo leyendo, que la clave vale para este proyecto y que el bucket existe.

        Lanza :class:`StorageAuthError` si Storage no acepta la clave,
        :class:`StorageBucketMissing` si no tiene el bucket y :class:`StorageUnavailable` si no
        responde.
        """
        try:
            data = self._request('GET', f'bucket/{BUCKET}', None, {})
        except StorageError as problem:
            if problem.status == 404 and type(problem) is StorageError:
                raise StorageBucketMissing(str(problem), 404, problem.detail) from None
            raise
        found: object = None
        with contextlib.suppress(ValueError, AttributeError):
            found = json.loads(data).get('id')
        if found not in (None, BUCKET):
            raise StorageError(f'Storage devolvió otro bucket ({found}) en vez de {BUCKET}.')

    def upload(self, path: str, data: bytes) -> None:
        self._request(
            'POST',
            f'object/{BUCKET}/{urllib.parse.quote(path)}',
            data,
            {
                'Content-Type': 'image/webp',
                'cache-control': f'max-age={CACHE_CONTROL}',
                'x-upsert': 'true',
            },
        )
        self.uploads += 1
        self.uploaded_bytes += len(data)

    def _list(self, prefix: str) -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = []
        offset = 0
        while True:
            body = json.dumps(
                {
                    'prefix': prefix,
                    'limit': LIST_PAGE,
                    'offset': offset,
                    'sortBy': {'column': 'name', 'order': 'asc'},
                }
            ).encode()
            data = self._request(
                'POST', f'object/list/{BUCKET}', body, {'Content-Type': 'application/json'}
            )
            page = json.loads(data)
            if not isinstance(page, list):
                raise StorageError('Storage devolvió un listado que no es una lista.')
            entries.extend(page)
            if len(page) < LIST_PAGE:
                return entries
            offset += LIST_PAGE

    def list_objects(self) -> list[StoredObject]:
        """Todos los objetos del bucket (``<carpeta>/<archivo>``)."""
        objects: list[StoredObject] = []
        for entry in self._list(''):
            name = str(entry.get('name') or '')
            if entry.get('id') is None:
                # Carpeta: Storage la devuelve sin id.
                # Como storage-js (y scripts/fotos-huerfanas.mjs): la carpeta, sin barra final.
                for item in self._list(name):
                    if item.get('id') is not None:
                        objects.append(
                            StoredObject(
                                f'{name}/{item["name"]}', _parse_time(item.get('created_at'))
                            )
                        )
            else:
                objects.append(StoredObject(name, _parse_time(entry.get('created_at'))))
        return objects

    def delete(self, paths: Iterable[str]) -> None:
        batch = list(paths)
        for start in range(0, len(batch), DELETE_BATCH):
            body = json.dumps({'prefixes': batch[start : start + DELETE_BATCH]}).encode()
            self._request('DELETE', f'object/{BUCKET}', body, {'Content-Type': 'application/json'})
