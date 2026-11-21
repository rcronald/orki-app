import type { CollectionPlant } from '../collection/model.ts'
import type { CollectionLoadError } from '../collection/source.ts'
import {
  useCollection,
  type CollectionApi,
} from '../collection/useCollection.ts'

// Una planta de la colección en memoria por su id, para el detalle y la
// edición (#16). No hay consulta propia: si se abre la dirección directamente
// (una recarga, un enlace), se espera a que llegue la colección, que se pide
// igualmente. Una planta que no está en la colección del usuario (no existe o
// es de otra cuenta: las políticas de la base no dejan leerla) se ve igual,
// "no encontrada", sin decir cuál de las dos cosas pasa.

export type PlantLookup =
  | { status: 'loading' }
  | { status: 'error'; error: CollectionLoadError }
  | { status: 'not-found' }
  | { status: 'found'; plant: CollectionPlant }

/** Busca `plantId` en una colección (useCollection()). */
export function lookUpPlant(
  collection: Pick<CollectionApi, 'status' | 'plants' | 'error'>,
  plantId: string | undefined,
): PlantLookup {
  const { status, plants, error } = collection
  const plant =
    plantId === undefined
      ? undefined
      : plants?.find((candidate) => candidate.id === plantId)
  if (plant) return { status: 'found', plant }
  // Con la colección completa (o la última copia, si falló una recarga), lo
  // que no está no existe para este usuario.
  if (status === 'ready' || (status === 'error' && plants !== null)) {
    return { status: 'not-found' }
  }
  if (status === 'error' && error !== null) return { status: 'error', error }
  return { status: 'loading' }
}

/** La planta `plantId` y la colección de la que sale. */
export function usePlantLookup(plantId: string | undefined): {
  lookup: PlantLookup
  collection: CollectionApi
} {
  const collection = useCollection()
  return { lookup: lookUpPlant(collection, plantId), collection }
}
