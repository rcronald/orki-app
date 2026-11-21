import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addGenusAbbreviation,
  addSpeciesName,
  catalogWriteErrorFromDatabase,
  CatalogWriteError,
  cleanCatalogText,
  cleanGenusName,
  createCatalogGenus,
  createCatalogSpecies,
  deleteCatalogGenus,
  deleteCatalogSpecies,
  deleteGenusAbbreviation,
  deleteSpeciesName,
  MAX_BATCH_SPECIES,
  mergeCatalogSpecies,
  previewSpeciesMerge,
  setCatalogSpeciesStatus,
  toCatalogWriteError,
  updateCatalogGenus,
  updateCatalogSpecies,
  updateGenusAbbreviation,
  updateSpeciesName,
  withFinalDot,
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
    fetchMock.mockImplementation(() => jsonResponse(SPECIES_ROW))
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
    fetchMock.mockImplementation(() => jsonResponse(SPECIES_ROW))
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
    fetchMock.mockImplementation(() => jsonResponse(2))
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

const NAME_ID = '55555555-5555-4555-8555-555555555555'
const ABBREVIATION_ID = '66666666-6666-4666-8666-666666666666'

describe('nombres de una especie', () => {
  const nameRow = {
    id: NAME_ID,
    species_id: SPECIES_ID,
    name: 'vanda azul',
    type: 'common',
    language: 'es',
    created_at: '2026-11-21T10:00:00+00:00',
    updated_at: '2026-11-21T10:00:00+00:00',
  }

  it('añadir: recorta el nombre y solo envía el idioma de un nombre común', async () => {
    fetchMock.mockImplementation(() => jsonResponse(nameRow))
    const written = await addSpeciesName(SPECIES_ID, {
      name: '  vanda   azul ',
      type: 'common',
      language: ' es ',
    })
    expect(lastRequest()).toEqual({
      path: 'rpc/add_species_name',
      body: {
        target_species_id: SPECIES_ID,
        new_name: 'vanda azul',
        new_type: 'common',
        new_language: 'es',
      },
    })
    expect(written).toEqual({
      id: NAME_ID,
      speciesId: SPECIES_ID,
      name: 'vanda azul',
      type: 'common',
      language: 'es',
    })
    await addSpeciesName(SPECIES_ID, {
      name: 'Vanda caerulea',
      type: 'synonym',
      language: 'la',
    })
    expect(lastRequest().body).toEqual({
      target_species_id: SPECIES_ID,
      new_name: 'Vanda caerulea',
      new_type: 'synonym',
    })
  })

  it('editar y quitar', async () => {
    fetchMock.mockImplementation(() => jsonResponse(nameRow))
    await updateSpeciesName(NAME_ID, { name: 'Vanda azul', type: 'common' })
    expect(lastRequest()).toEqual({
      path: 'rpc/update_species_name',
      body: {
        target_name_id: NAME_ID,
        new_name: 'Vanda azul',
        new_type: 'common',
      },
    })
    fetchMock.mockReturnValue(
      Promise.resolve(new Response(null, { status: 204 })),
    )
    await deleteSpeciesName(NAME_ID)
    expect(lastRequest()).toEqual({
      path: 'rpc/delete_species_name',
      body: { target_name_id: NAME_ID },
    })
  })

  it('errores: vacío sin pedir nada; duplicado, idioma y nombre científico junto a su campo', async () => {
    const empty = await failure(
      addSpeciesName(SPECIES_ID, { name: ' ', type: 'synonym' }),
    )
    expect(empty.problem).toBe('name-required')
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockReturnValueOnce(
      rejection(409, '23505', 'duplicate_alternative_name', {
        existing_name: 'Laelia purpurata',
        existing_type: 'synonym',
      }),
    )
    const duplicate = await failure(
      addSpeciesName(SPECIES_ID, { name: 'laelia purpurata', type: 'common' }),
    )
    expect(duplicate.field).toBe('text')
    expect(duplicate.message).toBe(
      'La especie ya tiene este nombre: «Laelia purpurata» (sinónimo). Los nombres no distinguen mayúsculas.',
    )
    fetchMock.mockReturnValueOnce(rejection(400, '22023', 'invalid_language'))
    const language = await failure(
      addSpeciesName(SPECIES_ID, {
        name: 'reina',
        type: 'common',
        language: 'español',
      }),
    )
    expect(language.field).toBe('language')
    fetchMock.mockReturnValueOnce(
      rejection(409, '23505', 'name_is_scientific_name'),
    )
    expect(
      (
        await failure(
          addSpeciesName(SPECIES_ID, {
            name: 'Vanda coerulea',
            type: 'synonym',
          }),
        )
      ).problem,
    ).toBe('name-is-scientific-name')
    expect(
      catalogWriteErrorFromDatabase({
        code: '23505',
        message:
          'duplicate key value violates unique constraint "species_names_species_id_name_key"',
      })?.problem,
    ).toBe('duplicate-alternative-name')
  })
})

