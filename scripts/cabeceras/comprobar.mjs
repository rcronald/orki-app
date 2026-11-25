// Comprobación de las cabeceras de seguridad (#282): funciones puras que usa
// scripts/cabeceras/index.mjs (y sus pruebas). Ver
// docs/operacion/cabeceras-de-seguridad.md.

import { createHash } from 'node:crypto'
import { dominioDeClerk } from '../../apps/web/seguridad/politica.ts'

/**
 * Cabeceras que van fijas en vercel.json para todas las rutas, con su valor
 * exacto. El porqué de cada una, en la documentación. Si se cambia un valor a
 * propósito, se cambia aquí y en vercel.json a la vez.
 */
export const CABECERAS_FIRMES = Object.freeze({
  'Strict-Transport-Security': 'max-age=63072000',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy':
    'camera=(self), microphone=(), geolocation=(), payment=(), usb=()',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
})

/** Fuente de vercel.json que tiene que llevar las cabeceras firmes. */
export const TODAS_LAS_RUTAS = '/(.*)'

/**
 * Orígenes que aparecen en el build pero que la app nunca carga: enlaces que
 * se abren al pulsarlos (una navegación, que la CSP no limita), espacios de
 * nombres de XML y textos de ayuda de las bibliotecas. No dependen del
 * ambiente. Un origen nuevo en el build que no esté aquí tiene que estar
 * cubierto por la política; si es solo un enlace, se añade aquí con su motivo.
 */
export const ORIGENES_SOLO_ENLACE = Object.freeze({
  'http://www.w3.org': 'espacios de nombres de SVG y XML',
  'http://ns.adobe.com': 'espacio de nombres XMP de los metadatos de las fotos',
  'http://scripts.sil.org': 'licencia de las fuentes (créditos)',
  'http://localhost': 'comprobaciones de desarrollo de las bibliotecas',
  'https://creativecommons.org': 'enlaces a las licencias de las fotos',
  'https://www.inaturalist.org': 'enlaces a las fotos de referencia',
  'https://www.catalogueoflife.org': 'enlace de los créditos',
  'https://doi.org': 'enlace de los créditos',
  'https://fontsource.org': 'enlace de los créditos',
  'https://lucide.dev': 'enlace de los créditos',
  'https://claude.ai': 'enlace de los créditos',
  'https://orki.invalid':
    'base ficticia para analizar rutas con URL (src/routes/paths.ts)',
  'https://clerk.com': 'textos de error y avisos del SDK de Clerk',
  'https://dashboard.clerk.com': 'textos de error del SDK de Clerk',
  'https://react.dev': 'textos de error de React',
  'https://reactrouter.com': 'textos de error de React Router',
  'https://github.com': 'textos de error de las bibliotecas',
  'https://bit.ly': 'textos de error de las bibliotecas',
  'https://tailwindcss.com': 'comentario de licencia del CSS de Tailwind',
  'https://docs.sentry.io': 'textos de error del SDK de Sentry',
})

/** Directivas que controlan qué se carga o a qué se conecta la página. */
const DIRECTIVAS_DE_CARGA = [
  'connect-src',
  'img-src',
  'script-src',
  'style-src',
  'font-src',
  'frame-src',
  'worker-src',
  'manifest-src',
]

/** Hash de un script en línea, como lo pone la CSP (sin comillas). */
export function hashDeScript(contenido) {
  return `sha256-${createHash('sha256').update(contenido, 'utf8').digest('base64')}`
}

/**
 * Lo que la CSP tiene que permitir del HTML: los scripts en línea (con su
 * hash) y lo que no se puede permitir con un hash (manejadores on* y
 * direcciones javascript:), que se informa como problema.
 */
