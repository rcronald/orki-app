#!/usr/bin/env node
// Prueba de rendimiento de la búsqueda: npm run db:perf [-- opciones]
//
// Prepara una base Postgres desechable con todas las migraciones (scripts/db-desechable, la
// misma que usan las pruebas), carga un catálogo sintético del tamaño del real
// (scripts/db-perf/catalogo-sintetico.sql), hace vacuum analyze y ejecuta un conjunto de
// consultas típicas contra public.search_species() como authenticated y contra las cuatro
// funciones del catálogo público (#231) como anon, y las lecturas de fotos de referencia
// (#234) como authenticated, cada una varias veces. Antes de medir añade una foto de referencia
// sintética a una de cada tres especies (la cobertura medida en iNaturalist ronda el 10-30 %,
// ver docs/inaturalist.md). Reporta por consulta
// la mediana y el p95 del tiempo dentro de la base de datos, las filas devueltas y los
// recorridos de los índices que debe usar y secuenciales de species y species_names
// (diferencia de pg_stat_user_indexes y pg_stat_user_tables, desde PostgreSQL 15), y el
// tamaño de las tablas e índices del catálogo. Nunca toca los proyectos de Supabase.
//
// Por defecto usa el clúster temporal con los binarios locales; para medir con la misma
// versión que Supabase, indica un Postgres 17 desechable en ORKI_TEST_DB_URL (ver
// supabase/README.md, "Rendimiento de la búsqueda").
//
// No corre en el CI: es una orden aparte. Termina con código 1 si el p95 de alguna consulta
// supera el umbral, si alguna no usa sus índices o si recorre species_names de forma secuencial
// (las listas y la ficha del catálogo público, tampoco species), y con 0 si todas cumplen.
//
// Opciones (todas opcionales):
//   --generos N        géneros del catálogo sintético (900)
//   --especies N       especies e híbridos aceptados (30000)
//   --sinonimos N      sinónimos (80000)
//   --comunes N        nombres comunes (3000)
//   --semilla TEXTO    semilla del generador; la misma da el mismo catálogo (orki)
//   --repeticiones N   ejecuciones medidas de cada consulta, tras 3 de calentamiento (30)
//   --umbral-ms N      objetivo de tiempo por consulta, en ms, comparado con el p95 (300)
//   --planes           muestra además el plan (explain analyze, buffers) de las consultas
//                      internas de search_species y de las funciones del catálogo público
//                      para cada consulta, con auto_explain
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

// Catálogo público (#231): las cuatro funciones para visitantes, como anon. Las de búsqueda van
// por search_species(), así que usan sus índices; las listas, el índice parcial de especies
// públicas (species_public_genus_idx para contar las de todos los géneros y
// species_public_genus_name_idx para las de uno); la ficha, las claves de species y
// species_names. Las que llevan "clave" usan el id
// de pg_temp.perf_ids que se calcula antes de medir (ver idsDeLasConsultas).
const indiceEspeciesPublicas = 'species_public_genus_name_idx'
const indiceGenerosPublicos = 'species_public_genus_idx'
const indicesFicha = ['species_pkey', 'species_names_species_id_name_key']
// Fotos de referencia (#234): las funciones públicas y las lecturas con sesión buscan la foto
// de cada especie por la restricción única de species_photos.
const indiceFotos = 'species_photos_species_id_key'
const consultasPublicas = [
  ...[
    'ph',
    'dendrob',
    'phal amab',
    'catleya labiatta',
    'alba',
    'laelia purpurata',
  ].map((texto) => ({
    descripcion: 'Búsqueda',
    texto,
    llamada: `public.search_public_species(${literal(texto)})`,
    indices: indicesBusqueda,
  })),
  {
    descripcion: 'Búsqueda, 15 resultados',
    texto: 'dendrob',
    llamada: `public.search_public_species('dendrob', 15)`,
    indices: indicesBusqueda,
  },
  {
    descripcion: 'Géneros, primera página',
    texto: '100 por página',
    llamada: 'public.list_public_genera()',
    indices: [indiceGenerosPublicos],
    sinSecuencialEnSpecies: true,
  },
  {
    descripcion: 'Géneros, última página',
    texto: '200 por página',
    llamada: 'public.list_public_genera(200, 1000)',
    indices: [indiceGenerosPublicos],
    sinSecuencialEnSpecies: true,
  },
  {
    descripcion: 'Especies del género más grande',
    texto: 'página 1 de 50',
    clave: 'genero_grande',
    llamada: 'public.list_public_genus_species(objetivo)',
    indices: [indiceEspeciesPublicas],
    sinSecuencialEnSpecies: true,
  },
  {
    descripcion: 'Especies del género más grande',
    texto: 'última página de 100',
    clave: 'genero_grande',
    llamada: 'public.list_public_genus_species(objetivo, 100, 1000)',
    indices: [indiceEspeciesPublicas],
    sinSecuencialEnSpecies: true,
  },
  {
    descripcion: 'Especies de un género pequeño',
    texto: 'página 1 de 50',
    clave: 'genero_pequeno',
    llamada: 'public.list_public_genus_species(objetivo)',
    indices: [indiceEspeciesPublicas],
    sinSecuencialEnSpecies: true,
  },
  {
    descripcion: 'Ficha con más nombres',
    texto: 'la especie con más sinónimos',
    clave: 'especie_con_nombres',
    llamada: 'public.get_public_species(objetivo)',
    indices: indicesFicha,
    sinSecuencialEnSpecies: true,
  },
  {
    descripcion: 'Ficha',
    texto: 'Phalaenopsis amabilis',
    clave: 'phalaenopsis_amabilis',
    llamada: 'public.get_public_species(objetivo)',
    indices: indicesFicha,
    sinSecuencialEnSpecies: true,
  },
  {
    descripcion: 'Ficha con foto de referencia',
    texto: 'una especie con foto',
    clave: 'especie_con_foto',
    llamada: 'public.get_public_species(objetivo)',
    indices: [indiceFotos],
    sinSecuencialEnSpecies: true,
  },
]

