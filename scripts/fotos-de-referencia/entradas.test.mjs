import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, describe, test } from 'node:test'
import { validarEntradas } from './entradas.mjs'

const REF_DEV = 'xaitolsnmjlpyptntfwi'
const REF_PROD = 'fzundhfxnbyjbxyhkgtg'
const POOLER = 'aws-0-us-east-1.pooler.supabase.com'

function entradas(cambios = {}) {
  return {
    AMBIENTE: 'dev',
    MODO: 'simular',
    GENEROS: '',
    MAX_ESPECIES: '',
    TODO_EL_CATALOGO: 'false',
    ALTERNATIVAS: 'taxon',
    LIMPIAR: 'no',
    REF_GIT: 'refs/heads/una-rama',
    REF_PROYECTO: REF_DEV,
    POOLER_HOST: POOLER,
    ...cambios,
  }
}

function errores(cambios) {
  const resultado = validarEntradas(entradas(cambios))
  assert.equal(resultado.ok, false)
  return resultado.errores.join('\n')
}

describe('validarEntradas: argumentos', () => {
  test('por defecto simula en dev con el alcance de la orden y sin limpieza', () => {
    assert.deepEqual(validarEntradas(entradas()), {
      ok: true,
      carga: ['--ambiente', 'dev', '--alternativas', 'taxon'],
      limpieza: null,
      alcance:
        'el de la orden (especies en alguna colección y los ocho géneros comunes)',
    })
  })

  test('los géneros se separan por comas, sin espacios alrededor y sin repetidos', () => {
    const r = validarEntradas(
      entradas({
        GENEROS: ' Phalaenopsis, Masdevallia ,phalaenopsis',
        MAX_ESPECIES: '40',
      }),
    )
    assert.deepEqual(r.carga, [
      '--ambiente',
      'dev',
      '--genero',
      'Phalaenopsis',
      '--genero',
      'Masdevallia',
      '--max-especies',
      '40',
      '--alternativas',
      'taxon',
    ])
    assert.equal(
      r.alcance,
      'géneros Phalaenopsis, Masdevallia, como mucho 40 especies',
    )
  })

  test('acepta guiones entre letras', () => {
    assert.ok(validarEntradas(entradas({ GENEROS: 'Abc-Def' })).ok)
  })

  test('todo el catálogo con observaciones', () => {
    const r = validarEntradas(
      entradas({ TODO_EL_CATALOGO: 'true', ALTERNATIVAS: 'observaciones' }),
    )
    assert.deepEqual(r.carga, [
      '--ambiente',
      'dev',
      '--todo-el-catalogo',
      '--alternativas',
      'observaciones',
    ])
    assert.equal(r.alcance, 'todo el catálogo')
  })

  test('escribir en dev no lleva confirmación', () => {
    const r = validarEntradas(entradas({ MODO: 'escribir', LIMPIAR: 'listar' }))
    assert.deepEqual(r.carga, [
      '--ambiente',
      'dev',
      '--alternativas',
      'taxon',
      '--escribir',
    ])
    assert.deepEqual(r.limpieza, ['--ambiente', 'dev'])
  })

  test('escribir y borrar en producción confirman con la referencia del environment', () => {
    const r = validarEntradas(
      entradas({
        AMBIENTE: 'prod',
        MODO: 'escribir',
        LIMPIAR: 'borrar',
        REF_GIT: 'refs/heads/main',
        REF_PROYECTO: REF_PROD,
      }),
    )
    assert.deepEqual(r.carga, [
      '--ambiente',
      'prod',
      '--alternativas',
      'taxon',
      '--escribir',
      '--confirmar-produccion',
      REF_PROD,
    ])
    assert.deepEqual(r.limpieza, [
      '--ambiente',
      'prod',
      '--borrar',
      '--confirmar-produccion',
      REF_PROD,
    ])
  })

  test('simular en producción no pasa la confirmación', () => {
    const r = validarEntradas(
      entradas({
        AMBIENTE: 'prod',
        REF_GIT: 'refs/heads/main',
        REF_PROYECTO: REF_PROD,
      }),
    )
    assert.deepEqual(r.carga, ['--ambiente', 'prod', '--alternativas', 'taxon'])
  })
})

