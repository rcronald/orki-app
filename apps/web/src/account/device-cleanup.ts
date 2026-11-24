import { markSignedOut } from '../auth/offline-identity.ts'
import { PREFERENCES_KEY } from '../inventory/preferences.ts'
import { ACCOUNT_DELETION_MARKER_PREFIX } from '../lib/account-deletion-marker.ts'
import {
  forgetPlantImagesExcept,
  THUMBNAIL_CACHE_PREFIX,
} from '../photos/read.ts'
import { plantDraftKey } from '../registration/draft.ts'
import { discardProductEvents } from '../telemetry/product-events.ts'

// Limpieza del dispositivo al eliminar la cuenta (#110).
//
// Lo que la app guarda en el navegador (revisado en el código el 21 de
// noviembre de 2026) y quién lo borra:
//
// Lo borra el cierre de sesión de la app (el mismo que el botón «Cerrar
// sesión», auth/offline-identity.ts markSignedOut; ver docs/sin-conexion.md),
// que se usa tal cual al terminar la eliminación:
// - localStorage orki-ultimo-usuario: el último usuario recordado.
// - IndexedDB orki-coleccion: la copia del inventario para usarlo sin
//   conexión (CollectionProvider, collection/local-copy.ts).
// - Cache Storage orki-miniaturas-v1:<usuario>: las miniaturas
//   (CollectionProvider, photos/read.ts), y las imágenes en memoria.
// - IndexedDB orki-eventos: la cola de eventos de uso (ProductEventsSync,
//   telemetry/queue.ts).
// El cierre de sesión con Clerk lo termina PendingSignOut, con lo que Clerk
// guarde en el navegador.
//
// Lo borra esta limpieza, porque el cierre de sesión lo conserva para cuando
// la misma persona vuelva a entrar:
// - localStorage orki:registro:borrador:<usuario>: el borrador del registro
//   (registration/draft.ts).
// - IndexedDB orki-registro: la foto del borrador (registration/
//   draft-photo.ts).
// - localStorage orki:inventario:preferencias:v1: vista, agrupación y orden del
//   inventario (inventory/preferences.ts). Es del dispositivo, no de una
//   cuenta, pero se borra igual: la persona eligió irse.
// - localStorage orki:perfil:creado:<usuario>: la marca de que el perfil ya
//   existe (lib/profile.ts, #285), solo «1». La quita también ensureProfile
//   al ver la eliminación en curso.
// - localStorage orki:cuenta:eliminacion:<usuario>: la marca de eliminación
//   en curso (lib/account-deletion-marker.ts). Se borra solo al final, con la
//   cuenta ya eliminada (keepMarker).
// - sessionStorage: nada propio hoy; por si acaso se borra cualquier clave
//   "orki:" que lleve el id del usuario.
// - Las miniaturas del usuario también aquí, con los datos ya borrados y la
//   cuenta de Clerk todavía viva (por si ese último paso falla).
//
// No se tocan las cachés del service worker (workbox-precache-...): son la
// app, no datos de nadie. La posición de desplazamiento del inventario
// (inventory/scroll-memory.ts) es solo de la pestaña y no tiene datos.
//
// Nada de esto lanza: si un almacenamiento no existe o falla, sigue con el
// resto.

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

/**
 * Borra la foto del borrador del registro. El módulo va en el chunk del
 * registro: se carga aquí de forma diferida para no sumarlo al de la app.
 */
async function clearDraftPhotoOf(userId: string): Promise<void> {
  try {
    const { appDraftPhotoBackend, clearDraftPhoto } =
      await import('../registration/draft-photo.ts')
    await clearDraftPhoto(appDraftPhotoBackend(), userId)
  } catch {
    // Sin el chunk o sin IndexedDB no hay nada que borrar aquí.
  }
}

/** Borra del dispositivo lo guardado de la cuenta `userId` (ver arriba). */
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

  await clearDraftPhotoOf(userId)

  // Imágenes en memoria y miniaturas de Cache Storage.
  forgetPlantImagesExcept(null)
  if (typeof globalThis.caches !== 'undefined') {
    try {
      await caches.delete(`${THUMBNAIL_CACHE_PREFIX}${userId}`)
    } catch {
      // Sin Cache Storage utilizable no hay nada que borrar.
    }
  }
}

/**
 * Lo que la eliminación hace en el dispositivo, en tres momentos. La app usa
 * appAccountDeletionDevice; la página de muestra, uno que no toca nada.
 */
export interface AccountDeletionDevice {
  /**
   * Antes del primer paso (también en un reintento): deja de registrar y
   * enviar eventos de uso y vacía su cola, para que ninguno llegue a la base
   * después de borrar el perfil.
   */
  beforeDeletion(userId: string): Promise<void>
  /** Con fotos, plantas y perfil ya borrados; la cuenta de Clerk aún existe. */
  afterDataDeleted(userId: string): Promise<void>
  /** Con la cuenta de Clerk eliminada. */
  afterAccountDeleted(userId: string): Promise<void>
}

export const appAccountDeletionDevice: AccountDeletionDevice = {
  beforeDeletion: () => discardProductEvents(),
  afterDataDeleted: (userId) =>
    clearDeviceDataFor(userId, { keepMarker: true }),
  async afterAccountDeleted(userId) {
    await clearDeviceDataFor(userId)
    // El cierre de sesión de la app: desde aquí la app trata a este usuario
    // como sin sesión (aunque Clerk tarde en saberlo o no haya red), y borra
    // la copia sin conexión, las miniaturas, el usuario recordado y las colas
    // de eventos. PendingSignOut termina la sesión en Clerk si sigue abierta.
    markSignedOut(userId)
  },
}

/** Para la página de muestra: no toca nada del dispositivo. */
export const noAccountDeletionDevice: AccountDeletionDevice = {
  beforeDeletion: () => Promise.resolve(),
  afterDataDeleted: () => Promise.resolve(),
  afterAccountDeleted: () => Promise.resolve(),
}
