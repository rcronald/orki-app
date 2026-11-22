// Todas las rutas de la app, en un solo sitio. Van en español y sin acentos.
// "Registro" a secas es el de la cuenta (lo usa Clerk como signUpUrl); el de
// una planta cuelga de la colección (/coleccion/nueva) para no confundirlos.
//
// Vercel (rewrites de vercel.json) y el service worker (navigateFallback)
// responden cualquier ruta con index.html, así que abrir o recargar cualquiera
// de estas funciona; ver el README.
export const PATHS = {
  home: '/',
  catalog: '/catalogo',
  collection: '/coleccion',
  newPlant: '/coleccion/nueva',
  /** Detalle de un ejemplar (#16); construir con plantDetailPath(). */
  plantDetail: '/coleccion/:plantId',
  /** Edición de un ejemplar (#16); construir con plantEditPath(). */
  editPlant: '/coleccion/:plantId/editar',
  catalogAdmin: '/administracion/catalogo',
  /** Datos de la sesión y eliminación de la cuenta (#110). */
  account: '/cuenta',
  /** Página pública de privacidad (#111). */
  privacy: '/privacidad',
  /** Página pública de créditos y fuentes (#203). */
  credits: '/creditos',
  signIn: '/iniciar-sesion',
  signUp: '/registro',
  /** Página interna del design system; solo existe fuera de producción. */
  showcase: '/muestra',
  /** Diagnóstico de la identidad (Clerk y Postgres); solo fuera de producción. */
  identityDiagnostics: '/diagnostico',
} as const

/** Dirección del detalle de una planta: /coleccion/<id>. */
export function plantDetailPath(plantId: string): string {
  return `${PATHS.collection}/${encodeURIComponent(plantId)}`
}

/** Dirección de la edición de una planta: /coleccion/<id>/editar. */
export function plantEditPath(plantId: string): string {
  return `${plantDetailPath(plantId)}/editar`
}

/** Parámetro con el que Clerk recibe la página a la que volver tras entrar. */
export const REDIRECT_PARAM = 'redirect_url'

// Origen ficticio para interpretar rutas relativas sin depender del navegador.
const PLACEHOLDER_ORIGIN = 'https://orki.invalid'

/**
 * Convierte un destino de vuelta en una ruta interna segura (ruta, búsqueda y
 * hash), o null si no lo es. Evita la redirección abierta: solo vale una ruta
 * que empiece por una sola barra (no "//otro.sitio" ni "/\otro.sitio") o una
 * URL absoluta del mismo origen que la app. Tampoco vale volver a las
 * pantallas de acceso, que dejarían a la persona en un bucle.
 */
export function safeRedirectPath(
  value: string | null | undefined,
  currentOrigin: string = window.location.origin,
): string | null {
  if (!value) return null
  // Caracteres de control o espacios: el navegador los limpia y una ruta
  // aparentemente interna podría acabar apuntando fuera.
  // eslint-disable-next-line no-control-regex -- se buscan a propósito
  if (/[\u0000-\u001f\u007f\s\\]/.test(value)) return null

  let url: URL
  if (value.startsWith('/')) {
    if (value.startsWith('//')) return null
    url = new URL(value, PLACEHOLDER_ORIGIN)
    if (url.origin !== PLACEHOLDER_ORIGIN) return null
  } else {
    try {
      url = new URL(value)
    } catch {
      return null
    }
    if (url.origin !== currentOrigin) return null
  }

  if (isAuthPath(url.pathname)) return null
  return `${url.pathname}${url.search}${url.hash}`
}

function isAuthPath(pathname: string): boolean {
  return [PATHS.signIn, PATHS.signUp].some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  )
}

/** Dirección del inicio de sesión que, al entrar, vuelve a `destination`. */
export function signInPathFor(destination: string): string {
  const safe = safeRedirectPath(destination, PLACEHOLDER_ORIGIN)
  if (!safe || safe === PATHS.home) return PATHS.signIn
  return `${PATHS.signIn}?${new URLSearchParams({ [REDIRECT_PARAM]: safe }).toString()}`
}

/**
 * Para la navegación de Clerk (routerPush/routerReplace): la ruta interna de
 * `to` si es del mismo origen, o null si es otro sitio (por ejemplo el de
 * Google o el portal de cuentas de Clerk), que se abre con una carga normal.
 */
export function internalPathOf(
  to: string,
  currentOrigin: string = window.location.origin,
): string | null {
  let url: URL
  try {
    url = new URL(to, currentOrigin)
  } catch {
    return null
  }
  if (url.origin !== currentOrigin) return null
  return `${url.pathname}${url.search}${url.hash}`
}
