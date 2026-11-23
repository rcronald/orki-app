// Base de datos Postgres desechable con el esquema de Orki.
//
// Crea una base de datos vacía en un servidor Postgres local, le añade lo mínimo de Supabase
// que necesitan las migraciones (supabase-minimo.sql), aplica todas las migraciones de
// supabase/migrations en orden y, al terminar, la borra. La usan las pruebas de base de datos
// (scripts/db-test.mjs) y sirve para cualquier otra tarea que necesite el esquema sin tocar
// los proyectos de Supabase (por ejemplo, generar tipos).
//
// El servidor puede ser:
//   - Uno que ya tengas, indicado con ORKI_TEST_DB_URL (postgresql://usuario:clave@host:puerto/base).
//     El usuario debe ser superusuario. Solo se aceptan hosts locales (localhost, 127.x.x.x,
//     ::1) salvo el host que se nombre en ORKI_TEST_DB_ALLOW_HOST, y nunca uno de Supabase.
//     La base de la URL solo se usa para conectarse: se trabaja en una base nueva con nombre
//     propio (orki_pruebas_...), que se borra al terminar.
//   - Un clúster temporal, si no se define ORKI_TEST_DB_URL: se crea con initdb y pg_ctl en
//     un directorio temporal, escucha solo en 127.0.0.1 en un puerto libre, con contraseña
//     aleatoria, y se destruye al terminar. Los binarios se buscan en ORKI_PG_BINDIR, en el
//     PostgreSQL 17 de Homebrew (/opt/homebrew/opt/postgresql@17/bin o /usr/local/...), en
//     el directorio que indica pg_config --bindir y en el PATH.
//
// El servidor tiene que ser PostgreSQL 17 o posterior, como el CI y Supabase; con uno anterior
// falla con un mensaje que dice cómo instalarlo, salvo con ORKI_PERMITIR_PG_ANTIGUO=1.
//
// Uso desde otro script:
//   import { conBaseDesechable } from './db-desechable/index.mjs'
//   await conBaseDesechable(async ({ conexion, consultar, ejecutarPsql }) => { ... })

import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const raizRepositorio = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)
export const directorioMigraciones = join(
  raizRepositorio,
  'supabase',
  'migrations',
)
const archivoSupabaseMinimo = join(
  dirname(fileURLToPath(import.meta.url)),
  'supabase-minimo.sql',
)

// Roles que crea supabase-minimo.sql si no existen.
const rolesSimulados = [
  'anon',
  'authenticated',
  'service_role',
  'postgres',
  'supabase_storage_admin',
]

const hostsLocales = new Set(['localhost', '::1'])
const dominiosSupabase = ['supabase.co', 'supabase.com', 'supabase.net']

// Error que se explica solo: el mensaje basta, sin traza.
export class ErrorDeBaseDesechable extends Error {}

// Versión mínima del servidor: la del CI y la de los proyectos de Supabase. Con una anterior,
// algo puede pasar en local y fallar en el CI (en el 17, "text || char" no se resuelve solo;
// en el 14 no existen security_invoker ni nulls not distinct y PUBLIC puede crear en public).
export const versionMinimaPostgres = 17

