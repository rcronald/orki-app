"""Normalización sobre la muestra real y sobre casos inventados que la muestra no cubre."""

import random

import pytest

from catalog_import.model import Action, Catalog, Code, Issue, Species
from catalog_import.normalize import build_catalog
from catalog_import.reader import SourceRecord

from .conftest import record


def _species(catalog: Catalog) -> dict[str, Species]:
    return {sp.source_ref: sp for sp in catalog.species}


def _issues(catalog: Catalog, source_ref: str) -> list[tuple[Action, Code]]:
    return [(i.action, i.code) for i in catalog.issues if i.source_ref == source_ref]


def _issue(catalog: Catalog, source_ref: str, code: Code) -> Issue:
    [found] = [i for i in catalog.issues if i.source_ref == source_ref and i.code is code]
    return found


# Muestra real ------------------------------------------------------------------------------


def test_genera(sample_catalog: Catalog) -> None:
    assert [(g.name, g.source_ref, g.is_hybrid) for g in sample_catalog.genera] == [
        ('Bulbophyllum', '8VRGS', False),
        ('Cattleya', '8VW29', False),
        ('Chamorchis', '8VW5N', False),
        ('Dendrobium', '8VWT5', False),
        ('Orchiserapias', '69FQ', False),
        ('Phalaenopsis', '8W2B9', False),
        ('× Anacamptorchis', '8VTQS', True),
        ('× Brassocattleya', '8VVQS', True),
    ]


def test_species_names_types_and_genera(sample_catalog: Catalog) -> None:
    assert [
        (sp.source_ref, sp.scientific_name, sp.authorship, sp.genus, sp.type)
        for sp in sample_catalog.species
    ] == [
        ('M592X', 'Brassocattleya hybrida', 'hort.', '× Brassocattleya', 'hybrid'),
        ('8W7QM', 'Bulbophyllum fletcherianum', 'J.G.Fowler', 'Bulbophyllum', 'species'),
        ('RWFC', 'Cattleya labiata', 'Lindl.', 'Cattleya', 'species'),
        ('TLRN', 'Chamorchis alpina', '(L.) Rich.', 'Chamorchis', 'species'),
        ('6CJK4', 'Dendrobium thyrsiflorum', 'B.S.Williams', 'Dendrobium', 'species'),
        ('4FR2J', 'Phalaenopsis amabilis', '(L.) Blume', 'Phalaenopsis', 'species'),
        ('4FR2M', 'Phalaenopsis aphrodite', 'Rchb.f.', 'Phalaenopsis', 'species'),
        ('4FR3H', 'Phalaenopsis × intermedia', 'Lindl.', 'Phalaenopsis', 'hybrid'),
        ('66JFS', '× Anacamptorchis bassoulsii', '(Balayer) B.Bock', '× Anacamptorchis', 'hybrid'),
        (
            'L2GFV',
            '× Orchiserapias dhiorii',
            'M.Ackermann & Mar.Ackermann',
            'Orchiserapias',
            'hybrid',
        ),
    ]


def test_accepted_species_with_synonyms(sample_catalog: Catalog) -> None:
    amabilis = _species(sample_catalog)['4FR2J']
    assert [(s.name, s.authorship, s.status, s.rank, s.via) for s in amabilis.synonyms] == [
        ('Cymbidium amabile', '(L.) Roxb.', 'synonym', 'species', None),
        # Sinónimo ambiguo: se carga como sinónimo de la especie a la que apunta.
        ('Epidendrum amabile', 'L.', 'ambiguous synonym', 'species', None),
        # Sinónimos de la subespecie aceptada «subsp. moluccana», reasignados a la especie.
        ('Phalaenopsis amabilis var. moluccana', 'Schltr.', 'synonym', 'variety', '7YKK5'),
        ('Phalaenopsis celebica', 'Vlooten', 'synonym', 'species', '7YKK5'),
    ]
    assert _issues(sample_catalog, '7XWJL') == [(Action.ADJUSTED, Code.SYNONYM_REASSIGNED)]
    assert _issues(sample_catalog, '7YKK5') == [(Action.DISCARDED, Code.INFRASPECIFIC_ACCEPTED)]