// Fotos de referencia con sesión (#234), como authenticated: la foto de la especie elegida en
// el registro (una consulta por clave, como la pide la app a /rest/v1/species_photos) y las de
// un lote de diez sugerencias (species_id=in.(...)), por si un día se pintan en la lista.
const consultasFotos = [
  {
    descripcion: 'Foto de la especie elegida',
    texto: 'species_id=eq.<id>',
    clave: 'especie_con_foto',
    llamada:
      '(select p.* from public.species_photos p where p.species_id = objetivo) as q',
    indices: [indiceFotos],
    sinSecuencialEnSpecies: true,
  },
  {
    descripcion: 'Fotos de diez sugerencias',
    texto: 'species_id=in.(10 ids)',
    llamada:
      "(select p.* from public.species_photos p where p.species_id in (select i.id from pg_temp.perf_ids i where i.clave like 'sugerencia_%')) as q",
    indices: [indiceFotos],
    sinSecuencialEnSpecies: true,
  },
]

// Ficha y bitácora (#264), como authenticated con el token de perf_user, sobre un inventario
// sintético (inventarioSintetico, abajo): 500 plantas de perf_user (una de ellas con 2000
// registros de bitácora y las demás con 20) y 5000 plantas de otros 100 usuarios con 10
// registros cada una. Se mide la lectura de la colección con el identificador y las notas, el
// alta de una planta (el disparador que le da el identificador), y la bitácora: la primera
// página, con filtro por tipo, una página profunda con cursor, el alta y el reintento.
const usuarioInventario = 'perf_user'
const claimsInventario = JSON.stringify({
  sub: usuarioInventario,
  role: 'authenticated',
})
const indiceBitacora = 'plant_log_entries_plant_id_created_at_idx'
const indiceCodigo = 'plants_user_id_code_key'
const columnasColeccion =
  'p.id, p.entered_name, p.type, p.validation, p.status, p.acquired_on, p.origin, p.location, ' +
  'p.nickname, p.flower_color, p.photo_in_bloom, p.photo_path, p.thumbnail_path, ' +
  'public.photo_count(p), p.created_at, p.updated_at, p.code, p.notes, ' +
  's.scientific_name, g.name'
// count(*) no usa las columnas: Postgres dejaría de calcularlas (photo_count incluido). Por
// eso la fila entera se pasa a un filtro.
const coleccion = (orden) =>
  `(select c.fila from (select row(${columnasColeccion}) as fila from public.plants p ` +
  'left join public.species s on s.id = p.species_id join public.genera g on g.id = p.genus_id' +
  `${orden}) c where c.fila::text <> '') as q`
