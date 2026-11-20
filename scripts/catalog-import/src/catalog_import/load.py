"""Carga del catálogo normalizado en Postgres: repetible, en una transacción y sin borrar nada.

Pasos, todos dentro de una única transacción (o entra todo o nada):

1. Bloquea ``genera``, ``species`` y ``species_names`` en modo ``share row exclusive``: se
   pueden leer, pero nadie más escribe en ellas hasta que la carga termina. Así lo que se lee
   en el paso 2 sigue siendo cierto al escribir en el 4.
2. Lee lo que ya hay en la base: géneros (con sus abreviaturas), especies, nombres
   alternativos y cuántas plantas tiene cada especie.
3. Planifica en memoria, registro a registro, qué hacer con cada género, especie y sinónimo de
   la fuente (:func:`plan_load`). Es una función pura: no toca la base.
4. Aplica el plan por conjuntos: copia (``COPY``) las altas y los cambios a tablas temporales y
   los escribe con una sentencia por tabla. Comprueba que cada sentencia afectó exactamente a
   las filas previstas; si no, falla y no queda nada escrito.
5. Mide el tamaño de la base y de las tablas del catálogo y cuenta lo que hay.
6. Confirma la transacción o, en modo de prueba (el modo por defecto), la revierte. En los dos
   casos el reporte es el mismo, porque todo el trabajo se hizo de verdad dentro de ella.

Reglas de casamiento y de conflicto: ver el README de la carpeta ("Reglas de la carga").
"""

from __future__ import annotations

import time
from collections import Counter, defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

import psycopg

from .model import Catalog, Code, Species
from .names import HYBRID_SIGN

# Entidades y resultados del reporte.
GENUS = 'genero'
SPECIES = 'especie'
SYNONYM = 'sinonimo'
RUN = 'carga'

NEW = 'nuevo'
UPDATED = 'actualizado'
UNCHANGED = 'sin_cambios'
CONFLICT = 'conflicto'
REJECTED = 'rechazado'
NOT_IN_SOURCE = 'no_en_fuente'
INFO = 'info'

# Estado de una especie recién importada. Cualquier otro (validada, observada) es trabajo de
# un administrador y la carga no lo pisa.
IMPORTED = 'imported'
SOURCE = 'col'

CATALOG_TABLES = ('genera', 'genus_abbreviations', 'species', 'species_names')


@dataclass(frozen=True, slots=True)
class ReportRow:
    entity: str
    result: str
    code: str
    source_ref: str = ''
    name: str = ''
    # Especie a la que pertenece un sinónimo: «Nombre (clave)».
    species: str = ''
    detail: str = ''
    db_id: str = ''


# Lo que hay en la base -------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class DbGenus:
    id: str
    name: str
    is_quick_access: bool
    abbreviations: tuple[str, ...]
    species_count: int


@dataclass(frozen=True, slots=True)
class DbSpecies:
    id: str
    scientific_name: str
    genus_id: str
    type: str
    status: str
    source: str
    source_ref: str | None


@dataclass(slots=True)
class DbSnapshot:
    genera: list[DbGenus]
    species: list[DbSpecies]
    # Nombres alternativos por especie: nombre en minúsculas -> (nombre, tipo).
    names: dict[str, dict[str, tuple[str, str]]]
    # Plantas enlazadas por especie.
    plants: dict[str, int]


def genus_key(name: str) -> str:
    """Clave para casar géneros: sin el signo «×», sin mayúsculas y con los espacios limpios."""
    return ' '.join(name.replace(HYBRID_SIGN, ' ').split()).lower()


# Plan --------------------------------------------------------------------------------------


# Destino de un género: ('id', uuid) si ya existe, ('nuevo', nombre) si se crea en la carga.
GenusRef = tuple[str, str]


@dataclass(frozen=True, slots=True)
class SpeciesWrite:
    """Alta o cambio de una especie. ``genus`` es el destino resuelto del género."""

    source_ref: str
    scientific_name: str
    genus: GenusRef
    type: str
    # Id de la especie que se actualiza; None si es un alta.
    db_id: str | None = None


