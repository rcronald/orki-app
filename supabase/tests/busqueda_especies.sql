-- Búsqueda de especies: public.normalize_search_text(), los índices de trigramas y
-- public.search_species() (issue #68, parte de #7).
--
-- Las pruebas crean sus propios datos (no usan los de supabase/datos-ejemplo). Algunos nombres
-- son inventados para provocar un caso concreto de orden; se señalan con "ficticio".

-- Datos de partida: el género Guarianthe (lo carga ya la migración de abreviaturas del #69;
-- se crea si falta para no depender de ella), especies con distintos estados, sinónimos y
-- nombres comunes, y una planta de user_a que no es del catálogo.
insert into public.genera (name) values ('Guarianthe') on conflict do nothing;

insert into public.species (scientific_name, genus_id, type, status, source)
values
  ('Phalaenopsis amabilis', pruebas.genero('Phalaenopsis'), 'species', 'validated', 'curated'),
  ('Phalaenopsis aphrodite', pruebas.genero('Phalaenopsis'), 'species', 'imported', 'curated'),
  ('Phalaenopsis pulcherrima', pruebas.genero('Phalaenopsis'), 'species', 'observed', 'curated'),
  ('Phalaenopsis Sogo Yukidian', pruebas.genero('Phalaenopsis'), 'hybrid', 'imported', 'curated'),
  ('Cattleya labiata', pruebas.genero('Cattleya'), 'species', 'validated', 'curated'),
  ('Cattleya mossiae', pruebas.genero('Cattleya'), 'species', 'validated', 'curated'),
  -- ficticio: el epíteto coincide entero con la consulta "dendro" sin ser prefijo.
  ('Cattleya dendro', pruebas.genero('Cattleya'), 'species', 'imported', 'curated'),
  ('Guarianthe skinneri', pruebas.genero('Guarianthe'), 'species', 'validated', 'curated'),
  ('Dendrobium nobile', pruebas.genero('Dendrobium'), 'species', 'validated', 'curated'),
  ('Vanda coerulea', pruebas.genero('Vanda'), 'species', 'validated', 'curated'),
  ('Oncidium alexandrae', pruebas.genero('Oncidium'), 'species', 'validated', 'curated'),
  -- ficticio: mismo texto que el sinónimo de Oncidium alexandrae.
  ('Oncidium crispum', pruebas.genero('Oncidium'), 'species', 'imported', 'curated');

insert into public.species_names (species_id, name, type, language)
values
  (pruebas.especie('Phalaenopsis amabilis'), 'Phalaenopsis grandiflora', 'synonym', null),
  (pruebas.especie('Phalaenopsis amabilis'), 'orquídea mariposa', 'common', 'es'),
  (pruebas.especie('Phalaenopsis amabilis'), 'phalaenopsis blanca', 'common', 'es'),
  (pruebas.especie('Phalaenopsis pulcherrima'), 'Doritis pulcherrima', 'synonym', null),
  (pruebas.especie('Cattleya mossiae'), 'flor de mayo', 'common', 'es'),
  (pruebas.especie('Guarianthe skinneri'), 'Cattleya skinneri', 'synonym', null),
  (pruebas.especie('Guarianthe skinneri'), 'Guaria morada', 'common', 'es'),
  (pruebas.especie('Oncidium alexandrae'), 'Oncidium crispum', 'synonym', null),
  (pruebas.especie('Vanda coerulea'), 'vanda azul', 'common', 'es');

insert into public.plants (user_id, entered_name, genus_id, type)
values ('user_a', 'Phalaenopsis secretissima', pruebas.genero('Phalaenopsis'), 'unknown');

-- Posición (1, 2, ...) de una especie en los resultados de una búsqueda, o null si no sale.
create function pg_temp.posicion(consulta text, especie text)
returns bigint
language sql
as $$
  select r.n
  from (
    select s.scientific_name, row_number() over () as n
    from public.search_species(consulta, 20) s
  ) r
  where r.scientific_name = especie
$$;

-- Resultados de una búsqueda como texto: "nombre científico [nombre por el que coincidió:tipo]".
create function pg_temp.resultados(consulta text, maximo integer default 20)
returns text
language sql
as $$
  select coalesce(
    string_agg(s.scientific_name || ' [' || s.matched_name || ':' || s.matched_name_type || ']', '; '),
    'ninguno'
  )
  from public.search_species(consulta, maximo) s
$$;

-- Desde el #283, las funciones que crea postgres no nacen ejecutables por PUBLIC: las de
-- ayuda de este archivo se abren a mano para poder llamarlas con otros roles.
grant execute on all functions in schema pg_temp to public;

-- prueba: normalización: minúsculas, sin tildes y con los espacios unificados
select pruebas.iguales('tildes, mayúsculas y espacios', public.normalize_search_text('  Orquídea   MARIPOSA '), 'orquidea mariposa');
select pruebas.iguales('eñe y diéresis', public.normalize_search_text('Araña Güira'), 'arana guira');
select pruebas.iguales('tabuladores y saltos de línea', public.normalize_search_text(e'phal\t\n amab'), 'phal amab');
select pruebas.iguales('sin cambios', public.normalize_search_text('cattleya'), 'cattleya');
select pruebas.iguales('vacío', public.normalize_search_text('   '), '');
select pruebas.iguales('nulo', public.normalize_search_text(null), null::text);

-- prueba: normalización: no depende del search_path de quien la llama
set local search_path = '';
select pruebas.iguales('con search_path vacío', public.normalize_search_text('Orquídea'), 'orquidea');
set local search_path = public;
select pruebas.iguales('con search_path public', public.normalize_search_text('Orquídea'), 'orquidea');

-- prueba: un error de tipeo encuentra la especie entre los cinco primeros
select pruebas.comprobar('catleya labiata', pg_temp.posicion('catleya labiata', 'Cattleya labiata') <= 5);
select pruebas.comprobar('phalaenopsis amabilsi', pg_temp.posicion('phalaenopsis amabilsi', 'Phalaenopsis amabilis') <= 5);
select pruebas.comprobar('falaenopsis amabilis', pg_temp.posicion('falaenopsis amabilis', 'Phalaenopsis amabilis') <= 5);
select pruebas.comprobar('dendrobim nobile', pg_temp.posicion('dendrobim nobile', 'Dendrobium nobile') <= 5);
select pruebas.comprobar('vamda coerulea', pg_temp.posicion('vamda coerulea', 'Vanda coerulea') <= 5);
select pruebas.comprobar('vamda, una palabra corta', pg_temp.posicion('vamda', 'Vanda coerulea') <= 5);
select pruebas.iguales('el primero de catleya labiata', pg_temp.posicion('catleya labiata', 'Cattleya labiata'), 1::bigint);

-- prueba: sin tildes, con tildes de más y en mayúsculas encuentra la especie
select pruebas.iguales('orquidea mariposa', pg_temp.posicion('orquidea mariposa', 'Phalaenopsis amabilis'), 1::bigint);
select pruebas.iguales('ORQUÍDEA MARIPOSA', pg_temp.posicion('ORQUÍDEA MARIPOSA', 'Phalaenopsis amabilis'), 1::bigint);
select pruebas.iguales('Cáttleya lábiata', pg_temp.posicion('Cáttleya lábiata', 'Cattleya labiata'), 1::bigint);
select pruebas.iguales('PHALAENOPSIS AMABILIS', pg_temp.posicion('PHALAENOPSIS AMABILIS', 'Phalaenopsis amabilis'), 1::bigint);

-- prueba: los espacios de más no cambian el resultado
select pruebas.iguales(
  'con espacios de más',
  pg_temp.resultados('   phalaenopsis    amabilis  '),
  pg_temp.resultados('phalaenopsis amabilis')
);
select pruebas.iguales('el primero', pg_temp.posicion('   phalaenopsis    amabilis  ', 'Phalaenopsis amabilis'), 1::bigint);

-- prueba: consultas a medias, como mientras se escribe
select pruebas.iguales('phal amab', pg_temp.posicion('phal amab', 'Phalaenopsis amabilis'), 1::bigint);
select pruebas.iguales('cattleya lab', pg_temp.posicion('cattleya lab', 'Cattleya labiata'), 1::bigint);
select pruebas.iguales('guaria mor', pg_temp.posicion('guaria mor', 'Guarianthe skinneri'), 1::bigint);
select pruebas.comprobar('ph encuentra las Phalaenopsis (solo por prefijo)', pg_temp.posicion('ph', 'Phalaenopsis amabilis') is not null);
select pruebas.iguales('phal yuki, con una palabra en medio', pg_temp.posicion('phal yuki', 'Phalaenopsis Sogo Yukidian'), 1::bigint);
select pruebas.iguales('phal a', pg_temp.posicion('phal a', 'Phalaenopsis amabilis'), 1::bigint);
select pruebas.iguales('phal ap', pg_temp.posicion('phal ap', 'Phalaenopsis aphrodite'), 1::bigint);
select pruebas.iguales('sinónimo a medias: doritis pul', pg_temp.resultados('doritis pul', 1), 'Phalaenopsis pulcherrima [Doritis pulcherrima:synonym]');

-- prueba: prefijo: las especies cuyo nombre científico empieza por la consulta van primero, en orden alfabético
select pruebas.iguales(
  'phalaenopsis',
  (select string_agg(s.scientific_name, ', ') from public.search_species('phalaenopsis', 4) s),
  'Phalaenopsis amabilis, Phalaenopsis aphrodite, Phalaenopsis pulcherrima, Phalaenopsis Sogo Yukidian'
);
-- Con varias palabras, el prefijo es por palabras ('phal% amab%').
select pruebas.iguales(
  'phal amab',
  pg_temp.resultados('phal amab', 1),
  'Phalaenopsis amabilis [Phalaenopsis amabilis:scientific]'
);
-- "Cattleya dendro" contiene "dendro" entero (similitud 1) y "Dendrobium nobile" solo empieza
-- por él (similitud menor): gana el prefijo.
select pruebas.comprobar(
  'dendro: la similitud de Cattleya dendro es mayor',
  extensions.word_similarity('dendro', 'cattleya dendro') > extensions.word_similarity('dendro', 'dendrobium nobile')
);
select pruebas.iguales('dendro: primero el prefijo', pg_temp.posicion('dendro', 'Dendrobium nobile'), 1::bigint);
select pruebas.iguales('dendro: después la similitud', pg_temp.posicion('dendro', 'Cattleya dendro'), 2::bigint);

-- prueba: a igual similitud, el nombre científico gana al sinónimo aunque vaya después en el alfabeto
-- "Oncidium crispum" es el nombre científico de una especie y un sinónimo de Oncidium
-- alexandrae. Con un error de tipeo no hay prefijo y la similitud es la misma.
select pruebas.iguales(
  'oncidum crispum',
  pg_temp.resultados('oncidum crispum', 2),
  'Oncidium crispum [Oncidium crispum:scientific]; Oncidium alexandrae [Oncidium crispum:synonym]'
);

-- prueba: un sinónimo devuelve la especie aceptada y muestra el sinónimo
select pruebas.iguales(
  'doritis pulcherrima',
  pg_temp.resultados('doritis pulcherrima', 1),
  'Phalaenopsis pulcherrima [Doritis pulcherrima:synonym]'
);
select pruebas.iguales(
  'con un error de tipeo: doritis pulcherima',
  pg_temp.resultados('doritis pulcherima', 1),
  'Phalaenopsis pulcherrima [Doritis pulcherrima:synonym]'
);
-- El sinónimo es de otro género: la fila trae el género de la especie aceptada.
select pruebas.iguales(
  'cattleya skinneri',
  (select s.scientific_name || ' / ' || s.genus_name || ' / ' || (s.genus_id = pruebas.genero('Guarianthe'))
          || ' / ' || s.matched_name || ' / ' || s.matched_name_type
     from public.search_species('cattleya skinneri', 1) s),
  'Guarianthe skinneri / Guarianthe / true / Cattleya skinneri / synonym'
);

-- prueba: un nombre común devuelve la especie y muestra el nombre común
select pruebas.iguales('flor de mayo', pg_temp.resultados('flor de mayo', 1), 'Cattleya mossiae [flor de mayo:common]');
select pruebas.iguales('orquidea mariposa', pg_temp.resultados('orquidea mariposa', 1), 'Phalaenopsis amabilis [orquídea mariposa:common]');

-- prueba: devuelve id, nombre científico, género, tipo y estado de la especie
select pruebas.iguales(
  'fila de Phalaenopsis Sogo Yukidian',
  (select (s.id = pruebas.especie('Phalaenopsis Sogo Yukidian'))
          || ' / ' || s.scientific_name || ' / ' || (s.genus_id = pruebas.genero('Phalaenopsis'))
          || ' / ' || s.genus_name || ' / ' || s.type || ' / ' || s.status
     from public.search_species('phalaenopsis sogo yukidian', 1) s),
  'true / Phalaenopsis Sogo Yukidian / true / Phalaenopsis / hybrid / imported'
);

-- prueba: una especie con varias coincidencias aparece una sola vez, con la mejor
-- "phalaenopsis" coincide con el nombre científico de Phalaenopsis amabilis, con su sinónimo
-- Phalaenopsis grandiflora y con su nombre común "phalaenopsis blanca".
select pruebas.iguales(
  'veces que sale Phalaenopsis amabilis',
  (select count(*) from public.search_species('phalaenopsis', 20) s where s.scientific_name = 'Phalaenopsis amabilis'),
  1::bigint
);
select pruebas.iguales(
  'especies repetidas en cualquier búsqueda',
  (select count(*) - count(distinct s.id) from public.search_species('phalaenopsis', 20) s),
  0::bigint
);
select pruebas.iguales(
  'mejor coincidencia de Phalaenopsis amabilis',
  (select s.matched_name || ':' || s.matched_name_type
     from public.search_species('phalaenopsis', 20) s where s.scientific_name = 'Phalaenopsis amabilis'),
  'Phalaenopsis amabilis:scientific'
);
-- Si el nombre científico no coincide, la mejor es el sinónimo.
select pruebas.iguales(
  'phalaenopsis grandiflora',
  pg_temp.resultados('phalaenopsis grandiflora', 1),
  'Phalaenopsis amabilis [Phalaenopsis grandiflora:synonym]'
);

-- prueba: incluye las especies con cualquier estado, también las observadas
select pruebas.iguales(
  'estados encontrados',
  (select string_agg(distinct s.status::text, ', ') from public.search_species('phalaenopsis', 20) s),
  'imported, observed, validated'
);

-- prueba: consultas nulas, vacías, de solo espacios o demasiado cortas devuelven vacío sin error
select pruebas.iguales('nula', (select count(*) from public.search_species(null)), 0::bigint);
select pruebas.iguales('vacía', (select count(*) from public.search_species('')), 0::bigint);
select pruebas.iguales('solo espacios', (select count(*) from public.search_species('     ')), 0::bigint);
select pruebas.iguales('una letra', (select count(*) from public.search_species('p')), 0::bigint);
select pruebas.iguales('una letra entre espacios', (select count(*) from public.search_species('   p   ')), 0::bigint);
select pruebas.iguales('sin letras ni números', (select count(*) from public.search_species('%%')), 0::bigint);
select pruebas.comprobar('dos letras sí buscan (por prefijo)', (select count(*) from public.search_species('ph')) > 0);

-- prueba: los comodines de LIKE de la consulta no se interpretan
-- Si "_" y "%" fueran comodines, "d_ndro" y "d%ro" serían prefijos de "dendrobium nobile" y
-- Dendrobium nobile saldría primero. Como no lo son, solo cuenta la similitud.
select pruebas.iguales('d_ndro', pg_temp.posicion('d_ndro', 'Cattleya dendro'), 1::bigint);
select pruebas.comprobar(
  'd%ro: Dendrobium nobile no sale primero',
  pg_temp.posicion('d%ro', 'Dendrobium nobile') is distinct from 1
);

-- prueba: consultas de más de 100 caracteres devuelven vacío sin error
select pruebas.iguales(
  '100 caracteres sí buscan',
  pg_temp.posicion('phalaenopsis amabilis' || repeat(' ', 79), 'Phalaenopsis amabilis'),
  1::bigint
);
select pruebas.iguales(
  '101 caracteres',
  (select count(*) from public.search_species('phalaenopsis amabilis' || repeat(' ', 80))),
  0::bigint
);
select pruebas.iguales(
  'un millón de caracteres',
  (select count(*) from public.search_species(repeat('phalaenopsis ', 80000))),
  0::bigint
);

-- prueba: tope de resultados: 10 por defecto, 20 como máximo, y el valor por defecto si no es positivo
insert into public.species (scientific_name, genus_id, type, status, source)
select 'Vanda testii' || lpad(i::text, 2, '0'), pruebas.genero('Vanda'), 'species', 'imported', 'curated'
from generate_series(1, 25) i;
select pruebas.iguales('sin max_results', (select count(*) from public.search_species('vanda testii')), 10::bigint);
select pruebas.iguales('max_results 3', (select count(*) from public.search_species('vanda testii', 3)), 3::bigint);
select pruebas.iguales('max_results 20', (select count(*) from public.search_species('vanda testii', 20)), 20::bigint);
select pruebas.iguales('max_results 1000', (select count(*) from public.search_species('vanda testii', 1000)), 20::bigint);
select pruebas.iguales('max_results nulo', (select count(*) from public.search_species('vanda testii', null)), 10::bigint);
select pruebas.iguales('max_results 0', (select count(*) from public.search_species('vanda testii', 0)), 10::bigint);
select pruebas.iguales('max_results negativo', (select count(*) from public.search_species('vanda testii', -5)), 10::bigint);

-- prueba: el umbral de similitud de la sesión no cambia el resultado y se restaura al terminar
set local pg_trgm.word_similarity_threshold = 0.95;
select pruebas.iguales('con umbral 0,95', pg_temp.posicion('catleya labiata', 'Cattleya labiata'), 1::bigint);
select pruebas.iguales('umbral de la sesión tras la búsqueda', current_setting('pg_trgm.word_similarity_threshold'), '0.95');
create temp table con_umbral_alto as select pg_temp.resultados('vanda') as resultados;
set local pg_trgm.word_similarity_threshold = 0.05;
select pruebas.iguales(
  'mismos resultados con umbral 0,05 que con 0,95',
  pg_temp.resultados('vanda'),
  (select c.resultados from con_umbral_alto c)
);

-- prueba: authenticated puede buscar; anon no (desde #231 usa search_public_species())
set local role anon;
select pruebas.debe_fallar('anon sin token', $$select * from public.search_species('phal amab')$$, '42501');
set local request.jwt.claims = '{"role": "anon"}';
select pruebas.debe_fallar('anon con la clave publicable', $$select * from public.search_species('orquidea mariposa')$$, '42501');
set local role postgres;
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.iguales('authenticated', pg_temp.posicion('phal amab', 'Phalaenopsis amabilis'), 1::bigint);

-- prueba: la búsqueda no devuelve nada fuera del catálogo
-- La planta "Phalaenopsis secretissima" de user_a no es del catálogo: no sale ni para otro
-- usuario ni para su dueño, ni en la búsqueda pública (search_public_species, para anon).
set local role anon;
set local request.jwt.claims = '{"sub": "user_a", "role": "anon"}';
select pruebas.iguales(
  'nombres que no son del catálogo en la búsqueda pública',
  (select count(*) from public.search_public_species('phalaenopsis secretissima', 20) s
     where s.matched_name = 'Phalaenopsis secretissima'),
  0::bigint
);
select pruebas.debe_fallar('anon sigue sin leer plants', 'select * from public.plants', '42501');
set local role postgres;
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_b", "role": "authenticated"}';
select pruebas.iguales(
  'resultados que no son especies del catálogo',
  (select count(*) from public.search_species('phalaenopsis secretissima', 20) s
     where not exists (select from public.species e where e.id = s.id)),
  0::bigint
);
select pruebas.iguales(
  'nombres que no son del catálogo',
  (select count(*) from public.search_species('phalaenopsis secretissima', 20) s
     where s.matched_name = 'Phalaenopsis secretissima'),
  0::bigint
);
set local role postgres;
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.iguales(
  'su dueño tampoco la encuentra',
  (select count(*) from public.search_species('phalaenopsis secretissima', 20) s
     where s.matched_name = 'Phalaenopsis secretissima'),
  0::bigint
);

-- prueba: permisos: authenticated y service_role pueden ejecutar las dos funciones, anon solo normalize_search_text(); PUBLIC no
select pruebas.iguales(
  'permiso de ejecución por rol',
  (select string_agg(f.funcion || ' ' || r.rol || ':' || has_function_privilege(r.rol, f.funcion, 'execute'), ', ' order by f.funcion, r.rol)
     from (values ('public.normalize_search_text(text)'), ('public.search_species(text, integer)')) f (funcion)
     cross join (values ('anon'), ('authenticated'), ('service_role')) r (rol)),
  'public.normalize_search_text(text) anon:true, public.normalize_search_text(text) authenticated:true, '
    || 'public.normalize_search_text(text) service_role:true, public.search_species(text, integer) anon:false, '
    || 'public.search_species(text, integer) authenticated:true, public.search_species(text, integer) service_role:true'
);
select pruebas.iguales(
  'PUBLIC en los permisos de las funciones',
  (select count(*)
     from pg_proc p
     cross join lateral aclexplode(p.proacl) a
     where p.oid in ('public.normalize_search_text(text)'::regprocedure, 'public.search_species(text, integer)'::regprocedure)
       and a.grantee = 0),
  0::bigint
);

-- prueba: propiedades: invoker, search_path vacío, volatilidad y dueño
-- search_species fija además plan_cache_mode = force_generic_plan desde la migración
-- 20261120230000_busqueda_con_catalogo_real.sql (allí se explica por qué).
select pruebas.iguales(
  'normalize_search_text',
  (select p.provolatile::text || ' strict=' || p.proisstrict || ' parallel=' || p.proparallel::text
          || ' definer=' || p.prosecdef || ' ' || array_to_string(p.proconfig, ',') || ' ' || pg_get_userbyid(p.proowner)
     from pg_proc p where p.oid = 'public.normalize_search_text(text)'::regprocedure),
  'i strict=true parallel=s definer=false search_path="" postgres'
);
select pruebas.iguales(
  'search_species',
  (select p.provolatile::text || ' definer=' || p.prosecdef || ' ' || array_to_string(p.proconfig, ',')
          || ' ' || pg_get_userbyid(p.proowner)
     from pg_proc p where p.oid = 'public.search_species(text, integer)'::regprocedure),
  's definer=false search_path="",pg_trgm.word_similarity_threshold=0.3,plan_cache_mode=force_generic_plan postgres'
);
select pruebas.iguales(
  'columnas del resultado de search_species',
  (select pg_get_function_result('public.search_species(text, integer)'::regprocedure)),
  'TABLE(id uuid, scientific_name text, genus_id uuid, genus_name text, type species_type, '
    || 'status species_status, matched_name text, matched_name_type species_match_type)'
);
select pruebas.iguales(
  'argumentos de search_species',
  (select pg_get_function_arguments('public.search_species(text, integer)'::regprocedure)),
  'query text, max_results integer DEFAULT 10'
);

-- prueba: escribir en el catálogo exige poder ejecutar la normalización, que calculan los índices
-- Un administrador (authenticated con el rol) sí puede; un rol sin esos permisos, no.
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.debe_funcionar(
  'el administrador crea una especie y un nombre común',
  $$insert into public.species (scientific_name, genus_id, type, status, source)
      values ('Vanda tricolor', pruebas.genero('Vanda'), 'species', 'validated', 'curated');
    insert into public.species_names (species_id, name, type)
      values (pruebas.especie('Vanda tricolor'), 'vanda de tres colores', 'common')$$
);
select pruebas.iguales('y se encuentra', pg_temp.posicion('vanda tricolr', 'Vanda tricolor'), 1::bigint);
set local role postgres;
create role orki_pruebas_sin_normalizar nologin;
grant usage on schema public to orki_pruebas_sin_normalizar;
grant select, insert on public.genera to orki_pruebas_sin_normalizar;
create policy orki_pruebas_sin_normalizar_genera on public.genera
  for all to orki_pruebas_sin_normalizar using (true) with check (true);
set local role orki_pruebas_sin_normalizar;
select pruebas.debe_fallar(
  'sin permiso sobre normalize_search_text ni el esquema extensions',
  $$insert into public.genera (name) values ('Restrepia')$$,
  '42501'
);

-- prueba: existen los índices de trigramas sobre el texto normalizado
select pruebas.iguales(
  'índices de trigramas',
  (select string_agg(i.indexrelid::regclass::text || ': ' || pg_get_indexdef(i.indexrelid), '; ' order by i.indexrelid::regclass::text)
     from pg_index i
     where i.indexrelid::regclass::text like '%\_trgm\_idx'),
  'genera_name_trgm_idx: CREATE INDEX genera_name_trgm_idx ON public.genera USING gin (normalize_search_text(name) extensions.gin_trgm_ops); '
    || 'species_names_name_trgm_idx: CREATE INDEX species_names_name_trgm_idx ON public.species_names USING gin (normalize_search_text(name) extensions.gin_trgm_ops); '
    || 'species_scientific_name_trgm_idx: CREATE INDEX species_scientific_name_trgm_idx ON public.species USING gin (normalize_search_text(scientific_name) extensions.gin_trgm_ops)'
);

-- prueba: la búsqueda usa los índices de trigramas de species y species_names
-- Con los recorridos secuenciales desactivados, Postgres los usa si la consulta es indexable
-- (es la misma expresión que el índice y un operador de la clase gin_trgm_ops). Se cuentan los
-- recorridos de cada índice en esta transacción antes y después de buscar como authenticated.
create temp table recorridos_antes as
  select c.relname::text as indice, pg_stat_get_xact_numscans(c.oid) as recorridos
  from pg_class c
  where c.relname in ('species_scientific_name_trgm_idx', 'species_names_name_trgm_idx');
grant select on recorridos_antes to authenticated;
set local enable_seqscan = off;
set local role authenticated;
select pruebas.iguales('busca como authenticated', pg_temp.posicion('catleya labiata', 'Cattleya labiata'), 1::bigint);
set local role postgres;
select pruebas.iguales(
  'índices recorridos por la búsqueda',
  (select string_agg(a.indice || ':' || (pg_stat_get_xact_numscans(c.oid) > a.recorridos), ', ' order by a.indice)
     from recorridos_antes a join pg_class c on c.relname = a.indice),
  'species_names_name_trgm_idx:true, species_scientific_name_trgm_idx:true'
);

-- prueba: el plan de la consulta de candidatos usa los índices de trigramas, también el de genera
-- Es la misma condición que search_species() (y que usará la búsqueda de géneros del #69),
-- con la consulta como parámetro, como la recibe la sentencia dentro de la función.
set local enable_seqscan = off;
set local plan_cache_mode = force_generic_plan;
prepare candidatos_especies (text, text) as
  select s.id from public.species s
  where public.normalize_search_text(s.scientific_name) operator(extensions.%>) $1
     or public.normalize_search_text(s.scientific_name) like $2;
prepare candidatos_nombres (text, text) as
  select n.species_id from public.species_names n
  where public.normalize_search_text(n.name) operator(extensions.%>) $1
     or public.normalize_search_text(n.name) like $2;
prepare candidatos_generos (text) as
  select g.id from public.genera g
  where public.normalize_search_text(g.name) operator(extensions.%>) $1;
create temp table planes (consulta text, plan text);
do $$
declare
  linea text;
begin
  for linea in execute 'explain (costs off) execute candidatos_especies(''phal amab'', ''phal% amab%'')' loop
    insert into planes values ('species', linea);
  end loop;
  for linea in execute 'explain (costs off) execute candidatos_nombres(''orquidea mari'', ''orquidea% mari%'')' loop
    insert into planes values ('species_names', linea);
  end loop;
  for linea in execute 'explain (costs off) execute candidatos_generos(''phal'')' loop
    insert into planes values ('genera', linea);
  end loop;
end;
$$;
select pruebas.iguales(
  'índice de cada consulta en su plan',
  (select string_agg(t.consulta || ':' || exists (
            select from planes p where p.consulta = t.consulta and p.plan like '%Bitmap Index Scan on ' || t.indice || '%'),
          ', ' order by t.consulta)
     from (values ('genera', 'genera_name_trgm_idx'),
                  ('species', 'species_scientific_name_trgm_idx'),
                  ('species_names', 'species_names_name_trgm_idx')) t (consulta, indice)),
  'genera:true, species:true, species_names:true'
);
