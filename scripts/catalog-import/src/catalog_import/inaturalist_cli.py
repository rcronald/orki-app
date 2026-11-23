"""``orki-catalogo emparejar-inaturalist``: empareja el catálogo con los taxones de iNaturalist.

Solo lectura: lee taxones y metadatos de fotos de la API pública de iNaturalist (con caché en
disco, ritmo de una petición por segundo y tope diario; ver :mod:`catalog_import.inaturalist`),
los empareja con las especies del catálogo (ver :mod:`catalog_import.inaturalist_match`) y
escribe un reporte CSV y un resumen. No descarga imágenes ni se conecta a ninguna base.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .inaturalist import (
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
from .inaturalist_match import (
    COMMON_GENERA,
    Alternatives,
    CatalogEntry,
    CatalogFormatError,
    Match,
    MatchResult,
    PhotoChoice,
    Row,
    TaxonIndex,
    choose_photo,
    format_summary,
    in_scope,
    match_catalog,
    needs_alternative,
    read_catalog,
    summarize,
    write_report,
)
from .names import match_key

DEFAULT_CACHE = Path.home() / '.cache' / 'orki-catalogo' / 'inaturalist'
REPORT_PREFIX = 'reporte-inaturalist'
# Código de salida cuando el tope de peticiones cortó la búsqueda: el reporte se escribe, pero
# hay que volver a ejecutar (la caché hace que siga donde se quedó).
INCOMPLETE = 3


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog='orki-catalogo emparejar-inaturalist',
        description=(
            'Empareja las especies del catálogo con los taxones de Orchidaceae de iNaturalist '
            'y clasifica la licencia de su foto. Solo lectura: no descarga imágenes ni se '
            'conecta a ninguna base de datos.'
        ),
    )
    parser.add_argument(
        '--catalogo',
        type=Path,
        action='append',
        default=[],
        help='Catálogo: export.zip o TSV de COL, salida JSON de «orki-catalogo --salida», '
        'data/hibridos.csv o una exportación CSV de la base (id,nombre,genero,tipo,'
        'sinonimos,plantas). Se puede repetir. Sin ninguno, solo se resume iNaturalist.',
    )
    parser.add_argument(
        '--genero',
        action='append',
        default=[],
        help='Género que se lee de iNaturalist (se puede repetir). Sin ninguno, la familia '
        'entera (taxón 47217).',
    )
    parser.add_argument(
        '--generos-comunes',
        action='store_true',
        help=f'Añade los géneros del alcance inicial: {", ".join(COMMON_GENERA)}.',
    )
    parser.add_argument(
        '--alternativas',
        choices=[a.value for a in Alternatives],
        default=Alternatives.TAXON.value,
        help='Si la foto por defecto no tiene licencia aceptada, dónde buscar otra: en las '
        'fotos del taxón (1 petición cada 30 taxones), además en las observaciones con grado '
        'de investigación (1 petición por taxón) o en ninguna parte. Por defecto: taxon.',
    )
    parser.add_argument(
        '--cache',
        type=Path,
        default=DEFAULT_CACHE,
        help=f'Carpeta de la caché, fuera del repositorio (por defecto {DEFAULT_CACHE}).',
    )
    parser.add_argument(
        '--sin-red',
        action='store_true',
        help='Usa solo la caché; lo que no esté en ella no se pide.',
    )
    parser.add_argument(
        '--max-peticiones',
        type=int,
        default=DAILY_LIMIT,
        help=f'Tope de peticiones de esta ejecución (por defecto y como máximo {DAILY_LIMIT}; '
        'además hay un tope diario igual, contado en la caché).',
    )
    parser.add_argument(
        '--intervalo',
        type=float,
        default=MIN_INTERVAL,
        help=f'Segundos entre peticiones (como mínimo {MIN_INTERVAL:g}).',
    )
    parser.add_argument(
        '--reporte',
        type=Path,
        help=f'Ruta del CSV. Por defecto {REPORT_PREFIX}-<fecha UTC>.csv en la carpeta actual '
        '(git lo ignora).',
    )
    parser.add_argument('--resumen-json', type=Path, help='Escribe también el resumen en JSON.')
    return parser


def main(argv: list[str], *, fetch: Fetch = urllib_fetch) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.intervalo < MIN_INTERVAL:
        parser.error(f'--intervalo no puede bajar de {MIN_INTERVAL:g} s.')
    if not 0 < args.max_peticiones <= DAILY_LIMIT:
        parser.error(f'--max-peticiones tiene que estar entre 1 y {DAILY_LIMIT}.')
    for path in args.catalogo:
        if not path.is_file():
            parser.error(f'No existe el archivo {path}.')
    genera = list(dict.fromkeys([*args.genero, *(COMMON_GENERA if args.generos_comunes else ())]))
    mode = Alternatives(args.alternativas)

    try:
        entries: list[CatalogEntry] = [e for p in args.catalogo for e in read_catalog(p)]
    except CatalogFormatError as error:
        print(f'Error en el catálogo: {error}', file=sys.stderr)
        return 1

    client = Client(
        args.cache,
        fetch=fetch,
        min_interval=args.intervalo,
        max_requests=args.max_peticiones,
        offline=args.sin_red,
    )
    try:
        ancestors, missing = _resolve_scope(client, genera)
        taxa = [t for ancestor in ancestors.values() for t in iter_taxa(client, ancestor)]
    except (BudgetExhausted, OfflineMiss, ApiError) as error:
        print(
            f'No se pudieron leer todos los taxones: {_reason(error)} Lo leído queda en la '
            'caché; vuelve a ejecutar para seguir.',
            file=sys.stderr,
        )
        return INCOMPLETE
    for name in missing:
        print(f'Aviso: no hay un género activo «{name}» en iNaturalist; se omite.')

    index = TaxonIndex.build(taxa)
    genus_keys = frozenset(match_key(g) for g in ancestors) if genera else None
    scoped = [e for e in entries if in_scope(e, genus_keys, index)]
    results = match_catalog(scoped, index)

    claimed = {r.taxon.id: r for r in results if r.taxon}
    ordered = _alternative_order(results, index)
    photos_by_taxon: dict[int, list[Photo]] = {}
    from_observations: dict[int, Photo | None] = {}
    interrupted = None
    try:
        if mode is not Alternatives.NONE:
            taxon_photos(client, [t.id for t in ordered], into=photos_by_taxon)
            if mode is Alternatives.OBSERVATIONS:
                for taxon in ordered:
                    if taxon.observations_count == 0 or _has_accepted(photos_by_taxon, taxon):
                        continue
                    from_observations[taxon.id] = observation_photo(client, taxon)
    except (BudgetExhausted, OfflineMiss, ApiError) as error:
        interrupted = _reason(error)

    def choice(taxon: Taxon) -> PhotoChoice:
        return choose_photo(taxon, mode, photos_by_taxon, from_observations)

    species_rows = [_species_row(r, choice) for r in results]
    taxon_rows = []
    csv_taxon_rows = []
    for taxon in sorted(index.active.values(), key=lambda t: match_key(t.name)):
        owner = claimed.get(taxon.id)
        row = Row(
            'taxon',
            owner.match if owner else Match.NO_SPECIES,
            None,
            taxon,
            '',
            choice(taxon),
            '' if owner else 'Ninguna especie del catálogo en el alcance empareja con él.',
        )
        taxon_rows.append(row)
        if owner is None:
            csv_taxon_rows.append(row)

    report = args.reporte or Path(f'{REPORT_PREFIX}-{datetime.now(UTC):%Y%m%dT%H%M%SZ}.csv')
    written = write_report(report, [*species_rows, *csv_taxon_rows])
    summary = summarize(species_rows, taxon_rows, genera or COMMON_GENERA)
    summary['ejecucion'] = {
        'alcance': list(ancestors) if genera else ['Orchidaceae (47217)'],
        'generos_no_encontrados': missing,
        'catalogo': [p.name for p in args.catalogo],
        'especies_leidas': len(entries),
        'fuera_del_alcance': len(entries) - len(scoped),
        'taxones_leidos': len(taxa),
        'alternativas': mode.value,
        'peticiones_red': client.stats.network,
        'respuestas_de_cache': client.stats.cached,
        'reintentos': client.stats.retries,
        'interrumpido': interrupted,
    }
    _print(summary, report, written)
    if args.resumen_json:
        args.resumen_json.write_text(
            json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8'
        )
    if interrupted:
        print(
            f'\nBúsqueda de alternativas incompleta: {interrupted} Las que faltan salen como '
            '«no_buscada»; vuelve a ejecutar para seguir (lo pedido está en la caché).'
        )
        return INCOMPLETE
    return 0


def _resolve_scope(client: Client, genera: list[str]) -> tuple[dict[str, int], list[str]]:
    if not genera:
        return {'Orchidaceae': ORCHIDACEAE}, []
    ancestors: dict[str, int] = {}
    missing = []
    for name in genera:
        genus = find_genus(client, name)
        if genus is None:
            missing.append(name)
        else:
            ancestors[genus.name] = genus.id
    return ancestors, missing


def _reason(error: Exception) -> str:
    if isinstance(error, OfflineMiss):
        return 'con --sin-red, falta en la caché una respuesta.'
    return str(error)


def _has_accepted(photos: dict[int, list[Photo]], taxon: Taxon) -> bool:
    return any(p.accepted and not p.flagged for p in photos.get(taxon.id, []))


def _alternative_order(results: list[MatchResult], index: TaxonIndex) -> list[Taxon]:
    """Taxones que necesitan otra foto: primero los emparejados (las especies con más plantas
    antes), después el resto de iNaturalist, de más a menos observaciones."""
    ordered: dict[int, Taxon] = {}
    matched = sorted(
        (r for r in results if r.taxon),
        key=lambda r: (-(r.entry.plants or 0), match_key(r.entry.name)),
    )
    for result in matched:
        if needs_alternative(result.taxon):  # type: ignore[arg-type]
            ordered.setdefault(result.taxon.id, result.taxon)  # type: ignore[union-attr]
    rest = sorted(index.active.values(), key=lambda t: (-t.observations_count, t.id))
    for taxon in rest:
        if needs_alternative(taxon):
            ordered.setdefault(taxon.id, taxon)
    return list(ordered.values())


def _species_row(result: MatchResult, choice: Callable[[Taxon], PhotoChoice]) -> Row:
    return Row(
        'especie',
        result.match,
        result.entry,
        result.taxon,
        result.via if result.match is Match.SYNONYM else '',
        choice(result.taxon) if result.taxon else None,
        result.detail,
    )


def _print(summary: dict[str, Any], report: Path, written: int) -> None:
    run = summary['ejecucion']
    print(f'Alcance en iNaturalist: {", ".join(run["alcance"])}')
    print(f'Catálogo: {", ".join(run["catalogo"]) or "(ninguno)"}')
    print(
        f'Especies leídas del catálogo: {run["especies_leidas"]} '
        f'(fuera del alcance: {run["fuera_del_alcance"]})'
    )
    print(f'Taxones leídos de iNaturalist (activos e inactivos): {run["taxones_leidos"]}')
    print(
        f'Peticiones: {run["peticiones_red"]} a la red, {run["respuestas_de_cache"]} de la '
        f'caché, {run["reintentos"]} reintentos. Alternativas: {run["alternativas"]}.'
    )
    print('')
    print(format_summary(summary))
    print(f'\nReporte escrito en {report} ({written} filas).')