@dataclass(slots=True)
class Plan:
    rows: list[ReportRow] = field(default_factory=list)
    counts: Counter[tuple[str, str]] = field(default_factory=Counter)
    genus_inserts: list[str] = field(default_factory=list)
    genus_renames: list[tuple[str, str]] = field(default_factory=list)
    species_inserts: list[SpeciesWrite] = field(default_factory=list)
    species_updates: list[SpeciesWrite] = field(default_factory=list)
    # (destino de la especie, nombre): ('id', uuid) o ('ref', clave de una especie nueva).
    synonym_inserts: list[tuple[tuple[str, str], str]] = field(default_factory=list)
    # Sinónimos de especies de COL que están en la base y la fuente ya no trae.
    synonyms_not_in_source: int = 0

    def add(self, row: ReportRow) -> None:
        self.counts[(row.entity, row.result)] += 1
        self.rows.append(row)


def _species_label(name: str, ref: str) -> str:
    return f'{name} ({ref})'


def _plan_genera(catalog: Catalog, snapshot: DbSnapshot, plan: Plan) -> dict[str, GenusRef | None]:
    """Decide qué hacer con cada género de la fuente. Devuelve su destino por clave de COL."""
    by_key: dict[str, list[DbGenus]] = defaultdict(list)
    for genus in snapshot.genera:
        by_key[genus_key(genus.name)].append(genus)

    # Los géneros con especies, y además los nothogéneros aceptados que la normalización
    # descartó por no tener especies importadas: no se crean, pero si ya existen en la base
    # sin el signo, se les pone, porque la fuente dice cómo se escribe su nombre.
    source: list[tuple[str, str, bool]] = [(g.name, g.source_ref, True) for g in catalog.genera]
    source += [
        (i.name, i.source_ref, False)
        for i in catalog.issues
        if i.code is Code.GENUS_WITHOUT_SPECIES and i.name.startswith(HYBRID_SIGN)
    ]
    source_keys = Counter(genus_key(name) for name, _, _ in source)
    matched: set[str] = set()
    targets: dict[str, GenusRef | None] = {}

    for name, ref, has_species in source:
        key = genus_key(name)
        candidates = by_key.get(key, [])
        exact = [g for g in candidates if g.name.lower() == name.lower()]
        note = '' if has_species else ' Nothogénero de la fuente sin especies importadas.'
        if exact:
            genus = exact[0]
            matched.add(genus.id)
            targets[ref] = ('id', genus.id)
            if genus.name == name:
                plan.add(
                    ReportRow(GENUS, UNCHANGED, 'GENERO_SIN_CAMBIOS', ref, name, '', '', genus.id)
                )
            else:
                plan.add(
                    ReportRow(
                        GENUS,
                        CONFLICT,
                        'GENERO_MAYUSCULAS_DISTINTAS',
                        ref,
                        name,
                        detail=(
                            f'En la base está como «{genus.name}». Se usa ese género y no se '
                            'cambia: revísalo a mano.' + note
                        ),
                        db_id=genus.id,
                    )
                )
        elif len(candidates) == 1 and source_keys[key] == 1:
            # Solo difiere en el signo «×» (y quizá en mayúsculas): se renombra como lo
            # escribe la fuente, conservando el id, sus abreviaturas y el acceso rápido.
            genus = candidates[0]
            matched.add(genus.id)
            targets[ref] = ('id', genus.id)
            plan.genus_renames.append((genus.id, name))
            sign = 'se le pone' if name.startswith(HYBRID_SIGN) else 'se le quita'
            abbreviations = ', '.join(genus.abbreviations) or 'ninguna'
            plan.add(
                ReportRow(
                    GENUS,
                    UPDATED,
                    'GENERO_RENOMBRADO',
                    ref,
                    name,
                    detail=(
                        f'nombre: «{genus.name}» → «{name}» ({sign} el signo ×, como lo escribe '
                        f'la fuente). Conserva su id, sus abreviaturas ({abbreviations}), su '
                        f'acceso rápido ({"sí" if genus.is_quick_access else "no"}) y sus '
                        f'{genus.species_count} especies.' + note
                    ),
                    db_id=genus.id,
                )
            )
        elif candidates:
            matched.update(g.id for g in candidates)
            targets[ref] = None
            existing = ', '.join(f'«{g.name}»' for g in candidates)
            reason = (
                f'La fuente trae varios géneros que solo se distinguen por el signo ×; en la base '
                f'están {existing}.'
                if source_keys[key] > 1
                else f'En la base hay varios géneros que solo se distinguen por el signo ×: '
                f'{existing}.'
            )
            plan.add(
                ReportRow(
                    GENUS,
                    CONFLICT,
                    'GENERO_AMBIGUO',
                    ref,
                    name,
                    detail=reason + ' No se toca ninguno y sus especies no se cargan.' + note,
                )
            )
        elif has_species:
            targets[ref] = ('nuevo', name)
            plan.genus_inserts.append(name)
            plan.add(ReportRow(GENUS, NEW, 'GENERO_NUEVO', ref, name))
        # Un nothogénero sin especies que no está en la base no se crea (ya figura en los
        # descartes de la normalización).

    for genus in snapshot.genera:
        if genus.id not in matched:
            abbreviations = ', '.join(genus.abbreviations) or 'ninguna'
            plan.add(
                ReportRow(
                    GENUS,
                    NOT_IN_SOURCE,
                    'GENERO_NO_EN_FUENTE',
                    name=genus.name,
                    detail=(
                        f'La fuente no trae este género como aceptado. Se conserva tal cual: '
                        f'{genus.species_count} especies, abreviaturas: {abbreviations}, acceso '
                        f'rápido: {"sí" if genus.is_quick_access else "no"}.'
                    ),
                    db_id=genus.id,
                )
            )
    return targets


