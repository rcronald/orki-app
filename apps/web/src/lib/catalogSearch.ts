import { isBrowserOffline, offlineOr } from './connection.ts'
import type {
  Database,
  SpeciesMatchType,
  SpeciesStatus,
  SpeciesType,
} from './database.ts'
import {
  getSupabase,
  sessionTokenFailure,
  type OrkiSupabaseClient,
} from './supabase.ts'

// Búsqueda en el catálogo desde la app (issue #71).
//
// Llama a las funciones de la API public.search_species y public.search_genera
// (ver supabase/README.md, "Búsqueda de especies" y "Búsqueda de géneros") con
// el cliente diferido de supabase.ts. Las dos son públicas: sin sesión, la
// petición va con la clave publicable (como anon) y funciona igual.
//
// - Devuelve objetos con nombres en camelCase, con los tipos sacados de
//   database.types.ts.
// - No hace ninguna petición si la consulta recortada es demasiado corta o
//   demasiado larga: la base devolvería vacío de todos modos.
// - Acepta un AbortSignal y distingue tres errores (CatalogSearchError):
//   cancelada, sin conexión y fallo del servidor o de la red.

// Límites ------------------------------------------------------------------------
//
// Los mismos que aplican las funciones de la base (migraciones
// 20261120190000_busqueda_de_especies.sql y
// 20261120200000_abreviaturas_y_busqueda_de_generos.sql). Si cambian allí,
// cambian aquí.

/** Caracteres mínimos de la consulta. La base cuenta tras normalizar; aquí, tras recortar. */
export const SEARCH_QUERY_MIN_LENGTH = 2
/** Caracteres máximos de la consulta; con más, la base devuelve vacío. */
export const SEARCH_QUERY_MAX_LENGTH = 100
/** Resultados por defecto. */
export const SEARCH_DEFAULT_RESULTS = 10
/** Tope de resultados que admite la base. */
export const SEARCH_MAX_RESULTS = 20

// Tipos ----------------------------------------------------------------------------

type Functions = Database['public']['Functions']
type SpeciesRow = Functions['search_species']['Returns'][number]
type GenusRow = Functions['search_genera']['Returns'][number]

/** Una especie encontrada, con el nombre por el que coincidió. */
export interface SpeciesSearchResult {
  id: SpeciesRow['id']
  scientificName: SpeciesRow['scientific_name']
  genusId: SpeciesRow['genus_id']
  genusName: SpeciesRow['genus_name']
  type: SpeciesType
  status: SpeciesStatus
  /** El nombre por el que coincidió, tal como está en el catálogo. */
  matchedName: SpeciesRow['matched_name']
  matchedNameType: SpeciesMatchType
}

/** Un género encontrado. */
export interface GenusSearchResult {
  id: GenusRow['id']
  name: GenusRow['name']
  isQuickAccess: GenusRow['is_quick_access']
  /**
   * La abreviatura por la que coincidió, tal como está guardada ("Phal."), o
   * null si coincidió por el nombre. Los tipos generados no reflejan que la
   * columna puede ser nula (supabase gen types no lo sabe para las funciones
   * que devuelven tablas), así que se declara aquí.
   */
  matchedAbbreviation: GenusRow['matched_abbreviation'] | null
}

export interface CatalogSearchOptions {
  /** Cancela la petición; la promesa se rechaza con CatalogSearchError('aborted'). */
  signal?: AbortSignal
  /** Número de resultados, de 1 a SEARCH_MAX_RESULTS. Por defecto, SEARCH_DEFAULT_RESULTS. */
  maxResults?: number
}

/** Firma común de searchSpecies y searchGenera. */
export type CatalogSearchFunction<T> = (
  query: string,
  options?: CatalogSearchOptions,
) => Promise<T[]>

// Textos -----------------------------------------------------------------------

/**
 * Por qué nombre coincidió una especie, para mostrarlo bajo el nombre
 * científico ("Sinónimo: …" o "Nombre común: …"). Undefined si coincidió por
 * el propio nombre científico: no hace falta repetirlo.
 */
export function speciesMatchText(
  result: Pick<SpeciesSearchResult, 'matchedName' | 'matchedNameType'>,
): string | undefined {
  switch (result.matchedNameType) {
    case 'synonym':
      return `Sinónimo: ${result.matchedName}`
    case 'common':
      return `Nombre común: ${result.matchedName}`
    case 'scientific':
      return undefined
  }
}

/** Abreviatura por la que coincidió un género ("Abreviatura: Phal."), o undefined. */
export function genusMatchText(
  result: Pick<GenusSearchResult, 'matchedAbbreviation'>,
): string | undefined {
  return result.matchedAbbreviation
    ? `Abreviatura: ${result.matchedAbbreviation}`
    : undefined
}

// Errores ----------------------------------------------------------------------

/**
 * Por qué falló una búsqueda:
 * - aborted: se canceló con el AbortSignal (no es un fallo que mostrar).
 * - offline: sin conexión.
 * - failed: error del servidor o de la red con conexión.
 */
export type CatalogSearchFailure = 'aborted' | 'offline' | 'failed'

/** Textos para mostrar en pantalla, uno por motivo. */
export const CATALOG_SEARCH_ERROR_TEXT: Record<CatalogSearchFailure, string> = {
  aborted: 'Búsqueda cancelada.',
  offline:
    'Sin conexión: no se puede buscar en el catálogo. Revisa tu conexión y vuelve a escribir.',
  failed:
    'No se pudo buscar en el catálogo. Vuelve a intentarlo en unos momentos.',
}

