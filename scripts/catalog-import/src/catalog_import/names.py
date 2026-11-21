"""Limpieza y análisis de nombres científicos.

Reglas comunes a géneros, especies y sinónimos:

- Espacios: sin espacios al principio ni al final y uno solo entre palabras, igual que exigen
  las restricciones ``*_clean`` de la base. Cualquier espacio Unicode (también el de no
  separación) cuenta como espacio.
- Signo de híbrido: siempre el carácter «×» (U+00D7) como palabra suelta, seguido de un
  espacio: «× Anacamptorchis», «Phalaenopsis × intermedia». Se corrigen las variantes «×Nombre»
  (pegado) y la «x» o «X» latina usada como signo cuando va suelta entre palabras.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

HYBRID_SIGN = '×'

# Signos que se usan en lugar de «×»: aspas tipográficas parecidas (U+2715, U+2716 y U+2A2F).
# Se escriben por su código para que se vean en el código fuente.
_LOOKALIKE_SIGNS = str.maketrans(
    dict.fromkeys((chr(0x2715), chr(0x2716), chr(0x2A2F)), HYBRID_SIGN)
)

# «×» pegado a la palabra siguiente («×Aliceara», «×intermedia»).
_ATTACHED_SIGN = re.compile(r'×(?=\S)')


def clean_spaces(text: str) -> str:
    """Quita los espacios de los extremos y deja uno solo entre palabras."""
    return ' '.join(text.split())


def normalize_name(text: str) -> str:
    """Devuelve el nombre con los espacios limpios y el signo de híbrido uniforme."""
    text = text.translate(_LOOKALIKE_SIGNS)
    text = _ATTACHED_SIGN.sub('× ', text)
    words = clean_spaces(text).split(' ')
    for i, word in enumerate(words):
        # Una «x» suelta solo es el signo de híbrido si va entre palabras de un nombre
        # (o al principio, delante de un género). Ningún epíteto es una «x» sola.
        if word in ('x', 'X') and len(words) > 1:
            words[i] = HYBRID_SIGN
    return ' '.join(words)


# Marcadores de rango infraespecífico, con y sin el prefijo «notho» de los híbridos.
_RANK_MARKERS = frozenset(
    prefix + marker
    for prefix in ('', 'notho')
    for marker in (
        'subsp.',
        'ssp.',
        'var.',
        'subvar.',
        'f.',
        'fo.',
        'forma',
        'subf.',
        'lusus',
        'prol.',
        'proles',
        'race',
        'convar.',
    )
)


def _is_rank_marker(word: str) -> bool:
    """«subsp.», «var.», «f.», «nothosubsp.», «prol.», «lusus»…"""
    return word in _RANK_MARKERS


@dataclass(frozen=True, slots=True)
class NameShape:
    """Lo que interesa de un nombre ya normalizado."""

    # Género tal como aparece en el nombre, sin el signo «×».
    genus: str
    # Si el nombre lleva el signo «×» en una posición propia de un híbrido nombrado.
    is_hybrid: bool
    # Si es una fórmula híbrida («A × B»): dos nombres unidos por «×».
    is_formula: bool
    # Si es un binomio (con o sin «×»): «Género epíteto».
    is_binomial: bool


def name_shape(name: str) -> NameShape:
    """Analiza un nombre ya normalizado con :func:`normalize_name`.

    Un «×» es propio de un híbrido nombrado cuando va al principio (delante del género,
    nothogénero) o justo delante de un epíteto en minúscula que sigue al género o a un
    marcador de rango (nothoespecie, nothovariedad…). Cualquier otro «×» une dos nombres:
    es una fórmula híbrida, como «Anacamptis morio × Orchis mascula» o
    «Dactylorhiza incarnata × maculata».
    """
    words = name.split(' ')
    is_hybrid = False
    is_formula = False
    for i, word in enumerate(words):
        if word != HYBRID_SIGN:
            continue
        is_hybrid = True
        following = words[i + 1] if i + 1 < len(words) else ''
        if i == 0:
            if not following[:1].isupper():
                is_formula = True
            continue
        previous = words[i - 1]
        # Tras el género (nothoespecie) o tras un marcador de rango (nothovariedad…).
        named_position = previous != HYBRID_SIGN if i == 1 else _is_rank_marker(previous)
        if not named_position or not following[:1].islower():
            is_formula = True
    plain = [w for w in words if w != HYBRID_SIGN]
    genus = plain[0] if plain else ''
    is_binomial = (
        not is_formula
        and len(plain) == 2
        and plain[0][:1].isupper()
        and plain[1][:1].islower()
        and not _is_rank_marker(plain[1])
    )
    return NameShape(
        genus=genus, is_hybrid=is_hybrid, is_formula=is_formula, is_binomial=is_binomial
    )


def strip_hybrid_sign(name: str) -> str:
    """Nombre sin el signo «×», para comparar géneros escritos con y sin él."""
    return clean_spaces(name.replace(HYBRID_SIGN, ' '))


def match_key(name: str) -> str:
    """Clave para casar nombres: sin el signo «×», sin mayúsculas y con los espacios limpios.

    La usan la carga de COL para los géneros y la lista curada de híbridos para géneros y
    nombres, igual que la búsqueda, que tampoco distingue el signo.
    """
    return strip_hybrid_sign(name).lower()
