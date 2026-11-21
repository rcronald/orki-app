import { useAuth } from '@clerk/react'
import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import { PATHS } from '../routes/paths.ts'

interface SignedOutOnlyProps {
  /** Ruta interna ya validada a la que ir si hay sesión; por defecto, el inicio. */
  destination: string | undefined
  children: ReactNode
}

/**
 * Para las pantallas de inicio de sesión y de registro: quien ya tiene sesión
 * no las ve, va a su destino.
 *
 * Hace falta porque los componentes de Clerk no pintan nada con una sesión
 * activa, y la vuelta tras entrar no siempre la completa Clerk: al terminar el
 * acceso navega al destino antes de que React sepa que hay sesión, la ruta
 * protegida todavía ve "sin sesión" y devuelve a esta pantalla, que se quedaba
 * en blanco. Con esto, en cuanto la sesión llega a React se va al destino.
 */
export function SignedOutOnly({ destination, children }: SignedOutOnlyProps) {
  const { isLoaded, isSignedIn } = useAuth()
  if (isLoaded && isSignedIn) {
    return <Navigate to={destination ?? PATHS.home} replace />
  }
  return children
}