export class CatalogSearchError extends Error {
  readonly reason: CatalogSearchFailure

  constructor(reason: CatalogSearchFailure, options?: { cause?: unknown }) {
    super(CATALOG_SEARCH_ERROR_TEXT[reason], options)
    this.name = 'CatalogSearchError'
    this.reason = reason
  }
}

/** Motivo de un error de búsqueda; cualquier otro error cuenta como 'failed'. */
export function catalogSearchFailure(error: unknown): CatalogSearchFailure {
  return error instanceof CatalogSearchError ? error.reason : 'failed'
}

// Consulta ---------------------------------------------------------------------

/**
 * Prepara la consulta: recortada si tiene la longitud que acepta la base, o
 * null si no la tiene y no hay que enviar nada. La longitud se cuenta en
 * caracteres (puntos de código), como char_length en Postgres.
 */
export function prepareSearchQuery(query: string): string | null {
  const trimmed = query.trim()
  const length = [...trimmed].length
  if (length < SEARCH_QUERY_MIN_LENGTH || length > SEARCH_QUERY_MAX_LENGTH) {
    return null
  }
  return trimmed
}

function clampResults(maxResults: number | undefined): number {
  if (maxResults === undefined || !Number.isFinite(maxResults)) {
    return SEARCH_DEFAULT_RESULTS
  }
  return Math.min(SEARCH_MAX_RESULTS, Math.max(1, Math.trunc(maxResults)))
}

/** CatalogSearchError('aborted') si la señal ya se canceló. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new CatalogSearchError('aborted')
}

/**
 * Clasifica el `error` que devuelve postgrest-js. Con status 0 la petición no
 * obtuvo respuesta (fetch falló): sin conexión si el navegador lo sabe, si no
 * fallo de red. Si faltó el token de una sesión iniciada por estar sin
 * conexión, también es "sin conexión".
 */
function toSearchError(
  error: unknown,
  status: number,
  signal: AbortSignal | undefined,
): CatalogSearchError {
  if (signal?.aborted)
    return new CatalogSearchError('aborted', { cause: error })
  if (sessionTokenFailure(error) === 'offline') {
    return new CatalogSearchError('offline', { cause: error })
  }
  if (status === 0 && isBrowserOffline()) {
    return new CatalogSearchError('offline', { cause: error })
  }
  return new CatalogSearchError('failed', { cause: error })
}

/**
 * Carga el cliente (por defecto, el de la app; el catálogo público pasa
 * getPublicSupabase). Si no llega (por ejemplo, el chunk del cliente de
 * Supabase no se pudo descargar), el error es de conexión o de red.
 */
export async function loadClient(
  signal: AbortSignal | undefined,
  getClient: () => Promise<OrkiSupabaseClient> = getSupabase,
): Promise<OrkiSupabaseClient> {
  try {
    const supabase = await getClient()
    throwIfAborted(signal)
    return supabase
  } catch (error) {
    if (error instanceof CatalogSearchError) throw error
    throwIfAborted(signal)
    throw new CatalogSearchError(offlineOr('failed'), {
      cause: error,
    })
  }
}

/**
 * Busca especies por nombre científico, sinónimo o nombre común, tolerando
 * errores de tipeo, tildes y abreviaturas de género. Devuelve como mucho
 * `maxResults` especies, cada una una vez, en el orden de la base. Con una
 * consulta fuera de los límites devuelve [] sin hacer ninguna petición.
 *
 * Se rechaza con CatalogSearchError si se cancela, si no hay conexión o si
 * falla el servidor o la red.
 */
export async function searchSpecies(
  query: string,
  options: CatalogSearchOptions = {},
): Promise<SpeciesSearchResult[]> {
  const { signal } = options
  throwIfAborted(signal)
  const prepared = prepareSearchQuery(query)
  if (prepared === null) return []

  const supabase = await loadClient(signal)
  const request = supabase.rpc('search_species', {
    query: prepared,
    max_results: clampResults(options.maxResults),
  })
  const { data, error, status } = await (signal
    ? request.abortSignal(signal)
    : request)
  if (error) throw toSearchError(error, status, signal)
  throwIfAborted(signal)

  return (data ?? []).map((row) => ({
    id: row.id,
    scientificName: row.scientific_name,
    genusId: row.genus_id,
    genusName: row.genus_name,
    type: row.type,
    status: row.status,
    matchedName: row.matched_name,
    matchedNameType: row.matched_name_type,
  }))
}

/**
 * Busca géneros por nombre o abreviatura, para el chip "Otro" del registro.
 * Mismos límites, opciones y errores que searchSpecies.
 */
export async function searchGenera(
  query: string,
  options: CatalogSearchOptions = {},
): Promise<GenusSearchResult[]> {
  const { signal } = options
  throwIfAborted(signal)
  const prepared = prepareSearchQuery(query)
  if (prepared === null) return []

  const supabase = await loadClient(signal)
  const request = supabase.rpc('search_genera', {
    query: prepared,
    max_results: clampResults(options.maxResults),
  })
  const { data, error, status } = await (signal
    ? request.abortSignal(signal)
    : request)
  if (error) throw toSearchError(error, status, signal)
  throwIfAborted(signal)

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    isQuickAccess: row.is_quick_access,
    matchedAbbreviation: row.matched_abbreviation,
  }))
}