def test_lower_rank_synonyms_and_spaces(sample_catalog: Catalog) -> None:
    labiata = _species(sample_catalog)['RWFC']
    assert [(s.name, s.authorship, s.rank) for s in labiata.synonyms] == [
        # El original trae espacios sobrantes en el nombre y en la autoría.
        ('Cattleya bullieri', 'Carrière', 'species'),
        ('Cattleya labiata autumnalis', 'Pynaert', 'infraspecific name'),
        ('Cattleya labiata f. alba', '(Linden & Rodigas) F.Barros & J.A.N.Bat.', 'form'),
    ]
    normalized = _issue(sample_catalog, '7THCP', Code.NAME_NORMALIZED)
    assert normalized.action is Action.ADJUSTED
    assert '«  Cattleya   bullieri »' in normalized.message
    # «Cattleya labiata f. alba» aparece dos veces con distinta autoría: se conserva una.
    repeated = _issue(sample_catalog, 'M9K5Q', Code.DUPLICATE_SYNONYM)
    assert 'Se conserva 7Z22G' in repeated.message


def test_misapplied_is_always_excluded(sample_catalog: Catalog) -> None:
    misapplied = _issue(sample_catalog, '8X2QV', Code.MISAPPLIED)
    assert misapplied.action is Action.DISCARDED
    assert misapplied.name == 'Phalaenopsis amabilis'
    assert _species(sample_catalog)['4FR2M'].synonyms == ()


def test_provisional_and_its_synonyms(sample_catalog: Catalog) -> None:
    # Epipactis atrorubens es provisional y además cuelga de Goodyera: se excluye por
    # provisional, y Goodyera queda sin especies.
    assert _issues(sample_catalog, 'VJRY8') == [(Action.DISCARDED, Code.PROVISIONAL)]
    assert _issues(sample_catalog, '7VYRH') == [(Action.DISCARDED, Code.SYNONYM_OF_PROVISIONAL)]
    assert _issues(sample_catalog, '7Z2JG') == [(Action.DISCARDED, Code.SYNONYM_OF_PROVISIONAL)]
    assert _issues(sample_catalog, '8VXXY') == [(Action.DISCARDED, Code.GENUS_WITHOUT_SPECIES)]
    assert _issues(sample_catalog, '8VXDV') == [(Action.DISCARDED, Code.GENUS_SYNONYM)]


def test_repeated_accepted_name(sample_catalog: Catalog) -> None:
    # Dendrobium thyrsiflorum: la aceptada se importa, la provisional se excluye.
    assert '6CJK4' in _species(sample_catalog)
    assert _issues(sample_catalog, 'N8D5X') == [(Action.DISCARDED, Code.PROVISIONAL)]


def test_hybrids(sample_catalog: Catalog) -> None:
    assert _issues(sample_catalog, '4FR3H') == []
    assert _issues(sample_catalog, '66JFS') == []
    # El nombre no lleva «×» pero su género sí, y al revés: se importan como híbridos.
    for source_ref in ('M592X', 'L2GFV'):
        assert _issues(sample_catalog, source_ref) == [
            (Action.ADJUSTED, Code.INCONSISTENT_HYBRID_SIGN)
        ]


def test_hybrid_formulas(sample_catalog: Catalog) -> None:
    for source_ref in ('VQSPG', 'VQQXL', 'VQQMR'):
        assert _issues(sample_catalog, source_ref) == [(Action.DISCARDED, Code.HYBRID_FORMULA)]
    # La «x» latina de la fuente se muestra normalizada en la incidencia.
    assert _issue(sample_catalog, 'VQQXL', Code.HYBRID_FORMULA).name == (
        'Anacamptis morio × palustris'
    )
    excluded = _issue(sample_catalog, 'R8WB3', Code.SYNONYM_OF_EXCLUDED)
    assert 'descartada por FORMULA_HIBRIDA' in excluded.message
    # Su género (Anacamptis) se queda sin especies en la muestra.
    assert _issues(sample_catalog, '8VTQR') == [(Action.DISCARDED, Code.GENUS_WITHOUT_SPECIES)]


