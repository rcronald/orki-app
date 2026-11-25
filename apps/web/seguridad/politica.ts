// Política de seguridad de contenido (CSP) de orqui.app (#282).
//
// Un solo generador para todos los que la necesitan, para que no haya copias:
// - apps/web/middleware.ts la pone en las respuestas de Vercel, con las
//   variables del despliegue;
// - scripts/cabeceras/ comprueba que cubre lo que el build usa de verdad;
// - scripts/servir-e2e.mjs la sirve como obligatoria en las pruebas de
//   extremo a extremo, con las variables ficticias de scripts/medicion/
//   entorno.mjs.
//
// Los dominios salen de las mismas variables VITE_* con las que se construye
// la app (cada ambiente tiene su instancia de Clerk y su proyecto de Supabase):
// aquí no se escribe ninguno que dependa del ambiente. Los fijos son de
// terceros que no cambian de un ambiente a otro (Cloudflare Turnstile, las
// imágenes de Clerk).
//
// Sin dependencias y solo con lo que tienen Node y el runtime de Vercel
// (URL, atob): lo importan el middleware, los scripts de Node y Playwright.
// El porqué de cada directiva, en docs/operacion/cabeceras-de-seguridad.md.

/**
 * Modo de la CSP en Vercel. 'informe' la envía como
 * Content-Security-Policy-Report-Only: el navegador no bloquea nada, solo
 * avisa en la consola y envía el informe a Sentry. Para hacerla obligatoria
 * basta con cambiar esta línea a 'obligatoria' (ver la documentación).
 */
export const MODO_CSP: ModoCsp = 'informe'

export type ModoCsp = 'informe' | 'obligatoria'

/** Variables del entorno que usa la política (los nombres de la app). */
export interface EntornoDeLaPolitica {
  VITE_SUPABASE_URL?: string | undefined
  VITE_CLERK_PUBLISHABLE_KEY?: string | undefined
  VITE_SENTRY_DSN?: string | undefined
  VITE_APP_ENV?: string | undefined
  /** De Vercel: production, preview o development. */
  VERCEL_ENV?: string | undefined
  /** De Vercel: el commit desplegado, para la versión de los informes. */
  VERCEL_GIT_COMMIT_SHA?: string | undefined
}

export interface OpcionesDeLaPolitica {
  /**
   * Hashes ('sha256-…') de los scripts en línea de index.html
   * (seguridad/scripts-en-linea.ts).
   */
  scriptsEnLinea: readonly string[]
}

export type Directivas = Record<string, string[]>

/** Grupo de Reporting-Endpoints al que apunta report-to. */
export const GRUPO_DE_INFORMES = 'csp'

// Cloudflare Turnstile: el CAPTCHA de Clerk en el registro (script e iframe).
const TURNSTILE = 'https://challenges.cloudflare.com'
// Protección contra abuso y fraude de Clerk (script, iframe y peticiones; las
// peticiones van a puertos distintos del 443, de ahí el `:*`).
const PROTECCION_CLERK = 'https://*.protect.clerk.com'
// Fotos de perfil de las cuentas (también las de Google), que Clerk sirve
// desde su propio dominio.
const IMAGENES_CLERK = 'https://img.clerk.com'
// Telemetría del SDK de Clerk: solo la envían las instancias de desarrollo.
const TELEMETRIA_CLERK = 'https://clerk-telemetry.com'
// Barra de herramientas de Vercel (comentarios en las vistas previas), según
// https://vercel.com/docs/vercel-toolbar/managing-toolbar#using-a-content-security-policy
const BARRA_VERCEL = 'https://vercel.live'

/** Origen https de una URL, o un error que nombra la variable. */
function origenHttps(valor: string | undefined, variable: string): string {
  let url: URL
  try {
    url = new URL(valor ?? '')
  } catch {
    throw new Error(`${variable} no es una URL válida`)
  }
  if (url.protocol !== 'https:') {
    throw new Error(`${variable} tiene que ser una URL https`)
  }
  return url.origin
}

/**
 * Dominio de Frontend API de Clerk, el de la clave publicable: pk_test_ o
 * pk_live_ seguido del dominio con un `$` final en base64 (igual que lo
 * decodifica @clerk/shared para cargar su script).
 */
export function dominioDeClerk(clave: string | undefined): string {
  const partes = /^pk_(test|live)_([A-Za-z0-9+/=_-]+)$/.exec(clave ?? '')
  if (partes === null) {
    throw new Error('VITE_CLERK_PUBLISHABLE_KEY no es una clave publicable')
  }
  let texto: string
  try {
    texto = atob(partes[2] ?? '')
  } catch {
    throw new Error('VITE_CLERK_PUBLISHABLE_KEY no se puede decodificar')
  }
  const dominio = texto.endsWith('$') ? texto.slice(0, -1) : ''
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(dominio)) {
    throw new Error('VITE_CLERK_PUBLISHABLE_KEY no contiene un dominio válido')
  }
  return dominio
}

interface DestinoDeSentry {
  origen: string
  informes: string
}

/**
 * Origen de la ingesta de Sentry y dirección donde recibe los informes de CSP
 * (https://docs.sentry.io/platforms/javascript/security-policy-reporting/),
 * a partir del DSN. La clave del DSN es la pública: ya va en el JavaScript.
 */
