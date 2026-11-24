import { offlineOr } from '../lib/connection.ts'
import {
  getSupabase,
  sessionTokenFailure,
  type OrkiSupabaseClient,
} from '../lib/supabase.ts'
import { PhotoStorageError } from './storage.ts'

// Escrituras en public.plants que acompañan a las fotos: borrar la planta
// (delete.ts). Detrás de una interfaz para que las pruebas pasen un doble.
// Apuntar la planta a una foto (setPhotoPaths) se retiró con el formulario
// de una sola foto (#221): la galería escribe en plant_photos y la base copia
// la principal a plants.

export interface PlantPhotoRecords {
  /**
   * Borra la planta. Rechaza con PhotoStorageError; `uncertain` si la
   * petición salió y no hubo respuesta.
   */
  deletePlant(plantId: string, userId: string): Promise<void>
}

interface PostgrestErrorLike {
  code?: unknown
  message?: unknown
}

/**
 * Error de PostgREST (con su estado HTTP) como PhotoStorageError. Estado 0:
 * la petición salió y no hubo respuesta (`uncertain`).
 */
export function recordError(error: unknown, status: number): PhotoStorageError {
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
      throw new PhotoStorageError(offlineOr('failed'), { cause: error })
    }
  }

  return {
    async deletePlant(plantId, userId) {
      const supabase = await client()
      // Pide la fila borrada: sin filas, la planta no existía o no es suya.
      const { error, status } = await supabase
        .from('plants')
        .delete()
        .eq('id', plantId)
        .eq('user_id', userId)
        .select('id')
        .single()
      if (error) throw recordError(error, status)
    },
  }
}

let shared: PlantPhotoRecords | undefined

/** Escrituras de la app con el cliente compartido. */
export function appPlantPhotoRecords(): PlantPhotoRecords {
  shared ??= createSupabasePlantPhotoRecords()
  return shared
}
