import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  catalogWriteErrorFromDatabase,
  CatalogWriteError,
  cleanCatalogText,
  createCatalogSpecies,
  deleteCatalogSpecies,
  MAX_BATCH_SPECIES,
  setCatalogSpeciesStatus,
  toCatalogWriteError,
  updateCatalogSpecies,
} from './catalogWrites.ts'
import { CatalogAdminError } from './catalogAdmin.ts'
import { initSupabase, setSessionTokenSource } from './supabase.ts'

// Capa de escritura del backoffice con la API simulada (fetch): qué envía a
// cada función de la base y cómo traduce sus rechazos.

const CONFIG = {
  supabaseUrl: 'https://ejemplo.supabase.co',
  supabasePublishableKey: 'sb_publishable_clave_de_prueba',
  appEnv: 'dev',
  clerkPublishableKey: 'pk_test_clave_de_prueba',
} as const

const GENUS_ID = '22222222-2222-4222-8222-222222222222'
const SPECIES_ID = '11111111-1111-4111-8111-111111111111'

const SPECIES_ROW = {
  id: SPECIES_ID,
  scientific_name: 'Vanda tricolor',
  genus_id: GENUS_ID,
  type: 'species',
  status: 'validated',
  source: 'curated',
  source_ref: null,
  created_at: '2026-11-21T10:00:00+00:00',
  updated_at: '2026-11-21T10:00:00+00:00',
}

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

/** Un rechazo de una función del catálogo, como lo devuelve PostgREST. */
function rejection(
  status: number,
  code: string,
  reason: string,
  extra: Record<string, unknown> = {},
) {
  return jsonResponse(
    {
      code,
      message: 'mensaje de la base',
      details: JSON.stringify({ reason, ...extra }),
      hint: null,
    },
    status,
  )
}

const fetchMock = vi.fn<typeof fetch>()

function lastRequest() {
  const [input, init] = fetchMock.mock.calls.at(-1) ?? []
  return {
    path: new URL(
      input instanceof Request ? input.url : String(input),
    ).pathname.replace('/rest/v1/', ''),
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
})

async function failure(promise: Promise<unknown>): Promise<CatalogWriteError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(CatalogWriteError)
    return error as CatalogWriteError
  }
  throw new Error('se esperaba un error')
}

describe('cleanCatalogText', () => {
  it('recorta y une los espacios', () => {
    expect(cleanCatalogText('  Vanda \t  tricolor  ')).toBe('Vanda tricolor')
    expect(cleanCatalogText('   ')).toBe('')
  })
})

