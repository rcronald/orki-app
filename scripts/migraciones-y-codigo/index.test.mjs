import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import {
  ETIQUETA_EXCEPCION,
  comprobar,
  informe,
  leerArchivos,
  leerEtiquetas,
  principal,
} from './index.mjs'

const MIGRACION = 'supabase/migrations/20261201120000_nueva_columna.sql'

describe('comprobar', () => {
  test('un PR sin migraciones no se comprueba, toque lo que toque', () => {
    const r = comprobar(['apps/web/src/App.tsx', 'README.md'], [])
    assert.equal(r.resultado, 'sin-migraciones')
  })

  test('una migración con sus pruebas, sus tipos y documentación está bien', () => {
    const r = comprobar(
      [
        MIGRACION,
        'supabase/tests/nueva_columna.sql',
        'supabase/README.md',
        'apps/web/src/lib/database.types.ts',
        'apps/web/src/lib/database.ts',
        'apps/web/src/lib/database.test.ts',
      ],
      [],
    )
    assert.equal(r.resultado, 'bien')
    assert.deepEqual(r.codigo, [])
  })

  test('una migración con código de la app falla y nombra los archivos', () => {
    const r = comprobar(
      [
        MIGRACION,
        'apps/web/src/lib/database.types.ts',
        'apps/web/src/collection/model.ts',
        'apps/web/src/lib/supabase.ts',
      ],
      [],
    )
    assert.equal(r.resultado, 'mezcla')
    assert.deepEqual(r.codigo, [
      'apps/web/src/collection/model.ts',
      'apps/web/src/lib/supabase.ts',
    ])
  })

  test('solo cuenta apps/web/src: las pruebas de extremo a extremo no son código de la app', () => {
    const r = comprobar([MIGRACION, 'apps/web/e2e/coleccion.spec.ts'], [])
    assert.equal(r.resultado, 'bien')
  })

  test('borrar una migración también cuenta como tocarla', () => {
    // git diff --no-renames da la ruta borrada, no solo la nueva.
    const r = comprobar(
      ['supabase/migrations/20261101000000_vieja.sql', 'apps/web/src/App.tsx'],
      [],
    )
    assert.equal(r.resultado, 'mezcla')
  })

  test('la etiqueta de excepción la salta', () => {
    const r = comprobar(
      [MIGRACION, 'apps/web/src/App.tsx'],
      ['documentación', ETIQUETA_EXCEPCION],
    )
    assert.equal(r.resultado, 'excepcion')
  })

  test('la etiqueta se reconoce con la tilde compuesta o precompuesta', () => {
    const descompuesta = ETIQUETA_EXCEPCION.normalize('NFD')
    assert.notEqual(descompuesta, ETIQUETA_EXCEPCION)
    const r = comprobar([MIGRACION, 'apps/web/src/App.tsx'], [descompuesta])
    assert.equal(r.resultado, 'excepcion')
  })

  test('otra etiqueta parecida no la salta', () => {
    const r = comprobar(
      [MIGRACION, 'apps/web/src/App.tsx'],
      ['migracion con codigo', 'migración'],
    )
    assert.equal(r.resultado, 'mezcla')
  })
})

describe('leer las entradas', () => {
  test('los archivos se leen uno por línea, sin vacías ni repetidos', () => {
    assert.deepEqual(leerArchivos('a\r\n\nb\n a \n'), ['a', 'b'])
  })

  test('las etiquetas llegan en JSON; lo que no lo es cuenta como ninguna', () => {
    assert.deepEqual(leerEtiquetas('["a", 3, "b"]'), ['a', 'b'])
    assert.deepEqual(leerEtiquetas(''), [])
    assert.deepEqual(leerEtiquetas('null'), [])
    assert.deepEqual(leerEtiquetas('no es json'), [])
  })
})

describe('informe', () => {
  test('la mezcla da un error con la etiqueta que la salta', () => {
    const r = informe(comprobar([MIGRACION, 'apps/web/src/App.tsx'], []))
    assert.equal(r.codigo, 1)
    assert.match(r.registro[0], /^::error::/)
    assert.ok(r.registro[0].includes(`«${ETIQUETA_EXCEPCION}»`))
    assert.ok(r.resumen.includes('`apps/web/src/App.tsx`'))
  })

  test('la excepción pasa, pero deja un aviso visible', () => {
    const r = informe(
      comprobar([MIGRACION, 'apps/web/src/App.tsx'], [ETIQUETA_EXCEPCION]),
    )
    assert.equal(r.codigo, 0)
    assert.match(r.registro[0], /^::warning::Excepción/)
    assert.ok(r.resumen.includes('`apps/web/src/App.tsx`'))
  })

  test('una lista larga se corta en el resumen', () => {
    const codigo = Array.from({ length: 25 }, (_, i) => `apps/web/src/a${i}.ts`)
    const r = informe(comprobar([MIGRACION, ...codigo], []))
    assert.ok(r.resumen.includes('- y 5 más'))
  })
})

describe('principal', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'migraciones-y-codigo-'))
  after(() => rmSync(dir, { recursive: true, force: true }))

  test('lee los archivos y las etiquetas del entorno y escribe el resumen', () => {
    const archivos = path.join(dir, 'archivos.txt')
    const resumen = path.join(dir, 'resumen.md')
    writeFileSync(archivos, `${MIGRACION}\napps/web/src/App.tsx\n`)
    const registro = []
    const codigo = principal(
      {
        ARCHIVOS: archivos,
        ETIQUETAS: '[]',
        GITHUB_STEP_SUMMARY: resumen,
      },
      (l) => registro.push(l),
    )
    assert.equal(codigo, 1)
    assert.match(registro[0], /^::error::/)
    assert.match(readFileSync(resumen, 'utf8'), /\*\*Falla\.\*\*/)
  })

  test('sin ARCHIVOS falla', () => {
    assert.equal(
      principal({}, () => {}),
      1,
    )
  })
})
