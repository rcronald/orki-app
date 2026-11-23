import { vi } from 'vitest'

// Doble del catálogo público (#232) para las pruebas unitarias: un `fetch`
// que responde las cuatro funciones de "Catálogo público" (supabase/README.md)
// como PostgREST, desde un catálogo pequeño en memoria. Anota cada llamada
// (función, parámetros y cabecera Authorization) para comprobar que van sin
// token. Cualquier otra petición responde 501 y queda en `unexpected`.

export const CONFIG = {
  supabaseUrl: 'https://ejemplo.supabase.co',
  supabasePublishableKey: 'sb_publishable_clave_de_prueba',
  appEnv: 'dev',
  clerkPublishableKey: 'pk_test_clave_de_prueba',
} as const

const id = (group: number, n: number) =>
  `${String(group).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`

export interface FakeGenus {
  id: string
  name: string
}

export interface FakeSpecies {
  id: string
  scientific_name: string
  genus_id: string
  type: 'species' | 'hybrid'
  source: 'col' | 'curated' | 'user_proposal' | 'gbif'
  source_ref: string | null
  synonyms: string[]
  /** Sinónimos en total; por defecto, los de `synonyms`. */
  synonym_count?: number
  common_names: { name: string; language: string | null }[]
  /** Foto de referencia (#234), como la columna reference_photo; sin ella, null. */
  reference_photo?: FakeReferencePhoto | null
}

/** La foto de referencia de una especie, con los campos de get_public_species. */
export interface FakeReferencePhoto {
  medium_path: string
  medium_width: number
  medium_height: number
  thumbnail_path: string
  thumbnail_width: number
  thumbnail_height: number
  author_name: string
  attribution: string
  license: 'cc0' | 'pd' | 'cc-by' | 'cc-by-sa'
  source: 'inaturalist'
  source_url: string
  source_observation_id: string | null
  is_modified: boolean
  obtained_at: string
}

/** Una foto de referencia de prueba para `speciesId` (CC BY, reducida). */
export function fakeReferencePhoto(
  speciesId: string,
  overrides: Partial<FakeReferencePhoto> = {},
): FakeReferencePhoto {
  return {
    medium_path: `${speciesId}/medium-12345.webp`,
    medium_width: 480,
    medium_height: 360,
    thumbnail_path: `${speciesId}/thumb-12345.webp`,
    thumbnail_width: 160,
    thumbnail_height: 120,
    author_name: 'Ana Pérez',
    attribution: '(c) Ana Pérez, some rights reserved (CC BY)',
    license: 'cc-by',
    source: 'inaturalist',
    source_url: 'https://www.inaturalist.org/photos/12345',
    source_observation_id: null,
    is_modified: true,
    obtained_at: '2026-11-23T12:00:00.000Z',
    ...overrides,
  }
}

/** La miniatura de una foto, con los campos de reference_thumbnail. */
function thumbnailOf(photo: FakeReferencePhoto | null | undefined) {
  if (!photo) return null
  return {
    thumbnail_path: photo.thumbnail_path,
    thumbnail_width: photo.thumbnail_width,
    thumbnail_height: photo.thumbnail_height,
    author_name: photo.author_name,
    license: photo.license,
    source: photo.source,
    source_url: photo.source_url,
    is_modified: photo.is_modified,
  }
}

export const GENUS = {
  cattleya: id(2, 1),
  dendrobium: id(2, 2),
  rlc: id(2, 3),
  phalaenopsis: id(2, 4),
}

export const SPECIES = {
  amabilis: id(1, 1),
  maxima: id(1, 2),
  purpurata: id(1, 3),
  nobile: id(1, 4),
  rlcHybrid: id(1, 5),
}

/** Un género con muchas especies, para la paginación. */
export const BIG_GENUS_SPECIES = 120

