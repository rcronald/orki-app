import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

// Cadena de suministro (#294): cada acción de los workflows va fijada a un
// SHA de commit, con la versión en un comentario. Una etiqueta (v7) la puede
// mover quien controle el repositorio de la acción, y varios jobs reciben
// secretos de producción. Dependabot actualiza el SHA y el comentario.

const DIRECTORIO = join(import.meta.dirname, '..', '.github', 'workflows')
const FIJADA = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+(\.\d+){0,2}$/

function usos() {
  const encontrados = []
  for (const archivo of readdirSync(DIRECTORIO)) {
    if (!/\.ya?ml$/.test(archivo)) continue
    const lineas = readFileSync(join(DIRECTORIO, archivo), 'utf8').split('\n')
    lineas.forEach((linea, indice) => {
      const uso = /^\s*(?:-\s*)?uses:\s*(.+?)\s*$/.exec(linea)
      if (uso)
        encontrados.push({ donde: `${archivo}:${indice + 1}`, uso: uso[1] })
    })
  }
  return encontrados
}

test('hay acciones que comprobar', () => {
  assert.ok(usos().length > 0)
})

test('cada acción va fijada a un SHA con su versión en un comentario', () => {
  const sueltas = usos()
    // Una acción del propio repositorio (./ruta) va con el commit del workflow.
    .filter(({ uso }) => !uso.startsWith('./'))
    .filter(({ uso }) => !FIJADA.test(uso))
    .map(({ donde, uso }) => `${donde}: ${uso}`)
  assert.deepEqual(sueltas, [])
})
