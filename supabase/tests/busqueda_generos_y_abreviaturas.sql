-- Abreviaturas de género en public.search_species(), public.search_genera() y la carga de
-- abreviaturas habituales (issue #69, parte de #7).
--
-- Las pruebas crean sus propias especies (no usan las de supabase/datos-ejemplo); los géneros y
-- abreviaturas cargados por la migración sí se usan. Que las búsquedas de busqueda_especies.sql
-- siguen dando lo mismo con la expansión de abreviaturas lo comprueba ese mismo archivo, que se
-- ejecuta sobre todas las migraciones.

-- Datos de partida: especies de varios géneros con abreviatura, y dos géneros sin abreviatura
-- cuyo nombre empieza como la abreviatura de otro (Calypso y Cal., Dendrochilum y Den.).
-- Restrepia tampoco tiene abreviatura: sirve para probar una abreviatura desconocida.
insert into public.genera (name) values ('Calypso'), ('Dendrochilum'), ('Restrepia');

insert into public.species (scientific_name, genus_id, type, status, source)
values
  ('Phalaenopsis amabilis', pruebas.genero('Phalaenopsis'), 'species', 'validated', 'curated'),
  ('Phalaenopsis aphrodite', pruebas.genero('Phalaenopsis'), 'species', 'validated', 'curated'),
  ('Cattleya labiata', pruebas.genero('Cattleya'), 'species', 'validated', 'curated'),
  ('Paphiopedilum insigne', pruebas.genero('Paphiopedilum'), 'species', 'validated', 'curated'),
  ('Masdevallia veitchiana', pruebas.genero('Masdevallia'), 'species', 'validated', 'curated'),
  ('Rhyncholaeliocattleya Memoria Helen Brown', pruebas.genero('Rhyncholaeliocattleya'), 'hybrid', 'imported', 'curated'),
  ('Calanthe discolor', pruebas.genero('Calanthe'), 'species', 'validated', 'curated'),
  ('Calypso bulbosa', pruebas.genero('Calypso'), 'species', 'validated', 'curated'),
  ('Dendrobium nobile', pruebas.genero('Dendrobium'), 'species', 'validated', 'curated'),
  ('Dendrochilum magnum', pruebas.genero('Dendrochilum'), 'species', 'validated', 'curated'),
  ('Restrepia veitchiana', pruebas.genero('Restrepia'), 'species', 'validated', 'curated');

insert into public.species_names (species_id, name, type, language)
values (pruebas.especie('Phalaenopsis amabilis'), 'orquídea mariposa', 'common', 'es');

-- Resultados de search_species como texto: "nombre científico [nombre por el que coincidió:tipo]".
create function pg_temp.especies(consulta text, maximo integer default 20)
returns text
language sql
as $$
  select coalesce(
    string_agg(s.scientific_name || ' [' || s.matched_name || ':' || s.matched_name_type || ']', '; '),
    'ninguno'
  )
  from public.search_species(consulta, maximo) s
$$;

-- Primera especie que devuelve search_species.
create function pg_temp.primera(consulta text)
returns text
language sql
as $$
  select s.scientific_name from public.search_species(consulta, 1) s
$$;

-- Resultados de search_genera como texto: "nombre (abreviatura por la que coincidió)".
create function pg_temp.generos(consulta text, maximo integer default 20)
returns text
language sql
as $$
  select coalesce(
    string_agg(g.name || coalesce(' (' || g.matched_abbreviation || ')', ''), ', '),
    'ninguno'
  )
  from public.search_genera(consulta, maximo) g
$$;

-- prueba: especies: la abreviatura se expande con o sin punto y con cualquier mayúscula
select pruebas.iguales('Phal. amab', pg_temp.primera('Phal. amab'), 'Phalaenopsis amabilis');
select pruebas.iguales('phal amab', pg_temp.primera('phal amab'), 'Phalaenopsis amabilis');
select pruebas.iguales('PHAL. AMAB', pg_temp.primera('PHAL. AMAB'), 'Phalaenopsis amabilis');
select pruebas.iguales('pHaL aph', pg_temp.primera('pHaL aph'), 'Phalaenopsis aphrodite');
select pruebas.iguales('Paph. ins', pg_temp.primera('Paph. ins'), 'Paphiopedilum insigne');
select pruebas.iguales('masd veit', pg_temp.primera('masd veit'), 'Masdevallia veitchiana');
select pruebas.iguales('C. lab, de una letra', pg_temp.primera('C. lab'), 'Cattleya labiata');
select pruebas.iguales('c lab, sin punto', pg_temp.primera('c lab'), 'Cattleya labiata');
select pruebas.iguales('Rlc. Memoria, un nothogénero', pg_temp.primera('Rlc. Memoria'), 'Rhyncholaeliocattleya Memoria Helen Brown');
select pruebas.iguales('Phal.  amab, con espacios de más', pg_temp.primera('  Phal.   amab '), 'Phalaenopsis amabilis');
-- Con un error de tipeo en el epíteto también.
select pruebas.iguales('Phal. amabilsi', pg_temp.primera('Phal. amabilsi'), 'Phalaenopsis amabilis');

-- prueba: especies: el nombre por el que coincidió es el del catálogo, no la abreviatura
select pruebas.iguales(
  'Phal. amab',
  pg_temp.especies('Phal. amab', 1),
  'Phalaenopsis amabilis [Phalaenopsis amabilis:scientific]'
);
select pruebas.iguales(
  'fila de Paph. ins',
  (select s.scientific_name || ' / ' || s.genus_name || ' / ' || (s.genus_id = pruebas.genero('Paphiopedilum'))
     from public.search_species('Paph. ins', 1) s),
  'Paphiopedilum insigne / Paphiopedilum / true'
);

-- prueba: especies: una abreviatura desconocida se busca como texto normal
-- Restrepia no tiene abreviatura: "rstp veit" no se expande, no es prefijo de nada y no
-- encuentra Restrepia veitchiana por similitud. Al cargar "Rstp." sí.
select pruebas.comprobar(
  'rstp veit sin abreviatura: Restrepia veitchiana no sale primero',
  pg_temp.primera('rstp veit') is distinct from 'Restrepia veitchiana'
);
insert into public.genus_abbreviations (genus_id, abbreviation) values (pruebas.genero('Restrepia'), 'Rstp.');
select pruebas.iguales('rstp veit con la abreviatura', pg_temp.primera('rstp veit'), 'Restrepia veitchiana');
select pruebas.iguales('Rstp. veit con la abreviatura', pg_temp.primera('Rstp. veit'), 'Restrepia veitchiana');
-- Una palabra que no es abreviatura de nada sigue funcionando por similitud.
select pruebas.comprobar(
  'phl amabilis, una abreviatura mal escrita, encuentra por similitud',
  (select bool_or(s.scientific_name = 'Phalaenopsis amabilis') from public.search_species('phl amabilis', 5) s)
);
-- Solo se expande la primera palabra: "veit rstp" no encuentra Restrepia veitchiana por prefijo.
select pruebas.comprobar(
  'veit rstp: la abreviatura en segunda posición no se expande',
  pg_temp.primera('veit rstp') is distinct from 'Restrepia veitchiana'
);

-- prueba: especies: la consulta que es solo la abreviatura busca el género entero
select pruebas.iguales(
  'phal',
  (select string_agg(s.scientific_name, ', ') from public.search_species('phal', 2) s),
  'Phalaenopsis amabilis, Phalaenopsis aphrodite'
);
select pruebas.iguales('phal. igual que phal', pg_temp.especies('phal.'), pg_temp.especies('phalaenopsis'));
select pruebas.iguales('Phal. igual que phal.', pg_temp.especies('Phal.'), pg_temp.especies('phal.'));
select pruebas.iguales('paph.', pg_temp.primera('paph.'), 'Paphiopedilum insigne');
select pruebas.iguales('c., de una letra con punto', pg_temp.primera('c.'), 'Cattleya labiata');
select pruebas.iguales('c, una sola letra, no busca', (select count(*) from public.search_species('c')), 0::bigint);
select pruebas.iguales('., sin letras, no busca', (select count(*) from public.search_species('. ')), 0::bigint);

-- prueba: especies: una abreviatura que es también el comienzo de otro género busca las dos formas
-- "cal" es la abreviatura de Calanthe y el comienzo de Calypso; "den", la de Dendrobium y el
-- comienzo de Dendrochilum. Primero sale el género de la abreviatura y después el otro.
select pruebas.iguales('cal bul encuentra Calypso bulbosa', pg_temp.primera('cal bul'), 'Calypso bulbosa');
select pruebas.iguales('cal dis encuentra Calanthe discolor', pg_temp.primera('cal dis'), 'Calanthe discolor');
select pruebas.iguales(
  'cal: primero Calanthe y después Calypso',
  (select string_agg(s.scientific_name, ', ') from public.search_species('cal', 2) s),
  'Calanthe discolor, Calypso bulbosa'
);
select pruebas.iguales(
  'den: primero Dendrobium y después Dendrochilum',
  (select string_agg(s.scientific_name, ', ') from public.search_species('den', 2) s),
  'Dendrobium nobile, Dendrochilum magnum'
);
select pruebas.iguales('dendroch mag, sin abreviatura', pg_temp.primera('dendroch mag'), 'Dendrochilum magnum');
select pruebas.iguales(
  'especies repetidas cuando coinciden las dos formas',
  (select count(*) - count(distinct s.id) from public.search_species('phal', 20) s),
  0::bigint
);

-- prueba: especies: las búsquedas que no empiezan por una abreviatura no cambian
select pruebas.iguales('orquidea mariposa', pg_temp.especies('orquidea mariposa', 1), 'Phalaenopsis amabilis [orquídea mariposa:common]');
select pruebas.iguales('catleya labiata', pg_temp.primera('catleya labiata'), 'Cattleya labiata');
select pruebas.iguales('dendro', pg_temp.primera('dendro'), 'Dendrobium nobile');

-- prueba: especies: firma, propiedades y permisos se conservan al redefinirla
select pruebas.iguales(
  'propiedades de search_species',
  (select p.provolatile::text || ' definer=' || p.prosecdef || ' ' || array_to_string(p.proconfig, ',')
          || ' ' || pg_get_userbyid(p.proowner) || ' rows=' || p.prorows
     from pg_proc p where p.oid = 'public.search_species(text, integer)'::regprocedure),
  's definer=false search_path="",pg_trgm.word_similarity_threshold=0.3 postgres rows=20'
);
select pruebas.iguales(
  'firma de search_species',
  (select pg_get_function_arguments(p.oid) || ' -> ' || pg_get_function_result(p.oid)
     from pg_proc p where p.oid = 'public.search_species(text, integer)'::regprocedure),
  'query text, max_results integer DEFAULT 10 -> TABLE(id uuid, scientific_name text, genus_id uuid, genus_name text, '
    || 'type species_type, status species_status, matched_name text, matched_name_type species_match_type)'
);
select pruebas.iguales(
  'funciones search_species',
  (select count(*) from pg_proc p where p.proname = 'search_species'),
  1::bigint
);

-- prueba: especies: anon busca con abreviaturas
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select pruebas.iguales('anon: Phal. amab', pg_temp.primera('Phal. amab'), 'Phalaenopsis amabilis');

-- prueba: géneros: un error de tipeo encuentra el género
select pruebas.iguales('masdevalia', (select g.name from public.search_genera('masdevalia', 1) g), 'Masdevallia');
select pruebas.iguales('catleya', (select g.name from public.search_genera('catleya', 1) g), 'Cattleya');
select pruebas.iguales('phalenopsis', (select g.name from public.search_genera('phalenopsis', 1) g), 'Phalaenopsis');
select pruebas.iguales('paphiopedillum', (select g.name from public.search_genera('paphiopedillum', 1) g), 'Paphiopedilum');
select pruebas.iguales('zygopetallum', (select g.name from public.search_genera('zygopetallum', 1) g), 'Zygopetalum');

-- prueba: géneros: sin tildes, con tildes de más y en mayúsculas
select pruebas.iguales('Cáttleya', (select g.name from public.search_genera('Cáttleya', 1) g), 'Cattleya');
select pruebas.iguales('PAPHIOPEDÍLUM', (select g.name from public.search_genera('PAPHIOPEDÍLUM', 1) g), 'Paphiopedilum');
select pruebas.iguales('  vanda  ', (select g.name from public.search_genera('  vanda  ', 1) g), 'Vanda');

-- prueba: géneros: por prefijo, primero los prefijos y luego la similitud
select pruebas.iguales('masde', pg_temp.generos('masde', 1), 'Masdevallia');
select pruebas.iguales('dendro', pg_temp.generos('dendro', 2), 'Dendrobium, Dendrochilum');
select pruebas.iguales('cattl', pg_temp.generos('cattl', 2), 'Cattleya, Cattlianthe');
-- "laelio" es prefijo de Laeliocattleya, y Rhyncholaeliocattleya solo lo contiene.
select pruebas.iguales('laelio', pg_temp.generos('laelio', 1), 'Laeliocattleya');
select pruebas.comprobar(
  'laelio: Rhyncholaeliocattleya sale después, por similitud',
  (select bool_or(g.name = 'Rhyncholaeliocattleya') from public.search_genera('laelio', 20) g)
);

-- prueba: géneros: por abreviatura, con o sin punto y con cualquier mayúscula
select pruebas.iguales('Mps.', pg_temp.generos('Mps.', 1), 'Miltoniopsis (Mps.)');
select pruebas.iguales('mps', pg_temp.generos('mps', 1), 'Miltoniopsis (Mps.)');
select pruebas.iguales('RLC', pg_temp.generos('RLC', 1), 'Rhyncholaeliocattleya (Rlc.)');
select pruebas.iguales('c., de una letra', pg_temp.generos('c.', 1), 'Cattleya (C.)');
select pruebas.iguales('blc., histórico', pg_temp.generos('blc.', 1), 'Brassolaeliocattleya (Blc.)');
-- "phal" es la abreviatura y el prefijo del nombre: gana la abreviatura y sale una vez.
select pruebas.iguales('phal', pg_temp.generos('phal', 1), 'Phalaenopsis (Phal.)');
select pruebas.iguales(
  'phal: Phalaenopsis sale una sola vez',
  (select count(*) from public.search_genera('phal', 20) g where g.name = 'Phalaenopsis'),
  1::bigint
);
-- Por su nombre, sin abreviatura.
select pruebas.iguales('phalaenopsis', pg_temp.generos('phalaenopsis', 1), 'Phalaenopsis');
-- "cal" es Calanthe por abreviatura y Calypso por prefijo.
select pruebas.iguales('cal', pg_temp.generos('cal', 2), 'Calanthe (Cal.), Calypso');

-- prueba: géneros: devuelve id, nombre, acceso rápido y abreviatura
select pruebas.iguales(
  'fila de Phal.',
  (select (g.id = pruebas.genero('Phalaenopsis')) || ' / ' || g.name || ' / ' || g.is_quick_access
          || ' / ' || g.matched_abbreviation
     from public.search_genera('Phal.', 1) g),
  'true / Phalaenopsis / true / Phal.'
);
select pruebas.iguales(
  'fila de masdevalia',
  (select (g.id = pruebas.genero('Masdevallia')) || ' / ' || g.name || ' / ' || g.is_quick_access
          || ' / ' || coalesce(g.matched_abbreviation, 'null')
     from public.search_genera('masdevalia', 1) g),
  'true / Masdevallia / false / null'
);
select pruebas.iguales(
  'columnas del resultado de search_genera',
  (select pg_get_function_result('public.search_genera(text, integer)'::regprocedure)),
  'TABLE(id uuid, name text, is_quick_access boolean, matched_abbreviation text)'
);
select pruebas.iguales(
  'argumentos de search_genera',
  (select pg_get_function_arguments('public.search_genera(text, integer)'::regprocedure)),
  'query text, max_results integer DEFAULT 10'
);

-- prueba: géneros: consultas nulas, vacías, demasiado cortas o largas devuelven vacío sin error
select pruebas.iguales('nula', (select count(*) from public.search_genera(null)), 0::bigint);
select pruebas.iguales('vacía', (select count(*) from public.search_genera('')), 0::bigint);
select pruebas.iguales('solo espacios', (select count(*) from public.search_genera('    ')), 0::bigint);
select pruebas.iguales('una letra', (select count(*) from public.search_genera('c')), 0::bigint);
select pruebas.iguales('sin letras ni números', (select count(*) from public.search_genera('%.')), 0::bigint);
select pruebas.iguales('100 caracteres sí buscan', pg_temp.generos('vanda' || repeat(' ', 95), 1), 'Vanda');
select pruebas.iguales('101 caracteres', (select count(*) from public.search_genera('vanda' || repeat(' ', 96))), 0::bigint);
select pruebas.iguales('un millón de caracteres', (select count(*) from public.search_genera(repeat('vanda ', 200000))), 0::bigint);
-- Los comodines de LIKE no se interpretan: "v_nda" no es prefijo de Vanda.
select pruebas.iguales('v%a', (select count(*) from public.search_genera('v%a')), 0::bigint);

-- prueba: géneros: tope de resultados: 10 por defecto, 20 como máximo, y el valor por defecto si no es positivo
insert into public.genera (name)
select 'Testgenus' || lpad(i::text, 2, '0') from generate_series(1, 25) i;
select pruebas.iguales('sin max_results', (select count(*) from public.search_genera('testgenus')), 10::bigint);
select pruebas.iguales('max_results 3', (select count(*) from public.search_genera('testgenus', 3)), 3::bigint);
select pruebas.iguales('max_results 20', (select count(*) from public.search_genera('testgenus', 20)), 20::bigint);
select pruebas.iguales('max_results 1000', (select count(*) from public.search_genera('testgenus', 1000)), 20::bigint);
select pruebas.iguales('max_results nulo', (select count(*) from public.search_genera('testgenus', null)), 10::bigint);
select pruebas.iguales('max_results 0', (select count(*) from public.search_genera('testgenus', 0)), 10::bigint);
select pruebas.iguales('max_results negativo', (select count(*) from public.search_genera('testgenus', -1)), 10::bigint);
select pruebas.iguales(
  'en orden alfabético a igual similitud',
  (select string_agg(g.name, ', ') from public.search_genera('testgenus', 3) g),
  'Testgenus01, Testgenus02, Testgenus03'
);

-- prueba: géneros: el umbral de similitud de la sesión no cambia el resultado
set local pg_trgm.word_similarity_threshold = 0.95;
select pruebas.iguales('con umbral 0,95', (select g.name from public.search_genera('masdevalia', 1) g), 'Masdevallia');
select pruebas.iguales('umbral de la sesión tras la búsqueda', current_setting('pg_trgm.word_similarity_threshold'), '0.95');

-- prueba: géneros: anon, authenticated y service_role pueden buscar; PUBLIC no tiene permiso
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select pruebas.iguales('anon', pg_temp.generos('Mps.', 1), 'Miltoniopsis (Mps.)');
set local role postgres;
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.iguales('authenticated', pg_temp.generos('catleya', 1), 'Cattleya');
set local role postgres;
set local role service_role;
select pruebas.iguales('service_role', pg_temp.generos('catleya', 1), 'Cattleya');
set local role postgres;
select pruebas.iguales(
  'permiso de ejecución por rol',
  (select string_agg(r.rol || ':' || has_function_privilege(r.rol, 'public.search_genera(text, integer)', 'execute'), ', ' order by r.rol)
     from (values ('anon'), ('authenticated'), ('service_role')) r (rol)),
  'anon:true, authenticated:true, service_role:true'
);
select pruebas.iguales(
  'PUBLIC en los permisos de search_genera y search_species',
  (select count(*)
     from pg_proc p
     cross join lateral aclexplode(p.proacl) a
     where p.oid in ('public.search_genera(text, integer)'::regprocedure, 'public.search_species(text, integer)'::regprocedure)
       and a.grantee = 0),
  0::bigint
);

-- prueba: géneros: anon no lee nada fuera del catálogo a través de la búsqueda
-- El nombre que un usuario escribe en su planta (entered_name) no es del catálogo.
insert into public.profiles (id) values ('user_a');
insert into public.plants (user_id, entered_name, genus_id, type)
values ('user_a', 'Secretissima rara', pruebas.genero('Vanda'), 'unknown');
set local role anon;
select pruebas.iguales('secretissima', pg_temp.generos('secretissima'), 'ninguno');
select pruebas.iguales(
  'resultados que no son géneros del catálogo',
  (select count(*) from public.search_genera('vanda', 20) g
     where not exists (select from public.genera e where e.id = g.id)),
  0::bigint
);

-- prueba: géneros: propiedades: invoker, search_path vacío, umbral fijo, volatilidad y dueño
select pruebas.iguales(
  'search_genera',
  (select p.provolatile::text || ' definer=' || p.prosecdef || ' ' || array_to_string(p.proconfig, ',')
          || ' ' || pg_get_userbyid(p.proowner) || ' ' || l.lanname
     from pg_proc p join pg_language l on l.oid = p.prolang
     where p.oid = 'public.search_genera(text, integer)'::regprocedure),
  's definer=false search_path="",pg_trgm.word_similarity_threshold=0.3 postgres plpgsql'
);

-- prueba: las búsquedas usan los índices de genera y de las abreviaturas
-- Con los recorridos secuenciales desactivados, Postgres usa un índice si la consulta es
-- indexable (la misma expresión que el índice). Se cuentan los recorridos de cada índice en
-- esta transacción antes y después de buscar como anon.
create temp table recorridos_antes as
  select c.relname::text as indice, pg_stat_get_xact_numscans(c.oid) as recorridos
  from pg_class c
  where c.relname in ('genera_name_trgm_idx', 'genus_abbreviations_search_key');
grant select on recorridos_antes to anon;
set local enable_seqscan = off;
set local role anon;
select pruebas.iguales('busca géneros como anon', pg_temp.generos('masdevalia', 1), 'Masdevallia');
set local role postgres;
select pruebas.iguales(
  'índices recorridos por search_genera',
  (select string_agg(a.indice || ':' || (pg_stat_get_xact_numscans(c.oid) > a.recorridos), ', ' order by a.indice)
     from recorridos_antes a join pg_class c on c.relname = a.indice),
  'genera_name_trgm_idx:true, genus_abbreviations_search_key:true'
);
-- search_species resuelve la abreviatura con el mismo índice.
create temp table recorridos_especies as
  select pg_stat_get_xact_numscans('public.genus_abbreviations_search_key'::regclass) as recorridos;
grant select on recorridos_especies to anon;
set local role anon;
select pruebas.iguales('busca especies como anon', pg_temp.primera('Paph. ins'), 'Paphiopedilum insigne');
set local role postgres;
select pruebas.comprobar(
  'índice de abreviaturas recorrido por search_species',
  pg_stat_get_xact_numscans('public.genus_abbreviations_search_key'::regclass)
    > (select r.recorridos from recorridos_especies r)
);

-- prueba: el plan de la consulta de abreviaturas usa su índice
set local enable_seqscan = off;
set local plan_cache_mode = force_generic_plan;
prepare abreviatura (text) as
  select a.genus_id from public.genus_abbreviations a
  where public.normalize_search_text(pg_catalog.rtrim(a.abbreviation, '.')) = $1;
create temp table planes (plan text);
do $$
declare
  linea text;
begin
  for linea in execute 'explain (costs off) execute abreviatura(''phal'')' loop
    insert into planes values (linea);
  end loop;
end;
$$;
select pruebas.comprobar(
  'Index Scan on genus_abbreviations_search_key',
  exists (select from planes where plan like '%genus_abbreviations_search_key%')
);

-- prueba: abreviaturas: la clave de búsqueda es única, con o sin punto y sin tildes
select pruebas.iguales(
  'índice de la clave',
  pg_get_indexdef('public.genus_abbreviations_search_key'::regclass),
  'CREATE UNIQUE INDEX genus_abbreviations_search_key ON public.genus_abbreviations USING btree (normalize_search_text(rtrim(abbreviation, ''.''::text)))'
);
select pruebas.debe_fallar(
  'Phal sin punto junto a Phal.',
  $$insert into public.genus_abbreviations (genus_id, abbreviation) values (pruebas.genero('Calypso'), 'Phal')$$,
  '23505', 'genus_abbreviations_search_key'
);
select pruebas.debe_fallar(
  'Phál. con tilde junto a Phal.',
  $$insert into public.genus_abbreviations (genus_id, abbreviation) values (pruebas.genero('Calypso'), 'Phál.')$$,
  '23505', 'genus_abbreviations_search_key'
);
select pruebas.debe_funcionar(
  'una abreviatura nueva',
  $$insert into public.genus_abbreviations (genus_id, abbreviation) values (pruebas.genero('Calypso'), 'Cyps.')$$
);
-- Un administrador puede seguir escribiendo abreviaturas (calcula el índice con sus permisos).
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.debe_funcionar(
  'el administrador añade una abreviatura',
  $$insert into public.genus_abbreviations (genus_id, abbreviation) values (pruebas.genero('Dendrochilum'), 'Ddc.')$$
);
select pruebas.iguales('y se busca', pg_temp.primera('ddc mag'), 'Dendrochilum magnum');

-- prueba: abreviaturas cargadas: la lista completa, estándar de la RHS
select pruebas.iguales(
  'géneros y abreviaturas',
  (select string_agg(g.name || '=' || a.abbreviation, ', ' order by g.name)
     from public.genera g join public.genus_abbreviations a on a.genus_id = g.id),
  'Aerides=Aer., Angraecum=Angcm., Anguloa=Ang., Ascocenda=Ascda., Bletilla=Ble., Brassavola=B., '
    || 'Brassia=Brs., Brassocattleya=Bc., Brassolaeliocattleya=Blc., Bulbophyllum=Bulb., Calanthe=Cal., '
    || 'Cattleya=C., Cattlianthe=Ctt., Coelogyne=Coel., Cymbidium=Cym., Cypripedium=Cyp., Dendrobium=Den., '
    || 'Doritaenopsis=Dtps., Dracula=Drac., Encyclia=E., Epidendrum=Epi., Guarianthe=Gur., Laelia=L., '
    || 'Laeliocattleya=Lc., Lycaste=Lyc., Masdevallia=Masd., Maxillaria=Max., Miltonia=Milt., '
    || 'Miltoniopsis=Mps., Odontoglossum=Odm., Oncidium=Onc., Paphiopedilum=Paph., Phalaenopsis=Phal., '
    || 'Phragmipedium=Phrag., Pleione=Pln., Rhyncholaeliocattleya=Rlc., Rhynchostylis=Rhy., '
    || 'Sophrolaeliocattleya=Slc., Sophronitis=Soph., Stanhopea=Stan., Tolumnia=Tolu., Vanda=V., Zygopetalum=Z.'
);
select pruebas.iguales(
  'los géneros nuevos no son de acceso rápido',
  (select string_agg(name, ', ' order by name) from public.genera where is_quick_access),
  'Cattleya, Dendrobium, Oncidium, Phalaenopsis, Vanda'
);

-- prueba: abreviaturas cargadas: no chocan entre sí ni con el nombre de un género
select pruebas.iguales(
  'claves de búsqueda repetidas',
  (select count(*) - count(distinct public.normalize_search_text(rtrim(abbreviation, '.')))
     from public.genus_abbreviations),
  0::bigint
);
select pruebas.iguales(
  'claves que son el nombre de un género',
  (select coalesce(string_agg(a.abbreviation, ', '), 'ninguna')
     from public.genus_abbreviations a
     join public.genera g on public.normalize_search_text(g.name) = public.normalize_search_text(rtrim(a.abbreviation, '.'))),
  'ninguna'
);
select pruebas.iguales(
  'abreviaturas sin el punto final o con más de una palabra',
  (select coalesce(string_agg(abbreviation, ', '), 'ninguna')
     from public.genus_abbreviations where abbreviation !~ '^[A-Z][a-z]*\.$'),
  'ninguna'
);
-- Cada abreviatura expande a su género en la búsqueda de géneros.
select pruebas.iguales(
  'abreviaturas que no encuentran su género primero',
  (select coalesce(string_agg(a.abbreviation, ', '), 'ninguna')
     from public.genus_abbreviations a
     where (select g.id from public.search_genera(a.abbreviation, 1) g) is distinct from a.genus_id),
  'ninguna'
);
