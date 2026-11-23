import {
  COLLECTION_PLANT_SELECT,
  toCollectionPlant,
  type CollectionPlant,
} from '../collection/model.ts'
import type { PlantPhoto, PlantPhotoUpdate } from '../lib/database.ts'
import { getSupabase, type OrkiSupabaseClient } from '../lib/supabase.ts'
import { recordError } from './plant-record.ts'
import { PhotoStorageError } from './storage.ts'

// Filas de public.plant_photos (#182, #219): las fotos de una planta, de 0 a
// 6, con su orden. Detrás de una interfaz, como PlantPhotoRecords, para que la
// galería (gallery.ts) no sepa de PostgREST y las pruebas pasen el doble en
// memoria (memory-photo-rows.ts), que imita las reglas de la base.
//
// Lo que garantiza la base (migración 20261122090000_varias_fotos_por_planta.sql):
// - position de 0 a 5 y única por planta: no cabe una séptima foto; una
//   posición ocupada se rechaza con 23505.
// - Las rutas empiezan por "<user_id>/<plant_id>/" y llevan solo un nombre de
//   archivo (23514 si no).
// - La foto principal (la de position más baja) se copia a plants.photo_path,
//   thumbnail_path y photo_in_bloom, así que la tarjeta del inventario no
//   cambia. Tras escribir una foto, la planta de la colección puede quedar
//   desfasada: readPlant() la vuelve a leer.
// - RLS: cada persona lee, crea, cambia y borra solo sus fotos.
// - Reordenar (#183) va por la función reorder_plant_photos de la base
//   (migración 20261124100000): ver reorder().

/** Una foto guardada de una planta, con los nombres de la app. */
export interface StoredPlantPhoto {
  id: string
  plantId: string
  photoPath: string
  thumbnailPath: string
  inBloom: boolean
  /** Fecha de la foto (AAAA-MM-DD), opcional. */
  takenAt: string | null
  /** Nota de la foto, opcional (hasta 500 caracteres, no en blanco). */
  note: string | null
  /** Orden, de 0 a 5; la más baja es la principal. */
  position: number
  createdAt: string
}

/** Lo que se envía al crear una fila. */
export interface PlantPhotoRowInsert {
  plantId: string
  userId: string
  photoPath: string
  thumbnailPath: string
  inBloom: boolean
  takenAt: string | null
  note: string | null
  position: number
}

/**
 * Lo que se cambia de una foto desde el detalle (#183): fecha, nota y si es en
 * floración. Solo las claves presentes se envían.
 */
export interface PlantPhotoRowChanges {
  takenAt?: string | null
  note?: string | null
  inBloom?: boolean
}

/** Columnas que se leen de plant_photos. */
export const PLANT_PHOTO_SELECT =
  'id, plant_id, photo_path, thumbnail_path, in_bloom, taken_at, note, position, created_at'

type PlantPhotoRow = Pick<
  PlantPhoto,
  | 'id'
  | 'plant_id'
  | 'photo_path'
  | 'thumbnail_path'
  | 'in_bloom'
  | 'taken_at'
  | 'note'
  | 'position'
  | 'created_at'
>

export function toStoredPlantPhoto(row: PlantPhotoRow): StoredPlantPhoto {
  return {
    id: row.id,
    plantId: row.plant_id,
    photoPath: row.photo_path,
    thumbnailPath: row.thumbnail_path,
    inBloom: row.in_bloom,
    takenAt: row.taken_at,
    note: row.note,
    position: row.position,
    createdAt: row.created_at,
  }
}

/** Ordena por posición (la principal primero). */
export function byPosition(a: StoredPlantPhoto, b: StoredPlantPhoto): number {
  return a.position - b.position
}

/**
 * Acceso a las filas de plant_photos. Todas rechazan con PhotoStorageError;
 * `uncertain` si la petición salió y no hubo respuesta.
 */
export interface PlantPhotoRows {
  /** Las fotos de la planta, en orden de posición (vacío si no tiene). */
  list(plantId: string, userId: string): Promise<StoredPlantPhoto[]>
  /**
   * Crea una fila. Una posición ocupada rechaza con `position-taken`; una
   * planta que no existe o no es del usuario, con `not-found`.
   */
  insert(photo: PlantPhotoRowInsert): Promise<StoredPlantPhoto>
  /** Borra una fila y la devuelve; null si no existía (o no es del usuario). */
  remove(photoId: string, userId: string): Promise<StoredPlantPhoto | null>
  /**
   * Cambia la fecha, la nota o "en floración" de una foto y la devuelve. Si
   * la fila no existe (o no es del usuario), rechaza con `not-found`.
   */
  update(
    photoId: string,
    userId: string,
    changes: PlantPhotoRowChanges,
  ): Promise<StoredPlantPhoto>
  /**
   * Pone las fotos de la planta en el orden de `photoIds` (posiciones 0, 1,
   * 2...) en una sola sentencia y devuelve todas en orden. `photoIds` tiene
   * que ser exactamente el conjunto de fotos de la planta: si otra foto se
   * añadió o se quitó entre tanto, rechaza con `position-taken` sin cambiar
   * nada.
   */
  reorder(
    plantId: string,
    userId: string,
    photoIds: readonly string[],
  ): Promise<StoredPlantPhoto[]>
  /** La planta con las columnas de la colección (ya con la principal nueva). */
  readPlant(plantId: string, userId: string): Promise<CollectionPlant>
}