export function analizarHtml(html) {
  const scripts = []
  const problemas = []
  for (const [, atributos, contenido] of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
  )) {
    if (/\bsrc\s*=/i.test(atributos)) continue
    if (
      /\btype\s*=\s*["']?(application\/(ld\+)?json|importmap)/i.test(atributos)
    )
      continue
    scripts.push(hashDeScript(contenido))
  }
  for (const [manejador] of html.matchAll(/<[^>]*\s(on[a-z]+)\s*=/gi)) {
    problemas.push(
      `Manejador en línea en index.html: ${manejador.slice(0, 60)}`,
    )
  }
  if (/\b(href|src|action)\s*=\s*["']?\s*javascript:/i.test(html)) {
    problemas.push('Dirección javascript: en index.html')
  }
  return { scripts, problemas }
}

/**
 * Orígenes de las URL absolutas que aparecen en el código del build (sin
 * usuario: el DSN de Sentry lleva la clave delante del servidor).
 */
export function origenesEnElCodigo(codigo) {
  const origenes = new Set()
  for (const [, esquema, servidor] of codigo.matchAll(
    /\b(https?|wss?):\/\/(?:[^/@\s"'`<>\\]+@)?([a-z0-9][a-z0-9.-]*[a-z0-9])(?::\d+)?/gi,
  )) {
    origenes.add(`${esquema.toLowerCase()}://${servidor.toLowerCase()}`)
  }
  return origenes
}

/** Si una fuente de la CSP (https://x, https://*.x, https://x:*) cubre el origen. */
export function fuenteCubre(fuente, origen) {
  const partes = /^(https?|wss?):\/\/(\*\.)?([^:/]+)(:\*|:\d+)?$/.exec(fuente)
  if (partes === null) return false
  const [, esquema, comodin, servidor] = partes
  const url = new URL(origen)
  if (url.protocol !== `${esquema}:`) return false
  return comodin === undefined
    ? url.hostname === servidor
    : url.hostname.endsWith(`.${servidor}`)
}

/** Orígenes del build que ninguna directiva de carga de la política cubre. */
export function origenesSinCubrir(origenes, directivas) {
  const fuentes = DIRECTIVAS_DE_CARGA.flatMap(
    (nombre) => directivas[nombre] ?? [],
  )
  return [...origenes]
    .filter((origen) => !(origen in ORIGENES_SOLO_ENLACE))
    .filter((origen) => !fuentes.some((fuente) => fuenteCubre(fuente, origen)))
    .sort()
}

/**
 * Lo que la app hace con cada servicio del entorno, escrito aparte del
 * generador para comprobarlo: la API y Storage de Supabase (peticiones e
 * imágenes públicas de las especies), el script y la API de Clerk y el envío
 * de errores a Sentry. Devuelve los que la política no permite donde hace
 * falta.
 */
export function problemasDelEntorno(entorno, directivas) {
  const necesarios = [
    [entorno.VITE_SUPABASE_URL, ['connect-src', 'img-src'], 'Supabase'],
    [
      `https://${dominioDeClerk(entorno.VITE_CLERK_PUBLISHABLE_KEY)}`,
      ['script-src', 'connect-src'],
      'Clerk',
    ],
  ]
  if (entorno.VITE_SENTRY_DSN) {
    const servidor = new URL(entorno.VITE_SENTRY_DSN).host
    necesarios.push([`https://${servidor}`, ['connect-src'], 'Sentry'])
  }
  const problemas = []
  for (const [url, nombres, servicio] of necesarios) {
    const origen = new URL(url).origin
    for (const nombre of nombres) {
      const fuentes = directivas[nombre] ?? []
      if (!fuentes.some((fuente) => fuenteCubre(fuente, origen))) {
        problemas.push(`${nombre} no permite ${origen} (${servicio})`)
      }
    }
  }
  return problemas
}

/** Scripts en línea del build que no están en la lista de hashes. */
export function scriptsSinCubrir(scripts, permitidos) {
  return scripts.filter((hash) => !permitidos.includes(hash))
}

/**
 * Problemas con las cabeceras firmes de vercel.json: que falte una, que tenga
 * otro valor o que no vaya en la regla de todas las rutas.
 */
export function problemasDeVercelJson(vercel) {
  const regla = (vercel.headers ?? []).find(
    (r) =>
      r.source === TODAS_LAS_RUTAS &&
      r.has === undefined &&
      r.missing === undefined,
  )
  if (regla === undefined) {
    return [
      `vercel.json no tiene una regla de cabeceras para «${TODAS_LAS_RUTAS}»`,
    ]
  }
  const problemas = []
  for (const [nombre, valor] of Object.entries(CABECERAS_FIRMES)) {
    const cabecera = regla.headers.find(
      (h) => h.key.toLowerCase() === nombre.toLowerCase(),
    )
    if (cabecera === undefined) {
      problemas.push(`Falta la cabecera ${nombre} en vercel.json`)
    } else if (cabecera.value !== valor) {
      problemas.push(
        `La cabecera ${nombre} de vercel.json vale «${cabecera.value}» y debería valer «${valor}»`,
      )
    }
  }
  return problemas
}

/** Contenido de apps/web/seguridad/scripts-en-linea.ts para estos hashes. */
export function archivoDeScriptsEnLinea(hashes, cabecera) {
  const lineas = [...new Set(hashes)].sort().map((hash) => `  '${hash}',`)
  return `${cabecera}export const SCRIPTS_EN_LINEA: readonly string[] = [\n${lineas.join('\n')}\n]\n`
}
