"""Carga de la lista curada de híbridos: el plan (función pura) sobre el flujo de la de COL.

Lo demás es el mismo flujo que ``orki-catalogo cargar`` (:func:`catalog_import.load.run_plan`):
una transacción, bloqueo de las tablas del catálogo, lectura de la base, este plan, escritura
por conjuntos con :func:`catalog_import.load.apply_plan`, medida y confirmación o, en
simulación, reversión.

Reglas (el README de la carpeta las explica con más detalle):

- Solo se cargan las entradas revisadas; las demás salen como ``omitido``.
- Fuente ``curated``, ``source_ref`` = el ``id`` de la fila, tipo ``hybrid``, estado
  ``validated``. Una entrada de la lista solo se cambia mientras sigue ``validated``: si un
  administrador la marca como observada (o la devuelve a importada), la carga no la toca.
- Para especies manda el Catalogue of Life: si el nombre (sin distinguir mayúsculas ni el
  signo «×») ya lo tiene una especie de otra fuente, o de la lista con otra referencia, la
  entrada va al reporte como conflicto y no se carga.
- Géneros: se casan sin distinguir mayúsculas ni el signo «×». Si no existe, se crea, con la
  grafía de la lista. Si existe con otra grafía, se usa el de la base y no se renombra (la
  grafía de los géneros la decide la importación de COL).
- Nombres: se añaden los que faltan; nunca se cambia ni se borra uno. Los que la base tiene y
  la lista ya no trae se conservan y se listan.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Sequence

from .hybrids import HybridEntry
from .load import (
    COMMON_NAME,
    CONFLICT,
    GENUS,
    NEW,
    NOT_IN_SOURCE,
    OMITTED,
    REJECTED,
    SPECIES,
    SYNONYM,
    UNCHANGED,
    UPDATED,
    DbGenus,
    DbSnapshot,
    DbSpecies,
    GenusRef,
    Plan,
    ReportRow,
    SourcePolicy,
    SpeciesWrite,
)
from .names import match_key

CURATED = 'curated'
VALIDATED = 'validated'
HYBRID = 'hybrid'
CURATED_POLICY = SourcePolicy(CURATED, VALIDATED, VALIDATED)

_NAME_TYPE_LABEL = {'common': 'nombre común', 'synonym': 'sinónimo'}
_NAME_ENTITY = {'common': COMMON_NAME, 'synonym': SYNONYM}


def _plan_genera(
    entries: Sequence[HybridEntry], snapshot: DbSnapshot, plan: Plan
) -> dict[str, GenusRef | None]:
    """Destino de cada género de la lista (por su clave sin «×» ni mayúsculas)."""
    by_key: dict[str, list[DbGenus]] = defaultdict(list)
    for genus in snapshot.genera:
        by_key[match_key(genus.name)].append(genus)

    targets: dict[str, GenusRef | None] = {}
    for entry in entries:
        key = match_key(entry.genus)
        if key in targets:
            continue
        candidates = by_key.get(key, [])
        same_case = [g for g in candidates if g.name.lower() == entry.genus.lower()]
        chosen = same_case[0] if len(same_case) == 1 else None
        if chosen is None and len(candidates) == 1:
            chosen = candidates[0]
        if chosen is not None:
            targets[key] = ('id', chosen.id)
            detail = ''
            if chosen.name != entry.genus:
                detail = (
                    f'En la base está como «{chosen.name}»; la lista lo escribe «{entry.genus}». '
                    'Se usa el de la base y no se renombra (la grafía de los géneros la decide la '
                    'importación del Catalogue of Life).'
                )
            plan.add(
                ReportRow(GENUS, UNCHANGED, 'GENERO_EXISTENTE', '', entry.genus, '', detail,
                          chosen.id)
            )  # fmt: skip
        elif candidates:
            targets[key] = None
            existing = ', '.join(f'«{g.name}»' for g in candidates)
            plan.add(
                ReportRow(
                    GENUS,
                    CONFLICT,
                    'GENERO_AMBIGUO',
                    name=entry.genus,
                    detail=(
                        f'En la base hay varios géneros que solo se distinguen por el signo ×: '
                        f'{existing}. No se toca ninguno y sus entradas no se cargan.'
                    ),
                )
            )
        else:
            targets[key] = ('nuevo', entry.genus)
            plan.genus_inserts.append(entry.genus)
            plan.add(
                ReportRow(
                    GENUS,
                    NEW,
                    'GENERO_NUEVO',
                    name=entry.genus,
                    detail='No está en la base: se crea, sin abreviatura ni acceso rápido. '
                    'Comprueba que el nombre está bien escrito.',
                )
            )
    return targets


def plan_hybrids(entries: Sequence[HybridEntry], snapshot: DbSnapshot) -> Plan:
    """Planifica la carga de la lista sin tocar la base."""
    plan = Plan()
    reviewed = [e for e in entries if e.reviewed]
    genus_targets = _plan_genera(reviewed, snapshot, plan)
    genus_names = {g.id: g.name for g in snapshot.genera}

    by_ref = {s.source_ref: s for s in snapshot.species if s.source == CURATED and s.source_ref}
    by_key: dict[str, list[DbSpecies]] = defaultdict(list)
    for sp in snapshot.species:
        by_key[match_key(sp.scientific_name)].append(sp)
    list_refs = {e.ref for e in entries}

    def genus_label(target: GenusRef) -> str:
        kind, value = target
        return value if kind == 'nuevo' else genus_names.get(value, value)

    for entry in entries:
        existing = by_ref.get(entry.ref)
        if not entry.reviewed:
            detail = 'Marcada como no revisada en la lista: no se carga.'
            if existing is not None:
                detail += (
                    f' Ya está en la base («{existing.scientific_name}»): se conserva tal cual.'
                )
            plan.add(
                ReportRow(SPECIES, OMITTED, 'NO_REVISADA', entry.ref, entry.name, '', detail,
                          existing.id if existing else '')
            )  # fmt: skip
            continue

        genus_target = genus_targets.get(match_key(entry.genus))
        target: tuple[str, str] | None = None
        if genus_target is None:
            plan.add(
                ReportRow(
                    SPECIES,
                    REJECTED,
                    'GENERO_EN_CONFLICTO',
                    entry.ref,
                    entry.name,
                    detail=f'Su género, «{entry.genus}», está en conflicto (ver GENERO_AMBIGUO).',
                )
            )
        elif existing is not None:
            target = _plan_existing(entry, existing, genus_target, by_key, snapshot, plan,
                                    genus_names, genus_label)  # fmt: skip
        else:
            target = _plan_new(entry, genus_target, by_key, list_refs, plan, genus_label)

        current = by_ref.get(entry.ref) if target and target[0] == 'id' else None
        _plan_names(
            entry,
            target,
            current.scientific_name if current else entry.name,
            snapshot.names.get(current.id, {}) if current else {},
            plan,
        )

    for sp in snapshot.species:
        if sp.source == CURATED and sp.source_ref and sp.source_ref not in list_refs:
            plan.add(
                ReportRow(
                    SPECIES,
                    NOT_IN_SOURCE,
                    'ENTRADA_NO_EN_LISTA',
                    sp.source_ref,
                    sp.scientific_name,
                    detail=f'Cargada de la lista, que ya no trae ese identificador. Se conserva '
                    f'(estado {sp.status}). Los identificadores no se cambian ni se reutilizan.',
                    db_id=sp.id,
                )
            )
    return plan


def _plan_existing(
    entry: HybridEntry,
    existing: DbSpecies,
    genus_target: GenusRef,
    by_key: dict[str, list[DbSpecies]],
    snapshot: DbSnapshot,
    plan: Plan,
    genus_names: dict[str, str],
    genus_label: Callable[[GenusRef], str],
) -> tuple[str, str]:
    """Entrada que ya está en la base (misma referencia). Devuelve el destino de sus nombres."""
    changes: list[str] = []
    if existing.scientific_name != entry.name:
        changes.append(f'nombre: «{existing.scientific_name}» → «{entry.name}»')
    if genus_target != ('id', existing.genus_id):
        old = genus_names.get(existing.genus_id, existing.genus_id)
        changes.append(f'género: «{old}» → «{genus_label(genus_target)}»')
    if existing.type != HYBRID:
        changes.append(f'tipo: {existing.type} → {HYBRID}')

    taken = [sp for sp in by_key.get(match_key(entry.name), []) if sp.id != existing.id]
    if not changes:
        plan.add(
            ReportRow(SPECIES, UNCHANGED, 'ESPECIE_SIN_CAMBIOS', entry.ref, entry.name,
                      db_id=existing.id)
        )  # fmt: skip
    elif existing.status != VALIDATED:
        plan.add(
            ReportRow(
                SPECIES,
                CONFLICT,
                'ESPECIE_PROTEGIDA',
                entry.ref,
                entry.name,
                detail=(
                    f'Un administrador la dejó {existing.status}: no se cambia. La lista trae: '
                    f'{"; ".join(changes)}.'
                ),
                db_id=existing.id,
            )
        )
    elif taken:
        other = taken[0]
        plan.add(
            ReportRow(
                SPECIES,
                CONFLICT,
                'NOMBRE_OCUPADO',
                entry.ref,
                entry.name,
                detail=(
                    f'La lista cambia el nombre de «{existing.scientific_name}», pero el nuevo ya '
                    f'lo usa otra especie («{other.scientific_name}», fuente {other.source}, '
                    f'referencia {other.source_ref or "ninguna"}). No se cambia.'
                ),
                db_id=existing.id,
            )
        )
    else:
        propagates = any(c.startswith(('género', 'tipo')) for c in changes)
        plants = snapshot.plants.get(existing.id, 0) if propagates else 0
        if plants:
            changes.append(f'se propaga a {plants} plantas de usuarios')
        plan.species_updates.append(
            SpeciesWrite(entry.ref, entry.name, genus_target, HYBRID, existing.id)
        )
        plan.add(
            ReportRow(SPECIES, UPDATED, 'ESPECIE_ACTUALIZADA', entry.ref, entry.name,
                      detail='; '.join(changes), db_id=existing.id)
        )  # fmt: skip
    return ('id', existing.id)


def _plan_new(
    entry: HybridEntry,
    genus_target: GenusRef,
    by_key: dict[str, list[DbSpecies]],
    list_refs: set[str],
    plan: Plan,
    genus_label: Callable[[GenusRef], str],
) -> tuple[str, str] | None:
    """Entrada que no está en la base con su referencia: alta o conflicto de nombre."""
    same = by_key.get(match_key(entry.name), [])
    if not same:
        plan.species_inserts.append(SpeciesWrite(entry.ref, entry.name, genus_target, HYBRID))
        plan.add(
            ReportRow(
                SPECIES,
                NEW,
                'ESPECIE_NUEVA',
                entry.ref,
                entry.name,
                detail=(
                    f'género: «{genus_label(genus_target)}»; tipo: {HYBRID}; estado: {VALIDATED}'
                ),
            )
        )
        return ('ref', entry.ref)

    other = same[0]
    found = f'El nombre ya está en la base como «{other.scientific_name}»'
    if other.source != CURATED:
        code = 'NOMBRE_DE_OTRA_FUENTE'
        detail = (
            f'{found}, con fuente {other.source} y estado {other.status}. Para las especies manda '
            'el Catalogue of Life: la entrada no se carga y la especie no se toca.'
        )
    elif other.source_ref is None:
        code = 'NOMBRE_DE_OTRA_ENTRADA'
        detail = (
            f'{found}, de la lista curada pero sin referencia (creada a mano o por los datos de '
            f'ejemplo). No se toca. Si es la misma entrada, un administrador puede ponerle '
            f'source_ref = {entry.ref} y la siguiente carga la mantendrá.'
        )
    elif other.source_ref in list_refs:
        code = 'NOMBRE_DE_OTRA_ENTRADA'
        detail = (
            f'{found}, con la referencia {other.source_ref}, que la lista usa para otra entrada. '
            'No se toca: revisa los identificadores de las dos filas.'
        )
    else:
        code = 'NOMBRE_DE_OTRA_ENTRADA'
        detail = (
            f'{found}, con la referencia {other.source_ref}, que ya no está en la lista. Si es '
            f'la misma entrada, vuelve a ponerle el identificador {other.source_ref}: los '
            'identificadores no se cambian.'
        )
    plan.add(ReportRow(SPECIES, CONFLICT, code, entry.ref, entry.name, detail=detail,
                       db_id=other.id))  # fmt: skip
    return None


def _plan_names(
    entry: HybridEntry,
    target: tuple[str, str] | None,
    current_name: str,
    existing_names: dict[str, tuple[str, str]],
    plan: Plan,
) -> None:
    """Nombres comunes y otros nombres: se añaden los que faltan; nunca se cambia ni se borra
    uno. ``current_name`` y ``existing_names`` son los de la especie en la base."""
    label = f'{entry.name} ({entry.ref})'
    wanted = [(name, 'common') for name in entry.common_names]
    wanted += [(name, 'synonym') for name in entry.other_names]
    if target is None:
        for name, kind in wanted:
            plan.add(
                ReportRow(_NAME_ENTITY[kind], REJECTED, 'NOMBRE_SIN_ESPECIE', entry.ref, name,
                          label, 'Su entrada no se cargó (ver la fila de la especie).')
            )  # fmt: skip
        return

    listed: set[str] = set()
    for name, kind in wanted:
        entity = _NAME_ENTITY[kind]
        lowered = name.lower()
        listed.add(lowered)
        found = existing_names.get(lowered)
        if match_key(name) == match_key(current_name):
            plan.add(
                ReportRow(entity, CONFLICT, 'NOMBRE_IGUAL_AL_ACEPTADO', entry.ref, name, label,
                          'Coincide con el nombre que la especie tiene en la base. No se carga.')
            )  # fmt: skip
        elif found is None:
            plan.name_inserts.append((target, name, kind))
            plan.add(ReportRow(entity, NEW, 'NOMBRE_NUEVO', entry.ref, name, label))
        elif found[1] == kind:
            plan.add(ReportRow(entity, UNCHANGED, 'NOMBRE_SIN_CAMBIOS', entry.ref, name, label))
        else:
            plan.add(
                ReportRow(
                    entity,
                    CONFLICT,
                    'NOMBRE_DE_OTRO_TIPO',
                    entry.ref,
                    name,
                    label,
                    f'La especie ya tiene «{found[0]}» como {_NAME_TYPE_LABEL[found[1]]}. No se '
                    'cambia.',
                )
            )

    for lowered, (name, kind) in sorted(existing_names.items()):
        if lowered not in listed:
            plan.add(
                ReportRow(
                    _NAME_ENTITY.get(kind, SYNONYM),
                    NOT_IN_SOURCE,
                    'NOMBRE_NO_EN_LISTA',
                    entry.ref,
                    name,
                    label,
                    f'{_NAME_TYPE_LABEL.get(kind, kind).capitalize()} que la base tiene y la '
                    'lista no trae (quitado de la lista o añadido por un administrador). Se '
                    'conserva: la carga nunca borra.',
                )
            )
