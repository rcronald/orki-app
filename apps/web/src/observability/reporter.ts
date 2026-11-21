import type {
  ErrorDetails,
  SentryHandle,
  SentryModule,
  SentrySettings,
} from './types.ts'

// Cargador mínimo de Sentry: es lo único de la observabilidad que va en el
// JavaScript inicial. El SDK (sentry.ts) se descarga con un import dinámico
// tras el primer pintado, para no retrasar el arranque.
//
// Mientras tanto, los errores no capturados (error y unhandledrejection de
// window) y los que reporta el límite de errores de React se guardan en un
// búfer pequeño y se envían al cargar el SDK. A partir de ahí, el SDK escucha
// los errores globales por su cuenta y el cargador deja de hacerlo.
//
// Sin VITE_SENTRY_DSN en el build no hay import dinámico (ver loadSentry más
// abajo): el chunk de Sentry ni se genera, y no se escucha ni se descarga
// nada.

/** Errores que se guardan, como mucho, antes de cargar el SDK. */
export const PENDING_LIMIT = 10

interface PendingError {
  error: unknown
  details?: ErrorDetails
}

export interface ReporterDeps {
  /** Descarga el chunk del SDK; null si el build no lleva Sentry. */
  loadSdk: (() => Promise<SentryModule>) | null
  /** Programa la carga; en la app, tras el primer pintado. */
  schedule: (task: () => void) => void
  /** Donde se escuchan los errores globales; en la app, window. */
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>
}

export interface ErrorReporter {
  /** Empieza a guardar errores y programa la carga del SDK. */
  start(settings: SentrySettings): void
  /** Reporta un error ya capturado (por ejemplo, por el límite de errores). */
  report(error: unknown, details?: ErrorDetails): void
  /** Id de Clerk del usuario con sesión, o null. */
  setUserId(userId: string | null): void
}

export function createErrorReporter({
  loadSdk,
  schedule,
  target,
}: ReporterDeps): ErrorReporter {
  let state: 'idle' | 'loading' | 'ready' | 'off' = 'idle'
  let pending: PendingError[] = []
  let handle: SentryHandle | null = null
  let userId: string | null = null

  const keep = (error: unknown, details?: ErrorDetails) => {
    if (pending.length < PENDING_LIMIT) pending.push({ error, details })
  }
  const onError = (event: ErrorEvent) => {
    keep(event.error ?? event.message)
  }
  const onRejection = (event: PromiseRejectionEvent) => {
    keep(event.reason)
  }
  const stopListening = () => {
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onRejection)
  }

  return {
    start(settings) {
      if (state !== 'idle' || loadSdk === null) return
      state = 'loading'
      target.addEventListener('error', onError)
      target.addEventListener('unhandledrejection', onRejection)
      schedule(() => {
        loadSdk()
          .then((sdk) => {
            stopListening()
            handle = sdk.startSentry(settings, userId)
            state = 'ready'
            for (const { error, details } of pending) {
              handle.captureException(error, details)
            }
            pending = []
          })
          .catch(() => {
            // Sin el chunk (por ejemplo, sin conexión y sin service worker)
            // la app sigue igual, solo que sin reportar errores.
            stopListening()
            state = 'off'
            pending = []
          })
      })
    },
    report(error, details) {
      if (state === 'ready' && handle !== null) {
        handle.captureException(error, details)
      } else if (state === 'loading') {
        keep(error, details)
      }
    },
    setUserId(id) {
      userId = id
      handle?.setUserId(id)
    },
  }
}

/** Ejecuta la tarea después del primer pintado y, si se puede, en reposo. */
export function afterFirstPaint(task: () => void): void {
  requestAnimationFrame(() => {
    setTimeout(() => {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(task, { timeout: 3000 })
      } else {
        task()
      }
    }, 0)
  })
}

/**
 * Commit desplegado, que vite.config.ts escribe en una etiqueta meta del HTML.
 * Va en el HTML (que se revalida en cada visita) y no en el JavaScript para
 * que los chunks no cambien de nombre en cada despliegue.
 */
export function readRelease(doc: Pick<Document, 'querySelector'>) {
  const content = doc
    .querySelector('meta[name="orki-release"]')
    ?.getAttribute('content')
  return content === null || content === undefined || content === ''
    ? undefined
    : content
}

// La comparación es estática: Vite escribe el valor de VITE_SENTRY_DSN al
// compilar y, si no hay DSN, elimina el import dinámico y el chunk de Sentry
// no llega a existir (la misma técnica que la página de muestra en
// routes/AppRouter.tsx).
const loadSentry = import.meta.env.VITE_SENTRY_DSN
  ? () => import('./sentry.ts')
  : null

/** El cargador de la app. */
export const errorReporter = createErrorReporter({
  loadSdk: loadSentry,
  schedule: afterFirstPaint,
  target: window,
})
