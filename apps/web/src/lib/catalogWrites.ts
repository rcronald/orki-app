import { CatalogAdminError, loadClient, toAdminError } from './catalogAdmin.ts'
import type {
  Database,
  SpeciesSource,
  SpeciesStatus,
  SpeciesType,
} from './database.ts'

// Escrituras del catálogo desde el backoffice (issue #106).
//
// Es la única puerta por la que la pantalla escribe el catálogo: cada
// operación llama a una función de administrador de la API (migración
// 20261121120000_escritura_de_especies_del_backoffice.sql; ver
// supabase/README.md, "Escritura del catálogo desde el backoffice"), que hace
// la operación entera en una transacción. La auditoría (#23) podrá apoyarse en
// ese mismo punto.
//
// Los rechazos de la base llegan con un motivo estable en `details` (un JSON
// con `reason` y sus datos) y aquí se traducen a CatalogWriteError: un
// problema, el campo del formulario al que corresponde y un mensaje en
// español. Los fallos de transporte (sin conexión, sesión terminada, sin
// permiso) se clasifican como en las lecturas.

// Problemas ----------------------------------------------------------------------

export type CatalogWriteProblem =
  // Transporte y permisos, como en las lecturas.
  | 'offline'
  | 'session-ended'
  | 'forbidden'
  | 'failed'
  // Especies.
  | 'name-required'
  | 'type-required'
  | 'status-required'
  | 'genus-required'
  | 'invalid-status'
  | 'duplicate-name'
  | 'similar-name'
  | 'genus-not-found'
  | 'species-not-found'
  | 'species-has-plants'
  | 'no-species'
  | 'too-many-species'
  | 'source-ref'

/** Campo del formulario al que se asocia el error (aria-describedby). */
export type CatalogWriteField = 'scientificName' | 'genus' | 'type' | 'status'

/** Datos que acompañan a algunos problemas. */
export interface CatalogWriteDetails {
  /** El nombre de la especie que ya lo tiene (duplicate-name, similar-name). */
  existingName?: string
  existingId?: string
  /** Plantas enlazadas que impiden borrar (species-has-plants). */
  plantCount?: number
  /** Especies de un lote que ya no existen (species-not-found). */
  missingCount?: number
  /** Tope del lote (too-many-species). */
  max?: number
}

/** Tope de especies de un cambio de estado por lote; el mismo que la base. */
export const MAX_BATCH_SPECIES = 100

const FIELD: Partial<Record<CatalogWriteProblem, CatalogWriteField>> = {
  'name-required': 'scientificName',
  'duplicate-name': 'scientificName',
  'similar-name': 'scientificName',
  'type-required': 'type',
  'status-required': 'status',
  'invalid-status': 'status',
  'genus-required': 'genus',
  'genus-not-found': 'genus',
}

function plural(count: number, singular: string, pluralText: string) {
  return `${new Intl.NumberFormat('es').format(count)} ${count === 1 ? singular : pluralText}`
}

/** Mensaje en español de un problema, con sus datos. */
export function catalogWriteMessage(
  problem: CatalogWriteProblem,
  details: CatalogWriteDetails = {},
): string {
  switch (problem) {
    case 'offline':
      return 'Sin conexión: no se guardó nada. Revisa la señal o el wifi y vuelve a intentarlo.'
    case 'session-ended':
      return 'Tu sesión terminó y no se guardó nada. Vuelve a iniciar sesión.'
    case 'forbidden':
      return 'Tu cuenta no tiene permiso de administrador del catálogo: no se guardó nada.'
    case 'failed':
      return 'No se pudo guardar. Vuelve a intentarlo en unos momentos.'
    case 'name-required':
      return 'Escribe el nombre científico.'
    case 'type-required':
      return 'Elige si es una especie o un híbrido.'
    case 'status-required':
      return 'Elige el estado.'
    case 'genus-required':
      return 'Elige el género.'
    case 'invalid-status':
      return 'Una especie dada de alta a mano no puede quedar como importada: elige validada u observada.'
    case 'duplicate-name':
      return details.existingName
        ? `Ya hay una especie con este nombre: «${details.existingName}». Los nombres no distinguen mayúsculas.`
        : 'Ya hay una especie con este nombre. Los nombres no distinguen mayúsculas.'
    case 'similar-name':
      return details.existingName
        ? `Ya hay una especie que se escribe casi igual: «${details.existingName}». Solo cambian las tildes o el signo de híbrido «×».`
        : 'Ya hay una especie que se escribe casi igual: solo cambian las tildes o el signo de híbrido «×».'
    case 'genus-not-found':
      return 'El género elegido ya no está en el catálogo. Elige otro.'
    case 'species-not-found':
      return details.missingCount
        ? `${plural(details.missingCount, 'de las especies elegidas ya no está', 'de las especies elegidas ya no están')} en el catálogo: no se cambió ninguna.`
        : 'Esta especie ya no está en el catálogo.'
    case 'species-has-plants':
      return details.plantCount
        ? `No se puede borrar: ${plural(details.plantCount, 'planta de usuarios la tiene enlazada', 'plantas de usuarios la tienen enlazada')}.`
        : 'No se puede borrar: hay plantas de usuarios enlazadas a esta especie.'
    case 'no-species':
      return 'Elige al menos una especie.'
    case 'too-many-species':
      return `Se pueden cambiar como mucho ${details.max ?? MAX_BATCH_SPECIES} especies a la vez.`
    case 'source-ref':
      return 'La fuente y la referencia de la especie no son coherentes: otra especie ya tiene esa referencia, o la fuente exige una.'
  }
}

