import { next } from '@vercel/functions/middleware'
import { cabecerasDeLaPolitica, MODO_CSP } from './seguridad/politica.ts'
import { SCRIPTS_EN_LINEA } from './seguridad/scripts-en-linea.ts'

// Routing Middleware de Vercel (#282): añade la política de seguridad de
// contenido (CSP) a las páginas de la app. Las demás cabeceras de seguridad
// son fijas y están en vercel.json; esta no puede estar allí porque sus
// dominios dependen del ambiente (instancia de Clerk, proyecto de Supabase,
// proyecto de Sentry) y vercel.json es estático. El middleware la compone con
// las mismas variables VITE_* con las que se construyó el despliegue, que
// Vercel también da en tiempo de ejecución y no cambian sin desplegar de nuevo.
// Por qué así y no de otra forma: docs/operacion/cabeceras-de-seguridad.md.
//
// Solo corre en las navegaciones (matcher): no en assets/, workbox-* ni sw.js,
// que no necesitan CSP (sw.js con CSP restringiría al propio service worker).
// Sí en /index.html, que es lo que precachea el service worker: la app
// instalada sirve esa respuesta, con sus cabeceras, sin pasar por aquí.

export const config = {
  matcher: '/((?!assets/|workbox-|sw\\.js).*)',
}

// Se calcula una vez por instancia: las variables no cambian sin desplegar.
let cabeceras: Record<string, string> | null = null

export default function middleware(): Response {
  try {
    cabeceras ??= cabecerasDeLaPolitica(process.env, {
      modo: MODO_CSP,
      scriptsEnLinea: SCRIPTS_EN_LINEA,
    })
    return next({ headers: cabeceras })
  } catch (error) {
    // Sin una variable válida, la página se sirve igual, sin CSP: mejor que
    // un error en cada visita. Queda en los registros de la función.
    console.error(
      `No se pudo componer la CSP: ${error instanceof Error ? error.message : String(error)}`,
    )
    return next()
  }
}
