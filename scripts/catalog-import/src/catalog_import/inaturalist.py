"""Lectura de solo lectura de la API pública de iNaturalist (``api.inaturalist.org/v1``).

Lo que se usa y por qué está en ``docs/inaturalist.md``. En resumen:

- Solo peticiones ``GET`` sin autenticación, y solo a ``api.inaturalist.org``: cualquier otro
  host se rechaza antes de conectar. No se descarga ninguna imagen: de cada foto se guardan su
  identificador, su licencia, su autor y sus URL.
- Ritmo: como mucho una petición por segundo (``--intervalo`` no deja bajar de ahí) y un tope
  de peticiones por día, contado en la propia caché (iNaturalist pide unas 10 000 al día).
- ``User-Agent`` genérico, con el nombre de la herramienta y sin datos de nadie.
- Caché en disco, fuera del repositorio: cada respuesta se guarda comprimida con su URL, así
  que repetir una ejecución no vuelve a pedir nada y una ejecución cortada (por el tope, un
  error o a mano) sigue donde se quedó.
- Ante un 429, un error 5xx o un fallo de red se espera (lo que diga ``Retry-After``, o más)
  y se reintenta unas pocas veces; si sigue fallando, se para con un error.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

API_HOST = 'api.inaturalist.org'
API_BASE = f'https://{API_HOST}/v1/'
# Genérico a propósito: el nombre de la herramienta y qué hace, sin nombre, correo ni
# repositorio de nadie (iNaturalist pide un User-Agent que distinga la aplicación).
USER_AGENT = 'orki-catalogo/0.1 (emparejamiento de fotos de referencia; solo lectura)'
# Familia Orchidaceae en iNaturalist: https://www.inaturalist.org/taxa/47217
ORCHIDACEAE = 47217
# Licencias aceptadas por el responsable (#180, comentario del 23 de noviembre de 2026): CC0,
# dominio público («pd»), CC BY y CC BY-SA. Fuera las «no comercial» (NC), las «sin obra
# derivada» (ND) y todos los derechos reservados (license_code nulo). Son las mismas que admite
# la restricción species_photos_license_accepted de la base.
ACCEPTED_LICENSES = frozenset({'cc0', 'pd', 'cc-by', 'cc-by-sa'})
# Filtro «photo_license» de la búsqueda de observaciones: los valores que documenta el Swagger
# son las licencias Creative Commons y «cc0»; la marca de dominio público no está entre ellos,
# así que no se pide (una foto «pd» de observación no se encuentra por esta vía).
OBSERVATION_LICENSE_FILTER = ('cc-by', 'cc-by-sa', 'cc0')
# Ritmo: «about 1 per second» y «around 10k API requests a day» (prácticas recomendadas de la
# API). Se deja un margen por debajo del tope diario.
MIN_INTERVAL = 1.0
DAILY_LIMIT = 9_000
PER_PAGE = 200
# /v1/taxa/{ids} devuelve como mucho 30 taxones por petición.
DETAIL_BATCH = 30
# Esperas antes de cada reintento ante 429 o 5xx, en segundos.
BACKOFF = (10.0, 30.0, 90.0)
# Estado ficticio para «no hubo respuesta» (error de red o tiempo agotado).
NO_RESPONSE = 0
RETRY_STATUSES = frozenset({NO_RESPONSE, 429, 500, 502, 503, 504})
TIMEOUT = 60.0
INFRASPECIFIC_RANKS = frozenset({'subspecies', 'variety', 'form'})
PHOTO_PAGE = 'https://www.inaturalist.org/photos/{id}'
TAXON_PAGE = 'https://www.inaturalist.org/taxa/{id}'


class ApiError(Exception):
    """La API respondió con un error que no se arregla reintentando, o la respuesta no se
    entiende."""


class BudgetExhausted(Exception):
    """Se llegó al tope de peticiones de la ejecución o del día. Lo ya pedido queda en la
    caché: la siguiente ejecución sigue desde ahí."""


class OfflineMiss(Exception):
    """Con ``--sin-red``, la respuesta pedida no está en la caché."""


class HttpStatus(Exception):
    """Respuesta HTTP que no es 200, como la ve el transporte."""

    def __init__(self, status: int, retry_after: float | None = None) -> None:
        super().__init__(status)
        self.status = status
        self.retry_after = retry_after


# El transporte recibe la URL y devuelve el cuerpo. Se sustituye en las pruebas.
Fetch = Callable[[str], bytes]


def urllib_fetch(url: str) -> bytes:
    """Transporte real: un GET con el User-Agent genérico, solo a la API de iNaturalist."""
    check_url(url)
    request = urllib.request.Request(
        url, headers={'User-Agent': USER_AGENT, 'Accept': 'application/json'}
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        raise HttpStatus(error.code, _retry_after(error.headers.get('Retry-After'))) from None
    except (urllib.error.URLError, OSError) as error:
        # Sin respuesta (tiempo agotado, conexión cortada): se reintenta como un 5xx.
        raise HttpStatus(NO_RESPONSE) from error


def check_url(url: str) -> None:
    """Solo HTTPS y solo ``api.inaturalist.org``: el acceso a la red es de solo lectura y solo
    a iNaturalist."""
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != 'https' or parts.hostname != API_HOST:
        raise ApiError(f'Solo se admiten peticiones a https://{API_HOST}/ y no a {url}.')


def _retry_after(value: str | None) -> float | None:
    try:
        return float(value) if value else None
    except ValueError:
        return None


def build_url(path: str, params: dict[str, str | int] | None = None) -> str:
    """URL con los parámetros en orden, para que la misma consulta dé la misma clave de
    caché."""
    query = urllib.parse.urlencode(sorted((params or {}).items()), safe=',')
    return API_BASE + path + (f'?{query}' if query else '')


@dataclass(slots=True)
class ClientStats:
    network: int = 0
    cached: int = 0
    retries: int = 0


@dataclass(slots=True)
class Client:
    """Cliente de la API con caché, ritmo y tope de peticiones."""

    cache_dir: Path
    fetch: Fetch = urllib_fetch
    min_interval: float = MIN_INTERVAL
    max_requests: int = DAILY_LIMIT
    daily_limit: int = DAILY_LIMIT
    offline: bool = False
    clock: Callable[[], float] = time.monotonic
    # Se busca time.sleep al llamarla (no al definir la clase), para poder sustituirla.
    sleep: Callable[[float], None] = field(default=lambda seconds: time.sleep(seconds))
    today: Callable[[], str] = field(default=lambda: datetime.now(UTC).date().isoformat())
    stats: ClientStats = field(default_factory=ClientStats)
    _last: float | None = None

    def __post_init__(self) -> None:
        if self.min_interval < MIN_INTERVAL:
            raise ValueError(f'El intervalo entre peticiones no puede bajar de {MIN_INTERVAL:g} s.')

    def get(self, path: str, params: dict[str, str | int] | None = None) -> dict[str, Any]:
        url = build_url(path, params)
        check_url(url)
        cached = self._read_cache(url)
        if cached is not None:
            self.stats.cached += 1
            return cached
        if self.offline:
            raise OfflineMiss(url)
        for attempt in range(len(BACKOFF) + 1):
            self._spend()
            try:
                body = self.fetch(url)
            except HttpStatus as error:
                if error.status in RETRY_STATUSES and attempt < len(BACKOFF):
                    self.stats.retries += 1
                    self.sleep(max(BACKOFF[attempt], error.retry_after or 0.0))
                    continue
                what = (
                    'no respondió' if error.status == NO_RESPONSE else f'respondió {error.status}'
                )
                raise ApiError(f'La API {what} a {url}.') from None
            try:
                data = json.loads(body)
            except ValueError as error:
                raise ApiError(f'La respuesta de {url} no es JSON.') from error
            if not isinstance(data, dict):
                raise ApiError(f'La respuesta de {url} no es un objeto JSON.')
            self._write_cache(url, data)
            return data
        raise AssertionError('inalcanzable')  # pragma: no cover

    # Ritmo y tope ---------------------------------------------------------------------------

    def _spend(self) -> None:
        if self.stats.network >= self.max_requests:
            raise BudgetExhausted(
                f'Tope de {self.max_requests} peticiones de esta ejecución alcanzado.'
            )
        day = self.today()
        counter = self.cache_dir / f'peticiones-{day}.txt'
        used = int(counter.read_text(encoding='utf-8')) if counter.is_file() else 0
        if used >= self.daily_limit:
            raise BudgetExhausted(
                f'Tope de {self.daily_limit} peticiones del día {day} (UTC) alcanzado.'
            )
        if self._last is not None:
            wait = self._last + self.min_interval - self.clock()
            if wait > 0:
                self.sleep(wait)
        self._last = self.clock()
        self.stats.network += 1
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        counter.write_text(str(used + 1), encoding='utf-8')

    # Caché ----------------------------------------------------------------------------------

    def _cache_path(self, url: str) -> Path:
        digest = hashlib.sha256(url.encode('utf-8')).hexdigest()
        return self.cache_dir / digest[:2] / f'{digest}.json.gz'

    def _read_cache(self, url: str) -> dict[str, Any] | None:
        path = self._cache_path(url)
        if not path.is_file():
            return None
        try:
            entry = json.loads(gzip.decompress(path.read_bytes()))
        except (OSError, ValueError):
            return None  # Entrada corrupta (por ejemplo, una escritura cortada): se repite.
        if entry.get('url') != url:
            return None
        return entry['body']

    def _write_cache(self, url: str, data: dict[str, Any]) -> None:
        path = self._cache_path(url)
        path.parent.mkdir(parents=True, exist_ok=True)
        entry = {'url': url, 'fetched_at': datetime.now(UTC).isoformat(), 'body': data}
        temporary = path.with_suffix('.tmp')
        temporary.write_bytes(gzip.compress(json.dumps(entry, ensure_ascii=False).encode()))
        temporary.replace(path)


# Modelo -------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Photo:
    id: int
    # Código de iNaturalist («cc0», «cc-by», «cc-by-nc»…); None es «todos los derechos
    # reservados».
    license: str | None
    # Texto de atribución que da iNaturalist («(c) Nombre, some rights reserved (CC BY)»).
    attribution: str
    # Nombre del autor (o su usuario), si se conoce.
    author: str | None
    # URL de la versión «square»; las demás se construyen cambiando el tamaño.
    square_url: str
    flagged: bool = False
    # Observación de la que sale, si se buscó en las observaciones.
    observation_id: int | None = None

    @property
    def accepted(self) -> bool:
        return self.license in ACCEPTED_LICENSES

    def url(self, size: str) -> str:
        """URL de otro tamaño (original, large, medium, small, thumb, square)."""
        return self.square_url.replace('/square.', f'/{size}.', 1)

    @property
    def page_url(self) -> str:
        return PHOTO_PAGE.format(id=self.id)


@dataclass(frozen=True, slots=True)
class Taxon:
    id: int
    name: str
    rank: str
    is_active: bool
    # Nombres científicos que iNaturalist marca como no válidos para este taxón (sinónimos).
    synonyms: tuple[str, ...]
    # Si el taxón está inactivo, los activos que lo sustituyen.
    current_ids: tuple[int, ...]
    default_photo: Photo | None
    observations_count: int

    @property
    def page_url(self) -> str:
        return TAXON_PAGE.format(id=self.id)


def parse_photo(data: dict[str, Any], *, author: str | None = None) -> Photo | None:
    url = data.get('url') or data.get('square_url')
    if not isinstance(data.get('id'), int) or not url:
        return None
    if '/square.' not in url:
        # Las búsquedas de observaciones dan la URL en «square»; si no, se deduce del tamaño.
        for size in ('thumb', 'small', 'medium', 'large', 'original'):
            url = url.replace(f'/{size}.', '/square.', 1)
    return Photo(
        id=data['id'],
        license=data.get('license_code') or None,
        attribution=data.get('attribution') or '',
        author=data.get('attribution_name') or author,
        square_url=url,
        flagged=bool(data.get('flags')) or bool(data.get('hidden')),
    )


def parse_taxon(data: dict[str, Any]) -> Taxon:
    names = data.get('names') or []
    synonyms = tuple(
        sorted(
            {
                n['name']
                for n in names
                if n.get('lexicon') == 'scientific-names'
                and not n.get('is_valid', True)
                and n.get('name')
                and n['name'] != data['name']
            }
        )
    )
    photo = data.get('default_photo')
    return Taxon(
        id=data['id'],
        name=data['name'],
        rank=data.get('rank') or '',
        is_active=bool(data.get('is_active', True)),
        synonyms=synonyms,
        current_ids=tuple(data.get('current_synonymous_taxon_ids') or ()),
        default_photo=parse_photo(photo) if isinstance(photo, dict) else None,
        observations_count=int(data.get('observations_count') or 0),
    )


# Consultas ----------------------------------------------------------------------------------


def find_genus(client: Client, name: str, *, within: int = ORCHIDACEAE) -> Taxon | None:
    """El género (o nothogénero) activo con ese nombre, sin distinguir mayúsculas ni el «×»."""
    from .names import match_key

    data = client.get(
        'taxa',
        {'q': name, 'rank': 'genus,genushybrid', 'taxon_id': within, 'per_page': 30},
    )
    key = match_key(name)
    hits = [
        parse_taxon(r)
        for r in data.get('results', [])
        if match_key(r.get('name', '')) == key and r.get('is_active', True)
    ]
    return hits[0] if len(hits) == 1 else None


def iter_taxa(
    client: Client, ancestor_id: int, ranks: Iterable[str] = ('species', 'hybrid')
) -> Iterator[Taxon]:
    """Todos los taxones de esos rangos bajo ``ancestor_id``, activos e inactivos, con sus
    nombres científicos.

    Pagina por identificador (``order_by=id`` e ``id_above``), como recomienda iNaturalist para
    pasar de 10 000 resultados, con el máximo de 200 por página.
    """
    last = 0
    while True:
        data = client.get(
            'taxa',
            {
                'taxon_id': ancestor_id,
                'rank': ','.join(ranks),
                'is_active': 'any',
                'all_names': 'true',
                'per_page': PER_PAGE,
                'order_by': 'id',
                'order': 'asc',
                'id_above': last,
            },
        )
        results = data.get('results') or []
        for item in results:
            yield parse_taxon(item)
        if len(results) < PER_PAGE:
            return
        last = results[-1]['id']


def taxon_photos(
    client: Client, ids: Iterable[int], *, into: dict[int, list[Photo]] | None = None
) -> dict[int, list[Photo]]:
    """Las fotos que la comunidad eligió para cada taxón (``taxon_photos``), en su orden.

    Se piden en el orden dado, en lotes de 30. ``into`` se va llenando lote a lote, así que
    conserva lo leído aunque una petición posterior corte la búsqueda.
    """
    ids = list(dict.fromkeys(ids))
    photos: dict[int, list[Photo]] = {} if into is None else into
    for start in range(0, len(ids), DETAIL_BATCH):
        batch = sorted(ids[start : start + DETAIL_BATCH])
        data = client.get('taxa/' + ','.join(str(i) for i in batch))
        for item in data.get('results') or []:
            photos[item['id']] = [
                photo
                for tp in item.get('taxon_photos') or []
                if (photo := parse_photo(tp.get('photo') or {})) is not None
            ]
    return photos


def observation_photo(client: Client, taxon: Taxon) -> Photo | None:
    """Una foto con licencia aceptada de una observación con grado de investigación del
    propio taxón (o de una subespecie, variedad o forma suya), la más votada.

    ``taxon_id`` incluye los descendientes, también los híbridos que cuelgan de la especie
    («Calypso bulbosa × kostiukiae» sale al pedir Calypso bulbosa): se descartan.
    """
    data = client.get(
        'observations',
        {
            'taxon_id': taxon.id,
            'photo_license': ','.join(OBSERVATION_LICENSE_FILTER),
            'quality_grade': 'research',
            'photos': 'true',
            'order_by': 'votes',
            'order': 'desc',
            'per_page': 10,
        },
    )
    for observation in data.get('results') or []:
        observed = observation.get('taxon') or {}
        if observed.get('id') != taxon.id and observed.get('rank') not in INFRASPECIFIC_RANKS:
            continue
        user = observation.get('user') or {}
        author = user.get('name') or user.get('login') or None
        for item in observation.get('photos') or []:
            photo = parse_photo(item, author=author)
            if photo is None or not photo.accepted or photo.flagged:
                continue
            return Photo(
                id=photo.id,
                license=photo.license,
                attribution=photo.attribution,
                author=photo.author,
                square_url=photo.square_url,
                observation_id=observation.get('id'),
            )
    return None
