"""Emparejamiento con iNaturalist: lectura del catálogo, reglas, fotos, reporte y resumen."""

from __future__ import annotations

import csv
from pathlib import Path

import pytest

from catalog_import.inaturalist import Photo, Taxon
from catalog_import.inaturalist_match import (
    EXPORT_HEADER,
    REPORT_HEADER,
    Alternatives,
    CatalogEntry,
    CatalogFormatError,
    Chosen,
    DefaultPhoto,
    Match,
    Row,
    TaxonIndex,
    attribution,
    choose_photo,
    in_scope,
    match_catalog,
    read_catalog,
    summarize,
    write_report,
)

from .conftest import SAMPLE

HYBRIDS = Path(__file__).parents[1] / 'data' / 'hibridos.csv'


def photo(i: int, code: str | None, author: str | None = 'Autora', **extra: object) -> Photo:
    return Photo(i, code, '', author, f'https://x/photos/{i}/square.jpg', **extra)  # type: ignore[arg-type]


def taxon(
    i: int,
    name: str,
    *,
    active: bool = True,
    synonyms: tuple[str, ...] = (),
    current: tuple[int, ...] = (),
    default: Photo | None = None,
    observations: int = 5,
    rank: str = 'species',
) -> Taxon:
    return Taxon(i, name, rank, active, synonyms, current, default, observations)


def entry(
    name: str, *synonyms: str, ref: str = 'R', genus: str = '', plants: int | None = None
) -> CatalogEntry:
    return CatalogEntry(
        ref, name, genus or name.split(' ')[0], 'species', tuple(synonyms), plants, 'prueba'
    )


# Lectura del catálogo -----------------------------------------------------------------------


def test_reads_col_sample_with_the_importer_normalization() -> None:
    entries = {e.name: e for e in read_catalog(SAMPLE)}
    assert len(entries) == 10
    # La muestra tiene «␣␣Cattleya␣␣␣bullieri␣» como sinónimo: sale limpio, como en la carga.
    assert entries['Cattleya labiata'].synonyms[0] == 'Cattleya bullieri'
    assert entries['Phalaenopsis × intermedia'].type == 'hybrid'
    assert entries['× Anacamptorchis bassoulsii'].genus == '× Anacamptorchis'


def test_reads_json_output(tmp_path: Path) -> None:
    from catalog_import.cli import main

    output = tmp_path / 'catalogo.json'
    assert main([str(SAMPLE), '--salida', str(output)]) == 0
    assert read_catalog(output) == read_catalog(SAMPLE)


def test_reads_curated_hybrids_with_other_names() -> None:
    entries = {e.ref: e for e in read_catalog(HYBRIDS)}
    sogo = entries['HIB-0001']
    assert (sogo.name, sogo.type, sogo.source) == (
        'Phalaenopsis Sogo Yukidian',
        'hybrid',
        'curated',
    )
    assert sogo.synonyms == ('Doritaenopsis Sogo Yukidian',)


def test_reads_database_export(tmp_path: Path) -> None:
    path = tmp_path / 'exportacion.csv'
    path.write_text(
        ','.join(EXPORT_HEADER) + '\n'
        'e1,Phalaenopsis  amabilis,Phalaenopsis,species,Epidendrum amabile | Cymbidium amabile,3\n'
        'e2,Cattleya x hybrida,Cattleya,hybrid,,\n',
        encoding='utf-8-sig',
    )
    first, second = read_catalog(path)
    assert first.name == 'Phalaenopsis amabilis'
    assert first.synonyms == ('Epidendrum amabile', 'Cymbidium amabile')
    assert first.plants == 3
    assert (second.name, second.plants) == ('Cattleya × hybrida', None)


