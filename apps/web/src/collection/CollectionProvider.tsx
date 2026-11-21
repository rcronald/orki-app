import { useAuth } from '@clerk/react'
import { useLayoutEffect, useState, type ReactNode } from 'react'
import { forgetPlantImagesExcept } from '../photos/read.ts'
import { CollectionStore } from './store.ts'
import type { CollectionSource } from './source.ts'
import { supabaseCollectionSource } from './supabase-source.ts'
import { CollectionContext } from './useCollection.ts'

interface CollectionProviderProps {
  /**
   * De dónde se lee la colección. Por defecto, Supabase. Se fija al montar:
   * cambiarla después no tiene efecto. La caché local del #18 la sustituirá
   * por una que envuelva a supabaseCollectionSource.
   */
  source?: CollectionSource
  children: ReactNode
}

/**
 * Comparte la colección del usuario con sesión entre todas las pantallas (ver
 * store.ts). No lee nada al montarse: la lectura la lanza la primera pantalla
 * que llama a useCollection().
 *
 * Va dentro de <ClerkProvider> (en AuthProvider) y toma el usuario de
 * useAuth(). Al cambiar de usuario o cerrar sesión, la colección anterior se
 * descarta. Lo hace en un efecto de layout: corre antes que los efectos
 * normales de las pantallas (que piden la colección) y antes de pintar, así
 * que ninguna pantalla ve un instante los datos de la cuenta anterior.
 */
export function CollectionProvider({
  source = supabaseCollectionSource,
  children,
}: CollectionProviderProps) {
  const { isLoaded, isSignedIn, userId } = useAuth()
  const activeUserId = isLoaded && isSignedIn && userId ? userId : null
  const [store] = useState(() => new CollectionStore(source))

  // Mientras Clerk recarga la sesión (isLoaded vuelve un momento a false), se
  // conserva el usuario anterior: no es un cambio de cuenta.
  const keepPrevious = !isLoaded
  useLayoutEffect(() => {
    if (keepPrevious) return
    store.setUser(activeUserId)
    // Las fotos guardadas en el dispositivo (memoria y Cache Storage) son
    // solo las del usuario activo: al cambiar de cuenta o cerrar sesión se
    // olvidan las de los demás (#83, #18).
    forgetPlantImagesExcept(activeUserId)
  }, [store, activeUserId, keepPrevious])

  return <CollectionContext value={store}>{children}</CollectionContext>
}
