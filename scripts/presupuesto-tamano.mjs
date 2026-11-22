#!/usr/bin/env node
// Presupuesto de tamaño del build (#149): mide apps/web/dist y falla si el
// JavaScript inicial, el CSS o el total precacheado por el service worker
// superan los límites de apps/web/presupuesto-tamano.json.
//
//   npm run build:medicion   # build como producción, con valores ficticios
//   npm run presupuesto      # compara con el presupuesto
//   npm run presupuesto -- --actualizar   # fija el presupuesto en lo medido
//
// El build tiene que ser el de build:medicion: con otro ambiente cambian los
// chunks (la muestra y el diagnóstico solo existen fuera de producción, y el
// de Sentry solo con DSN). Ver docs/medicion-de-carga.md.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  compararConPresupuesto,
  formatearKiB,
  medirBuild,
  presupuestoDesde,
} from './medicion/presupuesto.mjs'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(RAIZ, 'apps/web/dist')
const PRESUPUESTO = path.join(RAIZ, 'apps/web/presupuesto-tamano.json')
const MARGEN = 0.05

function principal(argumentos) {
  if (!existsSync(path.join(DIST, 'index.html'))) {
    console.error(
      'No hay build en apps/web/dist. Ejecuta antes npm run build:medicion.',
    )
    return 1
  }
  const { metricas, archivos } = medirBuild(DIST)

  if (argumentos.includes('--actualizar')) {
    // Fecha local (AAAA-MM-DD), no la UTC.
    const fecha = new Date().toLocaleDateString('sv-SE')
    const nuevo = presupuestoDesde(metricas, MARGEN, fecha)
    writeFileSync(PRESUPUESTO, `${JSON.stringify(nuevo, null, 2)}\n`)
    console.log(
      `Presupuesto actualizado en ${path.relative(RAIZ, PRESUPUESTO)}.`,
    )
  }

  const presupuesto = JSON.parse(readFileSync(PRESUPUESTO, 'utf8'))
  const filas = compararConPresupuesto(metricas, presupuesto)

  console.log(`JavaScript inicial: ${archivos.jsInicial.join(', ')}`)
  console.log(`CSS inicial: ${archivos.css.join(', ')}`)
  console.log(`Precaché: ${archivos.precache.length} archivos`)
  console.log('')
  for (const fila of filas) {
    const uso = ((fila.valor / fila.limite) * 100).toFixed(1)
    console.log(
      `${fila.dentro ? 'ok   ' : 'FALLA'} ${fila.nombre}: ${formatearKiB(fila.valor)} (${fila.valor} B) de ${formatearKiB(fila.limite)} (${uso} %)`,
    )
  }

  const fuera = filas.filter((fila) => !fila.dentro)
  if (fuera.length > 0) {
    console.error(
      `\nEl build supera el presupuesto de tamaño en: ${fuera.map((fila) => fila.nombre).join('; ')}.` +
        '\nSi el aumento es intencionado y está justificado, fija el nuevo valor con' +
        ' npm run presupuesto -- --actualizar y explica el motivo en el PR.',
    )
    return 1
  }
  return 0
}

process.exitCode = principal(process.argv.slice(2))
