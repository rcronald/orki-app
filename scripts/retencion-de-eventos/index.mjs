#!/usr/bin/env node
// Retención de los eventos de producto (#293): borra los de más de 13 meses llamando a
// public.purge_expired_product_events() con la clave secreta del proyecto.
//
// Uso (lo ejecuta cada día el workflow «Retención de eventos»):
//   SUPABASE_PROJECT_REF=... SUPABASE_SECRET_KEY=... \
//     npm run eventos:retencion -- --ambiente produccion
//
// Las credenciales se leen solo del entorno, nunca de supabase/.env. Este archivo solo
// conecta las dependencias reales; la lógica y sus pruebas están en retencion-de-eventos.mjs
// y retencion-de-eventos.test.mjs. Documentación: docs/operacion/retencion-y-limpieza.md.

import { createClient } from '@supabase/supabase-js'

import { principal } from './retencion-de-eventos.mjs'

try {
  await principal({
    argv: process.argv.slice(2),
    entorno: process.env,
    crearSupabase: (url, clave) =>
      createClient(url, clave, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    log: (linea) => console.log(linea),
  })
} catch (error) {
  console.error(
    `Error: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exit(1)
}
