import type { Ownership } from '../collection/ownership.ts'
import { FILTER_PARAMS } from '../inventory/filter-params.ts'
import { ownershipSubject } from '../inventory/useOwnershipAnswer.ts'
import { PATHS } from '../routes/paths.ts'

/**
 * Parámetro con el que el inventario abre con el buscador lleno
 * (/coleccion?q=phal). Es el contrato con «Mi colección» (#208).
 */
export const COLLECTION_QUERY_PARAM = 'q'

/**
 * A dónde lleva «Ver en mi colección» (#209): el inventario con su buscador
 * lleno, que filtra con el mismo índice y la misma tolerancia que la
 * respuesta, así que muestra los ejemplares que la respuesta contó.
 *
 * - Con lo escrito, salvo que la coincidencia la añadiera el catálogo (#124:
 *   un sinónimo que la copia local no tiene); entonces el inventario no la
 *   encontraría por lo escrito y se usa el nombre de los ejemplares.
 * - "La tuviste": los ejemplares dados de baja no se ven por defecto en el
 *   inventario; se añade su estado (?estado=lost) si todos tienen el mismo. Si
 *   hay perdidos y regalados, no hay un filtro que los muestre a la vez: null
 *   (la lista de la respuesta enlaza a cada uno).
 * - Sin coincidencias: null.
 */
export function collectionLinkFor(
  ownership: Ownership,
  typed: string,
  improvedByCatalog: boolean,
): string | null {
  const params = new URLSearchParams()
  const query = improvedByCatalog ? ownershipSubject(ownership, typed) : typed
  if (query === '') return null
  params.set(COLLECTION_QUERY_PARAM, query)
  if (ownership.matches.length === 0) {
    const statuses = new Set(
      ownership.pastMatches.map(({ plant }) => plant.status),
    )
    if (statuses.size !== 1) return null
    params.set(FILTER_PARAMS.status, [...statuses][0])
  }
  return `${PATHS.collection}?${params.toString()}`
}
