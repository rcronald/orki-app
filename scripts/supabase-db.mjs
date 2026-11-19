#!/usr/bin/env node
// Envuelve la CLI de Supabase para el flujo de migraciones de Orki.
//
// Uso:
//   node scripts/supabase-db.mjs nueva <nombre>    Crea una migración vacía en supabase/migrations.
//   node scripts/supabase-db.mjs estado            Compara las migraciones locales con las aplicadas.
//   node scripts/supabase-db.mjs aplicar [--yes]   Aplica las migraciones pendientes.
//
// "estado" y "aplicar" actúan sobre el proyecto indicado por SUPABASE_PROJECT_REF y
// necesitan además SUPABASE_ACCESS_TOKEN y SUPABASE_DB_PASSWORD. Se leen del entorno y,
// si no están ahí, del archivo supabase/.env (ignorado por git). El entorno tiene prioridad.
//
// La CLI no se enlaza con `supabase link`: el identificador del proyecto se le pasa en
// SUPABASE_PROJECT_ID, que la CLI trata como proyecto enlazado, y así lee la contraseña
// de SUPABASE_DB_PASSWORD sin que aparezca en la línea de comandos.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const archivoEnv = join(raiz, 'supabase', '.env')
const variablesRequeridas = [
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_DB_PASSWORD',
  'SUPABASE_PROJECT_REF',
]

function fallar(mensaje) {
  console.error(`Error: ${mensaje}`)
  process.exit(1)
}

function leerArchivoEnv() {
  if (!existsSync(archivoEnv)) return {}
  try {
    return parseEnv(readFileSync(archivoEnv, 'utf8'))
  } catch (error) {
    fallar(
      `no se pudo leer ${relative(raiz, archivoEnv)}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function entornoConCredenciales() {
  const delArchivo = leerArchivoEnv()
  const entorno = { ...process.env }
  for (const nombre of variablesRequeridas) {
    if (!entorno[nombre] && delArchivo[nombre])
      entorno[nombre] = delArchivo[nombre]
  }

  const faltan = variablesRequeridas.filter(
    (nombre) => !entorno[nombre]?.trim(),
  )
  if (faltan.length > 0) {
    const una = faltan.length === 1
    fallar(
      `${una ? 'falta la variable de entorno' : 'faltan las variables de entorno'} ${faltan.join(', ')}.\n` +
        `${una ? 'Defínela' : 'Defínelas'} en el entorno o en ${relative(raiz, archivoEnv)} ` +
        `(copia supabase/.env.example y completa los valores del proyecto de desarrollo).`,
    )
  }

  // La CLI toma SUPABASE_PROJECT_ID como el proyecto enlazado.
  entorno.SUPABASE_PROJECT_ID = entorno.SUPABASE_PROJECT_REF.trim()
  return entorno
}

function ejecutarCli(argumentos, entorno = process.env) {
  const require = createRequire(import.meta.url)
  const cli = require.resolve('supabase/dist/supabase.js')
  const resultado = spawnSync(process.execPath, [cli, ...argumentos], {
    cwd: raiz,
    env: entorno,
    stdio: 'inherit',
  })
  if (resultado.error)
    fallar(`no se pudo ejecutar la CLI de Supabase: ${resultado.error.message}`)
  process.exit(resultado.status ?? 1)
}

const [accion, ...resto] = process.argv.slice(2)

switch (accion) {
  case 'nueva': {
    const [nombre, ...sobrantes] = resto
    if (!nombre || sobrantes.length > 0) {
      fallar(
        'indica un único nombre para la migración, por ejemplo: npm run db:new -- crear_tabla_plantas',
      )
    }
    ejecutarCli(['migration', 'new', nombre])
    break
  }
  case 'estado':
    ejecutarCli(
      ['migration', 'list', '--remote', ...resto],
      entornoConCredenciales(),
    )
    break
  case 'aplicar':
    ejecutarCli(['db', 'push', '--remote', ...resto], entornoConCredenciales())
    break
  default:
    fallar(
      `acción desconocida${accion ? ` "${accion}"` : ''}. Usa "nueva <nombre>", "estado" o "aplicar".`,
    )
}
