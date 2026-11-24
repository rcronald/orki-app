import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  cabeceraDeLaPolitica,
  cabecerasDeLaPolitica,
  destinoDeSentry,
  directivasDeLaPolitica,
  dominioDeClerk,
  MODO_CSP,
  textoDeLaPolitica,
} from '../../apps/web/seguridad/politica.ts'
import { SCRIPTS_EN_LINEA } from '../../apps/web/seguridad/scripts-en-linea.ts'
import middleware, { config } from '../../apps/web/middleware.ts'
import { ENTORNO_FICTICIO } from '../medicion/entorno.mjs'

// Generador de la CSP (apps/web/seguridad/politica.ts, #282) con entornos de
// ejemplo: ninguno apunta a un servicio real.

const clave = (tipo, dominio) =>
  `pk_${tipo}_${Buffer.from(`${dominio}$`).toString('base64')}`

const PRODUCCION = {
  VITE_SUPABASE_URL: 'https://prod-ref.supabase.co',
  VITE_CLERK_PUBLISHABLE_KEY: clave('live', 'clerk.ejemplo.app'),
  VITE_SENTRY_DSN: 'https://clavepublica@o1.ingest.us.sentry.io/42',
  VITE_APP_ENV: 'prod',
  VERCEL_ENV: 'production',
}

const DESARROLLO = {
  VITE_SUPABASE_URL: 'https://dev-ref.supabase.co',
  VITE_CLERK_PUBLISHABLE_KEY: clave('test', 'sabio-gato-1.clerk.accounts.dev'),
  VITE_APP_ENV: 'dev',
  VERCEL_ENV: 'preview',
}

const HASHES = ['sha256-/KuMluTY+UcUWOTaVCenKtzGd08nBdCYET+Aj7TZTNQ=']

describe('dominioDeClerk', () => {
  test('saca el dominio de Frontend API de la clave publicable', () => {
    assert.equal(
      dominioDeClerk(PRODUCCION.VITE_CLERK_PUBLISHABLE_KEY),
      'clerk.ejemplo.app',
    )
    assert.equal(
      dominioDeClerk(DESARROLLO.VITE_CLERK_PUBLISHABLE_KEY),
      'sabio-gato-1.clerk.accounts.dev',
    )
  })

  test('rechaza una clave secreta, vacía o sin dominio', () => {
    assert.throws(() => dominioDeClerk('sk_live_abc'), /clave publicable/)
    assert.throws(() => dominioDeClerk(undefined), /clave publicable/)
    assert.throws(
      () =>
        dominioDeClerk(
          `pk_live_${Buffer.from('sin-dolar').toString('base64')}`,
        ),
      /dominio válido/,
    )
    assert.throws(
      () => dominioDeClerk(clave('live', 'evil.com; script-src *')),
      /dominio válido/,
    )
  })
})

describe('destinoDeSentry', () => {
  test('dirección de los informes de CSP con la clave pública, el ambiente y la versión', () => {
    const destino = destinoDeSentry(PRODUCCION.VITE_SENTRY_DSN, {
      ...PRODUCCION,
      VERCEL_GIT_COMMIT_SHA: 'abc1234',
    })
    assert.equal(destino.origen, 'https://o1.ingest.us.sentry.io')
    assert.equal(
      destino.informes,
      'https://o1.ingest.us.sentry.io/api/42/security/?sentry_key=clavepublica&sentry_environment=prod&sentry_release=abc1234',
    )
  })

  test('rechaza un DSN mal formado', () => {
    assert.throws(
      () => destinoDeSentry('https://o1.ingest.sentry.io/42', PRODUCCION),
      /DSN/,
    )
  })
})

