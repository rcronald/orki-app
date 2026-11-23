"""``cargar-fotos-inaturalist`` y ``limpiar-fotos-referencia`` de principio a fin, contra una
base desechable con todas las migraciones.

Sin red: la API de iNaturalist responde con las grabaciones de ``tests/data/inaturalist`` (las
de ``test_inaturalist_cli.py``), las imágenes se generan aquí y el bucket es un doble en
memoria. Necesitan ORKI_TEST_DB_URL, como las de la carga; sin ella se saltan.
"""

from __future__ import annotations

import copy
import csv
import io
import json
import re
from collections.abc import Callable, Iterable, Mapping
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from PIL import Image

from catalog_import.inaturalist import HttpStatus
from catalog_import.reference_images import MAX_BYTES
from catalog_import.reference_photos_cli import (
    INCOMPLETE,
    STORAGE_REJECTED,
    UPLOAD_FAILURES,
    cleanup_main,
    main,
)
from catalog_import.species_storage import (
    StorageClient,
    StorageConfig,
    StorageError,
    StorageUnavailable,
    StoredObject,
)
from catalog_import.target import Target

from .basedatos import execute, rows
from .test_inaturalist_cli import Recorded
from .test_load_db import load

ENV = {'SUPABASE_SECRET_KEY': 'sb_secret_de_prueba', 'ORKI_STORAGE_URL': 'http://127.0.0.1:54321'}
DETAIL = re.compile(r'^https://api\.inaturalist\.org/v1/taxa/([0-9,]+)$')
AMABILIS, APHRODITE, INTERMEDIA = (
    'Phalaenopsis amabilis',
    'Phalaenopsis aphrodite',
    'Phalaenopsis × intermedia',
)


class Api(Recorded):
    """Las grabaciones de la API; las fotos de los taxones (``/v1/taxa/{ids}``) se sirven para
    cualquier lote de la grabación, filtrando la respuesta grabada por los ids pedidos."""

    def __init__(self, *, licenses: dict[int, str | None] | None = None) -> None:
        super().__init__()
        self.responses = copy.deepcopy(self.responses)
        self.detail = next(v for k, v in self.responses.items() if DETAIL.match(k))
        for item in self.detail['results']:  # type: ignore[index]
            for tp in item.get('taxon_photos') or []:
                if tp['photo']['id'] in (licenses or {}):
                    tp['photo']['license_code'] = (licenses or {})[tp['photo']['id']]

    def __call__(self, url: str) -> bytes:
        if found := DETAIL.match(url):
            self.calls.append(url)
            ids = {int(i) for i in found.group(1).split(',')}
            results = [r for r in self.detail['results'] if r['id'] in ids]  # type: ignore[index]
            return json.dumps({'results': results}).encode()
        return super().__call__(url)


# La foto 620845107 (de Phalaenopsis aphrodite) es CC BY-NC-ND en la grabación; aquí se hace
# CC BY-SA para tener dos especies con foto y probar esa licencia.
SHARE_ALIKE = {620845107: 'cc-by-sa'}


