// Marca de "eliminación de cuenta en curso" (#110, parte de #26).
//
// La eliminación borra el perfil (paso 3) antes que la cuenta de Clerk (paso
// 4), porque sin la cuenta ya no hay token para borrar nada en Supabase. Entre
// los dos pasos la sesión sigue viva, y ProfileBootstrap volvería a crear el
// perfil si se lo pidieran: al recargar la página, al volver la conexión
// (evento online) o si el primer intento del ingreso había fallado. Esta marca
// se pone antes del primer paso y ensureProfile() (lib/profile.ts) no crea el
// perfil mientras existe. Se quita al terminar la eliminación o si la persona
// decide seguir usando Orki sin eliminarla.
//
// Se guarda en localStorage, por usuario, para que sobreviva a una recarga o a
// que el sistema cierre la app a medias; y también en memoria, por si
// localStorage no existe o falla (navegación privada, datos bloqueados): así
// al menos dura lo que dura la página.

/** Prefijo de la clave; va seguido del id de usuario de Clerk. */
export const ACCOUNT_DELETION_MARKER_PREFIX = 'orki:cuenta:eliminacion:'

const inMemory = new Set<string>()
const listeners = new Set<() => void>()

export function accountDeletionMarkerKey(userId: string): string {
  return `${ACCOUNT_DELETION_MARKER_PREFIX}${userId}`
}

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function notify() {
  for (const listener of listeners) listener()
}

/** Marca que la eliminación de la cuenta de `userId` empezó. */
export function markAccountDeletionStarted(userId: string): void {
  inMemory.add(userId)
  try {
    storage()?.setItem(
      accountDeletionMarkerKey(userId),
      new Date().toISOString(),
    )
  } catch {
    // Sin almacenamiento, queda la marca en memoria.
  }
  notify()
}

/** ¿Hay una eliminación de la cuenta de `userId` empezada y sin terminar? */
export function isAccountDeletionPending(userId: string): boolean {
  if (inMemory.has(userId)) return true
  try {
    return storage()?.getItem(accountDeletionMarkerKey(userId)) != null
  } catch {
    return false
  }
}

/** Quita la marca (eliminación terminada o abandonada a propósito). */
export function clearAccountDeletionMarker(userId: string): void {
  inMemory.delete(userId)
  try {
    storage()?.removeItem(accountDeletionMarkerKey(userId))
  } catch {
    // Sin almacenamiento no hay nada que borrar.
  }
  notify()
}

/** Para useSyncExternalStore: avisa cuando cambia alguna marca. */
export function subscribeToAccountDeletionMarker(
  listener: () => void,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Solo para pruebas: olvida las marcas en memoria. */
export function resetAccountDeletionMarkers(): void {
  inMemory.clear()
  notify()
}