export class CatalogWriteError extends Error {
  readonly problem: CatalogWriteProblem
  readonly field: CatalogWriteField | null
  readonly details: CatalogWriteDetails

  constructor(
    problem: CatalogWriteProblem,
    details: CatalogWriteDetails = {},
    options?: { cause?: unknown },
  ) {
    super(catalogWriteMessage(problem, details), options)
    this.name = 'CatalogWriteError'
    this.problem = problem
    this.field = FIELD[problem] ?? null
    this.details = details
  }
}

/**
 * El error como CatalogWriteError: uno de lectura conserva su motivo
 * (sin conexión, sesión, permiso); cualquier otro es 'failed'.
 */
export function toCatalogWriteError(error: unknown): CatalogWriteError {
  if (error instanceof CatalogWriteError) return error
  if (error instanceof CatalogAdminError && error.reason !== 'aborted') {
    return new CatalogWriteError(error.reason, {}, { cause: error })
  }
  return new CatalogWriteError('failed', {}, { cause: error })
}

// Motivos de la base -------------------------------------------------------------

const REASON: Record<string, CatalogWriteProblem> = {
  name_required: 'name-required',
  type_required: 'type-required',
  status_required: 'status-required',
  invalid_status: 'invalid-status',
  duplicate_name: 'duplicate-name',
  similar_name: 'similar-name',
  genus_not_found: 'genus-not-found',
  species_not_found: 'species-not-found',
  species_has_plants: 'species-has-plants',
  no_species: 'no-species',
  too_many_species: 'too-many-species',
}

// Restricciones del esquema, por si la base rechaza la fila sin pasar por las
// comprobaciones de la función (por ejemplo, dos altas a la vez con el mismo
// nombre: la segunda la detiene el índice único).
const CONSTRAINT: Record<string, CatalogWriteProblem> = {
  species_scientific_name_key: 'duplicate-name',
  species_scientific_name_clean: 'name-required',
  species_genus_id_fkey: 'genus-not-found',
  plants_species_id_fkey: 'species-has-plants',
  species_source_ref_key: 'source-ref',
  species_source_ref_not_blank: 'source-ref',
  species_gbif_has_source_ref: 'source-ref',
  species_col_has_source_ref: 'source-ref',
}

interface PostgrestLikeError {
  code?: unknown
  message?: unknown
  details?: unknown
}

function numberOrUndefined(value: unknown): number | undefined {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed)
    ? parsed
    : undefined
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Traduce un rechazo de la base: primero el motivo del detalle JSON; si no lo
 * hay, el nombre de la restricción del mensaje. null si no es ninguno.
 */
export function catalogWriteErrorFromDatabase(
  error: unknown,
): CatalogWriteError | null {
  if (typeof error !== 'object' || error === null) return null
  const { details, message } = error as PostgrestLikeError
  if (typeof details === 'string' && details.startsWith('{')) {
    try {
      const parsed = JSON.parse(details) as Record<string, unknown>
      const problem = REASON[String(parsed.reason)]
      if (problem) {
        return new CatalogWriteError(
          problem,
          {
            existingName: stringOrUndefined(parsed.existing_name),
            existingId: stringOrUndefined(parsed.existing_id),
            plantCount: numberOrUndefined(parsed.plant_count),
            missingCount: numberOrUndefined(parsed.missing_count),
            max: numberOrUndefined(parsed.max),
          },
          { cause: error },
        )
      }
    } catch {
      // Un detalle que no es JSON: se prueba con la restricción.
    }
  }
  if (typeof message === 'string') {
    const constraint = /constraint "([^"]+)"/.exec(message)?.[1]
    const problem = constraint ? CONSTRAINT[constraint] : undefined
    if (problem) return new CatalogWriteError(problem, {}, { cause: error })
  }
  return null
}

// Llamadas ----------------------------------------------------------------------

interface Response<T> {
  data: T | null
  error: unknown
  status: number
}

