import { requestPersistentStorage } from '../lib/persistent-storage.ts'
import { supabaseExtrasFetcher, type ExtrasFetcher } from './extras-source.ts'
import {
  createIndexedDbCopyStorage,
  type LocalCopy,
  type LocalCopyStorage,
} from './local-copy.ts'
import type { CollectionPlant } from './model.ts'
import type { OwnershipExtras } from './ownership.ts'
import {
  CollectionLoadError,
  collectionErrorFrom,
  type CollectionErrorReason,
  type CollectionSource,
} from './source.ts'
import { supabaseCollectionSource } from './supabase-source.ts'

// Fuente de la colección con copia local (#18, #118). Envuelve la de la red
// (Supabase) y una copia por usuario en el dispositivo (local-copy.ts):
//
// 1. Lee la copia del usuario y, si la hay, la entrega como resultado
//    provisional (provide): el inventario aparece sin esperar a la red.
// 2. Pide la colección a la red y, con ella, los sinónimos, nombres comunes y
//    abreviaturas de sus especies y géneros (extras-source.ts). Guarda las dos
//    cosas como copia nueva, con la fecha, y devuelve las plantas.
// 3. Si la red falla por falta de conexión y hay copia, devuelve la copia
//    (la colección queda "lista", con la copia) y lo marca en la información
//    de la copia (`offlineSince`), para el indicador del #120. Con otro fallo
//    (sesión terminada, error del servidor) rechaza como antes: el almacén
//    conserva la copia en pantalla junto al aviso de error.
//
// Si los extras no llegan, se conservan los de la copia anterior: las plantas
// son lo que manda.
//
// Además:
// - save(): el almacén la llama tras cada cambio hecho en la app (registro,
//   edición, baja, eliminación) para que la copia lo refleje sin releer.
// - setActiveUser(): CollectionProvider la llama con el usuario activo al
//   cambiar de cuenta o cerrar sesión (null). Borra las copias de los demás y
//   desde ese momento solo se escribe la copia de ese usuario: una lectura de
//   la cuenta anterior que termine tarde no vuelve a crear su copia.
// - setVerified(false): sin Clerk (sesión sin confirmar, #120) solo se usa
//   la copia; no se pide nada a la red sin token.
// - La información de la copia (getInfo, subscribe) dice de qué usuario es,
//   cuándo se actualizó desde la red, sus extras y si se está mostrando por
//   falta de conexión. Lo leen las pantallas con useCollectionCopy().

/** Lo que se sabe de la copia de la colección del usuario activo. */
export interface CollectionCopyInfo {
  userId: string
  /** Última vez que la copia se actualizó desde la red (ISO 8601); null si nunca. */
  savedAt: string | null
  /** Sinónimos, nombres comunes y abreviaturas para "¿Ya la tengo?". */
  extras: OwnershipExtras
  /**
   * Si la última lectura no llegó a la red por falta de conexión y lo que se
   * ve es la copia: el motivo; null si lo que se ve vino de la red.
   */
  unreachable: CollectionErrorReason | null
}

export interface CachedCollectionSource extends CollectionSource {
  save(userId: string, plants: readonly CollectionPlant[]): void
  setActiveUser(userId: string | null): void
  /**
   * Si la sesión del usuario activo está confirmada (por Clerk). Sin
   * confirmar (sin Clerk, #120), no se pide nada a la red: las peticiones
   * irían sin token, Supabase devolvería una colección vacía y la copia se
   * pisaría con ella. Se entrega la copia, o se rechaza como sin conexión.
   */
  setVerified(verified: boolean): void
  subscribe: (listener: () => void) => () => void
  getInfo: () => CollectionCopyInfo | null
}

export interface CachedSourceOptions {
  network?: CollectionSource
  storage?: LocalCopyStorage
  fetchExtras?: ExtrasFetcher
  now?: () => Date
  /** Se llama tras guardar una copia; por defecto pide almacenamiento persistente. */
  onSaved?: () => void
}

const NO_EXTRAS: OwnershipExtras = {}

export function createCachedCollectionSource({
  network = supabaseCollectionSource,
  storage = createIndexedDbCopyStorage(),
  fetchExtras = supabaseExtrasFetcher,
  now = () => new Date(),
  onSaved = () => void requestPersistentStorage(),
}: CachedSourceOptions = {}): CachedCollectionSource {
  // undefined: aún no se fijó (así el primer setActiveUser(null) también
  // borra las copias que hubiera).
  let activeUser: string | null | undefined = undefined
  let verified = true
  /** Lo último guardado del usuario activo (base para save()). */
  let current: LocalCopy | null = null
  let info: CollectionCopyInfo | null = null
  const listeners = new Set<() => void>()

  function setInfo(next: CollectionCopyInfo | null) {
    info = next
    for (const listener of listeners) listener()
  }

  async function write(copy: LocalCopy) {
    if (copy.userId !== activeUser) return
    await storage.write(copy)
    // Cambió de cuenta mientras se escribía: se borra lo que no es del
    // usuario activo.
    if (copy.userId !== activeUser) {
      await storage.deleteExcept(activeUser)
      return
    }
    onSaved()
  }

  return {
    async load({ userId, signal, provide }) {
      const copy = await storage.read(userId).catch(() => null)
      signal.throwIfAborted()
      if (copy !== null) {
        current = copy
        provide(copy.plants)
        setInfo({
          userId,
          savedAt: copy.savedAt,
          extras: copy.extras,
          unreachable: null,
        })
      }

      let plants: readonly CollectionPlant[]
      try {
        if (!verified) throw new CollectionLoadError('offline')
        plants = await network.load({ userId, signal, provide })
      } catch (error) {
        const failure = collectionErrorFrom(error)
        if (!signal.aborted && copy !== null && failure.reason === 'offline') {
          setInfo({
            userId,
            savedAt: copy.savedAt,
            extras: copy.extras,
            unreachable: 'offline',
          })
          return copy.plants
        }
        throw error
      }

      let extras = copy?.extras ?? NO_EXTRAS
      try {
        extras = await fetchExtras(plants, signal)
      } catch {
        // Sin extras nuevos: valen los de la copia anterior.
      }
      signal.throwIfAborted()

      const fresh: LocalCopy = {
        userId,
        savedAt: now().toISOString(),
        plants,
        extras,
      }
      current = fresh
      setInfo({
        userId,
        savedAt: fresh.savedAt,
        extras,
        unreachable: null,
      })
      void write(fresh)
      return plants
    },

    save(userId, plants) {
      if (userId !== activeUser) return
      const base = current?.userId === userId ? current : null
      const next: LocalCopy = {
        userId,
        // La fecha es la de la última lectura completa desde la red: el
        // cambio está en la base, pero otras plantas pueden haber cambiado
        // desde otro dispositivo.
        savedAt: base?.savedAt ?? now().toISOString(),
        plants,
        extras: base?.extras ?? NO_EXTRAS,
      }
      current = next
      void write(next)
    },

    setVerified(next) {
      verified = next
    },

    setActiveUser(userId) {
      if (userId === activeUser) return
      activeUser = userId
      if (current?.userId !== userId) current = null
      if (info !== null && info.userId !== userId) setInfo(null)
      void storage.deleteExcept(userId)
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    getInfo: () => info,
  }
}
