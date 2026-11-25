import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import {
  INTENTOS,
  PREFIJO_HOOK,
  comprobarUrl,
  dispararDespliegue,
  principal,
} from './disparar.mjs'

// Una URL con la forma de un Deploy Hook; no existe.
const HOOK = `${PREFIJO_HOOK}prj_ficticio000000000000000/hookficticio`

function respuesta(status, cuerpo) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => {
      if (cuerpo === undefined) throw new SyntaxError('no es JSON')
      return cuerpo
    },
  }
}

function falsoFetch(respuestas) {
  const llamadas = []
  const fn = async (url, init) => {
    llamadas.push({ url: String(url), metodo: init?.method })
    const r = respuestas.shift()
    if (r instanceof Error) throw r
    return r
  }
  return { fn, llamadas }
}

const sinEspera = async () => {}

describe('comprobarUrl', () => {
  test('sin secreto, dice qué crear y dónde', () => {
    for (const valor of [undefined, '', '   ']) {
      const error = comprobarUrl(valor)
      assert.ok(error.includes('VERCEL_DEPLOY_HOOK_URL'))
      assert.ok(error.includes('environment prod'))
      assert.ok(error.includes('Deploy Hooks'))
      assert.ok(
        error.includes('gh secret set VERCEL_DEPLOY_HOOK_URL --env prod'),
      )
    }
  })

  test('una URL que no es de un Deploy Hook se rechaza sin mostrarla', () => {
    const error = comprobarUrl('https://ejemplo.invalid/secreto-123')
    assert.ok(error.includes(PREFIJO_HOOK))
    assert.ok(!error.includes('secreto-123'))
  })

  test('una URL de Deploy Hook vale, también con espacios alrededor', () => {
    assert.equal(comprobarUrl(HOOK), null)
    assert.equal(comprobarUrl(` ${HOOK}\n`), null)
  })
})

describe('dispararDespliegue', () => {
  test('hace un POST y devuelve el código y el estado', async () => {
    const f = falsoFetch([respuesta(201, { job: { state: 'PENDING' } })])
    const r = await dispararDespliegue(HOOK, {
      fetch: f.fn,
      esperar: sinEspera,
      registro: () => {},
    })
    assert.deepEqual(r, { ok: true, codigo: 201, estado: 'PENDING' })
    assert.deepEqual(f.llamadas, [{ url: HOOK, metodo: 'POST' }])
  })

  test('un cuerpo que no es JSON o un estado raro no importan', async () => {
    const f = falsoFetch([
      respuesta(200),
      respuesta(200, { job: { state: '<script>' } }),
    ])
    const opciones = { fetch: f.fn, esperar: sinEspera, registro: () => {} }
    assert.deepEqual(await dispararDespliegue(HOOK, opciones), {
      ok: true,
      codigo: 200,
      estado: null,
    })
    assert.equal((await dispararDespliegue(HOOK, opciones)).estado, null)
  })

  test('reintenta un 5xx y un error de red, sin mostrar la URL', async () => {
    const registro = []
    const f = falsoFetch([
      respuesta(502),
      new TypeError(`fetch failed ${HOOK}`),
      respuesta(201, { job: { state: 'PENDING' } }),
    ])
    const r = await dispararDespliegue(HOOK, {
      fetch: f.fn,
      esperar: sinEspera,
      registro: (l) => registro.push(l),
    })
    assert.equal(r.ok, true)
    assert.equal(f.llamadas.length, 3)
    assert.equal(registro.length, 2)
    assert.ok(registro.every((l) => !l.includes('hookficticio')))
  })

  test(`deja de intentar a las ${INTENTOS}`, async () => {
    const f = falsoFetch(Array.from({ length: 5 }, () => respuesta(503)))
    const r = await dispararDespliegue(HOOK, {
      fetch: f.fn,
      esperar: sinEspera,
      registro: () => {},
    })
    assert.deepEqual(r, { ok: false, codigo: 503, estado: null })
    assert.equal(f.llamadas.length, INTENTOS)
  })

  test('un 404 (hook borrado) no se reintenta', async () => {
    const f = falsoFetch([respuesta(404), respuesta(201)])
    const r = await dispararDespliegue(HOOK, {
      fetch: f.fn,
      esperar: sinEspera,
      registro: () => {},
    })
    assert.deepEqual(r, { ok: false, codigo: 404, estado: null })
    assert.equal(f.llamadas.length, 1)
  })
})

describe('principal', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'disparar-'))
  after(() => rmSync(dir, { recursive: true, force: true }))

  test('sin secreto falla con ::error:: y no llama a nada', async () => {
    const registro = []
    const f = falsoFetch([])
    const codigo = await principal(
      {},
      {
        fetch: f.fn,
        registro: (l) => registro.push(l),
        escribir: () => {},
      },
    )
    assert.equal(codigo, 1)
    assert.match(
      registro[0],
      /^::error::Falta el secreto VERCEL_DEPLOY_HOOK_URL/,
    )
    assert.equal(f.llamadas.length, 0)
  })

  test('deja en el resumen el código HTTP, nunca la URL', async () => {
    const resumen = path.join(dir, 'resumen.md')
    const output = path.join(dir, 'output.txt')
    const registro = []
    const codigo = await principal(
      {
        VERCEL_DEPLOY_HOOK_URL: HOOK,
        GITHUB_STEP_SUMMARY: resumen,
        GITHUB_OUTPUT: output,
      },
      {
        fetch: falsoFetch([respuesta(201, { job: { state: 'PENDING' } })]).fn,
        registro: (l) => registro.push(l),
        esperar: sinEspera,
      },
    )
    assert.equal(codigo, 0)
    const texto = readFileSync(resumen, 'utf8')
    assert.ok(texto.includes('HTTP 201'))
    assert.ok(!texto.includes('hookficticio'))
    assert.equal(readFileSync(output, 'utf8'), 'codigo=201\n')
    // La única línea con la URL es la orden que la enmascara.
    const conUrl = registro.filter((l) => l.includes('hookficticio'))
    assert.deepEqual(conUrl, [`::add-mask::${HOOK}`])
  })

  test('un rechazo de Vercel falla y lo deja en el resumen', async () => {
    const textos = []
    const registro = []
    const codigo = await principal(
      { VERCEL_DEPLOY_HOOK_URL: HOOK },
      {
        fetch: falsoFetch([respuesta(404)]).fn,
        registro: (l) => registro.push(l),
        escribir: (t) => textos.push(t),
        esperar: sinEspera,
      },
    )
    assert.equal(codigo, 1)
    assert.ok(textos.join('').includes('No se disparó'))
    assert.ok(textos.join('').includes('HTTP 404'))
    assert.ok(registro.some((l) => l.startsWith('::error::')))
  })
})
