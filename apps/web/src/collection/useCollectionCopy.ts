import { createContext, useContext, useSyncExternalStore } from 'react'
import type { CollectionCopyInfo } from './cached-source.ts'
import type { OwnershipExtras } from './ownership.ts'
import { CollectionContext } from './useCollection.ts'

/** Información de la copia local que comparte <CollectionProvider>. */
export interface CollectionCopySource {
  subscribe: (listener: () => void) => () => void
  getInfo: () => CollectionCopyInfo | null
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
