import { useEffect, useRef } from 'react'
import { useAppIdentity } from '../auth/useAppIdentity.ts'
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
 *
 * No pinta nada. Va dentro de <ClerkProvider>, antes que las pantallas: su
 * efecto corre antes que los de ellas.
 */
export function ProductEventsSync() {
  const identity = useAppIdentity()
  const online = useOnlineStatus()
  const previous = useRef<string | null>(null)

  useEffect(() => {
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
  }, [identity, online])

  return null
}
