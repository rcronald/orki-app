import { createContext, useContext } from 'react'
import { useOnlineStatus } from '../lib/useOnlineStatus.ts'

// Solo lectura (#18, #120). La colección es de solo lectura cuando:
// - offline: el navegador no tiene conexión;
// - unverified: Clerk no está disponible y lo que se ve es la copia del
//   último usuario con sesión en este dispositivo, sin poder confirmarla.
// Entonces registrar, editar, dar de baja y eliminar quedan desactivados con
// el motivo; buscar, filtrar, ver el detalle y exportar siguen funcionando.
//
// CollectionProvider (dentro de Clerk) dice si la sesión está sin confirmar;
// las pantallas lo leen con useReadOnly() sin importar Clerk.

export type ReadOnlyReason = 'offline' | 'unverified'

/** Si la colección que se ve es la de una sesión sin confirmar. */
export const SessionUnverifiedContext = createContext(false)

/** Por qué la colección es de solo lectura; null si se puede escribir. */
export function useReadOnly(): ReadOnlyReason | null {
  const online = useOnlineStatus()
  const unverified = useContext(SessionUnverifiedContext)
  if (!online) return 'offline'
  if (unverified) return 'unverified'
  return null
}
