import { createContext, useContext, useMemo, useSyncExternalStore } from 'react'
import type { CollectionCopyInfo } from './cached-source.ts'
import { extrasStateOf, type ExtrasState } from './extras-state.ts'
import type { CollectionPlant } from './model.ts'
import type { OwnershipExtras } from './ownership.ts'
import { CollectionContext } from './useCollection.ts'

/** Información de la copia local que comparte <CollectionProvider>. */
export interface CollectionCopySource {
  subscribe: (listener: () => void) => () => void
  getInfo: () => CollectionCopyInfo | null
  /**
   * Vuelve a pedir los extras que faltan para la colección en memoria, aunque
   * la última vez fallaran (#274). Sin la función, la fuente no los pide.
   */
  retryExtras?: () => void
}

export const CollectionCopyContext = createContext<CollectionCopySource | null>(
  null,
)

const NO_COPY: CollectionCopySource = {
  subscribe: () => () => {},
  getInfo: () => null,
}

const NO_EXTRAS: OwnershipExtras = {}

/**
 * Lo que se sabe de la copia local de la colección del usuario activo (#18):
 * cuándo se actualizó y si lo que se ve es la copia por falta de conexión.
 * null si la fuente no tiene copia o la copia es de otro usuario.
 */
export function useCollectionCopy(): CollectionCopyInfo | null {
  const copy = useContext(CollectionCopyContext) ?? NO_COPY
  const store = useContext(CollectionContext)
  const info = useSyncExternalStore(copy.subscribe, copy.getInfo)
  const userId = useSyncExternalStore(
    store?.subscribe ?? NO_COPY.subscribe,
    () => store?.getSnapshot().userId ?? null,
  )
  return info !== null && info.userId === userId ? info : null
}

/** Sinónimos, nombres comunes y abreviaturas de la copia local, para "¿Ya la tengo?". */
export function useOwnershipExtras(): OwnershipExtras {
  return useCollectionCopy()?.extras ?? NO_EXTRAS
}

/**
 * Si los sinónimos, nombres comunes y abreviaturas están completos para estas
 * plantas (#274, extras-state.ts). Sin información de la copia (una fuente
 * sin copia local, como la de la página de muestra), "complete": no hay
 * extras que esperar.
 */
export function useExtrasState(
  plants: readonly CollectionPlant[] | null,
): ExtrasState {
  const copy = useCollectionCopy()
  return useMemo(
    () =>
      copy === null || plants === null
        ? 'complete'
        : extrasStateOf(plants, copy.extrasCoverage, copy.extrasRequest),
    [copy, plants],
  )
}

/** Vuelve a pedir los extras que faltan (#274); null si la fuente no sabe. */
export function useRetryExtras(): (() => void) | null {
  return useContext(CollectionCopyContext)?.retryExtras ?? null
}