def plan_load(catalog: Catalog, snapshot: DbSnapshot) -> Plan:
    """Planifica la carga sin tocar la base. Ver las reglas en el README."""
    plan = Plan()
    genus_targets = _plan_genera(catalog, snapshot, plan)
    genus_names = {g.id: g.name for g in snapshot.genera}
    renamed = dict(plan.genus_renames)

    by_ref = {s.source_ref: s for s in snapshot.species if s.source == SOURCE and s.source_ref}
    by_name = {s.scientific_name.lower(): s for s in snapshot.species}
    by_id = {s.id: s for s in snapshot.species}
    source_refs = {sp.source_ref for sp in catalog.species}
    consumed: set[str] = set()

    def genus_label(target: GenusRef) -> str:
        kind, value = target
        if kind == 'nuevo':
            return value
        return renamed.get(value, genus_names.get(value, value))

    for sp in catalog.species:
        label = _species_label(sp.scientific_name, sp.source_ref)
        genus_target = genus_targets.get(sp.genus_ref)
        synonym_target: tuple[str, str] | None = None

        if genus_target is None:
            plan.add(
                ReportRow(
                    SPECIES,
                    REJECTED,
                    'GENERO_EN_CONFLICTO',
                    sp.source_ref,
                    sp.scientific_name,
                    detail=f'Su género, «{sp.genus}», está en conflicto (ver GENERO_AMBIGUO).',
                )
            )
        else:
            existing = by_ref.get(sp.source_ref)
            key_change = False
            if existing is None:
                same_name = by_name.get(sp.scientific_name.lower())
                if same_name is None:
                    plan.species_inserts.append(
                        SpeciesWrite(sp.source_ref, sp.scientific_name, genus_target, sp.type)
                    )
                    plan.add(
                        ReportRow(
                            SPECIES,
                            NEW,
                            'ESPECIE_NUEVA',
                            sp.source_ref,
                            sp.scientific_name,
                            detail=f'género: «{genus_label(genus_target)}»; tipo: {sp.type}',
                        )
                    )
                    synonym_target = ('ref', sp.source_ref)
                elif same_name.source != SOURCE:
                    plan.add(
                        ReportRow(
                            SPECIES,
                            CONFLICT,
                            'NOMBRE_DE_OTRA_FUENTE',
                            sp.source_ref,
                            sp.scientific_name,
                            detail=(
                                f'El nombre ya está en la base con fuente {same_name.source} y '
                                f'estado {same_name.status}. No se toca y sus sinónimos no se '
                                'cargan.'
                            ),
                            db_id=same_name.id,
                        )
                    )
                elif same_name.source_ref in source_refs:
                    plan.add(
                        ReportRow(
                            SPECIES,
                            CONFLICT,
                            'CLAVE_DISTINTA',
                            sp.source_ref,
                            sp.scientific_name,
                            detail=(
                                'El nombre ya está en la base con la clave '
                                f'{same_name.source_ref}, que la fuente sigue trayendo para otro '
                                'registro. No se toca y sus sinónimos no se cargan.'
                            ),
                            db_id=same_name.id,
                        )
                    )
                elif same_name.status != IMPORTED:
                    plan.add(
                        ReportRow(
                            SPECIES,
                            CONFLICT,
                            'ESPECIE_PROTEGIDA',
                            sp.source_ref,
                            sp.scientific_name,
                            detail=(
                                f'clave: {same_name.source_ref} → {sp.source_ref}. La especie '
                                f'está {same_name.status}: no se cambia ni se le cargan '
                                'sinónimos.'
                            ),
                            db_id=same_name.id,
                        )
                    )
                    consumed.add(same_name.id)
                else:
                    # Misma fuente y mismo nombre con otra clave que la fuente ya no trae: COL
                    # cambió la clave (FUENTE.md, sección 6). Se actualiza la clave.
                    existing = same_name
                    key_change = True

            if existing is not None:
                consumed.add(existing.id)
                changes: list[str] = []
                if key_change:
                    changes.append(f'clave: {existing.source_ref} → {sp.source_ref}')
                if existing.scientific_name != sp.scientific_name:
                    changes.append(f'nombre: «{existing.scientific_name}» → «{sp.scientific_name}»')
                if genus_target != ('id', existing.genus_id):
                    old_genus = genus_names.get(existing.genus_id, existing.genus_id)
                    changes.append(f'género: «{old_genus}» → «{genus_label(genus_target)}»')
                if existing.type != sp.type:
                    changes.append(f'tipo: {existing.type} → {sp.type}')

                if not changes:
                    plan.add(
                        ReportRow(
                            SPECIES,
                            UNCHANGED,
                            'ESPECIE_SIN_CAMBIOS',
                            sp.source_ref,
                            sp.scientific_name,
                            db_id=existing.id,
                        )
                    )
                    synonym_target = ('id', existing.id)
                elif existing.status != IMPORTED:
                    plan.add(
                        ReportRow(
                            SPECIES,
                            CONFLICT,
                            'ESPECIE_PROTEGIDA',
                            sp.source_ref,
                            sp.scientific_name,
                            detail=(
                                f'La especie está {existing.status}: no se cambia. La fuente '
                                f'trae: {"; ".join(changes)}.'
                            ),
                            db_id=existing.id,
                        )
                    )
                    synonym_target = ('id', existing.id)
                elif (
                    existing.scientific_name.lower() != sp.scientific_name.lower()
                    and sp.scientific_name.lower() in by_name
                ):
                    other = by_name[sp.scientific_name.lower()]
                    plan.add(
                        ReportRow(
                            SPECIES,
                            CONFLICT,
                            'NOMBRE_OCUPADO',
                            sp.source_ref,
                            sp.scientific_name,
                            detail=(
                                f'La fuente cambia el nombre de «{existing.scientific_name}», '
                                f'pero el nuevo ya lo usa otra especie de la base (fuente '
                                f'{other.source}, clave {other.source_ref or "ninguna"}). No se '
                                'cambia.'
                            ),
                            db_id=existing.id,
                        )
                    )
                    synonym_target = ('id', existing.id)
                else:
                    # El disparador propagate_species_to_plants lleva un cambio de género o de
                    # tipo a las plantas enlazadas: se anota cuántas son.
                    propagates = any(c.startswith(('género', 'tipo')) for c in changes)
                    plants = snapshot.plants.get(existing.id, 0) if propagates else 0
                    if plants:
                        changes.append(f'se propaga a {plants} plantas de usuarios')
                    plan.species_updates.append(
                        SpeciesWrite(
                            sp.source_ref, sp.scientific_name, genus_target, sp.type, existing.id
                        )
                    )
                    plan.add(
                        ReportRow(
                            SPECIES,
                            UPDATED,
                            'CLAVE_ACTUALIZADA' if key_change else 'ESPECIE_ACTUALIZADA',
                            sp.source_ref,
                            sp.scientific_name,
                            detail='; '.join(changes),
                            db_id=existing.id,
                        )
                    )
                    synonym_target = ('id', existing.id)

        current = by_id.get(synonym_target[1]) if synonym_target else None
        _plan_synonyms(
            sp,
            synonym_target,
            current.scientific_name if current else '',
            snapshot.names.get(current.id, {}) if current else {},
            plan,
            label,
        )

    for existing in snapshot.species:
        if (
            existing.source == SOURCE
            and existing.id not in consumed
            and existing.source_ref not in source_refs
        ):
            plan.add(
                ReportRow(
                    SPECIES,
                    NOT_IN_SOURCE,
                    'ESPECIE_NO_EN_FUENTE',
                    existing.source_ref or '',
                    existing.scientific_name,
                    detail=f'Importada de COL, la fuente ya no la trae. Se conserva (estado '
                    f'{existing.status}).',
                    db_id=existing.id,
                )
            )
    return plan


