import { PostgrestClient } from '@supabase/postgrest-js'
import { version as postgrestVersion } from '@supabase/postgrest-js/package.json'
import { StorageClient } from '@supabase/storage-js'
import type { Database } from './database.ts'

// Cliente de Supabase de la app (#286): solo las dos piezas que usa, la API de
// datos (PostgREST, con postgrest-js) y Storage (storage-js), sin Supabase Auth
// ni Realtime. Se carga de forma diferida desde supabase.ts (getSupabase).
//
// Reproduce lo que hacía createClient de supabase-js 2.119 con la opción
// `accessToken`, que es como se creaba antes:
// - URL: <supabaseUrl>/rest/v1 y <supabaseUrl>/storage/v1, con la barra final
//   añadida como supabase-js (las rutas y URL públicas y firmadas de Storage
//   salen iguales).
// - Cabeceras de cada petición (fetchWithAuth): `apikey` con la clave
//   publicable y `Authorization: Bearer <token>`, con el token que devuelve
//   `accessToken` justo antes de enviarla (nunca se guarda); sin token, la
//   clave publicable como Bearer, que Supabase trata como anon.
// - PostgREST con el esquema public (Accept-Profile / Content-Profile) y sus
//   reintentos por defecto de las lecturas (GET y HEAD: 1, 2 y 4 s).
// - El fetch global se resuelve en cada petición, no al crear el cliente: así
//   valen los dobles de las pruebas y las envolturas de fetch que se instalen
//   después (Sentry).
// Lo único que cambia es X-Client-Info: dice postgrest-js o storage-js en vez
// de supabase-js.

/** Cliente de la API de datos con el esquema de la app, como el de supabase-js. */
type OrkiPostgrestClient = PostgrestClient<
  Database,
  // Sin __InternalSupabase en database.types.ts, supabase-js usa la 12.
  { PostgrestVersion: '12' },
  'public'
>

/**
 * Lo que la app usa del cliente: from y rpc de PostgREST, y storage. Con los
 * mismos tipos que el SupabaseClient<Database> de supabase-js.
 */
export interface OrkiSupabaseClient {
  from: OrkiPostgrestClient['from']
  rpc: OrkiPostgrestClient['rpc']
  readonly storage: StorageClient
}

/**
 * Token de la petición: el de la sesión o null sin sesión. Si lanza, la
 * petición no se envía y el error llega a quien la hizo (ver getSessionToken).
 */
export type AccessTokenSource = () => Promise<string | null>

/** fetch global, buscado en cada llamada. */
const globalFetch: typeof fetch = (...args) => fetch(...args)

/**
 * Añade `apikey` y `Authorization` a cada petición, como fetchWithAuth de
 * supabase-js: el token se pide justo antes de enviarla. Si quien llama ya
 * puso alguna de las dos cabeceras, se respeta.
 */
function fetchWithAuth(
  publishableKey: string,
  accessToken: AccessTokenSource,
  baseFetch: typeof fetch = globalFetch,
): typeof fetch {
  return async (input, init) => {
    const token = await accessToken()
    const headers = new Headers(init?.headers)
    if (!headers.has('apikey')) headers.set('apikey', publishableKey)
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token ?? publishableKey}`)
    }
    return baseFetch(input, { ...init, headers })
  }
}

/** Crea un cliente; cada petición pide el token a `accessToken`. */
export function createOrkiSupabaseClient(
  supabaseUrl: string,
  publishableKey: string,
  accessToken: AccessTokenSource,
): OrkiSupabaseClient {
  const trimmed = supabaseUrl.trim()
  const baseUrl = new URL(trimmed.endsWith('/') ? trimmed : `${trimmed}/`)

  const rest: OrkiPostgrestClient = new PostgrestClient(
    new URL('rest/v1', baseUrl).href,
    {
      headers: { 'X-Client-Info': `postgrest-js/${postgrestVersion}` },
      schema: 'public',
      fetch: globalFetch,
      wrapFetch: (fetch) => fetchWithAuth(publishableKey, accessToken, fetch),
    },
  )
  // Sin cabeceras propias: storage-js pone su X-Client-Info.
  const storage = new StorageClient(
    new URL('storage/v1', baseUrl).href,
    {},
    fetchWithAuth(publishableKey, accessToken),
  )

  return {
    from: rest.from.bind(rest),
    rpc: rest.rpc.bind(rest),
    storage,
  }
}
