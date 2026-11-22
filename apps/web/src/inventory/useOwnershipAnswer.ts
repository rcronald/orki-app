import { useDeferredValue, useMemo } from 'react'
import type { CollectionPlant } from '../collection/model.ts'
import {
  answerOwnership,
  ownershipIndexFor,
  type Ownership,
  type OwnershipExtras,
} from '../collection/ownership.ts'
import {
  searchSpecies as catalogSearchSpecies,
  type CatalogSearchFunction,
  type SpeciesSearchResult,
} from '../lib/catalogSearch.ts'
import { useOnlineStatus } from '../lib/useOnlineStatus.ts'
import {
  timed,
  useOwnershipMeasurement,
  type OnOwnershipMeasure,
} from './ownership-measure.ts'
import { joinNames } from './texts.ts'
import { useCatalogOwnership } from './useCatalogOwnership.ts'

export interface OwnershipAnswerOptions {
  /** Todas las plantas, también las dadas de baja; null si aún no hay datos. */
  plants: readonly CollectionPlant[] | null
  /** Texto del campo, tal como está escrito. */
  query: string
  /** Sinónimos, nombres comunes y abreviaturas de la copia local (#18). */
  extras?: OwnershipExtras
  /**
   * Búsqueda del catálogo con la que se mejora la respuesta cuando hay
   * conexión (#124). Por defecto, searchSpecies; null, sin catálogo (la
   * página de muestra, las pruebas).
   */
  searchSpecies?: CatalogSearchFunction<SpeciesSearchResult> | null
  /** Si hay conexión; por defecto, useOnlineStatus(). */
  online?: boolean
  /** Punto de enganche para medir cada respuesta mostrada (#146). */
  onMeasure?: OnOwnershipMeasure
  /** Reloj en milisegundos, para las pruebas. Por defecto, performance.now. */
  now?: () => number
}

export interface OwnershipAnswerState {
  /** La respuesta que se muestra; null sin búsqueda válida o sin datos. */
  ownership: Ownership | null
  /** Lo escrito, sin espacios de sobra (el texto diferido). */
  typed: string
  /**
   * Nombre para registrar lo buscado: el del catálogo si lo escrito es una
   * especie; si no, lo escrito.
   */
  registerName: string
  /** Nombre del catálogo si lo escrito es una sola especie que no tiene. */
  catalogName: string | null
  /** Si el catálogo mejoró la respuesta local (#124). */
  improvedByCatalog: boolean
}

const performanceNow = () => performance.now()

// Lógica de "¿Ya la tengo?" (#19, #123, #124, #146), sin presentación: la
// comparten la pantalla propia (/ya-la-tengo, #209) y el panel del inventario
// (OwnershipPanel). La respuesta sale de la colección en memoria
// (collection/ownership.ts) mientras se escribe, sin esperar a la red; con
// conexión, el catálogo la mejora cuando llega (useCatalogOwnership). Cada
// respuesta pintada se mide (ownership-measure.ts) y se entrega a onMeasure,
// que decide si cuenta como evento (telemetry/useHaveItSearchEvents.ts).
export function useOwnershipAnswer({
  plants,
  query,
  extras,
  searchSpecies = catalogSearchSpecies,
  online: onlineProp,
  onMeasure,
  now = performanceNow,
}: OwnershipAnswerOptions): OwnershipAnswerState {
  const deferredQuery = useDeferredValue(query)
  const index = useMemo(
    () => (plants === null ? null : ownershipIndexFor(plants, extras)),
    [plants, extras],
  )
  const local = useMemo(
    () =>
      index === null
        ? { value: null, ms: 0 }
        : timed(() => answerOwnership(index, deferredQuery), now),
    [index, deferredQuery, now],
  )
  const deviceOnline = useOnlineStatus()
  const online = onlineProp ?? deviceOnline
  const improved = useCatalogOwnership({
    local: local.value,
    index,
    query: deferredQuery,
    search: searchSpecies,
    online,
  })
  const ownership = improved?.ownership ?? null

  useOwnershipMeasurement(
    query,
    {
      ownership,
      source: improved?.improved ? 'catalog' : 'local',
      computeMs: local.ms,
      online,
    },
    onMeasure,
    now,
  )

  const typed = deferredQuery.trim().replace(/\s+/g, ' ')
  return {
    ownership,
    typed,
    registerName: improved?.catalogName ?? typed,
    catalogName: improved?.catalogName ?? null,
    improvedByCatalog: improved?.improved ?? false,
  }
}

/**
 * El nombre del que se habla en la respuesta: el género (o los géneros) si es
 * por género; el nombre de los ejemplares si todos se llaman igual; si no, lo
 * escrito.
 */
export function ownershipSubject(ownership: Ownership, typed: string): string {
  if (ownership.scope === 'genus') {
    return joinNames(ownership.genera.map(({ genus }) => genus.name))
  }
  const names = new Set(ownership.matches.map(({ plant }) => plant.displayName))
  if (names.size === 1) return [...names][0]
  return typed
}
