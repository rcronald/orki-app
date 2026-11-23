"""Descarga y conversión de las fotos de referencia, sin red: las imágenes se generan aquí."""

from __future__ import annotations

import io
import random
from pathlib import Path

import pytest
from PIL import Image, ImageCms

from catalog_import.inaturalist import BACKOFF, NO_RESPONSE, USER_AGENT, HttpStatus
from catalog_import.reference_images import (
    MAX_BYTES,
    THUMBNAIL_SIDE,
    DownloadsExhausted,
    DownloadsUnavailable,
    ImageDownloader,
    ImageError,
    convert,
    is_downloadable,
    medium_url,
    urllib_image_fetch,
)

URL = 'https://inaturalist-open-data.s3.amazonaws.com/photos/{id}/medium.jpg'


def jpeg(width: int, height: int, *, orientation: int | None = None, icc: bool = False) -> bytes:
    """Una foto «de verdad»: degradado con ruido, con EXIF (cámara, GPS ficticio, orientación)
    y, si se pide, un perfil de color incrustado."""
    across = Image.linear_gradient('L').rotate(90).resize((width, height))
    down = Image.linear_gradient('L').resize((width, height))
    image = Image.merge('RGB', (across, down, Image.effect_noise((width, height), 60)))
    exif = Image.Exif()
    exif[0x010F] = 'Fabricante de prueba'  # Make
    exif[0x0110] = 'Cámara de prueba'  # Model
    exif[0x8825] = {1: 'S', 2: (12.0, 3.0, 0.0)}  # GPSInfo
    if orientation:
        exif[0x0112] = orientation
    buffer = io.BytesIO()
    extra: dict[str, object] = {'exif': exif.tobytes(), 'quality': 92}
    if icc:
        extra['icc_profile'] = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
    image.save(buffer, 'JPEG', **extra)
    return buffer.getvalue()


def webp_chunks(data: bytes) -> set[bytes]:
    """Los identificadores de los bloques RIFF de un WebP (VP8, VP8L, VP8X, EXIF, ICCP…)."""
    assert data[:4] == b'RIFF'
    assert data[8:12] == b'WEBP'
    chunks, offset = set(), 12
    while offset + 8 <= len(data):
        name = data[offset : offset + 4]
        size = int.from_bytes(data[offset + 4 : offset + 8], 'little')
        chunks.add(name)
        offset += 8 + size + (size & 1)
    return chunks


@pytest.fixture(scope='module')
def large_photo() -> bytes:
    # Más grande que el original de iNaturalist (2048 px): 3000×2000, con orientación 6
    # (girada 90°) y perfil de color.
    return jpeg(3000, 2000, orientation=6, icc=True)


def test_large_real_image_is_reduced_within_limits_without_metadata(large_photo: bytes) -> None:
    assert len(large_photo) > MAX_BYTES  # el archivo de entrada no cabría en el bucket
    result = convert(large_photo)
    # La orientación EXIF se aplica: la foto pasa a vertical antes de reducirla.
    assert (result.medium.width, result.medium.height) == (333, 500)
    assert (result.thumbnail.width, result.thumbnail.height) == (107, 160)
    for encoded in (result.medium, result.thumbnail):
        assert len(encoded.data) <= MAX_BYTES
        with Image.open(io.BytesIO(encoded.data)) as image:
            assert image.format == 'WEBP'
            assert image.size == (encoded.width, encoded.height)
            assert not image.getexif()
            assert not {'exif', 'icc_profile', 'xmp'} & set(image.info)
        assert not {b'EXIF', b'ICCP', b'XMP '} & webp_chunks(encoded.data)
        assert b'Fabricante de prueba' not in encoded.data
    assert result.bytes == len(result.medium.data) + len(result.thumbnail.data)


def test_small_image_is_not_enlarged() -> None:
    result = convert(jpeg(200, 100))
    assert (result.medium.width, result.medium.height) == (200, 100)
    assert (result.thumbnail.width, result.thumbnail.height) == (THUMBNAIL_SIDE, 80)


def test_noise_is_compressed_below_the_bucket_limit() -> None:
    rng = random.Random(7)
    image = Image.frombytes('RGB', (500, 500), bytes(rng.randrange(256) for _ in range(750_000)))
    buffer = io.BytesIO()
    image.save(buffer, 'PNG')
    result = convert(buffer.getvalue())
    assert len(result.medium.data) <= MAX_BYTES


def test_transparency_is_kept() -> None:
    image = Image.new('RGBA', (40, 20), (10, 20, 30, 0))
    buffer = io.BytesIO()
    image.save(buffer, 'PNG')
    with Image.open(io.BytesIO(convert(buffer.getvalue()).medium.data)) as out:
        assert out.mode == 'RGBA'


