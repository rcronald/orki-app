// Cabeceras de seguridad del servidor de las pruebas de extremo a extremo
// (#282): las mismas que en Vercel, con la CSP como obligatoria.
//
// - Las firmes salen de la regla «/(.*)» de apps/web/vercel.json, el archivo
//   que lee Vercel, no de una copia.
// - La CSP la compone apps/web/seguridad/politica.ts, el módulo del middleware,
//   con las variables ficticias con las que se construye la app de las pruebas
//   (scripts/medicion/entorno.mjs): Supabase, Clerk y Sentry en *.orki.invalid.
//   Se sirve como Content-Security-Policy, no Report-Only, para que cualquier
//   violación bloquee y la prueba la vea. Va en las mismas rutas que el
//   middleware (su config.matcher).

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../../apps/web/middleware.ts'
import { cabecerasDeLaPolitica } from '../../apps/web/seguridad/politica.ts'
import { SCRIPTS_EN_LINEA } from '../../apps/web/seguridad/scripts-en-linea.ts'
import { ENTORNO_FICTICIO } from '../medicion/entorno.mjs'
import { TODAS_LAS_RUTAS } from './comprobar.mjs'

const VERCEL_JSON = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../apps/web/vercel.json',
)

/** Cabeceras para cada ruta pedida, como las daría Vercel con la CSP obligatoria. */
export function cabecerasDeLasPruebas({
  vercel = JSON.parse(readFileSync(VERCEL_JSON, 'utf8')),
  entorno = ENTORNO_FICTICIO,
} = {}) {
  const regla = vercel.headers.find((r) => r.source === TODAS_LAS_RUTAS)
  const firmes = Object.fromEntries(
    (regla?.headers ?? []).map((h) => [h.key, h.value]),
  )
  const politica = cabecerasDeLaPolitica(entorno, {
    modo: 'obligatoria',
    scriptsEnLinea: SCRIPTS_EN_LINEA,
  })
  const conPolitica = new RegExp(`^${config.matcher}$`)
  return (ruta) =>
    conPolitica.test(ruta) ? { ...firmes, ...politica } : firmes
}
