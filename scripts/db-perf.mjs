#!/usr/bin/env node
// Prueba de rendimiento de la búsqueda: npm run db:perf [-- opciones]
//
// Prepara una base Postgres desechable con todas las migraciones (scripts/db-desechable, la
// misma que usan las pruebas), carga un catálogo sintético del tamaño del real
// (scripts/db-perf/catalogo-sintetico.sql), hace vacuum analyze y ejecuta un conjunto de
// consultas típicas contra public.search_species() como anon, cada una varias veces. Reporta
// por consulta la mediana y el p95 del tiempo dentro de la base de datos, las filas devueltas
// y los recorridos de los índices de búsqueda y secuenciales de species y species_names
// (diferencia de pg_stat_user_indexes y pg_stat_user_tables, desde PostgreSQL 15), y el
// tamaño de las tablas e índices del catálogo. Nunca toca los proyectos de Supabase.
//
// Por defecto usa el clúster temporal con los binarios locales; para medir con la misma
// versión que Supabase, indica un Postgres 17 desechable en ORKI_TEST_DB_URL (ver
// supabase/README.md, "Rendimiento de la búsqueda").
//
// No corre en el CI: es una orden aparte. Termina con código 1 si el p95 de alguna consulta
// supera el umbral, si alguna no usa ningún índice de búsqueda o si recorre species_names de
// forma secuencial, y con 0 si todas cumplen.
//
// Opciones (todas opcionales):
//   --generos N        géneros del catálogo sintético (900)
//   --especies N       especies e híbridos aceptados (30000)
//   --sinonimos N      sinónimos (80000)
//   --comunes N        nombres comunes (3000)
//   --semilla TEXTO    semilla del generador; la misma da el mismo catálogo (orki)
//   --repeticiones N   ejecuciones medidas de cada consulta, tras 3 de calentamiento (30)
//   --umbral-ms N      objetivo de tiempo por consulta, en ms, comparado con el p95 (300)
//   --planes           muestra además el plan (explain analyze, buffers) de la consulta
//                      interna de search_species para cada consulta, con auto_explain
//   --catalogo-real RUTA
//                      en lugar del catálogo sintético, carga en la base desechable la
//                      exportación de COL indicada (export.zip) con "orki-catalogo cargar"
//                      (scripts/catalog-import, necesita uv); --generos, --especies,
//                      --sinonimos, --comunes y --semilla no se usan

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  conBaseDesechable,
  ErrorDeBaseDesechable,
  raizRepositorio,
} from './db-desechable/index.mjs'

const archivoGenerador = join(
  raizRepositorio,
  'scripts',
  'db-perf',
  'catalogo-sintetico.sql',
)

const calentamiento = 3

