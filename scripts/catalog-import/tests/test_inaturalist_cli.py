"""``orki-catalogo emparejar-inaturalist`` de principio a fin, con respuestas reales grabadas.

Las respuestas (``tests/data/inaturalist/respuestas.json``) son de la API de iNaturalist del
22 de noviembre de 2026, recortadas a unos pocos taxones de Phalaenopsis y a los campos que usa
la herramienta (ver ``tests/data/PROCEDENCIA.md``). La red está bloqueada en las pruebas: el
transporte las sirve por URL y falla con cualquier otra.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

import pytest

from catalog_import.cli import main as cli_main
from catalog_import.inaturalist import HttpStatus
from catalog_import.inaturalist_cli import INCOMPLETE, main
from catalog_import.inaturalist_match import EXPORT_HEADER

from .conftest import DATA, SAMPLE

RESPONSES = DATA / 'inaturalist' / 'respuestas.json'
HYBRIDS = Path(__file__).parents[1] / 'data' / 'hibridos.csv'


class Recorded:
    def __init__(self) -> None:
        self.responses: dict[str, object] = json.loads(RESPONSES.read_text(encoding='utf-8'))
        self.calls: list[str] = []

    def __call__(self, url: str) -> bytes:
        self.calls.append(url)
        if url not in self.responses:
            raise HttpStatus(404)
        return json.dumps(self.responses[url]).encode()


@pytest.fixture(autouse=True)
def _no_waiting(monkeypatch: pytest.MonkeyPatch) -> None:
    """El ritmo de una petición por segundo se prueba en test_inaturalist.py; aquí no se
    espera de verdad."""
    monkeypatch.setattr('catalog_import.inaturalist.time.sleep', lambda _seconds: None)


@pytest.fixture
def export(tmp_path: Path) -> Path:
    path = tmp_path / 'exportacion.csv'
    path.write_text(
        ','.join(EXPORT_HEADER) + '\n'
        'e1,Doritis pulcherrima,Doritis,species,,4\n'
        'e2,Phalaenopsis taenialis,Phalaenopsis,species,Aerides taenialis,1\n'
        'e3,Phalaenopsis braceana,Phalaenopsis,species,,\n'
        'e4,Vanda coerulea,Vanda,species,,7\n',
        encoding='utf-8',
    )
    return path


def run(tmp_path: Path, *extra: str, fetch: Recorded | None = None) -> tuple[int, Path, Recorded]:
    fetch = fetch or Recorded()
    report = tmp_path / 'reporte.csv'
    code = main(
        [
            '--genero',
            'Phalaenopsis',
            '--cache',
            str(tmp_path / 'cache'),
            '--reporte',
            str(report),
            '--resumen-json',
            str(tmp_path / 'resumen.json'),
            *extra,
        ],
        fetch=fetch,
    )
    return code, report, fetch


def rows(report: Path) -> dict[str, dict[str, str]]:
    return {
        r['nombre']: r
        for r in csv.DictReader(report.open(encoding='utf-8-sig'))
        if r['entidad'] == 'especie'
    }


def test_end_to_end(tmp_path: Path, export: Path, capsys: pytest.CaptureFixture[str]) -> None:
    code, report, fetch = run(
        tmp_path,
        '--catalogo',
        str(SAMPLE),
        '--catalogo',
        str(HYBRIDS),
        '--catalogo',
        str(export),
        '--alternativas',
        'observaciones',
    )
    assert code == 0
    assert all(url.startswith('https://api.inaturalist.org/v1/') for url in fetch.calls)
    by_name = rows(report)

    def cells(name: str, *columns: str) -> tuple[str, ...]:
        return tuple(by_name[name][c] for c in columns)

    columns = ('emparejamiento', 'inat_id', 'foto_por_defecto', 'foto_elegida', 'licencia')
    # Foto por defecto con todos los derechos reservados: sale una del taxón con CC BY.
    assert cells('Phalaenopsis amabilis', *columns) == (
        'nombre_aceptado',
        '344883',
        'no_aceptada',
        'del_taxon',
        'CC BY',
    )
    # Por defecto CC BY-NC y ninguna del taxón (la grabación tiene hasta 4): de una observación.
    assert cells('Phalaenopsis aphrodite', *columns) == (
        'nombre_aceptado',
        '864477',
        'no_aceptada',
        'de_observacion',
        'CC BY',
    )
    assert by_name['Phalaenopsis aphrodite']['observacion'] == (
        'https://www.inaturalist.org/observations/138235668'
    )
    # El híbrido natural de COL empareja con «Phalaenopsis × intermedia», sin foto aceptada.
    assert cells('Phalaenopsis × intermedia', *columns) == (
        'nombre_aceptado',
        '1127035',
        'no_aceptada',
        'ninguna',
        '',
    )
    # El nombre del catálogo es un sinónimo en iNaturalist (y entra aunque sea otro género).
    assert cells('Doritis pulcherrima', 'emparejamiento', 'nombre_emparejado', 'inat_nombre') == (
        'sinonimo',
        'Doritis pulcherrima',
        'Phalaenopsis pulcherrima',
    )
    # Foto por defecto CC BY: se usa tal cual, con su atribución.
    assert cells('Phalaenopsis taenialis', 'foto_elegida', 'atribucion', 'foto_url_medium') == (
        'por_defecto',
        'Foto: © murkymark, CC BY, vía iNaturalist',
        'https://inaturalist-open-data.s3.amazonaws.com/photos/30254119/medium.jpg',
    )
    # «Phalaenopsis braceana» es un taxón activo y también un nombre inactivo que apunta a
    # P. taenialis: gana el nombre aceptado.
    assert cells('Phalaenopsis braceana', 'inat_id', 'foto_por_defecto') == ('1598483', 'sin_foto')
    # Los grex de la lista curada no son taxones de iNaturalist.
    assert by_name['Phalaenopsis Sogo Yukidian']['emparejamiento'] == 'sin_taxon'
    # Vanda no se leyó: fuera del alcance, no sale en el reporte.
    assert 'Vanda coerulea' not in by_name
    taxa = [
        r['inat_nombre']
        for r in csv.DictReader(report.open(encoding='utf-8-sig'))
        if r['entidad'] == 'taxon'
    ]
    assert taxa == ['Phalaenopsis hygrochila']

    summary = json.loads((tmp_path / 'resumen.json').read_text(encoding='utf-8'))
    assert summary['en_colecciones']['total'] == 2
    assert summary['en_colecciones']['con_foto_usable'] == 2
    phal = summary['por_genero']['Phalaenopsis']['inaturalist']
    assert phal['total'] == 7
    assert phal['foto_por_defecto'] == {'aceptada': 1, 'no_aceptada': 5, 'sin_foto': 1}
    out = capsys.readouterr().out
    assert 'Alcance en iNaturalist: Phalaenopsis' in out
    assert 'de ellas, en alguna colección: 2' in out


def test_second_run_comes_entirely_from_the_cache(tmp_path: Path, export: Path) -> None:
    first_code, first_report, first = run(tmp_path, '--catalogo', str(export))
    assert first_code == 0
    assert first.calls
    second = Recorded()
    code, report, _ = run(tmp_path, '--catalogo', str(export), '--sin-red', fetch=second)
    assert code == 0
    assert second.calls == []
    assert report.read_bytes() == first_report.read_bytes()


def test_budget_cut_resumes_on_next_run(tmp_path: Path, export: Path) -> None:
    code, report, first = run(tmp_path, '--catalogo', str(export), '--max-peticiones', '1')
    assert code == INCOMPLETE
    assert not report.exists()
    assert len(first.calls) == 1
    code, report, second = run(tmp_path, '--catalogo', str(export))
    assert code == 0
    assert first.calls[0] not in second.calls


def test_dispatch_from_main_cli(tmp_path: Path) -> None:
    with pytest.raises(SystemExit) as error:
        cli_main(['emparejar-inaturalist', '--intervalo', '0.5'])
    assert error.value.code == 2


def test_rejects_bad_options(tmp_path: Path) -> None:
    for options in (['--max-peticiones', '20000'], ['--catalogo', str(tmp_path / 'no')]):
        with pytest.raises(SystemExit):
            main(options)
