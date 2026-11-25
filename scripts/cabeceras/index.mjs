#!/usr/bin/env node
// Comprobación de las cabeceras de seguridad (#282). Falla si:
// - vercel.json no tiene alguna de las cabeceras firmes con su valor;
// - index.html del build tiene un script en línea cuyo hash no está en
//   apps/web/seguridad/scripts-en-linea.ts, o algo en línea que no se puede
//   permitir con un hash (manejadores on*, direcciones javascript:);
// - la política no permite Supabase, Clerk o Sentry del entorno en las
//   directivas que usa la app (connect-src, img-src, script-src);
// - el código del build tiene un origen que la política no cubre y que no es
//   un simple enlace (ORIGENES_SOLO_ENLACE en comprobar.mjs).
//
// La política se genera con apps/web/seguridad/politica.ts, el mismo módulo
// que usa el middleware de Vercel, y las variables con las que se construyó el
// build: por defecto las ficticias de scripts/medicion/entorno.mjs, las del
// build de npm run build:medicion (así corre en el CI).
//
//   npm run build:medicion && npm run cabeceras
//   npm run cabeceras -- --actualizar          # reescribe los hashes
//   npm run cabeceras -- --entorno-del-proceso # un build con las variables
//                                              # reales del proceso
//
// Ver docs/operacion/cabeceras-de-seguridad.md.

import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { directivasDeLaPolitica } from '../../apps/web/seguridad/politica.ts'
import { SCRIPTS_EN_LINEA } from '../../apps/web/seguridad/scripts-en-linea.ts'
import { ENTORNO_FICTICIO } from '../medicion/entorno.mjs'
import {
  analizarHtml,
  archivoDeScriptsEnLinea,
  origenesEnElCodigo,
  origenesSinCubrir,
  problemasDelEntorno,
  problemasDeVercelJson,
  scriptsSinCubrir,
} from './comprobar.mjs'

const WEB = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../apps/web',
)
const ARCHIVO_DE_HASHES = path.join(WEB, 'seguridad/scripts-en-linea.ts')
const EXTENSIONES_DE_CODIGO = new Set([
  '.js',
  '.mjs',
  '.css',
  '.html',
  '.webmanifest',
])

const { values: opciones } = parseArgs({
  options: {
    carpeta: { type: 'string', default: path.join(WEB, 'dist') },
    actualizar: { type: 'boolean', default: false },
    'entorno-del-proceso': { type: 'boolean', default: false },
  },
})
const carpeta = path.resolve(opciones.carpeta)
const entorno = opciones['entorno-del-proceso'] ? process.env : ENTORNO_FICTICIO

if (!existsSync(path.join(carpeta, 'index.html'))) {
  console.error(
    `No está el build en ${carpeta}. Ejecuta antes npm run build:medicion.`,
  )
  process.exit(1)
}

const problemas = []

// 1. Cabeceras firmes de vercel.json.
const vercel = JSON.parse(await readFile(path.join(WEB, 'vercel.json'), 'utf8'))
problemas.push(...problemasDeVercelJson(vercel))

// 2. Scripts en línea de index.html.
const html = await readFile(path.join(carpeta, 'index.html'), 'utf8')
const { scripts, problemas: enLinea } = analizarHtml(html)
problemas.push(...enLinea)

if (opciones.actualizar) {
  const actual = await readFile(ARCHIVO_DE_HASHES, 'utf8')
  const cabecera = actual.slice(0, actual.indexOf('export const'))
  await writeFile(ARCHIVO_DE_HASHES, archivoDeScriptsEnLinea(scripts, cabecera))
  console.log(
    `Hashes de los scripts en línea actualizados (${String(scripts.length)}) en ${path.relative(process.cwd(), ARCHIVO_DE_HASHES)}.`,
  )
} else {
  for (const hash of scriptsSinCubrir(scripts, SCRIPTS_EN_LINEA)) {
    problemas.push(
      `Script en línea de index.html sin cubrir por la CSP ('${hash}'). Si es intencionado: npm run cabeceras -- --actualizar`,
    )
  }
}

// 3. Orígenes que usa el código del build.
let directivas
try {
  directivas = directivasDeLaPolitica(entorno, {
    scriptsEnLinea: opciones.actualizar ? scripts : SCRIPTS_EN_LINEA,
  })
} catch (error) {
  problemas.push(`No se pudo generar la política: ${error.message}`)
}
if (directivas !== undefined) {
  problemas.push(...problemasDelEntorno(entorno, directivas))
  const origenes = new Set()
  for (const entrada of await readdir(carpeta, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (
      !entrada.isFile() ||
      !EXTENSIONES_DE_CODIGO.has(path.extname(entrada.name))
    )
      continue
    const codigo = await readFile(
      path.join(entrada.parentPath, entrada.name),
      'utf8',
    )
    for (const origen of origenesEnElCodigo(codigo)) origenes.add(origen)
  }
  for (const origen of origenesSinCubrir(origenes, directivas)) {
    problemas.push(
      `El build usa ${origen} y la CSP no lo cubre. Si la app lo carga, añádelo en apps/web/seguridad/politica.ts; si es solo un enlace, en ORIGENES_SOLO_ENLACE (scripts/cabeceras/comprobar.mjs).`,
    )
  }
}

if (problemas.length > 0) {
  console.error(
    `Cabeceras de seguridad: ${String(problemas.length)} problema(s)`,
  )
  for (const problema of problemas) console.error(`- ${problema}`)
  process.exitCode = 1
} else {
  console.log(
    `Cabeceras de seguridad en orden: vercel.json, ${String(scripts.length)} script(s) en línea cubiertos y todos los orígenes del build en la CSP.`,
  )
}
