"""Cliente de la API de iNaturalist: caché, ritmo, topes, reintentos y lectura de taxones.

Sin red: el transporte es un diccionario de respuestas (las de la CLI, grabadas, están en
``test_inaturalist_cli.py``).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from catalog_import.inaturalist import (
    API_BASE,
    BACKOFF,
    NO_RESPONSE,
    USER_AGENT,
    ApiError,
    BudgetExhausted,
    Client,
    HttpStatus,
    OfflineMiss,
    Photo,
    build_url,
    check_url,
    iter_taxa,
    observation_photo,
    parse_photo,
    parse_taxon,
    taxon_photos,
)


class FakeClock:
    def __init__(self) -> None:
        self.now = 100.0
        self.sleeps: list[float] = []

    def clock(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


class Transport:
    """Devuelve las respuestas por URL y apunta cada petición. Una lista da respuestas
    sucesivas (una excepción en la lista se lanza)."""

    def __init__(self, responses: dict[str, object]) -> None:
        self.responses = responses
        self.calls: list[str] = []

    def __call__(self, url: str) -> bytes:
        self.calls.append(url)
        value = self.responses[url]
        if isinstance(value, list):
            value = value.pop(0)
        if isinstance(value, Exception):
            raise value
        return json.dumps(value).encode()


def client_for(tmp_path: Path, transport: Transport, **options: object) -> Client:
    clock = FakeClock()
    return Client(
        tmp_path / 'cache',
        fetch=transport,
        clock=clock.clock,
        sleep=clock.sleep,
        today=lambda: '2026-11-22',
        **options,  # type: ignore[arg-type]
    )


def test_url_is_stable_and_only_inaturalist() -> None:
    assert build_url('taxa', {'rank': 'species,hybrid', 'id_above': 0}) == (
        API_BASE + 'taxa?id_above=0&rank=species,hybrid'
    )
    check_url(API_BASE + 'taxa')
    for url in (
        'http://api.inaturalist.org/v1/taxa',
        'https://www.inaturalist.org/taxa',
        'https://api.inaturalist.org.ejemplo.com/v1/taxa',
        'https://inaturalist-open-data.s3.amazonaws.com/photos/1/medium.jpg',
    ):
        with pytest.raises(ApiError):
            check_url(url)


def test_user_agent_is_generic() -> None:
    assert USER_AGENT.startswith('orki-catalogo/')
    assert '@' not in USER_AGENT
    assert 'github' not in USER_AGENT.lower()


def test_second_request_comes_from_the_cache(tmp_path: Path) -> None:
    url = build_url('taxa', {'q': 'Vanda'})
    transport = Transport({url: {'results': [1]}})
    first = client_for(tmp_path, transport)
    assert first.get('taxa', {'q': 'Vanda'}) == {'results': [1]}
    again = client_for(tmp_path, transport)
    assert again.get('taxa', {'q': 'Vanda'}) == {'results': [1]}
    assert transport.calls == [url]
    assert (again.stats.network, again.stats.cached) == (0, 1)


def test_offline_uses_only_the_cache(tmp_path: Path) -> None:
    transport = Transport({})
    client = client_for(tmp_path, transport, offline=True)
    with pytest.raises(OfflineMiss):
        client.get('taxa', {'q': 'Vanda'})
    assert transport.calls == []


def test_corrupt_cache_entry_is_fetched_again(tmp_path: Path) -> None:
    url = build_url('taxa')
    transport = Transport({url: [{'a': 1}, {'a': 2}]})
    client = client_for(tmp_path, transport)
    client.get('taxa')
    (entry,) = (tmp_path / 'cache').rglob('*.json.gz')
    entry.write_bytes(b'no es gzip')
    assert client_for(tmp_path, transport).get('taxa') == {'a': 2}


def test_requests_are_at_least_one_second_apart(tmp_path: Path) -> None:
    clock = FakeClock()
    transport = Transport({build_url('a'): {}, build_url('b'): {}, build_url('c'): {}})
    client = Client(
        tmp_path, fetch=transport, clock=clock.clock, sleep=clock.sleep, today=lambda: 'd'
    )
    client.get('a')
    clock.now += 0.25
    client.get('b')
    client.get('c')
    assert clock.sleeps == [pytest.approx(0.75), pytest.approx(1.0)]


def test_interval_cannot_go_below_one_second(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match='1 s'):
        Client(tmp_path, min_interval=0.5)


def test_run_budget_stops_before_the_request(tmp_path: Path) -> None:
    transport = Transport({build_url('a'): {}, build_url('b'): {}})
    client = client_for(tmp_path, transport, max_requests=1)
    client.get('a')
    with pytest.raises(BudgetExhausted, match='1 peticiones de esta ejecución'):
        client.get('b')
    assert len(transport.calls) == 1


def test_daily_budget_is_shared_between_runs(tmp_path: Path) -> None:
    transport = Transport({build_url('a'): {}, build_url('b'): {}, build_url('c'): {}})
    client_for(tmp_path, transport, daily_limit=2).get('a')
    client_for(tmp_path, transport, daily_limit=2).get('b')
    with pytest.raises(BudgetExhausted, match='del día 2026-11-22'):
        client_for(tmp_path, transport, daily_limit=2).get('c')
    assert (tmp_path / 'cache' / 'peticiones-2026-11-22.txt').read_text() == '2'


def test_429_waits_and_retries(tmp_path: Path) -> None:
    url = build_url('taxa')
    transport = Transport({url: [HttpStatus(429, 120.0), HttpStatus(503), {'ok': True}]})
    clock = FakeClock()
    client = Client(
        tmp_path, fetch=transport, clock=clock.clock, sleep=clock.sleep, today=lambda: 'd'
    )
    assert client.get('taxa') == {'ok': True}
    assert clock.sleeps[:2] == [120.0, BACKOFF[1]]
    assert (client.stats.network, client.stats.retries) == (3, 2)


def test_persistent_errors_stop_with_an_error(tmp_path: Path) -> None:
    url = build_url('taxa')
    transport = Transport({url: [HttpStatus(503)] * (len(BACKOFF) + 1)})
    with pytest.raises(ApiError, match='503'):
        client_for(tmp_path, transport).get('taxa')
    transport = Transport({url: [HttpStatus(404)]})
    with pytest.raises(ApiError, match='404'):
        client_for(tmp_path / 'otra', transport).get('taxa')
    assert len(transport.calls) == 1


def test_parse_taxon_keeps_scientific_synonyms_and_replacements() -> None:
    taxon = parse_taxon(
        {
            'id': 488434,
            'name': 'Phalaenopsis pulcherrima',
            'rank': 'species',
            'is_active': True,
            'observations_count': 12,
            'names': [
                {
                    'name': 'Phalaenopsis pulcherrima',
                    'lexicon': 'scientific-names',
                    'is_valid': True,
                },
                {'name': 'Doritis pulcherrima', 'lexicon': 'scientific-names', 'is_valid': False},
                {'name': 'Orquídea', 'lexicon': 'spanish', 'is_valid': False},
            ],
            'default_photo': None,
        }
    )
    assert taxon.synonyms == ('Doritis pulcherrima',)
    assert taxon.default_photo is None
    inactive = parse_taxon(
        {
            'id': 344885,
            'name': 'Aphrodite',
            'is_active': False,
            'current_synonymous_taxon_ids': [864477],
        }
    )
    assert (inactive.is_active, inactive.current_ids) == (False, (864477,))


def test_photo_sizes_and_licenses() -> None:
    photo = parse_photo(
        {
            'id': 1190,
            'license_code': 'cc-by-nd',
            'attribution': '(c) Rodrigo Sala, some rights reserved (CC BY-ND)',
            'attribution_name': 'Rodrigo Sala',
            'url': 'https://inaturalist-open-data.s3.amazonaws.com/photos/1190/square.jpg',
            'flags': [],
        }
    )
    assert photo is not None
    assert not photo.accepted
    assert photo.url('medium').endswith('/photos/1190/medium.jpg')
    assert photo.page_url == 'https://www.inaturalist.org/photos/1190'
    reserved = parse_photo({'id': 2, 'license_code': None, 'url': 'https://x/photos/2/square.png'})
    assert reserved is not None
    assert reserved.license is None
    assert not reserved.accepted
    for code in ('cc0', 'cc-by'):
        assert Photo(1, code, '', None, 'u').accepted
    for code in ('cc-by-nc', 'cc-by-sa', 'cc-by-nd', 'cc-by-nc-sa', 'cc-by-nc-nd', 'pd'):
        assert not Photo(1, code, '', None, 'u').accepted
    medium = parse_photo({'id': 3, 'url': 'https://x/photos/3/medium.jpeg'})
    assert medium is not None
    assert medium.square_url == 'https://x/photos/3/square.jpeg'


def _page(ids: list[int]) -> dict[str, object]:
    return {'results': [{'id': i, 'name': f'Vanda n{i}', 'rank': 'species'} for i in ids]}


def test_iter_taxa_pages_by_id(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr('catalog_import.inaturalist.PER_PAGE', 2)

    def page_url(last: int) -> str:
        return build_url(
            'taxa',
            {
                'taxon_id': 7,
                'rank': 'species,hybrid',
                'is_active': 'any',
                'all_names': 'true',
                'per_page': 2,
                'order_by': 'id',
                'order': 'asc',
                'id_above': last,
            },
        )

    transport = Transport({page_url(0): _page([3, 5]), page_url(5): _page([9])})
    taxa = list(iter_taxa(client_for(tmp_path, transport), 7))
    assert [t.id for t in taxa] == [3, 5, 9]
    assert len(transport.calls) == 2


def test_taxon_photos_in_batches_of_thirty_in_the_given_order(tmp_path: Path) -> None:
    ids = list(range(1, 32))
    first = build_url('taxa/' + ','.join(str(i) for i in range(2, 32)))
    second = build_url('taxa/1')
    photo = {'id': 5, 'license_code': 'cc0', 'url': 'https://x/photos/5/square.jpg'}
    transport = Transport(
        {
            first: {'results': [{'id': 31, 'taxon_photos': [{'photo': photo}]}]},
            second: [HttpStatus(404)],
        }
    )
    found: dict[int, list[Photo]] = {}
    with pytest.raises(ApiError):
        taxon_photos(client_for(tmp_path, transport), reversed(ids), into=found)
    # Lo leído antes del corte se conserva.
    assert [p.id for p in found[31]] == [5]
    assert transport.calls == [first, second]


def test_network_errors_are_retried(tmp_path: Path) -> None:
    url = build_url('taxa')
    transport = Transport({url: [HttpStatus(NO_RESPONSE), {'ok': True}]})
    assert client_for(tmp_path, transport).get('taxa') == {'ok': True}
    transport = Transport({url: [HttpStatus(NO_RESPONSE)] * (len(BACKOFF) + 1)})
    with pytest.raises(ApiError, match='no respondió'):
        client_for(tmp_path / 'otra', transport).get('taxa')


def test_observation_photo_skips_hybrid_descendants_and_bad_photos(tmp_path: Path) -> None:
    taxon = parse_taxon({'id': 47215, 'name': 'Calypso bulbosa', 'rank': 'species'})
    url = build_url(
        'observations',
        {
            'taxon_id': 47215,
            'photo_license': 'cc-by,cc0',
            'quality_grade': 'research',
            'photos': 'true',
            'order_by': 'votes',
            'order': 'desc',
            'per_page': 10,
        },
    )

    def photo(i: int, code: str | None, **extra: object) -> dict[str, object]:
        return {'id': i, 'license_code': code, 'url': f'https://x/photos/{i}/square.jpg', **extra}

    transport = Transport(
        {
            url: {
                'results': [
                    {
                        'id': 1,
                        'taxon': {'id': 868032, 'rank': 'hybrid'},
                        'user': {'login': 'a'},
                        'photos': [photo(10, 'cc0')],
                    },
                    {
                        'id': 2,
                        'taxon': {'id': 99, 'rank': 'variety'},
                        'user': {'login': 'usuaria', 'name': ''},
                        'photos': [
                            photo(20, 'cc-by-nc'),
                            photo(21, 'cc-by', flags=[{'flag': 'spam'}]),
                            photo(22, 'cc0', attribution='no rights reserved'),
                        ],
                    },
                ]
            }
        }
    )
    found = observation_photo(client_for(tmp_path, transport), taxon)
    assert found is not None
    assert (found.id, found.license, found.author, found.observation_id) == (
        22,
        'cc0',
        'usuaria',
        2,
    )
