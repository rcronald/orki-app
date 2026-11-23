// Comprueba las entradas del workflow «Fotos de referencia»
// (.github/workflows/fotos-de-referencia.yml) y las convierte en los argumentos de
// `orki-catalogo cargar-fotos-inaturalist` y `orki-catalogo limpiar-fotos-referencia`.
//
// Las entradas llegan solo por variables de entorno (nunca interpoladas en el código del paso)
// y aquí se validan contra listas cerradas o expresiones estrictas antes de usarlas, para que
// no se puedan inyectar órdenes ni opciones. Los argumentos se escriben uno por línea en dos
// archivos que el paso de bash lee con `mapfile` y pasa como un arreglo, sin que el shell los
// vuelva a interpretar.
//
// Uso (en el workflow): node scripts/fotos-de-referencia/entradas.mjs
//   Variables: AMBIENTE, MODO, GENEROS, MAX_ESPECIES, TODO_EL_CATALOGO, ALTERNATIVAS, LIMPIAR,
//   REF_GIT, REF_PROYECTO, POOLER_HOST; ARGUMENTOS_CARGA y ARGUMENTOS_LIMPIEZA (rutas de
//   salida) y GITHUB_OUTPUT.

import { appendFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const AMBIENTES = ['dev', 'prod']
export const MODOS = ['simular', 'escribir']
export const ALTERNATIVAS = ['ninguna', 'taxon', 'observaciones']
export const LIMPIEZAS = ['no', 'listar', 'borrar']
export const MAX_GENEROS = 50
export const MAX_ESPECIES = 1_000_000

// Un género: letras ASCII, con guiones solo entre letras («Brassia», «Rhyncholaeliocattleya»;
// los nothogéneros de iNaturalist se escriben sin el signo «×»).
const GENERO = /^[A-Za-z]+(?:-[A-Za-z]+)*$/
const NUMERO = /^[1-9][0-9]*$/
const REF = /^[a-z0-9]{20}$/
const POOLER = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/

/**
 * Valida las entradas. Devuelve los argumentos de la carga y, si se pidió, de la limpieza, o
 * la lista de errores (todos a la vez, para corregirlos de una vez).
 *
 * @param {Record<string, string | undefined>} e
 */
export function validarEntradas(e) {
  const errores = []
  const ambiente = e.AMBIENTE ?? ''
  const modo = e.MODO ?? ''
  const alternativas = e.ALTERNATIVAS || 'taxon'
  const limpiar = e.LIMPIAR || 'no'
  const todo = e.TODO_EL_CATALOGO ?? 'false'
  const refProyecto = e.REF_PROYECTO ?? ''

  if (!AMBIENTES.includes(ambiente)) {
    errores.push('Ambiente no válido: tiene que ser dev o prod.')
  }
  if (!MODOS.includes(modo)) {
    errores.push('Modo no válido: tiene que ser simular o escribir.')
  }
  if (!ALTERNATIVAS.includes(alternativas)) {
    errores.push(
      'alternativas no válido: tiene que ser ninguna, taxon u observaciones.',
    )
  }
  if (!LIMPIEZAS.includes(limpiar)) {
    errores.push('limpiar no válido: tiene que ser no, listar o borrar.')
  }
  if (todo !== 'true' && todo !== 'false') {
    errores.push('todo_el_catalogo no válido: tiene que ser true o false.')
  }
  if (ambiente === 'prod' && e.REF_GIT !== 'refs/heads/main') {
    errores.push('Producción solo se carga desde main.')
  }
  if (!REF.test(refProyecto)) {
    errores.push(
      `Falta la variable SUPABASE_PROJECT_REF del environment ${ambiente || '(sin ambiente)'} o no es un identificador de proyecto.`,
    )
  }
  if (!POOLER.test(e.POOLER_HOST ?? '')) {
    errores.push(
      `Falta la variable SUPABASE_POOLER_HOST del environment ${ambiente || '(sin ambiente)'} (aws-<n>-<región>.pooler.supabase.com) o no tiene ese formato. Ver scripts/catalog-import/README.md.`,
    )
  }

  const generos = []
  const textoGeneros = (e.GENEROS ?? '').trim()
  if (textoGeneros !== '') {
    for (const parte of textoGeneros.split(',')) {
      const genero = parte.trim()
      if (!GENERO.test(genero) || genero.length > 60) {
        errores.push(
          `Género no válido: «${limpiarParaMensaje(genero)}». Solo letras y guiones, separados por comas (por ejemplo «Phalaenopsis,Masdevallia»).`,
        )
        continue
      }
      if (!generos.some((g) => g.toLowerCase() === genero.toLowerCase())) {
        generos.push(genero)
      }
    }
    if (generos.length > MAX_GENEROS) {
      errores.push(
        `Demasiados géneros: como mucho ${MAX_GENEROS} por ejecución.`,
      )
    }
  }

  const textoMax = (e.MAX_ESPECIES ?? '').trim()
  let maxEspecies = null
  if (textoMax !== '') {
    if (!NUMERO.test(textoMax) || Number(textoMax) > MAX_ESPECIES) {
      errores.push(
        `max_especies no válido: tiene que ser un número entero entre 1 y ${MAX_ESPECIES}, sin signos ni decimales.`,
      )
    } else {
      maxEspecies = Number(textoMax)
    }
  }

  if (todo === 'true' && textoGeneros !== '') {
    errores.push('todo_el_catalogo y generos no se pueden usar juntos.')
  }
  if (limpiar === 'borrar' && modo !== 'escribir') {
    errores.push(
      'limpiar = borrar solo se admite con modo = escribir (una simulación no borra nada). Para ver qué se borraría, limpiar = listar.',
    )
  }

  if (errores.length > 0) {
    return { ok: false, errores }
  }

  const escribir = modo === 'escribir'
  const confirmacion =
    ambiente === 'prod' ? ['--confirmar-produccion', refProyecto] : []
  const carga = ['--ambiente', ambiente]
  for (const genero of generos) {
    carga.push('--genero', genero)
  }
  if (todo === 'true') {
    carga.push('--todo-el-catalogo')
  }
  if (maxEspecies !== null) {
    carga.push('--max-especies', String(maxEspecies))
  }
  carga.push('--alternativas', alternativas)
  if (escribir) {
    carga.push('--escribir', ...confirmacion)
  }

  let limpieza = null
  if (limpiar !== 'no') {
    limpieza = ['--ambiente', ambiente]
    if (limpiar === 'borrar') {
      limpieza.push('--borrar', ...confirmacion)
    }
  }

  return {
    ok: true,
    carga,
    limpieza,
    alcance: describirAlcance(generos, todo === 'true', maxEspecies),
  }
}

/** El alcance en palabras, para el registro y el resumen. */
export function describirAlcance(generos, todo, maxEspecies) {
  let texto
  if (todo) {
    texto = 'todo el catálogo'
  } else if (generos.length > 0) {
    texto = `géneros ${generos.join(', ')}`
  } else {
    texto =
      'el de la orden (especies en alguna colección y los ocho géneros comunes)'
  }
  return maxEspecies === null
    ? texto
    : `${texto}, como mucho ${maxEspecies} especies`
}

// Un valor rechazado se muestra recortado y sin caracteres de control, para que no pueda
// colar un comando de flujo de trabajo («::») ni saltos de línea en el registro.
function limpiarParaMensaje(texto) {
  const limpio = texto
    .replace(/[^\p{L}\p{N} ._-]/gu, '?')
    .replaceAll('::', '?')
    .slice(0, 60)
  return limpio || '(vacío)'
}

function principal(entorno) {
  const resultado = validarEntradas(entorno)
  if (!resultado.ok) {
    for (const mensaje of resultado.errores) {
      console.log(`::error::${mensaje}`)
    }
    console.log('No se ha conectado a nada.')
    return 1
  }
  writeFileSync(entorno.ARGUMENTOS_CARGA, resultado.carga.join('\n') + '\n')
  writeFileSync(
    entorno.ARGUMENTOS_LIMPIEZA,
    resultado.limpieza ? resultado.limpieza.join('\n') + '\n' : '',
  )
  if (entorno.GITHUB_OUTPUT) {
    appendFileSync(
      entorno.GITHUB_OUTPUT,
      `limpiar=${resultado.limpieza ? (entorno.LIMPIAR ?? 'no') : 'no'}\nalcance=${resultado.alcance}\n`,
    )
  }
  console.log(`Ambiente: ${entorno.AMBIENTE}. Modo: ${entorno.MODO}.`)
  console.log(`Alcance: ${resultado.alcance}.`)
  console.log(`Argumentos de la carga: ${resultado.carga.join(' ')}`)
  if (resultado.limpieza) {
    console.log(`Argumentos de la limpieza: ${resultado.limpieza.join(' ')}`)
  }
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = principal(process.env)
}