interface PostgrestErrorLike {
  code?: unknown
}

/** Error de PostgREST de plant_photos, con los códigos propios de la tabla. */
export function photoRowError(
  error: unknown,
  status: number,
): PhotoStorageError {
  const code = (error as PostgrestErrorLike | null)?.code
  // Índice único (plant_id, position): otra foto ocupa esa posición.
  if (code === '23505') {
    return new PhotoStorageError('position-taken', { cause: error })
  }
  // Clave foránea: la planta no existe.
  if (code === '23503') {
    return new PhotoStorageError('not-found', { cause: error })
  }
  // RLS (with check): la fila no es del usuario del token.
  if (code === '42501') {
    return new PhotoStorageError('forbidden', { cause: error })
  }
  // reorder_plant_photos: la lista no es la de las fotos de la planta (otra
  // se añadió o se quitó entre tanto).
  if (code === '22023') {
    return new PhotoStorageError('position-taken', { cause: error })
  }
  return recordError(error, status)
}

interface SupabaseRowsOptions {
  getClient?: () => Promise<OrkiSupabaseClient>
}

/** Implementación con PostgREST y el cliente compartido de la app. */
export function createSupabasePlantPhotoRows({
  getClient = getSupabase,
}: SupabaseRowsOptions = {}): PlantPhotoRows {
  async function client() {
    try {
      return await getClient()
    } catch (error) {
      throw new PhotoStorageError(
        navigator.onLine === false ? 'offline' : 'failed',
        { cause: error },
      )
    }
  }

  return {
    async list(plantId, userId) {
      const { data, error, status } = await (
        await client()
      )
        .from('plant_photos')
        .select(PLANT_PHOTO_SELECT)
        .eq('plant_id', plantId)
        .eq('user_id', userId)
        .order('position', { ascending: true })
      if (error) throw photoRowError(error, status)
      return data.map(toStoredPlantPhoto).sort(byPosition)
    },

    async insert(photo) {
      const { data, error, status } = await (
        await client()
      )
        .from('plant_photos')
        .insert({
          plant_id: photo.plantId,
          user_id: photo.userId,
          photo_path: photo.photoPath,
          thumbnail_path: photo.thumbnailPath,
          in_bloom: photo.inBloom,
          taken_at: photo.takenAt,
          note: photo.note,
          position: photo.position,
        })
        .select(PLANT_PHOTO_SELECT)
        .single()
      if (error) throw photoRowError(error, status)
      return toStoredPlantPhoto(data)
    },

    async remove(photoId, userId) {
      // Filtrar también por usuario: con el token de otra cuenta no toca nada.
      const { data, error, status } = await (
        await client()
      )
        .from('plant_photos')
        .delete()
        .eq('id', photoId)
        .eq('user_id', userId)
        .select(PLANT_PHOTO_SELECT)
      if (error) throw photoRowError(error, status)
      const [deleted] = data
      return deleted ? toStoredPlantPhoto(deleted) : null
    },

    async update(photoId, userId, changes) {
      const patch: PlantPhotoUpdate = {}
      if (changes.takenAt !== undefined) patch.taken_at = changes.takenAt
      if (changes.note !== undefined) patch.note = changes.note
      if (changes.inBloom !== undefined) patch.in_bloom = changes.inBloom
      // .single(): sin filas (no existe o no es suya), PGRST116 → not-found.
      const { data, error, status } = await (
        await client()
      )
        .from('plant_photos')
        .update(patch)
        .eq('id', photoId)
        .eq('user_id', userId)
        .select(PLANT_PHOTO_SELECT)
        .single()
      if (error) throw photoRowError(error, status)
      return toStoredPlantPhoto(data)
    },

    // El usuario sale del token: la función es security invoker y RLS solo
    // deja ver y cambiar sus fotos.
    async reorder(plantId, _userId, photoIds) {
      // Intercambiar posiciones necesita una sola sentencia: la unicidad de
      // (plant_id, position) se comprueba al final de cada sentencia, y con
      // seis fotos no queda ninguna posición libre de paso. PostgREST no
      // sabe poner un valor distinto en cada fila de un PATCH, y un upsert
      // escribiría plant_id y user_id, que la API no deja cambiar. Por eso va
      // por la función reorder_plant_photos.
      const { data, error, status } = await (
        await client()
      ).rpc('reorder_plant_photos', {
        target_plant_id: plantId,
        photo_ids: [...photoIds],
      })
      if (error) throw photoRowError(error, status)
      const rows = (Array.isArray(data) ? data : []) as PlantPhotoRow[]
      return rows
        .filter((row) => row.plant_id === plantId)
        .map(toStoredPlantPhoto)
        .sort(byPosition)
    },

    async readPlant(plantId, userId) {
      const { data, error, status } = await (
        await client()
      )
        .from('plants')
        .select(COLLECTION_PLANT_SELECT)
        .eq('id', plantId)
        .eq('user_id', userId)
        .single()
      if (error) throw recordError(error, status)
      return toCollectionPlant(data)
    },
  }
}

let shared: PlantPhotoRows | undefined

/** Filas de la app con el cliente compartido. */
export function appPlantPhotoRows(): PlantPhotoRows {
  shared ??= createSupabasePlantPhotoRows()
  return shared
}
