import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CATALOG_ADMIN_ERROR_TEXT,
  CatalogAdminError,
  catalogAdminFailure,
  countSpeciesPlants,
  getCatalogSummary,
  getGenus,
  getSpeciesDetail,
  listCatalogGenera,
  listCatalogSpecies,
  searchCatalogSpecies,
} from './catalogAdmin.ts'
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

const GENUS_ID = '22222222-2222-4222-8222-222222222222'
const SPECIES_ID = '11111111-1111-4111-8111-111111111111'

const LIST_ROW = {
  id: SPECIES_ID,
  scientific_name: 'Phalaenopsis amabilis',
  genus_id: GENUS_ID,
  genus_name: 'Phalaenopsis',
  type: 'species',
  status: 'validated',
  source: 'col',
  source_ref: '4FR2J',
  synonym_count: 3,
  common_name_count: 1,
  created_at: '2026-11-20T14:37:00+00:00',
  updated_at: '2026-11-21T08:15:00+00:00',
  total_count: 32464,
  has_previous: true,
  has_next: true,
}

const SEARCH_ROW = {
  ...LIST_ROW,
  source_ref: null,
  matched_name: 'Phalaenopsis grandiflora',
  matched_name_type: 'synonym',
  total_count: 120,
  current_page: 3,
  has_previous: undefined,
  has_next: undefined,
}

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

const fetchMock = vi.fn<typeof fetch>()

function lastRequest() {
  const [input, init] = fetchMock.mock.calls.at(-1) ?? []
  return {
    url: input instanceof Request ? input.url : String(input),
    method: init?.method,
    body:
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as unknown)
        : undefined,
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  setSessionTokenSource(null)
  initSupabase(CONFIG)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  setSessionTokenSource(null)
})

describe('listCatalogSpecies', () => {
  it('pide la primera página con los filtros y convierte las filas', async () => {
    fetchMock.mockImplementation(() => jsonResponse([LIST_ROW]))
    const page = await listCatalogSpecies({
      filters: { status: 'validated', genusId: GENUS_ID, source: 'col' },
    })
    const request = lastRequest()
    expect(request.url).toBe(
      'https://ejemplo.supabase.co/rest/v1/rpc/list_catalog_species',
    )
    expect(request.method).toBe('POST')
    expect(request.body).toEqual({
      filter_status: 'validated',
      filter_genus_id: GENUS_ID,
      filter_source: 'col',
      page_size: 50,
    })
    expect(page).toEqual({
      total: 32464,
      hasPrevious: true,
      hasNext: true,
      rows: [
        {
          id: SPECIES_ID,
          scientificName: 'Phalaenopsis amabilis',
          genusId: GENUS_ID,
          genusName: 'Phalaenopsis',
          type: 'species',
          status: 'validated',
          source: 'col',
          sourceRef: '4FR2J',
          synonymCount: 3,
          commonNameCount: 1,
          createdAt: '2026-11-20T14:37:00+00:00',
          updatedAt: '2026-11-21T08:15:00+00:00',
        },
      ],
    })
  })

  it('traduce el cursor a after_id, before_id o last_page', async () => {
    fetchMock.mockImplementation(() => jsonResponse([]))
    await listCatalogSpecies({ cursor: { kind: 'after', id: SPECIES_ID } })
    expect(lastRequest().body).toEqual({ page_size: 50, after_id: SPECIES_ID })
    await listCatalogSpecies({ cursor: { kind: 'before', id: SPECIES_ID } })
    expect(lastRequest().body).toEqual({ page_size: 50, before_id: SPECIES_ID })
    await listCatalogSpecies({ cursor: { kind: 'last' } })
    expect(lastRequest().body).toEqual({ page_size: 50, last_page: true })
  })

  it('sin filas, total cero y sin más páginas', async () => {
    fetchMock.mockImplementation(() => jsonResponse([]))
    await expect(listCatalogSpecies()).resolves.toEqual({
      rows: [],
      total: 0,
      hasPrevious: false,
      hasNext: false,
    })
  })
})

