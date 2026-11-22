import { useAuth, useClerk } from '@clerk/react'
import { useEffect } from 'react'
import { useOnlineStatus } from '../lib/useOnlineStatus.ts'
import { clearPendingSignOut, useOfflineIdentity } from './offline-identity.ts'
import { useAuthAvailability } from './useAuthAvailability.ts'

/**
 * Termina un cierre de sesión hecho sin conexión (#18, #120; ver
 * offline-identity.ts). Cuando Clerk vuelve a estar disponible:
 * - si sigue con la sesión de quien la cerró, se la pide cerrar;
 * - si ya no hay sesión, o es la de otra cuenta, el cierre pendiente ya no
 *   hace falta.
 * No pinta nada. Va dentro de <ClerkProvider>.
 */
export function PendingSignOut() {
  const clerk = useClerk()
  const availability = useAuthAvailability()
  const { isLoaded, isSignedIn, userId } = useAuth()
  const { pendingSignOut } = useOfflineIdentity()
  const online = useOnlineStatus()

  useEffect(() => {
    if (pendingSignOut === null || availability !== 'ready' || !isLoaded) {
      return
    }
    if (!isSignedIn || userId !== pendingSignOut) {
      clearPendingSignOut()
      return
    }
    if (!online) return
    clerk.signOut().catch(() => {
      // Se vuelve a intentar con el próximo cambio (al recuperar la red).
    })
  }, [
    clerk,
    availability,
    isLoaded,
    isSignedIn,
    userId,
    pendingSignOut,
    online,
  ])

  return null
}