@pytest.mark.parametrize(
    ('name', 'content', 'message'),
    [
        ('otro.csv', 'a,b\n', 'cabecera no reconocida'),
        ('e.csv', ','.join(EXPORT_HEADER) + '\ne1,Vanda coerulea\n', 'columnas'),
        ('e.csv', ','.join(EXPORT_HEADER) + '\ne1,Vanda coerulea,Vanda,species,,x\n', 'número'),
        ('e.csv', ','.join(EXPORT_HEADER) + '\n,Vanda coerulea,Vanda,species,,\n', 'falta id'),
        ('c.json', '{"otra": 1}', 'orki-catalogo --salida'),
        ('c.txt', '', 'tipo de archivo'),
    ],
)
def test_rejects_unknown_formats(tmp_path: Path, name: str, content: str, message: str) -> None:
    path = tmp_path / name
    path.write_text(content, encoding='utf-8')
    with pytest.raises(CatalogFormatError, match=message):
        read_catalog(path)


def test_rejects_invalid_hybrid_list(tmp_path: Path) -> None:
    path = tmp_path / 'hibridos.csv'
    lines = HYBRIDS.read_text(encoding='utf-8').splitlines()
    path.write_text('\n'.join([*lines[:2], lines[1]]) + '\n', encoding='utf-8')
    with pytest.raises(CatalogFormatError, match='ID_REPETIDO'):
        read_catalog(path)


# Emparejamiento -----------------------------------------------------------------------------


def results_by_name(entries: list[CatalogEntry], taxa: list[Taxon]) -> dict[str, object]:
    return {r.entry.name: r for r in match_catalog(entries, TaxonIndex.build(taxa))}


def test_accepted_name_ignores_case_spaces_and_hybrid_sign() -> None:
    taxa = [taxon(1, 'Phalaenopsis × intermedia', rank='hybrid'), taxon(2, 'Vanda coerulea')]
    results = results_by_name([entry('Phalaenopsis intermedia'), entry('vanda  Coerulea')], taxa)
    assert {n: (r.match, r.taxon.id) for n, r in results.items()} == {  # type: ignore[attr-defined]
        'Phalaenopsis intermedia': (Match.ACCEPTED, 1),
        'vanda  Coerulea': (Match.ACCEPTED, 2),
    }


def test_synonym_routes() -> None:
    taxa = [
        # El catálogo tiene un sinónimo que es el nombre aceptado en iNaturalist.
        taxon(1, 'Phalaenopsis aphrodite'),
        # iNaturalist tiene como sinónimo el nombre aceptado del catálogo.
        taxon(2, 'Phalaenopsis pulcherrima', synonyms=('Doritis pulcherrima',)),
        # Un taxón inactivo con el nombre del catálogo, sustituido por uno activo.
        taxon(3, 'Phalaenopsis × intermedia', rank='hybrid'),
        taxon(4, 'Phalaenopsis intermedia', active=False, current=(3,)),
        # Inactivo sustituido por uno que no se leyó: no cuenta.
        taxon(5, 'Phalaenopsis regnieriana', active=False, current=(903992,)),
    ]
    results = results_by_name(
        [
            entry('Aphrodite formosana', 'Phalaenopsis aphrodite'),
            entry('Doritis pulcherrima'),
            entry('Phalaenopsis regnieriana'),
        ],
        taxa,
    )
    assert results['Aphrodite formosana'].match is Match.SYNONYM  # type: ignore[attr-defined]
    assert results['Aphrodite formosana'].via == 'Phalaenopsis aphrodite'  # type: ignore[attr-defined]
    assert results['Doritis pulcherrima'].taxon.id == 2  # type: ignore[attr-defined]
    assert results['Doritis pulcherrima'].via == 'Doritis pulcherrima'  # type: ignore[attr-defined]
    assert results['Phalaenopsis regnieriana'].match is Match.NO_TAXON  # type: ignore[attr-defined]


def test_inactive_name_maps_to_its_replacement() -> None:
    taxa = [
        taxon(3, 'Phalaenopsis × intermedia'),
        taxon(4, 'Phalaenopsis lindenii', active=False, current=(3,)),
    ]
    (result,) = match_catalog([entry('Phalaenopsis lindenii')], TaxonIndex.build(taxa))
    assert (result.match, result.taxon.id, result.via) == (  # type: ignore[union-attr]
        Match.SYNONYM,
        3,
        'Phalaenopsis lindenii',
    )


