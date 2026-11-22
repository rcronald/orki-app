import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  compararConPresupuesto,
  entradasDePrecache,
  importsEstaticos,
  medirBuild,
  presupuestoDesde,
  referenciasIniciales,
  tamanoGzip,
} from './presupuesto.mjs'

// index.html tal como lo deja Vite con el plugin de PWA.
const HTML = `<!doctype html>
<html lang="es">
  <head>
    <link rel="icon" href="/favicon.ico" sizes="48x48" />
    <script type="module" crossorigin src="/assets/index-A.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/react-B.js">
    <link rel="stylesheet" crossorigin href="/assets/index-C.css">
    <link rel="preconnect" href="https://clerk.example">
    <script src="https://cdn.example/otro.js"></script>
  <link rel="manifest" href="/manifest.webmanifest"><script id="vite-plugin-pwa:register-sw" src="/registerSW.js"></script></head>
  <body><div id="root"></div></body>
</html>`

describe('referenciasIniciales', () => {
  test('separa el JavaScript (script y modulepreload) del CSS y omite lo de otro origen', () => {
    assert.deepEqual(referenciasIniciales(HTML), {
      js: ['assets/index-A.js', 'registerSW.js', 'assets/react-B.js'],
      css: ['assets/index-C.css'],
    })
  })
})

describe('importsEstaticos', () => {
  test('sigue from e import de efecto y no los import() dinámicos', () => {
    const codigo =
      'import{a as e}from"./react-B.js";import"./efecto-D.js";const A=()=>import("./App-E.js");'
    assert.deepEqual(importsEstaticos(codigo, 'assets/index-A.js'), [
      'assets/react-B.js',
      'assets/efecto-D.js',
    ])
  })
})

describe('entradasDePrecache', () => {
  test('lee las url del manifiesto de Workbox', () => {
    const sw =
      'define(["./workbox-1"],function(s){s.precacheAndRoute([{url:"registerSW.js",revision:"1"},{url:"assets/index-A.js",revision:null}],{}),s.registerRoute(new s.NavigationRoute(s.createHandlerBoundToURL("index.html")))});'
    assert.deepEqual(entradasDePrecache(sw), [
      'registerSW.js',
      'assets/index-A.js',
    ])
  })

  test('falla si el service worker no tiene manifiesto', () => {
    assert.throws(
      () => entradasDePrecache('self.skipWaiting()'),
      /precacheAndRoute/,
    )
  })
})

describe('medirBuild', () => {
  const archivos = {
    'index.html': HTML,
    'assets/index-A.js':
      'import"./react-B.js";import"./extra-F.js";' + 'x'.repeat(500),
    'assets/react-B.js': 'y'.repeat(300),
    'assets/extra-F.js': 'z'.repeat(100),
    'assets/App-E.js': 'w'.repeat(1000),
    'assets/index-C.css': 'body{}'.repeat(50),
    'registerSW.js': 'navigator.serviceWorker.register("/sw.js")',
    'sw.js':
      'precacheAndRoute([{url:"index.html",revision:"1"},{url:"assets/index-A.js",revision:null},{url:"assets/App-E.js",revision:null}])',
  }
  const leer = (ruta) => {
    if (!(ruta in archivos)) throw new Error(`No existe ${ruta}`)
    return Buffer.from(archivos[ruta])
  }

  test('suma el JavaScript inicial con sus imports estáticos, el CSS y el precaché', () => {
    const { archivos: medidos, metricas } = medirBuild('dist', leer)
    assert.deepEqual(medidos.jsInicial, [
      'assets/index-A.js',
      'registerSW.js',
      'assets/react-B.js',
      'assets/extra-F.js',
    ])
    assert.equal(
      metricas.jsInicialGzip,
      medidos.jsInicial.reduce(
        (total, ruta) => total + tamanoGzip(leer(ruta)),
        0,
      ),
    )
    assert.equal(metricas.cssGzip, tamanoGzip(leer('assets/index-C.css')))
    assert.equal(
      metricas.precacheBytes,
      archivos['index.html'].length +
        archivos['assets/index-A.js'].length +
        archivos['assets/App-E.js'].length,
    )
  })
})

describe('compararConPresupuesto', () => {
  const presupuesto = {
    metricas: {
      jsInicialGzip: { referencia: 90, limite: 100 },
      cssGzip: { referencia: 10, limite: 12 },
      precacheBytes: { referencia: 900, limite: 1000 },
    },
  }

  test('marca dentro lo que no supera el límite (el límite mismo vale)', () => {
    const filas = compararConPresupuesto(
      { jsInicialGzip: 100, cssGzip: 5, precacheBytes: 999 },
      presupuesto,
    )
    assert.deepEqual(
      filas.map((fila) => fila.dentro),
      [true, true, true],
    )
  })

  test('marca fuera lo que supera el límite', () => {
    const filas = compararConPresupuesto(
      { jsInicialGzip: 101, cssGzip: 5, precacheBytes: 1001 },
      presupuesto,
    )
    assert.deepEqual(
      filas.filter((fila) => !fila.dentro).map((fila) => fila.clave),
      ['jsInicialGzip', 'precacheBytes'],
    )
  })

  test('falla si al presupuesto le falta una métrica', () => {
    assert.throws(
      () =>
        compararConPresupuesto(
          { jsInicialGzip: 1, cssGzip: 1, precacheBytes: 1 },
          { metricas: { jsInicialGzip: { limite: 2 } } },
        ),
      /cssGzip/,
    )
  })
})

describe('presupuestoDesde', () => {
  test('toma la medida como referencia y le suma el margen', () => {
    const nuevo = presupuestoDesde(
      { jsInicialGzip: 1000, cssGzip: 201, precacheBytes: 10_000 },
      0.05,
      '2026-11-21',
    )
    assert.equal(nuevo.fecha, '2026-11-21')
    assert.equal(nuevo.margen, 0.05)
    assert.deepEqual(nuevo.metricas, {
      jsInicialGzip: { referencia: 1000, limite: 1050 },
      cssGzip: { referencia: 201, limite: 212 },
      precacheBytes: { referencia: 10_000, limite: 10_500 },
    })
  })
})
