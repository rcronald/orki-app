#!/usr/bin/env node
// Sirve el build de las pruebas de extremo a extremo (#148) como lo sirve
// Vercel, con el servidor de la medición de la carga (scripts/medicion/
// servidor.mjs): los archivos tal cual, cualquier otra ruta con index.html y
// compresión Brotli. Lo arranca Playwright (webServer en
// apps/web/playwright.config.ts); no hace falta lanzarlo a mano.
//
//   node scripts/servir-e2e.mjs [puerto]

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { servirCarpeta } from './medicion/servidor.mjs'

const CARPETA = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../apps/web/dist-medicion/e2e',
)

if (!existsSync(path.join(CARPETA, 'index.html'))) {
  console.error(
    `No está el build de las pruebas en ${CARPETA}. Ejecuta antes npm run build:e2e.`,
  )
  process.exit(1)
}

const puerto = Number(process.argv[2] ?? 4317)
const { url } = await servirCarpeta(CARPETA, { puerto })
console.log(`Build de las pruebas servido en ${url}`)
