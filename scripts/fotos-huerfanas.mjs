#!/usr/bin/env node
// Limpieza de fotos huérfanas del bucket plant-photos (#83, parte de #10).
//
// Uso:
//   npm run fotos:huerfanas -- --ambiente desarrollo
//   npm run fotos:huerfanas -- --ambiente desarrollo --borrar
//   npm run fotos:huerfanas -- --ambiente produccion [--antiguedad-minima-horas 48]
//   npm run fotos:huerfanas -- --ambiente produccion --borrar --confirmar-produccion
//
// Qué hace:
//   1. Lista todos los objetos del bucket (recorriendo <usuario>/<planta>/).
//   2. Lee photo_path y thumbnail_path de todas las plantas y de todas las
//      filas de plant_photos (varias fotos por planta, #182 y #219). Si el
//      proyecto aún no tiene esa tabla (la migración sin aplicar), sigue solo
//      con plants y lo dice: sin la tabla no hay fotos secundarias.
//   3. Informa de:
//      - los objetos que no cita ninguna planta ni ninguna fila de
//        plant_photos (huérfanos: restos de subidas canceladas, reemplazos o
//        borrados que fallaron a mitad por la red), separando los que tienen
//        la antigüedad mínima de los recientes, que pueden ser una subida en
//        curso cuya fila aún no existe;
//      - las plantas y las fotos que apuntan a un archivo que no existe (solo
//        se informa: no se cambia ninguna fila).
//   4. Solo con --borrar, borra los huérfanos con la antigüedad mínima
//      (24 horas por defecto). Sin --borrar es un modo de prueba: no borra
//      nada.
//
// Credencial: la clave secreta del proyecto (sb_secret_..., o la service_role
// heredada) en SUPABASE_SECRET_KEY, y el proyecto en SUPABASE_PROJECT_REF. Se
// leen del entorno y, si no están, de supabase/.env (ignorado por git); nunca
// se imprimen. Hace falta esa clave porque el script tiene que ver los
// objetos y las plantas de todos los usuarios, y las políticas de Storage y
// de plants solo dejan a cada usuario ver lo suyo. La alternativa, conectarse
// a Postgres y leer storage.objects, sirve para listar pero no para borrar:
// Supabase no deja borrar objetos con SQL (hay que pasar por la API de
// Storage, que borra también el archivo). Riesgo: la clave secreta se salta
// RLS y puede leer y borrar todo el proyecto. Por eso:
//   - no está en GitHub ni en ningún workflow, y solo debería estar en la
//     máquina de quien ejecuta la limpieza el tiempo que dure;
//   - el script exige --ambiente y comprueba que SUPABASE_PROJECT_REF es el
//     de ese ambiente, y para borrar en producción pide además
//     --confirmar-produccion;
//   - solo borra objetos del bucket plant-photos que ninguna planta usa y
//     con la antigüedad mínima.
//
// La lógica de la comparación está en apps/web/src/photos/orphans.ts (con sus
// pruebas en Vitest); Node la carga quitando los tipos de TypeScript.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

import { createClient } from '@supabase/supabase-js'

import {
  parseCleanupArguments,
  runOrphanCleanup,
} from '../apps/web/src/photos/orphans.ts'
import { PLANT_PHOTOS_BUCKET } from '../apps/web/src/photos/paths.ts'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const archivoEnv = join(raiz, 'supabase', '.env')
const refs = {
  desarrollo: 'xaitolsnmjlpyptntfwi',
  produccion: 'fzundhfxnbyjbxyhkgtg',
}
const variablesRequeridas = ['SUPABASE_PROJECT_REF', 'SUPABASE_SECRET_KEY']
const pagina = 1000

function fallar(mensaje) {
  console.error(`Error: ${mensaje}`)
  process.exit(1)
}