const consultasBitacora = [
  {
    descripcion: 'Colección con identificador y notas',
    texto: '500 plantas, como COLLECTION_PLANT_SELECT',
    llamada: coleccion(''),
    indices: [],
  },
  {
    descripcion: 'Colección por identificador',
    texto: 'order by code_prefix, code_number',
    llamada: coleccion(' order by p.code_prefix, p.code_number'),
    indices: [],
  },
  {
    descripcion: 'Alta de una planta',
    texto: 'disparador del identificador',
    llamada: '(select * from pg_temp.perf_alta_planta()) as q',
    indices: [indiceCodigo],
  },
  {
    descripcion: 'Bitácora, primera página',
    texto: '20 de 2000',
    clave: 'planta_grande',
    llamada: '(select * from public.list_plant_log_entries(objetivo)) as q',
    indices: [indiceBitacora],
  },
  {
    descripcion: 'Bitácora, solo riego',
    texto: '20 de 500',
    clave: 'planta_grande',
    llamada:
      "(select * from public.list_plant_log_entries(objetivo, 'watering')) as q",
    indices: [indiceBitacora],
  },
  {
    descripcion: 'Bitácora, página con cursor',
    texto: 'tras 1500 registros',
    clave: 'planta_grande',
    llamada:
      '(select * from public.list_plant_log_entries(objetivo, null, (select c.created_at from pg_temp.perf_cursor c), (select c.id from pg_temp.perf_cursor c))) as q',
    indices: [indiceBitacora],
  },
  {
    descripcion: 'Bitácora, alta',
    texto: 'add_plant_log_entry sin clave',
    clave: 'planta_grande',
    llamada:
      "(select * from public.add_plant_log_entry(objetivo, 'watering', 'Riego medido')) as q",
    indices: ['plants_pkey'],
  },
  {
    descripcion: 'Bitácora, reintento',
    texto: 'add_plant_log_entry con clave ya usada',
    clave: 'planta_grande',
    llamada:
      "(select * from public.add_plant_log_entry(objetivo, 'watering', 'Riego', null, null, null, null, 'eeeeeeee-0000-4000-8000-000000000001')) as q",
    indices: ['plant_log_entries_user_id_idempotency_key_key'],
  },
]

// El inventario sintético, como postgres. Los identificadores los pone el disparador.
const inventarioSintetico = `
with generos as (
  select array_agg(x.id order by x.name) as ids from (select id, name from public.genera order by name limit 50) x
)
insert into public.plants (id, user_id, entered_name, genus_id, type, notes, created_at)
select case when i = 1 then '00000000-0000-4000-8000-00000000beef'::uuid else gen_random_uuid() end,
       case when i <= 500 then '${usuarioInventario}' else 'otro_' || (i % 100) end,
       'Planta ' || i, g.ids[1 + i % 50], 'unknown',
       case when i % 4 = 0 then 'Notas de la planta ' || i end,
       now() - make_interval(days => i % 700)
from generate_series(1, 5500) i, generos g;
insert into public.plant_log_entries (plant_id, user_id, type, title, created_at)
select p.id, p.user_id, (enum_range(null::public.plant_log_entry_type))[1 + n % 4], 'Registro ' || n,
       now() - make_interval(hours => n)
from public.plants p
cross join lateral generate_series(1, case
  when p.id = '00000000-0000-4000-8000-00000000beef' then 2000
  when p.user_id = '${usuarioInventario}' then 20
  else 10 end) n;
insert into public.plant_log_entries (plant_id, user_id, type, title, idempotency_key)
values ('00000000-0000-4000-8000-00000000beef', '${usuarioInventario}', 'watering', 'Riego',
        'eeeeeeee-0000-4000-8000-000000000001');`

// Lo que necesitan las consultas de la bitácora en cada sesión: el cursor de la página
// profunda (calculado como dueño) y la función temporal que da de alta una planta como
// authenticated, con RLS y el disparador del identificador.
const preparacionBitacora = `insert into pg_temp.perf_ids values ('planta_grande', '00000000-0000-4000-8000-00000000beef');
create temp table perf_cursor as
  select e.created_at, e.id from public.plant_log_entries e
  where e.plant_id = '00000000-0000-4000-8000-00000000beef'
  order by e.created_at desc, e.id desc offset 1499 limit 1;
grant select on pg_temp.perf_cursor to authenticated;
create function pg_temp.perf_alta_planta() returns setof uuid language sql as $alta$
  insert into public.plants (entered_name, genus_id, type)
  select 'Medida', g.id, 'unknown' from public.genera g order by g.name limit 1
  returning id
$alta$;`

