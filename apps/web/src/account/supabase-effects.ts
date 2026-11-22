import {
  getSupabase,
  sessionTokenFailure,
  type OrkiSupabaseClient,
} from '../lib/supabase.ts'
import { PLANT_PHOTOS_BUCKET } from '../photos/paths.ts'
import {
  classifyStorageError,
  type PhotoStorageErrorReason,
} from '../photos/storage.ts'
import {
  AccountDeletionError,
  type AccountDeletionEffects,
  type DeletionFailureReason,
} from './deletion.ts'

// Pasos de datos de la eliminación de la cuenta (fotos, plantas y perfil)
// con el cliente de Supabase de la app y el token de Clerk de la sesión. Las
// políticas lo permiten sin clave de servicio:
// - Storage, plant_photos_delete_own (migración 20261121090000): borra los
//   objetos cuyo primer segmento es el usuario del token; listar usa la
//   política de select del dueño.
// - "Cada usuario borra sus plantas" y "Cada usuario borra su perfil"
//   (migración 20261120180000): borran las filas propias.
// Un borrado que no encuentra nada no es un error, así que los tres son
// idempotentes.

type DataEffects = Omit<AccountDeletionEffects, 'deleteAccount'>

interface Options {
  getClient?: () => Promise<OrkiSupabaseClient>
}

/** Tamaño de página al listar y de lote al borrar en Storage. */
const PAGE = 100

/** Cuántas veces se vuelve a listar tras borrar, por si quedó algo. */
const MAX_PASSES = 3

export function createSupabaseAccountDataEffects({
  getClient = getSupabase,
}: Options = {}): DataEffects {
  async function client(): Promise<OrkiSupabaseClient> {
    try {
      return await getClient()
    } catch (error) {
      // El chunk de supabase-js no llegó o la app no se inicializó.
      throw new AccountDeletionError(
        navigator.onLine === false ? 'offline' : 'failed',
        { cause: error },
      )
    }
  }

  return {
    async deletePhotos(userId) {
      const files = (await client()).storage.from(PLANT_PHOTOS_BUCKET)

      // Lista una "carpeta": los archivos (id no nulo) y las subcarpetas (id
      // nulo; Storage las deduce de las rutas, no existen por sí solas).
      async function list(prefix: string) {
        const names: string[] = []
        const folders: string[] = []
        for (let offset = 0; ; offset += PAGE) {
          const { data, error } = await files.list(prefix, {
            limit: PAGE,
            offset,
            sortBy: { column: 'name', order: 'asc' },
          })
          if (error) throw fromStorage(error)
          for (const entry of data) {
            const path = `${prefix}/${entry.name}`
            if (entry.id === null) folders.push(path)
            else names.push(path)
          }
          if (data.length < PAGE) return { names, folders }
        }
      }

      // Recorre <usuario>/ y <usuario>/<planta>/ (la convención tiene dos
      // niveles; uno más por prudencia) y devuelve todas las rutas.
      async function collect(prefix: string, depth: number): Promise<string[]> {
        const { names, folders } = await list(prefix)
        if (depth === 0) return names
        for (const folder of folders) {
          names.push(...(await collect(folder, depth - 1)))
        }
        return names
      }

      for (let pass = 0; pass < MAX_PASSES; pass += 1) {
        const paths = await collect(userId, 2)
        if (paths.length === 0) return
        for (let index = 0; index < paths.length; index += PAGE) {
          const { error } = await files.remove(paths.slice(index, index + PAGE))
          if (error) throw fromStorage(error)
        }
      }
      // Tras varias pasadas sigue habiendo archivos: no se da por terminado.
      if ((await collect(userId, 2)).length > 0) {
        throw new AccountDeletionError('failed')
      }
    },

    async deletePlants(userId) {
      const { error, status } = await (
        await client()
      )
        .from('plants')
        .delete()
        .eq('user_id', userId)
      if (error) throw fromPostgrest(error, status)
    },

    async deleteProfile(userId) {
      const { error, status } = await (
        await client()
      )
        .from('profiles')
        .delete()
        .eq('id', userId)
      if (error) throw fromPostgrest(error, status)
    },
  }
}

const STORAGE_REASONS: Partial<
  Record<PhotoStorageErrorReason, DeletionFailureReason>
> = {
  offline: 'offline',
  'session-ended': 'session-ended',
}

function fromStorage(error: unknown): AccountDeletionError {
  const classified = classifyStorageError(error)
  return new AccountDeletionError(
    STORAGE_REASONS[classified.reason] ?? 'failed',
    { cause: error },
  )
}

/**
 * Error de supabase-js con el estado HTTP. Estado 0: la petición no obtuvo
 * respuesta (sin red). 401: Supabase no aceptó el token.
 */
function fromPostgrest(error: unknown, status: number): AccountDeletionError {
  const token = sessionTokenFailure(error)
  if (token !== null) return new AccountDeletionError(token, { cause: error })
  if (status === 0) return new AccountDeletionError('offline', { cause: error })
  if (status === 401) {
    return new AccountDeletionError('session-ended', { cause: error })
  }
  return new AccountDeletionError('failed', { cause: error })
}

let shared: DataEffects | undefined

/** Pasos de datos con el cliente compartido de la app. */
export function appAccountDataEffects(): DataEffects {
  shared ??= createSupabaseAccountDataEffects()
  return shared
}