describe('especies', () => {
  it('alta: envía el nombre sin espacios sobrantes y convierte la fila', async () => {
    fetchMock.mockReturnValue(jsonResponse(SPECIES_ROW))
    const written = await createCatalogSpecies({
      scientificName: '  Vanda   tricolor ',
      genusId: GENUS_ID,
      type: 'species',
      status: 'validated',
    })
    expect(lastRequest()).toEqual({
      path: 'rpc/create_catalog_species',
      body: {
        new_scientific_name: 'Vanda tricolor',
        new_genus_id: GENUS_ID,
        new_type: 'species',
        new_status: 'validated',
      },
    })
    expect(written).toEqual({
      id: SPECIES_ID,
      scientificName: 'Vanda tricolor',
      genusId: GENUS_ID,
      type: 'species',
      status: 'validated',
      source: 'curated',
      sourceRef: null,
    })
  })

  it('alta: sin nombre o sin género no pide nada', async () => {
    const noName = await failure(
      createCatalogSpecies({
        scientificName: '  ',
        genusId: GENUS_ID,
        type: 'species',
        status: 'validated',
      }),
    )
    expect(noName.problem).toBe('name-required')
    expect(noName.field).toBe('scientificName')
    const noGenus = await failure(
      createCatalogSpecies({
        scientificName: 'Vanda tricolor',
        genusId: null,
        type: 'species',
        status: 'validated',
      }),
    )
    expect(noGenus.problem).toBe('genus-required')
    expect(noGenus.field).toBe('genus')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('edición: envía todos los campos a la vez', async () => {
    fetchMock.mockReturnValue(jsonResponse(SPECIES_ROW))
    await updateCatalogSpecies(SPECIES_ID, {
      scientificName: 'Vanda tricolor ',
      genusId: GENUS_ID,
      type: 'hybrid',
      status: 'observed',
    })
    expect(lastRequest()).toEqual({
      path: 'rpc/update_catalog_species',
      body: {
        target_species_id: SPECIES_ID,
        new_scientific_name: 'Vanda tricolor',
        new_genus_id: GENUS_ID,
        new_type: 'hybrid',
        new_status: 'observed',
      },
    })
  })

  it('nombre duplicado y casi igual: junto al nombre, con la especie que ya lo tiene', async () => {
    fetchMock.mockReturnValueOnce(
      rejection(409, '23505', 'duplicate_name', {
        existing_name: 'Cattleya labiata',
        existing_id: SPECIES_ID,
      }),
    )
    const duplicate = await failure(
      createCatalogSpecies({
        scientificName: 'cattleya LABIATA',
        genusId: GENUS_ID,
        type: 'species',
        status: 'validated',
      }),
    )
    expect(duplicate.problem).toBe('duplicate-name')
    expect(duplicate.field).toBe('scientificName')
    expect(duplicate.details.existingId).toBe(SPECIES_ID)
    expect(duplicate.message).toBe(
      'Ya hay una especie con este nombre: «Cattleya labiata». Los nombres no distinguen mayúsculas.',
    )

    fetchMock.mockReturnValueOnce(
      rejection(409, '23505', 'similar_name', {
        existing_name: 'Phalaenopsis × intermedia',
      }),
    )
    const similar = await failure(
      createCatalogSpecies({
        scientificName: 'Phalaenopsis intermedia',
        genusId: GENUS_ID,
        type: 'species',
        status: 'validated',
      }),
    )
    expect(similar.problem).toBe('similar-name')
    expect(similar.message).toBe(
      'Ya hay una especie que se escribe casi igual: «Phalaenopsis × intermedia». Solo cambian las tildes o el signo de híbrido «×».',
    )
  })

  it('género inexistente e importada: cada uno en su campo', async () => {
    fetchMock.mockReturnValueOnce(rejection(409, '23503', 'genus_not_found'))
    const genus = await failure(
      createCatalogSpecies({
        scientificName: 'Vanda tricolor',
        genusId: GENUS_ID,
        type: 'species',
        status: 'validated',
      }),
    )
    expect(genus.field).toBe('genus')
    fetchMock.mockReturnValueOnce(rejection(400, '22023', 'invalid_status'))
    const status = await failure(
      createCatalogSpecies({
        scientificName: 'Vanda tricolor',
        genusId: GENUS_ID,
        type: 'species',
        status: 'imported',
      }),
    )
    expect(status.field).toBe('status')
  })

  it('sin motivo, por el nombre de la restricción del esquema', async () => {
    fetchMock.mockReturnValueOnce(
      jsonResponse(
        {
          code: '23505',
          message:
            'duplicate key value violates unique constraint "species_scientific_name_key"',
          details:
            'Key (lower(scientific_name))=(vanda tricolor) already exists.',
        },
        409,
      ),
    )
    const error = await failure(
      createCatalogSpecies({
        scientificName: 'Vanda tricolor',
        genusId: GENUS_ID,
        type: 'species',
        status: 'validated',
      }),
    )
    expect(error.problem).toBe('duplicate-name')
    expect(
      catalogWriteErrorFromDatabase({
        code: '23505',
        message:
          'duplicate key value violates unique constraint "species_source_ref_key"',
      })?.problem,
    ).toBe('source-ref')
    expect(
      catalogWriteErrorFromDatabase({
        code: '23514',
        message:
          'new row for relation "species" violates check constraint "species_col_has_source_ref"',
      })?.problem,
    ).toBe('source-ref')
    expect(catalogWriteErrorFromDatabase({ code: 'XX000' })).toBeNull()
  })

  it('lote: sin repetidos, con su tope, y devuelve cuántas cambiaron', async () => {
    fetchMock.mockReturnValue(jsonResponse(2))
    await expect(
      setCatalogSpeciesStatus([SPECIES_ID, SPECIES_ID, GENUS_ID], 'validated'),
    ).resolves.toBe(2)
    expect(lastRequest()).toEqual({
      path: 'rpc/set_catalog_species_status',
      body: {
        target_species_ids: [SPECIES_ID, GENUS_ID],
        new_status: 'validated',
      },
    })
    fetchMock.mockClear()
    const empty = await failure(setCatalogSpeciesStatus([], 'validated'))
    expect(empty.problem).toBe('no-species')
    const many = await failure(
      setCatalogSpeciesStatus(
        Array.from(
          { length: MAX_BATCH_SPECIES + 1 },
          (_, index) =>
            `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
        ),
        'validated',
      ),
    )
    expect(many.message).toBe(
      'Se pueden cambiar como mucho 100 especies a la vez.',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lote: si alguna ya no existe, dice cuántas', async () => {
    fetchMock.mockReturnValue(
      rejection(400, 'P0002', 'species_not_found', { missing_count: 2 }),
    )
    const error = await failure(
      setCatalogSpeciesStatus([SPECIES_ID], 'observed'),
    )
    expect(error.message).toBe(
      '2 de las especies elegidas ya no están en el catálogo: no se cambió ninguna.',
    )
  })

  it('baja: envía el id; con plantas, dice cuántas', async () => {
    fetchMock.mockReturnValueOnce(
      Promise.resolve(new Response(null, { status: 204 })),
    )
    await deleteCatalogSpecies(SPECIES_ID)
    expect(lastRequest()).toEqual({
      path: 'rpc/delete_catalog_species',
      body: { target_species_id: SPECIES_ID },
    })
    fetchMock.mockReturnValueOnce(
      rejection(409, '23503', 'species_has_plants', { plant_count: 3 }),
    )
    const error = await failure(deleteCatalogSpecies(SPECIES_ID))
    expect(error.problem).toBe('species-has-plants')
    expect(error.field).toBeNull()
    expect(error.message).toBe(
      'No se puede borrar: 3 plantas de usuarios la tienen enlazada.',
    )
  })

  it('permiso, sesión, conexión y fallo del servidor', async () => {
    const input = {
      scientificName: 'Vanda tricolor',
      genusId: GENUS_ID,
      type: 'species',
      status: 'validated',
    } as const
    fetchMock.mockReturnValueOnce(
      jsonResponse(
        { code: '42501', message: 'Solo un administrador…', details: null },
        403,
      ),
    )
    expect((await failure(createCatalogSpecies(input))).problem).toBe(
      'forbidden',
    )
    fetchMock.mockReturnValueOnce(
      jsonResponse({ code: 'PGRST301', message: 'JWT expired' }, 401),
    )
    expect((await failure(createCatalogSpecies(input))).problem).toBe(
      'session-ended',
    )
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const offline = await failure(createCatalogSpecies(input))
    expect(offline.problem).toBe('offline')
    expect(offline.message).toMatch(/no se guardó nada/)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    fetchMock.mockReturnValueOnce(
      jsonResponse({ code: 'XX000', message: 'internal' }, 500),
    )
    expect((await failure(createCatalogSpecies(input))).problem).toBe('failed')
  })

  it('toCatalogWriteError conserva el motivo de un error de lectura', () => {
    expect(toCatalogWriteError(new CatalogAdminError('offline')).problem).toBe(
      'offline',
    )
    expect(toCatalogWriteError(new Error('x')).problem).toBe('failed')
  })
})