// Consultas típicas del autocompletado. El texto va tal cual a search_species(query) con el
// tope de resultados por defecto (10), como lo llama la app.
const consultas = [
  { descripcion: 'Prefijo de 2 letras', texto: 'ph' },
  { descripcion: 'Prefijo de 3 letras', texto: 'cat' },
  { descripcion: 'Prefijo de género', texto: 'dendrob' },
  { descripcion: 'Género + inicio de epíteto', texto: 'phal amab' },
  { descripcion: 'Abreviatura de género', texto: 'den nob' },
  { descripcion: 'Híbrido natural con «x»', texto: 'phal x interm' },
  { descripcion: 'Nombre completo con error', texto: 'catleya labiatta' },
  { descripcion: 'Sin tildes (nombre común)', texto: 'orquidea mariposa' },
  { descripcion: 'Sinónimo', texto: 'doritis pulch' },
  { descripcion: 'Nombre común', texto: 'dancing lady' },
  { descripcion: 'Sin resultados', texto: 'xqzvkjw' },
  { descripcion: 'Epíteto muy frecuente', texto: 'grandiflora' },
  { descripcion: 'Epíteto frecuente y corto', texto: 'alba' },
  {
    descripcion: 'Consulta larga',
    texto: 'phalaenopsis amabilis subsp. rosenstromii var. grandiflora',
  },
  // Añadidas al medir con el catálogo real (migración 20261120230000).
  { descripcion: 'Abreviatura sola', texto: 'phal' },
  { descripcion: 'Abreviatura con punto', texto: 'Phal. amab' },
  { descripcion: 'Prefijo que no es de género', texto: 'catl' },
  { descripcion: 'Género + inicio de epíteto', texto: 'cattleya lab' },
  { descripcion: 'Nombre completo con error', texto: 'catleya labiata' },
  { descripcion: 'Género grande con error', texto: 'dendrobum nobile' },
  { descripcion: 'Género con error', texto: 'masdevalia' },
  { descripcion: 'Híbrido natural sin «x»', texto: 'phalaenopsis intermedia' },
  { descripcion: 'Abreviatura sola', texto: 'onc' },
  { descripcion: 'Género + inicio de epíteto', texto: 'oncidium sph' },
  { descripcion: 'Género + inicio de epíteto', texto: 'vanda coer' },
  { descripcion: 'Abreviatura sola', texto: 'paph' },
  { descripcion: 'Abreviatura sola (género grande)', texto: 'bulb' },
  { descripcion: 'Abreviatura + inicio de epíteto', texto: 'epi rad' },
  { descripcion: 'Sinónimo completo', texto: 'doritis pulcherrima' },
  { descripcion: 'Sinónimo completo', texto: 'laelia purpurata' },
  { descripcion: 'Sinónimo completo', texto: 'sophronitis coccinea' },
]

// Índices de búsqueda de species y species_names. Cada consulta debe recorrer al menos uno:
// desde la migración 20261120230000, las que se resuelven por prefijo de una palabra solo usan
// el btree de prefijo, y las demás, los de trigramas.
const indicesBusqueda = [
  'species_scientific_name_prefix_idx',
  'species_scientific_name_trgm_idx',
  'species_names_name_trgm_idx',
]
const tablasRecorridas = ['species', 'species_names']
const tablasCatalogo = [
  'genera',
  'genus_abbreviations',
  'species',
  'species_names',
]

// Opciones -------------------------------------------------------------------------------

const opcionesNumericas = {
  '--generos': 'generos',
  '--especies': 'especies',
  '--sinonimos': 'sinonimos',
  '--comunes': 'comunes',
  '--repeticiones': 'repeticiones',
  '--umbral-ms': 'umbralMs',
}

function leerOpciones(argumentos) {
  const opciones = {
    generos: 900,
    especies: 30000,
    sinonimos: 80000,
    comunes: 3000,
    semilla: 'orki',
    repeticiones: 30,
    umbralMs: 300,
    planes: false,
    catalogoReal: null,
  }
  for (let i = 0; i < argumentos.length; i += 1) {
    const argumento = argumentos[i]
    if (argumento === '--planes') {
      opciones.planes = true
    } else if (argumento === '--catalogo-real') {
      const valor = argumentos[(i += 1)]
      if (!valor || !existsSync(valor)) {
        throw new ErrorDeBaseDesechable(
          '--catalogo-real necesita la ruta de una exportación de COL que exista (export.zip).',
        )
      }
      opciones.catalogoReal = resolve(valor)
    } else if (argumento === '--semilla') {
      const valor = argumentos[(i += 1)]
      if (!valor || !/^[A-Za-z0-9_-]{1,40}$/.test(valor)) {
        throw new ErrorDeBaseDesechable(
          '--semilla necesita un texto de letras, números, - o _ (hasta 40 caracteres).',
        )
      }
      opciones.semilla = valor
    } else if (argumento in opcionesNumericas) {
      const valor = argumentos[(i += 1)]
      if (!valor || !/^[1-9][0-9]{0,6}$/.test(valor)) {
        throw new ErrorDeBaseDesechable(
          `${argumento} necesita un número entero positivo.`,
        )
      }
      opciones[opcionesNumericas[argumento]] = Number(valor)
    } else {
      throw new ErrorDeBaseDesechable(
        `opción desconocida: ${argumento}. Opciones: ${[...Object.keys(opcionesNumericas), '--semilla', '--planes', '--catalogo-real'].join(', ')}.`,
      )
    }
  }
  if (opciones.generos < 60) {
    throw new ErrorDeBaseDesechable(
      '--generos debe ser al menos 60 (el generador usa unos cincuenta géneros reales).',
    )
  }
  if (opciones.especies < 20) {
    throw new ErrorDeBaseDesechable('--especies debe ser al menos 20.')
  }
  return opciones
}

