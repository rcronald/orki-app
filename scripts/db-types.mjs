#!/usr/bin/env node
// Tipos de TypeScript del esquema: npm run db:types [-- --comprobar]
//
// Genera apps/web/src/lib/database.types.ts a partir de las migraciones de supabase/migrations,
// sin Docker y sin credenciales: prepara una base Postgres desechable con todas las migraciones
// (scripts/db-desechable), ejecuta contra ella `supabase gen types` de la CLI del proyecto y
// formatea el resultado con Prettier. Solo se incluye el esquema public, que es lo que expone
// la API; los esquemas auth, extensions y private del mínimo simulado de Supabase quedan fuera.
//
// Con --comprobar (npm run db:types:check) no escribe nada: compara lo generado con el archivo
// versionado y termina con código 1 si no coinciden. Lo usa el CI.
//
// La CLI v3 genera los tipos de forma nativa al recibir una URL de base de datos (no arranca
// contenedores), y el resultado no depende de la versión de Postgres (14 o 17) ni de la
// configuración regional del servidor: ordena tablas, columnas y enumerados por su cuenta.

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import * as prettier from 'prettier'

import {
  conBaseDesechable,
  ErrorDeBaseDesechable,
  raizRepositorio,
} from './db-desechable/index.mjs'

const archivoTipos = join(
  raizRepositorio,
  'apps',
  'web',
  'src',
  'lib',
  'database.types.ts',
)
const rutaTipos = relative(raizRepositorio, archivoTipos)

const cabecera = `// Archivo generado por \`npm run db:types\` a partir de supabase/migrations. No lo edites a mano:
// cambia el esquema con una migración y vuelve a generarlo. El CI comprueba que coincide con las
// migraciones (npm run db:types:check). Los alias para el resto de la app están en database.ts.
`

function urlDeConexion(conexion) {
  const url = new URL('postgresql://localhost')
  url.hostname = conexion.host.includes(':')
    ? `[${conexion.host}]`
    : conexion.host
  url.port = String(conexion.port)
  url.username = conexion.user
  url.password = conexion.password ?? ''
  url.pathname = `/${conexion.database}`
  url.searchParams.set('sslmode', conexion.sslmode ?? 'disable')
  return url.toString()
}

// Ejecuta `supabase gen types` contra la base desechable y devuelve el TypeScript sin formatear.
function generarConCli(conexion) {
  const require = createRequire(import.meta.url)
  const cli = require.resolve('supabase/dist/supabase.js')

  // La CLI se ejecuta en un directorio vacío y sin variables SUPABASE_*, para que no lea
  // supabase/config.toml, supabase/.env ni ningún proyecto enlazado: solo la URL dada.
  const directorio = mkdtempSync(join(tmpdir(), 'orki-tipos-'))
  const entorno = {}
  for (const [clave, valor] of Object.entries(process.env)) {
    if (!clave.startsWith('SUPABASE_') && !clave.startsWith('PG'))
      entorno[clave] = valor
  }
  try {
    const resultado = spawnSync(
      process.execPath,
      [
        cli,
        'gen',
        'types',
        '--lang=typescript',
        '--schema=public',
        `--remote=${urlDeConexion(conexion)}`,
        `--workdir=${directorio}`,
        '--agent=no',
        '--output-format=text',
      ],
      {
        cwd: directorio,
        env: entorno,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      },
    )
    if (resultado.error) {
      throw new ErrorDeBaseDesechable(
        `no se pudo ejecutar la CLI de Supabase: ${resultado.error.message}`,
      )
    }
    // Ante un error, la CLI puede escribir un JSON en la salida estándar en lugar de los tipos.
    if (
      resultado.status !== 0 ||
      !resultado.stdout.includes('export type Database')
    ) {
      // La URL lleva la contraseña de la base desechable: no se muestra.
      const detalle = `${resultado.stdout}\n${resultado.stderr}`
        .replaceAll(conexion.password ?? '\0', '***')
        .trim()
      throw new ErrorDeBaseDesechable(
        `supabase gen types falló (código ${resultado.status}):\n${detalle}`,
      )
    }
    return resultado.stdout
  } finally {
    rmSync(directorio, { recursive: true, force: true })
  }
}

// Con la misma configuración que `prettier --check` (incluido .editorconfig), para que
// `npm run format:check` acepte el archivo tal como sale.
async function formatear(texto) {
  const opciones =
    (await prettier.resolveConfig(archivoTipos, { editorconfig: true })) ?? {}
  return prettier.format(`${cabecera}\n${texto.trim()}\n`, {
    ...opciones,
    filepath: archivoTipos,
  })
}

// Primera línea distinta, con su número, para orientar a quien lea el error del CI.
function primeraDiferencia(esperado, actual) {
  const a = esperado.split('\n')
  const b = actual.split('\n')
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) {
      return (
        `  Primera diferencia en la línea ${i + 1}:\n` +
        `    generado:   ${a[i] === undefined ? '(fin del archivo)' : a[i].trim()}\n` +
        `    versionado: ${b[i] === undefined ? '(fin del archivo)' : b[i].trim()}`
      )
    }
  }
  return ''
}

async function principal() {
  const argumentos = process.argv.slice(2)
  const desconocidos = argumentos.filter((a) => a !== '--comprobar')
  if (desconocidos.length > 0) {
    throw new ErrorDeBaseDesechable(
      `argumento no reconocido: ${desconocidos.join(' ')}. Uso: npm run db:types [-- --comprobar]`,
    )
  }
  const comprobar = argumentos.includes('--comprobar')

  console.log('Preparando la base de datos desechable')
  const generado = await conBaseDesechable(
    async ({ conexion, descripcion, version }) => {
      console.log(`  PostgreSQL ${version}, ${descripcion}`)
      console.log('Generando los tipos con supabase gen types')
      return formatear(generarConCli(conexion))
    },
  )

  const versionado = existsSync(archivoTipos)
    ? readFileSync(archivoTipos, 'utf8')
    : null

  if (comprobar) {
    if (versionado === generado) {
      console.log(`\n${rutaTipos} está al día con las migraciones.`)
      return 0
    }
    console.error(
      versionado === null
        ? `\nError: no existe ${rutaTipos}.`
        : `\nError: ${rutaTipos} no coincide con lo que generan las migraciones.\n` +
            primeraDiferencia(generado, versionado),
    )
    console.error(
      '\nEjecuta "npm run db:types" y añade el archivo regenerado al mismo commit que la ' +
        'migración. No lo edites a mano.',
    )
    return 1
  }

  if (versionado === generado) {
    console.log(`\n${rutaTipos} ya estaba al día; no cambia nada.`)
  } else {
    writeFileSync(archivoTipos, generado)
    console.log(
      `\n${rutaTipos} actualizado. Inclúyelo en el commit de la migración.`,
    )
  }
  return 0
}

try {
  process.exitCode = await principal()
} catch (error) {
  if (error instanceof ErrorDeBaseDesechable) {
    console.error(`\nError: ${error.message}`)
    process.exitCode = 1
  } else {
    throw error
  }
}
