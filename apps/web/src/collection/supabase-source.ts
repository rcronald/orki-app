import { offlineOr } from '../lib/connection.ts'
import { getSupabase, sessionTokenFailure } from '../lib/supabase.ts'
import type { OrkiSupabaseClient } from '../lib/supabase.ts'
import {
  COLLECTION_PLANT_SELECT,
  toCollectionPlant,
  withMainPhotoOnly,
  type CollectionPlant,
} from './model.ts'
import {
  CollectionLoadError,
  type CollectionErrorReason,
  type CollectionSource,
} from './source.ts'

// Lectura de la colección desde Supabase (PostgREST).
//
// Consulta, por página:
//   GET /rest/v1/plants?select=<COLLECTION_PLANT_SELECT>&user_id=eq.<usuario>
//       &plant_photos.order=position.asc&plant_photos.limit=1
//       [&id=gt.<último id de la página anterior>]&order=id.asc&limit=1000
//
// - Foto principal (#186): embebida de plant_photos, solo la de position más
//   baja (withMainPhotoOnly, en model.ts); no se leen las columnas de foto de
//   plants. El límite de la tabla embebida no cuenta para el de la página.
//
// - Filtro por usuario: las políticas RLS ya limitan la lectura a las plantas
//   del usuario del token, pero se pide además el del usuario activo. Si la
//   petición saliera con el token de otra cuenta (cambio de usuario a mitad de
//   camino), devolvería vacío en lugar de las plantas de la otra cuenta.
// - Paginación: la API devuelve como mucho 1 000 filas por petición (max-rows
//   del proyecto). postgrest-js no pagina solo: range(from, to) solo añade
//   offset y limit a la URL. Aquí se pagina por clave (keyset) sobre id: cada
//   página pide las filas con id mayor que el último recibido, en orden de id.
//   Frente a offset, una planta creada o borrada desde otro dispositivo
//   mientras se leen las páginas no hace saltar ni repetir filas, y cada página
//   cuesta lo mismo. Termina cuando una página trae menos filas que el tamaño
//   pedido. COLLECTION_PAGE_SIZE no debe superar el max-rows del proyecto: si
//   alguien lo baja, una página llegaría corta y la lectura pararía antes.
// - Orden estable: por id. El orden que ve el usuario lo ponen las funciones
//   de selectors.ts en el dispositivo.
// - Reintentos: los de postgrest-js para lecturas (1, 2 y 4 s ante un fallo de
//   red, un 503 o un 520, o si falta el token de sesión). Con mala señal
//   ayudan; sin conexión, el error tarda unos 7 s en llegar.

/** Filas por petición: el tope de filas de la API de Supabase. */
export const COLLECTION_PAGE_SIZE = 1000

interface SupabaseSourceOptions {
  /** Cliente de Supabase; por defecto, el compartido de la app. */
  getClient?: () => Promise<OrkiSupabaseClient>
  /** Filas por petición; por defecto COLLECTION_PAGE_SIZE. */
  pageSize?: number
}

/** Crea una fuente de la colección que lee de Supabase. */
export function createSupabaseCollectionSource({
  getClient = getSupabase,
  pageSize = COLLECTION_PAGE_SIZE,
}: SupabaseSourceOptions = {}): CollectionSource {
  return {
    async load({ userId, signal }) {
      let supabase: OrkiSupabaseClient
      try {
        supabase = await getClient()
      } catch (error) {
        // El chunk del cliente de Supabase no llegó (sin conexión y sin la caché del
        // service worker) o la app no se inicializó.
        throw new CollectionLoadError(offlineOr('failed'), { cause: error })
      }
      signal.throwIfAborted()

      const plants: CollectionPlant[] = []
      let lastId: string | null = null
      for (;;) {
        let query = withMainPhotoOnly(
          supabase
            .from('plants')
            .select(COLLECTION_PLANT_SELECT)
            .eq('user_id', userId),
        )
        if (lastId !== null) query = query.gt('id', lastId)
        const { data, error, status } = await query
          .order('id', { ascending: true })
          .limit(pageSize)
          .abortSignal(signal)
        signal.throwIfAborted()
        if (error) {
          throw new CollectionLoadError(failureReason(error, status), {
            cause: error,
          })
        }
        for (const row of data) plants.push(toCollectionPlant(row))
        const last = data.at(-1)
        if (data.length < pageSize || last === undefined) return plants
        lastId = last.id
      }
    },
  }
}

/** Fuente de la app: Supabase con el cliente compartido. */
export const supabaseCollectionSource = createSupabaseCollectionSource()

/**
 * Motivo de un error de PostgREST:
 * - Sin token de sesión (SessionTokenError): su propio motivo.
 * - Estado 0 (la petición no llegó a responder: red caída, DNS, CORS por un
 *   portal cautivo): sin conexión.
 * - 401: Supabase no acepta el token (caducado o inválido) o la petición salió
 *   sin sesión; para el usuario, la sesión terminó.
 * - Cualquier otro: fallo.
 */
function failureReason(error: unknown, status: number): CollectionErrorReason {
  const tokenFailure = sessionTokenFailure(error)
  if (tokenFailure !== null) return tokenFailure
  if (status === 0) return 'offline'
  if (status === 401) return 'session-ended'
  return 'failed'
}
