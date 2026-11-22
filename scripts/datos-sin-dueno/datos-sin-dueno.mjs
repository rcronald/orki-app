// Lógica del script de detección de datos sin dueño (#112, parte de #26).
//
// Lo ejecuta scripts/datos-sin-dueno/index.mjs, que solo le pasa las dependencias
// reales (el cliente de Supabase, fetch y la consola). Todo lo demás vive aquí,
// con las dependencias inyectadas, para probarlo sin red con node:test
// (datos-sin-dueno.test.mjs). La documentación está en el README de esta carpeta.
//
// Regla principal: un usuario solo cuenta como «sin dueño» si la API de Clerk
// responde 404 con el código resource_not_found al pedirlo por su id. Cualquier
// otra respuesta (límite de peticiones, error del servidor, clave rechazada, red
// caída, cuerpo ilegible o que no es el usuario pedido) detiene el script antes
// de borrar nada.

import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

/** Ref del proyecto de Supabase de cada ambiente (los de scripts/supabase-db.mjs). */
export const REFS = {
  desarrollo: 'xaitolsnmjlpyptntfwi',
  produccion: 'fzundhfxnbyjbxyhkgtg',
}

/**
 * Prefijo de la clave secreta de Clerk de cada ambiente: las instancias de
 * desarrollo usan claves sk_test_ y las de producción sk_live_.
 */
export const PREFIJOS_CLAVE_CLERK = {
  desarrollo: 'sk_test_',
  produccion: 'sk_live_',
}

export const VARIABLES = [
  'SUPABASE_PROJECT_REF',
  'SUPABASE_SECRET_KEY',
  'CLERK_SECRET_KEY',
]

/**
 * Proporción máxima de usuarios sin dueño con la que se borra sin
 * --permitir-proporcion-alta. Más que esto suele indicar una clave de Clerk de
 * otra instancia o un fallo de Clerk, no bajas reales.
 */
export const TOPE_PROPORCION = 0.25

/** Formato de un id de usuario de Clerk. Lo demás no se consulta ni se borra. */
export const FORMATO_USUARIO = /^user_[A-Za-z0-9]{1,64}$/

export const URL_CLERK = 'https://api.clerk.com/v1'

/** Pausa entre peticiones a Clerk: unas 8 por segundo, bajo el límite de desarrollo. */
export const PAUSA_CLERK_MS = 120

const PAGINA = 1000
const LOTE = 100

/** Error de Clerk: detiene el script y nunca se interpreta como «no existe». */
export class ErrorClerk extends Error {
  constructor(mensaje, opciones) {
    super(mensaje, opciones)
    this.name = 'ErrorClerk'
  }
}

// Argumentos -----------------------------------------------------------------

/**
 * Lee los argumentos. Lanza Error con un texto en español si falta o sobra
 * algo. Por defecto solo lista (modo de prueba).
 */
export function leerArgumentos(argv) {
  let ambiente
  let borrar = false
  let confirmarProduccion = null
  let permitirProporcionAlta = false
  for (let indice = 0; indice < argv.length; indice += 1) {
    const argumento = argv[indice]
    switch (argumento) {
      case '--ambiente': {
        const valor = argv[indice + 1]
        indice += 1
        if (valor !== 'desarrollo' && valor !== 'produccion') {
          throw new Error('--ambiente debe ser "desarrollo" o "produccion".')
        }
        ambiente = valor
        break
      }
      case '--borrar':
        borrar = true
        break
      case '--confirmar-produccion': {
        const valor = argv[indice + 1]
        indice += 1
        if (!valor || valor.startsWith('--')) {
          throw new Error(
            '--confirmar-produccion necesita el identificador del proyecto de producción.',
          )
        }
        confirmarProduccion = valor
        break
      }
      case '--permitir-proporcion-alta':
        permitirProporcionAlta = true
        break
      default:
        throw new Error(`argumento desconocido: ${String(argumento)}`)
    }
  }
  if (!ambiente) {
    throw new Error(
      'indica el ambiente: --ambiente desarrollo o --ambiente produccion.',
    )
  }
  if (confirmarProduccion !== null && ambiente !== 'produccion') {
    throw new Error(
      '--confirmar-produccion solo se usa con --ambiente produccion.',
    )
  }
  if (permitirProporcionAlta && !borrar) {
    throw new Error('--permitir-proporcion-alta solo se usa con --borrar.')
  }
  if (
    ambiente === 'produccion' &&
    borrar &&
    confirmarProduccion !== REFS.produccion
  ) {
    throw new Error(
      'para borrar en producción hace falta además --confirmar-produccion con el identificador del proyecto de producción.',
    )
  }
  return { ambiente, borrar, permitirProporcionAlta }
}

