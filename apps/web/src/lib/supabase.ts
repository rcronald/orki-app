import type { createClient } from '@supabase/supabase-js'
import type { AppConfig } from '../config/env.ts'
import type { Database } from './database.ts'

// Único punto donde se crea el cliente de Supabase.
//
// El cliente está tipado con el esquema (database.types.ts, generado con
// `npm run db:types`): tablas, columnas y valores de enumerados se comprueban
// al compilar.
//
// Carga diferida: supabase-js pesa unos 230 kB y no hace falta para pintar la
// primera pantalla, así que no va en el chunk inicial. main.tsx solo guarda la
// configuración (initSupabase) y el cliente se crea la primera vez que alguien
// lo pide (getSupabase), con un import dinámico. El service worker precachea
// todos los chunks, así que sin conexión también carga, desde la caché.
//
// Identidad: la sesión es de Clerk, no de Supabase Auth. El cliente usa la
// opción `accessToken` de supabase-js para tokens de terceros y, en cada
// petición, envía el token de sesión de Clerk; sin sesión, solo la clave
// publicable (Supabase la trata como anon).
// https://supabase.com/docs/guides/auth/third-party/clerk
// https://clerk.com/docs/guides/development/integrations/databases/supabase
//
// Cómo llega el token: este módulo va en el chunk inicial y Clerk, en el chunk
// diferido de la app (ver routes/AppRouter.tsx). Para no meter Clerk aquí ni
// crear un segundo cliente, el token se pide a una fuente registrable: el
// árbol de Clerk (auth/SupabaseSessionBridge.tsx) registra una con
// setSessionTokenSource() mientras hay sesión y la quita al cerrarla o al
// desmontarse. Sin fuente registrada (sin sesión, Clerk sin cargar o fuera de
// Clerk, como en /muestra), las peticiones van como anon.

export type OrkiSupabaseClient = ReturnType<typeof createClient<Database>>

// Errores del token ----------------------------------------------------------

/**
 * Por qué no se pudo obtener el token de una sesión iniciada:
 * - offline: sin conexión; Clerk no puede emitir el token (ClerkOfflineError).
 * - session-ended: Clerk ya no tiene sesión (caducó o se cerró en otra
 *   pestaña) aunque la app la daba por iniciada.
 * - failed: cualquier otro fallo al pedir el token.
 */
export type SessionTokenFailure = 'offline' | 'session-ended' | 'failed'

/** Textos para mostrar en pantalla, uno por motivo. */
export const SESSION_TOKEN_ERROR_TEXT: Record<SessionTokenFailure, string> = {
  offline:
    'Sin conexión: no se pudo confirmar tu sesión para consultar tus datos.',
  'session-ended': 'Tu sesión terminó. Vuelve a iniciar sesión para continuar.',
  failed: 'No se pudo confirmar tu sesión. Vuelve a intentarlo.',
}

const ERROR_NAME = 'SessionTokenError'

/**
 * Error de una petición que necesitaba el token de sesión y no lo tuvo. La
 * petición no se envía: ni falla en silencio ni sale como anónima.
 */
export class SessionTokenError extends Error {
  readonly reason: SessionTokenFailure

  constructor(reason: SessionTokenFailure, options?: { cause?: unknown }) {
    super(SESSION_TOKEN_ERROR_TEXT[reason], options)
    // Explícito: la minificación cambia el nombre de la clase y supabase-js
    // usa `name` para componer el mensaje del error que devuelve.
    this.name = ERROR_NAME
    this.reason = reason
  }
}

/**
 * Motivo del fallo si `error` viene de no tener el token de sesión, o null.
 *
 * Acepta el SessionTokenError lanzado (con throwOnError o fuera de la API de
 * datos) y también el `error` que devuelven las consultas de supabase-js: este
 * convierte cualquier fallo de fetch en `{ message: "<name>: <message>" }` y
 * pierde la clase, así que se reconoce por el texto exacto.
 */
