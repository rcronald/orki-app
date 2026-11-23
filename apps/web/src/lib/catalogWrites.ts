import {
  CatalogAdminError,
  loadClient,
  toAdminError,
  type ProposalGroupKey,
} from './catalogAdmin.ts'
import type {
  Database,
  Json,
  SpeciesMergePreviewRow,
  SpeciesMergeResultRow,
  SpeciesNameType,
  SpeciesPhotoRejectionReason,
  SpeciesSource,
  SpeciesStatus,
  SpeciesType,
} from './database.ts'

// Escrituras del catálogo desde el backoffice (issues #106 y #107).
//
// Es la única puerta por la que la pantalla escribe el catálogo: cada
// operación llama a una función de administrador de la API (migraciones
// 20261121120000_escritura_de_especies_del_backoffice.sql y
// 20261121130000_nombres_generos_y_abreviaturas_del_backoffice.sql; ver
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
  | 'same-species'
  | 'no-species'
  | 'too-many-species'
  | 'source-ref'
  // Sinónimos y nombres comunes.
  | 'name-type-required'
  | 'invalid-language'
  | 'duplicate-alternative-name'
  | 'similar-alternative-name'
  | 'name-is-scientific-name'
  | 'name-not-found'
  // Géneros y abreviaturas.
  | 'invalid-genus-name'
  | 'quick-access-required'
  | 'duplicate-genus'
  | 'similar-genus'
  | 'genus-has-species'
  | 'genus-has-plants'
  | 'invalid-abbreviation'
  | 'abbreviation-taken'
  | 'abbreviation-not-found'
  // Cola de propuestas.
  | 'group-required'
  // Fotos de referencia (#234).
  | 'reason-required'
  | 'species-photo-not-found'

/** Campo del formulario al que se asocia el error (aria-describedby). */
export type CatalogWriteField =
  | 'scientificName'
  | 'genus'
  | 'type'
  | 'status'
  /** El texto de un sinónimo, un nombre común, un género o una abreviatura. */
  | 'text'
  | 'language'