// Falla con un mensaje claro si el servidor es anterior a la versión mínima, salvo con
// ORKI_PERMITIR_PG_ANTIGUO=1, que solo avisa. "numero" es server_version_num (170012).
export function comprobarVersionPostgres(
  numero,
  version,
  entorno = process.env,
  avisar = console.warn,
) {
  if (Math.floor(Number(numero) / 10000) >= versionMinimaPostgres) return
  const motivo =
    `el servidor es PostgreSQL ${version} y hace falta el ${versionMinimaPostgres} o posterior, ` +
    'la misma versión mayor que el CI y Supabase: con otra, una prueba puede pasar aquí y fallar en el CI.'
  if (entorno.ORKI_PERMITIR_PG_ANTIGUO === '1') {
    avisar(
      `Aviso: ${motivo} Se sigue porque ORKI_PERMITIR_PG_ANTIGUO=1; el resultado del CI es el que cuenta.`,
    )
    return
  }
  throw new ErrorDeBaseDesechable(
    `${motivo}\n` +
      `  - En macOS: "brew install postgresql@${versionMinimaPostgres}". El script usa sus binarios aunque ` +
      `no estén en el PATH (/opt/homebrew/opt/postgresql@${versionMinimaPostgres}/bin); si están en otro ` +
      'sitio, indica el directorio en ORKI_PG_BINDIR.\n' +
      `  - O un contenedor desechable con postgres:${versionMinimaPostgres} y su URL en ORKI_TEST_DB_URL ` +
      '(ver "Pruebas de la base de datos" en el README).\n' +
      '  - Para usar esta versión de todos modos (sin garantías), ORKI_PERMITIR_PG_ANTIGUO=1.',
  )
}

// Conexión al servidor -------------------------------------------------------------------

export function esHostDeSupabase(host) {
  const normalizado = host.toLowerCase().replace(/\.$/, '')
  return dominiosSupabase.some(
    (dominio) => normalizado === dominio || normalizado.endsWith(`.${dominio}`),
  )
}

function esHostLocal(host) {
  return hostsLocales.has(host) || /^127(\.\d{1,3}){3}$/.test(host)
}

// Convierte la URL en los datos de conexión, o falla si no es segura. Los mensajes de error
// nunca incluyen la URL, porque puede llevar la contraseña.
export function conexionDesdeUrl(texto, { hostPermitido } = {}) {
  let url
  try {
    url = new URL(texto)
  } catch {
    throw new ErrorDeBaseDesechable(
      'ORKI_TEST_DB_URL no es una URL válida. Formato: postgresql://usuario:clave@localhost:5432/postgres',
    )
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new ErrorDeBaseDesechable(
      'ORKI_TEST_DB_URL debe empezar por postgresql:// o postgres://.',
    )
  }

  const host = url.hostname
    .replace(/^\[(.*)\]$/, '$1')
    .toLowerCase()
    .replace(/\.$/, '')
  if (!host) {
    throw new ErrorDeBaseDesechable('ORKI_TEST_DB_URL debe indicar el host.')
  }
  if (esHostDeSupabase(host)) {
    throw new ErrorDeBaseDesechable(
      `ORKI_TEST_DB_URL apunta a Supabase (${host}). Las pruebas nunca se ejecutan contra los ` +
        'proyectos de desarrollo ni de producción: usa un Postgres local y desechable.',
    )
  }
  const permitido = hostPermitido?.trim().toLowerCase()
  if (!esHostLocal(host) && host !== permitido) {
    throw new ErrorDeBaseDesechable(
      `ORKI_TEST_DB_URL apunta a un host no local (${host}). Solo se aceptan localhost, ` +
        '127.x.x.x y ::1. Si ese servidor es desechable (por ejemplo, un contenedor), nómbralo ' +
        'en ORKI_TEST_DB_ALLOW_HOST.',
    )
  }

  // Cualquier otro parámetro (host, hostaddr, service...) podría llevar la conexión a otro
  // servidor distinto del que se acaba de comprobar.
  for (const clave of url.searchParams.keys()) {
    if (clave !== 'sslmode') {
      throw new ErrorDeBaseDesechable(
        `ORKI_TEST_DB_URL tiene un parámetro no admitido: "${clave}". Solo se admite sslmode.`,
      )
    }
  }

  const usuario = decodeURIComponent(url.username)
  if (!usuario) {
    throw new ErrorDeBaseDesechable(
      'ORKI_TEST_DB_URL debe indicar el usuario (un superusuario).',
    )
  }

  return {
    host,
    port: url.port || '5432',
    user: usuario,
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres',
    sslmode: url.searchParams.get('sslmode') ?? undefined,
  }
}

