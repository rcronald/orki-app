import { useAuth } from '@clerk/react'
import { useEffect } from 'react'
import { errorReporter, type ErrorReporter } from '../observability/reporter.ts'

interface ObservedUserProps {
  /** Solo para pruebas: a quién se pasa el id. */
  reporter?: Pick<ErrorReporter, 'setUserId'>
}

/**
 * Pasa a Sentry el id de Clerk del usuario con sesión (o ninguno al salir).
 * Es lo único del usuario que se envía: ni correo ni nombre. No pinta nada; va
 * dentro de <ClerkProvider>. Sin DSN, el cargador lo ignora.
 */
export function ObservedUser({ reporter = errorReporter }: ObservedUserProps) {
  const { isLoaded, userId } = useAuth()

  useEffect(() => {
    if (!isLoaded) return
    reporter.setUserId(userId ?? null)
  }, [isLoaded, userId, reporter])

  return null
}