/** Datos que acompañan a algunos problemas. */
export interface CatalogWriteDetails {
  /** El nombre de la especie que ya lo tiene (duplicate-name, similar-name). */
  existingName?: string
  existingId?: string
  /** Plantas enlazadas que impiden borrar (species-has-plants). */
  plantCount?: number
  /** Especies de un lote que ya no existen (species-not-found). */
  missingCount?: number
  /**
   * En una fusión, cuál de las dos especies ya no existe (species-not-found):
   * la que se absorbe (merged) o la que se conserva (kept).
   */
  speciesRole?: 'merged' | 'kept'
  /** Id de la especie que ya no existe (species-not-found de una fusión). */
  speciesId?: string
  /** Tope del lote (too-many-species). */
  max?: number
  /** Tipo del nombre que ya tiene la especie (duplicate-alternative-name). */
  existingType?: 'synonym' | 'common'
  /** Especies que impiden borrar un género (genus-has-species). */
  speciesCount?: number
  /** Género que ya tiene la abreviatura (abbreviation-taken). */
  genusName?: string
  genusId?: string
  existingAbbreviation?: string
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
  'name-type-required': 'type',
  'invalid-language': 'language',
  'duplicate-alternative-name': 'text',
  'similar-alternative-name': 'text',
  'name-is-scientific-name': 'text',
  'invalid-genus-name': 'text',
  'duplicate-genus': 'text',
  'similar-genus': 'text',
  'invalid-abbreviation': 'text',
  'abbreviation-taken': 'text',
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
      if (details.speciesRole === 'merged')
        return 'La especie que se absorbía ya no está en el catálogo: puede que otra persona la haya fusionado o borrado. No se cambió nada.'
      if (details.speciesRole === 'kept')
        return 'La especie que se conservaba ya no está en el catálogo: puede que otra persona la haya fusionado o borrado. No se cambió nada.'
      return details.missingCount
        ? `${plural(details.missingCount, 'de las especies elegidas ya no está', 'de las especies elegidas ya no están')} en el catálogo: no se cambió ninguna.`
        : 'Esta especie ya no está en el catálogo.'
    case 'same-species':
      return 'Elige dos especies distintas: una especie no se puede fusionar consigo misma.'
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
    case 'name-type-required':
      return 'Elige si es un sinónimo o un nombre común.'
    case 'invalid-language':
      return 'El idioma es una etiqueta corta, como es, en o pt-BR. Déjalo vacío si no lo sabes.'
    case 'duplicate-alternative-name':
      return details.existingName
        ? `La especie ya tiene este nombre: «${details.existingName}»${details.existingType ? ` (${details.existingType === 'synonym' ? 'sinónimo' : 'nombre común'})` : ''}. Los nombres no distinguen mayúsculas.`
        : 'La especie ya tiene este nombre. Los nombres no distinguen mayúsculas.'
    case 'similar-alternative-name':
      return details.existingName
        ? `La especie ya tiene un nombre que se escribe casi igual: «${details.existingName}». Solo cambian las tildes o el signo de híbrido «×».`
        : 'La especie ya tiene un nombre que se escribe casi igual: solo cambian las tildes o el signo de híbrido «×».'
    case 'name-is-scientific-name':
      return 'Ese es el nombre científico de la especie: no hace falta añadirlo como otro nombre.'
    case 'name-not-found':
      return 'Este nombre ya no está en el catálogo.'
    case 'invalid-genus-name':
      return 'El nombre de un género es una sola palabra, con «× » delante si es un nothogénero.'
    case 'quick-access-required':
      return 'Indica si es de acceso rápido.'
    case 'duplicate-genus':
      return details.existingName
        ? `Ya hay un género con este nombre: «${details.existingName}». Los nombres no distinguen mayúsculas.`
        : 'Ya hay un género con este nombre.'
    case 'similar-genus':
      return details.existingName
        ? `Ya hay un género que se escribe casi igual: «${details.existingName}». Solo cambian las tildes o el signo de híbrido «×».`
        : 'Ya hay un género que se escribe casi igual: solo cambian las tildes o el signo de híbrido «×».'
    case 'genus-has-species':
      return details.speciesCount
        ? `No se puede borrar: el género tiene ${plural(details.speciesCount, 'especie', 'especies')}. Bórralas o cámbialas de género antes.`
        : 'No se puede borrar: el género tiene especies.'
    case 'genus-has-plants':
      return details.plantCount
        ? `No se puede borrar: ${plural(details.plantCount, 'planta de usuarios está registrada', 'plantas de usuarios están registradas')} con este género.`
        : 'No se puede borrar: hay plantas de usuarios registradas con este género.'
    case 'invalid-abbreviation':
      return 'Una abreviatura es una sola palabra con su punto final, como Phal.'
    case 'abbreviation-taken':
      return details.genusName
        ? `La abreviatura «${details.existingAbbreviation ?? ''}» ya es del género ${details.genusName}: una abreviatura solo puede ser de un género (sin distinguir mayúsculas, tildes ni el punto final).`
        : 'Esa abreviatura ya es de otro género.'
    case 'abbreviation-not-found':
      return 'Esta abreviatura ya no está en el catálogo.'
    case 'group-required':
      return 'Falta el grupo de la propuesta: vuelve a cargar la cola.'
    case 'reason-required':
      return 'Elige por qué se retira la foto: mal identificada, inapropiada, a petición del autor u otro motivo.'
    case 'species-photo-not-found':
      return 'La foto de referencia de esta especie cambió (otra persona la retiró o la carga la sustituyó): no se retiró nada. Se volvió a cargar el detalle.'
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
  same_species: 'same-species',
  no_species: 'no-species',
  too_many_species: 'too-many-species',
  name_type_required: 'name-type-required',
  invalid_language: 'invalid-language',
  duplicate_alternative_name: 'duplicate-alternative-name',
  similar_alternative_name: 'similar-alternative-name',
  name_is_scientific_name: 'name-is-scientific-name',
  name_not_found: 'name-not-found',
  invalid_genus_name: 'invalid-genus-name',
  quick_access_required: 'quick-access-required',
  duplicate_genus: 'duplicate-genus',
  similar_genus: 'similar-genus',
  genus_has_species: 'genus-has-species',
  genus_has_plants: 'genus-has-plants',
  invalid_abbreviation: 'invalid-abbreviation',
  abbreviation_taken: 'abbreviation-taken',
  abbreviation_not_found: 'abbreviation-not-found',
  group_required: 'group-required',
  reason_required: 'reason-required',
  species_photo_not_found: 'species-photo-not-found',
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
  species_names_species_id_name_key: 'duplicate-alternative-name',
  species_names_name_clean: 'name-required',
  species_names_language_format: 'invalid-language',
  genera_name_key: 'duplicate-genus',
  genera_name_clean: 'name-required',
  genus_abbreviations_abbreviation_key: 'abbreviation-taken',
  genus_abbreviations_search_key: 'abbreviation-taken',
  genus_abbreviations_abbreviation_clean: 'invalid-abbreviation',
  plants_genus_id_fkey: 'genus-has-plants',
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
            speciesRole:
              parsed.species_role === 'merged' || parsed.species_role === 'kept'
                ? parsed.species_role
                : undefined,
            speciesId: stringOrUndefined(parsed.species_id),
            max: numberOrUndefined(parsed.max),
            existingType:
              parsed.existing_type === 'synonym' ||
              parsed.existing_type === 'common'
                ? parsed.existing_type
                : undefined,
            speciesCount: numberOrUndefined(parsed.species_count),
            genusName: stringOrUndefined(parsed.genus_name),
            genusId: stringOrUndefined(parsed.genus_id),
            existingAbbreviation: stringOrUndefined(
              parsed.existing_abbreviation,
            ),
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
    // Borrar un género con especies lo rechaza la misma clave foránea que
    // dar de alta una especie con un género inexistente.
    const problem =
      constraint === 'species_genus_id_fkey' &&
      message.startsWith('update or delete on table "genera"')
        ? 'genus-has-species'
        : constraint
          ? CONSTRAINT[constraint]
          : undefined
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

// Sinónimos y nombres comunes ------------------------------------------------------

/** Un sinónimo o un nombre común tal como queda tras escribirlo. */
export interface WrittenName {
  id: string
  speciesId: string
  name: string
  type: SpeciesNameType
  language: string | null
}

/** Lo que se escribe de un nombre. El idioma solo cuenta en los comunes. */
export interface SpeciesNameInput {
  name: string
  type: SpeciesNameType
  language?: string | null
}

type NameRow = Database['public']['Tables']['species_names']['Row']

function toWrittenName(row: NameRow): WrittenName {
  return {
    id: row.id,
    speciesId: row.species_id,
    name: row.name,
    type: row.type,
    language: row.language,
  }
}

function nameArgs(input: SpeciesNameInput) {
  const language = input.language?.trim() ?? ''
  return {
    new_name: cleanCatalogText(input.name),
    new_type: input.type,
    ...(input.type === 'common' &&
      language !== '' && { new_language: language }),
  }
}

function requireText(text: string): void {
  if (cleanCatalogText(text) === '')
    throw new CatalogWriteError('name-required')
}

/** Añade un sinónimo o un nombre común a una especie. */
export async function addSpeciesName(
  speciesId: string,
  input: SpeciesNameInput,
): Promise<WrittenName> {
  requireText(input.name)
  const supabase = await client()
  const row = await settleWrite(
    supabase.rpc('add_species_name', {
      target_species_id: speciesId,
      ...nameArgs(input),
    }),
  )
  return toWrittenName(row)
}

/** Cambia el texto, el tipo y el idioma de un nombre. */
export async function updateSpeciesName(
  nameId: string,
  input: SpeciesNameInput,
): Promise<WrittenName> {
  requireText(input.name)
  const supabase = await client()
  const row = await settleWrite(
    supabase.rpc('update_species_name', {
      target_name_id: nameId,
      ...nameArgs(input),
    }),
  )
  return toWrittenName(row)
}

/** Quita un sinónimo o un nombre común. */
export async function deleteSpeciesName(nameId: string): Promise<void> {
  const supabase = await client()
  await settleWrite(
    supabase.rpc('delete_species_name', { target_name_id: nameId }),
  )
}

// Géneros y abreviaturas -----------------------------------------------------------

/** Un género tal como queda tras escribirlo. */
export interface WrittenGenus {
  id: string
  name: string
  isQuickAccess: boolean
}

export interface GenusInput {
  name: string
  isQuickAccess: boolean
}

type GenusRow = Database['public']['Tables']['genera']['Row']

function toWrittenGenus(row: GenusRow): WrittenGenus {
  return { id: row.id, name: row.name, isQuickAccess: row.is_quick_access }
}

/**
 * Nombre de género como lo guarda la base: sin espacios sobrantes y, en un
 * nothogénero, con «× » delante.
 */
export function cleanGenusName(value: string): string {
  return cleanCatalogText(value).replace(/^×\s*/, '× ')
}

/** Crea un género. */
export async function createCatalogGenus(
  input: GenusInput,
): Promise<WrittenGenus> {
  requireText(input.name)
  const supabase = await client()
  const row = await settleWrite(
    supabase.rpc('create_catalog_genus', {
      new_name: cleanGenusName(input.name),
      new_is_quick_access: input.isQuickAccess,
    }),
  )
  return toWrittenGenus(row)
}

/** Renombra un género y cambia su marca de acceso rápido. */
export async function updateCatalogGenus(
  id: string,
  input: GenusInput,
): Promise<WrittenGenus> {
  requireText(input.name)
  const supabase = await client()
  const row = await settleWrite(
    supabase.rpc('update_catalog_genus', {
      target_genus_id: id,
      new_name: cleanGenusName(input.name),
      new_is_quick_access: input.isQuickAccess,
    }),
  )
  return toWrittenGenus(row)
}

/**
 * Borra un género sin especies ni plantas, con sus abreviaturas. Si tiene
 * alguna, falla con 'genus-has-species' o 'genus-has-plants' y el número.
 */
export async function deleteCatalogGenus(id: string): Promise<void> {
  const supabase = await client()
  await settleWrite(
    supabase.rpc('delete_catalog_genus', { target_genus_id: id }),
  )
}

/** Una abreviatura tal como queda tras escribirla. */
export interface WrittenAbbreviation {
  id: string
  genusId: string
  abbreviation: string
}

type AbbreviationRow =
  Database['public']['Tables']['genus_abbreviations']['Row']

function toWrittenAbbreviation(row: AbbreviationRow): WrittenAbbreviation {
  return { id: row.id, genusId: row.genus_id, abbreviation: row.abbreviation }
}

/** Abreviatura con su punto final, como la guarda la base ("Phal."). */
export function withFinalDot(value: string): string {
  const clean = cleanCatalogText(value).replace(/\.+$/, '')
  return clean === '' ? '' : `${clean}.`
}

/** Añade una abreviatura a un género. */
export async function addGenusAbbreviation(
  genusId: string,
  abbreviation: string,
): Promise<WrittenAbbreviation> {
  requireText(withFinalDot(abbreviation))
  const supabase = await client()
  const row = await settleWrite(
    supabase.rpc('add_genus_abbreviation', {
      target_genus_id: genusId,
      new_abbreviation: withFinalDot(abbreviation),
    }),
  )
  return toWrittenAbbreviation(row)
}

/** Cambia una abreviatura. */
export async function updateGenusAbbreviation(
  id: string,
  abbreviation: string,
): Promise<WrittenAbbreviation> {
  requireText(withFinalDot(abbreviation))
  const supabase = await client()
  const row = await settleWrite(
    supabase.rpc('update_genus_abbreviation', {
      target_abbreviation_id: id,
      new_abbreviation: withFinalDot(abbreviation),
    }),
  )
  return toWrittenAbbreviation(row)
}

/** Quita una abreviatura. */
export async function deleteGenusAbbreviation(id: string): Promise<void> {
  const supabase = await client()
  await settleWrite(
    supabase.rpc('delete_genus_abbreviation', { target_abbreviation_id: id }),
  )
}

// Fusión de especies (#136) ----------------------------------------------------------
//
// preview_species_merge() y merge_species() (migración
// 20261121160000_fusion_de_especies.sql; ver supabase/README.md, "Fusión de
// especies"). La especie absorbida (merged) desaparece; la conservada (kept) se
// queda con sus plantas, sus nombres y su clave de fuente.

/** De dónde viene un nombre de la absorbida: su nombre científico, un sinónimo o un común. */
export type MergeNameOrigin = 'scientific_name' | 'synonym' | 'common'

/** Un nombre de la especie absorbida en la vista previa. */
export interface MergeName {
  name: string
  /** El tipo que tendrá en la conservada (el nombre científico pasa como sinónimo). */
  type: SpeciesNameType
  language: string | null
  origin: MergeNameOrigin
}

/** Un nombre que no pasa porque ya existe. */
export interface SkippedMergeName extends MergeName {
  /**
   * already_in_kept: la conservada ya tiene uno igual tras normalizar.
   * repeated_in_merged: pasa otro de la absorbida que se escribe igual.
   */
  reason: 'already_in_kept' | 'repeated_in_merged'
  /** El nombre igual que ya existe (en la conservada o el que pasa). */
  existingName: string
  existingType: MergeNameOrigin
}

/** Una clave de fuente que la memoria de las fusiones asignará a la conservada. */
export interface RememberedKey {
  source: SpeciesSource
  sourceRef: string
  /** Si la absorbida la había heredado de una fusión anterior. */
  inherited: boolean
}

/** Los datos de una de las dos especies en la vista previa. */
export interface MergeSpeciesSide {
  id: string
  scientificName: string
  genusId: string
  genusName: string
  type: SpeciesType
  status: SpeciesStatus
}

export interface SpeciesMergePreview {
  merged: MergeSpeciesSide & {
    source: SpeciesSource
    /**
     * Referencia en la fuente, o null. Los tipos generados no saben que las
     * columnas de una función que devuelve una tabla pueden ser nulas.
     */
    sourceRef: string | null
  }
  kept: MergeSpeciesSide
  /** Plantas de usuarios (de cualquier dueño y estado) que se mueven. */
  plantCount: number
  /** Nombres que pasan a la conservada. */
  movedNames: MergeName[]
  /** Nombres que no pasan porque ya existen. */
  existingNames: SkippedMergeName[]
  /** Las plantas tomarán el género de la conservada, que es otro. */
  genusDiffers: boolean
  /** Lo mismo con el tipo (especie o híbrido). */
  typeDiffers: boolean
  /** La conservada pasará de importada a validada. */
  keptBecomesValidated: boolean
  rememberedKeys: RememberedKey[]
}

export interface SpeciesMergeResult {
  /** La acción merge_species de la auditoría. */
  actionId: string
  plantCount: number
  movedNameCount: number
  skippedNameCount: number
  /** La conservada pasó de importada a validada. */
  keptValidated: boolean
  rememberedKeys: RememberedKey[]
}

type JsonObject = { [key: string]: Json | undefined }

function jsonObject(value: Json | undefined): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value
    : null
}