def test_ambiguous_cases() -> None:
    taxa = [
        # Dos taxones activos con el mismo nombre (homónimos).
        taxon(1, 'Epidendrum amabile'),
        taxon(2, 'Epidendrum  amabile'),
        # Una especie cuyos sinónimos llevan a dos taxones distintos.
        taxon(3, 'Oncidium altissimum'),
        taxon(4, 'Oncidium baueri'),
        # Un sinónimo que lleva a un taxón que ya es de otra especie por su nombre aceptado.
        taxon(5, 'Cattleya labiata'),
        # Dos especies que llegan por sinónimo al mismo taxón.
        taxon(6, 'Vanda coerulea'),
    ]
    results = results_by_name(
        [
            entry('Epidendrum amabile'),
            entry('Oncidium sp', 'Oncidium altissimum', 'Oncidium baueri'),
            entry('Cattleya labiata'),
            entry('Cattleya warocqueana', 'Cattleya labiata'),
            entry('Vanda caerulea', 'Vanda coerulea'),
            entry('Vanda coerulea var. alba', 'Vanda coerulea'),
        ],
        taxa,
    )
    ambiguous = {n for n, r in results.items() if r.match is Match.AMBIGUOUS}  # type: ignore[attr-defined]
    assert ambiguous == {
        'Epidendrum amabile',
        'Oncidium sp',
        'Cattleya warocqueana',
        'Vanda caerulea',
        'Vanda coerulea var. alba',
    }
    assert 'ya es de Cattleya labiata' in results['Cattleya warocqueana'].detail  # type: ignore[attr-defined]
    assert results['Cattleya labiata'].match is Match.ACCEPTED  # type: ignore[attr-defined]


def test_grex_without_taxon() -> None:
    (result,) = match_catalog(
        [entry('Phalaenopsis Sogo Yukidian', 'Doritaenopsis Sogo Yukidian')],
        TaxonIndex.build([taxon(1, 'Phalaenopsis amabilis')]),
    )
    assert result.match is Match.NO_TAXON


def test_scope_by_genus_of_name_or_synonym() -> None:
    keys = frozenset({'phalaenopsis'})
    assert in_scope(entry('Phalaenopsis amabilis'), keys)
    assert in_scope(entry('Doritis pulcherrima', 'Phalaenopsis pulcherrima'), keys)
    assert in_scope(entry('Brassocattleya hybrida', genus='× Brassocattleya'), None)
    assert not in_scope(entry('Vanda coerulea'), keys)
    index = TaxonIndex.build(
        [taxon(1, 'Phalaenopsis pulcherrima', synonyms=('Doritis pulcherrima',))]
    )
    assert in_scope(entry('Doritis pulcherrima'), keys, index)
    assert not in_scope(entry('Doritis pulchra'), keys, index)


# Fotos --------------------------------------------------------------------------------------


