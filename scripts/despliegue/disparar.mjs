// Dispara el despliegue de producción en Vercel llamando a su Deploy Hook, después de que el
// workflow «Migraciones» haya aplicado las migraciones (#281).
//
// La URL del hook es un secreto: llega solo por la variable de entorno
// VERCEL_DEPLOY_HOOK_URL (nunca en la línea de órdenes), se enmascara en el registro y no se
// imprime nunca, ni entera ni en parte, tampoco en los errores. Al resumen va solo el código
// HTTP y el estado que devuelve Vercel.
//
// Uso (en el workflow): node scripts/despliegue/disparar.mjs
//   Variables: VERCEL_DEPLOY_HOOK_URL, GITHUB_STEP_SUMMARY (añade allí el resumen) y
//   GITHUB_OUTPUT (escribe `codigo=<HTTP>`).

import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const PREFIJO_HOOK = 'https://api.vercel.com/v1/integrations/deploy/'
export const INTENTOS = 3

/** Añade al resumen del job, o a la salida estándar fuera de GitHub Actions. */
export function escritorDeResumen(entorno) {
  const archivo = entorno.GITHUB_STEP_SUMMARY
  return archivo
    ? (texto) => appendFileSync(archivo, texto)
    : (texto) => process.stdout.write(texto)
}

const SECRETO =
  'el secreto VERCEL_DEPLOY_HOOK_URL del environment prod (Settings > Environments > prod > Environment secrets)'

/**
 * Comprueba la URL sin mostrarla. Devuelve el mensaje de error o null.
 * @param {string | undefined} url
 */
export function comprobarUrl(url) {
  if (!url?.trim()) {
    return `Falta ${SECRETO}. Créalo con el Deploy Hook de producción de Vercel (Settings > Git > Deploy Hooks, rama main): gh secret set VERCEL_DEPLOY_HOOK_URL --env prod. Ver «Despliegue ordenado» en docs/operacion/despliegue-y-ci.md.`
  }
  const limpia = url.trim()
  if (!limpia.startsWith(PREFIJO_HOOK) || /\s/.test(limpia)) {
    return `${SECRETO[0].toUpperCase()}${SECRETO.slice(1)} no es la URL de un Deploy Hook de Vercel (tiene que empezar por ${PREFIJO_HOOK}). Vuelve a copiarla de Vercel (Settings > Git > Deploy Hooks).`
  }
  return null
}

/**
 * Llama al hook. Reintenta ante un error de red o una respuesta 5xx o 429; un 4xx es
 * definitivo (el hook no existe o se borró). Repetir la llamada como mucho crea otro
 * despliegue del mismo commit.
 *
 * @param {string} url
 * @param {{ fetch?: typeof fetch, esperar?: (ms: number) => Promise<void>, registro?: (linea: string) => void }} [opciones]
 * @returns {Promise<{ ok: boolean, codigo: number | null, estado: string | null }>}
 */
export async function dispararDespliegue(url, opciones = {}) {
  const pedir = opciones.fetch ?? fetch
  const esperar =
    opciones.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  const registro = opciones.registro ?? ((l) => console.log(l))
  let codigo = null
  for (let intento = 1; intento <= INTENTOS; intento++) {
    try {
      const respuesta = await pedir(url.trim(), {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
      })
      codigo = respuesta.status
      if (respuesta.ok) {
        let estado = null
        try {
          const cuerpo = await respuesta.json()
          const valor = cuerpo?.job?.state
          estado =
            typeof valor === 'string' && /^[A-Za-z_]{1,32}$/.test(valor)
              ? valor
              : null
        } catch {
          // El cuerpo no es JSON: basta con el código.
        }
        return { ok: true, codigo, estado }
      }
      if (codigo < 500 && codigo !== 429) break
      registro(
        `Vercel respondió ${codigo} (intento ${intento} de ${INTENTOS}).`,
      )
    } catch (error) {
      // El mensaje de un error de red puede llevar la URL: solo se muestra su tipo.
      const tipo = error instanceof Error ? error.name : 'Error'
      registro(
        `La llamada al hook falló por la red (${tipo}; intento ${intento} de ${INTENTOS}).`,
      )
    }
    if (intento < INTENTOS) await esperar(10_000 * intento)
  }
  return { ok: false, codigo, estado: null }
}

/** @param {{ ok: boolean, codigo: number | null, estado: string | null }} r */
export function resumenDespliegue(r) {
  const codigo = r.codigo === null ? 'sin respuesta' : `HTTP ${r.codigo}`
  if (r.ok) {
    const estado = r.estado ? `, estado ${r.estado}` : ''
    return `## Despliegue de producción\n\nDeploy Hook de Vercel llamado: ${codigo}${estado}. Vercel construye y publica \`main\`; el avance está en su panel (Deployments).\n\n`
  }
  return `## Despliegue de producción\n\n**No se disparó**: el Deploy Hook de Vercel respondió ${codigo}. Las migraciones ya están aplicadas y la web publicada sigue siendo la anterior. Ver «Qué hacer si el despliegue no se dispara» en docs/operacion/despliegue-y-ci.md.\n\n`
}

/** @param {Record<string, string | undefined>} entorno */
export async function principal(entorno, opciones = {}) {
  const escribir = opciones.escribir ?? escritorDeResumen(entorno)
  const registro = opciones.registro ?? ((l) => console.log(l))
  const url = entorno.VERCEL_DEPLOY_HOOK_URL
  const error = comprobarUrl(url)
  if (error) {
    registro(`::error::${error}`)
    return 1
  }
  // GitHub ya enmascara los secretos; se repite por si llega con espacios alrededor.
  registro(`::add-mask::${url.trim()}`)
  const resultado = await dispararDespliegue(url, { ...opciones, registro })
  escribir(resumenDespliegue(resultado))
  if (entorno.GITHUB_OUTPUT) {
    appendFileSync(entorno.GITHUB_OUTPUT, `codigo=${resultado.codigo ?? ''}\n`)
  }
  if (!resultado.ok) {
    registro(
      `::error::El Deploy Hook de Vercel respondió ${resultado.codigo ?? 'sin respuesta'}: no se ha desplegado la web. Las migraciones ya están aplicadas. Si es un 404, el hook se borró en Vercel: crea otro y actualiza el secreto VERCEL_DEPLOY_HOOK_URL del environment prod.`,
    )
    return 1
  }
  registro(`Deploy Hook llamado: HTTP ${resultado.codigo}.`)
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await principal(process.env)
}
