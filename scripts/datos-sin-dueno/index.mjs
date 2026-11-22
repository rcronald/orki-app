#!/usr/bin/env node
// Detección de datos sin dueño (#112, parte de #26): perfiles, plantas, eventos
// de producto y fotos de usuarios que ya no existen en Clerk.
//
// Uso (detalles, credenciales y riesgos en el README de esta carpeta):
//   npm run datos:sin-dueno -- --ambiente desarrollo                 # solo lista
//   npm run datos:sin-dueno -- --ambiente desarrollo --borrar        # borra
//   npm run datos:sin-dueno -- --ambiente produccion --borrar --confirmar-produccion <ref>
//
// Este archivo solo conecta las dependencias reales; la lógica y sus pruebas
// están en datos-sin-dueno.mjs y datos-sin-dueno.test.mjs.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createClient } from '@supabase/supabase-js'

import { PLANT_PHOTOS_BUCKET } from '../../apps/web/src/photos/paths.ts'
import { principal } from './datos-sin-dueno.mjs'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

try {
  await principal({
    argv: process.argv.slice(2),
    entorno: process.env,
    archivoEnv: join(raiz, 'supabase', '.env'),
    crearSupabase: (url, clave) =>
      createClient(url, clave, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    nombreBucket: PLANT_PHOTOS_BUCKET,
    fetch: globalThis.fetch,
    log: (linea) => console.log(linea),
  })
} catch (error) {
  console.error(
    `Error: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exit(1)
}
