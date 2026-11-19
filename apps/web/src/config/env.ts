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
}

export type EnvVarName =
  'VITE_SUPABASE_URL' | 'VITE_SUPABASE_PUBLISHABLE_KEY' | 'VITE_APP_ENV'

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

  if (
    issues.length > 0 ||
    supabaseUrl === undefined ||
    supabasePublishableKey === undefined ||
    appEnv === undefined
  ) {
    return { ok: false, issues }
  }

  return { ok: true, config: { supabaseUrl, supabasePublishableKey, appEnv } }
}
