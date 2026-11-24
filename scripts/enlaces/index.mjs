#!/usr/bin/env node
// Comprueba que los enlaces relativos de todos los .md del repositorio (los
// versionados y los nuevos que git no ignora) apuntan a un archivo y, si
// llevan #ancla, a una sección que existen (#288). Lo usa el CI.
//
//   npm run enlaces
//
// Sale con 1 y lista cada enlace roto con su archivo y su línea.

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { comprobarEnlaces } from './enlaces.mjs'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const archivos = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '*.md'],
  { cwd: RAIZ, encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean)

const rotos = comprobarEnlaces(RAIZ, archivos)
if (rotos.length === 0) {
  console.log(`Enlaces relativos: ${archivos.length} documentos, ninguno roto.`)
} else {
  for (const { archivo, linea, destino, motivo } of rotos) {
    console.error(`${archivo}:${linea}: ${destino} (${motivo})`)
  }
  console.error(
    `\n${rotos.length} enlaces rotos. Corrige la ruta o el ancla (el texto del encabezado en minúsculas, sin signos y con guiones).`,
  )
  process.exitCode = 1
}
