import { PREFERENCES_KEY } from '../inventory/preferences.ts'
import { ACCOUNT_DELETION_MARKER_PREFIX } from '../lib/account-deletion-marker.ts'
import {
  forgetPlantImagesExcept,
  THUMBNAIL_CACHE_PREFIX,
} from '../photos/read.ts'
import { plantDraftKey } from '../registration/draft.ts'

// Limpieza del dispositivo al eliminar la cuenta (#110).
//
// Lo que la app guarda en el navegador (revisado en el código el 21 de
// noviembre de 2026):
// - localStorage:
//   - orki:registro:borrador:<usuario>: borrador del registro
//     (registration/draft.ts).
//   - orki:inventario:preferencias:v1: vista y agrupación del inventario
//     (inventory/preferences.ts). Es del dispositivo, no de una cuenta, pero
//     se borra igual: la persona eligió irse.
//   - orki:cuenta:eliminacion:<usuario>: la marca de eliminación en curso
//     (lib/account-deletion-marker.ts). Se borra solo al final, con la cuenta
//     ya eliminada (keepMarker).
// - sessionStorage: nada propio hoy; por si acaso se borra cualquier clave
//   "orki:" que lleve el id del usuario.
// - Cache Storage: orki-miniaturas-v1:<usuario>, las miniaturas
//   (photos/read.ts). Las cachés del service worker (workbox-precache-...)
//   no se tocan: son la app, no datos de nadie.
// - Memoria: las imágenes de la fuente de la app (forgetPlantImagesExcept) y
//   la colección (CollectionStore, que vacía quien llama; ver
//   useAccountDeletion.ts). La posición de desplazamiento del inventario
//   (inventory/scroll-memory.ts) es solo de la pestaña y no tiene datos.
// - IndexedDB: la app no lo usa. Lo que guarde Clerk en el navegador lo
//   gestiona Clerk al cerrar la sesión.
//
// Nunca lanza: si un almacenamiento no existe o falla, sigue con el resto.

export interface DeviceCleanupOptions {
  /** Conserva la marca de eliminación (la cuenta de Clerk aún existe). */
  keepMarker?: boolean
}

function safeStorage(name: 'localStorage' | 'sessionStorage'): Storage | null {
  try {
    return window[name]
  } catch {
    return null
  }
}

function removeKeys(
  storage: Storage | null,
  shouldRemove: (key: string) => boolean,
) {
  if (!storage) return
  try {
    const keys: string[] = []
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key !== null && shouldRemove(key)) keys.push(key)
    }
    for (const key of keys) storage.removeItem(key)
  } catch {
    // Almacenamiento bloqueado: no hay nada que se pueda borrar.
  }
}

/** Borra del dispositivo lo guardado de la cuenta `userId`. */
export async function clearDeviceDataFor(
  userId: string,
  { keepMarker = false }: DeviceCleanupOptions = {},
): Promise<void> {
  const markerKey = `${ACCOUNT_DELETION_MARKER_PREFIX}${userId}`
  const isOwnKey = (key: string) =>
    key.startsWith('orki:') && key.includes(userId)

  removeKeys(safeStorage('localStorage'), (key) => {
    if (key === markerKey) return !keepMarker
    return (
      key === plantDraftKey(userId) || key === PREFERENCES_KEY || isOwnKey(key)
    )
  })
  removeKeys(safeStorage('sessionStorage'), isOwnKey)

  // Imágenes en memoria y miniaturas de Cache Storage (lo mismo que hace
  // CollectionProvider al cerrar sesión).
  forgetPlantImagesExcept(null)
  if (typeof globalThis.caches !== 'undefined') {
    try {
      await caches.delete(`${THUMBNAIL_CACHE_PREFIX}${userId}`)
    } catch {
      // Sin Cache Storage utilizable no hay nada que borrar.
    }
  }
}
