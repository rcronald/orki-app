import { createClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../lib/database.ts'
import { CATTLEYA, plant } from '../test/collection.ts'
import { createExtrasFetcher } from './extras-source.ts'

// Simula PostgREST sobre species_names y genus_abbreviations en memoria:
// aplica el filtro in.(…), id=gt., el orden por id y el limit.

const fetchMock = vi.fn<typeof fetch>()
let speciesNames: {
  id: string
  species_id: string
  name: string
  type: 'synonym' | 'common'
}[] = []
let abbreviations: { id: string; genus_id: string; abbreviation: string }[] = []

function parseIn(value: string | null): string[] {
  if (value === null) return []
  return value
    .replace(/^in\.\(/, '')
    .replace(/\)$/, '')
    .split(',')
    .map((item) => item.replace(/^"|"$/g, ''))
}

function respond(input: string | URL | Request): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input))
  const after = url.searchParams.get('id')?.replace(/^gt\./, '') ?? null
  const limit = Number(url.searchParams.get('limit') ?? Infinity)
  const table = url.pathname.endsWith('/species_names')
    ? speciesNames.filter((row) =>
        parseIn(url.searchParams.get('species_id')).includes(row.species_id),
      )
    : abbreviations.filter((row) =>
        parseIn(url.searchParams.get('genus_id')).includes(row.genus_id),
      )
  const rows = table
    .filter((row) => after === null || row.id > after)
    .toSorted((a, b) => (a.id < b.id ? -1 : 1))
    .slice(0, limit)
  return Promise.resolve(
    new Response(JSON.stringify(rows), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

// Con accessToken, como el de la app: sin Supabase Auth.
const sharedClient = createClient<Database>(
  'https://ejemplo.supabase.co',
  'sb_publishable_x',
  { accessToken: () => Promise.resolve(null) },
)
const client = () => Promise.resolve(sharedClient)

beforeEach(() => {
  speciesNames = []
  abbreviations = []
  fetchMock.mockReset()
  fetchMock.mockImplementation(respond)
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const signal = () => new AbortController().signal

describe('extras de la colección para "¿Ya la tengo?"', () => {
  it('trae sinónimos, nombres comunes y abreviaturas de sus especies y géneros', async () => {
    speciesNames = [
      {
        id: 'n1',
        species_id: 'species-amabilis',
        name: 'Phalaenopsis grandiflora',
        type: 'synonym',
      },
      {
        id: 'n2',
        species_id: 'species-amabilis',
        name: 'Orquídea mariposa',
        type: 'common',
      },
      { id: 'n3', species_id: 'otra', name: 'Ajena', type: 'common' },
    ]
    abbreviations = [
      { id: 'a1', genus_id: 'genus-phal', abbreviation: 'Phal.' },
      { id: 'a2', genus_id: CATTLEYA.id, abbreviation: 'C.' },
    ]
    const fetchExtras = createExtrasFetcher(client)
    const extras = await fetchExtras(
      [plant(), plant({ species: null, genus: CATTLEYA })],
      signal(),
    )
    expect(extras.speciesNames?.get('species-amabilis')).toEqual([
      { name: 'Phalaenopsis grandiflora', type: 'synonym' },
      { name: 'Orquídea mariposa', type: 'common' },
    ])
    expect(extras.speciesNames?.has('otra')).toBe(false)
    expect(extras.genusAbbreviations?.get('genus-phal')).toEqual(['Phal.'])
    expect(extras.genusAbbreviations?.get(CATTLEYA.id)).toEqual(['C.'])
  })

  it('sin plantas no pide nada', async () => {
    const extras = await createExtrasFetcher(client)([], signal())
    expect(fetchMock).not.toHaveBeenCalled()
    expect(extras.speciesNames?.size).toBe(0)
  })

  it('pide los ids en grupos para no alargar la dirección', async () => {
    const plants = Array.from({ length: 120 }, (_, index) =>
      plant({
        species: {
          id: `species-${String(index).padStart(3, '0')}`,
          scientificName: `Especie ${index}`,
          type: 'species',
          status: 'validated',
        },
      }),
    )
    await createExtrasFetcher(client)(plants, signal())
    const urls = fetchMock.mock.calls.map(
      ([input]) =>
        new URL(input instanceof Request ? input.url : String(input)),
    )
    const nameRequests = urls.filter((url) =>
      url.pathname.endsWith('/species_names'),
    )
    expect(nameRequests).toHaveLength(3)
    for (const url of urls) expect(url.href.length).toBeLessThan(2500)
  })

  it('pagina por id cuando hay más filas que el tope de la API', async () => {
    speciesNames = Array.from({ length: 1500 }, (_, index) => ({
      id: `n${String(index).padStart(5, '0')}`,
      species_id: 'species-amabilis',
      name: `Sinónimo ${index}`,
      type: 'synonym' as const,
    }))
    const extras = await createExtrasFetcher(client)([plant()], signal())
    expect(extras.speciesNames?.get('species-amabilis')).toHaveLength(1500)
  })

  it('rechaza si el servidor falla', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'fallo' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    await expect(
      createExtrasFetcher(client)([plant()], signal()),
    ).rejects.toBeDefined()
  })

  it('pide todos los grupos a la vez, no uno tras otro (#169)', async () => {
    // Con temporizadores falsos, las consultas siguen en curso hasta que la
    // prueba adelanta el reloj: todas las que vayan a empezar a la vez lo han
    // hecho antes, por cargado que esté el equipo (#295).
    vi.useFakeTimers()
    let enCurso = 0
    let maximo = 0
    fetchMock.mockImplementation(async (input) => {
      enCurso += 1
      maximo = Math.max(maximo, enCurso)
      await new Promise((resolve) => setTimeout(resolve, 5))
      enCurso -= 1
      return respond(input)
    })
    const plants = Array.from({ length: 120 }, (_, index) =>
      plant({
        id: `p${index}`,
        species: {
          id: `sp-${index}`,
          scientificName: `Especie ${index}`,
          type: 'species',
          status: 'validated',
        },
      }),
    )

    const pending = createExtrasFetcher(client)(plants, signal())
    await vi.runAllTimersAsync()
    await pending

    // 120 especies son 3 grupos de sinónimos, más el de las abreviaturas.
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(maximo).toBe(4)
  })
})
