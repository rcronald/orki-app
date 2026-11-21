import { captureException, init, setUser } from '@sentry/react'
import { buildSentryOptions } from './sentry-options.ts'
import type { SentryModule } from './types.ts'

// Chunk diferido con el SDK de Sentry. Solo lo importa el cargador
// (reporter.ts), tras el primer pintado y si hay DSN; nada del arranque lo
// importa de forma estática.

declare global {
  interface Window {
    /** Provoca un error de prueba (ver el README, Errores en Sentry). */
    orkiErrorDePrueba?: () => void
  }
}

/** Error que lanza window.orkiErrorDePrueba(). */
export class SentryTestError extends Error {
  constructor() {
    super('Error de prueba de Sentry (orkiErrorDePrueba)')
    this.name = 'SentryTestError'
  }
}

/**
 * Lanza un error de prueba desde el código de la app, fuera de cualquier
 * try/catch, para comprobar que llega a Sentry con la traza legible. Se lanza
 * en un setTimeout porque los errores escritos directamente en la consola del
 * navegador no pasan por los manejadores globales.
 */
export function throwTestError(): void {
  setTimeout(() => {
    throw new SentryTestError()
  }, 0)
}

export const startSentry: SentryModule['startSentry'] = (settings, userId) => {
  init(
    buildSentryOptions(settings, {
      isOnline: () => navigator.onLine !== false,
    }),
  )
  // Del usuario solo se envía el id de Clerk, que no dice quién es.
  if (userId !== null) setUser({ id: userId })
  window.orkiErrorDePrueba = throwTestError

  return {
    captureException(error, details) {
      captureException(
        error,
        details?.componentStack !== undefined
          ? { contexts: { react: { componentStack: details.componentStack } } }
          : undefined,
      )
    },
    setUserId(id) {
      setUser(id === null ? null : { id })
    },
  }
}
