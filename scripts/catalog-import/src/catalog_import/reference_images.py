"""Imágenes de las fotos de referencia: descarga desde iNaturalist y conversión a WebP.

**Descarga.** Solo del bucket abierto de iNaturalist en AWS
(``https://inaturalist-open-data.s3.amazonaws.com/photos/<id>/medium.<ext>``), que es donde
están las fotos con licencia abierta (Swagger de la API: «Photos in the inaturalist-open-data
domain are shared under open licenses»). Se pide el tamaño ``medium`` (500 px de lado mayor),
el que recomienda ``docs/inaturalist.md``: el original pesa mucho más y no hace falta.
Cortesía, como en la API: como mucho una descarga por segundo, el mismo ``User-Agent``
genérico, reintentos con espera ante 429, 5xx y fallos de red, y un tope de bytes por día
contado en la caché, muy por debajo de lo que pide iNaturalist («Downloading over 5 GB of media
per hour or 24 GB of media per day may result in a permanent block»). Cada imagen descargada se
guarda en una caché en disco, así que repetir una carga no vuelve a descargar nada.

**Conversión.** Con Pillow: se aplica la orientación EXIF, se pasa a sRGB si trae un perfil de
color, se reduce sin ampliar a :data:`MEDIUM_SIDE` px (la versión media) y, de ella, a
:data:`THUMBNAIL_SIDE` px (la miniatura), y se guarda en WebP **sin ningún metadato** (ni EXIF,
ni XMP, ni perfil ICC). Si un archivo pasara de :data:`MAX_BYTES` (el tope del bucket), se baja
la calidad hasta que quepa.
"""

from __future__ import annotations

import io
import re
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from PIL import Image, ImageCms, ImageOps, UnidentifiedImageError

from .inaturalist import BACKOFF, MIN_INTERVAL, NO_RESPONSE, RETRY_STATUSES, USER_AGENT, HttpStatus

IMAGE_HOST = 'inaturalist-open-data.s3.amazonaws.com'
# URL de la versión media de una foto del bucket abierto.
_MEDIUM_URL = re.compile(
    rf'^https://{re.escape(IMAGE_HOST)}/photos/([1-9][0-9]{{0,18}})/medium\.(jpe?g|png|gif|webp)$',
    re.IGNORECASE,
)
SIZE = 'medium'
TIMEOUT = 60.0
# Una versión «medium» ronda los 100 KB (medido en docs/inaturalist.md); más de 5 MB no es una
# foto de 500 px y se rechaza sin leerla entera.
MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024
# Tope de bytes descargados por día (UTC), contado en la caché para todas las ejecuciones del
# día. 4 GiB: menos de lo que iNaturalist tolera en una hora (5 GB) y en un día (24 GB).
DAILY_BYTES = 4 * 1024**3

# Medidas y tope de la base y del bucket (migración 20261124110000_fotos_de_referencia.sql).
MEDIUM_SIDE = 500
THUMBNAIL_SIDE = 160
MEDIUM_LIMIT = 1024
THUMBNAIL_LIMIT = 320
MAX_BYTES = 256 * 1024
MEDIUM_QUALITY = 80
THUMBNAIL_QUALITY = 75
MIN_QUALITY = 40
# Una foto «medium» no pasa de 500 px de lado; esto solo frena una imagen gigante disfrazada.
MAX_PIXELS = 25_000_000


class ImageError(Exception):
    """La imagen no se pudo descargar o convertir y no se arregla reintentando."""


class DownloadsExhausted(Exception):
    """Se llegó al tope de bytes descargados del día. Lo descargado queda en la caché."""


class DownloadsUnavailable(Exception):
    """El bucket de imágenes no respondió tras los reintentos. Hay que volver a ejecutar."""


def medium_url(url: str) -> str:
    """Comprueba que la URL es la versión media de una foto del bucket abierto."""
    if not _MEDIUM_URL.match(url):
        raise ImageError(f'Solo se descargan versiones «medium» de https://{IMAGE_HOST}/: {url}')
    return url