describe('directivasDeLaPolitica', () => {
  test('producción: los orígenes salen de las variables y nada más', () => {
    const d = directivasDeLaPolitica(PRODUCCION, { scriptsEnLinea: HASHES })
    assert.deepEqual(d['script-src'], [
      "'self'",
      `'${HASHES[0]}'`,
      'https://clerk.ejemplo.app',
      'https://challenges.cloudflare.com',
      'https://*.protect.clerk.com',
    ])
    assert.deepEqual(d['connect-src'], [
      "'self'",
      'https://prod-ref.supabase.co',
      'https://clerk.ejemplo.app',
      'https://*.protect.clerk.com:*',
      'https://o1.ingest.us.sentry.io',
    ])
    assert.deepEqual(d['img-src'], [
      "'self'",
      'data:',
      'blob:',
      'https://prod-ref.supabase.co',
      'https://img.clerk.com',
    ])
    assert.deepEqual(d['frame-ancestors'], ["'none'"])
    assert.deepEqual(d['object-src'], ["'none'"])
    assert.deepEqual(d['report-to'], ['csp'])
    // Sin 'unsafe-inline' ni 'unsafe-eval' en los scripts.
    assert.ok(!d['script-src'].some((f) => f.includes('unsafe')))
    // Ni rastro de la barra de Vercel ni de la telemetría de desarrollo.
    assert.ok(!textoDeLaPolitica(d).includes('vercel.live'))
    assert.ok(!textoDeLaPolitica(d).includes('clerk-telemetry'))
  })

  test('vista previa: telemetría de Clerk de desarrollo, barra de Vercel y sin informes sin DSN', () => {
    const d = directivasDeLaPolitica(DESARROLLO, { scriptsEnLinea: HASHES })
    assert.ok(d['connect-src'].includes('https://dev-ref.supabase.co'))
    assert.ok(d['connect-src'].includes('https://clerk-telemetry.com'))
    assert.ok(d['script-src'].includes('https://vercel.live'))
    assert.ok(d['frame-src'].includes('https://vercel.live'))
    assert.equal(d['report-uri'], undefined)
    assert.equal(d['report-to'], undefined)
  })

  test('sin URL de Supabase https no hay política', () => {
    assert.throws(
      () =>
        directivasDeLaPolitica(
          { ...PRODUCCION, VITE_SUPABASE_URL: 'http://x.supabase.co' },
          { scriptsEnLinea: [] },
        ),
      /VITE_SUPABASE_URL/,
    )
    assert.throws(
      () =>
        directivasDeLaPolitica(
          { ...PRODUCCION, VITE_SUPABASE_URL: undefined },
          { scriptsEnLinea: [] },
        ),
      /VITE_SUPABASE_URL/,
    )
  })

  test('un hash mal formado no entra en la política', () => {
    assert.throws(
      () =>
        directivasDeLaPolitica(PRODUCCION, {
          scriptsEnLinea: ["sha256-x' 'unsafe-inline"],
        }),
      /Hash/,
    )
  })

  test('los hashes guardados tienen el formato de la CSP', () => {
    assert.ok(SCRIPTS_EN_LINEA.length > 0)
    directivasDeLaPolitica(ENTORNO_FICTICIO, {
      scriptsEnLinea: SCRIPTS_EN_LINEA,
    })
  })
})

describe('cabecerasDeLaPolitica', () => {
  test('en modo informe es Report-Only y lleva Reporting-Endpoints', () => {
    const cabeceras = cabecerasDeLaPolitica(PRODUCCION, {
      modo: 'informe',
      scriptsEnLinea: HASHES,
    })
    assert.deepEqual(Object.keys(cabeceras), [
      'Content-Security-Policy-Report-Only',
      'Reporting-Endpoints',
    ])
    assert.match(
      cabeceras['Reporting-Endpoints'],
      /^csp="https:\/\/o1\.ingest\.us\.sentry\.io\/api\/42\/security\/\?sentry_key=clavepublica/,
    )
    assert.match(
      cabeceras['Content-Security-Policy-Report-Only'],
      /^default-src 'self'; script-src 'self' /,
    )
  })

  test('en modo obligatorio es Content-Security-Policy', () => {
    assert.equal(cabeceraDeLaPolitica('obligatoria'), 'Content-Security-Policy')
    assert.ok(['informe', 'obligatoria'].includes(MODO_CSP))
  })
})

describe('middleware de Vercel', () => {
  // Aproximación de la regla de Vercel (path-to-regexp) con una expresión
  // regular de JavaScript: el patrón de config.matcher no usa parámetros.
  const corre = (ruta) => new RegExp(`^${config.matcher}$`).test(ruta)

  test('corre en las páginas y en index.html, no en los archivos del build ni en sw.js', () => {
    for (const ruta of [
      '/',
      '/coleccion',
      '/iniciar-sesion/factor-one',
      '/index.html',
    ]) {
      assert.ok(corre(ruta), ruta)
    }
    for (const ruta of ['/assets/index-A.js', '/workbox-1.js', '/sw.js']) {
      assert.ok(!corre(ruta), ruta)
    }
  })

  test('añade la CSP del entorno y, sin variables, sirve la página sin ella', async (t) => {
    const original = { ...process.env }
    t.after(() => {
      for (const nombre of Object.keys(PRODUCCION)) delete process.env[nombre]
      Object.assign(process.env, original)
    })
    const errores = t.mock.method(console, 'error', () => {})
    for (const nombre of Object.keys(PRODUCCION)) delete process.env[nombre]
    const sinPolitica = middleware()
    assert.equal(sinPolitica.headers.get('x-middleware-next'), '1')
    assert.equal(
      sinPolitica.headers.get('content-security-policy-report-only'),
      null,
    )
    assert.equal(errores.mock.callCount(), 1)
    assert.match(errores.mock.calls[0].arguments[0], /VITE_SUPABASE_URL/)

    Object.assign(process.env, PRODUCCION)
    const respuesta = middleware()
    assert.equal(respuesta.headers.get('x-middleware-next'), '1')
    assert.match(
      respuesta.headers.get('content-security-policy-report-only') ?? '',
      /connect-src 'self' https:\/\/prod-ref\.supabase\.co/,
    )
    assert.match(respuesta.headers.get('reporting-endpoints') ?? '', /^csp="/)
    assert.equal(errores.mock.callCount(), 1)
  })
})
