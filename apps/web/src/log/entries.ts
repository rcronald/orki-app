import type { PlantLogEntryType } from '../lib/database.ts'
import {
  getSupabase,
  sessionTokenFailure,
  type OrkiSupabaseClient,
} from '../lib/supabase.ts'
import { toLogEntry, type LogEntry } from './model.ts'

// Acceso a la bitácora de una planta (#267) detrás de una interfaz, como las
// filas de plant_photos (photos/photo-rows.ts): la sección de la ficha no
// sabe de PostgREST y las pruebas y /muestra pasan el doble en memoria
// (memory-entries.ts), que imita las reglas de la base.
//
// Lo que garantiza la base (migración 20261124120000, «Bitácora» en
// supabase/README.md):
// - add_plant_log_entry crea el registro; con una idempotency_key ya usada
//   para esa planta devuelve el que existía (un reintento no duplica), y si se
//   usó en otra planta, 22023.
// - list_plant_log_entries: del más reciente al más antiguo (created_at desc,
//   id desc), con filtro por tipo y cursor (created_at e id del último leído;
//   created_at como texto, tal como llegó, para no perder los microsegundos).
// - RLS: cada persona lee, crea y borra solo los suyos; no hay update.

/** Por qué falló una operación con la bitácora. */
export type PlantLogErrorReason =
  'offline' | 'session-ended' | 'not-found' | 'invalid' | 'failed'

export class PlantLogError extends Error {
  readonly reason: PlantLogErrorReason
  /**
   * true si la petición salió y no llegó respuesta (o el servidor falló):
   * quizá se aplicó. Quien compensa (borrar la foto subida) no debe dar por
   * hecho que falló.
   */
  readonly uncertain: boolean

  constructor(
    reason: PlantLogErrorReason,
    options?: { cause?: unknown; uncertain?: boolean },
  ) {
    super(
      `Bitácora: ${reason}`,
      options?.cause === undefined ? undefined : { cause: options.cause },
    )
    this.name = 'PlantLogError'
    this.reason = reason
    this.uncertain = options?.uncertain ?? false
  }
}

export function plantLogErrorFrom(error: unknown): PlantLogError {
  if (error instanceof PlantLogError) return error
  return new PlantLogError('failed', { cause: error })
}

interface PostgrestErrorLike {
  code?: unknown
}

/** Error de PostgREST (con su estado HTTP) como PlantLogError. */
export function plantLogErrorFromPostgrest(
  error: unknown,
  status: number,
): PlantLogError {
  const token = sessionTokenFailure(error)
  // Sin token la petición no salió: seguro que no se aplicó.
  if (token !== null) return new PlantLogError(token, { cause: error })
  if (status === 0) {
    return new PlantLogError('offline', { cause: error, uncertain: true })
  }
  if (status === 401)
    return new PlantLogError('session-ended', { cause: error })
  const code = (error as PostgrestErrorLike | null)?.code
  // Planta ajena o que ya no existe: RLS (with check), clave foránea o
  // .single() sin filas.
  if (code === '42501' || code === '23503' || code === 'PGRST116') {
    return new PlantLogError('not-found', { cause: error })
  }
  // Restricciones de la tabla (título en blanco o largo) o la clave de
  // reintento usada en otra planta.
  if (code === '23514' || code === '22001' || code === '22023') {
    return new PlantLogError('invalid', { cause: error })
  }
  return new PlantLogError('failed', {
    cause: error,
    uncertain: status >= 500,
  })
}

/** Cursor de la página siguiente: el último registro leído. */
export interface LogCursor {
  createdAt: string
  id: string
}

export interface ListLogEntriesInput {
  plantId: string
  /** Solo un tipo de actividad; null, todos. */
  type: PlantLogEntryType | null
  before: LogCursor | null
  /** De 1 a 100. */
  pageSize: number
}

export interface AddLogEntryInput {
  plantId: string
  type: PlantLogEntryType
  title: string
  description: string | null
  photoPath: string | null
  thumbnailPath: string | null
  inBloom: boolean | null
  /** La misma en cada reintento del mismo formulario. */
  idempotencyKey: string
}

/** La bitácora en la base. Todas rechazan con PlantLogError. */
export interface PlantLogEntries {
  /** Una página, del más reciente al más antiguo. */
  list(input: ListLogEntriesInput): Promise<LogEntry[]>
  /** Crea un registro (o devuelve el de esa clave, si ya existía). */
  add(input: AddLogEntryInput): Promise<LogEntry>
  /** Borra un registro y lo devuelve; null si ya no existía (o no es suyo). */
  remove(entryId: string, userId: string): Promise<LogEntry | null>
}

const LOG_ENTRY_SELECT =
  'id, plant_id, type, title, description, photo_path, thumbnail_path, in_bloom, created_at'

interface SupabaseLogOptions {
  getClient?: () => Promise<OrkiSupabaseClient>
}

/** Implementación con PostgREST y el cliente compartido de la app. */
export function createSupabasePlantLogEntries({
  getClient = getSupabase,
}: SupabaseLogOptions = {}): PlantLogEntries {
  async function client() {
    try {
      return await getClient()
    } catch (error) {
      // El chunk del cliente de Supabase no llegó o la app no se inicializó.
      throw new PlantLogError(
        navigator.onLine === false ? 'offline' : 'failed',
        { cause: error },
      )
    }
  }

  return {
    async list({ plantId, type, before, pageSize }) {
      // Los parámetros sin valor no se envían: la función los toma como null.
      const { data, error, status } = await (
        await client()
      ).rpc('list_plant_log_entries', {
        target_plant_id: plantId,
        entry_type: type ?? undefined,
        before_created_at: before?.createdAt,
        before_id: before?.id,
        page_size: pageSize,
      })
      if (error) throw plantLogErrorFromPostgrest(error, status)
      return (Array.isArray(data) ? data : []).map(toLogEntry)
    },

    async add(input) {
      const { data, error, status } = await (
        await client()
      ).rpc('add_plant_log_entry', {
        target_plant_id: input.plantId,
        entry_type: input.type,
        title: input.title,
        description: input.description ?? undefined,
        photo_path: input.photoPath ?? undefined,
        thumbnail_path: input.thumbnailPath ?? undefined,
        in_bloom: input.inBloom ?? undefined,
        idempotency_key: input.idempotencyKey,
      })
      if (error) throw plantLogErrorFromPostgrest(error, status)
      return toLogEntry(data)
    },

    async remove(entryId, userId) {
      // Filtrar también por usuario: con el token de otra cuenta no toca nada.
      const { data, error, status } = await (
        await client()
      )
        .from('plant_log_entries')
        .delete()
        .eq('id', entryId)
        .eq('user_id', userId)
        .select(LOG_ENTRY_SELECT)
      if (error) throw plantLogErrorFromPostgrest(error, status)
      const [deleted] = data
      return deleted ? toLogEntry(deleted) : null
    },
  }
}

let shared: PlantLogEntries | undefined

/** La bitácora de la app con el cliente compartido. */
export function appPlantLogEntries(): PlantLogEntries {
  shared ??= createSupabasePlantLogEntries()
  return shared
}
