#!/usr/bin/env node
// Pruebas de base de datos: npm run db:test [-- <filtro>]
//
// Prepara una base Postgres desechable con todas las migraciones (scripts/db-desechable),
// crea las funciones de aserción (supabase/tests/soporte/ayudantes.sql) y ejecuta las pruebas
// de supabase/tests/*.sql. Con un filtro, solo los archivos cuyo nombre lo contiene.
//
// Formato de los archivos de prueba: cada prueba empieza con una línea
//   -- prueba: <qué comprueba>
// y llega hasta la siguiente. Lo que haya antes de la primera prueba son los datos de partida
// del archivo y se ejecutan al comienzo de cada una. Cada prueba corre en su propia sesión de
// psql, dentro de una transacción que se revierte al final, con el rol "postgres" (dueño de
// las tablas, como en el editor SQL de Supabase); la prueba puede cambiar de rol con
// "set local role". Si una sentencia da error, la prueba falla con ese mensaje. Una prueba
// puede incluir otro archivo SQL con \i, con la ruta relativa a la raíz del repositorio.
//
// Termina con código 0 si todas las pruebas pasan y 1 si alguna falla o no se pudo preparar
// la base.

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import {
  conBaseDesechable,
  ErrorDeBaseDesechable,
  raizRepositorio,
} from './db-desechable/index.mjs'

const directorioPruebas = join(raizRepositorio, 'supabase', 'tests')
const archivoAyudantes = join(directorioPruebas, 'soporte', 'ayudantes.sql')
const marcaPrueba = /^--\s*prueba:\s*(.+?)\s*$/
// Las pruebas no controlan la transacción: la abre y la revierte el ejecutor. Tampoco pueden
// reconectarse (\c), porque saldrían de ella.
const controlDeTransaccion =
  /^\s*((begin|commit|end|rollback|abort|start\s+transaction)\s*(;|$)|\\(c|connect)(\s|$))/i

function rutaLegible(ruta) {
  return relative(raizRepositorio, ruta)
}

// Divide un archivo en datos de partida y pruebas, recordando la línea de origen de cada
// línea para poder señalarla en los errores.
function leerArchivoDePruebas(ruta) {
  const lineas = readFileSync(ruta, 'utf8').split('\n')
  const preambulo = []
  const pruebas = []
  let actual = null
  // Dentro de un cuerpo entre $$ (un bloque "do" o una sentencia que se pasa a
  // pruebas.debe_fallar) "begin" y "end" son de PL/pgSQL, no de la transacción.
  let dentroDeDolares = false
  lineas.forEach((texto, indice) => {
    const linea = { texto, origen: `${rutaLegible(ruta)}:${indice + 1}` }
    const marca = marcaPrueba.exec(texto)
    if (marca && !dentroDeDolares) {
      actual = { nombre: marca[1], lineas: [] }
      pruebas.push(actual)
      return
    }
    const estabaDentro = dentroDeDolares
    if ((texto.split('$$').length - 1) % 2 === 1)
      dentroDeDolares = !dentroDeDolares
    if (!estabaDentro && controlDeTransaccion.test(texto)) {
      throw new ErrorDeBaseDesechable(
        `${linea.origen}: las pruebas no pueden abrir, confirmar ni revertir transacciones ni reconectarse ` +
          '(cada prueba ya corre en una transacción que se revierte). Usa savepoints si hace falta.',
      )
    }
    ;(actual ? actual.lineas : preambulo).push(linea)
  })
  if (pruebas.length === 0) {
    throw new ErrorDeBaseDesechable(
      `${rutaLegible(ruta)} no tiene ninguna prueba (líneas "-- prueba: ...").`,
    )
  }
  return { ruta, preambulo, pruebas }
}