def _plan_synonyms(
    sp: Species,
    target: tuple[str, str] | None,
    current_name: str,
    existing_names: dict[str, tuple[str, str]],
    plan: Plan,
    label: str,
) -> None:
    """Sinónimos de una especie: se añaden los que faltan; nunca se cambia ni se borra uno.

    ``current_name`` y ``existing_names`` son el nombre científico y los nombres alternativos
    que la especie tiene ya en la base (vacíos si es nueva).
    """
    if target is None:
        for synonym in sp.synonyms:
            plan.add(
                ReportRow(
                    SYNONYM,
                    REJECTED,
                    'SINONIMO_SIN_ESPECIE',
                    synonym.source_ref,
                    synonym.name,
                    label,
                    'Su especie no se cargó (ver la fila de la especie).',
                )
            )
        return

    source_names: set[str] = set()
    for synonym in sp.synonyms:
        lowered = synonym.name.lower()
        source_names.add(lowered)
        found = existing_names.get(lowered)
        if lowered == current_name.lower():
            plan.add(
                ReportRow(
                    SYNONYM,
                    CONFLICT,
                    'SINONIMO_IGUAL_AL_NOMBRE',
                    synonym.source_ref,
                    synonym.name,
                    label,
                    'Coincide con el nombre científico que tiene la especie en la base. '
                    'No se carga.',
                )
            )
        elif found is None:
            plan.synonym_inserts.append((target, synonym.name))
            plan.add(
                ReportRow(
                    SYNONYM,
                    NEW,
                    'SINONIMO_NUEVO',
                    synonym.source_ref,
                    synonym.name,
                    label,
                    'ambiguo' if synonym.status == 'ambiguous synonym' else '',
                )
            )
        elif found[1] == 'common':
            plan.add(
                ReportRow(
                    SYNONYM,
                    CONFLICT,
                    'SINONIMO_ES_NOMBRE_COMUN',
                    synonym.source_ref,
                    synonym.name,
                    label,
                    f'La especie ya tiene «{found[0]}» como nombre común. No se cambia.',
                )
            )
        else:
            plan.add(
                ReportRow(
                    SYNONYM,
                    UNCHANGED,
                    'SINONIMO_SIN_CAMBIOS',
                    synonym.source_ref,
                    synonym.name,
                    label,
                )
            )
    plan.synonyms_not_in_source += sum(
        1
        for lowered, (_, name_type) in existing_names.items()
        if name_type == 'synonym' and lowered not in source_names
    )


