-- Orden y etapas de la búsqueda (parte de #7 y #8): las clases de coincidencia de
-- public.search_species() (prefijo del nombre científico, prefijo de otro nombre, similitud),
-- el corte temprano, las dos pasadas de similitud, el epíteto, el desempate sin el signo de
-- híbrido y el orden de public.search_genera(), de la migración
-- 20261120230000_busqueda_con_catalogo_real.sql.
--
-- Las pruebas crean sus propias especies (no usan las de supabase/datos-ejemplo); los géneros y
-- abreviaturas cargados por las migraciones sí se usan. Los nombres inventados para provocar un
-- caso concreto se señalan con "ficticio".

-- Datos de partida: géneros con y sin el signo de híbrido, especies e híbridos naturales
-- guardados como los da COL, sinónimos con y sin variedad, y un género con más especies que
-- el tope de resultados.
update public.genera set name = '× Cattlianthe' where name = 'Cattlianthe';
insert into public.genera (name) values ('Catasetum'), ('× Cattleychea'), ('× Catyclia'), ('Andinia');

insert into public.species (scientific_name, genus_id, type, status, source)
values
  ('Phalaenopsis amabilis', pruebas.genero('Phalaenopsis'), 'species', 'imported', 'curated'),
  ('Phalaenopsis × amphitrite', pruebas.genero('Phalaenopsis'), 'hybrid', 'imported', 'curated'),
  ('Phalaenopsis aphrodite', pruebas.genero('Phalaenopsis'), 'species', 'imported', 'curated'),
  ('Phalaenopsis × intermedia', pruebas.genero('Phalaenopsis'), 'hybrid', 'imported', 'curated'),
  ('Phalaenopsis pulcherrima', pruebas.genero('Phalaenopsis'), 'species', 'imported', 'curated'),
  ('Cattleya labiata', pruebas.genero('Cattleya'), 'species', 'imported', 'curated'),
  ('Cattleya × labendziana', pruebas.genero('Cattleya'), 'hybrid', 'imported', 'curated'),
  ('Cattleya purpurata', pruebas.genero('Cattleya'), 'species', 'imported', 'curated'),
  ('Cattleya × elegans', pruebas.genero('Cattleya'), 'hybrid', 'imported', 'curated'),
  ('Cattleya coccinea', pruebas.genero('Cattleya'), 'species', 'imported', 'curated'),
  ('Dendrobium nobile', pruebas.genero('Dendrobium'), 'species', 'imported', 'curated'),
  ('Dendrobium nodosum', pruebas.genero('Dendrobium'), 'species', 'imported', 'curated'),
  ('Dendrobium × delicatum', pruebas.genero('Dendrobium'), 'hybrid', 'imported', 'curated'),
  ('Oncidium nobile', pruebas.genero('Oncidium'), 'species', 'imported', 'curated'),
  ('Masdevallia veitchiana', pruebas.genero('Masdevallia'), 'species', 'imported', 'curated'),
  ('Andinia masdevalliopsis', pruebas.genero('Andinia'), 'species', 'imported', 'curated'),
  -- ficticio: el epíteto empieza por la consulta "phal", sin que el nombre empiece por ella.
  ('Cattleya phalaenoides', pruebas.genero('Cattleya'), 'species', 'imported', 'curated');

-- Dendrobium con más especies que el tope (25, con 3 híbridos).
insert into public.species (scientific_name, genus_id, type, status, source)
select 'Dendrobium ' || e, pruebas.genero('Dendrobium'), 'species', 'imported', 'curated'
from unnest(array['aberrans', 'acerosum', 'aciculare', 'aduncum', 'aemulum', 'aggregatum', 'albosanguineum',
                  'amethystoglossum', 'anosmum', 'antennatum', 'aphyllum', 'atroviolaceum', 'bellatulum',
                  'bigibbum', 'bracteosum', 'bullenianum', 'chrysotoxum', 'crumenatum', 'cuthbertsonii',
                  'densiflorum', 'farmeri', 'fimbriatum']) e;
insert into public.species (scientific_name, genus_id, type, status, source)
values
  ('Dendrobium × usitae', pruebas.genero('Dendrobium'), 'hybrid', 'imported', 'curated'),
  ('Dendrobium × aberrans-hybridum', pruebas.genero('Dendrobium'), 'hybrid', 'imported', 'curated');

insert into public.species_names (species_id, name, type, language)
values
  (pruebas.especie('Cattleya purpurata'), 'Laelia purpurata', 'synonym', null),
  (pruebas.especie('Cattleya × elegans'), 'Laelia purpurata var. brysiana', 'synonym', null),
  (pruebas.especie('Cattleya coccinea'), 'Sophronitis coccinea', 'synonym', null),
  (pruebas.especie('Phalaenopsis pulcherrima'), 'Doritis pulcherrima', 'synonym', null),
  (pruebas.especie('Phalaenopsis amabilis'), 'Phalaenopsis amabilis var. aurea', 'synonym', null),
  (pruebas.especie('Phalaenopsis amabilis'), 'orquídea mariposa', 'common', 'es'),
  (pruebas.especie('Dendrobium nobile'), 'Dendrobium nobile var. alboluteum', 'synonym', null),
  -- ficticio: un sinónimo que empieza por "dendrob" de una especie de otro género.
  (pruebas.especie('Oncidium nobile'), 'Dendrobium oncidioides', 'synonym', null);

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

-- Solo los nombres científicos, separados por comas.
create function pg_temp.nombres(consulta text, maximo integer default 20)
returns text
language sql
as $$
  select coalesce(string_agg(s.scientific_name, ', '), 'ninguno')
  from public.search_species(consulta, maximo) s
$$;

-- Resultados de search_genera como texto: "nombre (abreviatura)" y un asterisco si es de acceso rápido.
create function pg_temp.generos(consulta text, maximo integer default 20)
returns text
language sql
as $$
  select coalesce(
    string_agg(g.name || coalesce(' (' || g.matched_abbreviation || ')', '') || case when g.is_quick_access then '*' else '' end, ', '),
    'ninguno'
  )
  from public.search_genera(consulta, maximo) g
$$;

-- Referencia: la regla de orden de search_species() escrita como una sola consulta que puntúa y
-- ordena todos los nombres del catálogo, sin etapas, sin corte temprano, sin índices y con una
-- sola pasada de similitud (umbral 0,3). La función por etapas debe dar exactamente lo mismo.
create function pg_temp.referencia(consulta text, maximo integer default 20)
returns text
language sql
as $$
  with consulta_normalizada as (
    select public.normalize_search_text(consulta) as escrita
  ),
  formas as (
    -- La forma escrita y, si la primera palabra es una abreviatura, la expandida.
    select c.escrita as forma, false as expandida, c.escrita from consulta_normalizada c
    union all
    select public.normalize_search_text(g.name)
             || substr(c.escrita, char_length(split_part(c.escrita, ' ', 1)) + 1),
           true, c.escrita
    from consulta_normalizada c
    join public.genus_abbreviations a
      on public.normalize_search_text(rtrim(a.abbreviation, '.')) = rtrim(split_part(c.escrita, ' ', 1), '.')
    join public.genera g on g.id = a.genus_id
  ),
  formas_con_patron as (
    select f.*,
      replace(replace(replace(replace(f.forma, '\', '\\'), '%', '\%'), '_', '\_'), ' ', '% ') || '%' as patron,
      case when char_length(split_part(f.escrita, ' ', 2)) >= 3 then split_part(f.escrita, ' ', 2) end as epiteto
    from formas f
  ),
  nombres as (
    select s.id as especie, s.scientific_name as nombre, 'scientific'::public.species_match_type as tipo
    from public.species s
    union all
    select n.species_id, n.name, n.type::text::public.species_match_type
    from public.species_names n
  ),
  puntuados as (
    select n.*, f.expandida,
      public.normalize_search_text(n.nombre) as normalizado,
      case
        when public.normalize_search_text(n.nombre) like f.patron and n.tipo = 'scientific' then 1
        when public.normalize_search_text(n.nombre) like f.patron then 2
        when char_length(f.forma) >= 3
         and extensions.word_similarity(f.forma, public.normalize_search_text(n.nombre)) >= 0.3
         and coalesce(extensions.word_similarity(f.epiteto, public.normalize_search_text(n.nombre)) >= 0.3, true)
          then 3
      end as clase,
      least(
        extensions.word_similarity(f.forma, public.normalize_search_text(n.nombre)),
        coalesce(extensions.word_similarity(f.epiteto, public.normalize_search_text(n.nombre)),
                 extensions.word_similarity(f.forma, public.normalize_search_text(n.nombre)))
      ) as puntuacion,
      extensions.word_similarity(f.forma, public.normalize_search_text(n.nombre)) as similitud
    from nombres n
    cross join formas_con_patron f
    where char_length(consulta) <= 100
      and char_length(f.escrita) >= 2 and f.escrita ~ '[[:alnum:]]'
  ),
  con_claves as (
    select p.*, s.type = 'hybrid' as hibrido,
      p.clase as k1,
      case when p.clase < 3 then (not p.expandida)::int else 0 end as k2,
      case when p.clase = 3 then -p.puntuacion else 0 end as k3,
      case when p.clase = 3 then -p.similitud else 0 end as k4,
      case when p.clase = 3 then p.tipo else 'scientific' end as k5
    from puntuados p
    join public.species s on s.id = p.especie
    where p.clase is not null
  ),
  mejores as (
    select distinct on (c.especie) c.*
    from con_claves c
    order by c.especie, c.k1, c.k2, c.k3, c.k4, c.k5, c.normalizado collate "C"
  ),
  ordenados as (
    select m.*, row_number() over (
      order by m.k1, m.k2, m.k3, m.k4, m.k5, m.hibrido, m.normalizado collate "C", m.especie
    ) as puesto
    from mejores m
  )
  select coalesce(string_agg(s.scientific_name || ' [' || o.nombre || ':' || o.tipo || ']', '; ' order by o.puesto), 'ninguno')
  from ordenados o
  join public.species s on s.id = o.especie
  where o.puesto <= case when maximo is null or maximo <= 0 then 10 else least(maximo, 20) end
$$;

-- prueba: especies: el signo de híbrido no cuenta al desempatar, y las especies van antes que los híbridos
-- Antes, "ph" ordenaba por el nombre guardado y "Phalaenopsis × amphitrite" podía salir entre
-- las especies (o delante, según la intercalación del servidor).
select pruebas.iguales(
  'ph',
  pg_temp.nombres('ph'),
  'Phalaenopsis amabilis, Phalaenopsis aphrodite, Phalaenopsis pulcherrima, Phalaenopsis × amphitrite, Phalaenopsis × intermedia'
);
select pruebas.iguales(
  'cattleya lab: la especie antes que el híbrido, aunque "labendziana" vaya antes en el alfabeto',
  pg_temp.nombres('cattleya lab'),
  'Cattleya labiata, Cattleya × labendziana'
);
-- Entre híbridos, por el nombre sin el signo.
select pruebas.iguales(
  'phal x: los dos híbridos, por su epíteto',
  (select string_agg(s.scientific_name, ', ') from public.search_species('phal', 5) s where s.type = 'hybrid'),
  'Phalaenopsis × amphitrite, Phalaenopsis × intermedia'
);
-- Quien escribe el híbrido entero lo encuentra primero.
select pruebas.iguales('cattleya x labendziana', pg_temp.nombres('cattleya x labendziana', 1), 'Cattleya × labendziana');

-- prueba: especies: todo prefijo va antes que la similitud
-- "Cattleya phalaenoides" tiene una palabra que empieza por "phal" y sale por similitud, pero
-- detrás de todas las Phalaenopsis, que empiezan por "phal".
create temp table puestos_phal as
  select s.scientific_name, row_number() over () as n from public.search_species('phal', 20) s;
select pruebas.comprobar('phal: sale Cattleya phalaenoides', exists (select from puestos_phal where scientific_name = 'Cattleya phalaenoides'));
select pruebas.comprobar(
  'phal: Cattleya phalaenoides, detrás de todas las Phalaenopsis',
  (select max(n) from puestos_phal where scientific_name like 'Phalaenopsis %')
    < (select n from puestos_phal where scientific_name = 'Cattleya phalaenoides')
);
-- Un sinónimo que empieza como la consulta va antes que un nombre científico que solo se le
-- parece: "laelia purpurata" devuelve Cattleya purpurata por su sinónimo, y el nombre exacto
-- va antes que el de la variedad.
select pruebas.iguales(
  'laelia purpurata',
  pg_temp.especies('laelia purpurata', 2),
  'Cattleya purpurata [Laelia purpurata:synonym]; Cattleya × elegans [Laelia purpurata var. brysiana:synonym]'
);
select pruebas.iguales('sophronitis coccinea', pg_temp.especies('sophronitis coccinea', 1), 'Cattleya coccinea [Sophronitis coccinea:synonym]');
select pruebas.iguales('doritis pulcherrima', pg_temp.especies('doritis pulcherrima', 1), 'Phalaenopsis pulcherrima [Doritis pulcherrima:synonym]');
-- Los nombres científicos que empiezan como la consulta van antes que los sinónimos que también
-- lo hacen: "dendrob" devuelve las especies de Dendrobium (25 más 3 híbridos) antes que
-- Oncidium nobile por su sinónimo "Dendrobium oncidioides".
select pruebas.comprobar(
  'dendrob: Oncidium nobile no sale entre los 20 primeros',
  not exists (select from public.search_species('dendrob', 20) s where s.scientific_name = 'Oncidium nobile')
);
select pruebas.iguales(
  'dendrob: las primeras, especies en orden alfabético',
  pg_temp.nombres('dendrob', 3),
  'Dendrobium aberrans, Dendrobium acerosum, Dendrobium aciculare'
);

-- prueba: especies: con varias palabras, la similitud exige parecerse también al epíteto
-- "dendrobum nobile" (con error) no tiene prefijo. Antes dejaba pasar todos los nombres de
-- Dendrobium, porque la palabra del género da casi todos los trigramas; ahora solo los que se
-- parecen también a "nobile" (Dendrobium nodosum, por "no...") y Oncidium nobile por el
-- epíteto, que pasa delante de Dendrobium nodosum porque la puntuación es la menor de las dos
-- similitudes.
select pruebas.iguales(
  'dendrobum nobile',
  pg_temp.nombres('dendrobum nobile'),
  'Dendrobium nobile, Oncidium nobile, Dendrobium nodosum'
);
select pruebas.comprobar(
  'Dendrobium aberrans pasa el umbral con la consulta entera, pero no sale',
  extensions.word_similarity('dendrobum nobile', 'dendrobium aberrans') >= 0.3
    and not exists (select from public.search_species('dendrobum nobile', 20) s where s.scientific_name = 'Dendrobium aberrans')
);
-- Un epíteto de menos de 3 caracteres no filtra: "phalaenopsis x" (la x final se conserva)
-- sigue encontrando los híbridos de Phalaenopsis por similitud con el género.
select pruebas.comprobar(
  'phalaenopsis x encuentra Phalaenopsis × intermedia',
  exists (select from public.search_species('phalaenopsis x', 20) s where s.scientific_name = 'Phalaenopsis × intermedia')
);

-- prueba: especies: las etapas dan lo mismo que ordenar todos los candidatos a la vez
-- La referencia aplica la regla de orden de una vez, sin etapas, sin corte y con una sola
-- pasada de similitud (0,3). Se comparan consultas de las tres clases, con y sin abreviatura,
-- con varios topes, así que también se comprueba que el corte temprano y las dos pasadas no
-- cambian nada.
create temp table comparacion as
select c.consulta, m.maximo, pg_temp.especies(c.consulta, m.maximo) as obtenido, pg_temp.referencia(c.consulta, m.maximo) as esperado
from unnest(array[
  'ph', 'phal', 'phal amab', 'Phal. amab', 'phal x interm', 'phalaenopsis intermedia', 'cattleya lab',
  'catleya labiata', 'dendrob', 'den', 'den nob', 'dendrobum nobile', 'dendrobium nobile var', 'masdevalia',
  'masd veit', 'laelia purpurata', 'laelia', 'sophronitis coccinea', 'doritis', 'orquidea mariposa', 'mariposa',
  'nobile', 'alba', 'catl', 'c.', 'c lab', 'x a', 'xqzvkjw', 'dendrobium x', 'onc nob'
]) as c (consulta)
cross join unnest(array[1, 3, 5, 10, 20]) as m (maximo);
select pruebas.iguales(
  'consultas en las que la función y la referencia difieren',
  (select coalesce(string_agg(c.consulta || ' (' || c.maximo || '): ' || c.obtenido || ' <> ' || c.esperado, ' | '), 'ninguna')
     from comparacion c where c.obtenido is distinct from c.esperado),
  'ninguna'
);
select pruebas.comprobar(
  'la comparación incluye resultados de las tres clases',
  (select count(distinct c.obtenido) from comparacion c) > 20
);

-- prueba: especies: dos pasadas de similitud, la primera con umbral 0,6
-- "masdevalia" no empieza como ningún nombre. Andinia masdevalliopsis y Masdevallia veitchiana
-- superan 0,6; con el tope 1 basta la primera pasada, y con más sale también Dendrobium y lo
-- demás que solo supera 0,3, siempre detrás. Lo que queda de la sesión no cambia.
select pruebas.comprobar(
  'las dos superan 0,6',
  extensions.word_similarity('masdevalia', 'masdevallia veitchiana') >= 0.6
    and extensions.word_similarity('masdevalia', 'andinia masdevalliopsis') >= 0.6
);
select pruebas.iguales(
  'masdevalia',
  pg_temp.nombres('masdevalia', 2),
  'Andinia masdevalliopsis, Masdevallia veitchiana'
);
-- La función cambia el umbral entre las pasadas; al salir, la sesión conserva el suyo.
set local pg_trgm.word_similarity_threshold = 0.45;
select pruebas.iguales('con umbral 0,45 en la sesión', pg_temp.nombres('masdevalia', 2), 'Andinia masdevalliopsis, Masdevallia veitchiana');
select pruebas.iguales('umbral de la sesión intacto', current_setting('pg_trgm.word_similarity_threshold'), '0.45');
set local pg_trgm.word_similarity_threshold = 0.9;
select pruebas.iguales('con otro umbral en la sesión, lo mismo', pg_temp.nombres('masdevalia', 2), 'Andinia masdevalliopsis, Masdevallia veitchiana');
select pruebas.iguales('y se restaura', current_setting('pg_trgm.word_similarity_threshold'), '0.9');

-- prueba: especies: el corte temprano no recorre lo que no hace falta
-- "dendrob" llena el tope con la clase 1 (el índice btree de prefijo), así que no se buscan
-- sinónimos ni similitud: los índices de trigramas no se recorren. "doritis pulcherima" (con
-- error) no empieza como ningún nombre y llega a la similitud, que sí los recorre.
create temp table recorridos_antes as
  select c.relname::text as indice, pg_stat_get_xact_numscans(c.oid) as recorridos
  from pg_class c
  where c.relname in ('species_scientific_name_prefix_idx', 'species_names_name_trgm_idx', 'species_scientific_name_trgm_idx');
grant select on recorridos_antes to anon;
set local enable_seqscan = off;
set local role anon;
select pruebas.iguales('dendrob como anon', pg_temp.nombres('dendrob', 3), 'Dendrobium aberrans, Dendrobium acerosum, Dendrobium aciculare');
set local role postgres;
select pruebas.iguales(
  'índices recorridos por dendrob',
  (select string_agg(a.indice || ':' || (pg_stat_get_xact_numscans(c.oid) > a.recorridos), ', ' order by a.indice)
     from recorridos_antes a join pg_class c on c.relname = a.indice),
  'species_names_name_trgm_idx:false, species_scientific_name_prefix_idx:true, species_scientific_name_trgm_idx:false'
);
create temp table recorridos_despues as
  select c.relname::text as indice, pg_stat_get_xact_numscans(c.oid) as recorridos
  from pg_class c
  where c.relname in ('species_scientific_name_prefix_idx', 'species_names_name_trgm_idx', 'species_scientific_name_trgm_idx');
grant select on recorridos_despues to anon;
set local role anon;
select pruebas.iguales(
  'doritis pulcherima como anon',
  pg_temp.especies('doritis pulcherima', 1),
  'Phalaenopsis pulcherrima [Doritis pulcherrima:synonym]'
);
set local role postgres;
select pruebas.iguales(
  'índices de trigramas recorridos por doritis pulcherima',
  (select string_agg(a.indice || ':' || (pg_stat_get_xact_numscans(c.oid) > a.recorridos), ', ' order by a.indice)
     from recorridos_despues a join pg_class c on c.relname = a.indice
     where a.indice like '%trgm%'),
  'species_names_name_trgm_idx:true, species_scientific_name_trgm_idx:true'
);

-- prueba: el índice de prefijo y su uso con el plan genérico
select pruebas.iguales(
  'definición del índice',
  pg_get_indexdef('public.species_scientific_name_prefix_idx'::regclass),
  'CREATE INDEX species_scientific_name_prefix_idx ON public.species USING btree (normalize_search_text(scientific_name) COLLATE "C")'
);
-- La consulta de un paso de la clase 1, con los valores como parámetros (como en la función,
-- que fuerza el plan genérico) usa el índice por su rango. Con tan pocas filas el planificador
-- puede preferir un bitmap y ordenar después; con el catálogo real lee el índice en orden y
-- para en el tope (lo muestra npm run db:perf -- --planes; ver supabase/README.md).
set local enable_seqscan = off;
set local plan_cache_mode = force_generic_plan;
prepare prefijo_una_palabra (text, text, boolean, uuid[], integer) as
  select s.id from public.species s
  where public.normalize_search_text(s.scientific_name) collate "C" >= $1
    and public.normalize_search_text(s.scientific_name) collate "C" < $2
    and (s.type = 'hybrid') = $3
    and s.id <> all ($4)
  order by public.normalize_search_text(s.scientific_name) collate "C", s.id
  limit $5;
create temp table planes (plan text);
do $$
declare
  linea text;
begin
  for linea in execute 'explain (costs off) execute prefijo_una_palabra(''dendrob'', ''dendrob'' || chr(1114111), false, ''{}'', 10)' loop
    insert into planes values (linea);
  end loop;
end;
$$;
select pruebas.comprobar(
  'recorre species_scientific_name_prefix_idx',
  exists (select from planes where plan like '%Index Scan%on species\_scientific\_name\_prefix\_idx%'
                                  or plan like '%Index Scan using species\_scientific\_name\_prefix\_idx%')
);

-- prueba: géneros: la abreviatura, el prefijo y la similitud, en ese orden
-- "ang" es la abreviatura de Anguloa y el comienzo de Angraecum, que va antes en el alfabeto.
select pruebas.iguales('ang', pg_temp.generos('ang', 2), 'Anguloa (Ang.), Angraecum');

-- prueba: géneros: a igualdad, primero los de acceso rápido y después los que no son nothogéneros
-- "catl" no es prefijo de ninguno: todos coinciden por similitud y Cattleya, Catasetum,
-- × Cattleychea, × Catyclia y × Cattlianthe se parecen lo mismo.
select pruebas.comprobar(
  'misma similitud',
  extensions.word_similarity('catl', 'cattleya') = extensions.word_similarity('catl', 'catasetum')
    and extensions.word_similarity('catl', 'cattleya') = extensions.word_similarity('catl', 'cattleychea')
);
select pruebas.iguales(
  'catl',
  pg_temp.generos('catl', 3),
  'Cattleya*, Catasetum, × Cattleychea'
);
-- Por prefijo, igual: Cattleya (acceso rápido), después × Cattleychea y × Cattlianthe, por su
-- nombre sin el signo; los demás, por similitud, detrás.
select pruebas.iguales('cattl', pg_temp.generos('cattl', 3), 'Cattleya*, × Cattleychea, × Cattlianthe');
-- "ph": Phalaenopsis (acceso rápido) antes que Phragmipedium.
select pruebas.iguales('ph', pg_temp.generos('ph'), 'Phalaenopsis*, Phragmipedium');
-- El signo no cuenta para el orden alfabético: × Catyclia va detrás de × Cattleychea.
select pruebas.iguales(
  'nothogéneros por su nombre sin el signo',
  (select string_agg(g.name, ', ') from public.search_genera('cat', 20) g where g.name like '×%'),
  '× Cattleychea, × Cattlianthe, × Catyclia'
);

-- prueba: géneros: el plan sigue usando los índices
create temp table recorridos_generos as
  select c.relname::text as indice, pg_stat_get_xact_numscans(c.oid) as recorridos
  from pg_class c
  where c.relname in ('genera_name_trgm_idx', 'genus_abbreviations_search_key');
grant select on recorridos_generos to anon;
set local enable_seqscan = off;
set local role anon;
select pruebas.iguales('ang como anon', pg_temp.generos('ang', 1), 'Anguloa (Ang.)');
set local role postgres;
select pruebas.iguales(
  'índices recorridos por search_genera',
  (select string_agg(a.indice || ':' || (pg_stat_get_xact_numscans(c.oid) > a.recorridos), ', ' order by a.indice)
     from recorridos_generos a join pg_class c on c.relname = a.indice),
  'genera_name_trgm_idx:true, genus_abbreviations_search_key:true'
);
