#!/usr/bin/env node
// Presupuesto de tamaño del build (#149): mide apps/web/dist y falla si el
// JavaScript inicial, el CSS o el total precacheado por el service worker
// superan los límites de apps/web/presupuesto-tamano.json. Informa además,
// sin límite, el precaché con Brotli (#287).
//
//   npm run build:medicion   # build como producción, con valores ficticios
//   npm run presupuesto      # compara con el presupuesto
//   npm run presupuesto -- --bajar        # baja los límites que el build permite
//   npm run presupuesto -- --actualizar   # fija el presupuesto en lo medido
//
// --bajar es lo que se usa tras un recorte: solo toca las métricas cuyo
// límite nuevo queda por debajo del actual. --actualizar fija las tres en lo
// medido, también si suben; un PR que sube el presupuesto tiene que traer la
// tabla de qué creció (docs/medicion-de-carga.md). Las dos opciones imprimen
// esa tabla en Markdown.
//
// El build tiene que ser el de build:medicion: con otro ambiente cambian los
// chunks (la muestra y el diagnóstico solo existen fuera de producción, y el
// de Sentry solo con DSN). Ver docs/medicion-de-carga.md.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  compararConPresupuesto,
  filasInformativas,
  formatearKiB,
  medirBuild,
  presupuestoBajado,
  presupuestoDesde,
  tablaDeCambios,
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
  const actualizar = argumentos.includes('--actualizar')
  const bajar = argumentos.includes('--bajar')
  if (actualizar && bajar) {
    console.error('Usa --actualizar o --bajar, no las dos.')
    return 1
  }
  const { metricas, archivos } = medirBuild(DIST)

  if (actualizar || bajar) {
    const anterior = JSON.parse(readFileSync(PRESUPUESTO, 'utf8'))
    // Fecha local (AAAA-MM-DD), no la UTC.
    const fecha = new Date().toLocaleDateString('sv-SE')
    const nuevo = actualizar
      ? presupuestoDesde(metricas, MARGEN, fecha)
      : presupuestoBajado(anterior, metricas, fecha)
    writeFileSync(PRESUPUESTO, `${JSON.stringify(nuevo, null, 2)}\n`)
    console.log(
      `Presupuesto ${actualizar ? 'actualizado' : 'bajado donde se puede'} en ${path.relative(RAIZ, PRESUPUESTO)}. Para el PR:`,
    )
    console.log('')
    console.log(tablaDeCambios(anterior, nuevo, metricas))
    console.log('')
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
  for (const fila of filasInformativas(metricas, presupuesto)) {
    const respecto =
      typeof fila.referencia === 'number'
        ? `; referencia ${fila.referencia} B (${fila.valor - fila.referencia >= 0 ? '+' : ''}${fila.valor - fila.referencia} B)`
        : '; sin referencia'
    console.log(
      `info  ${fila.nombre}: ${formatearKiB(fila.valor)} (${fila.valor} B)${respecto}`,
    )
  }

  const fuera = filas.filter((fila) => !fila.dentro)
  if (fuera.length > 0) {
    console.error(
      `\nEl build supera el presupuesto de tamaño en: ${fuera.map((fila) => fila.nombre).join('; ')}.` +
        '\nSi el aumento es intencionado y está justificado, fija el nuevo valor con' +
        ' npm run presupuesto -- --actualizar y pega en el PR la tabla que imprime,' +
        ' con qué creció (docs/medicion-de-carga.md).',
    )
    return 1
  }
  return 0
}

process.exitCode = principal(process.argv.slice(2))
