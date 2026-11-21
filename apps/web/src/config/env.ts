// Lectura y validación de las variables de entorno de la app.
//
// `parseEnv` es una función pura: recibe el objeto de entorno (normalmente
// `import.meta.env`) y devuelve la configuración tipada o la lista de problemas.
// Los problemas solo nombran la variable y el motivo; nunca incluyen su valor.

export const APP_ENVS = ['dev', 'prod'] as const

export type AppEnv = (typeof APP_ENVS)[number]

export interface AppConfig {
  supabaseUrl: string
  supabasePublishableKey: string
  appEnv: AppEnv
  clerkPublishableKey: string
  /** DSN de Sentry; sin él Sentry queda apagado (ver observability/). */
  sentryDsn?: string
}

export type EnvVarName =
  | 'VITE_SUPABASE_URL'
  | 'VITE_SUPABASE_PUBLISHABLE_KEY'
  | 'VITE_APP_ENV'
  | 'VITE_CLERK_PUBLISHABLE_KEY'
  | 'VITE_SENTRY_DSN'

export interface EnvIssue {
  variable: EnvVarName
  problem: string
}

export type EnvParseResult =
  { ok: true; config: AppConfig } | { ok: false; issues: EnvIssue[] }

type EnvSource = Readonly<Record<string, unknown>>

const MISSING = 'Falta o está vacía.'

function readString(source: EnvSource, name: EnvVarName): string | undefined {
  const value = source[name]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname !== ''
  } catch {
    return false
  }
}

function isAppEnv(value: string): value is AppEnv {
  return (APP_ENVS as readonly string[]).includes(value)
}

// Prefijo de la clave publicable de Clerk que corresponde a cada ambiente: la
// instancia de desarrollo de Clerk sirve a dev y la de producción a prod.
const CLERK_KEY_PREFIX: Record<AppEnv, string> = {
  dev: 'pk_test_',
  prod: 'pk_live_',
}

/**
 * Problema de la clave publicable de Clerk, o undefined si es válida. Sin un
 * ambiente válido solo se comprueba el formato.
 */
function clerkKeyProblem(
  key: string,
  appEnv: AppEnv | undefined,
): string | undefined {
  if (key.startsWith('sk_')) {
    // Todo lo que empieza por VITE_ acaba en el JavaScript público del build.
    return 'Es una clave secreta de Clerk; usa la clave publicable (pk_test_ o pk_live_).'
  }
  const prefix = Object.values(CLERK_KEY_PREFIX).find(
    (candidate) => key.startsWith(candidate) && key.length > candidate.length,
  )
  if (prefix === undefined) {
    return 'Tiene que empezar por pk_test_ o pk_live_.'
  }
  if (appEnv !== undefined && prefix !== CLERK_KEY_PREFIX[appEnv]) {
    return appEnv === 'dev'
      ? 'Es una clave de producción (pk_live_); con VITE_APP_ENV=dev usa la de desarrollo (pk_test_).'
      : 'Es una clave de desarrollo (pk_test_); con VITE_APP_ENV=prod usa la de producción (pk_live_).'
  }
  return undefined
}

/**
 * Problema del DSN de Sentry, o undefined si es válido. Un DSN tiene la forma
 * https://<clave pública>@<host>/<id del proyecto>. La clave pública no es un
 * secreto (va en el JavaScript del build); los DSN antiguos con clave secreta
 * (https://<clave>:<secreto>@...) se rechazan.
 */
function sentryDsnProblem(dsn: string): string | undefined {
  let url: URL
  try {
    url = new URL(dsn)
  } catch {
    return 'No es un DSN de Sentry válido (https://<clave>@<host>/<proyecto>).'
  }
  if (url.password !== '') {
    return 'Lleva una clave secreta; usa el DSN público del proyecto, sin la parte tras los dos puntos.'
  }
  if (
    url.protocol !== 'https:' ||
    url.username === '' ||
    url.hostname === '' ||
    !/^\/\d+$/.test(url.pathname) ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    return 'No es un DSN de Sentry válido (https://<clave>@<host>/<proyecto>).'
  }
  return undefined
}

export function parseEnv(source: EnvSource): EnvParseResult {
  const issues: EnvIssue[] = []
  const fail = (variable: EnvVarName, problem: string) => {
    issues.push({ variable, problem })
  }

  const supabaseUrl = readString(source, 'VITE_SUPABASE_URL')
  if (supabaseUrl === undefined) {
    fail('VITE_SUPABASE_URL', MISSING)
  } else if (!isHttpsUrl(supabaseUrl)) {
    fail('VITE_SUPABASE_URL', 'No es una URL https válida.')
  }

  const supabasePublishableKey = readString(
    source,
    'VITE_SUPABASE_PUBLISHABLE_KEY',
  )
  if (supabasePublishableKey === undefined) {
    fail('VITE_SUPABASE_PUBLISHABLE_KEY', MISSING)
  } else if (supabasePublishableKey.startsWith('sb_secret_')) {
    // Todo lo que empieza por VITE_ acaba en el JavaScript público del build.
    fail(
      'VITE_SUPABASE_PUBLISHABLE_KEY',
      'Es una clave secreta; usa la clave publicable del proyecto.',
    )
  }

  const rawAppEnv = readString(source, 'VITE_APP_ENV')
  const appEnv =
    rawAppEnv !== undefined && isAppEnv(rawAppEnv) ? rawAppEnv : undefined
  if (rawAppEnv === undefined) {
    fail('VITE_APP_ENV', MISSING)
  } else if (appEnv === undefined) {
    fail(
      'VITE_APP_ENV',
      `Tiene que ser ${APP_ENVS.map((name) => `"${name}"`).join(' o ')}.`,
    )
  }

  const clerkPublishableKey = readString(source, 'VITE_CLERK_PUBLISHABLE_KEY')
  if (clerkPublishableKey === undefined) {
    fail('VITE_CLERK_PUBLISHABLE_KEY', MISSING)
  } else {
    const problem = clerkKeyProblem(clerkPublishableKey, appEnv)
    if (problem !== undefined) fail('VITE_CLERK_PUBLISHABLE_KEY', problem)
  }

  // Opcional: sin DSN, Sentry queda apagado (local, pruebas e integración
  // continua). Si está, tiene que ser válido, como las demás variables.
  const sentryDsn = readString(source, 'VITE_SENTRY_DSN')
  if (sentryDsn !== undefined) {
    const problem = sentryDsnProblem(sentryDsn)
    if (problem !== undefined) fail('VITE_SENTRY_DSN', problem)
  }

  if (
    issues.length > 0 ||
    supabaseUrl === undefined ||
    supabasePublishableKey === undefined ||
    appEnv === undefined ||
    clerkPublishableKey === undefined
  ) {
    return { ok: false, issues }
  }

  return {
    ok: true,
    config: {
      supabaseUrl,
      supabasePublishableKey,
      appEnv,
      clerkPublishableKey,
      sentryDsn,
    },
  }
}
