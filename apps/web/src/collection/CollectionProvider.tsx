import { useAuth } from '@clerk/react'
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { forgetPlantImagesExcept } from '../photos/read.ts'
import {
  createCachedCollectionSource,
  type CachedCollectionSource,
} from './cached-source.ts'
import { COLLECTION_REFRESH_AFTER_MS, CollectionStore } from './store.ts'
import type { CollectionSource } from './source.ts'
import { CollectionContext } from './useCollection.ts'
import {
  CollectionCopyContext,
  type CollectionCopySource,
} from './useCollectionCopy.ts'

let appSource: CachedCollectionSource | undefined

/** Fuente de la app: Supabase con la copia local en IndexedDB (#18). */
function appCollectionSource(): CachedCollectionSource {
  appSource ??= createCachedCollectionSource()
  return appSource
}

function isCopySource(
  source: CollectionSource,
): source is CollectionSource & CollectionCopySource {
  return (
    typeof (source as Partial<CollectionCopySource>).getInfo === 'function' &&
    typeof (source as Partial<CollectionCopySource>).subscribe === 'function'
  )
}

function hasActiveUser(
  source: CollectionSource,
): source is CollectionSource & Pick<CachedCollectionSource, 'setActiveUser'> {
  return (
    typeof (source as Partial<CachedCollectionSource>).setActiveUser ===
    'function'
  )
}

interface CollectionProviderProps {
  /**
   * De dónde se lee la colección. Por defecto, Supabase con la copia local
   * del #18 (cached-source.ts). Se fija al montar: cambiarla después no tiene
   * efecto.
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
 * descarta, y con ella las copias locales de las demás cuentas. Lo hace en
 * un efecto de layout: corre antes que los efectos normales de las pantallas (que piden la colección) y antes de pintar, así
 * que ninguna pantalla ve un instante los datos de la cuenta anterior.
 *
 * Al volver a la app tras COLLECTION_REFRESH_AFTER_MS o más en segundo plano
 * (la pestaña o la PWA oculta, evento visibilitychange), la colección ya
 * cargada se actualiza en segundo plano (store.refresh()): así se ve lo que
 * cambió fuera del dispositivo, como una propuesta que resolvió un
 * administrador, sin perder la búsqueda, los filtros ni la posición.
 */
export function CollectionProvider({
  source: sourceProp,
  children,
}: CollectionProviderProps) {
  const { isLoaded, isSignedIn, userId } = useAuth()
  const activeUserId = isLoaded && isSignedIn && userId ? userId : null
  const [source] = useState(() => sourceProp ?? appCollectionSource())
  const [store] = useState(() => new CollectionStore(source))

  // Mientras Clerk recarga la sesión (isLoaded vuelve un momento a false), se
  // conserva el usuario anterior: no es un cambio de cuenta.
  const keepPrevious = !isLoaded
  useLayoutEffect(() => {
    if (keepPrevious) return
    // Primero la fuente: borra las copias locales de otras cuentas y solo
    // guarda la de esta antes de que empiece ninguna lectura.
    if (hasActiveUser(source)) source.setActiveUser(activeUserId)
    store.setUser(activeUserId)
    // Las fotos guardadas en el dispositivo (memoria y Cache Storage) son
    // solo las del usuario activo: al cambiar de cuenta o cerrar sesión se
    // olvidan las de los demás (#83, #18).
    forgetPlantImagesExcept(activeUserId)
  }, [source, store, activeUserId, keepPrevious])

  // Actualización sin que nadie toque nada. Las dos pasan por la lectura en
  // segundo plano del almacén (store.refresh: sin carga ni error, sin perder
  // los cambios locales), y la fuente guarda la copia local y su fecha:
  // - al volver a la app tras COLLECTION_REFRESH_AFTER_MS o más en segundo
  //   plano (#141): refresh, solo con la colección lista;
  // - al recuperar la conexión (evento online, #18): resume, que es refresh
  //   con la colección lista y, si la última lectura falló (sin conexión y
  //   sin copia), una lectura normal que sustituye el error.
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
    const onOnline = () => store.resume()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('online', onOnline)
    }
  }, [store])

  return (
    <CollectionContext value={store}>
      <CollectionCopyContext value={isCopySource(source) ? source : null}>
        {children}
      </CollectionCopyContext>
    </CollectionContext>
  )
}
