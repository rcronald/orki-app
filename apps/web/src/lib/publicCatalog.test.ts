import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CatalogSearchError } from './catalogSearch.ts'
import {
  getPublicSpecies,
  isCatalogId,
  listAllPublicGenera,
  listPublicGenusSpecies,
  PUBLIC_GENERA_PAGE_SIZE,
  searchPublicSpecies,
} from './publicCatalog.ts'
import {
  initSupabase,
  SessionTokenError,
  setSessionTokenSource,
} from './supabase.ts'

// Capa de datos del catálogo público (#232): qué función se llama, con qué
// parámetros, sin token aunque haya sesión, y cómo se traducen las filas y los
// errores.

const CONFIG = {
  supabaseUrl: 'https://ejemplo.supabase.co',
  supabasePublishableKey: 'sb_publishable_clave_de_prueba',
  appEnv: 'dev',
  clerkPublishableKey: 'pk_test_clave_de_prueba',
} as const

const SPECIES_ID = '11111111-1111-4111-8111-111111111111'
const GENUS_ID = '22222222-2222-4222-8222-222222222222'

const fetchMock = vi.fn<typeof fetch>()

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

function sent() {
  return fetchMock.mock.calls.map(([input, init]) => ({
    url: input instanceof Request ? input.url : String(input),
    body:
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined,
    headers: new Headers(init?.headers),
  }))
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(() => jsonResponse([]))
  vi.stubGlobal('fetch', fetchMock)
  setSessionTokenSource(null)
  initSupabase(CONFIG)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  setSessionTokenSource(null)
})

describe('isCatalogId', () => {
  it('solo acepta uuid', () => {
    expect(isCatalogId(SPECIES_ID)).toBe(true)
    expect(isCatalogId(SPECIES_ID.toUpperCase())).toBe(true)
    expect(isCatalogId('phalaenopsis')).toBe(false)
    expect(isCatalogId(`${SPECIES_ID}x`)).toBe(false)
    expect(isCatalogId(undefined)).toBe(false)
  })
})