# Base de datos ------------------------------------------------------------------------------


class LoadError(Exception):
    """La carga no se pudo completar. No se ha escrito nada."""


def check_schema(conn: psycopg.Connection[Any]) -> None:
    """Comprueba que la base tiene las migraciones que la carga necesita."""
    row = conn.execute(
        "select to_regtype('public.species_source') is not null, "
        "exists (select from pg_enum e where e.enumtypid = to_regtype('public.species_source') "
        "and e.enumlabel = 'col')"
    ).fetchone()
    if row is None or not row[0]:
        raise LoadError('La base no tiene el esquema del catálogo de Orki (falta species_source).')
    if not row[1]:
        raise LoadError(
            "La fuente 'col' no existe en species_source: faltan las migraciones "
            '20261120220000 y 20261120220100. Aplícalas antes de cargar.'
        )


def read_snapshot(conn: psycopg.Connection[Any]) -> DbSnapshot:
    genera = [
        DbGenus(str(r[0]), r[1], r[2], tuple(r[3]), r[4])
        for r in conn.execute(
            """
            select g.id, g.name, g.is_quick_access,
                   coalesce((select array_agg(a.abbreviation order by a.abbreviation)
                             from public.genus_abbreviations a where a.genus_id = g.id),
                            '{}'),
                   (select count(*) from public.species s where s.genus_id = g.id)
            from public.genera g
            order by g.name, g.id
            """
        )
    ]
    species = [
        DbSpecies(str(r[0]), r[1], str(r[2]), r[3], r[4], r[5], r[6])
        for r in conn.execute(
            """
            select id, scientific_name, genus_id, type::text, status::text, source::text,
                   source_ref
            from public.species
            order by scientific_name, id
            """
        )
    ]
    names: dict[str, dict[str, tuple[str, str]]] = defaultdict(dict)
    for species_id, name, name_type in conn.execute(
        'select species_id, name, type::text from public.species_names'
    ):
        names[str(species_id)][name.lower()] = (name, name_type)
    plants = {
        str(species_id): count
        for species_id, count in conn.execute(
            'select species_id, count(*) from public.plants '
            'where species_id is not null group by species_id'
        )
    }
    return DbSnapshot(genera, species, dict(names), plants)