function jsonObjects(value: Json): JsonObject[] {
  return (Array.isArray(value) ? value : [])
    .map(jsonObject)
    .filter((item): item is JsonObject => item !== null)
}

function isNameType(value: unknown): value is SpeciesNameType {
  return value === 'synonym' || value === 'common'
}

function isOrigin(value: unknown): value is MergeNameOrigin {
  return (
    value === 'scientific_name' || value === 'synonym' || value === 'common'
  )
}

function isSource(value: unknown): value is SpeciesSource {
  return (
    value === 'col' ||
    value === 'curated' ||
    value === 'user_proposal' ||
    value === 'gbif'
  )
}

function toMergeName(item: JsonObject): MergeName | null {
  const { name, type, language, origin } = item
  if (typeof name !== 'string' || !isNameType(type) || !isOrigin(origin))
    return null
  return {
    name,
    type,
    language: typeof language === 'string' ? language : null,
    origin,
  }
}

function toSkippedName(item: JsonObject): SkippedMergeName | null {
  const base = toMergeName(item)
  const {
    reason,
    existing_name: existingName,
    existing_type: existingType,
  } = item
  if (
    base === null ||
    (reason !== 'already_in_kept' && reason !== 'repeated_in_merged') ||
    typeof existingName !== 'string' ||
    !isOrigin(existingType)
  )
    return null
  return { ...base, reason, existingName, existingType }
}

