import {
  COLLECTION_PLANT_SELECT,
  toCollectionPlant,
  type CollectionPlant,
} from '../collection/model.ts'
import {
  getSupabase,
  sessionTokenFailure,
  type OrkiSupabaseClient,
} from '../lib/supabase.ts'
import type { PlantPhotoPaths } from './paths.ts'
import { PhotoStorageError } from './storage.ts'

// Escrituras en public.plants que acompañan a las fotos: apuntar la planta a
// sus rutas nuevas (o a ninguna) y borrarla. Detrás de una interfaz para que
// upload.ts no sepa de PostgREST y las pruebas pasen un doble.

export interface PlantPhotoRecords {
  /**
   * Fija photo_path y thumbnail_path (las dos o ninguna, null) y devuelve la
   * planta actualizada con las columnas de la colección. Rechaza con
   * PhotoStorageError; `uncertain` si la petición salió y no hubo respuesta.
   */
  setPhotoPaths(
    plantId: string,
    userId: string,
    paths: PlantPhotoPaths | null,
  ): Promise<CollectionPlant>
}

interface PostgrestErrorLike {
  code?: unknown
  message?: unknown
}

function recordError(error: unknown, status: number): PhotoStorageError {
  const token = sessionTokenFailure(error)
  // Sin token la petición no salió: seguro que no se aplicó.
  if (token !== null) return new PhotoStorageError(token, { cause: error })
  if (status === 0) {
    return new PhotoStorageError('offline', { cause: error, uncertain: true })
  }
  if (status === 401) {
    return new PhotoStorageError('session-ended', { cause: error })
  }
  // .single() sin filas: la planta no existe o no es del usuario.
  if ((error as PostgrestErrorLike | null)?.code === 'PGRST116') {
    return new PhotoStorageError('not-found', { cause: error })
  }
  return new PhotoStorageError('failed', {
    cause: error,
    uncertain: status >= 500,
  })
}

interface SupabaseRecordsOptions {
  getClient?: () => Promise<OrkiSupabaseClient>
}

/** Implementación con PostgREST y el cliente compartido de la app. */
export function createSupabasePlantPhotoRecords({
  getClient = getSupabase,
}: SupabaseRecordsOptions = {}): PlantPhotoRecords {
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
    async setPhotoPaths(plantId, userId, paths) {
      const supabase = await client()
      // Filtrar también por usuario: con el token de otra cuenta no toca nada.
      const { data, error, status } = await supabase
        .from('plants')
        .update({
          photo_path: paths?.photoPath ?? null,
          thumbnail_path: paths?.thumbnailPath ?? null,
        })
        .eq('id', plantId)
        .eq('user_id', userId)
        .select(COLLECTION_PLANT_SELECT)
        .single()
      if (error) throw recordError(error, status)
      return toCollectionPlant(data)
    },
  }
}

let shared: PlantPhotoRecords | undefined

/** Escrituras de la app con el cliente compartido. */
export function appPlantPhotoRecords(): PlantPhotoRecords {
  shared ??= createSupabasePlantPhotoRecords()
  return shared
}
