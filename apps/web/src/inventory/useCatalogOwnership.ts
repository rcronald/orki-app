import { useMemo, useState } from 'react'
import {
  withCatalog,
  type CatalogOwnership,
  type Ownership,
  type OwnershipIndex,
} from '../collection/ownership.ts'
import type {
  CatalogSearchFunction,
  SpeciesSearchResult,
} from '../lib/catalogSearch.ts'
import { useCatalogSearch } from '../lib/useCatalogSearch.ts'

// "¿Ya la tengo?" con el catálogo (#124): con conexión, lo escrito se busca
// también en search_species y, si corresponde a una especie que el usuario
// tiene enlazada en alguna planta (por un sinónimo o un nombre común), la
// respuesta pasa a "Sí" (withCatalog en collection/ownership.ts).
//
// - Nunca retrasa la respuesta local: esta se pinta primero y el catálogo solo
//   la mejora cuando llega.
// - Solo se consulta si hace falta: con conexión, con la colección cargada y
//   cuando la respuesta local es por especie y no es ya "Sí, la tienes".
// - Espera entre pulsaciones, cancelación al seguir escribiendo y descarte de
//   las respuestas tardías: los de useCatalogSearch. Mientras llega la
//   respuesta de lo último escrito se siguen usando las especies de la
//   anterior, pero vueltas a comprobar contra el texto actual con las reglas
//   locales (catalogMatchQuality): así la mejora no parpadea al seguir
//   escribiendo y una especie que ya no corresponde a lo escrito no cuenta.
// - Sin conexión o con un error, queda la respuesta local, sin mensajes.
// - El texto solo se envía a search_species, y nada más se registra.

const NO_RESULTS: readonly SpeciesSearchResult[] = []
const NO_SEARCH: CatalogSearchFunction<SpeciesSearchResult> = () =>
  Promise.resolve([])

export function useCatalogOwnership({
  local,
  index,
  query,
  search,
  online,
}: {
  /** Respuesta local para `query`; null si no hay respuesta. */
  local: Ownership | null
  index: OwnershipIndex | null
  /** El texto al que responde `local`. */
  query: string
  /** searchSpecies o una función con su firma; null, sin catálogo. */
  search: CatalogSearchFunction<SpeciesSearchResult> | null
  online: boolean
}): CatalogOwnership | null {
  const enabled =
    search !== null &&
    online &&
    local !== null &&
    local.scope === 'species' &&
    local.outcome !== 'owned'
  const catalog = useCatalogSearch(search ?? NO_SEARCH, query, { enabled })
  const settled = catalog.status === 'success' || catalog.status === 'empty'

  // Las últimas especies que llegaron, para usarlas mientras llega la
  // respuesta siguiente. Se guardan durante el render (no en un efecto): así
  // no hay un pintado intermedio sin ellas.
  const [held, setHeld] = useState(NO_RESULTS)
  if (settled && catalog.results !== held) setHeld(catalog.results)

  const results = settled
    ? catalog.results
    : enabled && catalog.status === 'loading'
      ? held
      : NO_RESULTS

  return useMemo(
    () =>
      local === null || index === null
        ? null
        : withCatalog(local, index, query, results),
    [local, index, query, results],
  )
}
