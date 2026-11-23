import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  comprobarPublicado,
  esperarVersion,
  leerConfiguracion,
  leerScriptPrincipal,
  leerVersion,
  principal,
} from './humo.mjs'

const COMMIT = 'a'.repeat(40)
const OTRO = 'b'.repeat(40)
const REF = 'abcdefghijklmnopqrst'
const ENTORNO = {
  APP_URL: 'https://app.ejemplo.invalid',
  SUPABASE_PROJECT_REF: REF,
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_ficticia',
  COMMIT,
  HUMO_ESPERA_MAXIMA_S: '60',
  HUMO_INTERVALO_S: '15',
}

const html = (version) =>
  `<!doctype html><html><head><meta charset="UTF-8" />${
    version ? `<meta name="orki-release" content="${version}">` : ''
  }<script type="module" crossorigin src="/assets/index-Abc123.js"></script></head><body><div id="root"></div></body></html>`

function respuesta(status, cuerpo) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => cuerpo ?? '',
    json: async () =>
      typeof cuerpo === 'string' ? JSON.parse(cuerpo) : cuerpo,
  }
}

/** Un servidor falso: la portada sirve cada versión de `portadas` por turno. */
function servidor({ portadas, script = 200, rpc = [200, []] }) {
  const llamadas = []
  const fn = async (url, init = {}) => {
    const u = new URL(String(url))
    llamadas.push({ url: u, init })
    if (u.hostname === `${REF}.supabase.co`) return respuesta(rpc[0], rpc[1])
    if (u.pathname.startsWith('/assets/')) return respuesta(script)
    const siguiente = portadas.length > 1 ? portadas.shift() : portadas[0]
    if (siguiente instanceof Error) throw siguiente
    return respuesta(200, html(siguiente))
  }
  return { fn, llamadas }
}

function reloj() {
  let t = 0
  return {
    ahora: () => t,
    esperar: async (ms) => {
      t += ms
    },
  }
}

describe('leer la portada', () => {
  test('lee la versión de la etiqueta meta', () => {
    assert.equal(leerVersion(html(COMMIT)), COMMIT)
    assert.equal(
      leerVersion(`<meta content="ABCDEF1" name='orki-release'>`),
      'abcdef1',
    )
    assert.equal(leerVersion(html(null)), null)
    assert.equal(leerVersion('<meta name="orki-release" content="">'), null)
  })

  test('encuentra el script principal', () => {
    assert.equal(leerScriptPrincipal(html(COMMIT)), '/assets/index-Abc123.js')
    assert.equal(
      leerScriptPrincipal('<script src="/assets/x.js"></script>'),
      null,
    )
  })
})

describe('leerConfiguracion', () => {
  test('sin APP_URL o sin clave, se omite (no falla)', () => {
    const r = leerConfiguracion({ ...ENTORNO, APP_URL: '' })
    assert.equal(r.ok, false)
    assert.equal(r.omitir, true)
    assert.ok(r.mensaje.includes('APP_URL'))
    const r2 = leerConfiguracion({
      ...ENTORNO,
      APP_URL: '',
      SUPABASE_PUBLISHABLE_KEY: '',
    })
    assert.ok(r2.mensaje.includes('faltan las variables'))
  })

  test('una configuración mala sí falla', () => {
    for (const cambio of [
      { APP_URL: 'no es una url' },
      { APP_URL: 'http://app.ejemplo.invalid' },
      { SUPABASE_PROJECT_REF: 'otro' },
      { COMMIT: 'abc' },
    ]) {
      const r = leerConfiguracion({ ...ENTORNO, ...cambio })
      assert.equal(r.ok, false)
      assert.equal(r.omitir, false)
    }
  })

  test('la URL de Supabase sale del identificador del proyecto', () => {
    const r = leerConfiguracion(ENTORNO)
    assert.equal(r.ok, true)
    assert.equal(r.supabaseUrl, `https://${REF}.supabase.co`)
  })
})

