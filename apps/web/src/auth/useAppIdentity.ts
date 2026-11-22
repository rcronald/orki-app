import { useAuth } from '@clerk/react'
import { useOnlineStatus } from '../lib/useOnlineStatus.ts'
import { useOfflineIdentity } from './offline-identity.ts'
import { useAuthAvailability } from './useAuthAvailability.ts'

/**
 * Quién usa la app, según Clerk y, sin Clerk, según lo que recuerda el
 * dispositivo (#18, #120; ver offline-identity.ts y docs/sin-conexion.md):
 *
 * - loading: Clerk todavía no ha dicho nada (o recarga la sesión un momento).
 * - signed-in: Clerk confirma la sesión de userId.
 * - signed-out: no hay sesión (Clerk lo dice, o el usuario la cerró aquí y
 *   Clerk aún no lo sabe).
 * - unverified: Clerk no está disponible (sin conexión o no cargó) y este
 *   dispositivo recuerda a userId como el último con sesión: se muestra su
 *   copia local en solo lectura. También si Clerk dice que no hay sesión
 *   mientras el navegador está sin conexión: sin red no se puede confirmar, y
 *   borrar la copia por eso dejaría al usuario sin su inventario en el campo.
 * - unavailable: Clerk no está disponible y no se recuerda a nadie.
 */
export type AppIdentity =
  | { kind: 'loading' }
  | { kind: 'signed-in'; userId: string }
  | { kind: 'signed-out' }
  | { kind: 'unverified'; userId: string; reason: 'offline' | 'failed' }
  | { kind: 'unavailable'; reason: 'offline' | 'failed' }

export function useAppIdentity(): AppIdentity {
  const availability = useAuthAvailability()
  const { isLoaded, isSignedIn, userId } = useAuth()
  const online = useOnlineStatus()
  const { lastUserId, pendingSignOut } = useOfflineIdentity()

  if (availability === 'ready') {
    if (!isLoaded) return { kind: 'loading' }
    if (isSignedIn && userId) {
      return pendingSignOut === userId
        ? { kind: 'signed-out' }
        : { kind: 'signed-in', userId }
    }
    if (!online && lastUserId !== null) {
      return { kind: 'unverified', userId: lastUserId, reason: 'offline' }
    }
    return { kind: 'signed-out' }
  }
  if (availability === 'loading') return { kind: 'loading' }
  if (lastUserId !== null) {
    return { kind: 'unverified', userId: lastUserId, reason: availability }
  }
  if (pendingSignOut !== null) return { kind: 'signed-out' }
  return { kind: 'unavailable', reason: availability }
}

/** El id del usuario cuya colección se muestra; null si ninguno. */
export function identityUserId(identity: AppIdentity): string | null {
  return identity.kind === 'signed-in' || identity.kind === 'unverified'
    ? identity.userId
    : null
}