// Una foto de referencia sintética en una de cada tres especies, como la escribiría la carga.
const fotosSinteticas = `insert into public.species_photos (
  species_id, medium_path, medium_width, medium_height, thumbnail_path, thumbnail_width,
  thumbnail_height, source, source_photo_id, source_taxon_id, source_selection, source_url,
  license, author_name, attribution, obtained_at)
select s.id, s.id::text || '/medium-' || s.n || '.webp', 500, 375, s.id::text || '/thumb-' || s.n || '.webp',
  160, 120, 'inaturalist', s.n::text, s.n::text, 'taxon_default', 'https://www.inaturalist.org/photos/' || s.n,
  (array['cc0', 'pd', 'cc-by', 'cc-by-sa'])[1 + s.n % 4], 'Autora ' || s.n,
  '(c) Autora ' || s.n || ', some rights reserved (CC BY)', now()
from (select x.id, row_number() over (order by x.id) as n from public.species x) s
where s.n % 3 = 0`

// Ids que necesitan las consultas públicas, calculados como dueño antes de medir (anon no lee
// las tablas). Si el catálogo no tiene Phalaenopsis amabilis, la ficha se mide con la primera
// especie por nombre.
const idsDeLasConsultas = `create temp table perf_ids (clave text primary key, id uuid not null);
insert into pg_temp.perf_ids
select 'genero_grande', s.genus_id from public.species s
where s.source <> 'user_proposal' or s.status = 'validated'
group by s.genus_id order by count(*) desc, s.genus_id limit 1;
insert into pg_temp.perf_ids
select 'genero_pequeno', s.genus_id from public.species s
where s.source <> 'user_proposal' or s.status = 'validated'
group by s.genus_id order by count(*), s.genus_id limit 1;
insert into pg_temp.perf_ids
select 'especie_con_nombres', n.species_id from public.species_names n
join public.species s on s.id = n.species_id
where s.source <> 'user_proposal' or s.status = 'validated'
group by n.species_id order by count(*) desc, n.species_id limit 1;
insert into pg_temp.perf_ids
select 'phalaenopsis_amabilis', s.id from public.species s
order by s.scientific_name <> 'Phalaenopsis amabilis', s.scientific_name limit 1;
insert into pg_temp.perf_ids
select 'especie_con_foto', p.species_id from public.species_photos p
join public.species s on s.id = p.species_id
where s.source <> 'user_proposal' or s.status = 'validated'
order by p.species_id limit 1;
insert into pg_temp.perf_ids
select 'sugerencia_' || row_number() over (order by s.id), s.id
from (select x.id from public.species x order by x.id limit 10) s;
grant select on pg_temp.perf_ids to anon;`

