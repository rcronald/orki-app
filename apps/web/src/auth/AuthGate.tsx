import type { ReactNode } from 'react'
import { AuthLoading, AuthUnavailable } from './AuthStatus.tsx'
import { useAuthAvailability } from './useAuthAvailability.ts'

// Muestra sus hijos (los componentes de Clerk) solo cuando Clerk está listo.
// Mientras carga, un estado de carga; si no carga, el aviso con la opción de
// volver a intentarlo. Sin esto, los componentes de Clerk no pintan nada hasta
// cargar y la pantalla quedaría en blanco sin conexión.
export function AuthGate({ children }: { children: ReactNode }) {
  const availability = useAuthAvailability()

  if (availability === 'loading') return <AuthLoading />
  if (availability !== 'ready') return <AuthUnavailable reason={availability} />
  return children
}
