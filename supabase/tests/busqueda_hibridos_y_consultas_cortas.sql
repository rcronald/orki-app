-- Ajustes de la búsqueda (parte de #7): el signo de híbrido "×" no cuenta al buscar, y las
-- consultas de menos de 3 caracteres buscan solo por prefijo, en public.search_species() y
-- public.search_genera().
--
-- Las pruebas crean sus propias especies (no usan las de supabase/datos-ejemplo); los géneros y
-- abreviaturas cargados por las migraciones sí se usan. Los nombres inventados para provocar un
-- caso concreto se señalan con "ficticio".

-- Datos de partida: un nothogénero guardado con el signo (× Rhyncholaeliocattleya, que la
-- migración de abreviaturas carga sin él y con la abreviatura Rlc.), otro sin el signo
-- (Brassocattleya, Bc.), dos híbridos naturales con el signo de las dos formas (× y una x) y
-- especies para las consultas cortas.
update public.genera set name = '× Rhyncholaeliocattleya' where name = 'Rhyncholaeliocattleya';

insert into public.species (scientific_name, genus_id, type, status, source)
values
  ('× Rhyncholaeliocattleya Memoria Helen Brown', pruebas.genero('× Rhyncholaeliocattleya'), 'hybrid', 'imported', 'curated'),
  ('Brassocattleya Binosa', pruebas.genero('Brassocattleya'), 'hybrid', 'imported', 'curated'),
  ('Phalaenopsis × intermedia', pruebas.genero('Phalaenopsis'), 'hybrid', 'imported', 'curated'),
  ('Phalaenopsis x leucorrhoda', pruebas.genero('Phalaenopsis'), 'hybrid', 'imported', 'curated'),
  ('Phalaenopsis amabilis', pruebas.genero('Phalaenopsis'), 'species', 'validated', 'curated'),
  ('Phalaenopsis pulcherrima', pruebas.genero('Phalaenopsis'), 'species', 'validated', 'curated'),
  ('Maxillaria xanthina', pruebas.genero('Maxillaria'), 'species', 'validated', 'curated'),
  -- ficticio: una palabra que empieza por "ph" sin que el nombre empiece por ella.
  ('Cattleya phoenicea', pruebas.genero('Cattleya'), 'species', 'validated', 'curated');

insert into public.species_names (species_id, name, type, language)
values
  (pruebas.especie('Phalaenopsis amabilis'), 'orquídea mariposa', 'common', 'es'),
  (pruebas.especie('Phalaenopsis pulcherrima'), 'Doritis pulcherrima', 'synonym', null);

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

-- Si una especie sale en los 20 primeros resultados de search_species.
create function pg_temp.sale(consulta text, especie text)
returns boolean
language sql
as $$
  select exists (select from public.search_species(consulta, 20) s where s.scientific_name = especie)
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

-- Desde el #283, las funciones que crea postgres no nacen ejecutables por PUBLIC: las de
-- ayuda de este archivo se abren a mano para poder llamarlas con otros roles.
grant execute on all functions in schema pg_temp to public;

-- prueba: normalización: el signo × se quita, pegado o separado
select pruebas.iguales('× separado', public.normalize_search_text('× Rhyncholaeliocattleya'), 'rhyncholaeliocattleya');
select pruebas.iguales('× pegado', public.normalize_search_text('×Rhyncholaeliocattleya'), 'rhyncholaeliocattleya');
select pruebas.iguales('× en medio', public.normalize_search_text('Phalaenopsis × intermedia'), 'phalaenopsis intermedia');
select pruebas.iguales('× pegado al epíteto', public.normalize_search_text('Phalaenopsis ×intermedia'), 'phalaenopsis intermedia');
select pruebas.iguales('× pegado a las dos palabras', public.normalize_search_text('Phalaenopsis×intermedia'), 'phalaenopsis intermedia');
select pruebas.iguales('× escrito con su código', public.normalize_search_text(U&'\00D7 Brassocattleya'), 'brassocattleya');
select pruebas.iguales('solo el signo', public.normalize_search_text(' × '), '');

-- prueba: normalización: la x suelta seguida de otra palabra se quita
select pruebas.iguales('x en medio', public.normalize_search_text('Phalaenopsis x intermedia'), 'phalaenopsis intermedia');
select pruebas.iguales('X mayúscula', public.normalize_search_text('PHALAENOPSIS X INTERMEDIA'), 'phalaenopsis intermedia');
select pruebas.iguales('x al principio', public.normalize_search_text('x Rhyncholaeliocattleya'), 'rhyncholaeliocattleya');
select pruebas.iguales('con abreviatura', public.normalize_search_text('Phal. x intermedia'), 'phal. intermedia');
select pruebas.iguales('con tabuladores', public.normalize_search_text(e'phal\tx\t\tinterm'), 'phal interm');
select pruebas.iguales('varias seguidas', public.normalize_search_text('x x a'), 'a');
select pruebas.iguales('x y ×', public.normalize_search_text('phal x × interm'), 'phal interm');

-- prueba: normalización: la x dentro de una palabra o al final no se toca
select pruebas.iguales('dentro de palabras', public.normalize_search_text('Maxillaria xanthina'), 'maxillaria xanthina');
select pruebas.iguales('al final', public.normalize_search_text('phal x'), 'phal x');
select pruebas.iguales('al final con espacios detrás', public.normalize_search_text('phal x  '), 'phal x');
select pruebas.iguales('solo x', public.normalize_search_text('x'), 'x');
select pruebas.iguales('solo el signo y x', public.normalize_search_text('× x'), 'x');
select pruebas.iguales('solo X entre espacios', public.normalize_search_text('  X  '), 'x');
select pruebas.iguales('xx', public.normalize_search_text('xx a'), 'xx a');
select pruebas.iguales('x con guion', public.normalize_search_text('x-ray orchid'), 'x-ray orchid');
select pruebas.iguales('x con punto', public.normalize_search_text('x. intermedia'), 'x. intermedia');

-- prueba: especies: un híbrido natural se encuentra con ×, con x o sin el signo
select pruebas.iguales('phalaenopsis intermedia', pg_temp.primera('phalaenopsis intermedia'), 'Phalaenopsis × intermedia');
select pruebas.iguales('phalaenopsis x intermedia', pg_temp.primera('phalaenopsis x intermedia'), 'Phalaenopsis × intermedia');
select pruebas.iguales('phalaenopsis × intermedia', pg_temp.primera('phalaenopsis × intermedia'), 'Phalaenopsis × intermedia');
select pruebas.iguales('phalaenopsis ×intermedia', pg_temp.primera('phalaenopsis ×intermedia'), 'Phalaenopsis × intermedia');
select pruebas.iguales('phal x intermedia, con abreviatura', pg_temp.primera('phal x intermedia'), 'Phalaenopsis × intermedia');
select pruebas.iguales('Phal. × interm, con abreviatura', pg_temp.primera('Phal. × interm'), 'Phalaenopsis × intermedia');
select pruebas.iguales('phal interm, a medias', pg_temp.primera('phal interm'), 'Phalaenopsis × intermedia');
-- Guardado con una x en lugar del signo, se encuentra igual.
select pruebas.iguales('phalaenopsis leucorrhoda', pg_temp.primera('phalaenopsis leucorrhoda'), 'Phalaenopsis x leucorrhoda');
select pruebas.iguales('phalaenopsis × leucorrhoda', pg_temp.primera('phalaenopsis × leucorrhoda'), 'Phalaenopsis x leucorrhoda');
select pruebas.iguales(
  'el nombre por el que coincidió conserva el signo',
  pg_temp.especies('phal x intermedia', 1),
  'Phalaenopsis × intermedia [Phalaenopsis × intermedia:scientific]'
);
-- La x al final no se quita, pero el prefijo del género sigue encontrando el híbrido.
select pruebas.comprobar('phalaenopsis x', pg_temp.sale('phalaenopsis x', 'Phalaenopsis × intermedia'));
-- La x dentro de una palabra sí cuenta.
select pruebas.iguales('maxillaria xan', pg_temp.primera('maxillaria xan'), 'Maxillaria xanthina');
select pruebas.iguales('max xan, con abreviatura', pg_temp.primera('max xan'), 'Maxillaria xanthina');

-- prueba: especies y géneros: un género con × delante se encuentra igual que uno sin él
-- Se comprueban las mismas búsquedas con Brassocattleya sin el signo y, después de
-- añadírselo, con él: los resultados no cambian (salvo el nombre devuelto, que lo lleva).
create function pg_temp.casos()
returns text[]
language sql
as $$
  select array[
    pg_temp.primera('brassocattleya binosa'),
    pg_temp.primera('x brassocattleya bin'),
    pg_temp.primera('× brassocattleya bin'),
    pg_temp.primera('Bc. bin'),
    pg_temp.generos('brassocattleya', 1),
    pg_temp.generos('brasocattleya', 1),
    pg_temp.generos('×brassocat', 1),
    pg_temp.generos('bc.', 1)
  ]
$$;
create temp table sin_signo as select pg_temp.casos() as resultados;
select pruebas.iguales(
  'sin el signo',
  (select s.resultados from sin_signo s),
  array['Brassocattleya Binosa', 'Brassocattleya Binosa', 'Brassocattleya Binosa', 'Brassocattleya Binosa',
        'Brassocattleya', 'Brassocattleya', 'Brassocattleya', 'Brassocattleya (Bc.)']
);
update public.genera set name = '× Brassocattleya' where name = 'Brassocattleya';
update public.species set scientific_name = '× Brassocattleya Binosa' where scientific_name = 'Brassocattleya Binosa';
select pruebas.iguales(
  'con el signo, lo mismo',
  pg_temp.casos(),
  (select array_agg(replace(r, 'Brassocattleya', '× Brassocattleya') order by n)
     from sin_signo s, unnest(s.resultados) with ordinality as u (r, n))
);

-- prueba: especies: la abreviatura se expande cuando el género lleva el signo
select pruebas.iguales('Rlc. Memoria', pg_temp.primera('Rlc. Memoria'), '× Rhyncholaeliocattleya Memoria Helen Brown');
select pruebas.iguales('rlc mem hel', pg_temp.primera('rlc mem hel'), '× Rhyncholaeliocattleya Memoria Helen Brown');
select pruebas.iguales('rlc, solo la abreviatura', pg_temp.primera('rlc'), '× Rhyncholaeliocattleya Memoria Helen Brown');
select pruebas.iguales('x rlc memoria', pg_temp.primera('x rlc memoria'), '× Rhyncholaeliocattleya Memoria Helen Brown');
select pruebas.iguales(
  'rhyncholaeliocattleya memoria',
  pg_temp.especies('rhyncholaeliocattleya memoria', 1),
  '× Rhyncholaeliocattleya Memoria Helen Brown [× Rhyncholaeliocattleya Memoria Helen Brown:scientific]'
);
select pruebas.iguales(
  'con un error de tipeo',
  pg_temp.primera('rhyncolaeliocattleya memoria helen'),
  '× Rhyncholaeliocattleya Memoria Helen Brown'
);
select pruebas.iguales(
  'la fila trae el género con el signo',
  (select s.genus_name || ' / ' || (s.genus_id = pruebas.genero('× Rhyncholaeliocattleya'))
     from public.search_species('Rlc. Memoria', 1) s),
  '× Rhyncholaeliocattleya / true'
);

-- prueba: géneros: un nothogénero con el signo se encuentra por nombre y por abreviatura
select pruebas.iguales('rhyncholaeliocattleya', pg_temp.generos('rhyncholaeliocattleya', 1), '× Rhyncholaeliocattleya');
select pruebas.iguales('×Rhyncholaeliocattleya', pg_temp.generos('×Rhyncholaeliocattleya', 1), '× Rhyncholaeliocattleya');
-- "x rhyncholaelio" y no "x rhyncho": desde la migración 20261120230000 los nothogéneros van
-- detrás de los géneros a igual clase de coincidencia, y "rhyncho" es también prefijo de
-- Rhynchostylis, que ahora sale antes.
select pruebas.iguales('x rhyncholaelio', pg_temp.generos('x rhyncholaelio', 1), '× Rhyncholaeliocattleya');
select pruebas.iguales('Rlc.', pg_temp.generos('Rlc.', 1), '× Rhyncholaeliocattleya (Rlc.)');
select pruebas.iguales('× rlc', pg_temp.generos('× rlc', 1), '× Rhyncholaeliocattleya (Rlc.)');
-- "laelio" es prefijo de Laeliocattleya; × Rhyncholaeliocattleya sale después, por similitud.
select pruebas.iguales('laelio', pg_temp.generos('laelio', 1), 'Laeliocattleya');
select pruebas.comprobar(
  'laelio: × Rhyncholaeliocattleya sale después',
  (select bool_or(g.name = '× Rhyncholaeliocattleya') from public.search_genera('laelio', 20) g)
);

-- prueba: consultas que se quedan cortas al quitar el signo
select pruebas.iguales('x a, queda en una letra', (select count(*) from public.search_species('x a')), 0::bigint);
select pruebas.iguales('× a, queda en una letra', (select count(*) from public.search_species('× a')), 0::bigint);
select pruebas.iguales('× solo', (select count(*) from public.search_species('×')), 0::bigint);
select pruebas.iguales('× solo en géneros', (select count(*) from public.search_genera('× ')), 0::bigint);
select pruebas.iguales('x ph igual que ph', pg_temp.especies('x ph'), pg_temp.especies('ph'));
-- "x" es una sola letra: no busca.
select pruebas.iguales('x', (select count(*) from public.search_species('x')), 0::bigint);

-- prueba: especies: con 2 caracteres solo cuenta el prefijo
-- "ph": las especies cuyo nombre (científico, sinónimo o común) empieza por "ph"; no Cattleya
-- phoenicea, que solo tiene una palabra que empieza así y antes entraba por similitud.
select pruebas.comprobar('ph encuentra Phalaenopsis amabilis', pg_temp.sale('ph', 'Phalaenopsis amabilis'));
select pruebas.comprobar('ph no encuentra Cattleya phoenicea', not pg_temp.sale('ph', 'Cattleya phoenicea'));
select pruebas.iguales(
  'ph: resultados que no empiezan por ph',
  (select count(*) from public.search_species('ph', 20) s
     where public.normalize_search_text(s.matched_name) not like 'ph%'),
  0::bigint
);
-- Prefijo de un nombre común y de un sinónimo.
select pruebas.iguales('or, prefijo de un nombre común', pg_temp.especies('or'), 'Phalaenopsis amabilis [orquídea mariposa:common]');
select pruebas.iguales('do, prefijo de un sinónimo', pg_temp.especies('do'), 'Phalaenopsis pulcherrima [Doritis pulcherrima:synonym]');
-- "ma" es prefijo de Maxillaria xanthina, pero no de "orquídea mariposa" ni de
-- "Phalaenopsis amabilis": Phalaenopsis amabilis no sale.
select pruebas.iguales('ma, solo el prefijo', pg_temp.especies('ma'), 'Maxillaria xanthina [Maxillaria xanthina:scientific]');
-- Sin prefijo y sin similitud, nada.
select pruebas.iguales('hp, sin prefijo', pg_temp.especies('hp'), 'ninguno');

-- prueba: especies: con 3 caracteres la similitud vuelve a contar
select pruebas.comprobar('pho encuentra Cattleya phoenicea', pg_temp.sale('pho', 'Cattleya phoenicea'));
select pruebas.comprobar('mar encuentra Phalaenopsis amabilis por mariposa', pg_temp.sale('mar', 'Phalaenopsis amabilis'));
-- "phl" no es prefijo de nada: solo la similitud encuentra las Phalaenopsis.
select pruebas.comprobar('phl, por similitud', pg_temp.sale('phl', 'Phalaenopsis amabilis'));
-- Una abreviatura de 2 caracteres ("c.") se expande, y la forma expandida sí usa la similitud.
select pruebas.comprobar('c. encuentra Cattleya phoenicea', pg_temp.sale('c.', 'Cattleya phoenicea'));

-- prueba: géneros: con 2 caracteres solo cuentan el prefijo y la abreviatura
-- Antes "ph" encontraba también por similitud cualquier género que empieza por "p"
-- (Paphiopedilum, Pleione...).
select pruebas.iguales('ph', pg_temp.generos('ph'), 'Phalaenopsis, Phragmipedium');
select pruebas.iguales('c., por abreviatura', pg_temp.generos('c.', 1), 'Cattleya (C.)');
select pruebas.iguales('hp, sin prefijo', pg_temp.generos('hp'), 'ninguno');
-- Con 3 caracteres la similitud vuelve a contar.
select pruebas.comprobar(
  'phl encuentra Phalaenopsis por similitud',
  (select bool_or(g.name = 'Phalaenopsis') from public.search_genera('phl', 20) g)
);

-- prueba: el plan de una consulta de 2 caracteres solo recorre el índice para el prefijo
-- Con la condición de similitud nula, Postgres la descarta al planificar y solo queda el LIKE.
-- Se comprueba sobre species_names: desde la migración 20261120230000, el prefijo del nombre
-- científico de una sola palabra usa el índice btree species_scientific_name_prefix_idx, que el
-- planificador elige también para este LIKE, y la similitud ya no comparte sentencia con los
-- prefijos.
set local enable_seqscan = off;
prepare candidatos_cortos (text, text) as
  select n.species_id from public.species_names n
  where public.normalize_search_text(n.name) operator(extensions.%>) $1
     or public.normalize_search_text(n.name) like $2;
create temp table planes (plan text);
do $$
declare
  linea text;
begin
  for linea in execute 'explain (costs off) execute candidatos_cortos(null, ''ph%'')' loop
    insert into planes values (linea);
  end loop;
end;
$$;
select pruebas.comprobar(
  'recorre el índice de trigramas',
  exists (select from planes where plan like '%Bitmap Index Scan on species\_names\_name\_trgm\_idx%')
);
select pruebas.comprobar(
  'sin la condición de similitud',
  not exists (select from planes where plan like '%\%>%')
);

-- prueba: la migración reconstruye los índices calculados con la normalización anterior
-- Se reproduce una base con la normalización anterior (sin quitar el signo) y nombres con "×"
-- ya indexados, se aplica la migración y se busca obligando a usar los índices.
create or replace function public.normalize_search_text(value text)
returns text
language sql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $$
  select pg_catalog.btrim(
    pg_catalog.regexp_replace(
      pg_catalog.lower(extensions.unaccent('extensions.unaccent'::regdictionary, value)),
      '\s+', ' ', 'g'
    )
  )
$$;
reindex index public.species_scientific_name_trgm_idx;
reindex index public.species_names_name_trgm_idx;
reindex index public.genera_name_trgm_idx;
reindex index public.genus_abbreviations_search_key;
insert into public.genera (name) values ('× Ficticiocattleya');
insert into public.species (scientific_name, genus_id, type, status, source)
values ('× Ficticiocattleya Prueba Antigua', pruebas.genero('× Ficticiocattleya'), 'hybrid', 'imported', 'curated');
insert into public.species_names (species_id, name, type)
values (pruebas.especie('× Ficticiocattleya Prueba Antigua'), 'Ficticia × antigua', 'synonym');
select pruebas.iguales('antes, con la normalización anterior', public.normalize_search_text('× Ficticiocattleya'), '* ficticiocattleya');
\i supabase/migrations/20261120210000_ajustes_de_busqueda.sql
-- El índice species_scientific_name_prefix_idx lo crea una migración posterior
-- (20261120230000), que en una base real se aplica después y lo calcula ya con la
-- normalización nueva. Aquí existía antes y quedó calculado con la anterior, así que se
-- reconstruye también.
reindex index public.species_scientific_name_prefix_idx;
set local enable_seqscan = off;
select pruebas.iguales('especie por prefijo', pg_temp.primera('ficticiocattleya prueba'), '× Ficticiocattleya Prueba Antigua');
select pruebas.iguales('especie por similitud', pg_temp.primera('ficticiocatleya prueva antigua'), '× Ficticiocattleya Prueba Antigua');
select pruebas.iguales(
  'sinónimo',
  pg_temp.especies('ficticia x antigua', 1),
  '× Ficticiocattleya Prueba Antigua [Ficticia × antigua:synonym]'
);
select pruebas.iguales('género', pg_temp.generos('ficticiocattleya', 1), '× Ficticiocattleya');
-- Con los índices reconstruidos, buscar por índice o recorriendo la tabla da lo mismo.
select pruebas.iguales(
  'el índice de species encuentra la especie',
  (select count(*) from public.species s
     where public.normalize_search_text(s.scientific_name) like 'ficticiocattleya%'),
  1::bigint
);
