import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CATALOG_SEARCH_ERROR_TEXT,
  CatalogSearchError,
  catalogSearchFailure,
  genusMatchText,
  prepareSearchQuery,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_QUERY_MIN_LENGTH,
  searchGenera,
  searchSpecies,
  speciesMatchText,
} from './catalogSearch.ts'
import {
  initSupabase,
  SessionTokenError,
  setSessionTokenSource,
} from './supabase.ts'

const CONFIG = {
  supabaseUrl: 'https://ejemplo.supabase.co',
  supabasePublishableKey: 'sb_publishable_clave_de_prueba',
  appEnv: 'dev',
  clerkPublishableKey: 'pk_test_clave_de_prueba',
} as const

const TOKEN = 'token_de_sesion_de_prueba'

const SPECIES_ROW = {
  id: '11111111-1111-1111-1111-111111111111',
  scientific_name: 'Phalaenopsis amabilis',
  genus_id: '22222222-2222-2222-2222-222222222222',
  genus_name: 'Phalaenopsis',
  type: 'species',
  status: 'validated',
  matched_name: 'Phalaenopsis grandiflora',
  matched_name_type: 'synonym',
}

const GENUS_ROWS = [
  {
    id: '22222222-2222-2222-2222-222222222222',
    name: 'Phalaenopsis',
    is_quick_access: true,
    matched_abbreviation: 'Phal.',
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    name: 'Phragmipedium',
    is_quick_access: false,
    matched_abbreviation: null,
  },
]

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

// Simula la API de Supabase, como en supabase.test.ts.
const fetchMock = vi.fn<typeof fetch>()

interface SentRequest {
  url: string
  method: string | undefined
  body: unknown
  headers: Headers
}

function sentRequests(): SentRequest[] {
  return fetchMock.mock.calls.map(([input, init]) => ({
    url: input instanceof Request ? input.url : String(input),
    method: init?.method,
    body:
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as unknown)
        : undefined,
    headers: new Headers(init?.headers),
  }))
}

// Respuesta que no llega hasta que se cancela la petición, como fetch.
function hangUntilAborted(
  _input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    })
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(() => jsonResponse([SPECIES_ROW]))
  vi.stubGlobal('fetch', fetchMock)
  setSessionTokenSource(null)
  initSupabase(CONFIG)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  setSessionTokenSource(null)
})

describe('prepareSearchQuery', () => {
  it('recorta y aplica los límites de longitud de la base', () => {
    expect(SEARCH_QUERY_MIN_LENGTH).toBe(2)
    expect(SEARCH_QUERY_MAX_LENGTH).toBe(100)
    expect(prepareSearchQuery('  phal amab  ')).toBe('phal amab')
    expect(prepareSearchQuery('ph')).toBe('ph')
    expect(prepareSearchQuery(' p ')).toBeNull()
    expect(prepareSearchQuery('   ')).toBeNull()
    expect(prepareSearchQuery('a'.repeat(100))).toBe('a'.repeat(100))
    expect(prepareSearchQuery('a'.repeat(101))).toBeNull()
    // Cuenta caracteres, no unidades de UTF-16, como char_length.
    expect(prepareSearchQuery('🌸'.repeat(100))).toBe('🌸'.repeat(100))
  })
})