// Binarios de PostgreSQL ------------------------------------------------------------------

function enPath(nombre) {
  for (const directorio of (process.env.PATH ?? '').split(delimiter)) {
    if (directorio && existsSync(join(directorio, nombre)))
      return join(directorio, nombre)
  }
  return undefined
}

let directorioPgConfig
function directorioDePgConfig() {
  if (directorioPgConfig !== undefined) return directorioPgConfig
  directorioPgConfig = null
  const pgConfig = enPath('pg_config')
  if (pgConfig) {
    const resultado = spawnSync(pgConfig, ['--bindir'], { encoding: 'utf8' })
    if (resultado.status === 0) directorioPgConfig = resultado.stdout.trim()
  }
  return directorioPgConfig
}

// Directorios de Homebrew donde queda PostgreSQL 17 con "brew install postgresql@17". Es un
// paquete keg-only: no se enlaza en el PATH, así que si convive con otra versión (por ejemplo,
// la 14 enlazada), pg_config y el PATH darían la otra. Se prueban antes que ellos para usar la
// misma versión mayor que el CI y Supabase sin tener que tocar el PATH.
const directoriosHomebrewPg17 = [
  '/opt/homebrew/opt/postgresql@17/bin',
  '/usr/local/opt/postgresql@17/bin',
]

export function buscarBinario(nombre) {
  const candidatos = [
    process.env.ORKI_PG_BINDIR,
    ...directoriosHomebrewPg17,
    directorioDePgConfig(),
  ]
  for (const directorio of candidatos) {
    if (directorio && existsSync(join(directorio, nombre)))
      return join(directorio, nombre)
  }
  const delPath = enPath(nombre)
  if (delPath) return delPath
  throw new ErrorDeBaseDesechable(
    `no se encontró "${nombre}" de PostgreSQL. Instala el cliente de PostgreSQL (por ejemplo, ` +
      '"brew install postgresql@17") o indica su directorio en ORKI_PG_BINDIR.',
  )
}

// psql ---------------------------------------------------------------------------------

// Entorno de psql: sin ninguna variable PG* heredada (podrían cambiar el servidor o la
// base) y con los datos de conexión. La contraseña va en PGPASSWORD, nunca en los argumentos.
function entornoPsql(conexion) {
  const entorno = {}
  for (const [clave, valor] of Object.entries(process.env)) {
    if (!clave.startsWith('PG') && clave !== 'PSQLRC') entorno[clave] = valor
  }
  Object.assign(entorno, {
    PGHOST: conexion.host,
    PGPORT: String(conexion.port),
    PGUSER: conexion.user,
    PGDATABASE: conexion.database,
    PGCONNECT_TIMEOUT: '10',
    PGAPPNAME: 'orki-db-desechable',
    PGCLIENTENCODING: 'UTF8',
    // Como en Supabase, la sesión trabaja en UTC. Los avisos (NOTICE) no aportan nada aquí.
    PGOPTIONS: '-c timezone=UTC -c client_min_messages=warning',
  })
  if (conexion.password) entorno.PGPASSWORD = conexion.password
  if (conexion.sslmode) entorno.PGSSLMODE = conexion.sslmode
  return entorno
}

