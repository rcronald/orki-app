import { useAuth } from '@clerk/react'
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { forgetPlantImagesExcept } from '../photos/read.ts'
import { COLLECTION_REFRESH_AFTER_MS, CollectionStore } from './store.ts'
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
 *
 * Al volver a la app tras COLLECTION_REFRESH_AFTER_MS o más en segundo plano
 * (la pestaña o la PWA oculta, evento visibilitychange), la colección ya
 * cargada se actualiza en segundo plano (store.refresh()): así se ve lo que
 * cambió fuera del dispositivo, como una propuesta que resolvió un
 * administrador, sin perder la búsqueda, los filtros ni la posición.
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

  useEffect(() => {
    let hiddenAt: number | null =
      document.visibilityState === 'hidden' ? Date.now() : null
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        return
      }
      if (
        hiddenAt !== null &&
        Date.now() - hiddenAt >= COLLECTION_REFRESH_AFTER_MS
      ) {
        store.refresh()
      }
      hiddenAt = null
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () =>
      document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [store])

  return <CollectionContext value={store}>{children}</CollectionContext>
}