def test_other_discards(sample_catalog: Catalog) -> None:
    assert _issues(sample_catalog, 'BOLD.AAM4945') == [(Action.DISCARDED, Code.UNRANKED)]
    assert _issues(sample_catalog, 'SH1132364.10FU') == [(Action.DISCARDED, Code.UNRANKED)]
    assert _issues(sample_catalog, 'LLFHH') == [(Action.DISCARDED, Code.RANK_NOT_IMPORTED)]
    assert _issues(sample_catalog, '7SXQ6') == [(Action.DISCARDED, Code.SYNONYM_EQUALS_ACCEPTED)]
    assert _issues(sample_catalog, '3L28K') == [(Action.DISCARDED, Code.DUPLICATE_SYNONYM)]
    # Sinónimo de una forma aceptada que cuelga directamente del género.
    assert _issues(sample_catalog, 'VCLHB') == [(Action.DISCARDED, Code.SYNONYM_WITHOUT_TARGET)]
    assert _issues(sample_catalog, 'VCLHC') == [(Action.DISCARDED, Code.INFRASPECIFIC_ACCEPTED)]


def test_every_family_record_is_accounted_for(
    sample_records: list[SourceRecord], sample_catalog: Catalog
) -> None:
    output = {g.source_ref for g in sample_catalog.genera}
    output |= {sp.source_ref for sp in sample_catalog.species}
    output |= {s.source_ref for sp in sample_catalog.species for s in sp.synonyms}
    discarded = {i.source_ref for i in sample_catalog.issues if i.action is Action.DISCARDED}
    assert not output & discarded
    assert output | discarded == {r.id for r in sample_records}


def test_output_is_deterministic(sample_records: list[SourceRecord]) -> None:
    expected = build_catalog(sample_records)
    shuffled = list(sample_records)
    random.Random(73).shuffle(shuffled)
    assert build_catalog(shuffled) == expected


# Casos inventados ------------------------------------------------------------------------


def test_repeated_names_ignoring_case() -> None:
    catalog = build_catalog(
        [
            record('G1', 'F', 'accepted', 'genus', 'Dendrobium', 'Sw.'),
            record('S2', 'G1', 'accepted', 'species', 'DENDROBIUM thyrsiflorum', 'Rchb.f.'),
            record('S1', 'G1', 'accepted', 'species', 'Dendrobium thyrsiflorum'),
            record('S3', 'G1', 'accepted', 'species', 'Dendrobium thyrsiflorum', 'B.S.Williams'),
            record('Y1', 'S1', 'synonym', 'species', 'Callista thyrsiflora'),
        ]
    )
    # Se conserva la que tiene autoría y, a igualdad, la de identificador menor.
    assert [sp.source_ref for sp in catalog.species] == ['S2']
    assert _issues(catalog, 'S1') == [(Action.DISCARDED, Code.DUPLICATE_SPECIES)]
    assert _issues(catalog, 'S3') == [(Action.DISCARDED, Code.DUPLICATE_SPECIES)]
    assert (
        'descartada por NOMBRE_REPETIDO' in _issue(catalog, 'Y1', Code.SYNONYM_OF_EXCLUDED).message
    )


def test_synonym_equal_to_accepted_ignoring_case_and_spaces() -> None:
    catalog = build_catalog(
        [
            record('G1', 'F', 'accepted', 'genus', 'Vanda'),
            record('S1', 'G1', 'accepted', 'species', 'Vanda coerulea', 'Griff. ex Lindl.'),
            record('Y1', 'S1', 'synonym', 'species', 'Vanda  Coerulea', 'Rchb.f.'),
            record('Y2', 'S1', 'ambiguous synonym', 'species', 'Vanda caerulea'),
            record('Y3', 'S1', 'synonym', 'species', 'VANDA CAERULEA'),
        ]
    )
    [vanda] = catalog.species
    # Entre dos sinónimos repetidos se prefiere el no ambiguo.
    assert [(s.source_ref, s.name) for s in vanda.synonyms] == [('Y3', 'VANDA CAERULEA')]
    assert _issues(catalog, 'Y1') == [(Action.DISCARDED, Code.SYNONYM_EQUALS_ACCEPTED)]
    assert _issues(catalog, 'Y2') == [(Action.DISCARDED, Code.DUPLICATE_SYNONYM)]