// Credenciales y ambiente ----------------------------------------------------

/**
 * Lee las credenciales del entorno y, solo en desarrollo, de supabase/.env (el
 * entorno tiene prioridad). En producción solo del entorno: supabase/.env es
 * del proyecto de desarrollo. Los mensajes de error nombran las variables,
 * nunca sus valores.
 */
export function leerCredenciales({ ambiente, entorno, archivoEnv }) {
  let delArchivo = {}
  if (ambiente === 'desarrollo' && archivoEnv && existsSync(archivoEnv)) {
    try {
      delArchivo = parseEnv(readFileSync(archivoEnv, 'utf8'))
    } catch {
      throw new Error('no se pudo leer supabase/.env (¿formato incorrecto?).')
    }
  }
  const valores = {}
  for (const nombre of VARIABLES) {
    valores[nombre] = (entorno[nombre] || delArchivo[nombre] || '').trim()
  }
  const faltan = VARIABLES.filter((nombre) => !valores[nombre])
  if (faltan.length > 0) {
    throw new Error(
      `falta ${faltan.join(', ')}. ` +
        (ambiente === 'desarrollo'
          ? 'Defínelas en el entorno o en supabase/.env.'
          : 'En producción se leen solo del entorno, nunca de supabase/.env.'),
    )
  }
  return valores
}

/**
 * Protección de ambiente, antes de cualquier conexión: el proyecto de
 * Supabase y la instancia de Clerk tienen que ser los del ambiente indicado.
 */
export function comprobarAmbiente(ambiente, credenciales) {
  const ref = credenciales.SUPABASE_PROJECT_REF
  if (ref !== REFS[ambiente]) {
    const otro = ambiente === 'desarrollo' ? 'produccion' : 'desarrollo'
    throw new Error(
      `SUPABASE_PROJECT_REF (${ref}) no es el proyecto de ${ambiente} (${REFS[ambiente]})` +
        (ref === REFS[otro] ? `: es el de ${otro}` : '') +
        '. No se ha ejecutado nada.',
    )
  }
  const prefijo = PREFIJOS_CLAVE_CLERK[ambiente]
  if (!credenciales.CLERK_SECRET_KEY.startsWith(prefijo)) {
    throw new Error(
      `CLERK_SECRET_KEY no es una clave de la instancia de ${ambiente} de Clerk ` +
        `(tiene que empezar por ${prefijo}). Con la instancia equivocada todos los ` +
        'usuarios parecerían inexistentes. No se ha ejecutado nada.',
    )
  }
}

// Clerk ----------------------------------------------------------------------

/**
 * Cliente mínimo de la API de backend de Clerk. `fetch` se inyecta. La clave
 * solo va en la cabecera Authorization y no aparece en ningún mensaje.
 */