def test_not_an_image() -> None:
    with pytest.raises(ImageError, match='No es una imagen'):
        convert(b'<html>no soy una foto</html>')


def test_only_medium_versions_of_the_open_bucket() -> None:
    assert is_downloadable(URL.format(id=12))
    assert is_downloadable('https://inaturalist-open-data.s3.amazonaws.com/photos/1/medium.jpeg')
    for url in (
        'https://static.inaturalist.org/photos/12/medium.jpg',  # sin licencia abierta
        'https://inaturalist-open-data.s3.amazonaws.com/photos/12/original.jpg',
        'https://inaturalist-open-data.s3.amazonaws.com/photos/12/square.jpg',
        'http://inaturalist-open-data.s3.amazonaws.com/photos/12/medium.jpg',
        'https://farm1.staticflickr.com/1/2_medium.jpg',
    ):
        assert not is_downloadable(url)
        with pytest.raises(ImageError):
            medium_url(url)
    with pytest.raises(ImageError):
        urllib_image_fetch('https://example.com/photos/1/medium.jpg')


class Transport:
    def __init__(self, answers: dict[str, list[object]]) -> None:
        self.answers = answers
        self.calls: list[str] = []

    def __call__(self, url: str) -> bytes:
        self.calls.append(url)
        answer = self.answers[url].pop(0)
        if isinstance(answer, Exception):
            raise answer
        assert isinstance(answer, bytes)
        return answer


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0
        self.waits: list[float] = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.waits.append(seconds)
        self.now += seconds


def downloader(tmp_path: Path, transport: Transport, **extra: object) -> ImageDownloader:
    clock = Clock()
    return ImageDownloader(
        tmp_path / 'imagenes',
        fetch=transport,
        clock=clock,
        sleep=clock.sleep,
        today=lambda: '2026-11-23',
        **extra,  # type: ignore[arg-type]
    )


def test_downloads_are_cached_paced_and_counted(tmp_path: Path) -> None:
    one, two = URL.format(id=1), URL.format(id=2)
    transport = Transport({one: [b'uno'], two: [b'dos!']})
    images = downloader(tmp_path, transport)
    assert images.get(1, one)[0] == b'uno'
    assert images.get(2, two)[0] == b'dos!'
    assert images.get(1, one)[0] == b'uno'  # de la caché
    assert transport.calls == [one, two]
    assert images.sleep.__self__.waits == [1.0]  # type: ignore[attr-defined]
    assert (images.stats.network, images.stats.cached, images.stats.bytes) == (2, 1, 7)
    assert (tmp_path / 'imagenes' / 'bytes-2026-11-23.txt').read_text() == '7'
    # Otra ejecución el mismo día lee la imagen de la caché sin pedir nada.
    again = downloader(tmp_path, Transport({}))
    assert again.get(2, two)[0] == b'dos!'


def test_downloads_retry_and_then_stop(tmp_path: Path) -> None:
    url = URL.format(id=3)
    transport = Transport({url: [HttpStatus(503), HttpStatus(429, 45.0), b'ok']})
    images = downloader(tmp_path, transport)
    assert images.get(3, url)[0] == b'ok'
    assert images.sleep.__self__.waits[:2] == [BACKOFF[0], 45.0]  # type: ignore[attr-defined]
    failing = Transport({URL.format(id=4): [HttpStatus(NO_RESPONSE)] * (len(BACKOFF) + 1)})
    with pytest.raises(DownloadsUnavailable):
        downloader(tmp_path / 'otra', failing).get(4, URL.format(id=4))
    gone = Transport({URL.format(id=5): [HttpStatus(404)]})
    with pytest.raises(ImageError, match='404'):
        downloader(tmp_path / 'otra2', gone).get(5, URL.format(id=5))


def test_daily_byte_limit_and_offline(tmp_path: Path) -> None:
    one, two = URL.format(id=1), URL.format(id=2)
    images = downloader(tmp_path, Transport({one: [b'12345'], two: [b'x']}), daily_bytes=5)
    images.get(1, one)
    with pytest.raises(DownloadsExhausted):
        images.get(2, two)
    offline = downloader(tmp_path, Transport({}), offline=True)
    assert offline.get(1, one)[0] == b'12345'
    with pytest.raises(DownloadsUnavailable, match='--sin-red'):
        offline.get(2, two)


def test_user_agent_is_generic() -> None:
    assert USER_AGENT.startswith('orki-catalogo/')
    assert '@' not in USER_AGENT
    assert 'github' not in USER_AGENT.lower()