class Images:
    """Imágenes generadas, una por URL: JPEG de 640×480 con EXIF."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    def __call__(self, url: str) -> bytes:
        self.calls.append(url)
        image = Image.merge(
            'RGB',
            (
                Image.linear_gradient('L').resize((640, 480)),
                Image.effect_noise((640, 480), 30),
                Image.linear_gradient('L').rotate(90).resize((640, 480)),
            ),
        )
        exif = Image.Exif()
        exif[0x0110] = 'Cámara de prueba'
        buffer = io.BytesIO()
        image.save(buffer, 'JPEG', exif=exif.tobytes())
        return buffer.getvalue()


class Bucket:
    """Doble del bucket species-photos. ``fail_at`` corta la subida número N (desde 1) y
    ``rejected`` da, por ruta, el error con el que Storage rechaza ese archivo."""

    def __init__(
        self, fail_at: int | None = None, rejected: dict[str, StorageError] | None = None
    ) -> None:
        self.objects: dict[str, tuple[bytes, datetime]] = {}
        self.uploads = 0
        self.uploaded_bytes = 0
        self.fail_at = fail_at
        self.rejected = rejected or {}
        self.checks = 0
        self.deleted: list[str] = []
        self.configs: list[StorageConfig] = []

    def factory(self, config: StorageConfig) -> Bucket:
        self.configs.append(config)
        return self

    def check(self) -> None:
        self.checks += 1

    def upload(self, path: str, data: bytes) -> None:
        if self.fail_at is not None and self.uploads + 1 >= self.fail_at:
            raise StorageUnavailable('Storage no respondió a POST (prueba).')
        for suffix, problem in self.rejected.items():
            if path.endswith(suffix):
                raise problem
        assert len(data) <= MAX_BYTES
        self.objects[path] = (data, datetime.now(UTC))
        self.uploads += 1
        self.uploaded_bytes += len(data)

    def list_objects(self) -> list[StoredObject]:
        return [StoredObject(p, when) for p, (_, when) in self.objects.items()]

    def delete(self, paths: Iterable[str]) -> None:
        for path in paths:
            self.deleted.append(path)
            del self.objects[path]


@pytest.fixture(autouse=True)
def _no_waiting(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr('catalog_import.inaturalist.time.sleep', lambda _seconds: None)
    monkeypatch.setattr('catalog_import.reference_images.time.sleep', lambda _seconds: None)


@pytest.fixture
def catalog(db: Target, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Target:
    """La base con la muestra de COL cargada (tres especies de Phalaenopsis)."""
    code, _ = load(db, tmp_path, monkeypatch, name='reporte-col.csv')
    assert code == 0
    return db


def species_id(db: Target, name: str) -> str:
    [(found,)] = rows(db, 'select id::text from public.species where scientific_name = %s', (name,))
    return found


def photos(db: Target) -> dict[str, dict[str, Any]]:
    columns = (
        'name',
        'source_photo_id',
        'medium_path',
        'medium_width',
        'medium_height',
        'thumbnail_path',
        'thumbnail_width',
        'thumbnail_height',
        'source_taxon_id',
        'source_selection',
        'source_url',
        'license',
        'author_name',
        'attribution',
        'is_modified',
        'updated_at',
    )
    found = rows(
        db,
        f'select s.scientific_name, {", ".join("p." + c for c in columns[1:])} '
        'from public.species_photos p join public.species s on s.id = p.species_id',
    )
    return {r[0]: dict(zip(columns, r, strict=True)) for r in found}


def audits(db: Target) -> list[dict[str, Any]]:
    return [
        r[0]
        for r in rows(
            db,
            "select details from public.catalog_audit_log where action = 'catalog_import' "
            "and details ->> 'load_type' = 'fotos_referencia' order by id",
        )
    ]


def run(
    tmp_path: Path,
    *extra: str,
    api: Api | None = None,
    images: Images | None = None,
    bucket: Bucket | None = None,
    environ: dict[str, str] | None = None,
    name: str = 'reporte-fotos.csv',
    factory: Callable[[StorageConfig], Any] | None = None,
) -> tuple[int, dict[str, dict[str, str]], Images, Bucket]:
    api = api or Api(licenses=SHARE_ALIKE)
    images = images or Images()
    bucket = bucket or Bucket()
    report = tmp_path / name
    code = main(
        [
            '--ambiente',
            'local',
            '--genero',
            'Phalaenopsis',
            '--cache',
            str(tmp_path / 'cache'),
            '--cache-imagenes',
            str(tmp_path / 'imagenes'),
            '--reporte',
            str(report),
            *extra,
        ],
        fetch=api,
        image_fetch=images,
        storage_factory=factory or bucket.factory,
        environ=ENV if environ is None else environ,
    )
    by_name: dict[str, dict[str, str]] = {}
    if report.exists():
        with report.open(encoding='utf-8-sig', newline='') as handle:
            by_name = {r['nombre']: r for r in csv.DictReader(handle)}
    return code, by_name, images, bucket


def test_simulation_has_no_effects(catalog: Target, tmp_path: Path) -> None:
    def no_storage(_config: StorageConfig) -> Bucket:
        raise AssertionError('La simulación no debe usar Storage.')

    report = tmp_path / 'simulacion.csv'
    code = main(
        [
            '--ambiente',
            'local',
            '--genero',
            'Phalaenopsis',
            '--cache',
            str(tmp_path / 'c'),
            '--cache-imagenes',
            str(tmp_path / 'i'),
            '--reporte',
            str(report),
        ],
        fetch=Api(licenses=SHARE_ALIKE),
        image_fetch=Images(),
        storage_factory=no_storage,
        environ={},
    )
    assert code == 0
    assert photos(catalog) == {}
    assert audits(catalog) == []
    with report.open(encoding='utf-8-sig', newline='') as handle:
        by_name = {r['nombre']: r for r in csv.DictReader(handle)}
    assert by_name[AMABILIS]['resultado'] == 'nueva'
    assert by_name[AMABILIS]['foto_id'] == '149339720'
    assert by_name[APHRODITE]['licencia'] == 'CC BY-SA'
    assert by_name[INTERMEDIA]['resultado'] == 'sin_foto'
    # Las imágenes sí se descargan, a la caché local, para que la carga real no las repita.
    assert sorted(p.name for p in (tmp_path / 'i').glob('*-medium.*')) == [
        '149339720-medium.jpg',
        '620845107-medium.jpg',
    ]


def test_write_then_repeat(
    catalog: Target, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code, report, images, bucket = run(tmp_path, '--escribir')
    assert code == 0, capsys.readouterr().err
    amabilis = species_id(catalog, AMABILIS)
    found = photos(catalog)
    assert set(found) == {AMABILIS, APHRODITE}
    row = found[AMABILIS]
    assert row['source_photo_id'] == '149339720'
    assert row['medium_path'] == f'{amabilis}/medium-149339720.webp'
    assert row['thumbnail_path'] == f'{amabilis}/thumb-149339720.webp'
    assert (row['medium_width'], row['medium_height']) == (500, 375)
    assert (row['thumbnail_width'], row['thumbnail_height']) == (160, 120)
    assert (row['source_taxon_id'], row['source_selection'], row['license']) == (
        '344883',
        'taxon_photo',
        'cc-by',
    )
    assert row['source_url'] == 'https://www.inaturalist.org/photos/149339720'
    assert row['is_modified'] is True
    assert row['author_name']
    assert row['author_name'] in row['attribution']
    assert 'Modificada: reducida y convertida a WebP' in row['attribution']
    assert 'misma licencia, CC BY-SA' in found[APHRODITE]['attribution']
    assert set(bucket.objects) == {
        p for r in found.values() for p in (r['medium_path'], r['thumbnail_path'])
    }
    assert bucket.configs[0].base_url == 'http://127.0.0.1:54321'
    [details] = audits(catalog)
    assert details['load_type'] == 'fotos_referencia'
    assert details['environment'] == 'local'
    assert details['counts'] == {
        'species_photos': {'created': 2, 'replaced': 0, 'updated': 0, 'unchanged': 0, 'removed': 0}
    }
    assert (details['in_scope'], details['without_photo'], details['omitted_by_rejection']) == (
        3,
        1,
        0,
    )
    assert details['uploaded_files'] == 4
    assert details['source']['licenses'] == ['cc-by', 'cc-by-sa', 'cc0', 'pd']
    assert report[AMABILIS]['resultado'] == 'nueva'
    out = capsys.readouterr().out
    assert 'por licencia: CC BY 1, CC BY-SA 1' in out
    assert 'Filas de species_photos escritas: nuevas 2' in out

    # La segunda vez no cambia nada: ni descargas, ni subidas, ni filas (tampoco updated_at).
    code, report, images, bucket = run(tmp_path, '--escribir', name='otra.csv')
    assert code == 0
    assert images.calls == []
    assert bucket.uploads == 0
    assert photos(catalog) == found
    assert report[AMABILIS]['resultado'] == 'sin_cambios'
    assert audits(catalog)[-1]['counts']['species_photos']['unchanged'] == 2


def test_upload_failure_midway_and_resume(catalog: Target, tmp_path: Path) -> None:
    # Se corta la tercera subida: la primera especie ya subió sus dos archivos.
    code, _, _, bucket = run(tmp_path, '--escribir', bucket=Bucket(fail_at=3))
    assert code == INCOMPLETE
    assert photos(catalog) == {}
    assert audits(catalog) == []
    assert len(bucket.objects) == 2
    # La siguiente ejecución sigue: no vuelve a descargar, repite las subidas (mismo nombre) y
    # escribe todas las filas.
    bucket.fail_at = None
    code, _, images, bucket = run(tmp_path, '--escribir', bucket=bucket)
    assert code == 0
    assert images.calls == []
    assert set(photos(catalog)) == {AMABILIS, APHRODITE}
    assert len(bucket.objects) == 4
    assert len(audits(catalog)) == 1


INVALID_JWS = (
    400,
    b'{"statusCode": "403", "error": "Unauthorized", "message": "Invalid Compact JWS"}',
)


class StorageApi:
    """Transporte de prueba para el cliente de Storage de verdad: responde al GET del bucket con
    ``bucket`` y a todo lo demás con ``other``."""

    def __init__(self, bucket: tuple[int, bytes], other: tuple[int, bytes]) -> None:
        self.bucket, self.other = bucket, other
        self.calls: list[tuple[str, str]] = []

    def __call__(
        self, method: str, url: str, _headers: Mapping[str, str], _body: bytes | None
    ) -> tuple[int, bytes]:
        self.calls.append((method, url))
        return self.bucket if method == 'GET' else self.other

    def factory(self, config: StorageConfig) -> StorageClient:
        return StorageClient(config, send=self, sleep=lambda _seconds: None)


def test_invalid_key_stops_before_reading_anything(
    catalog: Target, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    # Lo que pasó en producción: Storage responde 400 «Invalid Compact JWS» a todo.
    storage = StorageApi(INVALID_JWS, INVALID_JWS)
    api = Api(licenses=SHARE_ALIKE)
    code, report, images, _ = run(
        tmp_path, '--escribir', '--resumen-json', str(tmp_path / 'r.json'), api=api,
        factory=storage.factory,
    )  # fmt: skip
    assert code == STORAGE_REJECTED
    # Una sola petición, la de la comprobación previa: ni iNaturalist, ni descargas, ni subidas.
    assert storage.calls == [('GET', 'http://127.0.0.1:54321/storage/v1/bucket/species-photos')]
    assert api.calls == []
    assert images.calls == []
    assert report == {}
    assert not (tmp_path / 'r.json').exists()
    assert photos(catalog) == {}
    assert audits(catalog) == []
    err = capsys.readouterr().err
    assert 'rechazó la clave (respondió 400: Invalid Compact JWS)' in err
    assert 'SUPABASE_SECRET_KEY tiene que ser la clave secreta' in err
    assert 'botón de copiar' in err
    assert ENV['SUPABASE_SECRET_KEY'] not in err


def test_key_rejected_while_uploading_stops_at_once(
    catalog: Target, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    # La comprobación pasa, pero las subidas se rechazan por la clave: no se intentan todas.
    storage = StorageApi((200, b'{"id": "species-photos"}'), INVALID_JWS)
    code, _, _, _ = run(tmp_path, '--escribir', factory=storage.factory)
    assert code == STORAGE_REJECTED
    assert [m for m, _ in storage.calls] == ['GET', 'POST']
    assert photos(catalog) == {}
    assert audits(catalog) == []
    err = capsys.readouterr().err
    assert 'carga detenida antes de escribir ninguna fila' in err
    assert 'Invalid Compact JWS' in err


def test_one_rejected_file_does_not_stop_the_rest(
    catalog: Target, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    too_big = StorageError(
        'Storage respondió 413 a POST object/species-photos/x/medium-620845107.webp: '
        'The object exceeded the maximum allowed size',
        413,
        'The object exceeded the maximum allowed size',
    )
    summary = tmp_path / 'resumen.json'
    code, report, _, bucket = run(
        tmp_path, '--escribir', '--resumen-json', str(summary),
        bucket=Bucket(rejected={'medium-620845107.webp': too_big}),
    )  # fmt: skip
    assert code == UPLOAD_FAILURES
    assert bucket.checks == 1
    # La otra especie sí se escribe, con su auditoría, que cuenta el fallo.
    assert set(photos(catalog)) == {AMABILIS}
    assert report[APHRODITE]['resultado'] == 'error'
    assert 'error_subida 1' in report[APHRODITE]['descartadas']
    [details] = audits(catalog)
    assert details['counts']['species_photos']['created'] == 1
    assert details['failed_uploads'] == 1
    out, err = capsys.readouterr()
    assert out.index('ATENCIÓN: 1 subidas a Storage fallaron') < out.index('Alcance:')
    assert f'{APHRODITE}: Storage respondió 413' in out
    assert '1 subidas a Storage fallaron' in err
    data = json.loads(summary.read_text(encoding='utf-8'))
    assert data['ejecucion']['subidas_fallidas'] == 1
    assert data['ejecucion']['errores_de_subida'][0]['especie'] == APHRODITE

    # Volver a ejecutarla, ya sin el rechazo, completa la que faltaba.
    bucket.rejected = {}
    code, report, _, _ = run(tmp_path, '--escribir', bucket=bucket, name='otra.csv')
    assert code == 0
    assert set(photos(catalog)) == {AMABILIS, APHRODITE}


def test_load_that_writes_nothing_because_of_errors_leaves_no_audit(
    catalog: Target, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    # Dos rechazos distintos (no bastan para parar), y ninguna especie con foto nueva.
    rejected = {
        f'medium-{photo}.webp': StorageError(f'Storage respondió 413 ({photo}).', 413, photo)
        for photo in ('149339720', '620845107')
    }
    code, report, _, _ = run(tmp_path, '--escribir', bucket=Bucket(rejected=rejected))
    assert code == UPLOAD_FAILURES
    assert photos(catalog) == {}
    assert audits(catalog) == []
    assert report[AMABILIS]['resultado'] == 'error'
    assert 'Auditoría: no se registró la carga' in capsys.readouterr().out


def reject(db: Target, name: str, photo_id: str, reason: str) -> None:
    execute(
        db,
        'insert into public.species_photo_rejections (species_id, source, source_photo_id, '
        'source_url, author_name, reason, rejected_by, action_id) values '
        "(%s, 'inaturalist', %s, %s, 'Autor', %s, 'user_admin', gen_random_uuid())",
        (species_id(db, name), photo_id, f'https://www.inaturalist.org/photos/{photo_id}', reason),
    )


def test_retired_photos_and_author_requests(catalog: Target, tmp_path: Path) -> None:
    reject(catalog, AMABILIS, '149339720', 'misidentified')
    # Retirada de otra especie, pero a petición del autor: no se usa en ninguna.
    reject(catalog, INTERMEDIA, '620845107', 'author_request')
    code, report, _, bucket = run(tmp_path, '--escribir')
    assert code == 0
    assert photos(catalog) == {}
    assert bucket.uploads == 0
    assert report[AMABILIS]['resultado'] == 'sin_foto'
    assert 'retirada 1' in report[AMABILIS]['descartadas']
    assert 'peticion_del_autor 1' in report[APHRODITE]['descartadas']
    [details] = audits(catalog)
    assert details['omitted_by_rejection'] == 2
    assert details['counts']['species_photos']['created'] == 0


def test_photo_whose_license_changed_is_replaced(catalog: Target, tmp_path: Path) -> None:
    amabilis = species_id(catalog, AMABILIS)
    # Foto anterior: la por defecto del taxón, hoy con todos los derechos reservados.
    execute(
        catalog,
        'insert into public.species_photos (species_id, medium_path, medium_width, medium_height, '
        'thumbnail_path, thumbnail_width, thumbnail_height, source, source_photo_id, '
        'source_taxon_id, source_selection, source_url, license, author_name, attribution, '
        "obtained_at) values (%s, %s, 500, 400, %s, 160, 128, 'inaturalist', '69630016', "
        "'344883', 'taxon_default', 'https://www.inaturalist.org/photos/69630016', 'cc-by', "
        "'Alguien', '(c) Alguien', now() - interval '40 days')",
        (amabilis, f'{amabilis}/medium-69630016.webp', f'{amabilis}/thumb-69630016.webp'),
    )
    code, report, _, _ = run(tmp_path, '--escribir')
    assert code == 0
    assert photos(catalog)[AMABILIS]['source_photo_id'] == '149339720'
    assert report[AMABILIS]['resultado'] == 'sustituida'
    assert report[AMABILIS]['foto_anterior'] == '69630016'
    assert audits(catalog)[0]['counts']['species_photos']['replaced'] == 1


def test_write_needs_the_service_key(
    catalog: Target, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code, _, images, _ = run(tmp_path, '--escribir', environ={})
    assert code == 1
    assert 'SUPABASE_SECRET_KEY' in capsys.readouterr().err
    assert images.calls == []
    assert photos(catalog) == {}
    assert audits(catalog) == []


def test_observations_are_searched_only_when_asked(catalog: Target, tmp_path: Path) -> None:
    code, report, _, _ = run(tmp_path, '--alternativas', 'observaciones', api=Api())
    assert code == 0
    assert report[APHRODITE]['seleccion'] == 'observation'
    assert report[APHRODITE]['observacion'].startswith('https://www.inaturalist.org/observations/')


def test_api_failure_stops_before_writing(catalog: Target, tmp_path: Path) -> None:
    class Down(Api):
        def __call__(self, url: str) -> bytes:
            if DETAIL.match(url):
                raise HttpStatus(503)
            return super().__call__(url)

    code, _, images, bucket = run(tmp_path, '--escribir', api=Down())
    assert code == INCOMPLETE
    assert images.calls == []
    assert bucket.uploads == 0
    assert audits(catalog) == []


def test_cleanup_lists_by_default_and_deletes_old_orphans(
    catalog: Target, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code, _, _, bucket = run(tmp_path, '--escribir')
    assert code == 0
    cited = set(bucket.objects)
    old = datetime.now(UTC) - timedelta(days=3)
    bucket.objects['0f6c1b6e-8b5a-4c3e-9b1a-2d3e4f5a6b7c/medium-1.webp'] = (b'x', old)
    bucket.objects['0f6c1b6e-8b5a-4c3e-9b1a-2d3e4f5a6b7c/thumb-1.webp'] = (b'x', datetime.now(UTC))
    code = cleanup_main(['--ambiente', 'local'], storage_factory=bucket.factory, environ=ENV)
    assert code == 0
    assert bucket.deleted == []
    assert 'Sin citar con la antigüedad mínima: 1' in capsys.readouterr().out
    code = cleanup_main(
        ['--ambiente', 'local', '--borrar'], storage_factory=bucket.factory, environ=ENV
    )
    assert code == 0
    assert bucket.deleted == ['0f6c1b6e-8b5a-4c3e-9b1a-2d3e4f5a6b7c/medium-1.webp']
    assert cited <= set(bucket.objects)