def is_downloadable(url: str) -> bool:
    return bool(_MEDIUM_URL.match(url))


# Descarga ------------------------------------------------------------------------------------

# El transporte recibe la URL y devuelve el cuerpo. Se sustituye en las pruebas.
ImageFetch = Callable[[str], bytes]


def urllib_image_fetch(url: str) -> bytes:
    """Transporte real: un GET con el User-Agent genérico, solo al bucket abierto."""
    medium_url(url)
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'image/*'})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            body = response.read(MAX_DOWNLOAD_BYTES + 1)
    except urllib.error.HTTPError as error:
        retry = error.headers.get('Retry-After')
        try:
            seconds = float(retry) if retry else None
        except ValueError:
            seconds = None
        raise HttpStatus(error.code, seconds) from None
    except (urllib.error.URLError, OSError) as error:
        raise HttpStatus(NO_RESPONSE) from error
    return body


@dataclass(slots=True)
class DownloadStats:
    network: int = 0
    cached: int = 0
    retries: int = 0
    bytes: int = 0


@dataclass(slots=True)
class ImageDownloader:
    """Descargas con caché, ritmo de una por segundo y tope de bytes por día."""

    cache_dir: Path
    fetch: ImageFetch = urllib_image_fetch
    min_interval: float = MIN_INTERVAL
    daily_bytes: int = DAILY_BYTES
    offline: bool = False
    clock: Callable[[], float] = time.monotonic
    sleep: Callable[[float], None] = field(default=lambda seconds: time.sleep(seconds))
    today: Callable[[], str] = field(default=lambda: datetime.now(UTC).date().isoformat())
    stats: DownloadStats = field(default_factory=DownloadStats)
    _last: float | None = None

    def __post_init__(self) -> None:
        if self.min_interval < MIN_INTERVAL:
            raise ValueError(f'El intervalo entre descargas no puede bajar de {MIN_INTERVAL:g} s.')

    def cached_path(self, photo_id: int, url: str) -> Path:
        extension = url.rsplit('.', 1)[-1].lower()
        return self.cache_dir / f'{photo_id}-{SIZE}.{extension}'

    def get(self, photo_id: int, url: str) -> tuple[bytes, datetime]:
        """La imagen y cuándo se descargó (de la caché, si ya estaba)."""
        medium_url(url)
        path = self.cached_path(photo_id, url)
        if path.is_file():
            self.stats.cached += 1
            return path.read_bytes(), datetime.fromtimestamp(path.stat().st_mtime, UTC)
        if self.offline:
            raise DownloadsUnavailable(f'Con --sin-red, falta en la caché la imagen {url}.')
        for attempt in range(len(BACKOFF) + 1):
            self._pace()
            try:
                body = self.fetch(url)
            except HttpStatus as error:
                if error.status in RETRY_STATUSES and attempt < len(BACKOFF):
                    self.stats.retries += 1
                    self.sleep(max(BACKOFF[attempt], error.retry_after or 0.0))
                    continue
                if error.status in RETRY_STATUSES:
                    what = 'no respondió' if error.status == NO_RESPONSE else f'{error.status}'
                    raise DownloadsUnavailable(
                        f'El bucket de imágenes de iNaturalist sigue fallando ({what}) en {url}.'
                    ) from None
                raise ImageError(f'La descarga de {url} respondió {error.status}.') from None
            if len(body) > MAX_DOWNLOAD_BYTES:
                raise ImageError(f'{url} pesa más de {MAX_DOWNLOAD_BYTES} bytes.')
            self._count(len(body))
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix('.tmp')
            temporary.write_bytes(body)
            temporary.replace(path)
            return body, datetime.now(UTC)
        raise AssertionError('inalcanzable')  # pragma: no cover

    def _counter(self) -> Path:
        return self.cache_dir / f'bytes-{self.today()}.txt'

    def _pace(self) -> None:
        counter = self._counter()
        used = int(counter.read_text(encoding='utf-8')) if counter.is_file() else 0
        if used >= self.daily_bytes:
            raise DownloadsExhausted(
                f'Tope de {self.daily_bytes} bytes de imágenes del día {self.today()} (UTC) '
                'alcanzado.'
            )
        if self._last is not None:
            wait = self._last + self.min_interval - self.clock()
            if wait > 0:
                self.sleep(wait)
        self._last = self.clock()
        self.stats.network += 1

    def _count(self, size: int) -> None:
        self.stats.bytes += size
        counter = self._counter()
        used = int(counter.read_text(encoding='utf-8')) if counter.is_file() else 0
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        counter.write_text(str(used + size), encoding='utf-8')