// SQL ------------------------------------------------------------------------------------

// Literal de texto de SQL. Los textos son constantes de este archivo; se escapan igualmente.
function literal(texto) {
  return `'${texto.replaceAll("'", "''")}'`
}

// Script de psql que mide cada consulta como anon: primero las ejecuciones de
// calentamiento y luego las medidas, con el tiempo tomado con clock_timestamp() alrededor de
// la llamada, dentro de la base de datos. Con "contarRecorridos", anota también los
// recorridos de los índices de búsqueda y los secuenciales de species y species_names que
// hizo la consulta, por llamada: la diferencia de pg_stat_user_indexes y
// pg_stat_user_tables antes y después, forzando que la sesión vuelque sus estadísticas
// pendientes (pg_stat_force_next_flush, desde PostgreSQL 15) para que no se pierda ninguna.
function scriptDeMedicion({ repeticiones, contarRecorridos }) {
  const total = calentamiento + repeticiones
  const lista = (nombres) => nombres.map(literal).join(', ')
  const lineas = [
    'create temp table perf_tiempos (consulta integer, ms double precision, filas integer);',
    'create temp table perf_recorridos (consulta integer, objeto text, por_llamada double precision);',
    'grant insert on perf_tiempos to anon;',
  ]
  if (contarRecorridos) lineas.push('set stats_fetch_consistency = none;')
  const volcarEstadisticas =
    'do $volcar$ begin perform pg_catalog.pg_stat_force_next_flush(); end $volcar$;'
  const recorridosHastaAhora = (indice, signo) =>
    `insert into pg_temp.perf_recorridos
select ${indice}, r.objeto, ${signo} * r.recorridos::double precision / ${total}
from (
  select indexrelname::text as objeto, idx_scan as recorridos
  from pg_catalog.pg_stat_user_indexes
  where schemaname = 'public' and indexrelname in (${lista(indicesBusqueda)})
  union all
  select relname::text, seq_scan
  from pg_catalog.pg_stat_user_tables
  where schemaname = 'public' and relname in (${lista(tablasRecorridas)})
) as r;`
  consultas.forEach((consulta, indice) => {
    if (contarRecorridos) {
      lineas.push(volcarEstadisticas, recorridosHastaAhora(indice, -1))
    }
    lineas.push(
      'set role anon;',
      `do $medir$
declare
  inicio timestamptz;
  filas integer;
begin
  for i in 1..${total} loop
    inicio := pg_catalog.clock_timestamp();
    select count(*) into filas from public.search_species(${literal(consulta.texto)});
    if i > ${calentamiento} then
      insert into pg_temp.perf_tiempos values (
        ${indice},
        extract(epoch from pg_catalog.clock_timestamp() - inicio) * 1000,
        filas
      );
    end if;
  end loop;
end;
$medir$;`,
      'reset role;',
    )
    if (contarRecorridos) {
      lineas.push(volcarEstadisticas, recorridosHastaAhora(indice, 1))
    }
  })
  lineas.push(`select pg_catalog.json_agg(r order by r.consulta)
from (
  select
    t.consulta,
    percentile_cont(0.5) within group (order by t.ms) as mediana,
    percentile_cont(0.95) within group (order by t.ms) as p95,
    max(t.ms) as maximo,
    min(t.filas) as filas_min,
    max(t.filas) as filas_max,
    (select pg_catalog.json_object_agg(x.objeto, x.por_llamada)
       from (select y.objeto, sum(y.por_llamada) as por_llamada
               from pg_temp.perf_recorridos y
              where y.consulta = t.consulta
              group by y.objeto) as x) as recorridos
  from pg_temp.perf_tiempos t
  group by t.consulta
) as r;`)
  return lineas.join('\n')
}

