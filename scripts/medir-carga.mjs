#!/usr/bin/env node
// Medición de la carga inicial con Lighthouse (#149), contra la app construida
// en local y servida con compresión, nunca contra producción. Ver el método y
// los resultados en docs/medicion-de-carga.md.
//
//   npm run medir:carga                      # 5 ejecuciones por pantalla
//   npm run medir:carga -- --repeticiones 9
//   npm run medir:carga -- --solo inicio     # o --solo inventario
//   npm run medir:carga -- --sin-build       # reutiliza los builds que haya
//
// Pantallas:
// - inicio: "/" del build de producción con valores ficticios
//   (npm run build:medicion), sin sesión.
// - inventario: "/coleccion" con sesión y 100 plantas, del build de medición
//   (apps/web/medicion/vite.config.ts), que sustituye Clerk y la lectura de
//   Supabase.
//
// Lighthouse se ejecuta con npx y una versión fija: es una herramienta de
// medición a mano, no del CI, y así no pesa en cada npm ci. Necesita Chrome
// instalado (o CHROME_PATH). Los informes JSON quedan en
// apps/web/dist-medicion/lighthouse/.

import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { entornoDeBuild } from './medicion/entorno.mjs'
import {
  condicionesDeInforme,
  METRICAS_LIGHTHOUSE,
  metricasDeInforme,
  resumirEjecuciones,
} from './medicion/lighthouse.mjs'
import { servirCarpeta } from './medicion/servidor.mjs'

/** Versión fija de Lighthouse: cambiarla cambia la vara de medir. */
const VERSION_LIGHTHOUSE = '13.6.0'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WEB = path.join(RAIZ, 'apps/web')
const DIST = path.join(WEB, 'dist')
const DIST_MEDICION = path.join(WEB, 'dist-medicion/app')
const INFORMES = path.join(WEB, 'dist-medicion/lighthouse')

const PANTALLAS = [
  { id: 'inicio', nombre: 'Inicio (/), sin sesión', carpeta: DIST, ruta: '/' },
  {
    id: 'inventario',
    nombre: 'Inventario (/coleccion), con sesión y 100 plantas',
    carpeta: DIST_MEDICION,
    ruta: '/coleccion',
  },
]

function leerArgumentos(argumentos) {
  const opciones = { repeticiones: 5, construir: true, solo: null }
  for (let i = 0; i < argumentos.length; i += 1) {
    const argumento = argumentos[i]
    if (argumento === '--sin-build') opciones.construir = false
    else if (argumento === '--repeticiones') {
      opciones.repeticiones = Number(argumentos[(i += 1)])
    } else if (argumento === '--solo') opciones.solo = argumentos[(i += 1)]
    else throw new Error(`Argumento desconocido: ${argumento}`)
  }
  if (!Number.isInteger(opciones.repeticiones) || opciones.repeticiones < 1) {
    throw new Error('--repeticiones tiene que ser un entero positivo.')
  }
  if (
    opciones.solo !== null &&
    !PANTALLAS.some((pantalla) => pantalla.id === opciones.solo)
  ) {
    throw new Error(`--solo admite: ${PANTALLAS.map((p) => p.id).join(', ')}.`)
  }
  return opciones
}

function ejecutar(orden, argumentos, opciones) {
  const resultado = spawnSync(orden, argumentos, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opciones,
  })
  if (resultado.status !== 0) {
    throw new Error(`Falló: ${orden} ${argumentos.join(' ')}`)
  }
}

function construir() {
  ejecutar('npm', ['run', 'build:medicion'], { cwd: RAIZ })
  ejecutar('npx', ['vite', 'build', '--config', 'medicion/vite.config.ts'], {
    cwd: WEB,
    env: entornoDeBuild(),
  })
}