describe('esperarVersion', () => {
  const config = leerConfiguracion(ENTORNO)

  test('espera hasta que la portada sirve el commit', async () => {
    const s = servidor({
      portadas: [new TypeError('fetch failed'), OTRO, OTRO, COMMIT],
    })
    const { ahora, esperar } = reloj()
    const r = await esperarVersion(config, {
      pedir: s.fn,
      ahora,
      esperar,
      esperaMaximaMs: 60_000,
      intervaloMs: 15_000,
    })
    assert.equal(r.ok, true)
    assert.equal(r.version, COMMIT)
    assert.equal(r.intentos, 4)
    // Cada petición lleva un parámetro distinto y pide no usar la caché.
    const params = s.llamadas.map((l) => l.url.searchParams.get('humo'))
    assert.equal(new Set(params).size, 4)
    assert.ok(s.llamadas.every((l) => l.init.cache === 'no-store'))
  })

  test('vale el SHA corto', async () => {
    const s = servidor({ portadas: [COMMIT.slice(0, 7)] })
    const r = await esperarVersion(config, {
      pedir: s.fn,
      ...reloj(),
      esperaMaximaMs: 60_000,
      intervaloMs: 15_000,
    })
    assert.equal(r.ok, true)
  })

  test('se rinde al llegar al plazo', async () => {
    const s = servidor({ portadas: [OTRO] })
    const r = await esperarVersion(config, {
      pedir: s.fn,
      ...reloj(),
      esperaMaximaMs: 60_000,
      intervaloMs: 15_000,
    })
    assert.equal(r.ok, false)
    assert.equal(r.intentos, 5)
    assert.ok(r.mensaje.includes('bbbbbbb'))
  })

  test('sin la etiqueta meta no espera: avisa y sigue', async () => {
    const s = servidor({ portadas: [null] })
    const r = await esperarVersion(config, {
      pedir: s.fn,
      ...reloj(),
      esperaMaximaMs: 60_000,
      intervaloMs: 15_000,
    })
    assert.equal(r.ok, true)
    assert.equal(r.version, null)
    assert.ok(r.mensaje.includes('orki-release'))
  })
})

describe('comprobarPublicado', () => {
  const config = leerConfiguracion(ENTORNO)

  test('pide el script y llama al catálogo público con la clave publicable', async () => {
    const s = servidor({ portadas: [COMMIT] })
    assert.deepEqual(await comprobarPublicado(config, html(COMMIT), s.fn), [])
    const rpc = s.llamadas.find((l) => l.url.hostname.endsWith('supabase.co'))
    assert.equal(rpc.url.pathname, '/rest/v1/rpc/search_public_species')
    assert.equal(rpc.init.method, 'POST')
    assert.equal(rpc.init.headers.apikey, 'sb_publishable_ficticia')
    assert.equal(rpc.init.headers.Authorization, undefined)
  })

  test('informa de cada fallo', async () => {
    const s = servidor({ portadas: [COMMIT], script: 404, rpc: [401, {}] })
    const errores = await comprobarPublicado(config, html(COMMIT), s.fn)
    assert.equal(errores.length, 2)
    assert.ok(errores[0].includes('404'))
    assert.ok(errores[1].includes('401'))
  })

  test('una respuesta que no es una lista es un fallo', async () => {
    const s = servidor({ portadas: [COMMIT], rpc: [200, { mensaje: 'x' }] })
    const errores = await comprobarPublicado(config, html(COMMIT), s.fn)
    assert.deepEqual(errores, ['search_public_species no devolvió una lista.'])
  })
})

describe('principal', () => {
  test('sin configuración se omite con un aviso y no falla', async () => {
    const registro = []
    const textos = []
    const codigo = await principal(
      { COMMIT },
      {
        fetch: async () => assert.fail('no debe pedir nada'),
        registro: (l) => registro.push(l),
        escribir: (t) => textos.push(t),
      },
    )
    assert.equal(codigo, 0)
    assert.match(registro[0], /^::notice::Prueba de humo omitida/)
    assert.ok(textos.join('').includes('omitida'))
  })

  test('todo bien', async () => {
    const textos = []
    const codigo = await principal(ENTORNO, {
      fetch: servidor({ portadas: [OTRO, COMMIT] }).fn,
      registro: () => {},
      escribir: (t) => textos.push(t),
      ...reloj(),
    })
    assert.equal(codigo, 0)
    assert.ok(textos.join('').includes('`aaaaaaa`'))
    assert.ok(textos.join('').includes('2 peticiones'))
    assert.ok(!textos.join('').includes('sb_publishable_ficticia'))
  })

  test('si producción no llega a servir el commit, falla', async () => {
    const registro = []
    const codigo = await principal(ENTORNO, {
      fetch: servidor({ portadas: [OTRO] }).fn,
      registro: (l) => registro.push(l),
      escribir: () => {},
      ...reloj(),
    })
    assert.equal(codigo, 1)
    assert.ok(registro.some((l) => l.startsWith('::error::Producción no')))
  })

  test('si el catálogo no responde, falla', async () => {
    const codigo = await principal(ENTORNO, {
      fetch: servidor({ portadas: [COMMIT], rpc: [500, {}] }).fn,
      registro: () => {},
      escribir: () => {},
      ...reloj(),
    })
    assert.equal(codigo, 1)
  })
})
