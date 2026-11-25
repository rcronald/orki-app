import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import { leerSimulacion, principal, resumenSimulacion } from './simulacion.mjs'

// Salidas con la forma de supabase 3.x (`db push --dry-run` tras `supabase link`).
const CON_PENDIENTES = `Finished supabase link.
DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Would push these migrations:
 • 20261201120000_nueva_columna.sql
 • 20261202090000_otra_tabla.sql
`
const AL_DIA = `Finished supabase link.
DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Remote database is up to date.
`

describe('leerSimulacion', () => {
  test('lista las migraciones pendientes en orden', () => {
    assert.deepEqual(leerSimulacion(CON_PENDIENTES), {
      estado: 'si',
      migraciones: [
        '20261201120000_nueva_columna.sql',
        '20261202090000_otra_tabla.sql',
      ],
    })
  })

  test('sin pendientes, la base está al día', () => {
    assert.deepEqual(leerSimulacion(AL_DIA), { estado: 'no' })
  })

  test('una salida que no se entiende es «desconocido», no «al día»', () => {
    assert.deepEqual(leerSimulacion(''), { estado: 'desconocido' })
    assert.deepEqual(leerSimulacion('Error: failed to connect to postgres'), {
      estado: 'desconocido',
    })
    assert.deepEqual(leerSimulacion('Would push these migrations:\n'), {
      estado: 'desconocido',
    })
  })

  test('solo toma nombres de migración, no otras líneas', () => {
    const r = leerSimulacion(
      `${CON_PENDIENTES}postgresql://postgres.x:clave@host/postgres\n • notas.txt\n`,
    )
    assert.equal(r.estado, 'si')
    assert.equal(r.migraciones.length, 2)
  })
})

describe('resumenSimulacion', () => {
  test('con pendientes, una lista numerada', () => {
    const texto = resumenSimulacion(leerSimulacion(CON_PENDIENTES), 'prod')
    assert.ok(texto.startsWith('## Migraciones pendientes en prod'))
    assert.ok(texto.includes('estas 2 migraciones'))
    assert.ok(texto.includes('1. `20261201120000_nueva_columna.sql`'))
  })

  test('una sola, en singular', () => {
    const texto = resumenSimulacion(
      { estado: 'si', migraciones: ['20261201120000_a.sql'] },
      'dev',
    )
    assert.ok(texto.includes('esta migración'))
  })

  test('al día y desconocido', () => {
    assert.ok(resumenSimulacion({ estado: 'no' }, 'prod').includes('al día'))
    assert.ok(
      resumenSimulacion({ estado: 'desconocido' }, 'prod').includes(
        'No se pudo leer',
      ),
    )
  })
})

describe('principal', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'simulacion-'))
  after(() => rmSync(dir, { recursive: true, force: true }))

  test('escribe el resumen y la salida del paso', () => {
    const salida = path.join(dir, 'salida.txt')
    const resumen = path.join(dir, 'resumen.md')
    const output = path.join(dir, 'output.txt')
    writeFileSync(salida, CON_PENDIENTES)
    principal({
      SALIDA: salida,
      AMBIENTE: 'prod',
      GITHUB_STEP_SUMMARY: resumen,
      GITHUB_OUTPUT: output,
    })
    assert.ok(readFileSync(resumen, 'utf8').includes('nueva_columna'))
    assert.equal(readFileSync(output, 'utf8'), 'pendientes=si\n')
  })

  test('sin archivo de salida, «desconocido»', () => {
    const output = path.join(dir, 'output2.txt')
    principal({
      SALIDA: path.join(dir, 'no-existe.txt'),
      AMBIENTE: 'prod',
      GITHUB_STEP_SUMMARY: path.join(dir, 'resumen2.md'),
      GITHUB_OUTPUT: output,
    })
    assert.equal(readFileSync(output, 'utf8'), 'pendientes=desconocido\n')
  })
})
