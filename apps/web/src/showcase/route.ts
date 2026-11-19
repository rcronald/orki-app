import type { AppEnv } from '../config/env.ts'

// Ruta fija de la página interna de muestra del design system. No hay router:
// main.tsx mira location.pathname al arrancar. Vercel y el service worker
// responden cualquier ruta con index.html, así que abrirla o recargarla
// funciona igual que la raíz.
export const SHOWCASE_PATH = '/muestra'

/**
 * Si hay que mostrar la página de muestra en lugar de la app: solo fuera de
 * producción y solo en su ruta (con o sin barra final).
 */
export function isShowcaseRoute(pathname: string, appEnv: AppEnv): boolean {
  if (appEnv === 'prod') return false
  const normalized =
    pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return normalized === SHOWCASE_PATH
}