export function fakeCatalog(): { genera: FakeGenus[]; species: FakeSpecies[] } {
  const species: FakeSpecies[] = [
    {
      id: SPECIES.amabilis,
      scientific_name: 'Phalaenopsis amabilis',
      genus_id: GENUS.phalaenopsis,
      type: 'species',
      source: 'col',
      source_ref: '5T6MX',
      synonyms: ['Phalaenopsis grandiflora', 'Epidendrum amabile'],
      synonym_count: 140,
      common_names: [
        { name: 'Orquídea luna', language: 'es' },
        { name: 'Moon orchid', language: 'en' },
      ],
    },
    {
      id: SPECIES.maxima,
      scientific_name: 'Cattleya maxima',
      genus_id: GENUS.cattleya,
      type: 'species',
      source: 'col',
      source_ref: 'C4XM',
      synonyms: [],
      common_names: [],
    },
    {
      id: SPECIES.purpurata,
      scientific_name: 'Cattleya purpurata',
      genus_id: GENUS.cattleya,
      type: 'species',
      source: 'col',
      source_ref: 'C4PP',
      synonyms: ['Laelia purpurata'],
      common_names: [],
    },
    {
      id: SPECIES.rlcHybrid,
      scientific_name: '× Rhyncholaeliocattleya Memoria Helen Brown',
      genus_id: GENUS.rlc,
      type: 'hybrid',
      source: 'curated',
      source_ref: 'curada-12',
      synonyms: [],
      common_names: [],
    },
  ]
  for (let n = 1; n <= BIG_GENUS_SPECIES; n += 1) {
    species.push({
      id: n === 1 ? SPECIES.nobile : id(3, n),
      scientific_name:
        n === 1
          ? 'Dendrobium nobile'
          : `Dendrobium especie${String(n).padStart(3, '0')}`,
      genus_id: GENUS.dendrobium,
      type: 'species',
      source: 'col',
      source_ref: null,
      synonyms: [],
      common_names: [],
    })
  }
  return {
    genera: [
      { id: GENUS.cattleya, name: 'Cattleya' },
      { id: GENUS.dendrobium, name: 'Dendrobium' },
      { id: GENUS.phalaenopsis, name: 'Phalaenopsis' },
      { id: GENUS.rlc, name: '× Rhyncholaeliocattleya' },
    ],
    species,
  }
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/×/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export interface PublicCall {
  fn: string
  args: Record<string, unknown>
  authorization: string | null
}

export interface FakePublicCatalog {
  readonly fetch: ReturnType<typeof vi.fn<typeof fetch>>
  readonly calls: PublicCall[]
  readonly unexpected: string[]
  data: { genera: FakeGenus[]; species: FakeSpecies[] }
  /** Si no es null, cada llamada falla así: «offline» (fetch rechaza) o un estado HTTP. */
  failure: 'offline' | number | null
}

export function fakePublicCatalog(): FakePublicCatalog {
  const state: FakePublicCatalog = {
    fetch: vi.fn<typeof fetch>(),
    calls: [],
    unexpected: [],
    data: fakeCatalog(),
    failure: null,
  }
  const genusOf = (genusId: string) =>
    state.data.genera.find((genus) => genus.id === genusId)
  const sorted = <T>(items: T[], name: (item: T) => string) =>
    [...items].sort((a, b) => {
      const x = normalize(name(a))
      const y = normalize(name(b))
      return x < y ? -1 : x > y ? 1 : 0
    })

  function respond(fn: string, args: Record<string, unknown>): Response {
    switch (fn) {
      case 'search_public_species': {
        const query = normalize(String(args.query))
        const max = Number(args.max_results ?? 10)
        const rows = []
        for (const species of state.data.species) {
          const names: [string, string][] = [
            [species.scientific_name, 'scientific'],
            ...species.synonyms.map((name): [string, string] => [
              name,
              'synonym',
            ]),
            ...species.common_names.map(({ name }): [string, string] => [
              name,
              'common',
            ]),
          ]
          const hit = names.find(([name]) => normalize(name).includes(query))
          if (hit === undefined) continue
          rows.push({
            id: species.id,
            scientific_name: species.scientific_name,
            genus_id: species.genus_id,
            genus_name: genusOf(species.genus_id)?.name ?? '',
            type: species.type,
            matched_name: hit[0],
            matched_name_type: hit[1],
            reference_thumbnail: thumbnailOf(species.reference_photo),
          })
        }
        return json(rows.slice(0, max))
      }
      case 'list_public_genera': {
        const size = Number(args.page_size ?? 100)
        const genera = sorted(
          state.data.genera.filter((genus) =>
            state.data.species.some((s) => s.genus_id === genus.id),
          ),
          (genus) => genus.name,
        )
        const pages = Math.max(1, Math.ceil(genera.length / size))
        const page = Math.min(pages, Math.max(1, Number(args.page_number)))
        return json(
          genera.slice((page - 1) * size, page * size).map((genus) => ({
            id: genus.id,
            name: genus.name,
            species_count: state.data.species.filter(
              (s) => s.genus_id === genus.id,
            ).length,
            total_count: genera.length,
            current_page: page,
          })),
        )
      }
      case 'list_public_genus_species': {
        const genus = genusOf(String(args.target_genus_id))
        const size = Number(args.page_size ?? 50)
        const species = sorted(
          state.data.species.filter((s) => s.genus_id === genus?.id),
          (s) => s.scientific_name,
        )
        if (genus === undefined || species.length === 0) return json([])
        const pages = Math.ceil(species.length / size)
        const page = Math.min(pages, Math.max(1, Number(args.page_number)))
        return json(
          species.slice((page - 1) * size, page * size).map((s) => ({
            id: s.id,
            scientific_name: s.scientific_name,
            type: s.type,
            genus_id: genus.id,
            genus_name: genus.name,
            total_count: species.length,
            current_page: page,
            reference_thumbnail: thumbnailOf(s.reference_photo),
          })),
        )
      }
      case 'get_public_species': {
        const species = state.data.species.find(
          (s) => s.id === args.target_species_id,
        )
        if (species === undefined) return json([])
        return json([
          {
            id: species.id,
            scientific_name: species.scientific_name,
            genus_id: species.genus_id,
            genus_name: genusOf(species.genus_id)?.name ?? '',
            type: species.type,
            source: species.source,
            source_ref:
              species.source === 'col' || species.source === 'gbif'
                ? species.source_ref
                : null,
            synonyms: species.synonyms,
            synonym_count: species.synonym_count ?? species.synonyms.length,
            common_names: species.common_names,
            common_name_count: species.common_names.length,
            reference_photo: species.reference_photo ?? null,
          },
        ])
      }
      default:
        return json({ message: `Sin simular: ${fn}` }, 501)
    }
  }

  state.fetch.mockImplementation((input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const match = /^\/rest\/v1\/rpc\/(.+)$/.exec(url.pathname)
    const headers = new Headers(init?.headers)
    if (match === null) {
      state.unexpected.push(url.toString())
      return Promise.resolve(json({}, 501))
    }
    const fn = match[1] ?? ''
    const args =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {}
    state.calls.push({
      fn,
      args,
      authorization: headers.get('Authorization'),
    })
    if (state.failure === 'offline') {
      return Promise.reject(new TypeError('Failed to fetch'))
    }
    if (typeof state.failure === 'number') {
      return Promise.resolve(json({ message: 'fallo' }, state.failure))
    }
    const response = respond(fn, args)
    if (response.status === 501) state.unexpected.push(fn)
    return Promise.resolve(response)
  })
  return state
}
