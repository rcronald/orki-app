#!/usr/bin/env node
// Build de la app "como producción" con valores ficticios (#149), sin
// contactar con ningún servicio: el que miden el presupuesto de tamaño y
// Lighthouse. Ver scripts/medicion/entorno.mjs y docs/medicion-de-carga.md.
//
//   npm run build:medicion
//
// Deja el resultado en apps/web/dist, como npm run build.

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { entornoDeBuild } from './medicion/entorno.mjs'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const resultado = spawnSync('npm', ['run', 'build'], {
  cwd: RAIZ,
  env: entornoDeBuild(),
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
process.exitCode = resultado.status ?? 1
