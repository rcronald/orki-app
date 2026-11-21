"""CLI ``orki-catalogo``: normaliza la exportación y, con ``cargar``, la carga en la base.

Uso::

    # Solo lectura: lee, normaliza y resume. No se conecta a ninguna base.
    uv run orki-catalogo RUTA/export.zip [--salida catalogo.json]

    # Carga (simulación por defecto). La URL de la base va en ORKI_CATALOG_DB_URL.
    uv run orki-catalogo cargar RUTA/export.zip --ambiente local|dev|prod [--escribir]

    # Lista curada de híbridos: validación sin conexión y carga (mismo flujo y opciones).
    uv run orki-catalogo validar-hibridos data/hibridos.csv
    uv run orki-catalogo cargar-hibridos data/hibridos.csv --ambiente local|dev|prod [--escribir]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from .model import Catalog
from .normalize import build_catalog
from .reader import ReadStats, SourceFormatError, read_family

FAMILY = 'Orchidaceae'

_LABELS = {
    'genera': 'Géneros',
    'hybrid_genera': '  de ellos, nothogéneros (×)',
    'species': 'Especies aceptadas',
    'hybrids': '  de ellas, híbridos',
    'synonyms': 'Sinónimos',
    'ambiguous_synonyms': '  de ellos, ambiguos',
    'reassigned_synonyms': '  de ellos, reasignados desde un rango inferior',
}


def run(path: Path) -> tuple[Catalog, dict[str, Any]]:
    """Lee y normaliza el archivo. Devuelve el catálogo y el resumen completo."""
    stats = ReadStats()
    catalog = build_catalog(read_family(path, FAMILY, stats))
    summary: dict[str, Any] = {
        'source': {'file': path.name, 'family': FAMILY, **stats.metadata},
        'rows_read': stats.rows,
        'rows_other_family': stats.other_family,
        'family_records': stats.rows - stats.other_family,
        **catalog.summary(),
    }
    return catalog, summary


def format_summary(summary: dict[str, Any]) -> str:
    source = summary['source']
    version = ' '.join(
        part
        for part in (source.get('alias'), f'(clave {source["key"]})' if 'key' in source else None)
        if part
    )
    lines = [
        f'Archivo: {source["file"]}' + (f' — {version}' if version else ''),
        f'Filas leídas: {summary["rows_read"]}',
        f'Filas de otras familias (descartadas sin detalle): {summary["rows_other_family"]}',
        f'Registros de {source["family"]}: {summary["family_records"]}',
        '',
    ]
    lines += [f'{label}: {summary[key]}' for key, label in _LABELS.items()]
    for title, key in (('Descartes por motivo', 'discarded'), ('Ajustes por motivo', 'adjusted')):
        counts: dict[str, int] = summary[key]
        lines += ['', f'{title} (total {sum(counts.values())}):']
        lines += [f'  {code}: {count}' for code, count in counts.items()] or ['  (ninguno)']
    return '\n'.join(lines)


def write_output(catalog: Catalog, summary: dict[str, Any], destination: Path) -> None:
    """Vuelca el resumen y la salida normalizada a un JSON determinista."""
    document = {'summary': summary, **catalog.to_dict()}
    text = json.dumps(document, ensure_ascii=False, indent=2)
    destination.write_text(text + '\n', encoding='utf-8')


def main(argv: list[str] | None = None) -> int:
    args_list = sys.argv[1:] if argv is None else argv
    if args_list[:1] == ['cargar']:
        from .load_cli import main as load_main

        return load_main(args_list[1:])
    if args_list[:1] == ['cargar-hibridos']:
        from .hybrids_cli import load_main as load_hybrids_main

        return load_hybrids_main(args_list[1:])
    if args_list[:1] == ['validar-hibridos']:
        from .hybrids_cli import validate_main

        return validate_main(args_list[1:])
    parser = argparse.ArgumentParser(
        prog='orki-catalogo',
        description=(
            'Lee la exportación de ChecklistBank (zip o TSV), filtra Orchidaceae, normaliza '
            'y muestra un resumen. Solo lectura: no se conecta a ninguna base de datos. '
            'Para cargar el catálogo en la base: orki-catalogo cargar --help. Para la lista '
            'curada de híbridos: orki-catalogo validar-hibridos --help y '
            'orki-catalogo cargar-hibridos --help.'
        ),
    )
    parser.add_argument('archivo', type=Path, help='export.zip de ChecklistBank o su TSV.')
    parser.add_argument(
        '--salida',
        type=Path,
        help='Archivo JSON donde volcar la salida normalizada y las incidencias.',
    )
    args = parser.parse_args(args_list)
    if not args.archivo.is_file():
        parser.error(f'No existe el archivo {args.archivo}.')
    try:
        catalog, summary = run(args.archivo)
    except SourceFormatError as error:
        print(f'Error de formato: {error}', file=sys.stderr)
        return 1
    print(format_summary(summary))
    if args.salida:
        write_output(catalog, summary, args.salida)
        print(f'\nSalida normalizada escrita en {args.salida}')
    return 0