export function crearClienteClerk({
  clave,
  fetch,
  urlBase = URL_CLERK,
  pausaMs = PAUSA_CLERK_MS,
  esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms)),
}) {
  let peticiones = 0

  async function pedir(ruta) {
    if (peticiones > 0 && pausaMs > 0) await esperar(pausaMs)
    peticiones += 1
    let respuesta
    try {
      respuesta = await fetch(`${urlBase}${ruta}`, {
        headers: {
          Authorization: `Bearer ${clave}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(15000),
      })
    } catch (error) {
      throw new ErrorClerk(
        `no se pudo contactar con Clerk (${error?.name ?? 'error de red'}).`,
        { cause: error },
      )
    }
    let cuerpo
    try {
      cuerpo = await respuesta.json()
    } catch {
      cuerpo = null
    }
    return { estado: respuesta.status, cuerpo, respuesta }
  }

  function errorDeEstado(estado, respuesta, que) {
    if (estado === 429) {
      const tras = respuesta.headers?.get?.('retry-after')
      return new ErrorClerk(
        `Clerk limitó las peticiones (429) ${que}${tras ? `; reintenta tras ${tras} s` : ''}.`,
      )
    }
    if (estado === 401 || estado === 403) {
      return new ErrorClerk(`Clerk rechazó la clave (${estado}) ${que}.`)
    }
    return new ErrorClerk(`respuesta inesperada de Clerk (${estado}) ${que}.`)
  }

  return {
    /** Total de usuarios de la instancia: comprueba la clave antes de empezar. */
    async contarUsuarios() {
      const { estado, cuerpo, respuesta } = await pedir('/users/count')
      if (estado !== 200) {
        throw errorDeEstado(estado, respuesta, 'al contar los usuarios')
      }
      if (!Number.isInteger(cuerpo?.total_count) || cuerpo.total_count < 0) {
        throw new ErrorClerk(
          'respuesta incompleta de Clerk al contar los usuarios.',
        )
      }
      return cuerpo.total_count
    },

    /**
     * 'existe' o 'inexistente'. Solo un 404 con resource_not_found es
     * 'inexistente'; cualquier otra cosa lanza ErrorClerk.
     */
    async consultarUsuario(id) {
      const { estado, cuerpo, respuesta } = await pedir(
        `/users/${encodeURIComponent(id)}`,
      )
      const que = `al consultar ${id}`
      if (estado === 200) {
        if (cuerpo?.id === id) return 'existe'
        throw new ErrorClerk(`respuesta incompleta de Clerk ${que}.`)
      }
      if (estado === 404) {
        const errores = Array.isArray(cuerpo?.errors) ? cuerpo.errors : []
        if (errores.some((error) => error?.code === 'resource_not_found')) {
          return 'inexistente'
        }
        throw new ErrorClerk(
          `Clerk respondió 404 sin resource_not_found ${que}: no se da por inexistente.`,
        )
      }
      throw errorDeEstado(estado, respuesta, que)
    },
  }
}

// Supabase -------------------------------------------------------------------

/**
 * Lectura y borrado con un cliente de supabase-js creado con la clave
 * secreta (se salta RLS). Todo borrado filtra además por el usuario, para no
 * tocar nunca filas de otro aunque una lista de ids viniera mal.
 */
export function crearAccesoSupabase(supabase, nombreBucket) {
  const bucket = supabase.storage.from(nombreBucket)

  async function leerTabla(tabla, columnas) {
    const filas = []
    let ultimo = null
    for (;;) {
      let consulta = supabase.from(tabla).select(columnas)
      if (ultimo !== null) consulta = consulta.gt('id', ultimo)
      const { data, error } = await consulta
        .order('id', { ascending: true })
        .limit(PAGINA)
      if (error) throw new Error(`no se pudo leer ${tabla}: ${error.message}`)
      filas.push(...data)
      if (data.length < PAGINA) return filas
      ultimo = data.at(-1).id
    }
  }

  async function listar(carpeta) {
    const entradas = []
    for (let offset = 0; ; offset += PAGINA) {
      const { data, error } = await bucket.list(carpeta, {
        limit: PAGINA,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      })
      if (error) {
        throw new Error(
          `no se pudo listar "${carpeta}" en ${nombreBucket}: ${error.message}`,
        )
      }
      entradas.push(...data)
      if (data.length < PAGINA) return entradas
    }
  }

  async function listarRecursivo(carpeta) {
    const rutas = []
    for (const entrada of await listar(carpeta)) {
      const ruta = `${carpeta}/${entrada.name}`
      // Storage devuelve las carpetas sin id.
      if (entrada.id === null) rutas.push(...(await listarRecursivo(ruta)))
      else rutas.push(ruta)
    }
    return rutas
  }

  async function borrarFilas(tabla, usuario, ids) {
    let borradas = 0
    for (let indice = 0; indice < ids.length; indice += LOTE) {
      const { error, count } = await supabase
        .from(tabla)
        .delete({ count: 'exact' })
        .eq('user_id', usuario)
        .in('id', ids.slice(indice, indice + LOTE))
      if (error) throw new Error(`${tabla}: ${error.message}`)
      borradas += count ?? 0
    }
    return borradas
  }

  return {
    leerPerfiles: () => leerTabla('profiles', 'id'),
    leerPlantas: () => leerTabla('plants', 'id, user_id'),
    leerEventos: () => leerTabla('product_events', 'id, user_id'),
    /** Carpetas del primer nivel del bucket: una por usuario. */
    listarCarpetasDeUsuario: async () =>
      (await listar(''))
        .filter((entrada) => entrada.id === null)
        .map((entrada) => entrada.name),
    listarFotosDeUsuario: (usuario) => listarRecursivo(usuario),
    async borrarFotos(usuario, rutas) {
      if (rutas.some((ruta) => !ruta.startsWith(`${usuario}/`))) {
        throw new Error(`hay rutas fuera de la carpeta de ${usuario}.`)
      }
      for (let indice = 0; indice < rutas.length; indice += LOTE) {
        const { error } = await bucket.remove(
          rutas.slice(indice, indice + LOTE),
        )
        if (error) throw new Error(`${nombreBucket}: ${error.message}`)
      }
      return rutas.length
    },
    borrarPlantas: (usuario, ids) => borrarFilas('plants', usuario, ids),
    borrarEventos: (usuario, ids) =>
      borrarFilas('product_events', usuario, ids),
    async borrarPerfil(usuario) {
      const { error, count } = await supabase
        .from('profiles')
        .delete({ count: 'exact' })
        .eq('id', usuario)
      if (error) throw new Error(`profiles: ${error.message}`)
      return count ?? 0
    },
  }
}

// Detección ------------------------------------------------------------------

function agrupar(filas, columna) {
  const grupos = new Map()
  for (const fila of filas) {
    const clave = fila[columna]
    if (!grupos.has(clave)) grupos.set(clave, [])
    grupos.get(clave).push(fila.id)
  }
  return grupos
}

/**
 * Reúne los usuarios que aparecen en perfiles, plantas, eventos de producto y
 * carpetas del bucket, y pregunta a Clerk por cada uno. Si Clerk falla, lanza
 * y no devuelve ningún huérfano.
 */
export async function detectar(datos, clerk) {
  const [perfiles, plantas, eventos, carpetas] = [
    await datos.leerPerfiles(),
    await datos.leerPlantas(),
    await datos.leerEventos(),
    await datos.listarCarpetasDeUsuario(),
  ]
  const conPerfil = new Set(perfiles.map((perfil) => perfil.id))
  const plantasPorUsuario = agrupar(plantas, 'user_id')
  const eventosPorUsuario = agrupar(eventos, 'user_id')
  const conCarpeta = new Set(carpetas)
  const usuarios = [
    ...new Set([
      ...conPerfil,
      ...plantasPorUsuario.keys(),
      ...eventosPorUsuario.keys(),
      ...conCarpeta,
    ]),
  ].sort()

  const resumen = (id) => ({
    id,
    perfil: conPerfil.has(id),
    plantas: plantasPorUsuario.get(id) ?? [],
    eventos: eventosPorUsuario.get(id) ?? [],
    carpeta: conCarpeta.has(id),
  })

  const validos = usuarios.filter((id) => FORMATO_USUARIO.test(id))
  const formatoDesconocido = usuarios
    .filter((id) => !FORMATO_USUARIO.test(id))
    .map(resumen)

  const totalClerk = await clerk.contarUsuarios()
  const existentes = []
  const inexistentes = []
  for (const id of validos) {
    const estado = await clerk.consultarUsuario(id)
    if (estado === 'existe') existentes.push(id)
    else if (estado === 'inexistente') inexistentes.push(id)
    else throw new ErrorClerk(`estado desconocido para ${id}.`)
  }

  const huerfanos = []
  for (const id of inexistentes) {
    const usuario = resumen(id)
    usuario.fotos = usuario.carpeta ? await datos.listarFotosDeUsuario(id) : []
    huerfanos.push(usuario)
  }

  return {
    totalClerk,
    consultados: validos.length,
    existentes: existentes.length,
    huerfanos,
    formatoDesconocido,
  }
}

function describir(usuario) {
  const partes = [
    usuario.perfil ? 'perfil' : 'sin perfil',
    `${usuario.plantas.length} plantas`,
    `${usuario.eventos.length} eventos`,
  ]
  if (usuario.fotos) partes.push(`${usuario.fotos.length} fotos`)
  else if (usuario.carpeta) partes.push('carpeta en el bucket')
  return partes.join(', ')
}

// Ejecución ------------------------------------------------------------------

/**
 * Detecta, informa y, solo con `borrar`, borra los datos de los usuarios que
 * Clerk confirma inexistentes: fotos, plantas, eventos y perfil, en ese orden
 * (el de la app al eliminar una cuenta) y usuario por usuario.
 */
export async function ejecutar(
  { borrar, permitirProporcionAlta },
  { datos, clerk, log },
) {
  const informe = await detectar(datos, clerk)
  const { huerfanos } = informe
  log(
    `Usuarios en Supabase: ${informe.consultados + informe.formatoDesconocido.length}. ` +
      `Consultados en Clerk: ${informe.consultados} (la instancia tiene ${informe.totalClerk}). ` +
      `Existen: ${informe.existentes}. Sin dueño: ${huerfanos.length}.`,
  )
  for (const usuario of huerfanos) {
    log(`  ${usuario.id}: ${describir(usuario)}`)
  }
  if (informe.formatoDesconocido.length > 0) {
    log(
      `Ids con formato desconocido (no se consultan ni se borran): ${informe.formatoDesconocido.length}.`,
    )
    for (const usuario of informe.formatoDesconocido) {
      log(`  ${JSON.stringify(usuario.id)}: ${describir(usuario)}`)
    }
  }

  const sinBorrar = { informe, borrados: null }
  if (!borrar) {
    log('Modo de prueba: no se ha borrado nada (usa --borrar para borrar).')
    return sinBorrar
  }
  if (huerfanos.length === 0) {
    log('No hay nada que borrar.')
    return sinBorrar
  }
  const proporcion = huerfanos.length / informe.consultados
  if (proporcion > TOPE_PROPORCION && !permitirProporcionAlta) {
    throw new Error(
      `${huerfanos.length} de ${informe.consultados} usuarios (${Math.round(proporcion * 100)} %) ` +
        `estarían sin dueño, más del ${TOPE_PROPORCION * 100} %. Puede ser una clave de otra ` +
        'instancia de Clerk. Revisa la lista y, si es correcta, repite con ' +
        '--permitir-proporcion-alta. No se ha borrado nada.',
    )
  }

  const borrados = {
    usuarios: 0,
    fotos: 0,
    plantas: 0,
    eventos: 0,
    perfiles: 0,
  }
  for (const usuario of huerfanos) {
    try {
      if (usuario.fotos.length > 0) {
        borrados.fotos += await datos.borrarFotos(usuario.id, usuario.fotos)
      }
      if (usuario.plantas.length > 0) {
        borrados.plantas += await datos.borrarPlantas(
          usuario.id,
          usuario.plantas,
        )
      }
      if (usuario.eventos.length > 0) {
        borrados.eventos += await datos.borrarEventos(
          usuario.id,
          usuario.eventos,
        )
      }
      if (usuario.perfil) {
        borrados.perfiles += await datos.borrarPerfil(usuario.id)
      }
    } catch (error) {
      throw new Error(
        `falló el borrado de ${usuario.id} tras ${borrados.usuarios} usuarios completos ` +
          `(${error instanceof Error ? error.message : String(error)}). ` +
          'Vuelve a ejecutarlo para seguir: lo ya borrado no se vuelve a detectar.',
        { cause: error },
      )
    }
    borrados.usuarios += 1
    log(`  Borrado ${usuario.id}.`)
  }
  log(
    `Borrados: ${borrados.usuarios} usuarios, ${borrados.fotos} fotos, ${borrados.plantas} plantas, ` +
      `${borrados.eventos} eventos y ${borrados.perfiles} perfiles.`,
  )
  return { informe, borrados }
}

/**
 * Todo el script con las dependencias inyectadas: argumentos, credenciales,
 * protección de ambiente y ejecución. No crea ningún cliente ni hace ninguna
 * petición hasta haber pasado la protección de ambiente.
 */
export async function principal({
  argv,
  entorno,
  archivoEnv,
  crearSupabase,
  nombreBucket,
  fetch,
  log,
  pausaMs,
  esperar,
}) {
  const argumentos = leerArgumentos(argv)
  const credenciales = leerCredenciales({
    ambiente: argumentos.ambiente,
    entorno,
    archivoEnv,
  })
  comprobarAmbiente(argumentos.ambiente, credenciales)

  const ref = credenciales.SUPABASE_PROJECT_REF
  log(
    `Proyecto de ${argumentos.ambiente} (${ref}) e instancia de ${argumentos.ambiente} de Clerk. ` +
      (argumentos.borrar
        ? 'Modo BORRAR.'
        : 'Modo de prueba: no se borra nada.'),
  )
  const supabase = crearSupabase(
    `https://${ref}.supabase.co`,
    credenciales.SUPABASE_SECRET_KEY,
  )
  return ejecutar(argumentos, {
    datos: crearAccesoSupabase(supabase, nombreBucket),
    clerk: crearClienteClerk({
      clave: credenciales.CLERK_SECRET_KEY,
      fetch,
      pausaMs,
      esperar,
    }),
    log,
  })
}
