"""Elección de la foto de referencia, atribución, alcance y plan de filas, sin red ni base."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from catalog_import.inaturalist import Photo, Taxon
from catalog_import.inaturalist_match import Match, MatchResult
from catalog_import.reference_images import Converted, Encoded
from catalog_import.reference_photos import (
    MAX_ATTRIBUTION,
    Action,
    CurrentPhoto,
    DbSpecies,
    Metadata,
    Outcome,
    PhotoState,
    Prepared,
    Scope,
    candidates,
    decide,
    photo_paths,
    plan_rows,
    select_scope,
    stored_attribution,
)
from catalog_import.reference_photos_cli import find_orphans
from catalog_import.species_storage import StoredObject

SPECIES = '0f6c1b6e-8b5a-4c3e-9b1a-2d3e4f5a6b7c'
OTHER = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'


def photo(
    i: int, code: str | None, author: str | None = 'Ana Pérez', *, flagged: bool = False
) -> Photo:
    notice = f'(c) {author}, some rights reserved ({code})' if author else 'no rights reserved'
    return Photo(
        i,
        code,
        notice,
        author,
        f'https://inaturalist-open-data.s3.amazonaws.com/photos/{i}/square.jpg',
        flagged,
    )


def taxon(default: Photo | None) -> Taxon:
    return Taxon(7, 'Phalaenopsis amabilis', 'species', True, (), (), default, 10)


def species(sid: str = SPECIES, *, plants: int = 0, genus: str = 'Phalaenopsis') -> DbSpecies:
    return DbSpecies(sid, f'{genus} amabilis', genus, 'species', (), plants)


def current(photo_id: int, **extra: object) -> CurrentPhoto:
    data: dict[str, object] = {
        'species_id': SPECIES,
        'source_photo_id': str(photo_id),
        'medium_path': f'{SPECIES}/medium-{photo_id}.webp',
        'thumbnail_path': f'{SPECIES}/thumb-{photo_id}.webp',
        'license': 'cc-by',
        'author_name': 'Ana Pérez',
        'attribution': '',
        'source_selection': 'taxon_photo',
        'source_observation_id': None,
        'source_taxon_id': '7',
    }
    data.update(extra)
    return CurrentPhoto(**data)  # type: ignore[arg-type]


def run(
    default: Photo | None,
    others: list[Photo],
    state: PhotoState | None = None,
    *,
    sid: str = SPECIES,
    observation: Photo | None = None,
):
    t = taxon(default)
    result = MatchResult(species(sid).entry(), Match.ACCEPTED, t, t.name)
    return decide(
        species(sid),
        result,
        candidates(t, others, observation),
        state or PhotoState(),
        observations_searched=observation is not None,
    )


def test_default_photo_first_then_taxon_photos_by_license() -> None:
    decision = run(photo(1, 'cc-by'), [photo(2, 'cc0')])
    assert decision.action is Action.FETCH
    assert decision.outcome is Outcome.NEW
    assert [c.id for c in decision.usable] == ['1', '2']
    assert decision.usable[0].selection.value == 'taxon_default'
    # Las cuatro licencias aceptadas, en el orden del taxón; las demás se descartan.
    decision = run(
        photo(1, 'cc-by-nc'),
        [
            photo(2, 'cc-by-nd'),
            photo(3, 'pd'),
            photo(4, None),
            photo(5, 'cc-by-sa'),
            photo(6, 'cc0'),
        ],
    )
    assert [(c.id, c.selection.value) for c in decision.usable] == [
        ('3', 'taxon_photo'),
        ('5', 'taxon_photo'),
        ('6', 'taxon_photo'),
    ]
    assert decision.skipped == {'licencia_no_aceptada': 3}
    # Con marcas, sin autor o fuera del bucket abierto, tampoco.
    hosted = Photo(8, 'cc-by', '(c) X', 'X', 'https://static.inaturalist.org/photos/8/square.jpg')
    decision = run(photo(1, 'cc0', flagged=True), [photo(2, 'cc-by', None), hosted])
    assert decision.usable == []
    assert decision.outcome is Outcome.NO_PHOTO
    assert decision.action is Action.NONE
    assert decision.skipped == {'con_marcas': 1, 'sin_autor': 1, 'url_no_admitida': 1}


def test_retired_photo_is_skipped_only_for_its_species() -> None:
    state = PhotoState()
    state.rejected[SPECIES].add('1')
    decision = run(photo(1, 'cc-by'), [photo(2, 'cc-by-sa')], state)
    assert [c.id for c in decision.usable] == ['2']
    assert decision.skipped == {'retirada': 1}
    assert [c.id for c in run(photo(1, 'cc-by'), [], state, sid=OTHER).usable] == ['1']


def test_author_request_skips_the_photo_in_every_species() -> None:
    state = PhotoState(author_requests={'1'})
    for sid in (SPECIES, OTHER):
        decision = run(photo(1, 'cc-by'), [], state, sid=sid)
        assert decision.usable == []
        assert decision.skipped == {'peticion_del_autor': 1}


def test_species_that_already_has_the_photo() -> None:
    chosen = photo(1, 'cc-by')
    attribution = stored_attribution(chosen, 'Ana Pérez')
    state = PhotoState(
        photos={SPECIES: current(1, attribution=attribution, source_selection='taxon_default')}
    )
    decision = run(chosen, [], state)
    assert (decision.action, decision.outcome) == (Action.NONE, Outcome.UNCHANGED)
    # Si la mejor ahora es otra, se conserva la que tiene mientras siga valiendo.
    state = PhotoState(
        photos={
            SPECIES: current(
                2, attribution=stored_attribution(photo(2, 'cc0'), 'Ana Pérez'), license='cc0'
            )
        }
    )
    decision = run(photo(1, 'cc-by'), [photo(2, 'cc0')], state)
    assert decision.outcome is Outcome.UNCHANGED
    # Cambió el autor o la licencia (sigue aceptada): se actualizan solo los datos.
    state = PhotoState(photos={SPECIES: current(1, author_name='Otro', attribution='x')})
    decision = run(chosen, [], state)
    assert (decision.action, decision.outcome) == (Action.UPDATE, Outcome.UPDATED)
    assert decision.metadata is not None
    assert decision.metadata.author_name == 'Ana Pérez'


def test_current_photo_that_no_longer_qualifies() -> None:
    # Ahora es «no comercial»: se sustituye por la siguiente.
    state = PhotoState(photos={SPECIES: current(1)})
    decision = run(photo(1, 'cc-by-nc'), [photo(2, 'cc-by')], state)
    assert (decision.action, decision.outcome) == (Action.FETCH, Outcome.REPLACED)
    assert [c.id for c in decision.usable] == ['2']
    assert 'licencia_no_aceptada' in decision.detail
    # Sin otra: se quita la fila.
    decision = run(photo(1, 'cc-by-nc'), [], state)
    assert (decision.action, decision.outcome) == (Action.REMOVE, Outcome.REMOVED)
    # El taxón ya no la tiene.
    decision = run(photo(3, 'cc0'), [], state)
    assert decision.outcome is Outcome.REPLACED
    assert 'ya no la tiene' in decision.detail
    # Retirada a petición del autor en otra especie: tampoco vale aquí.
    state.author_requests.add('1')
    assert run(photo(1, 'cc-by'), [], state).outcome is Outcome.REMOVED


def test_current_observation_photo_is_kept_when_it_cannot_be_checked() -> None:
    state = PhotoState(
        photos={SPECIES: current(9, source_selection='observation', source_observation_id='5')}
    )
    decision = run(photo(1, 'cc-by-nc'), [], state)
    assert (decision.action, decision.outcome) == (Action.NONE, Outcome.KEPT)
    decision = run(photo(1, 'cc-by-nc'), [], state, observation=photo(10, 'cc-by'))
    assert decision.outcome is Outcome.KEPT


def test_taxon_photo_is_kept_when_taxon_photos_were_not_read() -> None:
    # Con --alternativas ninguna no se leen las fotos del taxón: no se puede saber si la actual
    # (otra foto del taxón) sigue ahí, así que no se quita.
    t = taxon(photo(1, 'cc-by-nc'))
    state = PhotoState(photos={SPECIES: current(2)})
    result = MatchResult(species().entry(), Match.ACCEPTED, t, t.name)
    decision = decide(
        species(),
        result,
        candidates(t, None, None),
        state,
        observations_searched=False,
        taxon_photos_searched=False,
    )
    assert (decision.action, decision.outcome) == (Action.NONE, Outcome.KEPT)


def test_unmatched_species() -> None:
    entry = species().entry()
    decision = decide(
        species(), MatchResult(entry, Match.NO_TAXON), [], PhotoState(), observations_searched=False
    )
    assert decision.outcome is Outcome.UNMATCHED
    ambiguous = MatchResult(entry, Match.AMBIGUOUS, detail='Varios')
    assert (
        decide(species(), ambiguous, [], PhotoState(), observations_searched=False).outcome
        is Outcome.AMBIGUOUS
    )
    kept = PhotoState(photos={SPECIES: current(1)})
    assert decide(species(), None, [], kept, observations_searched=False).outcome is Outcome.KEPT


@pytest.mark.parametrize(
    ('code', 'label', 'url'),
    [
        ('cc0', 'CC0', 'https://creativecommons.org/publicdomain/zero/1.0/'),
        ('pd', 'dominio público (PD)', 'https://creativecommons.org/publicdomain/mark/1.0/'),
        ('cc-by', 'CC BY', 'https://creativecommons.org/licenses/by/4.0/'),
        ('cc-by-sa', 'CC BY-SA', 'https://creativecommons.org/licenses/by-sa/4.0/'),
    ],
)
def test_stored_attribution_meets_each_license(code: str, label: str, url: str) -> None:
    text = stored_attribution(photo(123, code), 'Ana Pérez')
    assert text.startswith(f'(c) Ana Pérez, some rights reserved ({code}). ')
    assert f'Licencia: {label} ({url})' in text
    assert 'Original: https://www.inaturalist.org/photos/123, vía iNaturalist' in text
    assert 'Modificada: reducida y convertida a WebP' in text
    assert ('misma licencia, CC BY-SA' in text) is (code == 'cc-by-sa')


def test_stored_attribution_names_the_author_and_fits() -> None:
    # Una foto CC0 de observación trae «no rights reserved» sin nombre: se antepone el autor.
    assert stored_attribution(photo(1, 'cc0', None), 'Luis').startswith('Luis: no rights reserved.')
    long = Photo(1, 'cc-by-sa', '(c) ' + 'x' * 600, 'Ana', photo(1, 'cc0').square_url)
    text = stored_attribution(long, 'Ana')
    assert len(text) <= MAX_ATTRIBUTION
    assert text.endswith('misma licencia, CC BY-SA.')


def test_scope() -> None:
    rows = [
        species('a', genus='Vanda'),
        species('b', plants=3, genus='Masdevallia'),
        species('c', genus='Phalaenopsis'),
        species('d', plants=1, genus='Bulbophyllum'),
        species('e', genus='Bulbophyllum'),
    ]
    by_default = [s.id for s in select_scope(rows, Scope())]
    assert by_default == ['b', 'd', 'c', 'a']  # con plantas primero; fuera la «e»
    assert [s.id for s in select_scope(rows, Scope(genera=('bulbophyllum',)))] == ['d', 'e']
    assert len(select_scope(rows, Scope(everything=True))) == 5
    assert [s.id for s in select_scope(rows, Scope(limit=2))] == ['b', 'd']


def prepared(photo_id: str = '1') -> Prepared:
    medium, thumb = photo_paths(SPECIES, photo_id)
    encoded = Encoded(b'x', 10, 10)
    meta = Metadata(
        photo_id,
        None,
        '7',
        'taxon_default',
        f'https://www.inaturalist.org/photos/{photo_id}',
        'cc-by',
        'Ana',
        'a',
    )
    return Prepared(meta, Converted(encoded, encoded), datetime.now(UTC), medium, thumb)


def test_plan_rows_rechecks_what_changed_meanwhile() -> None:
    decision = run(photo(1, 'cc-by'), [])
    decision.prepared = prepared()
    fresh = PhotoState(species_ids={SPECIES})
    plan = plan_rows([decision], fresh)
    assert [(o.op.value, o.outcome.value) for o in plan.ops] == [('upsert', 'nueva')]
    assert plan.counts == {'created': 1}
    # Retirada mientras se descargaba: no se escribe.
    fresh.rejected[SPECIES].add('1')
    plan = plan_rows([decision], fresh)
    assert plan.ops == []
    assert 'retiró' in plan.skipped[SPECIES]
    # La especie se borró.
    assert 'borró' in plan_rows([decision], PhotoState()).skipped[SPECIES]
    # Otra carga ya la puso: sin cambios.
    fresh = PhotoState(species_ids={SPECIES}, photos={SPECIES: current(1)})
    plan = plan_rows([decision], fresh)
    assert plan.ops == []
    assert plan.counts == {'unchanged': 1}
    # Otra carga puso otra foto: no se pisa.
    fresh = PhotoState(species_ids={SPECIES}, photos={SPECIES: current(5)})
    assert 'cambió' in plan_rows([decision], fresh).skipped[SPECIES]


def test_orphans_compare_paths_and_respect_age() -> None:
    now = datetime(2026, 11, 23, 12, tzinfo=UTC)
    objects = [
        StoredObject('a/medium-1.webp', now - timedelta(days=3)),
        StoredObject('a/thumb-1.webp', now - timedelta(days=3)),
        StoredObject('b/medium-2.webp', now - timedelta(days=3)),
        StoredObject('b/thumb-2.webp', now - timedelta(hours=2)),
        StoredObject('c/thumb-3.webp', None),
    ]
    # Tras una fusión, la fila de la especie «z» cita archivos de la carpeta «a».
    old, recent = find_orphans(
        objects, {'a/medium-1.webp', 'a/thumb-1.webp'}, now, timedelta(hours=24)
    )
    assert [o.path for o in old] == ['b/medium-2.webp']
    assert [o.path for o in recent] == ['b/thumb-2.webp', 'c/thumb-3.webp']