def _copy(
    cur: psycopg.Cursor[Any], table: str, columns: Sequence[str], rows: Iterable[Sequence[Any]]
) -> None:
    with cur.copy(f'copy {table} ({", ".join(columns)}) from stdin') as copy:
        for row in rows:
            copy.write_row(row)


def _expect(what: str, expected: int, got: int) -> None:
    if expected != got:
        raise LoadError(
            f'{what}: se esperaban {expected} filas y la base afectó a {got}. Se revierte todo.'
        )


@dataclass(slots=True)
class Applied:
    genera_renamed: int = 0
    genera_inserted: int = 0
    species_inserted: int = 0
    species_updated: int = 0
    synonyms_inserted: int = 0


def apply_plan(conn: psycopg.Connection[Any], plan: Plan) -> Applied:
    """Escribe el plan por conjuntos. Las tablas temporales desaparecen al acabar la transacción."""
    applied = Applied()
    with conn.cursor() as cur:
        # Géneros: primero los renombrados (solo el signo ×), después los nuevos.
        cur.execute(
            'create temp table carga_genero_renombre (id uuid primary key, name text not null) '
            'on commit drop'
        )
        _copy(cur, 'carga_genero_renombre', ('id', 'name'), plan.genus_renames)
        cur.execute(
            'update public.genera g set name = r.name from carga_genero_renombre r '
            'where g.id = r.id and g.name is distinct from r.name'
        )
        applied.genera_renamed = cur.rowcount
        _expect('Géneros renombrados', len(plan.genus_renames), cur.rowcount)

        cur.execute('create temp table carga_genero_nuevo (name text primary key) on commit drop')
        _copy(cur, 'carga_genero_nuevo', ('name',), ((n,) for n in plan.genus_inserts))
        cur.execute(
            'insert into public.genera (name) select name from carga_genero_nuevo order by name '
            'returning id, name'
        )
        new_genera = {name: str(genus_id) for genus_id, name in cur.fetchall()}
        applied.genera_inserted = len(new_genera)
        _expect('Géneros nuevos', len(plan.genus_inserts), len(new_genera))

        def genus_id(target: GenusRef) -> str:
            kind, value = target
            return new_genera[value] if kind == 'nuevo' else value

        # Especies nuevas.
        cur.execute(
            'create temp table carga_especie_nueva (source_ref text primary key, '
            'scientific_name text not null, genus_id uuid not null, '
            'type public.species_type not null) on commit drop'
        )
        _copy(
            cur,
            'carga_especie_nueva',
            ('source_ref', 'scientific_name', 'genus_id', 'type'),
            (
                (s.source_ref, s.scientific_name, genus_id(s.genus), s.type)
                for s in plan.species_inserts
            ),
        )
        cur.execute(
            f'insert into public.species (scientific_name, genus_id, type, status, source, '
            f'source_ref) '
            f"select scientific_name, genus_id, type, '{IMPORTED}', '{SOURCE}', source_ref "
            f'from carga_especie_nueva order by scientific_name returning id, source_ref'
        )
        new_species = {ref: str(species_id) for species_id, ref in cur.fetchall()}
        applied.species_inserted = len(new_species)
        _expect('Especies nuevas', len(plan.species_inserts), len(new_species))

        # Cambios en especies importadas. La condición de estado repite la del plan: una
        # especie que no está «importada» nunca se toca. Solo se escriben las filas que
        # cambian, para no mover updated_at.
        cur.execute(
            'create temp table carga_especie_cambio (id uuid primary key, '
            'scientific_name text not null, genus_id uuid not null, '
            'type public.species_type not null, source_ref text not null) on commit drop'
        )
        _copy(
            cur,
            'carga_especie_cambio',
            ('id', 'scientific_name', 'genus_id', 'type', 'source_ref'),
            (
                (s.db_id, s.scientific_name, genus_id(s.genus), s.type, s.source_ref)
                for s in plan.species_updates
            ),
        )
        cur.execute(
            f"""
            update public.species s
               set scientific_name = c.scientific_name, genus_id = c.genus_id, type = c.type,
                   source_ref = c.source_ref
              from carga_especie_cambio c
             where s.id = c.id and s.source = '{SOURCE}' and s.status = '{IMPORTED}'
               and (s.scientific_name, s.genus_id, s.type, s.source_ref)
                   is distinct from (c.scientific_name, c.genus_id, c.type, c.source_ref)
            """
        )
        applied.species_updated = cur.rowcount
        _expect('Especies actualizadas', len(plan.species_updates), cur.rowcount)

        # Sinónimos nuevos.
        cur.execute(
            'create temp table carga_sinonimo (species_id uuid not null, name text not null) '
            'on commit drop'
        )

        def species_id(target: tuple[str, str]) -> str:
            kind, value = target
            return new_species[value] if kind == 'ref' else value

        _copy(
            cur,
            'carga_sinonimo',
            ('species_id', 'name'),
            ((species_id(target), name) for target, name in plan.synonym_inserts),
        )
        cur.execute(
            'insert into public.species_names (species_id, name, type) '
            "select species_id, name, 'synonym' from carga_sinonimo order by species_id, name"
        )
        applied.synonyms_inserted = cur.rowcount
        _expect('Sinónimos nuevos', len(plan.synonym_inserts), cur.rowcount)
    return applied


