import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { directivasDeLaPolitica } from '../../apps/web/seguridad/politica.ts'
import { ENTORNO_FICTICIO } from '../medicion/entorno.mjs'
import {
  analizarHtml,
  archivoDeScriptsEnLinea,
  CABECERAS_FIRMES,
  fuenteCubre,
  hashDeScript,
  origenesEnElCodigo,
  origenesSinCubrir,
  problemasDelEntorno,
  problemasDeVercelJson,
  scriptsSinCubrir,
} from './comprobar.mjs'

const VERCEL_JSON = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../apps/web/vercel.json',
)

const DIRECTIVAS = directivasDeLaPolitica(ENTORNO_FICTICIO, {
  scriptsEnLinea: [],
})

describe('vercel.json', () => {
  test('tiene todas las cabeceras firmes con su valor en la regla de todas las rutas', () => {
    const vercel = JSON.parse(readFileSync(VERCEL_JSON, 'utf8'))
    assert.deepEqual(problemasDeVercelJson(vercel), [])
  })

  test('falla si falta una cabecera, si cambia su valor o si no hay regla', () => {
    const vercel = JSON.parse(readFileSync(VERCEL_JSON, 'utf8'))
    const regla = vercel.headers.find((r) => r.source === '/(.*)')
    regla.headers = regla.headers.filter((h) => h.key !== 'X-Frame-Options')
    regla.headers.find((h) => h.key === 'Referrer-Policy').value = 'unsafe-url'
    assert.deepEqual(problemasDeVercelJson(vercel), [
      'La cabecera Referrer-Policy de vercel.json vale «unsafe-url» y debería valer «strict-origin-when-cross-origin»',
      'Falta la cabecera X-Frame-Options en vercel.json',
    ])
    assert.match(
      problemasDeVercelJson({ headers: [] })[0],
      /no tiene una regla de cabeceras/,
    )
  })

  test('las cabeceras firmes no bloquean la cámara ni abren la app en un marco', () => {
    assert.match(CABECERAS_FIRMES['Permissions-Policy'], /camera=\(self\)/)
    assert.equal(CABECERAS_FIRMES['X-Frame-Options'], 'DENY')
  })
})

describe('analizarHtml', () => {
  test('saca el hash de cada script en línea y omite los que tienen src', () => {
    const html =
      '<head><script>uno()</script><script type="module" crossorigin src="/assets/a.js"></script></head><body><script>dos()</script></body>'
    assert.deepEqual(analizarHtml(html), {
      scripts: [hashDeScript('uno()'), hashDeScript('dos()')],
      problemas: [],
    })
  })

  test('el hash es el de la CSP: sha256 en base64 del texto exacto', () => {
    // echo -n "alert(1)" | openssl dgst -sha256 -binary | base64
    assert.equal(
      hashDeScript('alert(1)'),
      'sha256-bhHHL3z2vDgxUt0W3dWQOrprscmda2Y5pLsLg4GF+pI=',
    )
  })

  test('informa de los manejadores on* y de javascript:, que un hash no cubre', () => {
    const { problemas } = analizarHtml(
      '<img src="a.png" onerror="x()"><a href="javascript:void(0)">a</a>',
    )
    assert.equal(problemas.length, 2)
    assert.match(problemas[0], /Manejador en línea/)
    assert.match(problemas[1], /javascript:/)
  })
})

describe('scriptsSinCubrir', () => {
  test('devuelve los hashes que no están en la lista', () => {
    assert.deepEqual(scriptsSinCubrir(['sha256-a', 'sha256-b'], ['sha256-a']), [
      'sha256-b',
    ])
  })
})

describe('origenesEnElCodigo', () => {
  test('saca los orígenes, sin el usuario del DSN ni la ruta', () => {
    const codigo =
      'fetch("https://supabase.orki.invalid/rest/v1/x");const d="https://ficticia@sentry.orki.invalid/1";const t=`https://${host}/npm`;new WebSocket("wss://ws.ejemplo.invalid:443/a")'
    assert.deepEqual([...origenesEnElCodigo(codigo)].sort(), [
      'https://sentry.orki.invalid',
      'https://supabase.orki.invalid',
      'wss://ws.ejemplo.invalid',
    ])
  })
})

describe('fuenteCubre', () => {
  test('exacto, con comodín de subdominio y con puerto', () => {
    assert.ok(fuenteCubre('https://img.clerk.com', 'https://img.clerk.com'))
    assert.ok(
      fuenteCubre(
        'https://*.protect.clerk.com:*',
        'https://a.protect.clerk.com',
      ),
    )
    assert.ok(
      !fuenteCubre('https://*.protect.clerk.com', 'https://protect.clerk.com'),
    )
    assert.ok(!fuenteCubre('https://img.clerk.com', 'http://img.clerk.com'))
    assert.ok(!fuenteCubre("'self'", 'https://img.clerk.com'))
  })
})

describe('origenesSinCubrir', () => {
  test('los de Supabase y Sentry del entorno están cubiertos; los enlaces conocidos se ignoran', () => {
    assert.deepEqual(
      origenesSinCubrir(
        new Set([
          'https://supabase.orki.invalid',
          'https://sentry.orki.invalid',
          'https://creativecommons.org',
          'http://www.w3.org',
        ]),
        DIRECTIVAS,
      ),
      [],
    )
  })

  test('un origen nuevo que el build usa hace fallar la comprobación', () => {
    assert.deepEqual(
      origenesSinCubrir(
        new Set([
          'https://cdn.ejemplo.invalid',
          'https://supabase.orki.invalid',
        ]),
        DIRECTIVAS,
      ),
      ['https://cdn.ejemplo.invalid'],
    )
  })

  test('otro proyecto de Supabase no lo cubre la política de este', () => {
    assert.deepEqual(
      origenesSinCubrir(new Set(['https://otro.supabase.co']), DIRECTIVAS),
      ['https://otro.supabase.co'],
    )
  })
})

describe('problemasDelEntorno', () => {
  test('la política generada permite Supabase, Clerk y Sentry donde la app los usa', () => {
    assert.deepEqual(problemasDelEntorno(ENTORNO_FICTICIO, DIRECTIVAS), [])
  })

  test('falla si Supabase falta en connect-src aunque siga en img-src', () => {
    const sinSupabase = {
      ...DIRECTIVAS,
      'connect-src': DIRECTIVAS['connect-src'].filter(
        (f) => f !== 'https://supabase.orki.invalid',
      ),
    }
    assert.deepEqual(problemasDelEntorno(ENTORNO_FICTICIO, sinSupabase), [
      'connect-src no permite https://supabase.orki.invalid (Supabase)',
    ])
  })
})

describe('archivoDeScriptsEnLinea', () => {
  test('escribe los hashes ordenados y sin repetir, con la cabecera dada', () => {
    assert.equal(
      archivoDeScriptsEnLinea(
        ['sha256-b', 'sha256-a', 'sha256-b'],
        '// Generado\n',
      ),
      "// Generado\nexport const SCRIPTS_EN_LINEA: readonly string[] = [\n  'sha256-a',\n  'sha256-b',\n]\n",
    )
  })
})
