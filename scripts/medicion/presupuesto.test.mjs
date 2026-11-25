import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  compararConPresupuesto,
  entradasDePrecache,
  filasInformativas,
  importsEstaticos,
  medirBuild,
  presupuestoBajado,
  presupuestoDesde,
  referenciasIniciales,
  tablaDeCambios,
  tamanoBrotli,
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

  test('suma el precaché con Brotli archivo a archivo', () => {
    const { metricas } = medirBuild('dist', leer)
    const rutas = ['index.html', 'assets/index-A.js', 'assets/App-E.js']
    assert.equal(
      metricas.precacheBrotli,
      rutas.reduce((total, ruta) => total + tamanoBrotli(leer(ruta)), 0),
    )
    // Comprime: los archivos de prueba son muy repetitivos.
    assert.ok(metricas.precacheBrotli < metricas.precacheBytes / 4)
  })
})

describe('tamanoBrotli', () => {
  test('comprime con Brotli y es determinista', () => {
    const contenido = Buffer.from('const a = 1;\n'.repeat(200))
    assert.equal(tamanoBrotli(contenido), tamanoBrotli(contenido))
    assert.ok(tamanoBrotli(contenido) < tamanoGzip(contenido))
  })
})

describe('filasInformativas', () => {
  test('da lo medido con la referencia, sin límite ni veredicto', () => {
    assert.deepEqual(
      filasInformativas(
        { precacheBrotli: 450 },
        { informativas: { precacheBrotli: { referencia: 400 } } },
      ),
      [
        {
          clave: 'precacheBrotli',
          nombre: 'Precaché del service worker (Brotli, informativa)',
          valor: 450,
          referencia: 400,
        },
      ],
    )
  })

  test('sin referencia en el presupuesto la deja sin definir', () => {
    assert.equal(
      filasInformativas({ precacheBrotli: 450 }, { metricas: {} })[0]
        .referencia,
      undefined,
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
      {
        jsInicialGzip: 1000,
        cssGzip: 201,
        precacheBytes: 10_000,
        precacheBrotli: 3000,
      },
      0.05,
      '2026-11-21',
    )
    assert.deepEqual(nuevo.informativas, {
      precacheBrotli: { referencia: 3000 },
    })
    assert.equal(nuevo.fecha, '2026-11-21')
    assert.equal(nuevo.margen, 0.05)
    assert.deepEqual(nuevo.metricas, {
      jsInicialGzip: { referencia: 1000, limite: 1050 },
      cssGzip: { referencia: 201, limite: 212 },
      precacheBytes: { referencia: 10_000, limite: 10_500 },
    })
  })
})

describe('presupuestoBajado', () => {
  const actual = {
    descripcion: 'Presupuesto',
    fecha: '2026-11-20',
    margen: 0.05,
    metricas: {
      jsInicialGzip: { referencia: 1000, limite: 1050 },
      cssGzip: { referencia: 200, limite: 210 },
      precacheBytes: { referencia: 10_000, limite: 10_500 },
    },
    informativas: { precacheBrotli: { referencia: 3000 } },
  }

  test('baja solo las métricas cuyo límite nuevo queda por debajo', () => {
    const nuevo = presupuestoBajado(
      actual,
      {
        jsInicialGzip: 1002,
        cssGzip: 199,
        precacheBytes: 9000,
        precacheBrotli: 2700,
      },
      '2026-11-24',
    )
    assert.deepEqual(nuevo, {
      descripcion: 'Presupuesto',
      fecha: '2026-11-24',
      margen: 0.05,
      metricas: {
        // Sube 2 B: se queda como estaba.
        jsInicialGzip: { referencia: 1000, limite: 1050 },
        // Baja 1 B, pero ⌈199 × 1,05⌉ = 209 < 210: baja.
        cssGzip: { referencia: 199, limite: 209 },
        precacheBytes: { referencia: 9000, limite: 9450 },
      },
      informativas: { precacheBrotli: { referencia: 2700 } },
    })
  })

  test('nunca sube un límite y, si nada baja, conserva la fecha', () => {
    const nuevo = presupuestoBajado(
      actual,
      {
        jsInicialGzip: 2000,
        cssGzip: 400,
        precacheBytes: 20_000,
        precacheBrotli: 6000,
      },
      '2026-11-24',
    )
    assert.deepEqual(nuevo.metricas, actual.metricas)
    assert.equal(nuevo.fecha, '2026-11-20')
  })

  test('falla si al presupuesto le falta el margen o una métrica', () => {
    assert.throws(
      () => presupuestoBajado({ metricas: actual.metricas }, {}, 'x'),
      /margen/,
    )
    assert.throws(
      () =>
        presupuestoBajado(
          { margen: 0.05, metricas: { jsInicialGzip: { limite: 1 } } },
          { jsInicialGzip: 1, cssGzip: 1, precacheBytes: 1 },
          'x',
        ),
      /cssGzip/,
    )
  })
})

describe('tablaDeCambios', () => {
  test('una fila por métrica con lo medido, la diferencia y los límites', () => {
    const anterior = {
      metricas: {
        jsInicialGzip: { referencia: 86_987, limite: 91_337 },
        cssGzip: { referencia: 13_246, limite: 13_909 },
        precacheBytes: { referencia: 1_402_144, limite: 1_472_252 },
      },
    }
    const metricas = {
      jsInicialGzip: 87_252,
      cssGzip: 13_246,
      precacheBytes: 1_371_087,
      precacheBrotli: 450_000,
    }
    const nuevo = presupuestoBajado(
      { ...anterior, margen: 0.05 },
      metricas,
      '2026-11-24',
    )
    assert.equal(
      tablaDeCambios(anterior, nuevo, metricas),
      [
        '| Métrica | Referencia antes | Medido ahora | Diferencia | Límite antes | Límite ahora |',
        '| --- | ---: | ---: | ---: | ---: | ---: |',
        '| JavaScript inicial (gzip) | 86 987 B | 87 252 B | +265 B | 91 337 B | sin cambio |',
        '| CSS inicial (gzip) | 13 246 B | 13 246 B | 0 B | 13 909 B | sin cambio |',
        '| Precaché del service worker (sin comprimir) | 1 402 144 B | 1 371 087 B | −31 057 B | 1 472 252 B | 1 439 642 B |',
        '| Precaché del service worker (Brotli, informativa) | — | 450 000 B | — | — | — |',
      ].join('\n'),
    )
  })
})
