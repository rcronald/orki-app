import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { forgetUser, rememberUser } from '../auth/offline-identity.ts'
import { identityUserId, useAppIdentity } from '../auth/useAppIdentity.ts'
import { forgetPlantImagesExcept } from '../photos/read.ts'
import {
  syncThumbnails,
  thumbnailPathsOf,
  type ThumbnailSyncOptions,
} from '../photos/thumbnail-sync.ts'
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
import { SessionUnverifiedContext } from './useReadOnly.ts'

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

function canEnsureExtras(
  source: CollectionSource,
): source is CollectionSource & Pick<CachedCollectionSource, 'ensureExtras'> {
  return (
    typeof (source as Partial<CachedCollectionSource>).ensureExtras ===
    'function'
  )
}

function hasActiveUser(
  source: CollectionSource,
): source is CollectionSource &
  Pick<CachedCollectionSource, 'setActiveUser' | 'setVerified'> {
  return (
    typeof (source as Partial<CachedCollectionSource>).setActiveUser ===
      'function' &&
    typeof (source as Partial<CachedCollectionSource>).setVerified ===
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
  /**
   * Descarga en segundo plano de las miniaturas para verlas sin conexión
   * (#119). Por defecto, syncThumbnails; null, ninguna.
   */
  thumbnailSync?: ((options: ThumbnailSyncOptions) => Promise<unknown>) | null
  /** Espera antes de empezar esa descarga, en milisegundos. */
  thumbnailSyncDelayMs?: number
  children: ReactNode
}

/**
 * Espera tras tener la colección antes de bajar las miniaturas que faltan:
 * primero, las que la pantalla está mostrando.
 */
const THUMBNAIL_SYNC_DELAY_MS = 2_000

/**
 * Comparte la colección del usuario con sesión entre todas las pantallas (ver
 * store.ts). No lee nada al montarse: la lectura la lanza la primera pantalla
 * que llama a useCollection().
 *
 * Va dentro de <ClerkProvider> (en AuthProvider) y toma el usuario de
 * useAppIdentity(): el de Clerk o, sin Clerk (sin conexión), el último con
 * sesión en este dispositivo, en solo lectura (#18, #120). Al cambiar de
 * usuario o cerrar sesión, la colección anterior se descarta, y con ella las
 * copias locales y las miniaturas de las demás cuentas (todas, al cerrar
 * sesión). Lo hace en un efecto de layout: corre antes que los efectos
 * normales de las pantallas (que piden la colección) y antes de pintar, así
 * que ninguna pantalla ve un instante los datos de la cuenta anterior.
 *
 * Al volver a la app tras COLLECTION_REFRESH_AFTER_MS o más en segundo plano
 * (la pestaña o la PWA oculta, evento visibilitychange), la colección ya
 * cargada se actualiza en segundo plano (store.refresh()): así se ve lo que
 * cambió fuera del dispositivo, como una propuesta que resolvió un
 * administrador, sin perder la búsqueda, los filtros ni la posición.
 *
 * Sinónimos, nombres comunes y abreviaturas de "¿Ya la tengo?" (#274): con la
 * colección lista, la sesión confirmada y conexión, si a alguna planta le
 * faltan (una registrada o cambiada en la app con una especie o un género
 * nuevos), los pide (ensureExtras de la fuente); tras un fallo no insiste
 * sola: lo hacen "Reintentar" (retryExtras del contexto de la copia) y la
 * lectura al recuperar la conexión, que los vuelve a pedir todos.
 */
export function CollectionProvider({
  source: sourceProp,
  thumbnailSync = syncThumbnails,
  thumbnailSyncDelayMs = THUMBNAIL_SYNC_DELAY_MS,
  children,
}: CollectionProviderProps) {
  const identity = useAppIdentity()
  const activeUserId = identityUserId(identity)
  const [source] = useState(() => sourceProp ?? appCollectionSource())
  const [store] = useState(() => new CollectionStore(source))

  // Mientras Clerk carga o recarga la sesión (isLoaded vuelve un momento a
  // false), o si no está disponible y no se recuerda a nadie, se conserva el
  // usuario anterior: no es un cambio de cuenta.
  const keepPrevious =
    identity.kind === 'loading' || identity.kind === 'unavailable'
  const confirmed = identity.kind === 'signed-in'
  const shown = useRef<{ userId: string | null; confirmed: boolean } | null>(
    null,
  )
  useLayoutEffect(() => {
    if (keepPrevious) return
    // El último usuario con sesión en este dispositivo, para verlo sin
    // conexión; sin sesión, ninguno.
    if (confirmed && activeUserId !== null) rememberUser(activeUserId)
    if (activeUserId === null) forgetUser()
    // Primero la fuente: borra las copias locales de otras cuentas y solo
    // guarda la de esta antes de que empiece ninguna lectura. Sin la sesión
    // confirmada, solo la copia (sin token, la red no sirve).
    if (hasActiveUser(source)) {
      source.setVerified(confirmed)
      source.setActiveUser(activeUserId)
    }
    // Se confirma la sesión del mismo usuario que se veía sin confirmar
    // (vuelve Clerk): setUser no cambia nada, así que se relee de la red.
    const previous = shown.current
    shown.current = { userId: activeUserId, confirmed }
    const sameUser = store.getSnapshot().userId === activeUserId
    store.setUser(activeUserId)
    if (sameUser && confirmed && previous?.confirmed === false) store.resume()
    // Las fotos guardadas en el dispositivo (memoria y Cache Storage) son
    // solo las del usuario activo: al cambiar de cuenta o cerrar sesión se
    // olvidan las de los demás (#83, #18).
    forgetPlantImagesExcept(activeUserId)
  }, [source, store, activeUserId, keepPrevious, confirmed])

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

  // Extras que faltan (#274): ver arriba.
  useEffect(() => {
    if (!confirmed || !canEnsureExtras(source)) return
    const check = () => {
      const { userId, status, plants } = store.getSnapshot()
      if (userId === null || status !== 'ready' || plants === null) return
      if (!navigator.onLine) return
      source.ensureExtras(userId, plants)
    }
    const unsubscribe = store.subscribe(check)
    check()
    return unsubscribe
  }, [source, store, confirmed])

  const copySource = useMemo<CollectionCopySource | null>(() => {
    if (!isCopySource(source)) return null
    return {
      subscribe: source.subscribe,
      getInfo: source.getInfo,
      retryExtras: canEnsureExtras(source)
        ? () => {
            const { userId, plants } = store.getSnapshot()
            if (userId === null || plants === null) return
            source.ensureExtras(userId, plants, { force: true })
          }
        : undefined,
    }
  }, [source, store])

  // Miniaturas sin conexión (#119): con la colección completa, se limpian las
  // que sobran y se bajan las que faltan. Otra pasada cuando cambian las
  // fotos de la colección o tras cada lectura (al recuperar la conexión).
  useEffect(() => {
    // Sin la sesión confirmada no hay token para el bucket privado.
    if (thumbnailSync === null || !confirmed) return
    let controller: AbortController | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let lastKey = ''
    const stop = () => {
      controller?.abort()
      controller = null
      clearTimeout(timer)
    }
    const check = () => {
      const { userId, status, plants } = store.getSnapshot()
      if (userId === null || status !== 'ready' || plants === null) {
        lastKey = ''
        stop()
        return
      }
      const key = `${userId}|${[...thumbnailPathsOf(userId, plants)].sort().join('|')}`
      if (key === lastKey) return
      lastKey = key
      stop()
      const current = new AbortController()
      controller = current
      timer = setTimeout(() => {
        void thumbnailSync({ userId, plants, signal: current.signal })
      }, thumbnailSyncDelayMs)
    }
    const unsubscribe = store.subscribe(check)
    check()
    return () => {
      unsubscribe()
      stop()
    }
  }, [store, thumbnailSync, thumbnailSyncDelayMs, confirmed])

  return (
    <CollectionContext value={store}>
      <CollectionCopyContext value={copySource}>
        <SessionUnverifiedContext value={identity.kind === 'unverified'}>
          {children}
        </SessionUnverifiedContext>
      </CollectionCopyContext>
    </CollectionContext>
  )
}
