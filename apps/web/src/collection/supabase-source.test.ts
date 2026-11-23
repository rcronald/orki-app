import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  initSupabase,
  SessionTokenError,
  setSessionTokenSource,
} from '../lib/supabase.ts'
import { plantRow, RHYNCHOLAELIOCATTLEYA } from '../test/collection.ts'
import { COLLECTION_PLANT_SELECT, type CollectionPlantRow } from './model.ts'
import { CollectionLoadError } from './source.ts'
import {
  COLLECTION_PAGE_SIZE,
  createSupabaseCollectionSource,
  supabaseCollectionSource,
} from './supabase-source.ts'

const CONFIG = {
  supabaseUrl: 'https://ejemplo.supabase.co',
  supabasePublishableKey: 'sb_publishable_clave_de_prueba',
  appEnv: 'dev',
  clerkPublishableKey: 'pk_test_clave_de_prueba',
} as const

const USER = 'user_prueba'
const TOKEN = 'token_de_sesion_de_prueba'

// Simula PostgREST sobre una tabla de plantas en memoria: aplica el filtro
// id=gt., el orden por id y el limit de cada petición, como haría el servidor.
const fetchMock = vi.fn<typeof fetch>()
let table: CollectionPlantRow[] = []

function respondFromTable(input: string | URL | Request): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input))
  const after = url.searchParams.get('id')?.replace(/^gt\./, '') ?? null
  const limit = Number(url.searchParams.get('limit') ?? Infinity)
  const rows = table
    .filter((row) => after === null || row.id > after)
    .toSorted((a, b) => (a.id < b.id ? -1 : 1))
    .slice(0, limit)
  return Promise.resolve(json(rows))
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function requestedUrls(): URL[] {
  return fetchMock.mock.calls.map(
    ([input]) => new URL(input instanceof Request ? input.url : String(input)),
  )
}

function load(signal = new AbortController().signal) {
  return supabaseCollectionSource.load({
    userId: USER,
    signal,
    provide: () => {},
  })
}

/** Id con forma de UUID que ordena como el número. */
function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

beforeEach(() => {
  table = []
  fetchMock.mockReset()
  fetchMock.mockImplementation(respondFromTable)
  vi.stubGlobal('fetch', fetchMock)
  initSupabase(CONFIG)
  setSessionTokenSource(() => Promise.resolve(TOKEN))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  setSessionTokenSource(null)
})

