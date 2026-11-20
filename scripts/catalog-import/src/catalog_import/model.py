"""Modelo intermedio del catálogo, independiente de la base de datos.

Es lo que produce la normalización y lo que leerá la carga (#74). Los valores ya cumplen lo
que exige el esquema (``supabase/migrations/*_crear_catalogo_especies.sql``): nombres sin
espacios sobrantes, nombres científicos únicos sin distinguir mayúsculas y cada sinónimo
una sola vez por especie, distinto del nombre aceptado.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import asdict, dataclass
from enum import StrEnum
from typing import Any, Literal

# Valores del enumerado species_type de la base.
SpeciesType = Literal['species', 'hybrid']
# Estados de COL que se cargan como sinónimo.
SynonymStatus = Literal['synonym', 'ambiguous synonym']


class Action(StrEnum):
    """Qué se hizo con un registro que aparece en las incidencias."""

    DISCARDED = 'descartado'
    ADJUSTED = 'ajustado'


class Code(StrEnum):
    """Códigos estables de las incidencias. El texto de cada uno está en :data:`REASONS`."""

    # Descartes.
    UNRANKED = 'SIN_RANGO'
    MISAPPLIED = 'MAL_APLICADO'
    PROVISIONAL = 'PROVISIONAL'
    UNKNOWN_STATUS = 'ESTADO_DESCONOCIDO'
    RANK_NOT_IMPORTED = 'RANGO_NO_IMPORTADO'
    INFRASPECIFIC_ACCEPTED = 'INFRAESPECIFICO_ACEPTADO'
    GENUS_SYNONYM = 'SINONIMO_DE_GENERO'
    HYBRID_FORMULA = 'FORMULA_HIBRIDA'
    INVALID_NAME = 'NOMBRE_NO_VALIDO'
    NO_GENUS = 'SIN_GENERO'
    DUPLICATE_SPECIES = 'NOMBRE_REPETIDO'
    DUPLICATE_GENUS = 'GENERO_REPETIDO'
    GENUS_WITHOUT_SPECIES = 'GENERO_SIN_ESPECIES'
    SYNONYM_OF_PROVISIONAL = 'SINONIMO_DE_PROVISIONAL'
    SYNONYM_OF_EXCLUDED = 'SINONIMO_DE_EXCLUIDO'
    SYNONYM_WITHOUT_TARGET = 'SINONIMO_SIN_DESTINO'
    SYNONYM_EQUALS_ACCEPTED = 'SINONIMO_IGUAL_AL_ACEPTADO'
    DUPLICATE_SYNONYM = 'SINONIMO_REPETIDO'
    # Ajustes: el registro sale, pero cambiado o con algo que revisar.
    NAME_NORMALIZED = 'NOMBRE_NORMALIZADO'
    SYNONYM_REASSIGNED = 'SINONIMO_REASIGNADO'
    GENUS_DIFFERS_FROM_NAME = 'GENERO_DISTINTO_DEL_NOMBRE'
    INCONSISTENT_HYBRID_SIGN = 'HIBRIDO_INCONSISTENTE'


REASONS: dict[Code, str] = {
    Code.UNRANKED: 'Identificador molecular sin rango (BOLD o UNITE), no es un nombre.',
    Code.MISAPPLIED: 'Nombre mal aplicado: se excluye siempre.',
    Code.PROVISIONAL: 'Taxón provisionalmente aceptado: se excluye.',
    Code.UNKNOWN_STATUS: 'Estado taxonómico desconocido.',
    Code.RANK_NOT_IMPORTED: 'Rango que no se importa.',
    Code.INFRASPECIFIC_ACCEPTED: (
        'Taxón aceptado por debajo de especie: no se importan subespecies, variedades ni formas.'
    ),
    Code.GENUS_SYNONYM: 'Sinónimo de rango género: el catálogo no guarda sinónimos de géneros.',
    Code.HYBRID_FORMULA: 'Fórmula híbrida «A × B»: no es un nombre de especie.',
    Code.INVALID_NAME: 'El nombre aceptado no es un binomio «Género epíteto».',
    Code.NO_GENUS: 'La especie no cuelga de un género aceptado de la familia.',
    Code.DUPLICATE_SPECIES: (
        'Nombre científico repetido sin distinguir mayúsculas: se conserva solo una especie.'
    ),
    Code.DUPLICATE_GENUS: 'Género repetido sin distinguir mayúsculas: se conserva solo uno.',
    Code.GENUS_WITHOUT_SPECIES: 'Género aceptado sin ninguna especie importada.',
    Code.SYNONYM_OF_PROVISIONAL: 'Sinónimo de un taxón provisionalmente aceptado.',
    Code.SYNONYM_OF_EXCLUDED: 'Sinónimo de una especie que no se importa.',
    Code.SYNONYM_WITHOUT_TARGET: 'El sinónimo no lleva a una especie aceptada.',
    Code.SYNONYM_EQUALS_ACCEPTED: 'Sinónimo igual al nombre aceptado de su propia especie.',
    Code.DUPLICATE_SYNONYM: 'Sinónimo repetido dentro de la misma especie: se conserva uno.',
    Code.NAME_NORMALIZED: (
        'Se limpiaron los espacios o el signo de híbrido del nombre o la autoría.'
    ),
    Code.SYNONYM_REASSIGNED: (
        'Sinónimo de un taxón infraespecífico aceptado: se asigna a la especie de ese taxón.'
    ),
    Code.GENUS_DIFFERS_FROM_NAME: (
        'El género del nombre no es el género padre en la clasificación: se usa el género padre.'
    ),
    Code.INCONSISTENT_HYBRID_SIGN: (
        'El signo × del nombre no coincide con el de su género: se importa como híbrido.'
    ),
}

ADJUSTMENTS = frozenset(
    {
        Code.NAME_NORMALIZED,
        Code.SYNONYM_REASSIGNED,
        Code.GENUS_DIFFERS_FROM_NAME,
        Code.INCONSISTENT_HYBRID_SIGN,
    }
)


@dataclass(frozen=True, slots=True)
class Genus:
    # Nombre del género; los nothogéneros llevan «× » delante («× Anacamptorchis»).
    name: str
    # Identificador de COL del género.
    source_ref: str
    is_hybrid: bool


@dataclass(frozen=True, slots=True)
class Synonym:
    # Nombre sin autoría; los de rango inferior conservan el marcador («… f. alba»).
    name: str
    authorship: str | None
    # Identificador de COL del sinónimo.
    source_ref: str
    status: SynonymStatus
    rank: str
    # Identificador de COL del taxón infraespecífico aceptado al que apuntaba el sinónimo,
    # si se reasignó a la especie; None si apuntaba directamente a la especie.
    via: str | None


@dataclass(frozen=True, slots=True)
class Species:
    # Nombre científico sin autoría.
    scientific_name: str
    authorship: str | None
    # Identificador de COL de la especie (será source_ref en la base).
    source_ref: str
    # Nombre del género padre en la clasificación y su identificador de COL.
    genus: str
    genus_ref: str
    type: SpeciesType
    synonyms: tuple[Synonym, ...]


@dataclass(frozen=True, slots=True)
class Issue:
    """Un registro descartado o ajustado, con su motivo."""

    source_ref: str
    name: str
    authorship: str | None
    rank: str
    status: str
    action: Action
    code: Code
    message: str

    def sort_key(self) -> tuple[str, str, str]:
        return (self.code.value, self.source_ref, self.message)


@dataclass(frozen=True, slots=True)
class Catalog:
    genera: tuple[Genus, ...]
    species: tuple[Species, ...]
    issues: tuple[Issue, ...]

    def summary(self) -> dict[str, Any]:
        synonyms = [s for sp in self.species for s in sp.synonyms]
        discarded = Counter(i.code.value for i in self.issues if i.action is Action.DISCARDED)
        adjusted = Counter(i.code.value for i in self.issues if i.action is Action.ADJUSTED)
        return {
            'genera': len(self.genera),
            'hybrid_genera': sum(g.is_hybrid for g in self.genera),
            'species': len(self.species),
            'hybrids': sum(sp.type == 'hybrid' for sp in self.species),
            'synonyms': len(synonyms),
            'ambiguous_synonyms': sum(s.status == 'ambiguous synonym' for s in synonyms),
            'reassigned_synonyms': sum(s.via is not None for s in synonyms),
            'discarded': dict(sorted(discarded.items())),
            'adjusted': dict(sorted(adjusted.items())),
        }

    def to_dict(self) -> dict[str, Any]:
        return {
            'genera': [asdict(g) for g in self.genera],
            'species': [asdict(sp) for sp in self.species],
            'issues': [asdict(i) for i in self.issues],
        }
