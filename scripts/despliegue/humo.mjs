// Prueba de humo sin sesión de producción, después de disparar el despliegue (#281):
//
// 1. Espera a que la portada sirva la versión del commit desplegado: el build escribe el
//    commit en <meta name="orki-release"> (apps/web/vite.config.ts). Si la etiqueta no
//    aparece (Vercel sin las variables de sistema expuestas), avisa y comprueba lo que se sirve.
// 2. Comprueba que la página carga: la portada responde 200 con HTML y su script principal
//    (/assets/...) responde 200.
// 3. Comprueba que el catálogo público responde con la clave publicable: llama a
//    search_public_species como un visitante sin sesión y espera una lista.
//
// No usa secretos: la clave publicable no lo es (va en el JavaScript de la app), pero se toma
// de una variable del environment para no escribirla en el repositorio. Si falta la URL de
// la app o la clave, no comprueba nada y lo dice (la prueba es opcional).
//
// Uso (en el workflow): node scripts/despliegue/humo.mjs
//   Variables: APP_URL, SUPABASE_PROJECT_REF, SUPABASE_PUBLISHABLE_KEY, COMMIT y
//   GITHUB_STEP_SUMMARY. Opcionales: HUMO_ESPERA_MAXIMA_S (900) y HUMO_INTERVALO_S (15).

import { pathToFileURL } from 'node:url'
import { escritorDeResumen } from './disparar.mjs'

const REF = /^[a-z0-9]{20}$/
const COMMIT = /^[0-9a-f]{40}$/

