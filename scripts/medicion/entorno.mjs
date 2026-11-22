// Variables de entorno ficticias para construir la app "como producción" sin
// ningún servicio real: las usan el presupuesto de tamaño (CI) y la medición de
// la carga con Lighthouse. No son secretos ni apuntan a nada: los dominios
// terminan en .invalid, que por norma (RFC 6761) nunca resuelve, así que el
// navegador no llega a contactar con Supabase, Clerk ni Sentry.
//
// Por qué cada una:
// - VITE_APP_ENV=prod: como en producción, la muestra (/muestra) y el
//   diagnóstico (/diagnostico) no entran en el build.
// - VITE_SENTRY_DSN: producción tiene DSN, y solo con él existe el chunk del SDK
//   de Sentry (ver apps/web/src/observability/reporter.ts), que el service
//   worker precachea. Sin él, el presupuesto se quedaría corto.
// - VITE_CLERK_PUBLISHABLE_KEY: una clave pk_live_ con formato válido (base64
//   de "<dominio>$", como las de Clerk) que apunta a clerk.orki.invalid. El
//   script de Clerk no carga y la app pública se sigue viendo, como sin
//   conexión con Clerk (ver apps/web/src/auth/useAuthAvailability.ts).
// - VITE_SUPABASE_*: solo tienen que pasar la validación de config/env.ts.

const CLERK_FRONTEND_API = 'clerk.orki.invalid'

export const ENTORNO_FICTICIO = Object.freeze({
  VITE_APP_ENV: 'prod',
  VITE_SUPABASE_URL: 'https://supabase.orki.invalid',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_ficticia_para_medir',
  VITE_CLERK_PUBLISHABLE_KEY: `pk_live_${Buffer.from(`${CLERK_FRONTEND_API}$`).toString('base64')}`,
  VITE_SENTRY_DSN: 'https://ficticia@sentry.orki.invalid/1',
})

// Variables que activarían la subida de mapas de código a Sentry
// (apps/web/vite.config.ts). Se quitan del entorno del build de medición
// aunque existan en la máquina: este build nunca debe contactar con Sentry.
const VARIABLES_EXCLUIDAS = [
  'SENTRY_AUTH_TOKEN',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
  'VERCEL_GIT_COMMIT_SHA',
]

/**
 * Entorno para el proceso del build: el de la máquina, sin las variables de
 * Sentry y con las ficticias encima. Vite da prioridad a las variables del
 * proceso sobre los archivos .env, así que un .env.local con valores reales
 * no se cuela en la medición.
 */
export function entornoDeBuild(base = process.env) {
  const entorno = { ...base }
  for (const nombre of VARIABLES_EXCLUIDAS) delete entorno[nombre]
  return { ...entorno, ...ENTORNO_FICTICIO }
}
