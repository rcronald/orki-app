import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  condicionesDeInforme,
  mediana,
  metricasDeInforme,
  resumirEjecuciones,
} from './lighthouse.mjs'

function informe(valores, puntuacion = 0.9) {
  const auditoria = (numericValue) => ({ numericValue })
  return {
    lighthouseVersion: '13.6.0',
    environment: { benchmarkIndex: 2000, hostUserAgent: 'Chrome' },
    configSettings: {
      formFactor: 'mobile',
      throttlingMethod: 'simulate',
      throttling: {
        rttMs: 150,
        throughputKbps: 1638.4,
        cpuSlowdownMultiplier: 4,
      },
    },
    categories: { performance: { score: puntuacion } },
    audits: {
      'first-contentful-paint': auditoria(valores.fcp),
      'largest-contentful-paint': auditoria(valores.lcp),
      'speed-index': auditoria(valores.si),
      'total-blocking-time': auditoria(valores.tbt),
      'cumulative-layout-shift': auditoria(valores.cls),
      'total-byte-weight': auditoria(valores.bytes),
    },
  }
}

const BASE = { fcp: 1000, lcp: 2000, si: 1500, tbt: 50, cls: 0, bytes: 300_000 }

describe('mediana', () => {
  test('con número impar de valores, el central', () => {
    assert.equal(mediana([3, 1, 2]), 2)
  })

  test('con número par, la media de los dos centrales', () => {
    assert.equal(mediana([4, 1, 3, 2]), 2.5)
  })

  test('sin valores, error', () => {
    assert.throws(() => mediana([]))
  })
})

describe('metricasDeInforme', () => {
  test('saca las métricas y la puntuación sobre 100', () => {
    assert.deepEqual(metricasDeInforme(informe(BASE, 0.87)), {
      ...BASE,
      puntuacion: 87,
    })
  })

  test('falla si Lighthouse no pudo cargar la página', () => {
    assert.throws(
      () =>
        metricasDeInforme({
          runtimeError: { code: 'NO_FCP', message: 'No pintó nada' },
        }),
      /NO_FCP/,
    )
  })
})

describe('resumirEjecuciones', () => {
  test('da mediana, mínimo y máximo de cada métrica', () => {
    const ejecuciones = [1800, 2600, 2000].map((lcp) =>
      metricasDeInforme(informe({ ...BASE, lcp })),
    )
    const resumen = resumirEjecuciones(ejecuciones)
    assert.deepEqual(resumen.lcp, { mediana: 2000, minimo: 1800, maximo: 2600 })
    assert.deepEqual(resumen.puntuacion, {
      mediana: 90,
      minimo: 90,
      maximo: 90,
    })
  })
})

describe('condicionesDeInforme', () => {
  test('anota versión, emulación y limitación de red y CPU', () => {
    assert.deepEqual(condicionesDeInforme(informe(BASE)), {
      lighthouse: '13.6.0',
      navegador: 'Chrome',
      benchmarkIndex: 2000,
      formato: 'mobile',
      metodo: 'simulate',
      rttMs: 150,
      kbps: 1638.4,
      cpu: 4,
    })
  })
})
