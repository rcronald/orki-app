// Lectura de los informes JSON de Lighthouse y resumen de varias ejecuciones
// (#149). Funciones puras, probadas en lighthouse.test.mjs.

/** Métricas que se informan, con la auditoría de Lighthouse de la que salen. */
export const METRICAS_LIGHTHOUSE = Object.freeze([
  {
    clave: 'fcp',
    nombre: 'FCP',
    auditoria: 'first-contentful-paint',
    unidad: 'ms',
  },
  {
    clave: 'lcp',
    nombre: 'LCP',
    auditoria: 'largest-contentful-paint',
    unidad: 'ms',
  },
  {
    clave: 'si',
    nombre: 'Speed Index',
    auditoria: 'speed-index',
    unidad: 'ms',
  },
  {
    clave: 'tbt',
    nombre: 'TBT',
    auditoria: 'total-blocking-time',
    unidad: 'ms',
  },
  {
    clave: 'cls',
    nombre: 'CLS',
    auditoria: 'cumulative-layout-shift',
    unidad: '',
  },
  {
    clave: 'bytes',
    nombre: 'Bytes transferidos',
    auditoria: 'total-byte-weight',
    unidad: 'B',
  },
])

/** Métricas de un informe JSON de Lighthouse (lhr). */
export function metricasDeInforme(informe) {
  if (informe.runtimeError?.code) {
    throw new Error(
      `Lighthouse falló: ${informe.runtimeError.code} ${informe.runtimeError.message ?? ''}`,
    )
  }
  const metricas = {}
  for (const { clave, auditoria } of METRICAS_LIGHTHOUSE) {
    const valor = informe.audits?.[auditoria]?.numericValue
    if (typeof valor !== 'number') {
      throw new Error(`El informe no tiene la auditoría ${auditoria}.`)
    }
    metricas[clave] = valor
  }
  const puntuacion = informe.categories?.performance?.score
  metricas.puntuacion =
    typeof puntuacion === 'number' ? Math.round(puntuacion * 100) : null
  return metricas
}

/** Mediana de una lista de números (la media de los dos centrales si es par). */
export function mediana(valores) {
  if (valores.length === 0) throw new Error('No hay valores.')
  const ordenados = [...valores].sort((a, b) => a - b)
  const mitad = Math.floor(ordenados.length / 2)
  return ordenados.length % 2 === 1
    ? ordenados[mitad]
    : (ordenados[mitad - 1] + ordenados[mitad]) / 2
}

/** Mediana, mínimo y máximo de cada métrica sobre varias ejecuciones. */
export function resumirEjecuciones(ejecuciones) {
  const claves = [
    ...METRICAS_LIGHTHOUSE.map(({ clave }) => clave),
    'puntuacion',
  ]
  return Object.fromEntries(
    claves.map((clave) => {
      const valores = ejecuciones
        .map((ejecucion) => ejecucion[clave])
        .filter((valor) => typeof valor === 'number')
      return [
        clave,
        {
          mediana: mediana(valores),
          minimo: Math.min(...valores),
          maximo: Math.max(...valores),
        },
      ]
    }),
  )
}

/** Condiciones de la medición que declara el informe (para anotarlas). */
export function condicionesDeInforme(informe) {
  const ajustes = informe.configSettings ?? {}
  const limitacion = ajustes.throttling ?? {}
  return {
    lighthouse: informe.lighthouseVersion,
    navegador: informe.environment?.hostUserAgent,
    benchmarkIndex: informe.environment?.benchmarkIndex,
    formato: ajustes.formFactor,
    metodo: ajustes.throttlingMethod,
    rttMs: limitacion.rttMs,
    kbps: limitacion.throughputKbps,
    cpu: limitacion.cpuSlowdownMultiplier,
  }
}