def test_photo_choice() -> None:
    accepted = taxon(1, 'A a', default=photo(10, 'cc-by'))
    nc = taxon(2, 'A b', default=photo(20, 'cc-by-nc'))
    none = taxon(3, 'A c')
    flagged = taxon(4, 'A d', default=photo(40, 'cc0', flagged=True))
    no_obs = taxon(5, 'A e', default=photo(50, None), observations=0)
    taxon_photos = {
        2: [photo(21, 'cc-by-sa'), photo(22, 'cc0')],
        3: [photo(31, 'cc-by-nc')],
        4: [],
        5: [],
    }
    observations = {3: photo(32, 'cc-by')}

    def choose(t: Taxon, mode: Alternatives) -> tuple[DefaultPhoto, Chosen, int | None]:
        c = choose_photo(t, mode, taxon_photos, observations)
        return c.default, c.chosen, c.photo.id if c.photo else None

    taxon_mode, obs_mode, no_mode = Alternatives.TAXON, Alternatives.OBSERVATIONS, Alternatives.NONE
    assert choose(accepted, no_mode) == (DefaultPhoto.ACCEPTED, Chosen.DEFAULT, 10)
    assert choose(nc, no_mode) == (DefaultPhoto.NOT_ACCEPTED, Chosen.NOT_SEARCHED, None)
    assert choose(nc, taxon_mode) == (DefaultPhoto.NOT_ACCEPTED, Chosen.TAXON, 22)
    assert choose(none, taxon_mode) == (DefaultPhoto.NONE, Chosen.NONE, None)
    assert choose(none, obs_mode) == (DefaultPhoto.NONE, Chosen.OBSERVATION, 32)
    assert choose(flagged, obs_mode) == (DefaultPhoto.ACCEPTED, Chosen.NOT_SEARCHED, None)
    assert choose(no_obs, obs_mode) == (DefaultPhoto.NOT_ACCEPTED, Chosen.NONE, None)
    assert choose(taxon(6, 'A f'), obs_mode)[1] is Chosen.NOT_SEARCHED


def test_attribution_text() -> None:
    assert (
        attribution(photo(1, 'cc-by', 'Ana Pérez')) == 'Foto: © Ana Pérez, CC BY, vía iNaturalist'
    )
    assert attribution(photo(1, 'cc0', 'ana')) == (
        'Foto: ana, sin derechos reservados (CC0), vía iNaturalist'
    )


# Reporte y resumen --------------------------------------------------------------------------


def test_report_and_summary(tmp_path: Path) -> None:
    taxa = [
        taxon(1, 'Phalaenopsis amabilis', default=photo(10, 'cc-by', 'Ana Pérez')),
        taxon(2, 'Phalaenopsis aphrodite', default=photo(20, 'cc-by-nc')),
        taxon(3, 'Masdevallia veitchiana'),
    ]
    index = TaxonIndex.build(taxa)
    results = match_catalog(
        [entry('Phalaenopsis amabilis', plants=2), entry('Phalaenopsis × lindenii')], index
    )

    def choice(t: Taxon):  # type: ignore[no-untyped-def]
        return choose_photo(t, Alternatives.TAXON, {2: [], 3: []}, {})

    species_rows = [
        Row('especie', r.match, r.entry, r.taxon, r.via, choice(r.taxon) if r.taxon else None, '')
        for r in results
    ]
    taxon_rows = [Row('taxon', Match.NO_SPECIES, None, t, '', choice(t), '') for t in taxa]
    path = tmp_path / 'reporte.csv'
    assert write_report(path, [*species_rows, *taxon_rows[1:]]) == 4
    assert path.read_bytes().startswith(b'\xef\xbb\xbf')
    rows = list(csv.DictReader(path.open(encoding='utf-8-sig')))
    assert tuple(rows[0]) == REPORT_HEADER
    assert rows[0]['atribucion'] == 'Foto: © Ana Pérez, CC BY, vía iNaturalist'
    assert rows[0]['foto_url_medium'] == 'https://x/photos/10/medium.jpg'
    assert rows[0]['plantas'] == '2'
    assert rows[1]['emparejamiento'] == 'sin_taxon'
    assert rows[2]['licencia_por_defecto'] == 'CC BY-NC'
    assert rows[3]['genero'] == 'Masdevallia'

    summary = summarize(species_rows, taxon_rows, ['Phalaenopsis', 'Masdevallia'])
    assert summary['catalogo']['emparejamiento'] == {'nombre_aceptado': 1, 'sin_taxon': 1}
    assert summary['catalogo']['con_foto_usable'] == 1
    assert summary['en_colecciones']['total'] == 1
    phal = summary['por_genero']['Phalaenopsis']['inaturalist']
    assert phal['foto_por_defecto'] == {'aceptada': 1, 'no_aceptada': 1}
    assert summary['por_genero']['Masdevallia']['inaturalist']['foto_por_defecto'] == {
        'sin_foto': 1
    }
