#!/usr/bin/env node
// Build de las pruebas de extremo a extremo (#148): la app construida como
// producción con los valores ficticios de scripts/medicion/entorno.mjs y Clerk
// sustituido (apps/web/medicion/vite.config.e2e.ts). No contacta con ningún
// servicio ni toca apps/web/dist.
//
//   npm run build:e2e
//
// Deja el resultado en apps/web/dist-medicion/e2e, que sirve
// scripts/servir-e2e.mjs, y a la vez, en paralelo, la «versión B» en
// apps/web/dist-medicion/e2e-b (#278): el mismo build con un texto de los
// créditos cambiado, para la prueba de la actualización tras un despliegue
// (apps/web/e2e/actualizacion.spec.ts; ver apps/web/medicion/version-b.ts).

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { entornoDeBuild } from './medicion/entorno.mjs'

const WEB = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../apps/web',
)

function construir(version) {
  return new Promise((resolver) => {
    const proceso = spawn(
      'npx',
      ['vite', 'build', '--config', 'medicion/vite.config.e2e.ts'],
      {
        cwd: WEB,
        env: {
          ...entornoDeBuild(),
          ...(version !== undefined && { ORKI_E2E_VERSION: version }),
        },
        // B en silencio salvo errores: la salida de A es la que se lee.
        stdio:
          version === undefined ? 'inherit' : ['ignore', 'ignore', 'inherit'],
        shell: process.platform === 'win32',
      },
    )
    proceso.on('close', (codigo) => resolver(codigo ?? 1))
  })
}

const [a, b] = await Promise.all([construir(), construir('b')])
if (b !== 0)
  console.error('Falló el build de la versión B (dist-medicion/e2e-b).')
process.exitCode = a !== 0 ? a : b