// Asíncrono a propósito: el servidor de la carpeta corre en este mismo
// proceso, y con spawnSync no podría responder a Chrome mientras espera.
function ejecutarSinBloquear(orden, argumentos, opciones) {
  return new Promise((resolver, rechazar) => {
    const proceso = spawn(orden, argumentos, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      ...opciones,
    })
    proceso.on('error', rechazar)
    proceso.on('exit', (codigo) => {
      if (codigo === 0) resolver()
      else rechazar(new Error(`Falló: ${orden} ${argumentos.join(' ')}`))
    })
  })
}

async function lighthouse(url, salida) {
  await ejecutarSinBloquear(
    'npx',
    [
      '--yes',
      `lighthouse@${VERSION_LIGHTHOUSE}`,
      url,
      '--only-categories=performance',
      // Los valores por defecto, explícitos: celular de gama media (Moto G
      // Power), red 4G lenta simulada (150 ms de RTT, 1,6 Mbit/s) y CPU 4
      // veces más lenta.
      '--form-factor=mobile',
      '--throttling-method=simulate',
      '--output=json',
      `--output-path=${salida}`,
      '--quiet',
      '--chrome-flags=--headless=new',
    ],
    { cwd: RAIZ },
  )
  return JSON.parse(readFileSync(salida, 'utf8'))
}

const formato = {
  ms: (valor) => `${(valor / 1000).toFixed(2)} s`,
  B: (valor) => `${(valor / 1024).toFixed(1)} KiB`,
  '': (valor) => valor.toFixed(3),
}

async function principal() {
  const opciones = leerArgumentos(process.argv.slice(2))
  if (opciones.construir) construir()
  mkdirSync(INFORMES, { recursive: true })

  const pantallas = PANTALLAS.filter(
    (pantalla) => opciones.solo === null || pantalla.id === opciones.solo,
  )
  const resumen = { fecha: new Date().toISOString(), pantallas: {} }

  for (const pantalla of pantallas) {
    const servidor = await servirCarpeta(pantalla.carpeta)
    const ejecuciones = []
    let condiciones
    try {
      for (let n = 1; n <= opciones.repeticiones; n += 1) {
        console.log(
          `\n${pantalla.nombre}: ejecución ${n} de ${opciones.repeticiones}`,
        )
        const informe = await lighthouse(
          `${servidor.url}${pantalla.ruta}`,
          path.join(INFORMES, `${pantalla.id}-${n}.json`),
        )
        condiciones ??= condicionesDeInforme(informe)
        ejecuciones.push(metricasDeInforme(informe))
      }
    } finally {
      await servidor.cerrar()
    }
    resumen.pantallas[pantalla.id] = {
      nombre: pantalla.nombre,
      repeticiones: opciones.repeticiones,
      condiciones,
      ejecuciones,
      resumen: resumirEjecuciones(ejecuciones),
    }
  }

  writeFileSync(
    path.join(INFORMES, 'resumen.json'),
    `${JSON.stringify(resumen, null, 2)}\n`,
  )

  console.log(
    `\nMediana de ${opciones.repeticiones} ejecuciones (mínimo–máximo):\n`,
  )
  for (const { nombre, condiciones, resumen: datos } of Object.values(
    resumen.pantallas,
  )) {
    console.log(`${nombre}`)
    for (const { clave, nombre: metrica, unidad } of METRICAS_LIGHTHOUSE) {
      const { mediana, minimo, maximo } = datos[clave]
      const f = formato[unidad]
      console.log(`  ${metrica}: ${f(mediana)} (${f(minimo)}–${f(maximo)})`)
    }
    const { mediana, minimo, maximo } = datos.puntuacion
    console.log(`  Puntuación de rendimiento: ${mediana} (${minimo}–${maximo})`)
    console.log(
      `  Lighthouse ${condiciones.lighthouse}, ${condiciones.formato}, ${condiciones.metodo}: RTT ${condiciones.rttMs} ms, ${condiciones.kbps} kbit/s, CPU ×${condiciones.cpu}, benchmarkIndex ${condiciones.benchmarkIndex}\n`,
    )
  }
  console.log(`Informes en ${path.relative(RAIZ, INFORMES)}/`)
}

principal().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
