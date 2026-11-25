import { offlineOr } from '../lib/connection.ts'
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
import type { PlantStatus } from '../lib/database.ts'
import type { NewPlantInsert, PlantPatch } from './form-state.ts'

/** Dar de baja o reactivar una planta (#16): solo el estado. */
export interface PlantStatusPatch {
  status: PlantStatus
}

// Guardado de una planta nueva en Supabase (#85).
//
//   POST /rest/v1/plants?select=<COLLECTION_PLANT_SELECT>
//   Prefer: return=representation
//   { id, entered_name, genus_id, type, acquired_on[, species_id] }
//
// - La fila vuelve con las mismas columnas que lee la colección, para
//   reflejarla con upsertPlant() sin volver a leerlo todo. Con especie, el
//   disparador de la base ya puso el género, el tipo y la validación de la
//   especie, y la fila devuelta los trae.
// - Sin `user_id` ni `validation`: la base pone el usuario del token y la
//   validación (y authenticated no puede escribir validation).
// - Reintento sin duplicados: el id lo genera la app y se reutiliza al
//   reintentar el mismo registro. Si el primer intento sí llegó a la base pero
//   la respuesta se perdió, el segundo choca con la clave primaria (23505) y
//   se lee la planta ya guardada en lugar de crear otra.
// - postgrest-js no reintenta las escrituras: un fallo llega enseguida.

/**
 * Por qué no se pudo guardar:
 * - offline: sin conexión (o la red falló antes de llegar a Supabase).
 * - session-ended: la sesión terminó o Supabase no la acepta.
 * - invalid: la base rechazó los datos (una restricción); `message` dice cuál.
 * - not-found: al editar, la planta ya no existe o no es del usuario.
 * - failed: error del servidor o cualquier otro.
 */
export type PlantSaveFailure =
  'offline' | 'session-ended' | 'invalid' | 'not-found' | 'failed'

export const PLANT_SAVE_ERROR_TEXT: Record<PlantSaveFailure, string> = {
  offline:
    'Sin conexión: no se pudo registrar la orquídea. Lo que escribiste sigue aquí; vuelve a intentarlo cuando tengas conexión.',
  'session-ended':
    'Tu sesión terminó: no se pudo registrar la orquídea. Vuelve a iniciar sesión e inténtalo de nuevo.',
  invalid:
    'La base de datos no aceptó el registro. Revisa los datos y vuelve a intentarlo.',
  'not-found': 'Esta orquídea ya no está en tu colección.',
  failed:
    'No se pudo registrar la orquídea por un error del servidor. Vuelve a intentarlo en unos momentos.',
}

/** Los mismos motivos al guardar los cambios de una planta (#16). */
export const PLANT_UPDATE_ERROR_TEXT: Record<PlantSaveFailure, string> = {
  offline:
    'Sin conexión: no se pudieron guardar los cambios. Lo que escribiste sigue aquí; vuelve a intentarlo cuando tengas conexión.',
  'session-ended':
    'Tu sesión terminó: no se pudieron guardar los cambios. Vuelve a iniciar sesión e inténtalo de nuevo.',
  invalid:
    'La base de datos no aceptó los cambios. Revisa los datos y vuelve a intentarlo.',
  'not-found':
    'Esta planta ya no está en tu colección: puede que se haya eliminado desde otro dispositivo.',
  failed:
    'No se pudieron guardar los cambios por un error del servidor. Vuelve a intentarlo en unos momentos.',
}

/** Rechazos de la base traducidos, por restricción o por código de Postgres. */
export const PLANT_INVALID_TEXT = {
  name: 'La base de datos no aceptó el nombre: no puede quedar vacío ni pasar de 200 caracteres.',
  futureDate:
    'La base de datos no aceptó la fecha: no puede ser futura. Revisa la fecha de tu dispositivo.',
  date: 'La base de datos no aceptó la fecha de adquisición. Revisa que sea válida.',
  species:
    'La especie elegida ya no está en el catálogo. Vuelve a buscarla en el nombre.',
  genus:
    'El género elegido ya no está en el catálogo. Vuelve a elegir el género.',
} as const

export class PlantSaveError extends Error {
  readonly reason: PlantSaveFailure

  constructor(
    reason: PlantSaveFailure,
    options?: { message?: string; cause?: unknown },
  ) {
    super(options?.message ?? PLANT_SAVE_ERROR_TEXT[reason], {
      cause: options?.cause,
    })
    this.name = 'PlantSaveError'
    this.reason = reason
  }
}

/** Error de guardado de cualquier error; lo desconocido cuenta como 'failed'. */
export function plantSaveErrorFrom(error: unknown): PlantSaveError {
  if (error instanceof PlantSaveError) return error
  return new PlantSaveError('failed', { cause: error })
}

interface PostgrestLikeError {
  code?: string
  message?: string
  details?: string | null
}

/** Los campos de texto de un error de PostgREST, sin suponer su forma. */
function postgrestError(error: unknown): PostgrestLikeError {
  if (typeof error !== 'object' || error === null) return {}
  const text = (key: string) => {
    const value: unknown = Reflect.get(error, key)
    return typeof value === 'string' ? value : undefined
  }
  return {
    code: text('code'),
    message: text('message'),
    details: text('details') ?? null,
  }
}