describe('searchSpecies', () => {
  it('llama a search_species con la consulta recortada y el número de resultados', async () => {
    const results = await searchSpecies('  phal amab ')

    const [request] = sentRequests()
    expect(request?.url).toBe(
      `${CONFIG.supabaseUrl}/rest/v1/rpc/search_species`,
    )
    expect(request?.method).toBe('POST')
    expect(request?.body).toEqual({ query: 'phal amab', max_results: 10 })
    expect(results).toEqual([
      {
        id: SPECIES_ROW.id,
        scientificName: 'Phalaenopsis amabilis',
        genusId: SPECIES_ROW.genus_id,
        genusName: 'Phalaenopsis',
        type: 'species',
        status: 'validated',
        matchedName: 'Phalaenopsis grandiflora',
        matchedNameType: 'synonym',
      },
    ])
  })

  it.each([
    [5, 5],
    [50, 20],
    [0, 1],
    [-3, 1],
    [7.9, 7],
    [Number.NaN, 10],
  ])('con maxResults %s pide %s resultados', async (asked, sent) => {
    await searchSpecies('phal', { maxResults: asked })
    expect(sentRequests()[0]?.body).toEqual({
      query: 'phal',
      max_results: sent,
    })
  })

  it.each(['', ' ', 'p', ' p ', 'a'.repeat(101)])(
    'no hace ninguna petición con la consulta %j',
    async (query) => {
      await expect(searchSpecies(query)).resolves.toEqual([])
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('sin sesión, funciona con la clave publicable', async () => {
    await expect(searchSpecies('phal')).resolves.toHaveLength(1)

    const [request] = sentRequests()
    expect(request?.headers.get('apikey')).toBe(CONFIG.supabasePublishableKey)
    expect(request?.headers.get('Authorization')).not.toContain(TOKEN)
  })

  it('con sesión, lleva el token como cualquier otra petición', async () => {
    setSessionTokenSource(() => Promise.resolve(TOKEN))
    await searchSpecies('phal')

    expect(sentRequests()[0]?.headers.get('Authorization')).toBe(
      `Bearer ${TOKEN}`,
    )
  })

  it('una lista vacía es un resultado, no un error', async () => {
    fetchMock.mockImplementation(() => jsonResponse([]))
    await expect(searchSpecies('stanhopea')).resolves.toEqual([])
  })

  it('cancela la petición en curso con el AbortSignal', async () => {
    fetchMock.mockImplementation(hangUntilAborted)
    const controller = new AbortController()
    const pending = searchSpecies('phal', { signal: controller.signal })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(init?.signal).toBeDefined()

    controller.abort()
    const error: unknown = await pending.catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CatalogSearchError)
    expect(catalogSearchFailure(error)).toBe('aborted')
  })

  it('con la señal ya cancelada no hace ninguna petición', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      searchSpecies('phal', { signal: controller.signal }),
    ).rejects.toMatchObject({ reason: 'aborted' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sin conexión, el error es "offline"', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(searchSpecies('phal')).rejects.toMatchObject({
      reason: 'offline',
      message: CATALOG_SEARCH_ERROR_TEXT.offline,
    })
  })

  it('con conexión, un fallo de red es "failed"', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(searchSpecies('phal')).rejects.toMatchObject({
      reason: 'failed',
      message: CATALOG_SEARCH_ERROR_TEXT.failed,
    })
  })

  it('un error del servidor es "failed"', async () => {
    fetchMock.mockImplementation(() =>
      jsonResponse({ message: 'internal error', code: 'XX000' }, 500),
    )

    await expect(searchSpecies('phal')).rejects.toMatchObject({
      reason: 'failed',
    })
  })

  it('con sesión y sin conexión para pedir el token, el error es "offline"', async () => {
    setSessionTokenSource(() =>
      Promise.reject(new SessionTokenError('offline')),
    )

    await expect(searchSpecies('phal')).rejects.toMatchObject({
      reason: 'offline',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('searchGenera', () => {
  it('llama a search_genera y devuelve los géneros en camelCase', async () => {
    fetchMock.mockImplementation(() => jsonResponse(GENUS_ROWS))
    const results = await searchGenera('Phal.', { maxResults: 5 })

    const [request] = sentRequests()
    expect(request?.url).toBe(`${CONFIG.supabaseUrl}/rest/v1/rpc/search_genera`)
    expect(request?.body).toEqual({ query: 'Phal.', max_results: 5 })
    expect(results).toEqual([
      {
        id: GENUS_ROWS[0]?.id,
        name: 'Phalaenopsis',
        isQuickAccess: true,
        matchedAbbreviation: 'Phal.',
      },
      {
        id: GENUS_ROWS[1]?.id,
        name: 'Phragmipedium',
        isQuickAccess: false,
        matchedAbbreviation: null,
      },
    ])
  })

  it('no hace ninguna petición con menos de 2 caracteres', async () => {
    await expect(searchGenera('p')).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('distingue los mismos errores que searchSpecies', async () => {
    fetchMock.mockImplementation(() => jsonResponse({ message: 'x' }, 503))
    await expect(searchGenera('phal')).rejects.toMatchObject({
      reason: 'failed',
    })
  })
})

describe('textos de la coincidencia', () => {
  it('dice por qué nombre coincidió una especie', () => {
    expect(
      speciesMatchText({
        matchedName: 'Phalaenopsis grandiflora',
        matchedNameType: 'synonym',
      }),
    ).toBe('Sinónimo: Phalaenopsis grandiflora')
    expect(
      speciesMatchText({
        matchedName: 'Orquídea mariposa',
        matchedNameType: 'common',
      }),
    ).toBe('Nombre común: Orquídea mariposa')
    expect(
      speciesMatchText({
        matchedName: 'Phalaenopsis amabilis',
        matchedNameType: 'scientific',
      }),
    ).toBeUndefined()
  })

  it('dice por qué abreviatura coincidió un género', () => {
    expect(genusMatchText({ matchedAbbreviation: 'Phal.' })).toBe(
      'Abreviatura: Phal.',
    )
    expect(genusMatchText({ matchedAbbreviation: null })).toBeUndefined()
  })

  it('cualquier error que no es de la búsqueda cuenta como fallo', () => {
    expect(catalogSearchFailure(new Error('otro'))).toBe('failed')
  })
})