def test_genus_is_the_parent_even_if_the_name_says_otherwise() -> None:
    catalog = build_catalog(
        [
            record('G1', 'F', 'accepted', 'genus', 'Goodyera', 'R.Br.'),
            record('S1', 'G1', 'accepted', 'species', 'Epipactis atrorubens', '(Hoffm.) Besser'),
        ]
    )
    [species] = catalog.species
    assert (species.genus, species.genus_ref) == ('Goodyera', 'G1')
    adjusted = _issue(catalog, 'S1', Code.GENUS_DIFFERS_FROM_NAME)
    assert adjusted.action is Action.ADJUSTED
    assert '«Epipactis»' in adjusted.message


def test_genus_found_through_intermediate_ranks() -> None:
    catalog = build_catalog(
        [
            record('G1', 'F', 'accepted', 'genus', 'Dendrobium'),
            record('SG', 'G1', 'accepted', 'subgenus', 'Dendrobium subg. Aporum'),
            record('S1', 'SG', 'accepted', 'species', 'Dendrobium aloifolium'),
            record('S2', 'X', 'accepted', 'species', 'Dendrobium huerfanum'),
        ]
    )
    assert [(sp.source_ref, sp.genus) for sp in catalog.species] == [('S1', 'Dendrobium')]
    assert _issues(catalog, 'SG') == [(Action.DISCARDED, Code.RANK_NOT_IMPORTED)]
    assert _issues(catalog, 'S2') == [(Action.DISCARDED, Code.NO_GENUS)]


def test_repeated_genus_names() -> None:
    catalog = build_catalog(
        [
            record('G1', 'F', 'accepted', 'genus', 'Vanda'),
            record('G2', 'F', 'accepted', 'genus', 'VANDA'),
            record('S1', 'G2', 'accepted', 'species', 'Vanda tricolor'),
        ]
    )
    assert [(g.name, g.source_ref) for g in catalog.genera] == [('Vanda', 'G1')]
    assert catalog.species[0].genus_ref == 'G1'
    assert _issues(catalog, 'G2') == [(Action.DISCARDED, Code.DUPLICATE_GENUS)]


def test_hybrid_sign_is_normalized() -> None:
    catalog = build_catalog(
        [
            record('G1', 'F', 'accepted', 'genus', '×Aliceara'),
            record('S1', 'G1', 'accepted', 'species', '×Aliceara  hort'),
            record('G2', 'F', 'accepted', 'genus', 'Phalaenopsis'),
            record('S2', 'G2', 'accepted', 'species', 'Phalaenopsis x intermedia'),
        ]
    )
    assert [(sp.scientific_name, sp.genus, sp.type) for sp in catalog.species] == [
        ('Phalaenopsis × intermedia', 'Phalaenopsis', 'hybrid'),
        ('× Aliceara hort', '× Aliceara', 'hybrid'),
    ]
    assert {i.source_ref for i in catalog.issues if i.code is Code.NAME_NORMALIZED} == {
        'G1',
        'S1',
        'S2',
    }


def test_unknown_status_and_invalid_name() -> None:
    catalog = build_catalog(
        [
            record('G1', 'F', 'accepted', 'genus', 'Vanda'),
            record('S1', 'G1', 'doubtful', 'species', 'Vanda dudosa'),
            record('S2', 'G1', 'accepted', 'species', 'Vanda'),
        ]
    )
    assert _issues(catalog, 'S1') == [(Action.DISCARDED, Code.UNKNOWN_STATUS)]
    assert _issues(catalog, 'S2') == [(Action.DISCARDED, Code.INVALID_NAME)]


def test_repeated_ids_are_rejected() -> None:
    with pytest.raises(ValueError, match='repetido'):
        build_catalog(
            [
                record('G1', 'F', 'accepted', 'genus', 'Vanda'),
                record('G1', 'F', 'accepted', 'genus', 'Vanda'),
            ]
        )