/**
 * Traduce el `error` de postgrest-js con el estado HTTP de la respuesta.
 * Estado 0: la petición no obtuvo respuesta (sin red, DNS, portal cautivo).
 */
export function toPlantSaveError(
  error: unknown,
  status: number,
  texts: Record<PlantSaveFailure, string> = PLANT_SAVE_ERROR_TEXT,
): PlantSaveError {
  const failure = (reason: PlantSaveFailure, message = texts[reason]) =>
    new PlantSaveError(reason, { message, cause: error })
  const tokenFailure = sessionTokenFailure(error)
  if (tokenFailure !== null) return failure(tokenFailure)
  if (status === 0) return failure('offline')
  if (status === 401) return failure('session-ended')
  // .single() sin filas: al editar, la planta no existe o no es del usuario.
  const details = postgrestError(error)
  if (details.code === 'PGRST116') return failure('not-found')
  const invalid = invalidDataText(details, texts.invalid)
  if (invalid !== null) return failure('invalid', invalid)
  return failure('failed')
}

function invalidDataText(
  error: PostgrestLikeError,
  generic: string,
): string | null {
  const code = error.code ?? ''
  const text = `${error.message ?? ''} ${error.details ?? ''}`
  switch (code) {
    case '23514': // check_violation
      if (text.includes('plants_entered_name_valid')) {
        return PLANT_INVALID_TEXT.name
      }
      if (text.includes('plants_acquired_on_not_future')) {
        return PLANT_INVALID_TEXT.futureDate
      }
      return generic
    case '23503': // foreign_key_violation
      if (text.includes('species_id')) return PLANT_INVALID_TEXT.species
      if (text.includes('genus_id')) return PLANT_INVALID_TEXT.genus
      return generic
    case '22007': // invalid_datetime_format
    case '22008': // datetime_field_overflow
      return PLANT_INVALID_TEXT.date
    case '22001': // string_data_right_truncation
    case '22P02': // invalid_text_representation (uuid o enumerado)
    case '23502': // not_null_violation
      return generic
    default:
      return null
  }
}

function isDuplicateId(error: PostgrestLikeError): boolean {
  return error.code === '23505' && (error.message ?? '').includes('plants_pkey')
}

interface InsertPlantOptions {
  /** Cliente de Supabase; por defecto, el compartido de la app. */
  getClient?: () => Promise<OrkiSupabaseClient>
}

/**
 * Inserta la planta y la devuelve como planta de la colección. Se rechaza con
 * PlantSaveError.
 */
export async function insertPlant(
  insert: NewPlantInsert,
  { getClient = getSupabase }: InsertPlantOptions = {},
): Promise<CollectionPlant> {
  let supabase: OrkiSupabaseClient
  try {
    supabase = await getClient()
  } catch (error) {
    throw new PlantSaveError(offlineOr('failed'), { cause: error })
  }

  const { data, error, status } = await supabase
    .from('plants')
    .insert(insert)
    .select(COLLECTION_PLANT_SELECT)
    .single()
  if (!error) return toCollectionPlant(data)

  if (isDuplicateId(error)) {
    // Un intento anterior con este id ya la guardó: se lee la que hay.
    const existing = await supabase
      .from('plants')
      .select(COLLECTION_PLANT_SELECT)
      .eq('id', insert.id)
      .maybeSingle()
    if (existing.error) {
      throw toPlantSaveError(existing.error, existing.status)
    }
    if (existing.data) return toCollectionPlant(existing.data)
  }
  throw toPlantSaveError(error, status)
}

/**
 * Guarda los cambios de una planta (#16): actualización parcial con solo las
 * columnas que cambiaron (o solo el estado, al dar de baja o reactivar), filtrada también por usuario (con el token de otra
 * cuenta no toca nada), y la devuelve como planta de la colección. Sin
 * cambios no se llama. Se rechaza con PlantSaveError (los textos de
 * PLANT_UPDATE_ERROR_TEXT); not-found si la planta no existe o no es suya.
 *
 *   PATCH /rest/v1/plants?id=eq.<id>&user_id=eq.<usuario>&select=<COLLECTION_PLANT_SELECT>
 *   { nickname: "La blanca" }
 */
export async function updatePlant(
  plantId: string,
  userId: string,
  patch: PlantPatch | PlantStatusPatch,
  { getClient = getSupabase }: InsertPlantOptions = {},
): Promise<CollectionPlant> {
  let supabase: OrkiSupabaseClient
  try {
    supabase = await getClient()
  } catch (error) {
    const reason = offlineOr('failed')
    throw new PlantSaveError(reason, {
      cause: error,
      message: PLANT_UPDATE_ERROR_TEXT[reason],
    })
  }
  const { data, error, status } = await supabase
    .from('plants')
    .update(patch)
    .eq('id', plantId)
    .eq('user_id', userId)
    .select(COLLECTION_PLANT_SELECT)
    .single()
  if (error) throw toPlantSaveError(error, status, PLANT_UPDATE_ERROR_TEXT)
  return toCollectionPlant(data)
}