describe('lectura de la colección desde Supabase', () => {
  it('pide las plantas del usuario con su especie y su género, ordenadas por id', async () => {
    table = [plantRow()]
    await load()

    const [url, ...rest] = requestedUrls()
    expect(rest).toHaveLength(0)
    expect(url?.pathname).toBe('/rest/v1/plants')
    expect(url?.searchParams.get('select')).toBe(
      COLLECTION_PLANT_SELECT.replaceAll(' ', ''),
    )
    expect(url?.searchParams.get('user_id')).toBe(`eq.${USER}`)
    expect(url?.searchParams.get('order')).toBe('id.asc')
    expect(url?.searchParams.get('limit')).toBe(String(COLLECTION_PAGE_SIZE))
    expect(url?.searchParams.has('id')).toBe(false)
    expect(url?.searchParams.has('offset')).toBe(false)
    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      `Bearer ${TOKEN}`,
    )
  })

  it('pasa cada fila al modelo: con especie', async () => {
    table = [plantRow()]

    expect(await load()).toEqual([
      {
        id: '00000000-0000-4000-8000-000000000001',
        displayName: 'Phalaenopsis amabilis',
        displayNameIsScientific: true,
        enteredName: 'phalaenopsis amabilis',
        species: {
          id: 'species-amabilis',
          scientificName: 'Phalaenopsis amabilis',
          type: 'species',
          status: 'validated',
        },
        genus: { id: 'genus-phal', name: 'Phalaenopsis' },
        type: 'species',
        validation: 'validated',
        status: 'active',
        acquiredOn: '2026-11-01',
        createdAt: '2026-11-01T15:00:00+00:00',
        updatedAt: '2026-11-02T10:30:00+00:00',
        origin: 'Vivero Los Andes',
        location: 'Ventana de la sala',
        nickname: 'La blanca',
        flowerColor: 'white',
        photoInBloom: true,
        photoPath: 'user_prueba/planta-1.webp',
        thumbnailPath: 'user_prueba/planta-1-mini.webp',
        photoCount: 1,
      },
    ])
  })

  it('pide el número de fotos (photo_count, #184) y lo pasa al modelo', async () => {
    expect(COLLECTION_PLANT_SELECT.split(', ')).toContain('photo_count')
    table = [
      plantRow({ id: 'p1', photo_count: 4 }),
      // Sin el dato (respuesta anterior al #184): la principal cuenta.
      plantRow({ id: 'p2', photo_count: undefined }),
      // El insert que crea la principal devuelve el recuento de antes.
      plantRow({ id: 'p3', photo_count: 0 }),
      plantRow({
        id: 'p4',
        photo_count: null,
        photo_path: null,
        thumbnail_path: null,
      }),
    ]

    expect((await load()).map((plant) => plant.photoCount)).toEqual([
      4, 1, 1, 0,
    ])
  })

  it('sin especie: el nombre ingresado, que no se da por científico', async () => {
    table = [
      plantRow({
        entered_name: 'Catleya rosada',
        species: null,
        validation: 'pending',
        type: 'unknown',
        origin: null,
        location: null,
        nickname: null,
        flower_color: null,
        photo_in_bloom: false,
        photo_path: null,
        thumbnail_path: null,
      }),
    ]
    const [plant] = await load()

    expect(plant).toMatchObject({
      displayName: 'Catleya rosada',
      displayNameIsScientific: false,
      enteredName: 'Catleya rosada',
      species: null,
      genus: { id: 'genus-phal', name: 'Phalaenopsis' },
      type: 'unknown',
      validation: 'pending',
      origin: null,
      location: null,
      nickname: null,
      flowerColor: null,
      photoInBloom: false,
      photoPath: null,
      thumbnailPath: null,
    })
  })

  it('híbrido con "×": el nombre y el género tal como están guardados', async () => {
    table = [
      plantRow({
        entered_name: 'Rlc Memoria Helen Brown',
        type: 'hybrid',
        species: {
          id: 'species-rlc',
          scientific_name: '× Rhyncholaeliocattleya Memoria Helen Brown',
          type: 'hybrid',
          status: 'imported',
        },
        genus: RHYNCHOLAELIOCATTLEYA,
      }),
    ]
    const [plant] = await load()

    expect(plant).toMatchObject({
      displayName: '× Rhyncholaeliocattleya Memoria Helen Brown',
      displayNameIsScientific: true,
      enteredName: 'Rlc Memoria Helen Brown',
      type: 'hybrid',
      species: { type: 'hybrid', status: 'imported' },
      genus: { name: '× Rhyncholaeliocattleya' },
    })
  })

  it('las dadas de baja también se leen, con su estado', async () => {
    table = [
      plantRow({ id: uuid(1), status: 'lost' }),
      plantRow({ id: uuid(2), status: 'gifted' }),
    ]

    expect((await load()).map((plant) => plant.status)).toEqual([
      'lost',
      'gifted',
    ])
  })

  it('colección vacía: una sola petición', async () => {
    expect(await load()).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('1 500 plantas: dos páginas por clave, completa y sin repetir', async () => {
    table = Array.from({ length: 1500 }, (_, i) =>
      plantRow({ id: uuid(i + 1) }),
    )
    const plants = await load()

    expect(plants).toHaveLength(1500)
    expect(new Set(plants.map((plant) => plant.id)).size).toBe(1500)
    expect(plants.map((plant) => plant.id)).toEqual(table.map((row) => row.id))
    const [first, second, ...rest] = requestedUrls()
    expect(rest).toHaveLength(0)
    expect(first?.searchParams.has('id')).toBe(false)
    expect(second?.searchParams.get('id')).toBe(`gt.${uuid(1000)}`)
    expect(second?.searchParams.get('limit')).toBe('1000')
    expect(second?.searchParams.get('user_id')).toBe(`eq.${USER}`)
  })

  it('exactamente una página llena: pide la siguiente, que llega vacía', async () => {
    table = Array.from({ length: 1000 }, (_, i) =>
      plantRow({ id: uuid(i + 1) }),
    )

    expect(await load()).toHaveLength(1000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('con otro tamaño de página', async () => {
    table = Array.from({ length: 5 }, (_, i) => plantRow({ id: uuid(i + 1) }))
    const source = createSupabaseCollectionSource({ pageSize: 2 })
    const plants = await source.load({
      userId: USER,
      signal: new AbortController().signal,
      provide: () => {},
    })

    expect(plants).toHaveLength(5)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('abortada, rechaza con el motivo del aborto y no pide más páginas', async () => {
    table = Array.from({ length: 1500 }, (_, i) =>
      plantRow({ id: uuid(i + 1) }),
    )
    const controller = new AbortController()
    fetchMock.mockImplementationOnce((input) => {
      controller.abort()
      return respondFromTable(input)
    })

    await expect(load(controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('errores con motivo', () => {
  async function failure(): Promise<CollectionLoadError> {
    const error: unknown = await load().then(
      () => null,
      (reason: unknown) => reason,
    )
    if (!(error instanceof CollectionLoadError)) {
      throw new Error(`Se esperaba CollectionLoadError: ${String(error)}`)
    }
    return error
  }

  it('error del servidor: fallo', async () => {
    fetchMock.mockResolvedValue(json({ message: 'Error interno' }, 500))
    const error = await failure()

    expect(error.reason).toBe('failed')
    expect(error.message).toBe(
      'No se pudo cargar tu colección. Vuelve a intentarlo.',
    )
  })

  it('401 (token caducado o rechazado): sesión terminada', async () => {
    fetchMock.mockResolvedValue(
      json({ code: 'PGRST303', message: 'JWT expired' }, 401),
    )

    expect((await failure()).reason).toBe('session-ended')
  })

  it('sin permiso (403): fallo', async () => {
    fetchMock.mockResolvedValue(
      json({ code: '42501', message: 'permission denied' }, 403),
    )

    expect((await failure()).reason).toBe('failed')
  })

  // Las lecturas que fallan antes de responder se reintentan (1, 2 y 4 s).
  async function failureAfterRetries(): Promise<CollectionLoadError> {
    vi.useFakeTimers()
    const pending = failure()
    await vi.advanceTimersByTimeAsync(7_000)
    return pending
  }

  it('la red falla: sin conexión', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const error = await failureAfterRetries()

    expect(error.reason).toBe('offline')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it.each([
    [
      'Clerk sin conexión',
      () => Promise.reject(new SessionTokenError('offline')),
      'offline',
    ],
    ['la sesión ya no existe', () => Promise.resolve(null), 'session-ended'],
    [
      'getToken falla',
      () => Promise.reject(new SessionTokenError('failed')),
      'failed',
    ],
  ] as const)(
    'sin token (%s): %s, sin enviar la petición',
    async (_case, tokenSource, reason) => {
      setSessionTokenSource(tokenSource)
      const error = await failureAfterRetries()

      expect(error.reason).toBe(reason)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('no carga el cliente de Supabase: fallo, o sin conexión si el navegador lo sabe', async () => {
    const getClient = () => Promise.reject(new Error('chunk no disponible'))
    const source = createSupabaseCollectionSource({ getClient })
    const request = {
      userId: USER,
      signal: new AbortController().signal,
      provide: () => {},
    }

    await expect(source.load(request)).rejects.toMatchObject({
      reason: 'failed',
    })
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    try {
      await expect(source.load(request)).rejects.toMatchObject({
        reason: 'offline',
      })
    } finally {
      onLine.mockRestore()
    }
  })
})