describe('searchCatalogSpecies', () => {
  it('envía la consulta recortada, los filtros y la página', async () => {
    fetchMock.mockImplementation(() => jsonResponse([SEARCH_ROW]))
    const page = await searchCatalogSpecies('  phal amab ', {
      filters: { type: 'hybrid' },
      page: 3,
    })
    expect(lastRequest().url).toBe(
      'https://ejemplo.supabase.co/rest/v1/rpc/search_catalog_species',
    )
    expect(lastRequest().body).toEqual({
      query: 'phal amab',
      filter_type: 'hybrid',
      page_size: 50,
      page_number: 3,
    })
    expect(page.total).toBe(120)
    expect(page.page).toBe(3)
    expect(page.rows[0]).toMatchObject({
      sourceRef: null,
      matchedName: 'Phalaenopsis grandiflora',
      matchedNameType: 'synonym',
    })
  })

  it('no pide nada con una consulta demasiado corta', async () => {
    await expect(searchCatalogSpecies(' p ')).resolves.toEqual({
      rows: [],
      total: 0,
      page: 1,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('géneros, resumen, detalle y plantas', () => {
  it('listCatalogGenera', async () => {
    fetchMock.mockImplementation(() =>
      jsonResponse([
        {
          id: GENUS_ID,
          name: 'Phalaenopsis',
          is_quick_access: true,
          abbreviations: ['Phal.'],
          species_count: 92,
          total_count: 755,
          current_page: 2,
        },
      ]),
    )
    const page = await listCatalogGenera({
      query: ' phal ',
      quickAccessOnly: true,
      page: 2,
    })
    expect(lastRequest().body).toEqual({
      query: 'phal',
      quick_access_only: true,
      page_size: 50,
      page_number: 2,
    })
    expect(page).toEqual({
      total: 755,
      page: 2,
      rows: [
        {
          id: GENUS_ID,
          name: 'Phalaenopsis',
          isQuickAccess: true,
          abbreviations: ['Phal.'],
          speciesCount: 92,
        },
      ],
    })
  })

  it('getCatalogSummary', async () => {
    fetchMock.mockImplementation(() =>
      jsonResponse([
        {
          genus_count: 755,
          species_count: 31056,
          hybrid_count: 1408,
          synonym_count: 60000,
          common_name_count: 0,
          imported_count: 32464,
          validated_count: 0,
          observed_count: 0,
          col_source_count: 32464,
          curated_source_count: 0,
          user_proposal_source_count: 0,
          gbif_source_count: 0,
        },
      ]),
    )
    await expect(getCatalogSummary()).resolves.toEqual({
      genusCount: 755,
      speciesCount: 31056,
      hybridCount: 1408,
      synonymCount: 60000,
      commonNameCount: 0,
      byStatus: { imported: 32464, validated: 0, observed: 0 },
      bySource: { col: 32464, curated: 0, user_proposal: 0, gbif: 0 },
    })
    expect(lastRequest().url).toBe(
      'https://ejemplo.supabase.co/rest/v1/rpc/catalog_summary',
    )
  })

  it('getSpeciesDetail lee la especie con su género y sus nombres, ordenados', async () => {
    fetchMock.mockImplementation(() =>
      jsonResponse({
        id: SPECIES_ID,
        scientific_name: 'Phalaenopsis amabilis',
        genus_id: GENUS_ID,
        type: 'species',
        status: 'imported',
        source: 'col',
        source_ref: '4FR2J',
        created_at: '2026-11-20T14:37:00+00:00',
        updated_at: '2026-11-21T08:15:00+00:00',
        genera: { name: 'Phalaenopsis' },
        species_names: [
          {
            id: 'n2',
            name: 'orquídea mariposa',
            type: 'common',
            language: 'es',
          },
          {
            id: 'n1',
            name: 'Epidendrum amabile',
            type: 'synonym',
            language: null,
          },
        ],
      }),
    )
    const detail = await getSpeciesDetail(SPECIES_ID)
    const url = new URL(lastRequest().url)
    expect(url.pathname).toBe('/rest/v1/species')
    expect(url.searchParams.get('id')).toBe(`eq.${SPECIES_ID}`)
    expect(url.searchParams.get('select')).toContain('species_names(')
    expect(detail?.genusName).toBe('Phalaenopsis')
    expect(detail?.names.map((name) => name.name)).toEqual([
      'Epidendrum amabile',
      'orquídea mariposa',
    ])
  })

  it('getSpeciesDetail devuelve null si no existe', async () => {
    fetchMock.mockImplementation(() => jsonResponse(null))
    await expect(getSpeciesDetail(SPECIES_ID)).resolves.toBeNull()
  })

  it('countSpeciesPlants envía el id y devuelve el número', async () => {
    fetchMock.mockImplementation(() => jsonResponse(3))
    await expect(countSpeciesPlants(SPECIES_ID)).resolves.toBe(3)
    expect(lastRequest().body).toEqual({ target_species_id: SPECIES_ID })
  })

  it('getGenus', async () => {
    fetchMock.mockImplementation(() =>
      jsonResponse({ id: GENUS_ID, name: 'Phalaenopsis' }),
    )
    await expect(getGenus(GENUS_ID)).resolves.toEqual({
      id: GENUS_ID,
      name: 'Phalaenopsis',
    })
  })
})

describe('errores', () => {
  async function failureOf(promise: Promise<unknown>) {
    try {
      await promise
    } catch (error) {
      return catalogAdminFailure(error)
    }
    throw new Error('no falló')
  }

  it('42501 de la base: sin permiso de administrador', async () => {
    fetchMock.mockImplementation(() =>
      jsonResponse(
        {
          code: '42501',
          message: 'Solo un administrador del catálogo puede hacer esto.',
        },
        403,
      ),
    )
    await expect(failureOf(listCatalogSpecies())).resolves.toBe('forbidden')
  })

  it('401: la sesión terminó', async () => {
    fetchMock.mockImplementation(() =>
      jsonResponse({ code: 'PGRST303', message: 'JWT expired' }, 401),
    )
    await expect(failureOf(getCatalogSummary())).resolves.toBe('session-ended')
  })

  it('sin respuesta y sin conexión: offline; con conexión: failed', async () => {
    fetchMock.mockImplementation(() =>
      Promise.reject(new TypeError('Failed to fetch')),
    )
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await expect(failureOf(listCatalogGenera())).resolves.toBe('offline')
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    await expect(failureOf(listCatalogGenera())).resolves.toBe('failed')
  })

  it('error del servidor: failed', async () => {
    fetchMock.mockImplementation(() =>
      jsonResponse({ code: 'XX000', message: 'internal error' }, 500),
    )
    await expect(failureOf(countSpeciesPlants(SPECIES_ID))).resolves.toBe(
      'failed',
    )
  })

  it('sin el token de una sesión iniciada por falta de conexión: offline', async () => {
    setSessionTokenSource(() =>
      Promise.reject(new SessionTokenError('offline')),
    )
    await expect(failureOf(listCatalogSpecies())).resolves.toBe('offline')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cancelada: aborted, sin pedir nada si ya lo estaba', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      failureOf(listCatalogSpecies({ signal: controller.signal })),
    ).resolves.toBe('aborted')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cancelada a mitad de la petición: aborted', async () => {
    fetchMock.mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(
              new DOMException('The operation was aborted.', 'AbortError'),
            ),
          )
        }),
    )
    const controller = new AbortController()
    const promise = searchCatalogSpecies('phal', { signal: controller.signal })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    controller.abort()
    await expect(failureOf(promise)).resolves.toBe('aborted')
  })

  it('el mensaje del error es el texto de su motivo', () => {
    const error = new CatalogAdminError('offline')
    expect(error.message).toBe(CATALOG_ADMIN_ERROR_TEXT.offline)
    expect(catalogAdminFailure(new Error('otro'))).toBe('failed')
  })
})