// Todas las consultas que se miden: las de search_species() como authenticated (desde #231 anon
// no la puede ejecutar; la app la llama siempre con sesión) y las del catálogo público como anon.
const medidas = [
  ...consultas.map((consulta) => ({
    ...consulta,
    grupo: 'busqueda',
    rol: 'authenticated',
    llamada: `public.search_species(${literal(consulta.texto)})`,
    indices: indicesBusqueda,
  })),
  ...consultasPublicas.map((consulta) => ({
    ...consulta,
    grupo: 'publico',
    rol: 'anon',
  })),
  ...consultasFotos.map((consulta) => ({
    ...consulta,
    grupo: 'fotos',
    rol: 'authenticated',
  })),
  ...consultasBitacora.map((consulta) => ({
    ...consulta,
    grupo: 'bitacora',
    rol: 'authenticated',
    claims: claimsInventario,
  })),
]
const indicesContados = [
  ...new Set([
    ...indicesBusqueda,
    indiceEspeciesPublicas,
    indiceGenerosPublicos,
    ...indicesFicha,
    indiceFotos,
    'species_genus_id_idx',
    'species_genus_id_name_idx',
    ...consultasBitacora.flatMap((consulta) => consulta.indices),
  ]),
]
const tablasRecorridas = ['species', 'species_names', 'species_photos']
// Recorridos secuenciales de las tablas del inventario, para las consultas de la bitácora.
const tablasInventario = ['plants', 'plant_log_entries']
const tablasCatalogo = [
  'genera',
  'genus_abbreviations',
  'species',
  'species_names',
  'species_photos',
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

// Script de psql que mide cada consulta con su rol (authenticated o anon): primero las
// ejecuciones de calentamiento y luego las medidas, con el tiempo tomado con clock_timestamp()
// alrededor de la llamada, dentro de la base de datos. Con "contarRecorridos", anota también los
// recorridos de los índices contados y los secuenciales de species y species_names que
// hizo la consulta, por llamada: la diferencia de pg_stat_user_indexes y
// pg_stat_user_tables antes y después, forzando que la sesión vuelque sus estadísticas
// pendientes (pg_stat_force_next_flush, desde PostgreSQL 15) para que no se pierda ninguna.
function scriptDeMedicion({ repeticiones, contarRecorridos }) {
  const total = calentamiento + repeticiones
  const lista = (nombres) => nombres.map(literal).join(', ')
  const lineas = [
    'create temp table perf_tiempos (consulta integer, ms double precision, filas integer);',
    'create temp table perf_recorridos (consulta integer, objeto text, por_llamada double precision);',
    'grant insert on perf_tiempos to anon, authenticated;',
    idsDeLasConsultas,
    'grant select on pg_temp.perf_ids to authenticated;',
    preparacionBitacora,
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
  where schemaname = 'public' and indexrelname in (${lista(indicesContados)})
  union all
  select relname::text, seq_scan
  from pg_catalog.pg_stat_user_tables
  where schemaname = 'public' and relname in (${lista([...tablasRecorridas, ...tablasInventario])})
) as r;`
  medidas.forEach((consulta, indice) => {
    if (contarRecorridos) {
      lineas.push(volcarEstadisticas, recorridosHastaAhora(indice, -1))
    }
    lineas.push(
      `set role ${consulta.rol};`,
      consulta.claims
        ? `set request.jwt.claims = ${literal(consulta.claims)};`
        : 'reset request.jwt.claims;',
      `do $medir$
declare
  inicio timestamptz;
  filas integer;
  objetivo uuid;
begin
  ${consulta.clave ? `select id into objetivo from pg_temp.perf_ids where clave = ${literal(consulta.clave)};` : ''}
  for i in 1..${total} loop
    inicio := pg_catalog.clock_timestamp();
    select count(*) into filas from ${consulta.llamada};
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
// search_species (una por etapa) y de las funciones del catálogo público para cada consulta
// (una ejecución, con el rol de la consulta, tras el calentamiento).
// auto_explain escribe el plan como aviso (NOTICE) y \warn escribe la cabecera de cada
// consulta; los dos van a stderr, en orden. En la búsqueda solo se registran las sentencias de
// al menos 1 ms: así no salen las miles de llamadas a normalize_search_text, pero tampoco las
// consultas que tardan menos. En el catálogo público, todas.
function scriptDePlanes() {
  const lineas = [
    "load 'auto_explain';",
    'set auto_explain.log_min_duration = 1;',
    'set auto_explain.log_analyze = on;',
    'set auto_explain.log_buffers = on;',
    'set auto_explain.log_timing = on;',
    'set auto_explain.log_nested_statements = on;',
    'set auto_explain.log_level = notice;',
    idsDeLasConsultas,
    'grant select on pg_temp.perf_ids to authenticated;',
    preparacionBitacora,
  ]
  medidas.forEach((consulta, indice) => {
    // Las del catálogo público tardan menos de 1 ms: se registran todas sus sentencias. Son
    // pocas, porque normalize_search_text() es sql y se expande en la consulta.
    const minimo = consulta.grupo === 'busqueda' ? 1 : 0
    const llamada = consulta.clave
      ? consulta.llamada.replace(
          'objetivo',
          `(select id from pg_temp.perf_ids where clave = ${literal(consulta.clave)})`,
        )
      : consulta.llamada
    lineas.push(
      'reset role;',
      `set auto_explain.log_min_duration = ${minimo};`,
      `set role ${consulta.rol};`,
      consulta.claims
        ? `set request.jwt.claims = ${literal(consulta.claims)};`
        : 'reset request.jwt.claims;',
      'set client_min_messages = warning;',
      ...Array.from(
        { length: calentamiento },
        () => `select count(*) from ${llamada};`,
      ),
      `\\warn '${marcaPlan}${indice}'`,
      'set client_min_messages = notice;',
      `select count(*) from ${llamada};`,
    )
  })
  return lineas.join('\n')
}

// Extrae de la salida de scriptDePlanes() los planes de las consultas internas de cada
// consulta (no el de la llamada desde el script, la sentencia "select count(*) from public....",
// ni los de normalize_search_text), sin el
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
          !texto.includes('Query Text: select count(*) from public.'),
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
        ejecutarPsql(['-c', fotosSinteticas]),
        'no se pudieron añadir las fotos de referencia sintéticas',
      )
      exigir(
        ejecutarPsql([
          '-c',
          `vacuum analyze ${tablasCatalogo.map((t) => `public.${t}`).join(', ')}`,
        ]),
        'falló vacuum analyze',
      )
      exigir(
        ejecutarPsql(['-c', inventarioSintetico]),
        'no se pudo cargar el inventario sintético',
      )
      exigir(
        ejecutarPsql([
          '-c',
          'vacuum analyze public.plants, public.plant_log_entries',
        ]),
        'falló vacuum analyze del inventario',
      )
      const [cargado] = consultar(
        `select (select count(*) from public.genera) || ' géneros, ' ||
           (select count(*) from public.species) || ' especies (' ||
           (select count(*) from public.species where type = 'hybrid') || ' híbridos), ' ||
           (select count(*) from public.species_names where type = 'synonym') || ' sinónimos, ' ||
           (select count(*) from public.species_names where type = 'common') || ' nombres comunes, ' ||
           (select count(*) from public.species_photos) || ' fotos de referencia; ' ||
           (select count(*) from public.plants) || ' plantas y ' ||
           (select count(*) from public.plant_log_entries) || ' registros de bitácora'`,
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
        `\nMidiendo ${consultas.length} consultas de search_species() como authenticated y ` +
          `${consultasPublicas.length} del catálogo público como anon, ${consultasFotos.length} de fotos ` +
          `de referencia y ${consultasBitacora.length} de la ficha y la bitácora como authenticated: ` +
          `${calentamiento} ejecuciones ` +
          `de calentamiento y ${opciones.repeticiones} medidas cada una`,
      )
      const medicion = exigir(
        ejecutarPsql(['-A', '-t', '-f', '-'], {
          entrada: scriptDeMedicion({ ...opciones, contarRecorridos }),
        }),
        'falló la medición',
      )
      const resultados = JSON.parse(medicion.stdout.trim())

      const fallos = []
      const filasPorGrupo = {
        busqueda: [],
        publico: [],
        fotos: [],
        bitacora: [],
      }
      for (const resultado of resultados) {
        const consulta = medidas[resultado.consulta]
        const nombre = `${consulta.descripcion}: "${consulta.texto}"`
        const recorridosDe = (objeto) => resultado.recorridos?.[objeto] ?? 0
        const usosIndice = consulta.indices.map(recorridosDe)
        const esBitacora = consulta.grupo === 'bitacora'
        // La colección lee todas las plantas del usuario: no se le exige índice. La bitácora
        // nunca puede recorrer plant_log_entries entera.
        const usaIndices =
          !contarRecorridos ||
          (esBitacora
            ? (consulta.indices.length === 0 ||
                usosIndice.some((uso) => uso > 0)) &&
              recorridosDe('plant_log_entries') === 0
            : usosIndice.some((uso) => uso > 0) &&
              recorridosDe('species_names') === 0 &&
              recorridosDe('species_photos') === 0 &&
              (!consulta.sinSecuencialEnSpecies ||
                recorridosDe('species') === 0))
        const cumple = resultado.p95 <= opciones.umbralMs
        if (!cumple) {
          fallos.push(
            `${nombre}: p95 ${ms(resultado.p95)} ms > ${opciones.umbralMs} ms`,
          )
        }
        if (!usaIndices) {
          fallos.push(
            consulta.grupo === 'busqueda'
              ? `${nombre}: no usa ningún índice de búsqueda o recorre species_names entera`
              : `${nombre}: no usa ${consulta.indices.join(' ni ')} o recorre una tabla entera`,
          )
        }
        filasPorGrupo[consulta.grupo].push([
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
            ? (esBitacora ? tablasInventario : tablasRecorridas)
                .map(recorridosDe)
                .map(recorridos)
                .join(' / ')
            : '?',
          cumple && usaIndices ? 'ok' : 'FALLO',
        ])
      }
      const cabecera = (indices) => [
        'Consulta',
        'Texto',
        'Mediana ms',
        'p95 ms',
        'Máx ms',
        'Filas',
        indices,
        'Seq sp/nombres/fotos',
        '',
      ]
      console.log(
        '\nBúsqueda del registro: search_species(), como authenticated',
      )
      console.log(
        tabla(
          cabecera('Prefijo / trigramas sp / nombres'),
          filasPorGrupo.busqueda,
          new Set([2, 3, 4, 5]),
        ),
      )
      console.log(
        '\n  Prefijo / trigramas sp / nombres: recorridos por llamada de\n' +
          '  species_scientific_name_prefix_idx (btree, prefijo de una palabra), de\n' +
          '  species_scientific_name_trgm_idx y de species_names_name_trgm_idx. La búsqueda va por\n' +
          '  etapas y para en cuanto llena el tope, así que una consulta que se resuelve por prefijo\n' +
          '  no recorre los de trigramas.\n' +
          '  Seq sp/nombres/fotos: recorridos secuenciales por llamada de species, species_names y\n' +
          '  species_photos. En species puede haber uno: el hash join que añade los datos de la\n' +
          '  especie a los candidatos, si el planificador lo prefiere al índice; en species_names y\n' +
          '  species_photos debe ser 0.',
      )
      console.log('\nCatálogo público (#231), como anon')
      console.log(
        tabla(
          cabecera('Índices esperados'),
          filasPorGrupo.publico,
          new Set([2, 3, 4, 5]),
        ),
      )
      console.log(
        '\n  Índices esperados: recorridos por llamada de los índices de cada consulta: en la\n' +
          '  búsqueda, los mismos de search_species(); en los géneros, species_public_genus_idx; en\n' +
          '  las especies de un género, species_public_genus_name_idx;\n' +
          '  en la ficha, species_pkey / species_names_species_id_name_key; en la ficha con foto,\n' +
          '  species_photos_species_id_key. Las listas y la ficha no pueden recorrer species ni\n' +
          '  species_names de forma secuencial, y ninguna consulta species_photos.',
      )
      console.log('\nFotos de referencia (#234), como authenticated')
      console.log(
        tabla(
          cabecera('species_photos_species_id_key'),
          filasPorGrupo.fotos,
          new Set([2, 3, 4, 5]),
        ),
      )
      console.log(
        `\nFicha y bitácora (#264), como authenticated (${usuarioInventario})`,
      )
      console.log(
        tabla(
          [
            ...cabecera('Índices esperados').slice(0, 7),
            'Seq plantas/bitácora',
            '',
          ],
          filasPorGrupo.bitacora,
          new Set([2, 3, 4, 5]),
        ),
      )
      console.log(
        '\n  Índices esperados: en el alta de una planta, plants_user_id_code_key (el máximo del\n' +
          '  prefijo); en las lecturas de la bitácora, plant_log_entries_plant_id_created_at_idx; en\n' +
          '  el alta de un registro, plants_pkey (la planta, para el dueño y la clave foránea); en el\n' +
          '  reintento, el índice único de la clave. La colección lee todas las plantas del usuario.\n' +
          '  Seq plantas/bitácora: recorridos secuenciales por llamada de plants y\n' +
          '  plant_log_entries; en plant_log_entries debe ser 0.',
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
           and (i.relname like '%trgm%' or i.relname like 'species_public_%')
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
        `  Índices de trigramas y del catálogo público: ${tamanosIndices.map(([nombre, bytes]) => `${nombre} ${megas(Number(bytes))}`).join(', ')}`,
      )
      console.log(
        `  Base de datos completa: ${megas(Number(tamanoBase))} (el plan gratuito de Supabase admite 500 MB)`,
      )

      if (opciones.planes) {
        console.log(
          '\nPlanes de las consultas internas de search_species y del catálogo público',
        )
        const planes = exigir(
          ejecutarPsql(['-A', '-t', '-f', '-'], { entrada: scriptDePlanes() }),
          'no se pudieron obtener los planes (¿falta la extensión auto_explain?)',
        )
        const porConsulta = planesPorConsulta(planes.stderr)
        medidas.forEach((consulta, indice) => {
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
