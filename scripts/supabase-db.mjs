#!/usr/bin/env node
// Envuelve la CLI de Supabase para el flujo de migraciones de Orki.
//
// Uso:
//   node scripts/supabase-db.mjs nueva <nombre>    Crea una migración vacía en supabase/migrations.
//   node scripts/supabase-db.mjs estado            Compara las migraciones locales con las aplicadas.
//   node scripts/supabase-db.mjs aplicar [--yes]   Aplica las migraciones pendientes.
//   node scripts/supabase-db.mjs datos-ejemplo     Carga los datos de ejemplo del catálogo
//                                                  (supabase/datos-ejemplo/catalogo.sql).
//
// "estado", "aplicar" y "datos-ejemplo" actúan sobre el proyecto indicado por
// SUPABASE_PROJECT_REF y necesitan además SUPABASE_ACCESS_TOKEN y SUPABASE_DB_PASSWORD. Se
// leen del entorno y, si no están ahí, del archivo supabase/.env (ignorado por git). El
// entorno tiene prioridad.
//
// Antes de cada comando se enlaza el proyecto con `supabase link`. El enlace guarda en
// supabase/.temp (ignorado por git) la URL del pooler de conexiones, que la CLI necesita
// para conectarse por IPv4: la conexión directa a la base de datos solo funciona por IPv6,
// que no está disponible en muchas redes ni en los ejecutores de GitHub Actions. La
// contraseña se lee de SUPABASE_DB_PASSWORD y nunca aparece en la línea de comandos.
//
// "datos-ejemplo" solo funciona contra el proyecto de desarrollo: se niega a ejecutarse si
// SUPABASE_PROJECT_REF no es el ref de desarrollo, y en particular si es el de producción.
// Los datos de ejemplo nunca deben llegar a producción, donde el catálogo real llega con la
// importación (issue #8).

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const archivoEnv = join(raiz, 'supabase', '.env')
const archivoDatosEjemplo = 'supabase/datos-ejemplo/catalogo.sql'
const resumenCatalogo = `select
  (select count(*) from public.genera) as genera,
  (select count(*) from public.genus_abbreviations) as genus_abbreviations,
  (select count(*) from public.species) as species,
  (select count(*) from public.species_names where type = 'synonym') as synonyms,
  (select count(*) from public.species_names where type = 'common') as common_names`
const refDesarrollo = 'xaitolsnmjlpyptntfwi'
const refProduccion = 'fzundhfxnbyjbxyhkgtg'
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

  // Si estuviera definida, la CLI la usaría como proyecto y pasaría por alto el enlace.
  delete entorno.SUPABASE_PROJECT_ID
  return entorno
}

// Con { sinEntrada: true } la CLI se lanza con la entrada estándar cerrada, para que no se
// quede esperando una respuesta que nadie va a escribir.
function ejecutarCli(
  argumentos,
  entorno = process.env,
  { sinEntrada = false } = {},
) {
  const require = createRequire(import.meta.url)
  const cli = require.resolve('supabase/dist/supabase.js')
  const resultado = spawnSync(process.execPath, [cli, ...argumentos], {
    cwd: raiz,
    env: entorno,
    stdio: sinEntrada ? ['ignore', 'inherit', 'inherit'] : 'inherit',
  })
  if (resultado.error)
    fallar(`no se pudo ejecutar la CLI de Supabase: ${resultado.error.message}`)
  return resultado.status ?? 1
}

function enlazarProyecto(entorno, opciones) {
  const enlace = ejecutarCli(
    ['link', entorno.SUPABASE_PROJECT_REF.trim()],
    entorno,
    opciones,
  )
  if (enlace !== 0) process.exit(enlace)
}

function ejecutarEnProyecto(argumentos) {
  const entorno = entornoConCredenciales()
  enlazarProyecto(entorno)
  process.exit(ejecutarCli(argumentos, entorno))
}

function cargarDatosEjemplo(sobrantes) {
  if (sobrantes.length > 0)
    fallar('"datos-ejemplo" no admite argumentos: npm run db:seed:dev')
  const entorno = entornoConCredenciales()
  const ref = entorno.SUPABASE_PROJECT_REF.trim()
  if (ref === refProduccion) {
    fallar(
      `SUPABASE_PROJECT_REF es el proyecto de PRODUCCIÓN (${ref}). Los datos de ejemplo son ` +
        `solo para desarrollo y no se cargan en producción. No se ha ejecutado nada.`,
    )
  }
  if (ref !== refDesarrollo) {
    fallar(
      `SUPABASE_PROJECT_REF (${ref}) no es el proyecto de desarrollo (${refDesarrollo}). ` +
        `Los datos de ejemplo solo se cargan en desarrollo. No se ha ejecutado nada.`,
    )
  }
  console.log(
    `Cargando ${archivoDatosEjemplo} en el proyecto de desarrollo (${ref})`,
  )
  const opciones = { sinEntrada: true }
  enlazarProyecto(entorno, opciones)
  // Una escritura en un proyecto alojado exige --yes; el destino ya se ha comprobado arriba.
  // La CLI solo admite una sentencia por consulta: el archivo es un único bloque "do", y el
  // resumen va aparte, en una consulta de solo lectura.
  const carga = ejecutarCli(
    ['db', 'query', '--remote', '--yes', '-f', archivoDatosEjemplo],
    entorno,
    opciones,
  )
  if (carga !== 0) process.exit(carga)
  console.log('Datos de ejemplo cargados. Catálogo resultante:')
  process.exit(
    ejecutarCli(
      ['db', 'query', '--remote', '--read-only', resumenCatalogo],
      entorno,
      opciones,
    ),
  )
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
    process.exit(ejecutarCli(['migration', 'new', nombre]))
    break
  }
  case 'estado':
    ejecutarEnProyecto(['migration', 'list', '--remote', ...resto])
    break
  case 'aplicar':
    ejecutarEnProyecto(['db', 'push', '--remote', ...resto])
    break
  case 'datos-ejemplo':
    cargarDatosEjemplo(resto)
    break
  default:
    fallar(
      `acción desconocida${accion ? ` "${accion}"` : ''}. Usa "nueva <nombre>", "estado", "aplicar" o "datos-ejemplo".`,
    )
}
