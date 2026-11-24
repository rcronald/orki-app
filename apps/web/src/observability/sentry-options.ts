import type { BrowserOptions } from '@sentry/react'
import { esFalloDeCargaDeChunk } from '../pwa/recarga-por-version.ts'
import { EXTENSION_URLS, isNoise } from './noise.ts'
import { scrubBreadcrumb, scrubEvent } from './privacy.ts'
import type { SentrySettings } from './types.ts'

// Integraciones por defecto que se quitan: CultureContext añade la zona
// horaria y el idioma del dispositivo, y la zona horaria es una ubicación
// aproximada.
const DROPPED_INTEGRATIONS = new Set(['CultureContext'])

interface OptionsDeps {
  /** Si el navegador dice estar conectado; en la app, navigator.onLine. */
  isOnline: () => boolean
  /**
   * Si la página ya se recarga por una versión nueva (#278); en la app,
   * recargaEnCurso de pwa/recarga-por-version.ts.
   */
  isReloadingForUpdate?: () => boolean
  /**
   * Se resuelve con true si la página empieza a irse poco después (#308); en
   * la app, esperarSalida de pwa/recarga-por-version.ts. Sin ella, un chunk
   * que no llegó se envía enseguida.
   */
  waitForPageLeave?: () => Promise<boolean>
  /** Solo para pruebas: transporte que no sale a la red. */
  transport?: BrowserOptions['transport']
}

/**
 * Opciones de Sentry.init. Solo errores: no se añaden
 * browserTracingIntegration ni replayIntegration y no se define
 * tracesSampleRate, así que no hay trazas de rendimiento ni grabación de
 * sesión.
 *
 * dataCollection recorta en origen lo que el SDK recoge por defecto: sin datos
 * del usuario (y sin IP: el SDK pide a Sentry que no la deduzca de la
 * conexión, infer_ip "never"), sin cookies, sin cuerpos de peticiones, sin
 * parámetros de URL, sin cabeceras salvo User-Agent y sin variables locales.
 * Encima, beforeSend y beforeBreadcrumb pasan por privacy.ts y descartan el
 * ruido de noise.ts.
 *
 * Un chunk que no llegó se envía solo si la página no empieza a irse poco
 * después (waitForPageLeave): al volver atrás en el historial, Safari
 * cancela los import() en curso antes de avisar con beforeunload (#308), y
 * ese rechazo no es un fallo de la app. Si la página se queda, se envía.
 */
export function buildSentryOptions(
  settings: SentrySettings,
  {
    isOnline,
    isReloadingForUpdate = () => false,
    waitForPageLeave,
    transport,
  }: OptionsDeps,
): BrowserOptions {
  return {
    dsn: settings.dsn,
    environment: settings.environment,
    ...(settings.release !== undefined && { release: settings.release }),
    ...(transport !== undefined && { transport }),
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ['User-Agent'] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    },
    // Sin esto, el SDK cambia el mensaje real de los TypeError de fetch
    // ("Failed to fetch (host)"); así solo lo cambia en lo que envía.
    enhanceFetchErrorMessages: 'report-only',
    integrations: (defaults) =>
      defaults.filter(
        (integration) => !DROPPED_INTEGRATIONS.has(integration.name),
      ),
    denyUrls: EXTENSION_URLS,
    beforeSend: (event, hint) => {
      const error = hint.originalException
      if (isNoise(event, error, isOnline(), isReloadingForUpdate())) return null
      if (waitForPageLeave === undefined || !esFalloDeCargaDeChunk(error)) {
        return scrubEvent(event)
      }
      return waitForPageLeave().then((leaving) =>
        leaving || isReloadingForUpdate() ? null : scrubEvent(event),
      )
    },
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  }
}