# Conversión ----------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Encoded:
    data: bytes
    width: int
    height: int


@dataclass(frozen=True, slots=True)
class Converted:
    medium: Encoded
    thumbnail: Encoded

    @property
    def bytes(self) -> int:
        return len(self.medium.data) + len(self.thumbnail.data)


def _to_srgb(image: Image.Image) -> Image.Image:
    """Pasa a sRGB una imagen con perfil de color; sin perfil se supone que ya lo es."""
    profile = image.info.get('icc_profile')
    if not profile:
        return image
    try:
        source = ImageCms.ImageCmsProfile(io.BytesIO(profile))
        converted = ImageCms.profileToProfile(
            image, source, ImageCms.createProfile('sRGB'), outputMode=image.mode
        )
    except (ImageCms.PyCMSError, OSError, ValueError):
        return image  # Perfil roto: se usa la imagen tal cual.
    return converted if converted is not None else image


def _encode(image: Image.Image, quality: int) -> Encoded:
    while True:
        buffer = io.BytesIO()
        # Sin exif, xmp ni icc_profile: Pillow solo los escribe si se le pasan.
        image.save(buffer, 'WEBP', quality=quality, method=6)
        data = buffer.getvalue()
        if len(data) <= MAX_BYTES:
            return Encoded(data, image.width, image.height)
        if quality <= MIN_QUALITY:
            raise ImageError(
                f'La imagen sigue pesando {len(data)} bytes con calidad {quality} '
                f'(tope {MAX_BYTES}).'
            )
        quality -= 10


def _fit(image: Image.Image, side: int) -> Image.Image:
    copy = image.copy()
    copy.thumbnail((side, side), Image.Resampling.LANCZOS)
    return copy


def convert(data: bytes) -> Converted:
    """La versión media y la miniatura en WebP, sin metadatos y dentro de los topes."""
    try:
        with Image.open(io.BytesIO(data)) as opened:
            if opened.width * opened.height > MAX_PIXELS:
                raise ImageError(f'La imagen es demasiado grande ({opened.width}×{opened.height}).')
            opened.load()
            image = ImageOps.exif_transpose(opened)
            image = _to_srgb(image)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise ImageError(f'No es una imagen que se pueda leer: {error}') from error
    has_alpha = image.mode in ('RGBA', 'LA') or (image.mode == 'P' and 'transparency' in image.info)
    image = image.convert('RGBA' if has_alpha else 'RGB')
    # Fuera cualquier metadato que se hubiera quedado en la imagen en memoria.
    image.info.clear()
    medium = _fit(image, MEDIUM_SIDE)
    thumbnail = _fit(medium, THUMBNAIL_SIDE)
    result = Converted(_encode(medium, MEDIUM_QUALITY), _encode(thumbnail, THUMBNAIL_QUALITY))
    if (
        max(result.medium.width, result.medium.height) > MEDIUM_LIMIT
        or max(result.thumbnail.width, result.thumbnail.height) > THUMBNAIL_LIMIT
    ):  # pragma: no cover - las medidas de arriba están por debajo
        raise ImageError('La imagen convertida pasa de las medidas máximas.')
    return result