describe('géneros y abreviaturas', () => {
  const genusRow = {
    id: GENUS_ID,
    name: '× Mokara',
    is_quick_access: true,
    photo_path: null,
    created_at: '2026-11-21T10:00:00+00:00',
    updated_at: '2026-11-21T10:00:00+00:00',
  }

  it('cleanGenusName y withFinalDot', () => {
    expect(cleanGenusName('  ×Mokara ')).toBe('× Mokara')
    expect(cleanGenusName('×   Mokara')).toBe('× Mokara')
    expect(withFinalDot(' Phal ')).toBe('Phal.')
    expect(withFinalDot('Phal..')).toBe('Phal.')
    expect(withFinalDot(' . ')).toBe('')
  })

  it('crear, renombrar y borrar un género', async () => {
    fetchMock.mockImplementation(() => jsonResponse(genusRow))
    const written = await createCatalogGenus({
      name: '×Mokara',
      isQuickAccess: true,
    })
    expect(lastRequest()).toEqual({
      path: 'rpc/create_catalog_genus',
      body: { new_name: '× Mokara', new_is_quick_access: true },
    })
    expect(written).toEqual({
      id: GENUS_ID,
      name: '× Mokara',
      isQuickAccess: true,
    })
    await updateCatalogGenus(GENUS_ID, { name: 'Mokara', isQuickAccess: false })
    expect(lastRequest()).toEqual({
      path: 'rpc/update_catalog_genus',
      body: {
        target_genus_id: GENUS_ID,
        new_name: 'Mokara',
        new_is_quick_access: false,
      },
    })
    fetchMock.mockReturnValue(
      rejection(409, '23503', 'genus_has_species', { species_count: 12 }),
    )
    const error = await failure(deleteCatalogGenus(GENUS_ID))
    expect(error.message).toBe(
      'No se puede borrar: el género tiene 12 especies. Bórralas o cámbialas de género antes.',
    )
  })

  it('un género casi igual se explica con el que ya existe', async () => {
    fetchMock.mockReturnValue(
      rejection(409, '23505', 'similar_genus', {
        existing_name: 'Rhyncholaeliocattleya',
      }),
    )
    const error = await failure(
      createCatalogGenus({
        name: '× Rhyncholaeliocattleya',
        isQuickAccess: false,
      }),
    )
    expect(error.field).toBe('text')
    expect(error.message).toBe(
      'Ya hay un género que se escribe casi igual: «Rhyncholaeliocattleya». Solo cambian las tildes o el signo de híbrido «×».',
    )
    expect(
      catalogWriteErrorFromDatabase({
        code: '23503',
        message:
          'update or delete on table "genera" violates foreign key constraint "species_genus_id_fkey" on table "species"',
      })?.problem,
    ).toBe('genus-has-species')
    expect(
      catalogWriteErrorFromDatabase({
        code: '23503',
        message:
          'insert or update on table "species" violates foreign key constraint "species_genus_id_fkey"',
      })?.problem,
    ).toBe('genus-not-found')
  })

  it('abreviaturas: con su punto, y el choque nombra el género que la tiene', async () => {
    const row = {
      id: ABBREVIATION_ID,
      genus_id: GENUS_ID,
      abbreviation: 'Mok.',
      created_at: '2026-11-21T10:00:00+00:00',
      updated_at: '2026-11-21T10:00:00+00:00',
    }
    fetchMock.mockImplementation(() => jsonResponse(row))
    await expect(addGenusAbbreviation(GENUS_ID, ' Mok ')).resolves.toEqual({
      id: ABBREVIATION_ID,
      genusId: GENUS_ID,
      abbreviation: 'Mok.',
    })
    expect(lastRequest().body).toEqual({
      target_genus_id: GENUS_ID,
      new_abbreviation: 'Mok.',
    })
    await updateGenusAbbreviation(ABBREVIATION_ID, 'Mkr')
    expect(lastRequest()).toEqual({
      path: 'rpc/update_genus_abbreviation',
      body: {
        target_abbreviation_id: ABBREVIATION_ID,
        new_abbreviation: 'Mkr.',
      },
    })
    fetchMock.mockReturnValue(
      Promise.resolve(new Response(null, { status: 204 })),
    )
    await deleteGenusAbbreviation(ABBREVIATION_ID)
    expect(lastRequest().path).toBe('rpc/delete_genus_abbreviation')

    fetchMock.mockClear()
    fetchMock.mockReturnValue(
      rejection(409, '23505', 'abbreviation_taken', {
        genus_id: GENUS_ID,
        genus_name: 'Phalaenopsis',
        existing_abbreviation: 'Phal.',
      }),
    )
    const taken = await failure(addGenusAbbreviation(GENUS_ID, 'PHAL'))
    expect(taken.field).toBe('text')
    expect(taken.details.genusName).toBe('Phalaenopsis')
    expect(taken.message).toBe(
      'La abreviatura «Phal.» ya es del género Phalaenopsis: una abreviatura solo puede ser de un género (sin distinguir mayúsculas, tildes ni el punto final).',
    )
    const empty = await failure(addGenusAbbreviation(GENUS_ID, ' . '))
    expect(empty.problem).toBe('name-required')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('fusión de especies', () => {
  const MERGED_ID = '33333333-3333-4333-8333-333333333333'
  const KEPT_ID = '44444444-4444-4444-8444-444444444444'
  const PREVIEW_ROW = {
    merged_scientific_name: 'Doritis pulcherrima',
    merged_genus_id: GENUS_ID,
    merged_genus_name: 'Doritis',
    merged_type: 'species',
    merged_status: 'imported',
    merged_source: 'col',
    merged_source_ref: '4F1',
    kept_scientific_name: 'Phalaenopsis pulcherrima',
    kept_genus_id: '55555555-5555-4555-8555-555555555555',
    kept_genus_name: 'Phalaenopsis',
    kept_type: 'species',
    kept_status: 'imported',
    plant_count: 3,
    moved_names: [
      {
        name: 'Doritis pulcherrima',
        type: 'synonym',
        language: null,
        origin: 'scientific_name',
      },
      {
        name: 'flor de mayo',
        type: 'common',
        language: 'es',
        origin: 'common',
      },
      // Una forma que no se reconoce se descarta.
      { name: 'raro', type: 'desconocido', origin: 'synonym' },
    ],
    existing_names: [
      {
        name: 'Doritis buyssoniana',
        type: 'synonym',
        language: null,
        origin: 'synonym',
        reason: 'already_in_kept',
        existing_name: 'Doritis Buyssoniana',
        existing_type: 'synonym',
      },
    ],
    genus_differs: true,
    type_differs: false,
    kept_becomes_validated: true,
    remembered_keys: [
      { source: 'col', source_ref: '4F1', inherited: false },
      { source: 'curated', source_ref: 'h-12', inherited: true },
    ],
  }

  it('vista previa: envía las dos especies y convierte la fila', async () => {
    fetchMock.mockImplementation(() => jsonResponse([PREVIEW_ROW]))
    const preview = await previewSpeciesMerge(MERGED_ID, KEPT_ID)
    expect(lastRequest()).toEqual({
      path: 'rpc/preview_species_merge',
      body: { merged_species_id: MERGED_ID, kept_species_id: KEPT_ID },
    })
    expect(preview).toEqual({
      merged: {
        id: MERGED_ID,
        scientificName: 'Doritis pulcherrima',
        genusId: GENUS_ID,
        genusName: 'Doritis',
        type: 'species',
        status: 'imported',
        source: 'col',
        sourceRef: '4F1',
      },
      kept: {
        id: KEPT_ID,
        scientificName: 'Phalaenopsis pulcherrima',
        genusId: '55555555-5555-4555-8555-555555555555',
        genusName: 'Phalaenopsis',
        type: 'species',
        status: 'imported',
      },
      plantCount: 3,
      movedNames: [
        {
          name: 'Doritis pulcherrima',
          type: 'synonym',
          language: null,
          origin: 'scientific_name',
        },
        {
          name: 'flor de mayo',
          type: 'common',
          language: 'es',
          origin: 'common',
        },
      ],
      existingNames: [
        {
          name: 'Doritis buyssoniana',
          type: 'synonym',
          language: null,
          origin: 'synonym',
          reason: 'already_in_kept',
          existingName: 'Doritis Buyssoniana',
          existingType: 'synonym',
        },
      ],
      genusDiffers: true,
      typeDiffers: false,
      keptBecomesValidated: true,
      rememberedKeys: [
        { source: 'col', sourceRef: '4F1', inherited: false },
        { source: 'curated', sourceRef: 'h-12', inherited: true },
      ],
    })
  })

  it('vista previa: los rechazos de la fusión y los de transporte', async () => {
    await expect(previewSpeciesMerge(KEPT_ID, KEPT_ID)).rejects.toMatchObject({
      problem: 'same-species',
    })
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockReturnValueOnce(
      rejection(404, 'P0002', 'species_not_found', {
        species_id: KEPT_ID,
        species_role: 'kept',
      }),
    )
    const gone = previewSpeciesMerge(MERGED_ID, KEPT_ID)
    await expect(gone).rejects.toBeInstanceOf(CatalogWriteError)
    await expect(gone).rejects.toMatchObject({
      problem: 'species-not-found',
      details: { speciesRole: 'kept', speciesId: KEPT_ID },
    })

    // Sin rol, sesión y conexión: como cualquier lectura.
    fetchMock.mockReturnValueOnce(
      jsonResponse({ code: '42501', message: 'Solo un administrador…' }, 403),
    )
    await expect(previewSpeciesMerge(MERGED_ID, KEPT_ID)).rejects.toMatchObject(
      { reason: 'forbidden' },
    )
    fetchMock.mockReturnValueOnce(
      jsonResponse({ code: 'PGRST301', message: 'JWT expired' }, 401),
    )
    await expect(previewSpeciesMerge(MERGED_ID, KEPT_ID)).rejects.toMatchObject(
      { reason: 'session-ended' },
    )
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(previewSpeciesMerge(MERGED_ID, KEPT_ID)).rejects.toMatchObject(
      { reason: 'offline' },
    )
  })

  it('fusión: envía las dos especies y devuelve el resultado', async () => {
    fetchMock.mockImplementation(() =>
      jsonResponse([
        {
          action_id: 'accion-1',
          plant_count: 3,
          moved_name_count: 2,
          skipped_name_count: 1,
          kept_validated: true,
          remembered_keys: [
            { source: 'col', source_ref: '4F1', inherited: false },
          ],
        },
      ]),
    )
    const result = await mergeCatalogSpecies(MERGED_ID, KEPT_ID)
    expect(lastRequest()).toEqual({
      path: 'rpc/merge_species',
      body: { merged_species_id: MERGED_ID, kept_species_id: KEPT_ID },
    })
    expect(result).toEqual({
      actionId: 'accion-1',
      plantCount: 3,
      movedNameCount: 2,
      skippedNameCount: 1,
      keptValidated: true,
      rememberedKeys: [{ source: 'col', sourceRef: '4F1', inherited: false }],
    })
  })

  it('fusión: misma especie, la que falta y los fallos de transporte', async () => {
    fetchMock.mockReturnValueOnce(rejection(400, '22023', 'same_species'))
    const same = await failure(mergeCatalogSpecies(MERGED_ID, KEPT_ID))
    expect(same.problem).toBe('same-species')
    expect(same.message).toMatch(/dos especies distintas/)

    fetchMock.mockReturnValueOnce(
      rejection(404, 'P0002', 'species_not_found', {
        species_id: MERGED_ID,
        species_role: 'merged',
      }),
    )
    const gone = await failure(mergeCatalogSpecies(MERGED_ID, KEPT_ID))
    expect(gone.problem).toBe('species-not-found')
    expect(gone.details.speciesRole).toBe('merged')
    expect(gone.message).toMatch(/La especie que se absorbía ya no está/)

    fetchMock.mockReturnValueOnce(
      jsonResponse({ code: '42501', message: 'Solo un administrador…' }, 403),
    )
    expect(
      (await failure(mergeCatalogSpecies(MERGED_ID, KEPT_ID))).problem,
    ).toBe('forbidden')
    fetchMock.mockReturnValueOnce(
      jsonResponse({ code: 'PGRST301', message: 'JWT expired' }, 401),
    )
    expect(
      (await failure(mergeCatalogSpecies(MERGED_ID, KEPT_ID))).problem,
    ).toBe('session-ended')
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(
      (await failure(mergeCatalogSpecies(MERGED_ID, KEPT_ID))).problem,
    ).toBe('offline')
  })
})