function toRememberedKeys(value: Json): RememberedKey[] {
  return jsonObjects(value).flatMap((item) =>
    isSource(item.source) && typeof item.source_ref === 'string'
      ? [
          {
            source: item.source,
            sourceRef: item.source_ref,
            inherited: item.inherited === true,
          },
        ]
      : [],
  )
}

/** Convierte la fila de preview_species_merge(). */
export function toSpeciesMergePreview(
  mergedId: string,
  keptId: string,
  row: SpeciesMergePreviewRow,
): SpeciesMergePreview {
  return {
    merged: {
      id: mergedId,
      scientificName: row.merged_scientific_name,
      genusId: row.merged_genus_id,
      genusName: row.merged_genus_name,
      type: row.merged_type,
      status: row.merged_status,
      source: row.merged_source,
      // Puede ser null aunque los tipos generados no lo sepan (ver SpeciesMergePreview).
      sourceRef: row.merged_source_ref,
    },
    kept: {
      id: keptId,
      scientificName: row.kept_scientific_name,
      genusId: row.kept_genus_id,
      genusName: row.kept_genus_name,
      type: row.kept_type,
      status: row.kept_status,
    },
    plantCount: row.plant_count,
    movedNames: jsonObjects(row.moved_names)
      .map(toMergeName)
      .filter((name): name is MergeName => name !== null),
    existingNames: jsonObjects(row.existing_names)
      .map(toSkippedName)
      .filter((name): name is SkippedMergeName => name !== null),
    genusDiffers: row.genus_differs,
    typeDiffers: row.type_differs,
    keptBecomesValidated: row.kept_becomes_validated,
    rememberedKeys: toRememberedKeys(row.remembered_keys),
  }
}

