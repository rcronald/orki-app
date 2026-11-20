// Rutas de las pantallas de acceso. Todavía no hay enrutador: App.tsx mira
// location.pathname al arrancar, igual que main.tsx con /muestra. Vercel y el
// service worker responden cualquier ruta con index.html, así que abrir o
// recargar estas rutas funciona. El enrutador del issue #57 las tomará de aquí.
export const SIGN_IN_PATH = '/iniciar-sesion'
export const SIGN_UP_PATH = '/registro'

export type AuthPage = 'sign-in' | 'sign-up'

/** Pantalla de acceso de la ruta (con o sin barra final), o null si no es una. */
export function authPageFor(pathname: string): AuthPage | null {
  const normalized =
    pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (normalized === SIGN_IN_PATH) return 'sign-in'
  if (normalized === SIGN_UP_PATH) return 'sign-up'
  return null
}
