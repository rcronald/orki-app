import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react'
import type { CollectionPlant } from './model.ts'
import type { CollectionSnapshot, CollectionStore } from './store.ts'

/** Almacén de la colección que comparte <CollectionProvider>. */
export const CollectionContext = createContext<CollectionStore | null>(null)

export interface CollectionApi extends CollectionSnapshot {
  /** Vuelve a leer la colección (por ejemplo, el botón "Reintentar"). */
  reload: () => void
  /**
   * Refleja una planta recién creada o editada en la base (#11, #16), sin
   * volver a leerlo todo. Si mientras tanto cambió el usuario, no hace nada.
   */
  upsertPlant: (plant: CollectionPlant) => void
  /** Quita una planta recién borrada de la base. Igual que upsertPlant. */
  removePlant: (id: string) => void
}

/**
 * La colección del usuario activo. La primera pantalla que la usa lanza la
 * lectura; las demás comparten la misma lectura y los mismos datos. Va dentro
 * de <CollectionProvider>.
 *
 * Con `plants` se trabaja con las funciones de selectors.ts (activas por
 * defecto, filtro por texto, agrupación, contadores, orden).
 */
export function useCollection(): CollectionApi {
  const store = useContext(CollectionContext)
  if (store === null) {
    throw new Error('useCollection() necesita un <CollectionProvider>.')
  }
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)

  // Retiene la colección mientras la pantalla está montada: la primera
  // retención la carga. Soltarla no la descarta (ver store.ts).
  useEffect(() => store.retain(), [store])

  const { userId } = snapshot
  return useMemo(
    () => ({
      ...snapshot,
      reload: () => store.reload(),
      // Atadas al usuario con el que se pintó la pantalla: una escritura que
      // termina después de cambiar de cuenta no toca la colección de la otra.
      upsertPlant: (plant: CollectionPlant) => {
        if (store.getSnapshot().userId === userId) store.upsertPlant(plant)
      },
      removePlant: (id: string) => {
        if (store.getSnapshot().userId === userId) store.removePlant(id)
      },
    }),
    [snapshot, store, userId],
  )
}