/** Lee la versión de <meta name="orki-release" content="...">, o null si no está. */
export function leerVersion(html) {
  for (const etiqueta of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/\bname\s*=\s*["']?orki-release["']?/i.test(etiqueta)) continue
    const contenido = etiqueta.match(/\bcontent\s*=\s*["']?([0-9a-f]{7,40})/i)
    return contenido ? contenido[1].toLowerCase() : null
  }
  return null
}

/** Ruta del script principal de la página (<script type="module" src="/assets/...">). */
export function leerScriptPrincipal(html) {
  for (const etiqueta of html.match(/<script\b[^>]*>/gi) ?? []) {
    if (!/\btype\s*=\s*["']?module/i.test(etiqueta)) continue
    const src = etiqueta.match(/\bsrc\s*=\s*["']?(\/assets\/[^"'\s>]+)/i)
    if (src) return src[1]
  }
  return null
}

/**
 * @param {Record<string, string | undefined>} e
 * @returns {{ ok: true, appUrl: URL, supabaseUrl: string, clave: string, commit: string } | { ok: false, omitir: boolean, mensaje: string }}
 */
export function leerConfiguracion(e) {
  const app = e.APP_URL?.trim() ?? ''
  const clave = e.SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''
  if (!app || !clave) {
    const faltan = [
      !app && 'APP_URL',
      !clave && 'SUPABASE_PUBLISHABLE_KEY',
    ].filter(Boolean)
    return {
      ok: false,
      omitir: true,
      mensaje: `Prueba de humo omitida: falta${faltan.length > 1 ? 'n' : ''} la${faltan.length > 1 ? 's' : ''} variable${faltan.length > 1 ? 's' : ''} ${faltan.join(' y ')} del environment prod.`,
    }
  }
  let appUrl
  try {
    appUrl = new URL(app)
  } catch {
    return {
      ok: false,
      omitir: false,
      mensaje: 'APP_URL no es una URL válida.',
    }
  }
  if (appUrl.protocol !== 'https:') {
    return { ok: false, omitir: false, mensaje: 'APP_URL tiene que ser https.' }
  }
  const ref = e.SUPABASE_PROJECT_REF?.trim() ?? ''
  if (!REF.test(ref)) {
    return {
      ok: false,
      omitir: false,
      mensaje: 'SUPABASE_PROJECT_REF no es un identificador de proyecto.',
    }
  }
  const commit = e.COMMIT?.trim().toLowerCase() ?? ''
  if (!COMMIT.test(commit)) {
    return {
      ok: false,
      omitir: false,
      mensaje: 'COMMIT no es un SHA completo.',
    }
  }
  return {
    ok: true,
    appUrl,
    supabaseUrl: `https://${ref}.supabase.co`,
    clave,
    commit,
  }
}

/**
 * Pide la portada hasta que sirve el commit esperado o se acaba el plazo.
 *
 * @returns {Promise<{ ok: boolean, version: string | null, html: string, intentos: number, mensaje?: string }>}
 */
export async function esperarVersion(config, opciones) {
  const { pedir, esperar, ahora, esperaMaximaMs, intervaloMs } = opciones
  const limite = ahora() + esperaMaximaMs
  let intentos = 0
  let version = null
  let html = ''
  for (;;) {
    intentos++
    const url = new URL('/', config.appUrl)
    // Un parámetro distinto en cada petición, para no recibir una copia de una caché.
    url.searchParams.set('humo', `${config.commit.slice(0, 7)}-${intentos}`)
    try {
      const r = await pedir(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      })
      if (r.ok) {
        html = await r.text()
        version = leerVersion(html)
        if (version === null) {
          return {
            ok: true,
            version,
            html,
            intentos,
            mensaje:
              'La portada no lleva <meta name="orki-release">: no se puede saber qué versión sirve (¿falta «Automatically expose System Environment Variables» en Vercel?). Se comprueba lo que hay publicado.',
          }
        }
        if (
          config.commit.startsWith(version) ||
          version.startsWith(config.commit)
        ) {
          return { ok: true, version, html, intentos }
        }
      }
    } catch {
      // Sin respuesta todavía: se vuelve a intentar.
    }
    if (ahora() + intervaloMs > limite) {
      return {
        ok: false,
        version,
        html,
        intentos,
        mensaje: `Producción no sirvió el commit ${config.commit.slice(0, 7)} en ${Math.round(esperaMaximaMs / 60_000)} minutos (sirve ${version ? version.slice(0, 7) : 'una versión desconocida'}). Mira el despliegue en el panel de Vercel (Deployments).`,
      }
    }
    await esperar(intervaloMs)
  }
}

/** @returns {Promise<string[]>} errores (vacío si todo responde) */
export async function comprobarPublicado(config, html, pedir) {
  const errores = []
  const script = leerScriptPrincipal(html)
  if (!script) {
    errores.push('La portada no tiene el script principal (/assets/...).')
  } else {
    try {
      const r = await pedir(new URL(script, config.appUrl), {
        signal: AbortSignal.timeout(20_000),
      })
      if (!r.ok)
        errores.push(`El script principal ${script} respondió ${r.status}.`)
    } catch (error) {
      errores.push(
        `El script principal no respondió (${error instanceof Error ? error.name : 'Error'}).`,
      )
    }
  }
  try {
    const r = await pedir(
      `${config.supabaseUrl}/rest/v1/rpc/search_public_species`,
      {
        method: 'POST',
        // Las mismas cabeceras que el cliente de la app sin sesión
        // (apps/web/src/lib/supabase-client.ts): la clave en `apikey` y en `Authorization`.
        headers: {
          apikey: config.clave,
          Authorization: `Bearer ${config.clave}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ query: 'Phalaenopsis', max_results: 1 }),
        signal: AbortSignal.timeout(20_000),
      },
    )
    if (!r.ok) {
      errores.push(
        `search_public_species respondió ${r.status} con la clave publicable.`,
      )
    } else {
      const cuerpo = await r.json().catch(() => null)
      if (!Array.isArray(cuerpo))
        errores.push('search_public_species no devolvió una lista.')
    }
  } catch (error) {
    errores.push(
      `search_public_species no respondió (${error instanceof Error ? error.name : 'Error'}).`,
    )
  }
  return errores
}

/** @param {Record<string, string | undefined>} entorno */
export async function principal(entorno, opciones = {}) {
  const escribir = opciones.escribir ?? escritorDeResumen(entorno)
  const registro = opciones.registro ?? ((l) => console.log(l))
  const pedir = opciones.fetch ?? fetch
  const esperar =
    opciones.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  const ahora = opciones.ahora ?? Date.now
  const titulo = '## Prueba de humo sin sesión\n\n'

  const config = leerConfiguracion(entorno)
  if (!config.ok) {
    registro(`${config.omitir ? '::notice::' : '::error::'}${config.mensaje}`)
    escribir(`${titulo}${config.mensaje}\n\n`)
    return config.omitir ? 0 : 1
  }

  const espera = await esperarVersion(config, {
    pedir,
    esperar,
    ahora,
    esperaMaximaMs: Number(entorno.HUMO_ESPERA_MAXIMA_S || 900) * 1000,
    intervaloMs: Number(entorno.HUMO_INTERVALO_S || 15) * 1000,
  })
  if (!espera.ok) {
    registro(`::error::${espera.mensaje}`)
    escribir(`${titulo}**Falló.** ${espera.mensaje}\n\n`)
    return 1
  }
  if (espera.mensaje) registro(`::warning::${espera.mensaje}`)

  const errores = await comprobarPublicado(config, espera.html, pedir)
  const lineas = [
    espera.version
      ? `Producción sirve el commit \`${espera.version.slice(0, 7)}\` (comprobado en ${espera.intentos} ${espera.intentos === 1 ? 'petición' : 'peticiones'}).`
      : espera.mensaje,
  ]
  if (errores.length === 0) {
    lineas.push(
      'La portada y su script principal cargan, y `search_public_species` responde con la clave publicable.',
    )
    registro('Prueba de humo superada.')
  } else {
    lineas.push('**Falló:**', '', ...errores.map((e) => `- ${e}`))
    for (const e of errores) registro(`::error::${e}`)
  }
  escribir(`${titulo}${lineas.join('\n')}\n\n`)
  return errores.length === 0 ? 0 : 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await principal(process.env)
}
