#!/usr/bin/env node
// Build de las pruebas de extremo a extremo (#148): la app construida como
// producción con los valores ficticios de scripts/medicion/entorno.mjs y Clerk
// sustituido (apps/web/medicion/vite.config.e2e.ts). No contacta con ningún
// servicio ni toca apps/web/dist.
//
//   npm run build:e2e
//
// Deja el resultado en apps/web/dist-medicion/e2e, que sirve
// scripts/servir-e2e.mjs.

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { entornoDeBuild } from './medicion/entorno.mjs'

const WEB = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../apps/web',
)

const resultado = spawnSync(
  'npx',
  ['vite', 'build', '--config', 'medicion/vite.config.e2e.ts'],
  {
    cwd: WEB,
    env: entornoDeBuild(),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
)
process.exitCode = resultado.status ?? 1
