import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { CABECERAS_FIRMES } from './comprobar.mjs'
import { cabecerasDeLasPruebas } from './de-las-pruebas.mjs'

describe('cabecerasDeLasPruebas', () => {
  const cabeceras = cabecerasDeLasPruebas()

  test('las páginas llevan las firmes de vercel.json y la CSP obligatoria con los dominios ficticios', () => {
    const pagina = cabeceras('/coleccion')
    for (const [nombre, valor] of Object.entries(CABECERAS_FIRMES)) {
      assert.equal(pagina[nombre], valor, nombre)
    }
    assert.equal(pagina['Content-Security-Policy-Report-Only'], undefined)
    assert.match(
      pagina['Content-Security-Policy'],
      /connect-src 'self' https:\/\/supabase\.orki\.invalid https:\/\/clerk\.orki\.invalid /,
    )
    assert.match(
      pagina['Reporting-Endpoints'],
      /^csp="https:\/\/sentry\.orki\.invalid\/api\/1\/security\//,
    )
  })

  test('los archivos con hash y el service worker, solo las firmes', () => {
    for (const ruta of ['/assets/index-A.js', '/sw.js']) {
      assert.equal(cabeceras(ruta)['Content-Security-Policy'], undefined, ruta)
      assert.equal(cabeceras(ruta)['X-Content-Type-Options'], 'nosniff', ruta)
    }
  })
})