function credenciales() {
  let delArchivo = {}
  if (existsSync(archivoEnv)) {
    try {
      delArchivo = parseEnv(readFileSync(archivoEnv, 'utf8'))
    } catch (error) {
      fallar(
        `no se pudo leer ${relative(raiz, archivoEnv)}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  const valores = {}
  for (const nombre of variablesRequeridas) {
    valores[nombre] = (process.env[nombre] || delArchivo[nombre] || '').trim()
  }
  const faltan = variablesRequeridas.filter((nombre) => !valores[nombre])
  if (faltan.length > 0) {
    fallar(
      `falta ${faltan.join(', ')}. Defínelas en el entorno o en ${relative(raiz, archivoEnv)}.`,
    )
  }
  return valores
}

/** Lista recursivamente una carpeta del bucket. */
async function listarObjetos(bucket, carpeta = '') {
  const objetos = []
  for (let offset = 0; ; offset += pagina) {
    const { data, error } = await bucket.list(carpeta, {
      limit: pagina,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    })
    if (error)
      throw new Error(`no se pudo listar "${carpeta}": ${error.message}`)
    for (const entrada of data) {
      const ruta = carpeta ? `${carpeta}/${entrada.name}` : entrada.name
      if (entrada.id === null) {
        // Carpeta: Storage la devuelve sin id.
        objetos.push(...(await listarObjetos(bucket, ruta)))
      } else {
        objetos.push({ name: ruta, createdAt: entrada.created_at ?? null })
      }
    }
    if (data.length < pagina) return objetos
  }
}

/** Lee todas las filas de una tabla, de 1000 en 1000 por id. */
async function leerTabla(supabase, tabla, columnas) {
  const filas = []
  let ultimo = null
  for (;;) {
    let consulta = supabase.from(tabla).select(columnas)
    if (ultimo !== null) consulta = consulta.gt('id', ultimo)
    const { data, error } = await consulta
      .order('id', { ascending: true })
      .limit(pagina)
    if (error) {
      const fallo = new Error(`no se pudo leer ${tabla}: ${error.message}`)
      fallo.codigo = error.code
      throw fallo
    }
    filas.push(...data)
    if (data.length < pagina) return filas
    ultimo = data.at(-1).id
  }
}

/** ¿Es el error de PostgREST de una tabla que no existe? */
function esTablaInexistente(error) {
  return error?.codigo === 'PGRST205' || error?.codigo === '42P01'
}

/** Las fotos de plant_photos; sin la tabla (migración sin aplicar), ninguna. */
async function leerFotos(supabase) {
  try {
    return await leerTabla(
      supabase,
      'plant_photos',
      'id, plant_id, photo_path, thumbnail_path',
    )
  } catch (error) {
    if (!esTablaInexistente(error)) throw error
    console.log(
      'Aviso: el proyecto no tiene la tabla plant_photos; se comparan solo las columnas de plants.',
    )
    return []
  }
}

async function main() {
  let argumentos
  try {
    argumentos = parseCleanupArguments(process.argv.slice(2))
  } catch (error) {
    fallar(error instanceof Error ? error.message : String(error))
  }
  const { ambiente, borrar } = argumentos
  const { SUPABASE_PROJECT_REF: ref, SUPABASE_SECRET_KEY: clave } =
    credenciales()
  if (ref !== refs[ambiente]) {
    fallar(
      `SUPABASE_PROJECT_REF (${ref}) no es el proyecto de ${ambiente} (${refs[ambiente]}). No se ha ejecutado nada.`,
    )
  }

  const supabase = createClient(`https://${ref}.supabase.co`, clave, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const bucket = supabase.storage.from(PLANT_PHOTOS_BUCKET)

  console.log(
    `Proyecto de ${ambiente} (${ref}), bucket ${PLANT_PHOTOS_BUCKET}. ` +
      (borrar
        ? 'Modo BORRAR.'
        : 'Modo de prueba: no se borra nada (usa --borrar para borrar).'),
  )
  await runOrphanCleanup(argumentos, {
    listObjects: () => listarObjetos(bucket),
    listPlants: () =>
      leerTabla(supabase, 'plants', 'id, user_id, photo_path, thumbnail_path'),
    listPlantPhotos: () => leerFotos(supabase),
    removeObjects: async (rutas) => {
      const { error } = await bucket.remove(rutas)
      if (error) throw new Error(error.message)
    },
    log: (linea) => console.log(linea),
    now: Date.now(),
  })
}

main().catch((error) => {
  fallar(error instanceof Error ? error.message : String(error))
})
