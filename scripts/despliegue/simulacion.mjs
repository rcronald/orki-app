// Lee la salida de `node scripts/supabase-db.mjs aplicar --dry-run` (la simulación de
// `supabase db push`) y escribe en Markdown la lista de migraciones pendientes para
// $GITHUB_STEP_SUMMARY, y `pendientes=si|no|desconocido` en $GITHUB_OUTPUT.
//
// Al resumen solo pasan nombres de archivo de migración validados con una expresión estricta,
// nunca la salida tal cual: así no puede llegar a él nada que la CLI imprima por su cuenta.
// Si la salida no se entiende (otra versión de la CLI, un error), el resultado es
// «desconocido», que el workflow trata como si hubiera pendientes: hace la copia del esquema
// igualmente.
//
// Uso (en el workflow): node scripts/despliegue/simulacion.mjs
//   Variables: SALIDA (ruta del archivo con la salida de la simulación), AMBIENTE,
//   GITHUB_STEP_SUMMARY y GITHUB_OUTPUT.

import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { escritorDeResumen } from './disparar.mjs'

// La CLI escribe «Remote database is up to date.» si no hay nada que aplicar, y «Would push
// these migrations:» seguido de los nombres si lo hay (supabase 3.x).
const AL_DIA = /\bdatabase is up to date\./
const CABECERA = /Would push these migrations:/
const MIGRACION = /\b(\d{14}_[a-z0-9_]+\.sql)\b/g

/**
 * @param {string} salida
 * @returns {{ estado: 'no' } | { estado: 'si', migraciones: string[] } | { estado: 'desconocido' }}
 */
export function leerSimulacion(salida) {
  const inicio = salida.search(CABECERA)
  if (inicio >= 0) {
    const migraciones = [
      ...new Set(
        [...salida.slice(inicio).matchAll(MIGRACION)].map((m) => m[1]),
      ),
    ]
    if (migraciones.length > 0) return { estado: 'si', migraciones }
    return { estado: 'desconocido' }
  }
  if (AL_DIA.test(salida)) return { estado: 'no' }
  return { estado: 'desconocido' }
}

/**
 * @param {ReturnType<typeof leerSimulacion>} resultado
 * @param {string} ambiente
 */
export function resumenSimulacion(resultado, ambiente) {
  const lineas = [`## Migraciones pendientes en ${ambiente}`, '']
  if (resultado.estado === 'no') {
    lineas.push('Ninguna: la base de datos ya está al día.')
  } else if (resultado.estado === 'si') {
    const n = resultado.migraciones.length
    lineas.push(
      n === 1
        ? 'Se va a aplicar esta migración, en este orden:'
        : `Se van a aplicar estas ${n} migraciones, en este orden:`,
      '',
      ...resultado.migraciones.map((m) => `1. \`${m}\``),
    )
  } else {
    lineas.push(
      'No se pudo leer la lista en la salida de la simulación (ver el registro del paso). Se hace la copia del esquema como si hubiera migraciones pendientes.',
    )
  }
  return `${lineas.join('\n')}\n\n`
}

/** @param {Record<string, string | undefined>} entorno */
export function principal(entorno, escribir = escritorDeResumen(entorno)) {
  const ruta = entorno.SALIDA ?? ''
  const ambiente = entorno.AMBIENTE ?? '?'
  const salida = ruta && existsSync(ruta) ? readFileSync(ruta, 'utf8') : ''
  const resultado = leerSimulacion(salida)
  escribir(resumenSimulacion(resultado, ambiente))
  if (entorno.GITHUB_OUTPUT) {
    appendFileSync(entorno.GITHUB_OUTPUT, `pendientes=${resultado.estado}\n`)
  }
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = principal(process.env)
}
