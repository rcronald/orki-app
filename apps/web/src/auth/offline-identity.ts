import { useSyncExternalStore } from 'react'

// Identidad sin conexión (#18, #120; ver docs/sin-conexion.md). Sin red,
// Clerk no carga y la app no puede preguntarle quién es el usuario. La app
// recuerda ella misma:
//
// - el último usuario con sesión en este dispositivo (orki-ultimo-usuario):
//   solo su id de Clerk, opaco; ni correo ni nombre. Con él se muestra su
//   copia local en solo lectura mientras Clerk no esté disponible.
// - un cierre de sesión pendiente (orki-salida-pendiente): quien pulsó
//   "Cerrar sesión" sin poder avisar a Clerk (sin conexión). Desde ese
//   momento la app lo trata como sin sesión, y cuando Clerk vuelva a estar
//   disponible le pide cerrar la sesión (PendingSignOut).
//
// En localStorage, con try/catch: sin almacenamiento (algunos modos
// privados) se recuerda solo mientras dura la pestaña.

export const LAST_USER_KEY = 'orki-ultimo-usuario'
export const PENDING_SIGN_OUT_KEY = 'orki-salida-pendiente'

export interface OfflineIdentityState {
  /** Último usuario con sesión en este dispositivo; null si no hay. */
  lastUserId: string | null
  /** Usuario que cerró sesión sin que Clerk lo supiera todavía. */
  pendingSignOut: string | null
}

function read(key: string): string | null {
  try {
    const value = localStorage.getItem(key)
    return value === null || value === '' ? null : value
  } catch {
    return null
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Sin almacenamiento: queda solo en memoria.
  }
}

let state: OfflineIdentityState | null = null
const listeners = new Set<() => void>()

function current(): OfflineIdentityState {
  state ??= {
    lastUserId: read(LAST_USER_KEY),
    pendingSignOut: read(PENDING_SIGN_OUT_KEY),
  }
  return state
}

function update(next: OfflineIdentityState) {
  const previous = current()
  if (
    previous.lastUserId === next.lastUserId &&
    previous.pendingSignOut === next.pendingSignOut
  ) {
    return
  }
  state = next
  write(LAST_USER_KEY, next.lastUserId)
  write(PENDING_SIGN_OUT_KEY, next.pendingSignOut)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // Otra pestaña cerró sesión o entró con otra cuenta.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== LAST_USER_KEY && event.key !== PENDING_SIGN_OUT_KEY) {
      return
    }
    state = null
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function getOfflineIdentity(): OfflineIdentityState {
  return current()
}

/** Clerk confirmó la sesión de este usuario. */
export function rememberUser(userId: string): void {
  update({ ...current(), lastUserId: userId })
}

/**
 * No hay sesión: se olvida al último usuario. Un cierre pendiente se
 * conserva hasta que Clerk lo confirme (clearPendingSignOut).
 */
export function forgetUser(): void {
  update({ ...current(), lastUserId: null })
}

/** El usuario cerró sesión aquí, quizá sin conexión. */
export function markSignedOut(userId: string | null): void {
  update({ lastUserId: null, pendingSignOut: userId })
}

/** Clerk ya cerró la sesión pendiente. */
export function clearPendingSignOut(): void {
  update({ ...current(), pendingSignOut: null })
}

export function useOfflineIdentity(): OfflineIdentityState {
  return useSyncExternalStore(subscribe, current, current)
}

/** Solo para las pruebas: vuelve a leer localStorage. */
export function resetOfflineIdentity(): void {
  state = null
}