// Ejecuta psql con los argumentos dados. Siempre sin .psqlrc, sin mensajes de estado y
// parando en el primer error. Devuelve { ok, stdout, stderr }.
export function ejecutarPsql(conexion, argumentos, { entrada } = {}) {
  const resultado = spawnSync(
    buscarBinario('psql'),
    [
      '-X',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      '-v',
      'SHOW_CONTEXT=never',
      ...argumentos,
    ],
    {
      env: entornoPsql(conexion),
      input: entrada,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  )
  if (resultado.error) {
    throw new ErrorDeBaseDesechable(
      `no se pudo ejecutar psql: ${resultado.error.message}`,
    )
  }
  return {
    ok: resultado.status === 0,
    stdout: resultado.stdout,
    stderr: resultado.stderr,
  }
}

// Ejecuta una consulta y devuelve las filas como líneas de texto (una columna por fila).
export function consultar(conexion, sql) {
  const resultado = ejecutarPsql(conexion, ['-A', '-t', '-c', sql])
  if (!resultado.ok) {
    throw new ErrorDeBaseDesechable(
      `falló la consulta "${sql}":\n${resultado.stderr.trim()}`,
    )
  }
  return resultado.stdout.split('\n').filter((linea) => linea !== '')
}

// Clúster temporal ---------------------------------------------------------------------

function puertoLibre() {
  return new Promise((resolver, rechazar) => {
    const servidor = createServer()
    servidor.unref()
    servidor.on('error', rechazar)
    servidor.listen(0, '127.0.0.1', () => {
      const { port } = servidor.address()
      servidor.close(() => resolver(port))
    })
  })
}

// Crea e inicia un clúster de Postgres en un directorio temporal. Devuelve la conexión del
// superusuario y una función que lo detiene y borra el directorio.
export async function iniciarClusterTemporal() {
  const initdb = buscarBinario('initdb')
  const pgCtl = buscarBinario('pg_ctl')
  const directorio = mkdtempSync(join(tmpdir(), 'orki-pg-'))
  const datos = join(directorio, 'datos')
  const registro = join(directorio, 'postgres.log')
  const archivoClave = join(directorio, 'clave')
  const clave = randomBytes(24).toString('hex')
  let iniciado = false

  const detener = () => {
    if (iniciado) {
      const parada = spawnSync(
        pgCtl,
        ['-D', datos, '-m', 'immediate', '-w', 'stop'],
        {
          encoding: 'utf8',
        },
      )
      if (parada.status !== 0) {
        // Último recurso: el PID del servidor está en la primera línea de postmaster.pid.
        try {
          const pid = Number(
            readFileSync(join(datos, 'postmaster.pid'), 'utf8').split('\n')[0],
          )
          if (pid > 0) process.kill(pid, 'SIGKILL')
        } catch {
          // Ya no está en marcha.
        }
      }
      iniciado = false
    }
    rmSync(directorio, { recursive: true, force: true })
  }

  try {
    writeFileSync(archivoClave, `${clave}\n`, { mode: 0o600 })
    // Se prueba primero una configuración regional como la de Supabase (minúsculas de
    // caracteres no ASCII); si el sistema no la tiene, se usa C.
    let creado = false
    let salida = ''
    for (const configuracion of ['en_US.UTF-8', 'C.UTF-8', 'C']) {
      rmSync(datos, { recursive: true, force: true })
      const resultado = spawnSync(
        initdb,
        [
          '-D',
          datos,
          '-U',
          'supabase_admin',
          `--pwfile=${archivoClave}`,
          '--auth=scram-sha-256',
          '--encoding=UTF8',
          `--locale=${configuracion}`,
        ],
        { encoding: 'utf8' },
      )
      salida = `${resultado.stdout}${resultado.stderr}`
      if (resultado.status === 0) {
        creado = true
        break
      }
    }
    rmSync(archivoClave, { force: true })
    if (!creado) {
      throw new ErrorDeBaseDesechable(
        `initdb no pudo crear el clúster temporal:\n${salida.trim()}`,
      )
    }

    const puerto = await puertoLibre()
    // Solo TCP en 127.0.0.1 (sin socket Unix) y sin fsync, porque los datos se tiran.
    const opciones = [
      `-p ${puerto}`,
      '-c listen_addresses=127.0.0.1',
      "-c unix_socket_directories=''",
      '-c fsync=off',
      '-c synchronous_commit=off',
      '-c full_page_writes=off',
      '-c timezone=UTC',
    ].join(' ')
    const arranque = spawnSync(
      pgCtl,
      ['-D', datos, '-l', registro, '-o', opciones, '-w', '-t', '60', 'start'],
      { encoding: 'utf8' },
    )
    iniciado = true
    if (arranque.status !== 0) {
      let log = ''
      try {
        log = readFileSync(registro, 'utf8')
          .trim()
          .split('\n')
          .slice(-15)
          .join('\n')
      } catch {
        // Sin registro.
      }
      throw new ErrorDeBaseDesechable(
        `no se pudo iniciar el clúster temporal:\n${arranque.stderr.trim()}\n${log}`,
      )
    }

    return {
      descripcion: `clúster temporal en 127.0.0.1:${puerto}`,
      conexion: {
        host: '127.0.0.1',
        port: String(puerto),
        user: 'supabase_admin',
        password: clave,
        database: 'postgres',
      },
      detener,
    }
  } catch (error) {
    detener()
    throw error
  }
}

// Servidor externo indicado por URL ------------------------------------------------------

export function servidorDesdeEntorno(entorno = process.env) {
  const conexion = conexionDesdeUrl(entorno.ORKI_TEST_DB_URL, {
    hostPermitido: entorno.ORKI_TEST_DB_ALLOW_HOST,
  })
  return {
    descripcion: `servidor de ORKI_TEST_DB_URL en ${conexion.host}:${conexion.port}`,
    conexion,
    detener: () => {},
  }
}

// Base de datos ------------------------------------------------------------------------

export function nombreBaseNueva() {
  const nombre = `orki_pruebas_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`
  // El nombre lo genera este script; se comprueba igualmente antes de usarlo en SQL.
  if (!/^[a-z0-9_]{1,63}$/.test(nombre))
    throw new Error(`nombre de base inválido: ${nombre}`)
  return nombre
}

function crearBase(conexion, nombre) {
  const resultado = ejecutarPsql(conexion, [
    '-c',
    `create database "${nombre}" template template0 encoding 'UTF8'`,
  ])
  if (!resultado.ok) {
    throw new ErrorDeBaseDesechable(
      `no se pudo crear la base de datos ${nombre}:\n${resultado.stderr.trim()}`,
    )
  }
}

function borrarBase(conexion, nombre) {
  const resultado = ejecutarPsql(conexion, [
    '-c',
    `drop database if exists "${nombre}" with (force)`,
  ])
  if (!resultado.ok) {
    console.error(
      `Aviso: no se pudo borrar la base de datos ${nombre}; bórrala a mano.\n${resultado.stderr.trim()}`,
    )
  }
}

// Lista ordenada de migraciones, como las aplica la CLI de Supabase (por su prefijo de fecha).
export function listarMigraciones() {
  return readdirSync(directorioMigraciones)
    .filter((archivo) => archivo.endsWith('.sql'))
    .sort()
}

// Prepara una base vacía: lo mínimo de Supabase y todas las migraciones, cada una en su
// transacción y con el rol "postgres", como la CLI de Supabase. "alAvanzar" recibe un evento
// por paso: { paso, ok }. Si un paso falla, lanza un error con el mensaje de Postgres.
export function prepararBase(conexion, { alAvanzar = () => {} } = {}) {
  const minimo = ejecutarPsql(conexion, ['-1', '-f', archivoSupabaseMinimo])
  if (!minimo.ok) {
    alAvanzar({ paso: 'mínimo de Supabase', ok: false })
    throw new ErrorDeBaseDesechable(
      `falló la preparación del mínimo de Supabase:\n${minimo.stderr.trim()}`,
    )
  }
  alAvanzar({ paso: 'mínimo de Supabase', ok: true })

  for (const archivo of listarMigraciones()) {
    const resultado = ejecutarPsql(conexion, [
      '-1',
      '-c',
      'set role postgres',
      '-f',
      join(directorioMigraciones, archivo),
    ])
    alAvanzar({ paso: archivo, ok: resultado.ok })
    if (!resultado.ok) {
      throw new ErrorDeBaseDesechable(
        `falló la migración ${archivo}:\n${resultado.stderr.trim()}`,
      )
    }
  }
}

// Ciclo completo ------------------------------------------------------------------------

const limpiezasPendientes = new Set()
let senalesRegistradas = false

function registrarSenales() {
  if (senalesRegistradas) return
  senalesRegistradas = true
  for (const senal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(senal, () => {
      console.error(`\nInterrumpido (${senal}): limpiando la base desechable.`)
      for (const limpiar of limpiezasPendientes) limpiar()
      process.exit(130)
    })
  }
}

// Obtiene un servidor (URL o clúster temporal), crea una base nueva, la prepara y llama a
// "trabajo" con { conexion, descripcion, version, consultar, ejecutarPsql }, donde conexion
// apunta a la base preparada. Pase lo que pase (también con Ctrl+C), al final borra la base,
// los roles simulados que creó en un servidor externo y, si lo creó, el clúster temporal.
export async function conBaseDesechable(
  trabajo,
  { alAvanzar, entorno = process.env } = {},
) {
  registrarSenales()
  const servidor = entorno.ORKI_TEST_DB_URL
    ? servidorDesdeEntorno(entorno)
    : await iniciarClusterTemporal()

  let nombre
  let rolesCreados = []
  let limpio = false
  const limpiar = () => {
    if (limpio) return
    limpio = true
    limpiezasPendientes.delete(limpiar)
    try {
      if (nombre) borrarBase(servidor.conexion, nombre)
      for (const rol of rolesCreados) {
        // Puede fallar si otra base del servidor ya los usa; entonces se quedan.
        ejecutarPsql(servidor.conexion, ['-c', `drop role if exists "${rol}"`])
      }
    } finally {
      servidor.detener()
    }
  }
  limpiezasPendientes.add(limpiar)

  try {
    const [version, numeroVersion, superusuario] = consultar(
      servidor.conexion,
      "select current_setting('server_version') || '|' || current_setting('server_version_num') || '|' || case when rolsuper then 't' else 'f' end from pg_roles where rolname = current_user",
    )[0].split('|')
    comprobarVersionPostgres(numeroVersion, version, entorno)
    if (superusuario !== 't') {
      throw new ErrorDeBaseDesechable(
        `el usuario "${servidor.conexion.user}" de ORKI_TEST_DB_URL no es superusuario; ` +
          'hace falta para crear la base de datos y los roles de Supabase.',
      )
    }

    const existentes = new Set(
      consultar(
        servidor.conexion,
        `select rolname from pg_roles where rolname in (${rolesSimulados.map((rol) => `'${rol}'`).join(', ')})`,
      ),
    )
    if (existentes.has('postgres')) {
      const [postgresEsSuperusuario] = consultar(
        servidor.conexion,
        "select rolsuper from pg_roles where rolname = 'postgres'",
      )
      if (postgresEsSuperusuario === 't') {
        console.warn(
          'Aviso: en este servidor el rol "postgres" es superusuario (en Supabase no lo es). ' +
            'Las migraciones se aplicarán con más permisos que en Supabase.',
        )
      }
    }

    nombre = nombreBaseNueva()
    crearBase(servidor.conexion, nombre)
    if (entorno.ORKI_TEST_DB_URL) {
      rolesCreados = rolesSimulados.filter((rol) => !existentes.has(rol))
    }

    const conexion = { ...servidor.conexion, database: nombre }
    prepararBase(conexion, { alAvanzar })
    return await trabajo({
      conexion,
      descripcion: servidor.descripcion,
      version,
      consultar: (sql) => consultar(conexion, sql),
      ejecutarPsql: (argumentos, opciones) =>
        ejecutarPsql(conexion, argumentos, opciones),
    })
  } finally {
    limpiar()
  }
}