describe('searchPublicSpecies', () => {
  it('llama a search_public_species sin token, aunque haya sesión', async () => {
    const source = vi.fn(() => Promise.resolve('token_de_sesion'))
    setSessionTokenSource(source)
    fetchMock.mockImplementation(() =>
      jsonResponse([
        {
          id: SPECIES_ID,
          scientific_name: 'Cattleya purpurata',
          genus_id: GENUS_ID,
          genus_name: 'Cattleya',
          type: 'species',
          matched_name: 'Laelia purpurata',
          matched_name_type: 'synonym',
        },
      ]),
    )

    const results = await searchPublicSpecies('  laelia purp ')

    const [request] = sent()
    expect(request?.url).toBe(
      `${CONFIG.supabaseUrl}/rest/v1/rpc/search_public_species`,
    )
    expect(request?.body).toEqual({ query: 'laelia purp', max_results: 15 })
    expect(request?.headers.get('Authorization')).toBe(
      `Bearer ${CONFIG.supabasePublishableKey}`,
    )
    expect(source).not.toHaveBeenCalled()
    expect(results).toEqual([
      {
        id: SPECIES_ID,
        scientificName: 'Cattleya purpurata',
        genusId: GENUS_ID,
        genusName: 'Cattleya',
        type: 'species',
        matchedName: 'Laelia purpurata',
        matchedNameType: 'synonym',
      },
    ])
  })

  it('aunque el token de la sesión no se pueda obtener, busca', async () => {
    setSessionTokenSource(() =>
      Promise.reject(new SessionTokenError('offline')),
    )
    await expect(searchPublicSpecies('phal')).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('no pide más de 15 resultados', async () => {
    await searchPublicSpecies('phal', { maxResults: 50 })
    expect(sent()[0]?.body?.max_results).toBe(15)
  })

  it.each(['', 'p', ' p ', 'a'.repeat(101)])(
    'no hace ninguna petición con %j',
    async (query) => {
      await expect(searchPublicSpecies(query)).resolves.toEqual([])
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('sin conexión, el error es offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    fetchMock.mockImplementation(() =>
      Promise.reject(new TypeError('Failed to fetch')),
    )
    const error = await searchPublicSpecies('phal').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CatalogSearchError)
    expect((error as CatalogSearchError).reason).toBe('offline')
  })

  it('un error del servidor es failed', async () => {
    fetchMock.mockImplementation(() =>
      jsonResponse({ code: '57014', message: 'canceling statement' }, 500),
    )
    const error = await searchPublicSpecies('phal').catch((e: unknown) => e)
    expect((error as CatalogSearchError).reason).toBe('failed')
  })
})

describe('listAllPublicGenera', () => {
  function genusRow(n: number, total: number, page: number) {
    return {
      id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      name: `Género ${n}`,
      species_count: n,
      total_count: total,
      current_page: page,
    }
  }

  it('pide la primera página y, con el total, las demás a la vez', async () => {
    const total = PUBLIC_GENERA_PAGE_SIZE * 3 + 5
    fetchMock.mockImplementation((_input, init) => {
      const { page_number: page } = JSON.parse(String(init?.body)) as {
        page_number: number
      }
      const start = (page - 1) * PUBLIC_GENERA_PAGE_SIZE
      const size = Math.min(PUBLIC_GENERA_PAGE_SIZE, total - start)
      return jsonResponse(
        Array.from({ length: size }, (_, i) =>
          genusRow(start + i + 1, total, page),
        ),
      )
    })

    const genera = await listAllPublicGenera()

    expect(sent().map((request) => request.body)).toEqual([
      { page_size: 200, page_number: 1 },
      { page_size: 200, page_number: 2 },
      { page_size: 200, page_number: 3 },
      { page_size: 200, page_number: 4 },
    ])
    expect(sent()[0]?.url).toContain('/rest/v1/rpc/list_public_genera')
    expect(genera).toHaveLength(total)
    expect(genera[0]).toEqual({
      id: genusRow(1, total, 1).id,
      name: 'Género 1',
      speciesCount: 1,
    })
  })

  it('sin géneros, una sola petición y una lista vacía', async () => {
    await expect(listAllPublicGenera()).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

describe('listPublicGenusSpecies', () => {
  it('devuelve la página con su total y su número', async () => {
    fetchMock.mockImplementation(() =>
      jsonResponse([
        {
          id: SPECIES_ID,
          scientific_name: 'Cattleya maxima',
          type: 'species',
          genus_id: GENUS_ID,
          genus_name: 'Cattleya',
          total_count: 120,
          current_page: 3,
        },
      ]),
    )
    const page = await listPublicGenusSpecies(GENUS_ID, 7)

    expect(sent()[0]?.body).toEqual({
      target_genus_id: GENUS_ID,
      page_size: 50,
      page_number: 7,
    })
    expect(page).toEqual({
      genus: { id: GENUS_ID, name: 'Cattleya' },
      species: [
        { id: SPECIES_ID, scientificName: 'Cattleya maxima', type: 'species' },
      ],
      total: 120,
      page: 3,
      pageCount: 3,
    })
  })

  it('sin filas, el género no existe (null)', async () => {
    await expect(listPublicGenusSpecies(GENUS_ID, 1)).resolves.toBeNull()
  })

  it('con un id que no es un uuid, null sin pedir nada', async () => {
    await expect(listPublicGenusSpecies('cattleya', 1)).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('una página no válida se pide como la 1', async () => {
    await listPublicGenusSpecies(GENUS_ID, Number.NaN)
    expect(sent()[0]?.body?.page_number).toBe(1)
  })
})

describe('getPublicSpecies', () => {
  it('devuelve la ficha con sus nombres y la fuente', async () => {
    fetchMock.mockImplementation(() =>
      jsonResponse([
        {
          id: SPECIES_ID,
          scientific_name: 'Phalaenopsis amabilis',
          genus_id: GENUS_ID,
          genus_name: 'Phalaenopsis',
          type: 'species',
          source: 'col',
          source_ref: '5T6MX',
          synonyms: ['Phalaenopsis grandiflora'],
          synonym_count: 140,
          common_names: [
            { name: 'Orquídea luna', language: 'es' },
            { name: 'Moon orchid', language: null },
            { idioma: 'roto' },
          ],
          common_name_count: 2,
        },
      ]),
    )
    const species = await getPublicSpecies(SPECIES_ID)

    expect(sent()[0]?.url).toContain('/rest/v1/rpc/get_public_species')
    expect(sent()[0]?.body).toEqual({ target_species_id: SPECIES_ID })
    expect(species).toEqual({
      id: SPECIES_ID,
      scientificName: 'Phalaenopsis amabilis',
      genus: { id: GENUS_ID, name: 'Phalaenopsis' },
      type: 'species',
      source: 'col',
      sourceRef: '5T6MX',
      synonyms: ['Phalaenopsis grandiflora'],
      synonymCount: 140,
      commonNames: [
        { name: 'Orquídea luna', language: 'es' },
        { name: 'Moon orchid', language: null },
      ],
      commonNameCount: 2,
    })
  })

  it('una especie que no existe o no es pública es null', async () => {
    await expect(getPublicSpecies(SPECIES_ID)).resolves.toBeNull()
  })

  it('con un id que no es un uuid, null sin pedir nada', async () => {
    await expect(getPublicSpecies('no-es-un-id')).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
