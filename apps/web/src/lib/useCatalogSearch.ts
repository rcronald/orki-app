import { useEffect, useState } from 'react'
import {
  CATALOG_SEARCH_ERROR_TEXT,
  catalogSearchFailure,
  prepareSearchQuery,
  searchGenera,
  searchSpecies,
  type CatalogSearchFunction,
  type GenusSearchResult,
  type SpeciesSearchResult,
} from './catalogSearch.ts'

// Búsqueda mientras se escribe (issue #71), solo con React.
//
// - Espera entre pulsaciones: la petición sale cuando la persona deja de
//   escribir durante `debounceMs`; escribir rápido hace una sola petición.
// - Cancelación: al cambiar la consulta o al desmontar se cancela la espera y
//   la petición en curso (AbortController).
// - Sin resultados de otra consulta: el resultado guardado lleva la consulta
//   a la que responde y solo se usa si coincide con la actual. Una respuesta
//   tardía de una consulta anterior se descarta (su petición ya se canceló y,
//   aunque llegara, no coincide). Mientras llega la nueva, el estado es
//   "cargando" y la lista va vacía.

/** Espera por defecto entre pulsaciones, en milisegundos. */
export const SEARCH_DEBOUNCE_MS = 250

/**
 * Estado de la búsqueda:
 * - idle: no se busca (consulta demasiado corta o búsqueda desactivada).
 * - loading: esperando a que se deje de escribir o a la respuesta.
 * - success: hay resultados.
 * - empty: la búsqueda terminó sin resultados.
 * - error: falló; `error` dice si fue por falta de conexión.
 */
export type CatalogSearchStatus =
  'idle' | 'loading' | 'success' | 'empty' | 'error'

export interface CatalogSearchErrorState {
  reason: 'offline' | 'failed'
  /** Mensaje para mostrar, en español. */
  message: string
}

export interface CatalogSearchState<T> {
  status: CatalogSearchStatus
  /** Resultados de la consulta actual; vacío en cualquier otro estado. */
  results: readonly T[]
  /** Solo en el estado error. */
  error: CatalogSearchErrorState | null
}

export interface UseCatalogSearchOptions {
  /** Espera entre pulsaciones. Por defecto SEARCH_DEBOUNCE_MS. */
  debounceMs?: number
  /** Número de resultados que se piden. */
  maxResults?: number
  /** Con false no se busca nada y el estado es idle. Por defecto true. */
  enabled?: boolean
}

type Outcome<T> =
  | { query: string; ok: true; results: T[] }
  | { query: string; ok: false; error: CatalogSearchErrorState }

const NO_RESULTS: readonly never[] = []

/**
 * Busca `query` con `search` (searchSpecies, searchGenera o una función con la
 * misma firma) mientras se escribe. `search` debe ser estable entre renders
 * (una función de módulo o memorizada): si cambia, la búsqueda se repite.
 */
export function useCatalogSearch<T>(
  search: CatalogSearchFunction<T>,
  query: string,
  {
    debounceMs = SEARCH_DEBOUNCE_MS,
    maxResults,
    enabled = true,
  }: UseCatalogSearchOptions = {},
): CatalogSearchState<T> {
  const [outcome, setOutcome] = useState<Outcome<T> | null>(null)
  const prepared = enabled ? prepareSearchQuery(query) : null

  useEffect(() => {
    if (prepared === null) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      search(prepared, { signal: controller.signal, maxResults }).then(
        (results) => {
          if (controller.signal.aborted) return
          setOutcome({ query: prepared, ok: true, results })
        },
        (error: unknown) => {
          const reason = catalogSearchFailure(error)
          if (controller.signal.aborted || reason === 'aborted') return
          setOutcome({
            query: prepared,
            ok: false,
            error: { reason, message: CATALOG_SEARCH_ERROR_TEXT[reason] },
          })
        },
      )
    }, debounceMs)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [search, prepared, maxResults, debounceMs])

  if (prepared === null) {
    return { status: 'idle', results: NO_RESULTS, error: null }
  }
  if (outcome === null || outcome.query !== prepared) {
    return { status: 'loading', results: NO_RESULTS, error: null }
  }
  if (!outcome.ok) {
    return { status: 'error', results: NO_RESULTS, error: outcome.error }
  }
  return {
    status: outcome.results.length > 0 ? 'success' : 'empty',
    results: outcome.results,
    error: null,
  }
}

/** Búsqueda de especies mientras se escribe. */
export function useSpeciesSearch(
  query: string,
  options?: UseCatalogSearchOptions,
): CatalogSearchState<SpeciesSearchResult> {
  return useCatalogSearch(searchSpecies, query, options)
}

/** Búsqueda de géneros mientras se escribe. */
export function useGenusSearch(
  query: string,
  options?: UseCatalogSearchOptions,
): CatalogSearchState<GenusSearchResult> {
  return useCatalogSearch(searchGenera, query, options)
}
