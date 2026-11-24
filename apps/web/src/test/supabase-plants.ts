import { vi } from 'vitest'
import type {
  CollectionPlant,
  CollectionPlantRow,
} from '../collection/model.ts'

// PostgREST y Storage en memoria para las pantallas que editan una planta
// (#16): las filas de plants, la búsqueda de especies, los géneros de acceso
// rápido y el bucket de fotos. Los disparadores de la base se imitan: con
// especie, el género, el tipo y "validated" son los suyos; sin ella, la
// planta queda "pending" (o como estaba, si no se tocó la especie). La app
// real llega hasta el cliente de Supabase; solo fetch es un doble.

export const CONFIG = {
  supabaseUrl: 'https://ejemplo.supabase.co',
  supabasePublishableKey: 'sb_publishable_clave_de_prueba',
  appEnv: 'dev',
  clerkPublishableKey: 'pk_test_clave_de_prueba',
} as const

export const GENERA = {
  cattleya: { id: '20000000-0000-4000-8000-000000000001', name: 'Cattleya' },
  dendrobium: {
    id: '20000000-0000-4000-8000-000000000002',
    name: 'Dendrobium',
  },
  phalaenopsis: {
    id: '20000000-0000-4000-8000-000000000003',
    name: 'Phalaenopsis',
  },
  masdevallia: {
    id: '20000000-0000-4000-8000-000000000004',
    name: 'Masdevallia',
  },
}
const QUICK_GENERA = [GENERA.cattleya, GENERA.dendrobium, GENERA.phalaenopsis]

export const SPECIES = {
  amabilis: {
    id: '10000000-0000-4000-8000-000000000001',
    scientific_name: 'Phalaenopsis amabilis',
    genus: GENERA.phalaenopsis,
    type: 'species',
  },
  veitchiana: {
    id: '10000000-0000-4000-8000-000000000002',
    scientific_name: 'Masdevallia veitchiana',
    genus: GENERA.masdevallia,
    type: 'species',
  },
} as const

function searchResult(species: (typeof SPECIES)[keyof typeof SPECIES]) {
  return {
    id: species.id,
    scientific_name: species.scientific_name,
    genus_id: species.genus.id,
    genus_name: species.genus.name,
    type: species.type,
    status: 'validated',
    matched_name: species.scientific_name,
    matched_name_type: 'scientific',
  }
}

/** Planta del modelo como fila de PostgREST. */
export function rowOf(plant: CollectionPlant): CollectionPlantRow {
  return {
    id: plant.id,
    entered_name: plant.enteredName,
    type: plant.type,
    validation: plant.validation,
    status: plant.status,
    acquired_on: plant.acquiredOn,
    origin: plant.origin,
    location: plant.location,
    nickname: plant.nickname,
    flower_color: plant.flowerColor,
    photo_in_bloom: plant.photoInBloom,
    photo_path: plant.photoPath,
    thumbnail_path: plant.thumbnailPath,
    photo_count: plant.photoCount,
    code: plant.code,
    notes: plant.notes,
    created_at: plant.createdAt,
    updated_at: plant.updatedAt,
    species: plant.species
      ? {
          id: plant.species.id,
          scientific_name: plant.species.scientificName,
          type: plant.species.type,
          status: plant.species.status,
        }
      : null,
    genus: plant.genus,
  }
}

export interface SentRequest {
  url: URL
  method: string
  body: unknown
}

type FetchArgs = Parameters<typeof fetch>

function readRequest([input, init]: FetchArgs): SentRequest {
  const url = new URL(input instanceof Request ? input.url : String(input))
  const method = (
    init?.method ?? (input instanceof Request ? input.method : 'GET')
  ).toUpperCase()
  const raw = init?.body
  return {
    url,
    method,
    body: typeof raw === 'string' ? (JSON.parse(raw) as unknown) : undefined,
  }
}

