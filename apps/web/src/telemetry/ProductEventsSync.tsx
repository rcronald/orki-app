import { useEffect, useRef, useSyncExternalStore } from 'react'
import { identityUserId, useAppIdentity } from '../auth/useAppIdentity.ts'
import {
  isAccountDeletionPending,
  subscribeToAccountDeletionMarker,
} from '../lib/account-deletion-marker.ts'
import { useOnlineStatus } from '../lib/useOnlineStatus.ts'
import { setProductEventsSession } from './product-events.ts'

/**
 * Dice a los eventos de producto (#146) quién usa la app, con las mismas
 * reglas que la colección (CollectionProvider, docs/sin-conexion.md):
 *
 * - signed-in: el usuario de Clerk, con la sesión confirmada: se envía.
 * - unverified: sin Clerk, el último usuario recordado. Sus eventos se
 *   guardan (marcados como generados sin conexión), pero no se envía nada
 *   hasta que Clerk confirme la sesión.
 * - signed-out: nadie, y se borran todas las colas (también al cerrar sesión
 *   sin conexión: el botón de la app lo marca al momento).
 * - loading o unavailable: el usuario de antes, sin enviar mientras tanto.
 * - Con la eliminación de su cuenta en curso (#110,
 *   lib/account-deletion-marker.ts): nadie, como al cerrar sesión. Sus
 *   eventos de la base se borran con el perfil; uno que llegara después
 *   quedaría sin dueño. Si la persona sigue usando Orki (quita la marca), se
 *   vuelve a registrar.
 *
 * No pinta nada. Va dentro de <ClerkProvider>, antes que las pantallas: su
 * efecto corre antes que los de ellas.
 */
export function ProductEventsSync() {
  const identity = useAppIdentity()
  const online = useOnlineStatus()
  const previous = useRef<string | null>(null)
  const shownUserId = identityUserId(identity)
  const deleting = useSyncExternalStore(
    subscribeToAccountDeletionMarker,
    () => shownUserId !== null && isAccountDeletionPending(shownUserId),
    () => false,
  )

  useEffect(() => {
    if (deleting) {
      previous.current = null
      setProductEventsSession(null)
      return
    }
    switch (identity.kind) {
      case 'signed-in':
      case 'unverified':
        previous.current = identity.userId
        setProductEventsSession({
          userId: identity.userId,
          confirmed: identity.kind === 'signed-in',
          online,
        })
        return
      case 'signed-out':
        previous.current = null
        setProductEventsSession(null)
        return
      case 'loading':
      case 'unavailable':
        if (previous.current !== null) {
          setProductEventsSession({
            userId: previous.current,
            confirmed: false,
            online,
          })
        }
        return
    }
  }, [identity, online, deleting])

  return null
}