@dataclass(slots=True)
class Measures:
    database_bytes: int
    table_bytes: dict[str, int]
    genera: int
    species: int
    species_col: int
    synonyms: int
    common_names: int


def measure(conn: psycopg.Connection[Any]) -> Measures:
    rows = conn.execute(
        'select t, pg_total_relation_size(format(%s, t)::regclass) from unnest(%s::text[]) as t',
        ('public.%I', list(CATALOG_TABLES)),
    )
    sizes: dict[str, int] = dict(rows.fetchall())
    row = conn.execute(
        f"""
        select pg_database_size(current_database()),
               (select count(*) from public.genera),
               (select count(*) from public.species),
               (select count(*) from public.species where source = '{SOURCE}'),
               (select count(*) from public.species_names where type = 'synonym'),
               (select count(*) from public.species_names where type = 'common')
        """
    ).fetchone()
    assert row is not None
    return Measures(row[0], sizes, row[1], row[2], row[3], row[4], row[5])


@dataclass(slots=True)
class LoadResult:
    plan: Plan
    applied: Applied
    measures: Measures
    written: bool
    timings: dict[str, float]


def run_load(conn: psycopg.Connection[Any], catalog: Catalog, *, write: bool) -> LoadResult:
    """Carga el catálogo en una transacción. Sin ``write``, la revierte al terminar.

    ``conn`` debe estar sin transacción abierta y sin autocommit. Si algo falla, la
    transacción se revierte y la excepción sigue su camino: no queda nada escrito.
    """
    if conn.autocommit:
        raise LoadError('La conexión no debe estar en autocommit: la carga es una transacción.')
    timings: dict[str, float] = {}
    started = time.perf_counter()
    try:
        # Si una espera o una sentencia se alarga más de la cuenta, se aborta todo.
        conn.execute("set local lock_timeout = '15s'")
        conn.execute("set local statement_timeout = '15min'")
        conn.execute(
            'lock table public.genera, public.species, public.species_names '
            'in share row exclusive mode'
        )
        check_schema(conn)
        snapshot = read_snapshot(conn)
        timings['lectura_base'] = time.perf_counter() - started

        mark = time.perf_counter()
        plan = plan_load(catalog, snapshot)
        timings['plan'] = time.perf_counter() - mark

        mark = time.perf_counter()
        applied = apply_plan(conn, plan)
        if write:
            # Estadísticas al día para la búsqueda. Dentro de la transacción: si se revierte,
            # también se revierten.
            conn.execute('analyze public.genera, public.species, public.species_names')
        timings['escritura'] = time.perf_counter() - mark

        measures = measure(conn)
        mark = time.perf_counter()
        if write:
            conn.commit()
        else:
            conn.rollback()
        timings['cierre'] = time.perf_counter() - mark
    except BaseException:
        conn.rollback()
        raise
    timings['total_base'] = time.perf_counter() - started
    return LoadResult(plan, applied, measures, write, timings)