/**
 * Vista previa de la fusión de `mergedId` en `keptId`, sin cambiar nada. Es una
 * lectura: los fallos de transporte y de permiso (sin conexión, sesión
 * terminada, sin rol, cancelada) llegan como CatalogAdminError, igual que en
 * las demás lecturas; los rechazos de la fusión (same-species y
 * species-not-found, con la especie que falta en speciesRole), como
 * CatalogWriteError, porque la pantalla los explica de otra forma.
 */
export async function previewSpeciesMerge(
  mergedId: string,
  keptId: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<SpeciesMergePreview> {
  if (mergedId === keptId) throw new CatalogWriteError('same-species')
  const supabase = await loadClient(signal)
  const call = supabase.rpc('preview_species_merge', {
    merged_species_id: mergedId,
    kept_species_id: keptId,
  })
  let response: Awaited<typeof call>
  try {
    response = await (signal ? call.abortSignal(signal) : call)
  } catch (error) {
    throw toAdminError(error, 0, signal)
  }
  if (signal?.aborted) throw new CatalogAdminError('aborted')
  if (response.error) {
    const rejected = catalogWriteErrorFromDatabase(response.error)
    if (
      rejected &&
      (rejected.problem === 'same-species' ||
        rejected.problem === 'species-not-found')
    )
      throw rejected
    throw toAdminError(response.error, response.status, signal)
  }
  const row = response.data[0]
  if (!row) throw new CatalogAdminError('failed')
  return toSpeciesMergePreview(mergedId, keptId, row)
}

function toSpeciesMergeResult(row: SpeciesMergeResultRow): SpeciesMergeResult {
  return {
    actionId: row.action_id,
    plantCount: row.plant_count,
    movedNameCount: row.moved_name_count,
    skippedNameCount: row.skipped_name_count,
    keptValidated: row.kept_validated,
    rememberedKeys: toRememberedKeys(row.remembered_keys),
  }
}

/**
 * Fusiona `mergedId` en `keptId`, en una transacción: mueve las plantas y los
 * nombres, recuerda la clave de fuente y borra la absorbida. No se puede
 * deshacer. Falla con CatalogWriteError: same-species, species-not-found (con
 * speciesRole) o los de transporte.
 */
export async function mergeCatalogSpecies(
  mergedId: string,
  keptId: string,
): Promise<SpeciesMergeResult> {
  if (mergedId === keptId) throw new CatalogWriteError('same-species')
  const supabase = await client()
  const rows = await settleWrite(
    supabase.rpc('merge_species', {
      merged_species_id: mergedId,
      kept_species_id: keptId,
    }),
  )
  const row = rows[0]
  if (!row) throw new CatalogWriteError('failed')
  return toSpeciesMergeResult(row)
}

// Cola de propuestas (#139) -------------------------------------------------------
//
// Las tres resoluciones de un grupo de la cola (migración
// 20261121180000_cola_de_propuestas.sql). Cambian todas las plantas por
// validar del grupo a la vez. Si otro administrador ya lo resolvió, la base no
// falla: devuelve plantCount 0 y no cambia nada.

/** Lo que hizo una resolución. */
export interface ProposalResolution {
  /** Plantas resueltas; 0 si el grupo ya no tenía ninguna por validar. */
  plantCount: number
}

type ResolutionRow = { plant_count: number }

function toResolution(rows: readonly ResolutionRow[]): ProposalResolution {
  const row = rows[0]
  if (!row) throw new CatalogWriteError('failed')
  return { plantCount: row.plant_count }
}

/** Enlaza todas las plantas del grupo a una especie existente. */
export async function linkProposalGroup(
  group: ProposalGroupKey,
  speciesId: string,
): Promise<ProposalResolution> {
  const supabase = await client()
  const rows = await settleWrite(
    supabase.rpc('link_proposal_group', {
      group_name_key: group.nameKey,
      group_genus_id: group.genusId,
      target_species_id: speciesId,
    }),
  )
  return toResolution(rows)
}

/** Lo que se escribe de la especie nueva: su estado siempre es "validada". */
export type ProposalSpeciesInput = Omit<SpeciesInput, 'status'>

/**
 * Crea la especie (fuente "propuesta de usuario", validada) y le enlaza el
 * grupo, en una transacción. Si el grupo ya no tenía plantas, no crea nada y
 * species es null.
 */
export async function createSpeciesFromProposal(
  group: ProposalGroupKey,
  input: ProposalSpeciesInput,
): Promise<ProposalResolution & { speciesId: string | null }> {
  const invalid = validateSpeciesInput({ ...input, status: 'validated' })
  if (invalid) throw invalid
  const supabase = await client()
  const rows = await settleWrite(
    supabase.rpc('create_species_from_proposal', {
      group_name_key: group.nameKey,
      group_genus_id: group.genusId,
      new_scientific_name: cleanCatalogText(input.scientificName),
      new_genus_id: input.genusId ?? '',
      new_type: input.type,
    }),
  )
  const resolution = toResolution(rows)
  // Los tipos generados no saben que species_id puede ser nulo.
  const speciesId = (rows[0]?.species_id as string | null | undefined) ?? null
  return {
    ...resolution,
    speciesId: resolution.plantCount === 0 ? null : speciesId,
  }
}

/** Marca todas las plantas del grupo como no identificables. */
export async function markProposalUnidentifiable(
  group: ProposalGroupKey,
): Promise<ProposalResolution> {
  const supabase = await client()
  const rows = await settleWrite(
    supabase.rpc('mark_proposal_unidentifiable', {
      group_name_key: group.nameKey,
      group_genus_id: group.genusId,
    }),
  )
  return toResolution(rows)
}

// Fotos de referencia (#234) ------------------------------------------------------

/** Por qué se retira una foto de referencia, en el orden del formulario. */
export const SPECIES_PHOTO_REJECTION_REASONS = [
  'misidentified',
  'inappropriate',
  'author_request',
  'other',
] as const satisfies readonly SpeciesPhotoRejectionReason[]

/**
 * Retira la foto de referencia que vio el administrador
 * (retire_species_photo): la borra, recuerda que no debe volver y deja la
 * acción en el historial de la especie. Falla con 'reason-required' sin un
 * motivo válido y con 'species-photo-not-found' si la especie ya no tiene esa
 * foto (otra persona la retiró o la carga la cambió): entonces no se tocó nada.
 */
export async function retireSpeciesPhoto(
  speciesId: string,
  sourcePhotoId: string,
  reason: SpeciesPhotoRejectionReason | null,
): Promise<void> {
  if (reason === null || !SPECIES_PHOTO_REJECTION_REASONS.includes(reason)) {
    throw new CatalogWriteError('reason-required')
  }
  const supabase = await client()
  await settleWrite(
    supabase.rpc('retire_species_photo', {
      target_species_id: speciesId,
      target_source_photo_id: sourcePhotoId,
      retire_reason: reason,
    }),
  )
}