const marcaPlan = '=== consulta '

// Script de psql que muestra con auto_explain los planes de las consultas internas de
// search_species (una por etapa) para cada consulta (una ejecución, como anon, tras el
// calentamiento).
// auto_explain escribe el plan como aviso (NOTICE) y \warn escribe la cabecera de cada
// consulta; los dos van a stderr, en orden. Solo se registran las sentencias de al menos
// 1 ms: así no salen las miles de llamadas a normalize_search_text, pero tampoco las
// consultas que tardan menos.
function scriptDePlanes() {
  const lineas = [
    "load 'auto_explain';",
    'set auto_explain.log_min_duration = 1;',
    'set auto_explain.log_analyze = on;',
    'set auto_explain.log_buffers = on;',
    'set auto_explain.log_timing = on;',
    'set auto_explain.log_nested_statements = on;',
    'set auto_explain.log_level = notice;',
    'set role anon;',
  ]
  consultas.forEach((consulta, indice) => {
    lineas.push(
      'set client_min_messages = warning;',
      ...Array.from(
        { length: calentamiento },
        () =>
          `select count(*) from public.search_species(${literal(consulta.texto)});`,
      ),
      `\\warn '${marcaPlan}${indice}'`,
      'set client_min_messages = notice;',
      `select count(*) from public.search_species(${literal(consulta.texto)});`,
    )
  })
  return lineas.join('\n')
}

// Extrae de la salida de scriptDePlanes() los planes de las consultas internas de cada
// consulta (no el de la llamada a search_species ni los de normalize_search_text), sin el
// texto de la sentencia: la línea de duración y el plan desde su primer nodo (la primera
// línea con costes). Desde la migración 20261120230000 la búsqueda va por etapas, así que
// puede haber varios.
function planesPorConsulta(stderr) {
  const planes = new Map()
  for (const bloque of stderr
    .split(new RegExp(`^${marcaPlan}`, 'm'))
    .slice(1)) {
    const indice = Number(bloque.slice(0, bloque.indexOf('\n')))
    const avisos = bloque
      .split(/^.*NOTICE: {2}/m)
      .filter(
        (texto) =>
          texto.includes('(cost=') &&
          !texto.includes('Function Scan on search_species'),
      )
      .map((aviso) => {
        const lineas = aviso.trimEnd().split('\n')
        const primeraDelPlan = lineas.findIndex((linea) =>
          linea.includes('(cost='),
        )
        return [lineas[0], ...lineas.slice(Math.max(primeraDelPlan, 1))].join(
          '\n',
        )
      })
    if (avisos.length > 0) planes.set(indice, avisos.join('\n\n'))
  }
  return planes
}

// Salida ---------------------------------------------------------------------------------

function tabla(cabecera, filas, alineadasDerecha = new Set()) {
  const anchos = cabecera.map((titulo, columna) =>
    Math.max(
      titulo.length,
      ...filas.map((fila) => String(fila[columna]).length),
    ),
  )
  const formatear = (fila) =>
    fila
      .map((valor, columna) =>
        alineadasDerecha.has(columna)
          ? String(valor).padStart(anchos[columna])
          : String(valor).padEnd(anchos[columna]),
      )
      .join('  ')
      .trimEnd()
  return [
    formatear(cabecera),
    anchos.map((ancho) => '-'.repeat(ancho)).join('  '),
    ...filas.map(formatear),
  ]
    .map((linea) => `  ${linea}`)
    .join('\n')
}