// Ejecuta una prueba en su propia sesión y transacción. Devuelve null si pasa o el mensaje
// de error, con las líneas de psql traducidas a archivo:línea.
function ejecutarPrueba(ejecutarPsql, archivo, prueba) {
  const lineas = [
    { texto: 'begin;', origen: 'inicio' },
    { texto: 'set local role postgres;', origen: 'inicio' },
    ...archivo.preambulo,
    ...prueba.lineas,
    { texto: 'rollback;', origen: 'fin' },
  ]
  const resultado = ejecutarPsql(['-f', '-'], {
    entrada: lineas.map((linea) => linea.texto).join('\n'),
  })
  if (resultado.ok) return null
  return resultado.stderr
    .trim()
    .split('\n')
    .map((texto) =>
      texto.replace(
        /^psql:<stdin>:(\d+): /,
        (_, numero) => `${lineas[Number(numero) - 1]?.origen ?? '?'}: `,
      ),
    )
    .join('\n')
}

function sangrar(texto, espacios) {
  return texto
    .split('\n')
    .map((linea) => ' '.repeat(espacios) + linea)
    .join('\n')
}

async function principal() {
  const filtros = process.argv.slice(2)
  const archivos = readdirSync(directorioPruebas)
    .filter((nombre) => nombre.endsWith('.sql'))
    .filter(
      (nombre) =>
        filtros.length === 0 ||
        filtros.some((filtro) => nombre.includes(filtro)),
    )
    .sort()
    .map((nombre) => leerArchivoDePruebas(join(directorioPruebas, nombre)))
  if (archivos.length === 0) {
    throw new ErrorDeBaseDesechable(
      `ningún archivo de ${rutaLegible(directorioPruebas)} coincide con: ${filtros.join(', ')}`,
    )
  }

  // psql resuelve las rutas de \i desde el directorio actual.
  process.chdir(raizRepositorio)
  const inicio = Date.now()
  console.log('Preparando la base de datos desechable')
  return conBaseDesechable(
    async ({ descripcion, version, consultar, ejecutarPsql }) => {
      console.log(`  PostgreSQL ${version}, ${descripcion}`)
      const ayudantes = ejecutarPsql(['-1', '-f', archivoAyudantes])
      if (!ayudantes.ok) {
        throw new ErrorDeBaseDesechable(
          `no se pudieron crear las funciones de aserción:\n${ayudantes.stderr.trim()}`,
        )
      }
      const recuento = () =>
        consultar(
          "select tabla || '=' || filas from pruebas.filas_por_tabla()",
        ).join(', ')
      const filasAntes = recuento()

      let total = 0
      const fallidas = []
      for (const archivo of archivos) {
        console.log(`\n${rutaLegible(archivo.ruta)}`)
        for (const prueba of archivo.pruebas) {
          // psql se ejecuta de forma síncrona: se cede el turno entre pruebas para que una
          // interrupción (Ctrl+C) se atienda enseguida y limpie la base y el clúster.
          await new Promise((resolver) => setImmediate(resolver))
          total += 1
          const error = ejecutarPrueba(ejecutarPsql, archivo, prueba)
          if (error === null) {
            console.log(`  ok     ${prueba.nombre}`)
          } else {
            fallidas.push(`${rutaLegible(archivo.ruta)}: ${prueba.nombre}`)
            console.log(`  FALLO  ${prueba.nombre}`)
            console.log(sangrar(error, 9))
          }
        }
      }

      const filasDespues = recuento()
      if (filasDespues !== filasAntes) {
        fallidas.push('las pruebas dejaron datos en la base')
        console.log(
          `\nFALLO  las pruebas dejaron datos en la base.\n  Antes:   ${filasAntes}\n  Después: ${filasDespues}`,
        )
      }

      const segundos = ((Date.now() - inicio) / 1000).toFixed(1)
      if (fallidas.length === 0) {
        console.log(`\n${total} pruebas, todas correctas (${segundos} s).`)
        return 0
      }
      console.log(
        `\n${total} pruebas, ${fallidas.length} con fallos (${segundos} s):`,
      )
      for (const fallida of fallidas) console.log(`  - ${fallida}`)
      return 1
    },
    {
      alAvanzar: ({ paso, ok }) =>
        console.log(`  ${ok ? 'ok    ' : 'FALLO '} ${paso}`),
    },
  )
}

try {
  process.exitCode = await principal()
} catch (error) {
  if (error instanceof ErrorDeBaseDesechable) {
    console.error(`\nError: ${error.message}`)
    process.exitCode = 1
  } else {
    throw error
  }
}
