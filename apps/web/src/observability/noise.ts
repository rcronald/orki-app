import type { ErrorEvent } from '@sentry/react'
import { esFalloDeCargaDeChunk } from '../pwa/recarga-por-version.ts'

// Ruido conocido que no se envía a Sentry. Funciones puras: la decisión
// depende solo del evento, del error original, de si el navegador dice estar
// conectado y de si la página ya se recarga por una versión nueva.

// Mensajes con los que los navegadores rechazan una petición o la carga de un
// módulo cuando no hay red: Chrome, Firefox y Safari, para fetch y para los
// import() de los chunks. El SDK puede añadir el host entre paréntesis
// ("Failed to fetch (ejemplo.supabase.co)"), por eso se compara el principio.
const NETWORK_FAILURE = [
  /^Failed to fetch/,
  /^NetworkError when attempting to fetch resource/,
  /^Load failed/,
  /^Network request failed/,
  /^Failed to fetch dynamically imported module/,
  /^Importing a module script failed/,
  /^error loading dynamically imported module/,
]

/** Esquemas de las URL de los scripts de las extensiones del navegador. */
export const EXTENSION_URLS = [
  /^chrome-extension:\/\//i,
  /^moz-extension:\/\//i,
  /^safari-extension:\/\//i,
  /^safari-web-extension:\/\//i,
  /^ms-browser-extension:\/\//i,
]

function errorName(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined
}

function errorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : undefined
}

function offlineReason(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'reason' in error &&
    error.reason === 'offline'
  )
}

/**
 * Fallo por estar sin conexión: los errores propios de la app con motivo
 * 'offline' (SessionTokenError, CatalogSearchError, PlantSaveError…), el de
 * Clerk sin conexión y, si el navegador dice que no hay red, los fallos de red
 * genéricos. Con red, un "Failed to fetch" sí se envía: puede ser un fallo real
 * de Supabase o de un despliegue.
 */
export function isOfflineFailure(error: unknown, online: boolean): boolean {
  if (offlineReason(error)) return true
  if (errorName(error) === 'ClerkOfflineError') return true
  if (online) return false
  const message = errorMessage(error)
  return (
    message !== undefined &&
    NETWORK_FAILURE.some((pattern) => pattern.test(message))
  )
}

/** El error se lanzó desde el script de una extensión del navegador. */
export function comesFromBrowserExtension(event: ErrorEvent): boolean {
  return (event.exception?.values ?? []).some((exception) =>
    (exception.stacktrace?.frames ?? []).some((frame) => {
      const url = frame.filename ?? frame.abs_path
      return (
        url !== undefined && EXTENSION_URLS.some((pattern) => pattern.test(url))
      )
    }),
  )
}

/**
 * Un chunk que no llegó mientras la página ya se recarga por una versión
 * nueva (#278, pwa/recarga-por-version.ts): no es un fallo de la app. Si la
 * recarga no se hizo (sin conexión, o ya se recargó hace poco), sí se envía.
 */
export function isUpdateReload(error: unknown, reloading: boolean): boolean {
  return reloading && esFalloDeCargaDeChunk(error)
}

/** El evento es ruido conocido y no se envía. */
export function isNoise(
  event: ErrorEvent,
  originalException: unknown,
  online: boolean,
  reloadingForUpdate = false,
): boolean {
  return (
    isOfflineFailure(originalException, online) ||
    isUpdateReload(originalException, reloadingForUpdate) ||
    comesFromBrowserExtension(event)
  )
}
