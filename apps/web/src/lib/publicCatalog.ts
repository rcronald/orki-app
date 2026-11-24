import { isBrowserOffline, offlineOr } from './connection.ts'
import { CatalogSearchError, prepareSearchQuery } from './catalogSearch.ts'
import type {
  PublicCommonName,
  PublicSpeciesDetail,
  SpeciesMatchType,
  SpeciesSource,
  SpeciesType,
} from './database.ts'
import {
  publicPhotoUrl,
  toReferencePicture,
  type ReferencePicture,
} from './referencePhotos.ts'
import { getPublicSupabase } from './supabase.ts'

// Catálogo público desde la app (#232): las cuatro funciones de solo lectura
// que pueden llamar los visitantes sin sesión (ver "Catálogo público" en
// supabase/README.md). Van siempre con el cliente público (getPublicSupabase):
// sin token, con o sin sesión, así que no dependen de Clerk.
//
// - Devuelven objetos en camelCase.
// - Aceptan un AbortSignal y fallan con CatalogSearchError (el de la búsqueda
//   del registro): cancelada, sin conexión o fallo del servidor o de la red.
// - No piden nada que la base vaya a rechazar o a devolver vacío: una consulta
//   de menos de 2 o más de 100 caracteres, o un id que no es un uuid (Postgres
//   respondería con un error de tipo en lugar de «no existe»).

// Topes de la base (migración 20261122150000_catalogo_publico.sql). Si cambian
// allí, cambian aquí.

/** Resultados de la búsqueda pública: el tope de la base. */
export const PUBLIC_SEARCH_MAX_RESULTS = 15
/** Géneros por petición: el tope de la base (unas 4 peticiones para 755). */
export const PUBLIC_GENERA_PAGE_SIZE = 200
/** Especies por página dentro de un género (la base admite hasta 100). */
export const PUBLIC_GENUS_SPECIES_PAGE_SIZE = 50

// Tipos ------------------------------------------------------------------------

/** Una especie encontrada, con el nombre por el que coincidió. */
export interface PublicSpeciesResult {
  id: string
  scientificName: string
  genusId: string
  genusName: string
  type: SpeciesType
  matchedName: string
  matchedNameType: SpeciesMatchType
  /** La miniatura de referencia con su crédito (#234), o null (sin medium). */
  reference: ReferencePicture | null
}

/** Un género con su número de especies públicas. */
export interface PublicGenus {
  id: string
  name: string
  speciesCount: number
}

/** Una especie de la lista de un género. */
export interface PublicGenusSpecies {
  id: string
  scientificName: string
  type: SpeciesType
  /** La miniatura de referencia con su crédito (#234), o null (sin medium). */
  reference: ReferencePicture | null
}

/** Una página de las especies de un género. */
export interface PublicGenusSpeciesPage {
  genus: { id: string; name: string }
  species: PublicGenusSpecies[]
  /** Especies públicas del género. */
  total: number
  /** La página devuelta (la última si se pidió una mayor), desde 1. */
  page: number
  pageCount: number
}

/** La ficha de una especie. */
export interface PublicSpecies {
  id: string
  scientificName: string
  genus: { id: string; name: string }
  type: SpeciesType
  source: SpeciesSource
  /** Clave del taxón en la fuente externa (col, gbif); null en las demás. */
  sourceRef: string | null
  /** Hasta 100 sinónimos, en orden. */
  synonyms: string[]
  /** Sinónimos en total (puede ser mayor que synonyms.length). */
  synonymCount: number
  /** Hasta 100 nombres comunes, en orden. */
  commonNames: PublicCommonName[]
  commonNameCount: number
  /** La foto de referencia con su crédito (#234), o null. */
  reference: ReferencePicture | null
}

export interface PublicCatalogOptions {
  signal?: AbortSignal
}

// Errores ----------------------------------------------------------------------

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new CatalogSearchError('aborted')
}

/**
 * Clasifica el `error` de postgrest-js: con status 0 la petición no obtuvo
 * respuesta (sin conexión si el navegador lo sabe; si no, fallo de red).
 */
function toError(
  error: unknown,
  status: number,
  signal: AbortSignal | undefined,
): CatalogSearchError {
  if (signal?.aborted) {
    return new CatalogSearchError('aborted', { cause: error })
  }
  if (status === 0 && isBrowserOffline()) {
    return new CatalogSearchError('offline', { cause: error })
  }
  return new CatalogSearchError('failed', { cause: error })
}

