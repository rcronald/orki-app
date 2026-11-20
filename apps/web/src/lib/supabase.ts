import { createClient } from '@supabase/supabase-js'
import type { AppConfig } from '../config/env.ts'
import type { Database } from './database.ts'

// Único punto donde se crea el cliente de Supabase.
//
// La sesión de usuario la manejará Clerk (issue #5), así que el cliente no
// guarda, renueva ni lee sesiones de Supabase Auth.
//
// El cliente está tipado con el esquema (database.types.ts, generado con
// `npm run db:types`): tablas, columnas y valores de enumerados se comprueban
// al compilar.

export function createSupabase(config: AppConfig) {
  return createClient<Database>(
    config.supabaseUrl,
    config.supabasePublishableKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  )
}

export type OrkiSupabaseClient = ReturnType<typeof createSupabase>

let client: OrkiSupabaseClient | undefined

/** Crea el cliente compartido. Se llama una vez al arrancar, en main.tsx. */
export function initSupabase(config: AppConfig): OrkiSupabaseClient {
  client ??= createSupabase(config)
  return client
}

/** Devuelve el cliente compartido. Falla si la app no lo ha inicializado. */
export function getSupabase(): OrkiSupabaseClient {
  if (client === undefined) {
    throw new Error('El cliente de Supabase no se ha inicializado.')
  }
  return client
}