async function settleWrite<T>(request: PromiseLike<Response<T>>): Promise<T> {
  let response: Response<T>
  try {
    response = await request
  } catch (error) {
    throw fromTransport(error, 0)
  }
  if (response.error) {
    throw (
      catalogWriteErrorFromDatabase(response.error) ??
      fromTransport(response.error, response.status)
    )
  }
  return response.data as T
}

function fromTransport(error: unknown, status: number): CatalogWriteError {
  const reason = toAdminError(error, status, undefined).reason
  return new CatalogWriteError(
    reason === 'aborted' ? 'failed' : reason,
    {},
    {
      cause: error,
    },
  )
}

async function client() {
  try {
    return await loadClient(undefined)
  } catch (error) {
    throw fromTransport(error, 0)
  }
}

/**
 * Texto como lo guarda el catálogo: sin espacios al principio ni al final ni
 * repetidos por dentro. La base hace lo mismo; la pantalla lo usa para validar
 * antes de enviar y para comparar con lo guardado.
 */
export function cleanCatalogText(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

type SpeciesRow = Database['public']['Tables']['species']['Row']

/** Una especie tal como queda tras escribirla. */
export interface WrittenSpecies {
  id: string
  scientificName: string
  genusId: string
  type: SpeciesType
  status: SpeciesStatus
  source: SpeciesSource
  sourceRef: string | null
}

function toWrittenSpecies(row: SpeciesRow): WrittenSpecies {
  return {
    id: row.id,
    scientificName: row.scientific_name,
    genusId: row.genus_id,
    type: row.type,
    status: row.status,
    source: row.source,
    sourceRef: row.source_ref,
  }
}

/** Lo que se escribe de una especie. */
export interface SpeciesInput {
  scientificName: string
  genusId: string | null
  type: SpeciesType
  status: SpeciesStatus
}

/**
 * Comprobaciones previas, sin red: nombre y género. Devuelve el primer
 * problema o null. La base vuelve a comprobarlo todo.
 */
export function validateSpeciesInput(
  input: SpeciesInput,
): CatalogWriteError | null {
  if (cleanCatalogText(input.scientificName) === '')
    return new CatalogWriteError('name-required')
  if (input.genusId === null) return new CatalogWriteError('genus-required')
  return null
}

/**
 * Da de alta una especie o un híbrido. La base le pone la fuente "lista
 * curada" sin referencia.
 */
export async function createCatalogSpecies(
  input: SpeciesInput,
): Promise<WrittenSpecies> {
  const invalid = validateSpeciesInput(input)
  if (invalid) throw invalid
  const supabase = await client()
  const row = await settleWrite(
    supabase.rpc('create_catalog_species', {
      new_scientific_name: cleanCatalogText(input.scientificName),
      new_genus_id: input.genusId ?? '',
      new_type: input.type,
      new_status: input.status,
    }),
  )
  return toWrittenSpecies(row)
}

/**
 * Cambia el nombre, el género, el tipo y el estado de una especie, todo a la
 * vez. Si era importada y cambian sus datos, la base la deja validada; si
 * cambian el género o el tipo, los propaga a las plantas enlazadas.
 */
export async function updateCatalogSpecies(
  id: string,
  input: SpeciesInput,
): Promise<WrittenSpecies> {
  const invalid = validateSpeciesInput(input)
  if (invalid) throw invalid
  const supabase = await client()
  const row = await settleWrite(
    supabase.rpc('update_catalog_species', {
      target_species_id: id,
      new_scientific_name: cleanCatalogText(input.scientificName),
      new_genus_id: input.genusId ?? '',
      new_type: input.type,
      new_status: input.status,
    }),
  )
  return toWrittenSpecies(row)
}

/**
 * Pone un estado a un lote de especies (de 1 a MAX_BATCH_SPECIES), todas o
 * ninguna. Devuelve cuántas cambiaron (las que ya lo tenían no cuentan).
 */
export async function setCatalogSpeciesStatus(
  ids: readonly string[],
  status: SpeciesStatus,
): Promise<number> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) throw new CatalogWriteError('no-species')
  if (unique.length > MAX_BATCH_SPECIES)
    throw new CatalogWriteError('too-many-species', { max: MAX_BATCH_SPECIES })
  const supabase = await client()
  return settleWrite(
    supabase.rpc('set_catalog_species_status', {
      target_species_ids: unique,
      new_status: status,
    }),
  )
}

/**
 * Borra una especie sin plantas enlazadas, con sus nombres. Con plantas, falla
 * con 'species-has-plants' y su número.
 */
export async function deleteCatalogSpecies(id: string): Promise<void> {
  const supabase = await client()
  await settleWrite(
    supabase.rpc('delete_catalog_species', { target_species_id: id }),
  )
}