async function loadClient(signal: AbortSignal | undefined) {
  try {
    const supabase = await getPublicSupabase()
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

/** Ejecuta la llamada (con el AbortSignal) y devuelve sus filas o el error. */
async function run<T>(
  request: PromiseLike<{ data: T | null; error: unknown; status: number }> & {
    abortSignal: (
      signal: AbortSignal,
    ) => PromiseLike<{ data: T | null; error: unknown; status: number }>
  },
  signal: AbortSignal | undefined,
): Promise<T | null> {
  const { data, error, status } = await (signal
    ? request.abortSignal(signal)
    : request)
  if (error) throw toError(error, status, signal)
  throwIfAborted(signal)
  return data
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Si `id` tiene la forma de un uuid (los ids del catálogo). */
export function isCatalogId(id: string | undefined): id is string {
  return id !== undefined && UUID.test(id)
}

// Búsqueda ---------------------------------------------------------------------

/**
 * Busca especies por nombre científico, sinónimo o nombre común
 * (search_public_species), con la tolerancia de la búsqueda del registro.
 * Misma firma que searchSpecies, así que sirve con useCatalogSearch. Con una
 * consulta fuera de los límites devuelve [] sin pedir nada.
 */
export async function searchPublicSpecies(
  query: string,
  options: PublicCatalogOptions & { maxResults?: number } = {},
): Promise<PublicSpeciesResult[]> {
  const { signal } = options
  throwIfAborted(signal)
  const prepared = prepareSearchQuery(query)
  if (prepared === null) return []
  const maxResults = Math.min(
    PUBLIC_SEARCH_MAX_RESULTS,
    Math.max(1, Math.trunc(options.maxResults ?? PUBLIC_SEARCH_MAX_RESULTS)),
  )

  const supabase = await loadClient(signal)
  const rows = await run(
    supabase.rpc('search_public_species', {
      query: prepared,
      max_results: maxResults,
    }),
    signal,
  )
  const resolve = publicPhotoUrl(supabase)
  return (rows ?? []).map((row) => ({
    id: row.id,
    scientificName: row.scientific_name,
    genusId: row.genus_id,
    genusName: row.genus_name,
    type: row.type,
    matchedName: row.matched_name,
    matchedNameType: row.matched_name_type,
    reference: toReferencePicture(row.reference_thumbnail, resolve),
  }))
}

// Géneros ----------------------------------------------------------------------

/**
 * Todos los géneros con especies públicas, en el orden de la base (nombre sin
 * tildes ni signo de híbrido). Son unos 755: la primera página dice el total
 * y las demás se piden a la vez, de PUBLIC_GENERA_PAGE_SIZE en
 * PUBLIC_GENERA_PAGE_SIZE.
 */
export async function listAllPublicGenera(
  options: PublicCatalogOptions = {},
): Promise<PublicGenus[]> {
  const { signal } = options
  throwIfAborted(signal)
  const supabase = await loadClient(signal)
  const page = (pageNumber: number) =>
    run(
      supabase.rpc('list_public_genera', {
        page_size: PUBLIC_GENERA_PAGE_SIZE,
        page_number: pageNumber,
      }),
      signal,
    )

  const first = (await page(1)) ?? []
  const total = first[0]?.total_count ?? 0
  const pageCount = Math.ceil(total / PUBLIC_GENERA_PAGE_SIZE)
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
      page(index + 2),
    ),
  )
  // Por id, por si el catálogo cambió entre una página y otra.
  const seen = new Set<string>()
  const genera: PublicGenus[] = []
  for (const row of [first, ...rest].flatMap((rows) => rows ?? [])) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    genera.push({ id: row.id, name: row.name, speciesCount: row.species_count })
  }
  return genera
}

/**
 * Una página de las especies de un género (list_public_genus_species). Null
 * si el género no existe o no tiene especies públicas.
 */
export async function listPublicGenusSpecies(
  genusId: string,
  pageNumber: number,
  options: PublicCatalogOptions = {},
): Promise<PublicGenusSpeciesPage | null> {
  const { signal } = options
  throwIfAborted(signal)
  if (!isCatalogId(genusId)) return null
  const supabase = await loadClient(signal)
  const rows =
    (await run(
      supabase.rpc('list_public_genus_species', {
        target_genus_id: genusId,
        page_size: PUBLIC_GENUS_SPECIES_PAGE_SIZE,
        page_number: Math.max(1, Math.trunc(pageNumber) || 1),
      }),
      signal,
    )) ?? []
  const first = rows[0]
  if (first === undefined) return null
  const resolve = publicPhotoUrl(supabase)
  return {
    genus: { id: first.genus_id, name: first.genus_name },
    species: rows.map((row) => ({
      id: row.id,
      scientificName: row.scientific_name,
      type: row.type,
      reference: toReferencePicture(row.reference_thumbnail, resolve),
    })),
    total: first.total_count,
    page: first.current_page,
    pageCount: Math.max(
      1,
      Math.ceil(first.total_count / PUBLIC_GENUS_SPECIES_PAGE_SIZE),
    ),
  }
}

// Ficha ------------------------------------------------------------------------

function commonNamesOf(value: unknown): PublicCommonName[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return []
    const { name, language } = item as Record<string, unknown>
    if (typeof name !== 'string') return []
    return [{ name, language: typeof language === 'string' ? language : null }]
  })
}

/**
 * La ficha de una especie (get_public_species). Null si no existe o no es
 * pública (la base no distingue los dos casos).
 */
export async function getPublicSpecies(
  speciesId: string,
  options: PublicCatalogOptions = {},
): Promise<PublicSpecies | null> {
  const { signal } = options
  throwIfAborted(signal)
  if (!isCatalogId(speciesId)) return null
  const supabase = await loadClient(signal)
  const rows = await run(
    supabase.rpc('get_public_species', { target_species_id: speciesId }),
    signal,
  )
  const row = rows?.[0] as
    | (Omit<PublicSpeciesDetail, 'common_names'> & { common_names: unknown })
    | undefined
  if (row === undefined) return null
  return {
    id: row.id,
    scientificName: row.scientific_name,
    genus: { id: row.genus_id, name: row.genus_name },
    type: row.type,
    source: row.source,
    sourceRef: row.source_ref ?? null,
    synonyms: row.synonyms ?? [],
    synonymCount: row.synonym_count,
    commonNames: commonNamesOf(row.common_names),
    commonNameCount: row.common_name_count,
    reference: toReferencePicture(
      row.reference_photo,
      publicPhotoUrl(supabase),
    ),
  }
}
