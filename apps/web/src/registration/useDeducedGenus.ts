import { useEffect, useEffectEvent, useState, type Dispatch } from 'react'
import {
  prepareSearchQuery,
  type CatalogSearchFunction,
  type GenusSearchResult,
} from '../lib/catalogSearch.ts'
import { SEARCH_DEBOUNCE_MS } from '../lib/useCatalogSearch.ts'
import type {
  FormGenus,
  PlantFormAction,
  PlantFormValues,
} from './form-state.ts'
import { deducedGenus, genusWordOf } from './name-match.ts'

/**
 * Género marcado de antemano por la primera palabra de un nombre libre (#280):
 * «Cattleya Mini Purple» marca Cattleya, «Mps. Rojo» marca Miltoniopsis (por
 * su abreviatura), con search_genera. Solo si no hay especie enlazada, "Otro"
 * está cerrado y el género no lo eligió la persona: lo elegido a mano no se
 * toca, y lo deducido cambia (o se quita) si cambia la primera palabra.
 *
 * Busca con la misma espera entre pulsaciones que el autocompletado y decide
 * al llegar la respuesta. Si la búsqueda falla, no se marca nada.
 *
 * Devuelve `forget`, para llamarlo cuando la persona elige un género (aunque
 * sea el mismo que se dedujo): desde entonces ya no se cambia solo.
 */
export function useDeducedGenus(
  values: PlantFormValues,
  dispatch: Dispatch<PlantFormAction>,
  searchGenera: CatalogSearchFunction<GenusSearchResult>,
  enabled: boolean,
): { forget: () => void } {
  const [deducedId, setDeducedId] = useState<string | null>(null)
  const word = genusWordOf(values.name)
  const currentId = values.genus?.id ?? null
  const free =
    enabled &&
    values.species === null &&
    !values.otherGenusOpen &&
    (currentId === null || currentId === deducedId)

  // Con lo que haya en ese momento (no con lo de cuando salió la búsqueda).
  const settle = useEffectEvent((found: FormGenus | null) => {
    if (!free) return
    if (found !== null) {
      if (currentId !== found.id) {
        dispatch({ type: 'genusDeduced', genus: found })
      }
      setDeducedId(found.id)
    } else if (currentId !== null && currentId === deducedId) {
      dispatch({ type: 'genusDeduced', genus: null })
      setDeducedId(null)
    }
  })

  useEffect(() => {
    if (!free) return
    const query = prepareSearchQuery(word)
    const controller = new AbortController()
    const timer = setTimeout(() => {
      if (query === null) {
        settle(null)
        return
      }
      searchGenera(query, { signal: controller.signal }).then(
        (results) => {
          if (!controller.signal.aborted) settle(deducedGenus(word, results))
        },
        // Cancelada, sin conexión o con un fallo: el género se elige a mano.
        () => {},
      )
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [free, word, searchGenera])

  return { forget: () => setDeducedId(null) }
}