function ms(valor) {
  return valor.toFixed(1)
}

// Recorridos por llamada: entero si lo es (salvo errores de redondeo), si no con dos decimales.
function recorridos(valor) {
  const redondeado = Math.round(valor * 100) / 100
  return Number.isInteger(redondeado)
    ? String(redondeado)
    : redondeado.toFixed(2)
}

function megas(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// Catálogo real --------------------------------------------------------------------------

// Carga la exportación de COL en la base desechable con "orki-catalogo cargar --ambiente
// local --escribir" (scripts/catalog-import, con uv). La URL, con la contraseña, va solo en
// ORKI_CATALOG_DB_URL, que el comando nunca imprime; el reporte CSV se escribe en un
// directorio temporal que se borra al terminar.
function cargarCatalogoReal(conexion, archivo) {
  const usuario = encodeURIComponent(conexion.user)
  const clave = conexion.password
    ? `:${encodeURIComponent(conexion.password)}`
    : ''
  const host = conexion.host.includes(':')
    ? `[${conexion.host}]`
    : conexion.host
  const url = `postgresql://${usuario}${clave}@${host}:${conexion.port}/${encodeURIComponent(conexion.database)}`
  const directorio = mkdtempSync(join(tmpdir(), 'orki-perf-'))
  try {
    const resultado = spawnSync(
      'uv',
      [
        'run',
        '--locked',
        '--project',
        join(raizRepositorio, 'scripts', 'catalog-import'),
        'orki-catalogo',
        'cargar',
        archivo,
        '--ambiente',
        'local',
        '--escribir',
        '--reporte',
        join(directorio, 'reporte.csv'),
      ],
      {
        env: { ...process.env, ORKI_CATALOG_DB_URL: url },
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      },
    )
    if (resultado.error) {
      throw new ErrorDeBaseDesechable(
        `no se pudo ejecutar uv (hace falta para --catalogo-real): ${resultado.error.message}`,
      )
    }
    if (resultado.status !== 0) {
      throw new ErrorDeBaseDesechable(
        `falló la carga del catálogo real:\n${`${resultado.stdout}${resultado.stderr}`.trim()}`,
      )
    }
  } finally {
    rmSync(directorio, { recursive: true, force: true })
  }
}

// Principal ------------------------------------------------------------------------------

async function principal() {
  const opciones = leerOpciones(process.argv.slice(2))
  const inicio = Date.now()
  console.log('Preparando la base de datos desechable')
  return conBaseDesechable(
    async ({ conexion, descripcion, version, consultar, ejecutarPsql }) => {
      console.log(`  PostgreSQL ${version}, ${descripcion}`)

      const exigir = (resultado, que) => {
        if (!resultado.ok) {
          throw new ErrorDeBaseDesechable(`${que}:\n${resultado.stderr.trim()}`)
        }
        return resultado
      }

      const inicioCarga = Date.now()
      if (opciones.catalogoReal) {
        console.log(
          `\nCargando el catálogo real con orki-catalogo cargar: ${opciones.catalogoReal}`,
        )
        cargarCatalogoReal(conexion, opciones.catalogoReal)
      } else {
        console.log(
          `\nCargando el catálogo sintético (semilla "${opciones.semilla}"): ` +
            `${opciones.generos} géneros, ${opciones.especies} especies, ` +
            `${opciones.sinonimos} sinónimos, ${opciones.comunes} nombres comunes`,
        )
        exigir(
          ejecutarPsql([
            '-1',
            '-v',
            `semilla=${opciones.semilla}`,
            '-v',
            `generos=${opciones.generos}`,
            '-v',
            `especies=${opciones.especies}`,
            '-v',
            `sinonimos=${opciones.sinonimos}`,
            '-v',
            `comunes=${opciones.comunes}`,
            '-f',
            archivoGenerador,
          ]),
          'no se pudo cargar el catálogo sintético',
        )
      }
      exigir(
        ejecutarPsql([
          '-c',
          `vacuum analyze ${tablasCatalogo.map((t) => `public.${t}`).join(', ')}`,
        ]),
        'falló vacuum analyze',
      )
      const [cargado] = consultar(
        `select (select count(*) from public.genera) || ' géneros, ' ||
           (select count(*) from public.species) || ' especies (' ||
           (select count(*) from public.species where type = 'hybrid') || ' híbridos), ' ||
           (select count(*) from public.species_names where type = 'synonym') || ' sinónimos, ' ||
           (select count(*) from public.species_names where type = 'common') || ' nombres comunes'`,
      )
      console.log(
        `  ${cargado} (${((Date.now() - inicioCarga) / 1000).toFixed(1)} s, con vacuum analyze)`,
      )

      // pg_stat_force_next_flush() existe desde PostgreSQL 15. Con una versión anterior se
      // mide el tiempo, pero no se cuentan los recorridos de los índices.
      const contarRecorridos =
        Number(consultar("select current_setting('server_version_num')")[0]) >=
        150000
      if (!contarRecorridos) {
        console.log(
          '\nAviso: con PostgreSQL anterior a la 15 no se pueden contar los recorridos de los ' +
            'índices. Usa un servidor de PostgreSQL 17 (ORKI_TEST_DB_URL), como Supabase.',
        )
      }
      console.log(
        `\nMidiendo ${consultas.length} consultas como anon: ${calentamiento} ejecuciones de calentamiento y ${opciones.repeticiones} medidas cada una`,
      )
      const medicion = exigir(
        ejecutarPsql(['-A', '-t', '-f', '-'], {
          entrada: scriptDeMedicion({ ...opciones, contarRecorridos }),
        }),
        'falló la medición',
      )
      const resultados = JSON.parse(medicion.stdout.trim())

      const fallos = []
      const filas = resultados.map((resultado) => {
        const consulta = consultas[resultado.consulta]
        const recorridosDe = (objeto) => resultado.recorridos?.[objeto] ?? 0
        const usosIndice = indicesBusqueda.map(recorridosDe)
        const usaIndices =
          !contarRecorridos ||
          (usosIndice.some((uso) => uso > 0) &&
            recorridosDe('species_names') === 0)
        const cumple = resultado.p95 <= opciones.umbralMs
        if (!cumple) {
          fallos.push(
            `"${consulta.texto}": p95 ${ms(resultado.p95)} ms > ${opciones.umbralMs} ms`,
          )
        }
        if (!usaIndices) {
          fallos.push(
            `"${consulta.texto}": no usa ningún índice de búsqueda o recorre species_names entera`,
          )
        }
        return [
          consulta.descripcion,
          consulta.texto,
          ms(resultado.mediana),
          ms(resultado.p95),
          ms(resultado.maximo),
          resultado.filas_min === resultado.filas_max
            ? resultado.filas_min
            : `${resultado.filas_min}-${resultado.filas_max}`,
          contarRecorridos ? usosIndice.map(recorridos).join(' / ') : '?',
          contarRecorridos
            ? tablasRecorridas.map(recorridosDe).map(recorridos).join(' / ')
            : '?',
          cumple && usaIndices ? 'ok' : 'FALLO',
        ]
      })
      console.log(
        tabla(
          [
            'Consulta',
            'Texto',
            'Mediana ms',
            'p95 ms',
            'Máx ms',
            'Filas',
            'Prefijo / trigramas sp / nombres',
            'Seq sp/nombres',
            '',
          ],
          filas,
          new Set([2, 3, 4, 5]),
        ),
      )
      console.log(
        '\n  Prefijo / trigramas sp / nombres: recorridos por llamada de\n' +
          '  species_scientific_name_prefix_idx (btree, prefijo de una palabra), de\n' +
          '  species_scientific_name_trgm_idx y de species_names_name_trgm_idx. La búsqueda va por\n' +
          '  etapas y para en cuanto llena el tope, así que una consulta que se resuelve por prefijo\n' +
          '  no recorre los de trigramas.\n' +
          '  Seq sp/nombres: recorridos secuenciales por llamada de species y species_names. En\n' +
          '  species puede haber uno: el hash join que añade los datos de la especie a los\n' +
          '  candidatos, si el planificador lo prefiere al índice; en species_names debe ser 0.',
      )

      const tamanos = consultar(
        `select c.relname || '|' || pg_catalog.pg_relation_size(c.oid) || '|' ||
                pg_catalog.pg_indexes_size(c.oid) || '|' || pg_catalog.pg_total_relation_size(c.oid)
         from pg_catalog.pg_class c
         where c.oid in (${tablasCatalogo.map((t) => `'public.${t}'::regclass`).join(', ')})
         order by c.relname`,
      ).map((linea) => linea.split('|'))
      const tamanosIndices = consultar(
        `select i.relname || '|' || pg_catalog.pg_relation_size(i.oid)
         from pg_catalog.pg_index x
         join pg_catalog.pg_class i on i.oid = x.indexrelid
         where x.indrelid in (${tablasCatalogo.map((t) => `'public.${t}'::regclass`).join(', ')})
           and i.relname like '%trgm%'
         order by i.relname`,
      ).map((linea) => linea.split('|'))
      const [tamanoBase] = consultar(
        'select pg_catalog.pg_database_size(pg_catalog.current_database())',
      )
      const totalCatalogo = tamanos.reduce(
        (suma, [, , , total]) => suma + Number(total),
        0,
      )
      console.log('\nTamaño del catálogo')
      console.log(
        tabla(
          ['Tabla', 'Datos', 'Índices', 'Total'],
          [
            ...tamanos.map(([nombre, datos, indices, total]) => [
              nombre,
              megas(Number(datos)),
              megas(Number(indices)),
              megas(Number(total)),
            ]),
            ['(catálogo)', '', '', megas(totalCatalogo)],
          ],
          new Set([1, 2, 3]),
        ),
      )
      console.log(
        `  Índices de trigramas: ${tamanosIndices.map(([nombre, bytes]) => `${nombre} ${megas(Number(bytes))}`).join(', ')}`,
      )
      console.log(
        `  Base de datos completa: ${megas(Number(tamanoBase))} (el plan gratuito de Supabase admite 500 MB)`,
      )

      if (opciones.planes) {
        console.log('\nPlanes de la consulta interna de search_species')
        const planes = exigir(
          ejecutarPsql(['-A', '-t', '-f', '-'], { entrada: scriptDePlanes() }),
          'no se pudieron obtener los planes (¿falta la extensión auto_explain?)',
        )
        const porConsulta = planesPorConsulta(planes.stderr)
        consultas.forEach((consulta, indice) => {
          console.log(`\n=== ${consulta.descripcion}: ${consulta.texto}`)
          console.log(
            porConsulta.get(indice) ??
              '(sin planes: ninguna etapa tardó 1 ms o más)',
          )
        })
      }

      const segundos = ((Date.now() - inicio) / 1000).toFixed(1)
      if (fallos.length === 0) {
        console.log(
          `\nTodas las consultas cumplen: p95 ≤ ${opciones.umbralMs} ms y usan los índices de búsqueda (${segundos} s).`,
        )
        return 0
      }
      console.log(`\n${fallos.length} incumplimientos (${segundos} s):`)
      for (const fallo of fallos) console.log(`  - ${fallo}`)
      return 1
    },
    {
      alAvanzar: ({ paso, ok }) => {
        if (!ok) console.log(`  FALLO  ${paso}`)
      },
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
