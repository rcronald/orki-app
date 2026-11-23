"""``orki-catalogo cargar-fotos-inaturalist`` y ``orki-catalogo limpiar-fotos-referencia``.

La carga sigue el contrato de ``supabase/README.md`` («Contrato de la carga»), paso a paso:

1. Protección de ambiente y credenciales, antes de conectar a nada (las de la base, como las
   demás cargas; la clave de servicio de Storage, solo con ``--escribir``).
2. Lee de la base las especies, sus sinónimos y plantas, las fotos actuales y las retiradas
   (:func:`catalog_import.reference_photos.read_state`), y elige el alcance.
3. Lee de la API de iNaturalist los taxones de los géneros del alcance (o de la familia
   entera) y las fotos de los taxones, con la caché, el ritmo y los topes de
   ``emparejar-inaturalist``, y los empareja con el mismo código.
4. Decide qué hacer con cada especie (:func:`catalog_import.reference_photos.decide`).
5. Para cada foto nueva: la descarga (versión ``medium`` del bucket abierto, una por segundo,
   con caché), la convierte a WebP y, solo con ``--escribir``, sube los dos archivos al bucket.
6. Escribe las filas y la fila de la auditoría en una transacción
   (:func:`catalog_import.reference_photos.write_rows`). Sin ``--escribir`` la revierte.
7. Escribe el reporte CSV y el resumen.

Sin ``--escribir`` es una **simulación**: no sube nada a Storage y la transacción se revierte,
pero sí lee iNaturalist y descarga las imágenes a la caché local (así el reporte dice qué fotos
y cuántos bytes, y la carga de verdad ya no las vuelve a pedir).

Si una petición se queda sin respuesta tras los reintentos, o se llega a un tope, la carga se
para **antes** de la transacción, sin escribir ninguna fila (código de salida 3): los archivos
que ya subió quedan sin citar (los repite o los limpia la siguiente) y lo leído y descargado
queda en las cachés, así que volver a ejecutarla sigue desde ahí.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Callable, Mapping
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import psycopg

from .audit import ACTION
from .inaturalist import (
    ACCEPTED_LICENSES,
    API_BASE,
    DAILY_LIMIT,
    MIN_INTERVAL,
    ORCHIDACEAE,
    ApiError,
    BudgetExhausted,
    Client,
    Fetch,
    OfflineMiss,
    Photo,
    Taxon,
    find_genus,
    iter_taxa,
    observation_photo,
    taxon_photos,
    urllib_fetch,
)
from .inaturalist_cli import DEFAULT_CACHE
from .inaturalist_match import (
    Alternatives,
    TaxonIndex,
    in_scope,
    license_label,
    match_catalog,
)
from .load import LoadError
from .load_cli import announce, error, prepare_audit, resolve_target
from .names import match_key, strip_hybrid_sign
from .reference_images import (
    IMAGE_HOST,
    DownloadsExhausted,
    DownloadsUnavailable,
    ImageDownloader,
    ImageError,
    ImageFetch,
    convert,
    urllib_image_fetch,
)
from .reference_photos import (
    LOAD_TYPE,
    Action,
    DbState,
    Decision,
    Metadata,
    Outcome,
    Prepared,
    Scope,
    Skip,
    WriteResult,
    candidates,
    check_schema,
    decide,
    give_up,
    photo_paths,
    read_state,
    select_scope,
    skip_reason,
    tally,
    write_report,
    write_rows,
)
from .report import default_report_path
from .species_storage import (
    BUCKET,
    Storage,
    StorageClient,
    StorageConfig,
    StorageConfigError,
    StorageError,
    StorageUnavailable,
    StoredObject,
    storage_config,
)
from .target import Target, scrub, without_pg_environment

DEFAULT_IMAGE_CACHE = DEFAULT_CACHE.parent / 'inaturalist-imagenes'
REPORT_PREFIX = 'reporte-carga-fotos'
INCOMPLETE = 3
# Antigüedad mínima de un archivo sin citar para borrarlo, como scripts/fotos-huerfanas.mjs.
MIN_AGE_HOURS = 24

StorageFactory = Callable[[StorageConfig], Storage]


def _common_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        '--ambiente',
        required=True,
        choices=['local', 'dev', 'prod'],
        help='Base de destino. Tiene que coincidir con la de ORKI_CATALOG_DB_URL.',
    )
    parser.add_argument(
        '--confirmar-produccion',
        metavar='REF',
        help='Obligatoria para escribir o borrar en producción: el identificador del proyecto '
        'de producción de Supabase.',
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog='orki-catalogo cargar-fotos-inaturalist',
        description=(
            'Carga las fotos de referencia de las especies desde iNaturalist: empareja el '
            'catálogo de la base con los taxones, elige una foto con licencia aceptada (CC0, '
            'dominio público, CC BY o CC BY-SA), la reduce a WebP, la sube al bucket '
            f'{BUCKET} y escribe las filas en una transacción. Por defecto es una simulación: '
            'no sube nada y revierte la transacción.'
        ),
    )
    _common_options(parser)
    parser.add_argument(
        '--escribir',
        action='store_true',
        help='Sube los archivos y confirma las filas. Sin ella, todo se simula. Necesita '
        'SUPABASE_SECRET_KEY.',
    )
    parser.add_argument(
        '--genero',
        action='append',
        default=[],
        help='Solo las especies de este género (se puede repetir). Sin ninguno, las que están '
        'en alguna colección y las de los géneros comunes.',
    )
    parser.add_argument(
        '--todo-el-catalogo',
        action='store_true',
        help='Todas las especies del catálogo (lee la familia entera de iNaturalist).',
    )
    parser.add_argument(
        '--max-especies',
        type=int,
        metavar='N',
        help='Como mucho N especies del alcance: primero las que tienen más plantas, después '
        'por nombre.',
    )
    parser.add_argument(
        '--leer-familia',
        action='store_true',
        help='Lee de iNaturalist la familia entera (unas 115 peticiones la primera vez) en vez '
        'de solo los géneros del alcance: empareja también las especies cuyo taxón está en '
        'otro género.',
    )
    parser.add_argument(
        '--alternativas',
        choices=[a.value for a in Alternatives],
        default=Alternatives.TAXON.value,
        help='Además de la foto por defecto del taxón, dónde buscar: en las demás fotos del '
        'taxón (por defecto), también en las observaciones con grado de investigación (una '
        'petición por taxón; conviene revisarlas) o en ninguna parte.',
    )
    parser.add_argument(
        '--cache',
        type=Path,
        default=DEFAULT_CACHE,
        help=f'Caché de la API (por defecto {DEFAULT_CACHE}, la de emparejar-inaturalist).',
    )
    parser.add_argument(
        '--cache-imagenes',
        type=Path,
        default=DEFAULT_IMAGE_CACHE,
        help=f'Caché de las imágenes descargadas (por defecto {DEFAULT_IMAGE_CACHE}).',
    )
    parser.add_argument(
        '--sin-red',
        action='store_true',
        help='Usa solo las cachés: no pide nada a iNaturalist.',
    )
    parser.add_argument(
        '--max-peticiones',
        type=int,
        default=DAILY_LIMIT,
        help=f'Tope de peticiones a la API de esta ejecución (como mucho {DAILY_LIMIT}).',
    )
    parser.add_argument(
        '--intervalo',
        type=float,
        default=MIN_INTERVAL,
        help=f'Segundos entre peticiones y entre descargas (como mínimo {MIN_INTERVAL:g}).',
    )
    parser.add_argument(
        '--reporte',
        type=Path,
        help=f'Ruta del CSV. Por defecto {REPORT_PREFIX}-<ambiente>-<modo>-<fecha>.csv.',
    )
    parser.add_argument('--resumen-json', type=Path, help='Escribe también el resumen en JSON.')
    return parser


# Conexión ------------------------------------------------------------------------------------


def _with_connection[T](target: Target, work: Callable[[psycopg.Connection[Any]], T]) -> T | int:
    """Conecta con la URL validada y ejecuta ``work``. Los errores salen sin credenciales."""
    try:
        with without_pg_environment():
            connection = psycopg.connect(
                **target.connect_kwargs(), autocommit=False, prepare_threshold=None
            )
        with connection:
            return work(connection)
    except psycopg.Error as problem:
        detail = scrub(str(problem).strip(), target)
        state = f' ({problem.sqlstate})' if problem.sqlstate else ''
        return error(
            f'la base de datos respondió con un error{state}: {detail}\n'
            'La transacción se revirtió: no se ha escrito ninguna fila.'
        )
    except LoadError as problem:
        return error(f'{scrub(str(problem), target)}\nNo se ha escrito ninguna fila.')


def _read(conn: psycopg.Connection[Any]) -> DbState:
    try:
        return read_state(conn)
    finally:
        conn.rollback()


# iNaturalist ---------------------------------------------------------------------------------


def _read_taxa(client: Client, genera: list[str] | None) -> tuple[list[Taxon], list[str]]:
    """Los taxones de esos géneros (o de la familia entera con ``None``) y los géneros que
    iNaturalist no tiene."""
    if genera is None:
        return list(iter_taxa(client, ORCHIDACEAE)), []
    taxa: dict[int, Taxon] = {}
    missing: list[str] = []
    for name in genera:
        genus = find_genus(client, strip_hybrid_sign(name))
        if genus is None:
            missing.append(name)
            continue
        for taxon in iter_taxa(client, genus.id):
            taxa.setdefault(taxon.id, taxon)
    return list(taxa.values()), missing


# Imágenes ------------------------------------------------------------------------------------


class Stop(Exception):
    """Hay que parar la carga antes de escribir ninguna fila (se reanuda volviendo a
    ejecutarla)."""


def _prepare(
    decision: Decision,
    downloader: ImageDownloader,
    storage: Storage | None,
) -> None:
    """Descarga, convierte y (al escribir) sube la primera candidata que salga bien."""
    for candidate in decision.usable:
        url = candidate.photo.url('medium')
        try:
            data, obtained = downloader.get(candidate.photo.id, url)
        except ImageError:
            decision.skipped[Skip.DOWNLOAD.value] += 1
            continue
        try:
            converted = convert(data)
        except ImageError:
            decision.skipped[Skip.CONVERSION.value] += 1
            continue
        medium_path, thumbnail_path = photo_paths(decision.species.id, candidate.id)
        if storage is not None:
            try:
                storage.upload(medium_path, converted.medium.data)
                storage.upload(thumbnail_path, converted.thumbnail.data)
            except StorageError as problem:
                decision.skipped[Skip.UPLOAD.value] += 1
                give_up(decision, f'Storage rechazó la subida: {problem}')
                return
        decision.prepared = Prepared(
            Metadata.of(candidate), converted, obtained, medium_path, thumbnail_path
        )
        return
    give_up(decision, 'Ninguna foto candidata se pudo descargar o convertir.')


# Carga ---------------------------------------------------------------------------------------


def main(
    argv: list[str],
    *,
    fetch: Fetch = urllib_fetch,
    image_fetch: ImageFetch = urllib_image_fetch,
    storage_factory: StorageFactory = StorageClient,
    environ: Mapping[str, str] | None = None,
) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    environ = os.environ if environ is None else environ
    if args.intervalo < MIN_INTERVAL:
        parser.error(f'--intervalo no puede bajar de {MIN_INTERVAL:g} s.')
    if not 0 < args.max_peticiones <= DAILY_LIMIT:
        parser.error(f'--max-peticiones tiene que estar entre 1 y {DAILY_LIMIT}.')
    if args.max_especies is not None and args.max_especies < 1:
        parser.error('--max-especies tiene que ser al menos 1.')
    if args.todo_el_catalogo and args.genero:
        parser.error('--todo-el-catalogo y --genero no se pueden usar juntos.')

    target = resolve_target(args)
    if isinstance(target, int):
        return target
    storage: Storage | None = None
    if args.escribir:
        try:
            config = storage_config(target, environ)
        except StorageConfigError as problem:
            return error(f'{problem}\nNo se ha conectado a nada.')
        storage = storage_factory(config)
    audit = prepare_audit(LOAD_TYPE, target, lambda: {'name': 'iNaturalist'})
    if isinstance(audit, int):
        return audit
    started = datetime.now(UTC)
    announce(target, args.escribir)
    if storage is not None:
        print(f'Storage: {config.describe()}\n')

    state = _with_connection(target, _read)
    if isinstance(state, int):
        return state
    scope = Scope(tuple(args.genero), args.todo_el_catalogo, args.max_especies)
    chosen = select_scope(state.species, scope)
    mode = Alternatives(args.alternativas)

    client = Client(
        args.cache,
        fetch=fetch,
        min_interval=args.intervalo,
        max_requests=args.max_peticiones,
        offline=args.sin_red,
    )
    downloader = ImageDownloader(
        args.cache_imagenes, fetch=image_fetch, min_interval=args.intervalo, offline=args.sin_red
    )
    whole_family = args.todo_el_catalogo or args.leer_familia
    genera = None if whole_family else sorted({s.genus for s in chosen}, key=match_key)
    try:
        taxa, missing = _read_taxa(client, genera) if chosen else ([], [])
    except (BudgetExhausted, OfflineMiss, ApiError) as problem:
        return _stopped(f'no se pudieron leer los taxones de iNaturalist: {_reason(problem)}')
    for name in missing:
        print(
            f'Aviso: no hay un género activo «{name}» en iNaturalist; sus especies quedan sin '
            'taxón.'
        )

    index = TaxonIndex.build(taxa)
    genus_keys = None if genera is None else frozenset(match_key(g) for g in genera)
    entries = [s.entry() for s in state.species]
    results = {
        r.entry.ref: r
        for r in match_catalog([e for e in entries if in_scope(e, genus_keys, index)], index)
    }

    photos = state.photos
    # Fotos del taxón: hacen falta si la por defecto no vale para la especie o si la especie ya
    # tiene otra foto (para saber si sigue siendo válida).
    needed: dict[int, Taxon] = {}
    for species in chosen:
        result = results.get(species.id)
        if result is None or result.taxon is None:
            continue
        taxon = result.taxon
        current = photos.photos.get(species.id)
        first = candidates(taxon, None, None)
        default_ok = bool(first) and skip_reason(first[0], species.id, photos) is None
        other_current = current is not None and (
            not first or current.source_photo_id != first[0].id
        )
        if not default_ok or other_current:
            needed.setdefault(taxon.id, taxon)
    by_taxon: dict[int, list[Photo]] = {}
    from_observations: dict[int, Photo | None] = {}
    try:
        if mode is not Alternatives.NONE and needed:
            taxon_photos(client, list(needed), into=by_taxon)
    except (BudgetExhausted, OfflineMiss, ApiError) as problem:
        return _stopped(f'no se pudieron leer las fotos de los taxones: {_reason(problem)}')

    decisions: list[Decision] = []
    for species in chosen:
        result = results.get(species.id)
        options = []
        if result is not None and result.taxon is not None:
            options = candidates(result.taxon, by_taxon.get(result.taxon.id), None)
        decisions.append(
            decide(
                species,
                result,
                options,
                photos,
                observations_searched=False,
                taxon_photos_searched=mode is not Alternatives.NONE,
            )
        )
    if mode is Alternatives.OBSERVATIONS:
        # Solo donde el taxón no dio ninguna foto utilizable, o para comprobar una foto actual
        # que salió de una observación (en la primera pasada queda «sin verificar»).
        retry = (Outcome.NO_PHOTO, Outcome.REMOVED, Outcome.KEPT)
        try:
            for i, decision in enumerate(decisions):
                taxon = decision.taxon
                if taxon is None or taxon.observations_count == 0 or decision.outcome not in retry:
                    continue
                if taxon.id not in from_observations:
                    from_observations[taxon.id] = observation_photo(client, taxon)
                options = candidates(taxon, by_taxon.get(taxon.id), from_observations[taxon.id])
                decisions[i] = decide(
                    decision.species,
                    results.get(decision.species.id),
                    options,
                    photos,
                    observations_searched=True,
                    taxon_photos_searched=True,
                )
        except (BudgetExhausted, OfflineMiss, ApiError) as problem:
            return _stopped(f'no se pudieron buscar las observaciones: {_reason(problem)}')

    try:
        for decision in decisions:
            if decision.action is Action.FETCH:
                _prepare(decision, downloader, storage)
    except (DownloadsExhausted, DownloadsUnavailable, StorageUnavailable) as problem:
        return _stopped(str(problem))

    summary = tally(decisions, None)
    extra = {
        'in_scope': len(decisions),
        'omitted_by_rejection': summary['omitidas_por_retiradas'],
        'without_photo': summary['resultado'].get(Outcome.NO_PHOTO.value, 0)
        + summary['resultado'].get(Outcome.FAILED.value, 0),
        'unmatched': summary['resultado'].get(Outcome.UNMATCHED.value, 0)
        + summary['resultado'].get(Outcome.AMBIGUOUS.value, 0),
        'kept_unverified': summary['resultado'].get(Outcome.KEPT.value, 0),
        'uploaded_files': getattr(storage, 'uploads', 0),
        'uploaded_bytes': getattr(storage, 'uploaded_bytes', 0),
    }
    source = {
        'name': 'iNaturalist',
        'api': API_BASE,
        'images': f'https://{IMAGE_HOST}/',
        'licenses': sorted(ACCEPTED_LICENSES),
        'alternatives': mode.value,
        'scope': scope.to_dict(),
        'taxa_read': len(taxa),
    }
    written = _with_connection(
        target,
        lambda conn: write_rows(
            conn, decisions, write=args.escribir, audit=audit, extra=extra, source=source
        ),
    )
    if isinstance(written, int):
        if storage is not None:
            print(
                'Los archivos subidos quedan sin citar: la siguiente carga los reutiliza y '
                '«limpiar-fotos-referencia» borra los que sobren.',
                file=sys.stderr,
            )
        return written

    report = args.reporte or default_report_path(
        target.environment.value, started, args.escribir, prefix=REPORT_PREFIX
    )
    rows = write_report(report, decisions, written.plan)
    final = tally(decisions, written.plan)
    final['ejecucion'] = {
        'ambiente': target.environment.value,
        'modo': 'escritura' if args.escribir else 'simulacion',
        'alcance': scope.describe(),
        'generos_leidos': genera if genera is not None else ['Orchidaceae (47217)'],
        'generos_no_encontrados': missing,
        'taxones_leidos': len(taxa),
        'alternativas': mode.value,
        'peticiones_red': client.stats.network,
        'respuestas_de_cache': client.stats.cached,
        'reintentos': client.stats.retries,
        'descargas_red': downloader.stats.network,
        'descargas_cache': downloader.stats.cached,
        'bytes_descargados': downloader.stats.bytes,
        'archivos_subidos': extra['uploaded_files'],
        'bytes_subidos': extra['uploaded_bytes'],
        'filas': dict(written.plan.counts),
        'auditoria': audit.actor,
    }
    _print(final, written, report, rows, audit.actor)
    if args.resumen_json:
        args.resumen_json.write_text(
            json.dumps(final, ensure_ascii=False, indent=2) + '\n', encoding='utf-8'
        )
    return 0


def _reason(problem: Exception) -> str:
    if isinstance(problem, OfflineMiss):
        return 'con --sin-red, falta en la caché una respuesta.'
    return str(problem)


def _stopped(message: str) -> int:
    print(
        f'Carga detenida antes de escribir ninguna fila: {message}\nLo leído y descargado queda '
        'en las cachés y los archivos subidos se reutilizan: vuelve a ejecutar para seguir.',
        file=sys.stderr,
    )
    return INCOMPLETE


def _counts(data: dict[str, int], labels: Callable[[str], str] = str) -> str:
    return ', '.join(f'{labels(k)} {v}' for k, v in data.items()) or 'ninguna'


def _print(
    summary: dict[str, Any], result: WriteResult, report: Path, rows: int, actor: str
) -> None:
    run = summary['ejecucion']
    print(f'Alcance: {run["alcance"]}')
    print(f'Géneros leídos de iNaturalist: {", ".join(run["generos_leidos"]) or "(ninguno)"}')
    print(
        f'API de iNaturalist: {run["peticiones_red"]} peticiones a la red, '
        f'{run["respuestas_de_cache"]} de la caché, {run["reintentos"]} reintentos; '
        f'{run["taxones_leidos"]} taxones leídos. Alternativas: {run["alternativas"]}.'
    )
    print('')
    print(f'Especies en el alcance: {summary["en_alcance"]}')
    print(f'  emparejamiento: {_counts(summary["emparejamiento"])}')
    print(f'  con foto (elegida o conservada): {summary["con_foto"]}')
    print(f'  por licencia: {_counts(summary["por_licencia"], license_label)}')
    print(f'  por selección: {_counts(summary["por_seleccion"])}')
    print(f'  resultado: {_counts(summary["resultado"])}')
    print(f'  fotos candidatas descartadas: {_counts(summary["descartadas_por_motivo"])}')
    print(f'  especies con alguna foto retirada descartada: {summary["omitidas_por_retiradas"]}')
    print(
        f'Imágenes: {run["descargas_red"]} descargadas ({run["bytes_descargados"]} bytes), '
        f'{run["descargas_cache"]} de la caché; {summary["imagenes_preparadas"]} fotos '
        f'convertidas ({summary["bytes_preparados"]} bytes en WebP).'
    )
    if result.written:
        print(
            f'Storage: {run["archivos_subidos"]} archivos subidos ({run["bytes_subidos"]} bytes).'
        )
    else:
        print('Storage: simulación, no se ha subido nada.')
    counts = result.plan.counts
    filas = ', '.join(
        f'{label} {counts.get(key, 0)}'
        for key, label in (
            ('created', 'nuevas'),
            ('replaced', 'sustituidas'),
            ('updated', 'actualizadas'),
            ('removed', 'quitadas'),
            ('unchanged', 'sin cambios'),
        )
    )
    verb = 'escritas' if result.written else 'simuladas y revertidas'
    print(f'Filas de species_photos {verb}: {filas}.')
    if result.written:
        print(
            f'Auditoría: resumen registrado ({ACTION}, load_type {LOAD_TYPE}) con el '
            f'identificador de la carga {actor} (acción {result.audit_action_id}).'
        )
    elif result.audit_ready:
        print('Auditoría: la simulación insertó el resumen y lo revirtió; no queda registro.')
    else:
        print('Aviso: la base no tiene la auditoría del catálogo; con --escribir se negaría.')
    print(f'\nReporte: {report} ({rows} filas)')


# Limpieza ------------------------------------------------------------------------------------


def build_cleanup_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog='orki-catalogo limpiar-fotos-referencia',
        description=(
            f'Busca en el bucket {BUCKET} los archivos que ninguna fila de species_photos cita '
            '(fotos sustituidas, retiradas, de especies borradas o absorbidas, o de una carga '
            'que falló) y, con --borrar, borra los que tienen la antigüedad mínima. Por defecto '
            'solo lista. Necesita SUPABASE_SECRET_KEY y ORKI_CATALOG_DB_URL.'
        ),
    )
    _common_options(parser)
    parser.add_argument('--borrar', action='store_true', help='Borra los archivos sin citar.')
    parser.add_argument(
        '--antiguedad-minima-horas',
        type=float,
        default=MIN_AGE_HOURS,
        help=f'Solo se borran los archivos con esta antigüedad (por defecto {MIN_AGE_HOURS} h), '
        'para no llevarse los de una carga en curso.',
    )
    return parser


def find_orphans(
    objects: list[StoredObject], cited: set[str], now: datetime, min_age: timedelta
) -> tuple[list[StoredObject], list[StoredObject]]:
    """Los archivos sin citar, separados en los que se pueden borrar y los recientes (o sin
    fecha, que nunca se borran). Se compara por la ruta, no por la carpeta."""
    old: list[StoredObject] = []
    recent: list[StoredObject] = []
    for item in sorted(objects, key=lambda o: o.path):
        if item.path in cited:
            continue
        if item.created_at is not None and now - item.created_at >= min_age:
            old.append(item)
        else:
            recent.append(item)
    return old, recent


def _cited(conn: psycopg.Connection[Any]) -> set[str]:
    try:
        check_schema(conn)
        paths: set[str] = set()
        for medium, thumbnail in conn.execute(
            'select medium_path, thumbnail_path from public.species_photos'
        ):
            paths.update((medium, thumbnail))
        return paths
    finally:
        conn.rollback()


def cleanup_main(
    argv: list[str],
    *,
    storage_factory: StorageFactory = StorageClient,
    environ: Mapping[str, str] | None = None,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> int:
    parser = build_cleanup_parser()
    args = parser.parse_args(argv)
    environ = os.environ if environ is None else environ
    if args.antiguedad_minima_horas < 1:
        parser.error('--antiguedad-minima-horas tiene que ser al menos 1.')
    args.escribir = args.borrar  # La confirmación de producción vale para borrar.
    target = resolve_target(args)
    if isinstance(target, int):
        return target
    try:
        config = storage_config(target, environ)
    except StorageConfigError as problem:
        return error(f'{problem}\nNo se ha conectado a nada.')
    storage = storage_factory(config)
    mode = 'BORRADO' if args.borrar else 'PRUEBA (no se borrará nada)'
    print(f'Destino: {target.describe()}\nStorage: {config.describe()}\nModo: {mode}\n')
    cited = _with_connection(target, _cited)
    if isinstance(cited, int):
        return cited
    try:
        objects = storage.list_objects()
    except (StorageError, StorageUnavailable) as problem:
        return error(f'no se pudo listar el bucket: {problem}')
    min_age = timedelta(hours=args.antiguedad_minima_horas)
    old, recent = find_orphans(objects, cited, now(), min_age)
    existing = {o.path for o in objects}
    missing = sorted(cited - existing)
    print(f'Archivos en el bucket: {len(objects)}; citados por species_photos: {len(cited)}')
    print(f'Sin citar con la antigüedad mínima: {len(old)}')
    for item in old:
        print(f'  {item.path}')
    print(f'Sin citar recientes o sin fecha (no se tocan): {len(recent)}')
    for item in recent:
        print(f'  {item.path}')
    if missing:
        print(f'Filas que citan un archivo que no existe (solo se informa): {len(missing)}')
        for path in missing:
            print(f'  {path}')
    if not args.borrar:
        print('\nModo de prueba: no se ha borrado nada. Para borrar, --borrar.')
        return 0
    try:
        storage.delete([o.path for o in old])
    except (StorageError, StorageUnavailable) as problem:
        return error(f'el borrado se cortó: {problem}. Vuelve a ejecutar para seguir.')
    print(f'\nBorrados: {len(old)} archivos.')
    return 0