export function destinoDeSentry(
  dsn: string,
  entorno: EntornoDeLaPolitica,
): DestinoDeSentry {
  const partes = /^https:\/\/([^@/:]+)@([^/]+)\/(\d+)$/.exec(dsn)
  if (partes === null) throw new Error('VITE_SENTRY_DSN no es un DSN válido')
  const [, clave, servidor, proyecto] = partes
  const origen = origenHttps(`https://${servidor ?? ''}`, 'VITE_SENTRY_DSN')
  const consulta = new URLSearchParams({ sentry_key: clave ?? '' })
  if (entorno.VITE_APP_ENV === 'dev' || entorno.VITE_APP_ENV === 'prod') {
    consulta.set('sentry_environment', entorno.VITE_APP_ENV)
  }
  const version = entorno.VERCEL_GIT_COMMIT_SHA ?? ''
  if (/^[0-9a-f]{7,40}$/i.test(version)) {
    consulta.set('sentry_release', version)
  }
  return {
    origen,
    informes: `${origen}/api/${proyecto ?? ''}/security/?${consulta.toString()}`,
  }
}

/** Directivas de la política para un entorno. */
export function directivasDeLaPolitica(
  entorno: EntornoDeLaPolitica,
  { scriptsEnLinea }: OpcionesDeLaPolitica,
): Directivas {
  const supabase = origenHttps(entorno.VITE_SUPABASE_URL, 'VITE_SUPABASE_URL')
  const clave = entorno.VITE_CLERK_PUBLISHABLE_KEY
  const clerk = `https://${dominioDeClerk(clave)}`
  const sentry =
    entorno.VITE_SENTRY_DSN !== undefined && entorno.VITE_SENTRY_DSN !== ''
      ? destinoDeSentry(entorno.VITE_SENTRY_DSN, entorno)
      : null
  const desarrollo = clave?.startsWith('pk_test_') === true
  const barraVercel = entorno.VERCEL_ENV === 'preview'

  for (const hash of scriptsEnLinea) {
    if (!/^sha256-[A-Za-z0-9+/]{43}=$/.test(hash)) {
      throw new Error(`Hash de script en línea no válido: ${hash}`)
    }
  }

  const directivas: Directivas = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      ...scriptsEnLinea.map((hash) => `'${hash}'`),
      clerk,
      TURNSTILE,
      PROTECCION_CLERK,
      ...(barraVercel ? [BARRA_VERCEL] : []),
    ],
    // Clerk inyecta los estilos de sus componentes en <style> al pintarlos.
    'style-src': [
      "'self'",
      "'unsafe-inline'",
      ...(barraVercel ? [BARRA_VERCEL] : []),
    ],
    'img-src': [
      "'self'",
      'data:',
      'blob:',
      supabase,
      IMAGENES_CLERK,
      ...(barraVercel ? [BARRA_VERCEL, 'https://vercel.com'] : []),
    ],
    'font-src': [
      "'self'",
      ...(barraVercel ? [BARRA_VERCEL, 'https://assets.vercel.com'] : []),
    ],
    'connect-src': [
      "'self'",
      supabase,
      clerk,
      `${PROTECCION_CLERK}:*`,
      ...(sentry !== null ? [sentry.origen] : []),
      ...(desarrollo ? [TELEMETRIA_CLERK] : []),
      ...(barraVercel ? [BARRA_VERCEL, 'wss://ws-us3.pusher.com'] : []),
    ],
    'worker-src': ["'self'", 'blob:'],
    'frame-src': [
      TURNSTILE,
      PROTECCION_CLERK,
      ...(barraVercel ? [BARRA_VERCEL] : []),
    ],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  }
  if (sentry !== null) {
    directivas['report-uri'] = [sentry.informes]
    directivas['report-to'] = [GRUPO_DE_INFORMES]
  }
  return directivas
}

/** La política como texto de la cabecera. */
export function textoDeLaPolitica(directivas: Directivas): string {
  return Object.entries(directivas)
    .map(([nombre, valores]) => [nombre, ...valores].join(' '))
    .join('; ')
}

/** Nombre de la cabecera según el modo. */
export function cabeceraDeLaPolitica(modo: ModoCsp): string {
  return modo === 'obligatoria'
    ? 'Content-Security-Policy'
    : 'Content-Security-Policy-Report-Only'
}

/**
 * Cabeceras que pone el middleware: la CSP en el modo pedido y, si hay
 * Sentry, Reporting-Endpoints con el grupo al que apunta report-to.
 */
export function cabecerasDeLaPolitica(
  entorno: EntornoDeLaPolitica,
  opciones: OpcionesDeLaPolitica & { modo: ModoCsp },
): Record<string, string> {
  const directivas = directivasDeLaPolitica(entorno, opciones)
  const cabeceras: Record<string, string> = {
    [cabeceraDeLaPolitica(opciones.modo)]: textoDeLaPolitica(directivas),
  }
  const informes = directivas['report-uri']?.[0]
  if (informes !== undefined) {
    cabeceras['Reporting-Endpoints'] = `${GRUPO_DE_INFORMES}="${informes}"`
  }
  return cabeceras
}
