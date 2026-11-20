"""Filtrado y normalización de los registros de la familia al modelo intermedio.

Reglas (decisiones aprobadas en el issue #72):

- Géneros: los aceptados de la familia que tengan al menos una especie importada.
- Especies: las de rango especie con estado «accepted». Se excluyen las provisionalmente
  aceptadas, las fórmulas híbridas «A × B» y los nombres que no son un binomio. El género de
  cada especie es su género padre en la clasificación.
- Híbridos: tipo «hybrid» si el nombre lleva el signo «×» o si su género es un nothogénero.
- Sinónimos: los de estado «synonym» o «ambiguous synonym», de rango especie o inferior,
  que llegan a una especie importada, directamente o a través de un taxón infraespecífico
  aceptado (en ese caso se reasignan a su especie). Los mal aplicados se excluyen siempre.
- Se descarta lo que la base rechazaría: nombres científicos repetidos sin distinguir
  mayúsculas, sinónimos repetidos dentro de una especie y sinónimos iguales al nombre
  aceptado de su especie.

Todo se recorre en un orden fijo (por identificador o por nombre), así que el resultado es
el mismo en cada ejecución.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass

from .model import (
    ADJUSTMENTS,
    REASONS,
    Action,
    Catalog,
    Code,
    Genus,
    Issue,
    Species,
    SpeciesType,
    Synonym,
    SynonymStatus,
)
from .names import HYBRID_SIGN, clean_spaces, name_shape, normalize_name, strip_hybrid_sign
from .reader import SourceRecord

ACCEPTED = 'accepted'
PROVISIONAL = 'provisionally accepted'
SYNONYM_STATUSES: frozenset[str] = frozenset({'synonym', 'ambiguous synonym'})
MISAPPLIED = 'misapplied'
KNOWN_STATUSES = frozenset({ACCEPTED, PROVISIONAL, MISAPPLIED, *SYNONYM_STATUSES})

GENUS = 'genus'
SPECIES = 'species'
UNRANKED = 'unranked'
# Rangos por debajo de especie que aparecen en COL. «infraspecific name» y «other» son
# trinomios sin marcador de rango («Cattleya labiata autumnalis»).
INFRASPECIFIC_RANKS = frozenset(
    {
        'subspecies',
        'variety',
        'subvariety',
        'form',
        'subform',
        'lusus',
        'proles',
        'natio',
        'convariety',
        'infraspecific name',
        'other',
    }
)

# Límite de saltos al subir por la clasificación, para no entrar en un ciclo si el archivo
# trae uno por error.
MAX_DEPTH = 20


@dataclass(frozen=True, slots=True)
class _Clean:
    """Nombre y autoría normalizados de un registro."""

    name: str
    authorship: str | None
    changed: bool


def _clean(record: SourceRecord) -> _Clean:
    name = normalize_name(record.scientific_name)
    authorship = clean_spaces(record.authorship) or None
    changed = name != record.scientific_name or (authorship or '') != record.authorship
    return _Clean(name, authorship, changed)


class _Builder:
    def __init__(self, records: Iterable[SourceRecord]) -> None:
        self.records: dict[str, SourceRecord] = {}
        for record in records:
            if record.id in self.records:
                raise ValueError(f'Identificador repetido en la fuente: {record.id}.')
            self.records[record.id] = record
        self.ordered = [self.records[k] for k in sorted(self.records)]
        self.clean = {r.id: _clean(r) for r in self.ordered}
        self.issues: list[Issue] = []
        # Por qué se excluyó cada registro (para explicar los sinónimos que apuntan a él).
        self.excluded: dict[str, Code] = {}

    # Incidencias -------------------------------------------------------------------------

    def _issue(self, record: SourceRecord, code: Code, detail: str = '') -> None:
        clean = self.clean[record.id]
        message = REASONS[code] + (f' {detail}' if detail else '')
        action = Action.ADJUSTED if code in ADJUSTMENTS else Action.DISCARDED
        self.issues.append(
            Issue(
                source_ref=record.id,
                name=clean.name,
                authorship=clean.authorship,
                rank=record.rank,
                status=record.status,
                action=action,
                code=code,
                message=message,
            )
        )

    def _discard(self, record: SourceRecord, code: Code, detail: str = '') -> None:
        self.excluded[record.id] = code
        self._issue(record, code, detail)

    def _normalized_note(self, record: SourceRecord) -> None:
        if self.clean[record.id].changed:
            self._issue(
                record,
                Code.NAME_NORMALIZED,
                f'Original: «{record.scientific_name}» «{record.authorship}».',
            )

    # Clasificación -----------------------------------------------------------------------

    def _label(self, record_id: str) -> str:
        record = self.records.get(record_id)
        if record is None:
            return record_id
        return f'{record_id} ({self.clean[record_id].name}, {record.rank}, {record.status})'

    def _genus_of(self, record: SourceRecord) -> SourceRecord | None:
        """Primer antepasado de rango género, o None si no hay ninguno en la familia."""
        current = self.records.get(record.parent_id)
        for _ in range(MAX_DEPTH):
            if current is None or current.rank == GENUS:
                return current
            current = self.records.get(current.parent_id)
        return None

    def build(self) -> Catalog:
        genus_candidates: list[SourceRecord] = []
        species_candidates: list[SourceRecord] = []
        synonym_candidates: list[SourceRecord] = []
        for record in self.ordered:
            status, rank = record.status, record.rank
            if rank == UNRANKED:
                self._discard(record, Code.UNRANKED)
            elif status not in KNOWN_STATUSES:
                self._discard(record, Code.UNKNOWN_STATUS, f'Estado: «{status}».')
            elif status == MISAPPLIED:
                self._discard(record, Code.MISAPPLIED, f'Apunta a {self._label(record.parent_id)}.')
            elif status == PROVISIONAL:
                self._discard(record, Code.PROVISIONAL)
            elif rank == GENUS:
                if status == ACCEPTED:
                    genus_candidates.append(record)
                else:
                    self._discard(record, Code.GENUS_SYNONYM)
            elif rank == SPECIES or rank in INFRASPECIFIC_RANKS:
                if status in SYNONYM_STATUSES:
                    synonym_candidates.append(record)
                elif rank == SPECIES:
                    species_candidates.append(record)
                else:
                    self._discard(record, Code.INFRASPECIFIC_ACCEPTED)
            else:
                self._discard(record, Code.RANK_NOT_IMPORTED, f'Rango: «{rank}».')

        species = self._build_species(species_candidates)
        genera = self._build_genera(genus_candidates, species)
        final_species = self._attach_synonyms(synonym_candidates, species, genera)
        issues = tuple(sorted(self.issues, key=Issue.sort_key))
        ordered_genera = tuple(
            sorted(genera.values(), key=lambda g: (g.name.lower(), g.source_ref))
        )
        return Catalog(genera=ordered_genera, species=final_species, issues=issues)

    # Especies ----------------------------------------------------------------------------

    def _build_species(self, candidates: list[SourceRecord]) -> dict[str, _SpeciesDraft]:
        drafts: dict[str, _SpeciesDraft] = {}
        for record in candidates:
            clean = self.clean[record.id]
            shape = name_shape(clean.name)
            if shape.is_formula:
                self._discard(record, Code.HYBRID_FORMULA)
                continue
            if not shape.is_binomial:
                self._discard(record, Code.INVALID_NAME)
                continue
            genus = self._genus_of(record)
            if genus is None or genus.status != ACCEPTED:
                found = 'ninguno' if genus is None else self._label(genus.id)
                self._discard(record, Code.NO_GENUS, f'Género encontrado: {found}.')
                continue
            drafts[record.id] = _SpeciesDraft(record, clean, shape.genus, shape.is_hybrid, genus)

        # Nombres repetidos sin distinguir mayúsculas: se conserva el que tiene autoría y,
        # a igualdad, el de identificador menor.
        by_name: dict[str, list[_SpeciesDraft]] = defaultdict(list)
        for draft in drafts.values():
            by_name[draft.clean.name.lower()].append(draft)
        for group in by_name.values():
            if len(group) < 2:
                continue
            group.sort(key=lambda d: (d.clean.authorship is None, d.record.id))
            kept = group[0]
            for duplicate in group[1:]:
                del drafts[duplicate.record.id]
                self._discard(
                    duplicate.record,
                    Code.DUPLICATE_SPECIES,
                    f'Se conserva {self._label(kept.record.id)}.',
                )
        return drafts

    # Géneros -----------------------------------------------------------------------------

    def _build_genera(
        self, candidates: list[SourceRecord], species: dict[str, _SpeciesDraft]
    ) -> dict[str, Genus]:
        """Géneros con especies, por identificador de COL del género conservado."""
        used = {draft.genus.id for draft in species.values()}
        genera: dict[str, Genus] = {}
        by_name: dict[str, SourceRecord] = {}
        for record in candidates:
            clean = self.clean[record.id]
            key = clean.name.lower()
            if key in by_name:
                kept = by_name[key]
                self._discard(record, Code.DUPLICATE_GENUS, f'Se conserva {self._label(kept.id)}.')
                # Las especies del repetido pasan al conservado.
                for draft in species.values():
                    if draft.genus.id == record.id:
                        draft.genus = kept
                        used.add(kept.id)
                continue
            by_name[key] = record
        for key in sorted(by_name):
            record = by_name[key]
            if record.id not in used:
                self._discard(record, Code.GENUS_WITHOUT_SPECIES)
                continue
            name = self.clean[record.id].name
            self._normalized_note(record)
            genera[record.id] = Genus(
                name=name, source_ref=record.id, is_hybrid=name.startswith(HYBRID_SIGN)
            )
        return genera

    # Sinónimos ---------------------------------------------------------------------------

    def _target_of(self, record: SourceRecord) -> tuple[SourceRecord | None, str | None]:
        """Taxón al que lleva un sinónimo y, si pasó por uno, el infraespecífico aceptado."""
        via: str | None = None
        current = self.records.get(record.parent_id)
        for _ in range(MAX_DEPTH):
            if current is None or not (
                current.rank in INFRASPECIFIC_RANKS and current.status == ACCEPTED
            ):
                break
            via = via or current.id
            current = self.records.get(current.parent_id)
        return current, via

    def _attach_synonyms(
        self,
        candidates: list[SourceRecord],
        drafts: dict[str, _SpeciesDraft],
        genera: dict[str, Genus],
    ) -> tuple[Species, ...]:
        attached: dict[str, list[tuple[SourceRecord, str | None]]] = defaultdict(list)
        for record in candidates:
            clean = self.clean[record.id]
            if name_shape(clean.name).is_formula:
                self._discard(record, Code.HYBRID_FORMULA)
                continue
            target, via = self._target_of(record)
            if target is None:
                self._discard(
                    record,
                    Code.SYNONYM_WITHOUT_TARGET,
                    f'Su padre {record.parent_id} no está en la familia.',
                )
            elif target.status == PROVISIONAL:
                self._discard(
                    record, Code.SYNONYM_OF_PROVISIONAL, f'Apunta a {self._label(target.id)}.'
                )
            elif target.rank != SPECIES or target.status != ACCEPTED:
                self._discard(
                    record, Code.SYNONYM_WITHOUT_TARGET, f'Apunta a {self._label(target.id)}.'
                )
            elif target.id not in drafts:
                reason = self.excluded.get(target.id)
                detail = f'Apunta a {self._label(target.id)}'
                detail += f', descartada por {reason.value}.' if reason else '.'
                self._discard(record, Code.SYNONYM_OF_EXCLUDED, detail)
            else:
                attached[target.id].append((record, via))

        result: list[Species] = []
        for draft in drafts.values():
            record, clean = draft.record, draft.clean
            accepted_key = clean.name.lower()
            # Primero los sinónimos directos y no ambiguos; a igualdad, por identificador.
            pending = sorted(
                attached.get(record.id, []),
                key=lambda item: (item[1] is not None, item[0].status != 'synonym', item[0].id),
            )
            synonyms: dict[str, Synonym] = {}
            for synonym_record, via in pending:
                synonym_clean = self.clean[synonym_record.id]
                key = synonym_clean.name.lower()
                if key == accepted_key:
                    self._discard(
                        synonym_record,
                        Code.SYNONYM_EQUALS_ACCEPTED,
                        f'Especie: {self._label(record.id)}.',
                    )
                    continue
                if key in synonyms:
                    self._discard(
                        synonym_record,
                        Code.DUPLICATE_SYNONYM,
                        f'Se conserva {self._label(synonyms[key].source_ref)}.',
                    )
                    continue
                status: SynonymStatus = (
                    'ambiguous synonym'
                    if synonym_record.status == 'ambiguous synonym'
                    else 'synonym'
                )
                synonyms[key] = Synonym(
                    name=synonym_clean.name,
                    authorship=synonym_clean.authorship,
                    source_ref=synonym_record.id,
                    status=status,
                    rank=synonym_record.rank,
                    via=via,
                )
                self._normalized_note(synonym_record)
                if via is not None:
                    self._issue(
                        synonym_record,
                        Code.SYNONYM_REASSIGNED,
                        f'Apuntaba a {self._label(via)}; pasa a {self._label(record.id)}.',
                    )

            genus = genera[draft.genus.id]
            name_genus_sign = clean.name.startswith(HYBRID_SIGN)
            if name_genus_sign != genus.is_hybrid:
                self._issue(record, Code.INCONSISTENT_HYBRID_SIGN, f'Género: «{genus.name}».')
            if draft.name_genus.lower() != strip_hybrid_sign(genus.name).lower():
                self._issue(
                    record,
                    Code.GENUS_DIFFERS_FROM_NAME,
                    f'Género del nombre: «{draft.name_genus}»; género padre: «{genus.name}».',
                )
            self._normalized_note(record)
            species_type: SpeciesType = (
                'hybrid' if draft.name_is_hybrid or genus.is_hybrid else 'species'
            )
            result.append(
                Species(
                    scientific_name=clean.name,
                    authorship=clean.authorship,
                    source_ref=record.id,
                    genus=genus.name,
                    genus_ref=genus.source_ref,
                    type=species_type,
                    synonyms=tuple(
                        sorted(synonyms.values(), key=lambda s: (s.name.lower(), s.source_ref))
                    ),
                )
            )
        result.sort(key=lambda sp: (sp.scientific_name.lower(), sp.source_ref))
        return tuple(result)


@dataclass(slots=True)
class _SpeciesDraft:
    record: SourceRecord
    clean: _Clean
    # Género escrito en el nombre (sin «×») y si el nombre lleva «×».
    name_genus: str
    name_is_hybrid: bool
    # Registro del género padre en la clasificación.
    genus: SourceRecord


def build_catalog(records: Iterable[SourceRecord]) -> Catalog:
    """Construye el catálogo normalizado a partir de los registros de la familia."""
    return _Builder(records).build()
