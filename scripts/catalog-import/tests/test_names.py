import pytest

from catalog_import.names import clean_spaces, name_shape, normalize_name, strip_hybrid_sign

# Caracteres invisibles o parecidos a otros, escritos por su código.
NO_BREAK_SPACE = chr(0x00A0)
HEAVY_X = chr(0x2715)


@pytest.mark.parametrize(
    ('raw', 'expected'),
    [
        ('  Cattleya   bullieri ', 'Cattleya bullieri'),
        (f'Cattleya{NO_BREAK_SPACE}labiata', 'Cattleya labiata'),
        ('Cattleya\tlabiata\n', 'Cattleya labiata'),
        ('', ''),
    ],
)
def test_clean_spaces(raw: str, expected: str) -> None:
    assert clean_spaces(raw) == expected


@pytest.mark.parametrize(
    ('raw', 'expected'),
    [
        # Ya normalizados: no cambian.
        ('Phalaenopsis × intermedia', 'Phalaenopsis × intermedia'),
        ('× Anacamptorchis bassoulsii', '× Anacamptorchis bassoulsii'),
        # Signo pegado.
        ('×Anacamptorchis bassoulsii', '× Anacamptorchis bassoulsii'),
        ('Phalaenopsis ×intermedia', 'Phalaenopsis × intermedia'),
        # «x» latina suelta como signo.
        ('Phalaenopsis x intermedia', 'Phalaenopsis × intermedia'),
        ('X Anacamptorchis bassoulsii', '× Anacamptorchis bassoulsii'),
        ('Anacamptis morio x palustris', 'Anacamptis morio × palustris'),
        # Aspa tipográfica parecida.
        (f'Phalaenopsis {HEAVY_X} intermedia', 'Phalaenopsis × intermedia'),
        # Una «x» dentro de una palabra no es un signo.
        ('Oncidium xanthodon', 'Oncidium xanthodon'),
        ('  Cattleya   bullieri ', 'Cattleya bullieri'),
    ],
)
def test_normalize_name(raw: str, expected: str) -> None:
    assert normalize_name(raw) == expected


@pytest.mark.parametrize(
    ('name', 'genus', 'is_hybrid', 'is_formula', 'is_binomial'),
    [
        ('Phalaenopsis amabilis', 'Phalaenopsis', False, False, True),
        ('Phalaenopsis × intermedia', 'Phalaenopsis', True, False, True),
        ('× Anacamptorchis bassoulsii', 'Anacamptorchis', True, False, True),
        ('Cattleya labiata f. alba', 'Cattleya', False, False, False),
        ('Cattleya × dominiana alba', 'Cattleya', True, False, False),
        ('Dactylorhiza incarnata nothosubsp. × kerneriorum', 'Dactylorhiza', True, False, False),
        # Fórmulas híbridas.
        ('Anacamptis morio × Orchis mascula', 'Anacamptis', True, True, False),
        ('Anacamptis morio × palustris', 'Anacamptis', True, True, False),
        ('Dactylorhiza incarnata var. cruenta × maculata', 'Dactylorhiza', True, True, False),
        ('Platanthera bifolia s. l. × chlorantha', 'Platanthera', True, True, False),
        ('× × Foo bar', 'Foo', True, True, False),
        # Identificadores moleculares.
        ('BOLD:AAM4945', 'BOLD:AAM4945', False, False, False),
    ],
)
def test_name_shape(
    name: str, genus: str, is_hybrid: bool, is_formula: bool, is_binomial: bool
) -> None:
    shape = name_shape(name)
    assert (shape.genus, shape.is_hybrid, shape.is_formula, shape.is_binomial) == (
        genus,
        is_hybrid,
        is_formula,
        is_binomial,
    )


def test_strip_hybrid_sign() -> None:
    assert strip_hybrid_sign('× Anacamptorchis') == 'Anacamptorchis'
    assert strip_hybrid_sign('Phalaenopsis × intermedia') == 'Phalaenopsis intermedia'