export function sessionTokenFailure(
  error: unknown,
): SessionTokenFailure | null {
  if (error instanceof SessionTokenError) return error.reason
  if (typeof error !== 'object' || error === null) return null
  const message = (error as { message?: unknown }).message
  if (typeof message !== 'string') return null
  const prefix = `${ERROR_NAME}: `
  if (!message.startsWith(prefix)) return null
  const text = message.slice(prefix.length)
  const entry = Object.entries(SESSION_TOKEN_ERROR_TEXT).find(
    ([, candidate]) => candidate === text,
  )
  return entry ? (entry[0] as SessionTokenFailure) : null
}

// Fuente del token -----------------------------------------------------------

/**
 * Devuelve el token de la sesión iniciada. Solo se registra mientras hay
 * sesión, así que devolver null significa que la sesión ya no existe.
 */
export type SessionTokenSource = () => Promise<string | null>

let tokenSource: SessionTokenSource | null = null

/**
 * Registra la fuente del token de la sesión actual. Devuelve la función que la
 * quita (solo si sigue siendo la registrada). Con null, se quita la que haya.
 */
export function setSessionTokenSource(
  source: SessionTokenSource | null,
): () => void {
  tokenSource = source
  return () => {
    if (tokenSource === source) tokenSource = null
  }
}

/**
 * Lo que recibe supabase-js en `accessToken`, antes de cada petición:
 * - Sin fuente (sin sesión): null, y la petición va con la clave publicable,
 *   como anon. El catálogo se sigue leyendo.
 * - Con fuente: el token. Si la fuente falla o ya no hay token, lanza
 *   SessionTokenError y supabase-js no envía la petición: la consulta devuelve
 *   un error reconocible con sessionTokenFailure() en lugar de salir como
 *   anónima.
 */
export async function getSessionToken(): Promise<string | null> {
  const source = tokenSource
  if (source === null) return null
  let token: string | null
  try {
    token = await source()
  } catch (error) {
    if (error instanceof SessionTokenError) throw error
    throw new SessionTokenError('failed', { cause: error })
  }
  if (!token) throw new SessionTokenError('session-ended')
  return token
}

// Cliente ----------------------------------------------------------------------

let config: AppConfig | undefined
let client: Promise<OrkiSupabaseClient> | undefined

async function createSupabase(
  appConfig: AppConfig,
): Promise<OrkiSupabaseClient> {
  const { createClient } = await import('@supabase/supabase-js')
  return createClient<Database>(
    appConfig.supabaseUrl,
    appConfig.supabasePublishableKey,
    {
      // Con accessToken, supabase-js no usa Supabase Auth (supabase.auth no
      // está disponible) ni guarda sesión propia.
      accessToken: getSessionToken,
    },
  )
}

/** Guarda la configuración validada. Se llama una vez al arrancar, en main.tsx. */
export function initSupabase(appConfig: AppConfig): void {
  config ??= appConfig
}

/**
 * Si la app guardó la configuración de Supabase. En la app siempre es true (sin
 * configuración válida, main.tsx muestra el error y no monta nada más); en las
 * pruebas que no llaman a initSupabase es false. Sirve a quien tiene datos de
 * reserva, como la página de muestra.
 */
export function isSupabaseConfigured(): boolean {
  return config !== undefined
}

/**
 * Devuelve el cliente compartido; la primera vez carga supabase-js y lo crea.
 * Falla si la app no se ha inicializado. Si la carga falla (por ejemplo, el
 * chunk no llega), la siguiente llamada lo vuelve a intentar.
 */
export function getSupabase(): Promise<OrkiSupabaseClient> {
  if (config === undefined) {
    return Promise.reject(
      new Error('El cliente de Supabase no se ha inicializado.'),
    )
  }
  if (client === undefined) {
    const pending = createSupabase(config)
    client = pending
    pending.catch(() => {
      if (client === pending) client = undefined
    })
  }
  return client
}
