import type { CollectionPlant } from '../collection/model.ts'
import {
  buildOwnershipIndex,
  matchPlantNames,
  unlinkedPlantsNamed,
  type SpeciesNames,
} from '../collection/ownership.ts'
import { FILTER_PARAMS } from '../inventory/filter-params.ts'
import { PATHS, plantDetailPath } from '../routes/paths.ts'

/** La búsqueda del inventario (COLLECTION_QUERY_PARAM, #208). */
const QUERY_PARAM = 'q'

// Qué dice la ficha de una especie de la colección de quien la mira (#232,
// #296), con el criterio de «¿Ya la tengo?»:
//
// - Enlazados (linked): ejemplares activos con esta especie. Dan «La tienes».
// - Sin validar (unlinked): ejemplares activos sin especie cuyo nombre
//   corresponde a esta (unlinkedPlantsNamed). Sin enlazados, dan «Podrías
//   tenerla»; con ellos, una mención.
// - Dados de baja (lost, gifted): los perdidos o regalados, enlazados o sin
//   validar con su nombre. Nunca dan un «sí»: se mencionan aparte («la
//   tuviste»), como en «¿Ya la tengo?».

export interface SpeciesOwnership {
  linked: CollectionPlant[]
  unlinked: CollectionPlant[]
  lost: number
  gifted: number
}

export function speciesOwnershipOf(
  plants: readonly CollectionPlant[],
  species: SpeciesNames & { id: string },
): SpeciesOwnership {
  const linked = plants.filter((plant) => plant.species?.id === species.id)
  const unlinked = unlinkedPlantsNamed(plants, species).map(
    ({ plant }) => plant,
  )
  const all = [...linked, ...unlinked]
  return {
    linked: linked.filter((plant) => plant.status === 'active'),
    unlinked: unlinked.filter((plant) => plant.status === 'active'),
    lost: all.filter((plant) => plant.status === 'lost').length,
    gifted: all.filter((plant) => plant.status === 'gifted').length,
  }
}

/**
 * A dónde lleva «Podrías tenerla»: con un ejemplar, a su ficha; con varios, al
 * inventario filtrado por su validación y con una búsqueda que los encuentre
 * a todos (el nombre de la especie o el que comparten), si la hay. El
 * inventario busca con el mismo índice (matchPlantNames), así que se
 * comprueba aquí con él.
 */
export function unlinkedLink(
  unlinked: readonly CollectionPlant[],
  scientificName: string,
): string {
  if (unlinked.length === 1) return plantDetailPath(unlinked[0].id)
  const params = new URLSearchParams()
  const index = buildOwnershipIndex(unlinked)
  const candidates = new Set([
    scientificName,
    ...unlinked.map((plant) => plant.enteredName),
  ])
  for (const query of candidates) {
    const found = matchPlantNames(index, query)
    if (found !== null && unlinked.every((plant) => found.has(plant.id))) {
      params.set(QUERY_PARAM, query)
      break
    }
  }
  for (const validation of new Set(unlinked.map((plant) => plant.validation))) {
    params.append(FILTER_PARAMS.validation, validation)
  }
  return `${PATHS.collection}?${params.toString()}`
}