export function json(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const STORAGE_PREFIX = '/storage/v1/object/plant-photos/'

export interface FakeSupabase {
  fetch: ReturnType<typeof vi.fn<typeof fetch>>
  /** Filas guardadas, por id. */
  rows: Map<string, CollectionPlantRow>
  requests(): SentRequest[]
  /** Cuerpos de las actualizaciones de plants, en orden. */
  patches(): Record<string, unknown>[]
  /** Rutas subidas al bucket. */
  uploads(): string[]
  /** Rutas borradas del bucket. */
  removed(): string[]
  /** Borrados de plants (por id). */
  deletes(): string[]
  /** Respuesta de la próxima actualización de plants, si no es la normal. */
  patchResponder: ((body: Record<string, unknown>) => Promise<Response>) | null
  /** Respuesta del borrado de plants, si no es la normal. */
  deleteResponder: (() => Promise<Response>) | null
  /** Respuesta del listado o el borrado de archivos, si no es la normal. */
  storageResponder: ((request: SentRequest) => Promise<Response>) | null
  /**
   * Filas de plant_photos (#221). Una planta con foto empieza con su
   * principal en la posición 0, como tras la copia de la migración; la
   * principal se copia a plants al insertar o borrar, como sync_plant.
   */
  photos: FakePhotoRow[]
  /** Fotos de una planta en orden. */
  photosOf(plantId: string): FakePhotoRow[]
  /** Respuesta del borrado de una fila de plant_photos, si no es la normal. */
  photoDeleteResponder: (() => Promise<Response>) | null
}

/** Una fila de plant_photos en memoria. */
export interface FakePhotoRow {
  id: string
  plant_id: string
  photo_path: string
  thumbnail_path: string
  in_bloom: boolean
  taken_at: string | null
  note: string | null
  position: number
  created_at: string
}

let clock = Date.parse('2026-11-21T15:00:00Z')

/** Un PostgREST y un Storage en memoria con estas plantas. */
export function fakeSupabase(plants: readonly CollectionPlant[]): FakeSupabase {
  const rows = new Map(plants.map((plant) => [plant.id, rowOf(plant)]))
  const files = new Set<string>()
  const photos: FakePhotoRow[] = []
  for (const plant of plants) {
    if (plant.photoPath) files.add(plant.photoPath)
    if (plant.thumbnailPath) files.add(plant.thumbnailPath)
    if (plant.photoPath && plant.thumbnailPath) {
      photos.push({
        id: `foto-${plant.id}`,
        plant_id: plant.id,
        photo_path: plant.photoPath,
        thumbnail_path: plant.thumbnailPath,
        in_bloom: plant.photoInBloom,
        taken_at: null,
        note: null,
        position: 0,
        created_at: plant.createdAt,
      })
    }
  }

  const photosOf = (plantId: string) =>
    fake.photos
      .filter((photo) => photo.plant_id === plantId)
      .sort((a, b) => a.position - b.position)

  /** Como sync_plant: la principal pasa a las columnas de la planta. */
  const syncMain = (plantId: string) => {
    const row = rows.get(plantId)
    if (!row) return
    const [main] = photosOf(plantId)
    rows.set(plantId, {
      ...row,
      photo_path: main?.photo_path ?? null,
      thumbnail_path: main?.thumbnail_path ?? null,
      photo_in_bloom: main?.in_bloom ?? false,
      photo_count: photosOf(plantId).length,
    })
  }

  const photoRows = (request: SentRequest): Promise<Response> => {
    const param = (name: string) =>
      request.url.searchParams.get(name)?.replace(/^eq\./, '')
    if (request.method === 'GET') {
      return json(photosOf(param('plant_id') ?? ''))
    }
    if (request.method === 'POST') {
      const body = (isRecord(request.body) ? request.body : {}) as Omit<
        FakePhotoRow,
        'id' | 'created_at'
      >
      if (!rows.has(body.plant_id)) {
        return json({ code: '23503', message: 'foreign key' }, 409)
      }
      if (
        photosOf(body.plant_id).some(
          (photo) => photo.position === body.position,
        )
      ) {
        return json({ code: '23505', message: 'duplicate key' }, 409)
      }
      clock += 1000
      const row: FakePhotoRow = {
        ...body,
        id: `foto-${String(clock)}`,
        created_at: new Date(clock).toISOString(),
      }
      fake.photos.push(row)
      syncMain(row.plant_id)
      return json(row, 201)
    }
    if (request.method === 'DELETE') {
      if (fake.photoDeleteResponder) return fake.photoDeleteResponder()
      const id = param('id')
      const found = fake.photos.find((photo) => photo.id === id)
      fake.photos = fake.photos.filter((photo) => photo !== found)
      if (found) syncMain(found.plant_id)
      return json(found ? [found] : [])
    }
    return json({ message: 'Ruta inesperada plant_photos' }, 404)
  }

  const respond = (...args: FetchArgs): Promise<Response> => {
    const request = readRequest(args)
    const { pathname, searchParams } = request.url
    const id = searchParams.get('id')?.replace(/^eq\./, '')
    if (pathname === '/rest/v1/genera') return json(QUICK_GENERA)
    if (pathname === '/rest/v1/plant_photos') return photoRows(request)
    // La planta releída tras cambiar su principal (readPlant).
    if (pathname === '/rest/v1/plants' && request.method === 'GET') {
      const row = id === undefined ? undefined : rows.get(id)
      return row
        ? json(row)
        : json(
            { code: 'PGRST116', message: 'JSON object requested, 0 rows' },
            406,
          )
    }
    if (pathname === '/rest/v1/rpc/search_species') {
      return json(Object.values(SPECIES).map(searchResult))
    }
    if (pathname === '/rest/v1/plants' && request.method === 'PATCH') {
      const body = isRecord(request.body) ? request.body : {}
      if (fake.patchResponder) return fake.patchResponder(body)
      const row = id === undefined ? undefined : rows.get(id)
      if (!row) {
        return json(
          { code: 'PGRST116', message: 'JSON object requested, 0 rows' },
          406,
        )
      }
      const next = applyPatch(row, body)
      rows.set(row.id, next)
      // Como sync_photos: "en floración" de la planta es el de la principal.
      const [main] = photosOf(row.id)
      if (main && 'photo_in_bloom' in body) main.in_bloom = next.photo_in_bloom
      return json(next)
    }
    if (pathname === '/rest/v1/plants' && request.method === 'DELETE') {
      if (fake.deleteResponder) return fake.deleteResponder()
      if (id === undefined || !rows.has(id)) {
        return json(
          { code: 'PGRST116', message: 'JSON object requested, 0 rows' },
          406,
        )
      }
      rows.delete(id)
      return json({ id })
    }
    const storagePath = pathname.startsWith(STORAGE_PREFIX)
      ? decodeURIComponent(pathname.slice(STORAGE_PREFIX.length))
      : null
    if (storagePath !== null && request.method === 'POST') {
      files.add(storagePath)
      return json({
        Id: `id-${storagePath}`,
        Key: `plant-photos/${storagePath}`,
      })
    }
    if (pathname === '/storage/v1/object/list/plant-photos') {
      if (fake.storageResponder) return fake.storageResponder(request)
      const prefix =
        isRecord(request.body) && typeof request.body.prefix === 'string'
          ? request.body.prefix
          : ''
      const folder = prefix.endsWith('/') ? prefix : `${prefix}/`
      return json(
        [...files]
          .filter((path) => path.startsWith(folder))
          .map((path) => ({ name: path.slice(folder.length), id: path })),
      )
    }
    if (
      pathname === '/storage/v1/object/plant-photos' &&
      request.method === 'DELETE'
    ) {
      if (fake.storageResponder) return fake.storageResponder(request)
      const prefixes =
        isRecord(request.body) && Array.isArray(request.body.prefixes)
          ? request.body.prefixes.filter(
              (value): value is string => typeof value === 'string',
            )
          : []
      for (const path of prefixes) files.delete(path)
      return json(prefixes.map((name) => ({ name })))
    }
    return json({ message: `Ruta inesperada ${pathname}` }, 404)
  }

  const fake: FakeSupabase = {
    fetch: vi.fn<typeof fetch>(respond),
    rows,
    requests: () => fake.fetch.mock.calls.map(readRequest),
    patches: () =>
      fake
        .requests()
        .filter(
          (r) => r.method === 'PATCH' && r.url.pathname === '/rest/v1/plants',
        )
        .map((r) => (isRecord(r.body) ? r.body : {})),
    uploads: () =>
      fake
        .requests()
        .filter(
          (r) =>
            r.method === 'POST' && r.url.pathname.startsWith(STORAGE_PREFIX),
        )
        .map((r) =>
          decodeURIComponent(r.url.pathname.slice(STORAGE_PREFIX.length)),
        ),
    removed: () =>
      fake
        .requests()
        .filter(
          (r) =>
            r.method === 'DELETE' &&
            r.url.pathname === '/storage/v1/object/plant-photos',
        )
        .flatMap((r) =>
          isRecord(r.body) && Array.isArray(r.body.prefixes)
            ? r.body.prefixes.filter(
                (value): value is string => typeof value === 'string',
              )
            : [],
        ),
    deletes: () =>
      fake
        .requests()
        .filter(
          (r) => r.method === 'DELETE' && r.url.pathname === '/rest/v1/plants',
        )
        .map((r) => r.url.searchParams.get('id')?.replace(/^eq\./, '') ?? ''),
    patchResponder: null,
    deleteResponder: null,
    storageResponder: null,
    photos,
    photosOf,
    photoDeleteResponder: null,
  }
  return fake
}

function speciesById(id: unknown) {
  return Object.values(SPECIES).find((species) => species.id === id)
}

function genusById(id: unknown) {
  return Object.values(GENERA).find((genus) => genus.id === id)
}

/** La fila tras la actualización, con lo que harían los disparadores. */
function applyPatch(
  row: CollectionPlantRow,
  body: Record<string, unknown>,
): CollectionPlantRow {
  const next: CollectionPlantRow = { ...row }
  const text = (key: string) => {
    const value = body[key]
    return typeof value === 'string' ? value : null
  }
  if ('entered_name' in body) next.entered_name = text('entered_name') ?? ''
  if ('acquired_on' in body) next.acquired_on = text('acquired_on') ?? ''
  if ('origin' in body) next.origin = text('origin')
  if ('location' in body) next.location = text('location')
  if ('nickname' in body) next.nickname = text('nickname')
  if ('notes' in body) next.notes = text('notes')
  if ('photo_path' in body) next.photo_path = text('photo_path')
  if ('thumbnail_path' in body) next.thumbnail_path = text('thumbnail_path')
  if ('photo_in_bloom' in body)
    next.photo_in_bloom = body.photo_in_bloom === true
  if ('flower_color' in body) {
    const color = body.flower_color
    next.flower_color =
      color === 'white' ||
      color === 'pink' ||
      color === 'purple' ||
      color === 'yellow' ||
      color === 'orange' ||
      color === 'bicolor'
        ? color
        : null
  }
  if ('status' in body) {
    const status = body.status
    if (status === 'active' || status === 'lost' || status === 'gifted') {
      next.status = status
    }
  }
  if ('genus_id' in body) next.genus = genusById(body.genus_id) ?? next.genus
  if ('type' in body) {
    const type = body.type
    if (type === 'species' || type === 'hybrid' || type === 'unknown') {
      next.type = type
    }
  }
  if ('species_id' in body) {
    const species = speciesById(body.species_id)
    if (species) {
      next.species = {
        id: species.id,
        scientific_name: species.scientific_name,
        type: species.type,
        status: 'validated',
      }
      next.genus = species.genus
      next.type = species.type
      next.validation = 'validated'
    } else {
      next.species = null
      if (row.species !== null) next.validation = 'pending'
    }
  }
  clock += 60_000
  next.updated_at = new Date(clock).toISOString()
  return next
}
