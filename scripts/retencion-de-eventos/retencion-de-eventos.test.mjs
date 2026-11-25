// Pruebas del script de retención de eventos (#293), con un doble de supabase-js: sin red.
// Lo que borra la función en la base lo prueban supabase/tests/retencion_de_eventos.sql.
//
//   npm run test:scripts

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  FUNCION,
  REFS,
  leerArgumentos,
  principal,
} from './retencion-de-eventos.mjs'

const CLAVE = 'sb_secret_SECRETORETENCION123'
const entornoProd = {
  SUPABASE_PROJECT_REF: REFS.produccion,
  SUPABASE_SECRET_KEY: CLAVE,
}

function ejecutarCon({ argv, entorno = entornoProd, respuesta }) {
  const lineas = []
  const llamadas = []
  let clientes = 0
  const promesa = principal({
    argv,
    entorno,
    crearSupabase: (url, clave) => {
      clientes += 1
      llamadas.push({ url, clave })
      return {
        rpc: async (nombre, argumentos) => {
          llamadas.push({ rpc: nombre, argumentos })
          return respuesta
        },
      }
    },
    log: (linea) => lineas.push(linea),
  })
  return { promesa, lineas, llamadas, clientes: () => clientes }
}

describe('retención de eventos', () => {
  test('llama a la función de la base con la clave secreta y dice cuántos borró', async () => {
    const ejecucion = ejecutarCon({
      argv: ['--ambiente', 'produccion'],
      respuesta: { data: 42, error: null },
    })
    assert.equal(await ejecucion.promesa, 42)
    assert.deepEqual(ejecucion.llamadas, [
      { url: `https://${REFS.produccion}.supabase.co`, clave: CLAVE },
      { rpc: FUNCION, argumentos: undefined },
    ])
    assert.equal(
      ejecucion.lineas.at(-1),
      'Eventos de más de 13 meses borrados: 42.',
    )
    assert.ok(!ejecucion.lineas.join('\n').includes(CLAVE))
  })

  test('se niega con el proyecto de otro ambiente, sin crear el cliente', async () => {
    const ejecucion = ejecutarCon({
      argv: ['--ambiente', 'produccion'],
      entorno: { ...entornoProd, SUPABASE_PROJECT_REF: REFS.desarrollo },
      respuesta: { data: 0, error: null },
    })
    await assert.rejects(ejecucion.promesa, /no es el proyecto de produccion/)
    assert.equal(ejecucion.clientes(), 0)
  })

  test('sin la clave secreta, falla nombrando la variable', async () => {
    const ejecucion = ejecutarCon({
      argv: ['--ambiente', 'produccion'],
      entorno: { SUPABASE_PROJECT_REF: REFS.produccion },
      respuesta: { data: 0, error: null },
    })
    await assert.rejects(ejecucion.promesa, /falta SUPABASE_SECRET_KEY/)
    assert.equal(ejecucion.clientes(), 0)
  })

  test('sin la migración aplicada, lo dice', async () => {
    const ejecucion = ejecutarCon({
      argv: ['--ambiente', 'produccion'],
      respuesta: {
        data: null,
        error: { code: 'PGRST202', message: 'Could not find the function' },
      },
    })
    await assert.rejects(ejecucion.promesa, /falta aplicar la migración/)
  })

  test('un error de la base o de permisos hace fallar el script, sin la clave', async () => {
    const ejecucion = ejecutarCon({
      argv: ['--ambiente', 'produccion'],
      respuesta: {
        data: null,
        error: { code: '42501', message: 'permission denied' },
      },
    })
    await assert.rejects(ejecucion.promesa, (error) => {
      assert.match(error.message, /42501.*permission denied/)
      assert.ok(!error.message.includes(CLAVE))
      return true
    })
  })

  test('una respuesta que no es un número de eventos es un error', async () => {
    const ejecucion = ejecutarCon({
      argv: ['--ambiente', 'produccion'],
      respuesta: { data: null, error: null },
    })
    await assert.rejects(ejecucion.promesa, /respuesta inesperada/)
  })

  test('argumentos', () => {
    assert.deepEqual(leerArgumentos(['--ambiente', 'desarrollo']), {
      ambiente: 'desarrollo',
    })
    assert.throws(() => leerArgumentos([]), /indica el ambiente/)
    assert.throws(
      () => leerArgumentos(['--ambiente', 'dev']),
      /--ambiente debe ser/,
    )
    assert.throws(
      () => leerArgumentos(['--ambiente', 'produccion', '--borrar']),
      /argumento desconocido/,
    )
  })
})