describe('validarEntradas: rechazos', () => {
  test('producción solo desde main', () => {
    assert.match(
      errores({ AMBIENTE: 'prod', REF_PROYECTO: REF_PROD }),
      /Producción solo se carga desde main/,
    )
  })

  test('géneros con caracteres que no son letras ni guiones', () => {
    for (const malo of [
      'Phalaenopsis;rm -rf /',
      '$(id)',
      'Cattleya`id`',
      'Vanda --escribir',
      '--escribir',
      'Onci dium',
      'Phalaenopsis\nMasdevallia',
      '-Vanda',
      'Vanda-',
      '×Vanda',
      'Phalaenopsis,,Vanda',
      'Phalaenopsis,',
    ]) {
      assert.match(errores({ GENEROS: malo }), /Género no válido/, malo)
    }
  })

  test('el mensaje de un género rechazado no puede llevar comandos de flujo de trabajo', () => {
    const mensaje = errores({ GENEROS: '::add-mask::x\n::error::y' })
    assert.doesNotMatch(mensaje, /::/)
    assert.doesNotMatch(mensaje, /\n.*\n/)
  })

  test('max_especies tiene que ser un entero positivo', () => {
    for (const malo of [
      '0',
      '-5',
      '1.5',
      '1e3',
      ' 2 3',
      '10;id',
      '0x10',
      '01',
      '9999999',
    ]) {
      assert.match(
        errores({ MAX_ESPECIES: malo }),
        /max_especies no válido/,
        malo,
      )
    }
  })

  test('valores fuera de las listas cerradas', () => {
    assert.match(errores({ AMBIENTE: 'local' }), /Ambiente no válido/)
    assert.match(errores({ MODO: 'escribir --x' }), /Modo no válido/)
    assert.match(errores({ ALTERNATIVAS: 'todas' }), /alternativas no válido/)
    assert.match(errores({ LIMPIAR: 'si' }), /limpiar no válido/)
    assert.match(
      errores({ TODO_EL_CATALOGO: 'sí' }),
      /todo_el_catalogo no válido/,
    )
  })

  test('todo el catálogo y géneros a la vez', () => {
    assert.match(
      errores({ TODO_EL_CATALOGO: 'true', GENEROS: 'Vanda' }),
      /no se pueden usar juntos/,
    )
  })

  test('borrar solo al escribir', () => {
    assert.match(
      errores({ LIMPIAR: 'borrar' }),
      /solo se admite con modo = escribir/,
    )
  })

  test('faltan las variables del environment', () => {
    const texto = errores({ REF_PROYECTO: '', POOLER_HOST: 'db.x.supabase.co' })
    assert.match(texto, /SUPABASE_PROJECT_REF del environment dev/)
    assert.match(texto, /SUPABASE_POOLER_HOST del environment dev/)
  })

  test('devuelve todos los errores a la vez', () => {
    const r = validarEntradas(
      entradas({ MODO: 'x', MAX_ESPECIES: 'x', GENEROS: '1' }),
    )
    assert.equal(r.errores.length, 3)
  })
})

describe('entradas.mjs como orden', () => {
  const carpeta = mkdtempSync(path.join(tmpdir(), 'fotos-de-referencia-'))
  after(() => rmSync(carpeta, { recursive: true, force: true }))
  const script = fileURLToPath(new URL('./entradas.mjs', import.meta.url))

  function ejecutar(cambios) {
    const rutas = {
      ARGUMENTOS_CARGA: path.join(carpeta, 'carga.txt'),
      ARGUMENTOS_LIMPIEZA: path.join(carpeta, 'limpieza.txt'),
      GITHUB_OUTPUT: path.join(carpeta, 'salida.txt'),
    }
    rmSync(rutas.GITHUB_OUTPUT, { force: true })
    const r = spawnSync(process.execPath, [script], {
      env: { ...entradas(cambios), ...rutas },
      encoding: 'utf8',
    })
    return { ...r, rutas }
  }

  test('escribe un argumento por línea y las salidas del paso', () => {
    const r = ejecutar({
      GENEROS: 'Vanda',
      MODO: 'escribir',
      LIMPIAR: 'listar',
    })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.equal(
      readFileSync(r.rutas.ARGUMENTOS_CARGA, 'utf8'),
      '--ambiente\ndev\n--genero\nVanda\n--alternativas\ntaxon\n--escribir\n',
    )
    assert.equal(
      readFileSync(r.rutas.ARGUMENTOS_LIMPIEZA, 'utf8'),
      '--ambiente\ndev\n',
    )
    assert.equal(
      readFileSync(r.rutas.GITHUB_OUTPUT, 'utf8'),
      'limpiar=listar\nalcance=géneros Vanda\n',
    )
  })

  test('con un error sale con 1 y lo anota como error del flujo de trabajo', () => {
    const r = ejecutar({ MAX_ESPECIES: 'diez' })
    assert.equal(r.status, 1)
    assert.match(r.stdout, /^::error::max_especies no válido/m)
  })
})
