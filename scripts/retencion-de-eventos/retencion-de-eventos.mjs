// Lógica del script de retención de los eventos de producto (#293).
//
// Lo ejecuta scripts/retencion-de-eventos/index.mjs (y, cada día, el workflow «Retención de
// eventos»), que solo le pasa las dependencias reales. Aquí está todo lo demás, con las
// dependencias inyectadas, para probarlo sin red (retencion-de-eventos.test.mjs).
//
// El script no decide qué se borra: llama a public.purge_expired_product_events(), que borra
// en la base los eventos de más de 13 meses (migración 20261125120000_retencion_de_eventos.sql)
// y devuelve cuántos borró. Solo service_role puede ejecutarla, así que hace falta la clave
// secreta del proyecto.

import { REFS } from '../datos-sin-dueno/datos-sin-dueno.mjs'

export { REFS }

export const VARIABLES = ['SUPABASE_PROJECT_REF', 'SUPABASE_SECRET_KEY']

export const FUNCION = 'purge_expired_product_events'

/** Códigos de PostgREST para una función que no está en su caché (migración sin aplicar). */
const CODIGOS_FUNCION_INEXISTENTE = ['PGRST202', '42883']

/** Lee los argumentos: solo --ambiente desarrollo|produccion, obligatorio. */
export function leerArgumentos(argv) {
  let ambiente
  for (let indice = 0; indice < argv.length; indice += 1) {
    const argumento = argv[indice]
    if (argumento === '--ambiente') {
      const valor = argv[indice + 1]
      indice += 1
      if (valor !== 'desarrollo' && valor !== 'produccion') {
        throw new Error('--ambiente debe ser "desarrollo" o "produccion".')
      }
      ambiente = valor
    } else {
      throw new Error(`argumento desconocido: ${String(argumento)}`)
    }
  }
  if (!ambiente) {
    throw new Error(
      'indica el ambiente: --ambiente desarrollo o --ambiente produccion.',
    )
  }
  return { ambiente }
}

/**
 * Lee las credenciales solo del entorno (el workflow las toma de los secretos del
 * environment) y comprueba que el proyecto es el del ambiente indicado, antes de crear
 * ningún cliente. Los mensajes nombran las variables, nunca sus valores.
 */
export function leerCredenciales(ambiente, entorno) {
  const valores = {}
  for (const nombre of VARIABLES)
    valores[nombre] = (entorno[nombre] ?? '').trim()
  const faltan = VARIABLES.filter((nombre) => !valores[nombre])
  if (faltan.length > 0) {
    throw new Error(`falta ${faltan.join(', ')} en el entorno.`)
  }
  if (valores.SUPABASE_PROJECT_REF !== REFS[ambiente]) {
    throw new Error(
      `SUPABASE_PROJECT_REF (${valores.SUPABASE_PROJECT_REF}) no es el proyecto de ${ambiente} ` +
        `(${REFS[ambiente]}). No se ha ejecutado nada.`,
    )
  }
  return valores
}

/** Todo el script con las dependencias inyectadas. Devuelve cuántos eventos se borraron. */
export async function principal({ argv, entorno, crearSupabase, log }) {
  const { ambiente } = leerArgumentos(argv)
  const credenciales = leerCredenciales(ambiente, entorno)
  const ref = credenciales.SUPABASE_PROJECT_REF
  log(
    `Proyecto de ${ambiente} (${ref}): borrar los eventos de producto de más de 13 meses.`,
  )
  const supabase = crearSupabase(
    `https://${ref}.supabase.co`,
    credenciales.SUPABASE_SECRET_KEY,
  )
  const { data, error } = await supabase.rpc(FUNCION)
  if (error) {
    if (CODIGOS_FUNCION_INEXISTENTE.includes(error.code)) {
      throw new Error(
        `el proyecto no tiene la función public.${FUNCION}(): falta aplicar la migración ` +
          '20261125120000_retencion_de_eventos.sql. No se ha borrado nada.',
      )
    }
    throw new Error(
      `falló public.${FUNCION}() (${error.code ?? 'sin código'}): ${error.message}. ` +
        'Si es un 401 o un permiso denegado, revisa que SUPABASE_SECRET_KEY sea la clave secreta del proyecto.',
    )
  }
  if (!Number.isInteger(data) || data < 0) {
    throw new Error(
      `respuesta inesperada de public.${FUNCION}(): ${JSON.stringify(data)}.`,
    )
  }
  log(`Eventos de más de 13 meses borrados: ${data}.`)
  return data
}
