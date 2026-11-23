-- Catálogo público (#231, parte de #187): search_public_species(), list_public_genera(),
-- list_public_genus_species() y get_public_species(), el índice species_public_genus_name_idx
-- y que anon no lee nada más que estas funciones.
--
-- Una especie es pública si source <> 'user_proposal' or status = 'validated' (ver la migración
-- 20261122150000_catalogo_publico.sql). Los datos cubren cada combinación que importa: COL
-- importada y observada, GBIF, lista curada (híbrido validado), propuesta validada y propuestas
-- observada e importada (estas dos, no públicas).

-- Datos de partida -------------------------------------------------------------------------

insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
values
  ('Cattleya labiata', pruebas.genero('Cattleya'), 'species', 'imported', 'col', 'COL1'),
  ('Cattleya trianae', pruebas.genero('Cattleya'), 'species', 'observed', 'col', 'COL2'),
  ('Cattleya aclandiae', pruebas.genero('Cattleya'), 'species', 'imported', 'gbif', 'G1'),
  ('Cattleya × hardyana', pruebas.genero('Cattleya'), 'hybrid', 'validated', 'curated', 'H1'),
  ('Cattleya walkeriana', pruebas.genero('Cattleya'), 'species', 'validated', 'user_proposal', null),
  -- No públicas: propuestas de usuarios que no están validadas.
  ('Cattleya secreta', pruebas.genero('Cattleya'), 'species', 'observed', 'user_proposal', null),
  ('Cattleya oculta', pruebas.genero('Cattleya'), 'species', 'imported', 'user_proposal', null),
  ('Oncidium propuesto', pruebas.genero('Oncidium'), 'species', 'observed', 'user_proposal', null),
  ('Phalaenopsis amabilis', pruebas.genero('Phalaenopsis'), 'species', 'imported', 'col', 'COL3'),
  ('Phalaenopsis aphrodite', pruebas.genero('Phalaenopsis'), 'species', 'imported', 'col', 'COL4');

-- Un género grande: 120 especies públicas de Dendrobium y 3 no públicas entre ellas.
insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
select 'Dendrobium sp' || lpad(i::text, 3, '0'), pruebas.genero('Dendrobium'), 'species', 'imported', 'col', 'D' || i
from generate_series(1, 120) i;
insert into public.species (scientific_name, genus_id, type, status, source)
select 'Dendrobium sp' || lpad(i::text, 3, '0') || 'b', pruebas.genero('Dendrobium'), 'species', 'observed', 'user_proposal'
from unnest(array[1, 50, 120]) i;

insert into public.species_names (species_id, name, type, language)
values
  (pruebas.especie('Cattleya labiata'), 'Epidendrum labiatum', 'synonym', null),
  (pruebas.especie('Cattleya labiata'), 'Cattleya labiata var. autumnalis', 'synonym', null),
  (pruebas.especie('Cattleya labiata'), 'Ángel labiata', 'synonym', null),
  (pruebas.especie('Cattleya labiata'), 'flor de mayo', 'common', 'es'),
  (pruebas.especie('Cattleya labiata'), 'Queen of orchids', 'common', 'en'),
  (pruebas.especie('Cattleya labiata'), 'Labiata sin idioma', 'common', null),
  (pruebas.especie('Cattleya secreta'), 'Laelia secretissima', 'synonym', null),
  (pruebas.especie('Cattleya secreta'), 'orquídea escondida', 'common', 'es');

-- Lo que tiene cada persona: un perfil y plantas de user_a, con un nombre propuesto.
insert into public.profiles (id) values ('user_a');
insert into public.plants (user_id, entered_name, species_id)
values ('user_a', 'Mi labiata', pruebas.especie('Cattleya labiata'));
insert into public.plants (user_id, entered_name, genus_id, type)
values ('user_a', 'Cattleya privadissima', pruebas.genero('Cattleya'), 'unknown');

-- Nombres de una búsqueda pública, en orden, separados por comas.
create function pg_temp.buscar(consulta text, maximo integer default 15)
returns text
language sql
as $$
  select coalesce(string_agg(r.scientific_name, ', ' order by r.n), 'ninguno')
  from (
    select s.scientific_name, row_number() over () as n
    from public.search_public_species(consulta, maximo) s
  ) r
$$;

-- Una página de géneros: "nombre:especies" separados por comas, y el total y la página.
create function pg_temp.generos(tamano integer default 100, pagina integer default 1)
returns text
language sql
as $$
  select coalesce(
    string_agg(g.name || ':' || g.species_count, ', ' order by g.n)
      || ' (total ' || min(g.total_count) || ', página ' || min(g.current_page) || ')',
    'ninguno')
  from (
    select l.*, row_number() over () as n
    from public.list_public_genera(tamano, pagina) l
  ) g
$$;

-- Una página de especies de un género: nombres, total y página.
create function pg_temp.especies(genero text, tamano integer default 50, pagina integer default 1)
returns text
language sql
as $$
  select coalesce(
    string_agg(e.scientific_name, ', ' order by e.n)
      || ' (total ' || min(e.total_count) || ', página ' || min(e.current_page) || ')',
    'ninguno')
  from (
    select l.*, row_number() over () as n
    from public.list_public_genus_species(pruebas.genero(genero), tamano, pagina) l
  ) e
$$;

-- prueba: permisos: solo anon y authenticated ejecutan las cuatro funciones; ni service_role ni PUBLIC
select pruebas.iguales(
  'permiso de ejecución por rol',
  (select string_agg(f.nombre || ':' || r.rol || '=' || has_function_privilege(r.rol, f.funcion, 'execute'), ', '
                     order by f.nombre, r.rol)
     from (values
       ('search_public_species', 'public.search_public_species(text, integer)'::regprocedure),
       ('list_public_genera', 'public.list_public_genera(integer, integer)'::regprocedure),
       ('list_public_genus_species', 'public.list_public_genus_species(uuid, integer, integer)'::regprocedure),
       ('get_public_species', 'public.get_public_species(uuid)'::regprocedure)
     ) f (nombre, funcion)
     cross join (values ('anon'), ('authenticated'), ('service_role')) r (rol)),
  'get_public_species:anon=true, get_public_species:authenticated=true, get_public_species:service_role=false, '
    || 'list_public_genera:anon=true, list_public_genera:authenticated=true, list_public_genera:service_role=false, '
    || 'list_public_genus_species:anon=true, list_public_genus_species:authenticated=true, list_public_genus_species:service_role=false, '
    || 'search_public_species:anon=true, search_public_species:authenticated=true, search_public_species:service_role=false'
);
select pruebas.iguales(
  'PUBLIC en los permisos de las funciones',
  (select count(*)
     from pg_proc p
     cross join lateral aclexplode(p.proacl) a
     where p.proname in ('search_public_species', 'list_public_genera', 'list_public_genus_species', 'get_public_species')
       and p.pronamespace = 'public'::regnamespace
       and a.grantee = 0),
  0::bigint
);

-- prueba: propiedades: sql con cuerpo estándar, stable, security definer, search_path vacío, dueño postgres y el patrón de lectura pública
select pruebas.iguales(
  'propiedades',
  (select string_agg(distinct p.provolatile::text || ' definer=' || p.prosecdef || ' ' || array_to_string(p.proconfig, ',')
                     || ' ' || pg_get_userbyid(p.proowner) || ' ' || l.lanname || ' cuerpo=' || (p.prosqlbody is not null)
                     || ' incumple=' || coalesce(pruebas.incumple_lectura_publica(p.oid), 'nada'), '; ')
     from pg_proc p join pg_language l on l.oid = p.prolang
     where p.proname in ('search_public_species', 'list_public_genera', 'list_public_genus_species', 'get_public_species')
       and p.pronamespace = 'public'::regnamespace),
  's definer=true search_path="" postgres sql cuerpo=true incumple=nada'
);

-- prueba: anon no puede leer ninguna tabla de public (plantas, fotos, perfiles, eventos, auditoría, catálogo...)
select pruebas.iguales(
  'tablas de public que anon puede leer',
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), 'ninguna')
     from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p', 'v', 'm', 'f')
       and has_table_privilege('anon', c.oid, 'select')),
  'ninguna'
);
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
do $$
declare
  tabla text;
begin
  foreach tabla in array array[
    'plants', 'plant_photos', 'profiles', 'product_events', 'catalog_audit_log', 'species_merge_keys',
    'genera', 'genus_abbreviations', 'species', 'species_names', 'species_photos', 'species_photo_rejections'
  ] loop
    perform pruebas.debe_fallar('anon lee ' || tabla, format('select * from public.%I', tabla), '42501');
  end loop;
end;
$$;

-- prueba: anon solo ejecuta las funciones públicas de la API, no las de administración ni las de la cola de propuestas
select pruebas.iguales(
  'funciones de public que anon puede ejecutar',
  (select string_agg(p.proname, ', ' order by p.proname)
     from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and has_function_privilege('anon', p.oid, 'execute')),
  'get_public_species, is_catalog_admin, list_public_genera, list_public_genus_species, '
    || 'normalize_search_text, requesting_user_id, search_public_species'
);
set local role anon;
set local request.jwt.claims = '{"role": "anon", "app_role": "catalog_admin"}';
select pruebas.debe_fallar('anon lista la cola de propuestas', $$select * from public.list_proposal_groups()$$, '42501');
select pruebas.debe_fallar('anon cuenta la cola de propuestas', $$select public.count_proposal_groups()$$, '42501');
select pruebas.debe_fallar('anon lista el catálogo del backoffice', $$select * from public.list_catalog_species()$$, '42501');
select pruebas.debe_fallar('anon cuenta las plantas de una especie', $$select public.count_species_plants(gen_random_uuid())$$, '42501');
select pruebas.debe_fallar('anon da de alta una especie',
  $$select public.create_catalog_species('Cattleya nueva', pruebas.genero('Cattleya'), 'species')$$, '42501');
select pruebas.debe_fallar('anon usa search_species', $$select * from public.search_species('cattleya')$$, '42501');
select pruebas.debe_fallar('anon usa search_genera', $$select * from public.search_genera('cattleya')$$, '42501');
select pruebas.debe_fallar('anon registra eventos', $$select public.record_product_events('[]'::jsonb)$$, '42501');

-- prueba: búsqueda: encuentra por nombre científico, sinónimo y nombre común, con tildes, «×» y errores de tipeo
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select pruebas.iguales('prefijo', pg_temp.buscar('cattleya lab'), 'Cattleya labiata');
select pruebas.iguales('error de tipeo', pg_temp.buscar('catleya labiatta', 1), 'Cattleya labiata');
select pruebas.iguales('híbrido con x', pg_temp.buscar('cattleya x hardy'), 'Cattleya × hardyana');
select pruebas.iguales('híbrido sin el signo', pg_temp.buscar('cattleya hardyana', 1), 'Cattleya × hardyana');
select pruebas.iguales('abreviatura', pg_temp.buscar('C. trian', 1), 'Cattleya trianae');
select pruebas.iguales(
  'sinónimo, con tildes',
  (select s.scientific_name || ' por ' || s.matched_name || ':' || s.matched_name_type
     from public.search_public_species('angel labiata', 1) s),
  'Cattleya labiata por Ángel labiata:synonym'
);
select pruebas.iguales(
  'nombre común, con mayúsculas y tildes de más',
  (select s.scientific_name || ' por ' || s.matched_name || ':' || s.matched_name_type
     from public.search_public_species('FLOR DE MÁYO', 1) s),
  'Cattleya labiata por flor de mayo:common'
);
select pruebas.iguales(
  'datos de la especie',
  (select s.genus_name || ' ' || s.type || ' ' || (s.genus_id = pruebas.genero('Cattleya'))
     from public.search_public_species('cattleya x hardyana', 1) s),
  'Cattleya hybrid true'
);

-- prueba: búsqueda: devuelve las columnas de search_species() sin el estado y con la miniatura de referencia al final
select pruebas.iguales(
  'columnas',
  pg_get_function_result('public.search_public_species(text, integer)'::regprocedure),
  'TABLE(id uuid, scientific_name text, genus_id uuid, genus_name text, type species_type, matched_name text, matched_name_type species_match_type, '
    || 'reference_thumbnail jsonb)'
);

-- prueba: búsqueda: excluye las especies no públicas, también por sus sinónimos y nombres comunes, y no deja huecos
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select pruebas.iguales(
  'todas las Cattleya públicas, en el orden de search_species()',
  pg_temp.buscar('cattleya'),
  'Cattleya aclandiae, Cattleya labiata, Cattleya trianae, Cattleya walkeriana, Cattleya × hardyana'
);
-- search_species() devuelve oculta y secreta entre labiata y trianae: sin el margen, las tres
-- primeras públicas no cabrían.
select pruebas.iguales('las tres primeras', pg_temp.buscar('cattleya', 3), 'Cattleya aclandiae, Cattleya labiata, Cattleya trianae');
select pruebas.iguales('por su nombre científico', pg_temp.buscar('cattleya secreta'), 'ninguno');
select pruebas.iguales('por su sinónimo', pg_temp.buscar('laelia secretissima'), 'ninguno');
select pruebas.iguales('por su nombre común', pg_temp.buscar('orquidea escondida'), 'ninguno');
select pruebas.iguales('propuesta importada', pg_temp.buscar('cattleya oculta'), 'ninguno');
select pruebas.iguales('el género de las no públicas', pg_temp.buscar('oncidium propuesto'), 'ninguno');
select pruebas.iguales('el nombre que escribió un usuario en su planta', pg_temp.buscar('cattleya privadissima'), 'ninguno');
select pruebas.comprobar(
  'ninguna propuesta de Dendrobium, aunque sea la coincidencia exacta',
  pg_temp.buscar('dendrobium sp001b') !~ 'sp[0-9]+b'
    and pg_temp.buscar('dendrobium sp001b') <> 'ninguno'
);
-- Con sesión, lo mismo: la función no mira quién llama.
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.iguales('con sesión', pg_temp.buscar('cattleya secreta'), 'ninguno');
select pruebas.iguales('con sesión, todas', pg_temp.buscar('cattleya'),
  'Cattleya aclandiae, Cattleya labiata, Cattleya trianae, Cattleya walkeriana, Cattleya × hardyana');

-- prueba: búsqueda: da lo mismo que search_species() sin las filas no públicas
select pruebas.iguales(
  'consultas con otras filas u otro orden',
  (select coalesce(string_agg(c.consulta, ', ' order by c.consulta), 'ninguna')
     from (values ('cattleya'), ('dendrobium sp0'), ('phal'), ('catleya labiatta'), ('flor de mayo'), ('C. lab')) c (consulta)
     where (select array_agg(s.id order by s.n) from (
              select r.id, row_number() over () as n from public.search_public_species(c.consulta, 10) r) s)
       is distinct from
           (select array_agg(s.id order by s.n) from (
              select x.id, x.n from (
                select r.id, row_number() over () as n from public.search_species(c.consulta, 20) r) x
              join public.species e on e.id = x.id
              where e.source <> 'user_proposal' or e.status = 'validated'
              order by x.n limit 10) s)),
  'ninguna'
);

-- prueba: búsqueda: topes de resultados y de la consulta
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select pruebas.iguales('por defecto, 10', (select count(*) from public.search_public_species('dendrobium')), 10::bigint);
-- Con 15 caben aunque entre los 20 primeros de search_species() esté Dendrobium sp001b.
select pruebas.iguales('máximo 15', (select count(*) from public.search_public_species('dendrobium', 1000000)), 15::bigint);
select pruebas.iguales('el entero más grande', (select count(*) from public.search_public_species('dendrobium', 2147483647)), 15::bigint);
select pruebas.iguales(
  'los 15 son los primeros públicos de search_species()',
  (select string_agg(s.scientific_name, ',') from public.search_public_species('dendrobium', 15) s),
  (select string_agg('Dendrobium sp' || lpad(i::text, 3, '0'), ',' order by i) from generate_series(1, 15) i)
);
select pruebas.iguales('5', (select count(*) from public.search_public_species('dendrobium', 5)), 5::bigint);
select pruebas.iguales('nulo, 10', (select count(*) from public.search_public_species('dendrobium', null)), 10::bigint);
select pruebas.iguales('cero, 10', (select count(*) from public.search_public_species('dendrobium', 0)), 10::bigint);
select pruebas.iguales('negativo, 10', (select count(*) from public.search_public_species('dendrobium', -2147483648)), 10::bigint);
select pruebas.iguales('consulta nula', pg_temp.buscar(null), 'ninguno');
select pruebas.iguales('consulta de un carácter', pg_temp.buscar('c'), 'ninguno');
select pruebas.iguales('consulta sin letras', pg_temp.buscar('%%%'), 'ninguno');
select pruebas.iguales('consulta de 101 caracteres', pg_temp.buscar('cattleya ' || repeat('a', 92)), 'ninguno');
select pruebas.iguales('consulta de 100 000 caracteres', pg_temp.buscar(repeat('cattleya ', 11112)), 'ninguno');
select pruebas.iguales('comodines escapados', pg_temp.buscar('cattleya l_b%'), 'ninguno');
select pruebas.debe_funcionar('comillas y barras', $$select * from public.search_public_species($q$'); drop table public.species; --\ $q$)$$);

-- prueba: géneros: solo los que tienen especies públicas, con su número, en orden y con el total
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select pruebas.iguales('géneros', pg_temp.generos(), 'Cattleya:5, Dendrobium:120, Phalaenopsis:2 (total 3, página 1)');
select pruebas.iguales(
  'columnas',
  pg_get_function_result('public.list_public_genera(integer, integer)'::regprocedure),
  'TABLE(id uuid, name text, species_count bigint, total_count bigint, current_page integer)'
);
select pruebas.iguales(
  'id de cada género',
  (select bool_and(g.id = pruebas.genero(g.name)) from public.list_public_genera() g),
  true
);
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.iguales('con sesión, lo mismo', pg_temp.generos(), 'Cattleya:5, Dendrobium:120, Phalaenopsis:2 (total 3, página 1)');

-- prueba: géneros: paginación (página fuera de rango, nula o negativa) y orden estable sin tildes ni signo
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select pruebas.iguales('página 2 de 1', pg_temp.generos(1, 2), 'Dendrobium:120 (total 3, página 2)');
select pruebas.iguales('más allá de la última, la última', pg_temp.generos(1, 99), 'Phalaenopsis:2 (total 3, página 3)');
select pruebas.iguales('la página más grande', pg_temp.generos(1, 2147483647), 'Phalaenopsis:2 (total 3, página 3)');
select pruebas.iguales('página nula', pg_temp.generos(2, null), 'Cattleya:5, Dendrobium:120 (total 3, página 1)');
select pruebas.iguales('página cero', pg_temp.generos(2, 0), 'Cattleya:5, Dendrobium:120 (total 3, página 1)');
select pruebas.iguales('página negativa', pg_temp.generos(2, -2147483648), 'Cattleya:5, Dendrobium:120 (total 3, página 1)');
set local role postgres;
insert into public.genera (name) values ('× Ápice'), ('Abeja');
insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
values ('× Ápice uno', pruebas.genero('× Ápice'), 'hybrid', 'imported', 'col', 'A1'),
       ('Abeja una', pruebas.genero('Abeja'), 'species', 'imported', 'col', 'A2');
set local role anon;
select pruebas.iguales(
  'orden por el nombre normalizado',
  pg_temp.generos(3),
  'Abeja:1, × Ápice:1, Cattleya:5 (total 5, página 1)'
);

-- prueba: géneros: tamaño de página por defecto 100 y como mucho 200
set local role postgres;
insert into public.genera (name)
select 'Generoprueba' || lpad(i::text, 3, '0') from generate_series(1, 250) i;
insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
select 'Generoprueba' || lpad(i::text, 3, '0') || ' una', pruebas.genero('Generoprueba' || lpad(i::text, 3, '0')),
       'species', 'imported', 'col', 'GP' || i
from generate_series(1, 250) i;
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select pruebas.iguales('por defecto', (select count(*) from public.list_public_genera()), 100::bigint);
select pruebas.iguales('nulo', (select count(*) from public.list_public_genera(null)), 100::bigint);
select pruebas.iguales('cero', (select count(*) from public.list_public_genera(0)), 100::bigint);
select pruebas.iguales('negativo', (select count(*) from public.list_public_genera(-1)), 100::bigint);
select pruebas.iguales('enorme', (select count(*) from public.list_public_genera(2147483647)), 200::bigint);
select pruebas.iguales(
  'la segunda página de 200 tiene el resto',
  (select count(*) || ' de ' || min(total_count) || ', página ' || min(current_page) from public.list_public_genera(1000, 2)),
  '53 de 253, página 2'
);
select pruebas.iguales(
  'todas las páginas de 7: cada género una vez y en orden',
  (select string_agg(g.name, ',' order by p, g.n)
     from generate_series(1, 37) p
     cross join lateral (select l.name, row_number() over () as n from public.list_public_genera(7, p) l) g),
  (select string_agg(x.name, ',' order by public.normalize_search_text(x.name) collate "C", x.id)
     from public.list_public_genera(200, 1) x)
    || ',' ||
  (select string_agg(x.name, ',' order by public.normalize_search_text(x.name) collate "C", x.id)
     from public.list_public_genera(200, 2) x)
);

-- prueba: especies de un género: paginadas, con el total, sin las no públicas y en orden estable
-- 120 especies en páginas de 7 son 18 páginas (la última, con una).
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select pruebas.iguales(
  'Cattleya',
  pg_temp.especies('Cattleya'),
  'Cattleya aclandiae, Cattleya × hardyana, Cattleya labiata, Cattleya trianae, Cattleya walkeriana (total 5, página 1)'
);
select pruebas.iguales(
  'columnas',
  pg_get_function_result('public.list_public_genus_species(uuid, integer, integer)'::regprocedure),
  'TABLE(id uuid, scientific_name text, type species_type, genus_id uuid, genus_name text, total_count bigint, current_page integer, '
    || 'reference_thumbnail jsonb)'
);
select pruebas.iguales(
  'datos de cada fila',
  (select string_agg(distinct s.genus_name || ' ' || (s.genus_id = pruebas.genero('Cattleya')), ', ')
     from public.list_public_genus_species(pruebas.genero('Cattleya')) s),
  'Cattleya true'
);
select pruebas.iguales(
  'tipo',
  (select string_agg(s.scientific_name || ':' || s.type, ', ' order by s.scientific_name)
     from public.list_public_genus_species(pruebas.genero('Cattleya')) s where s.scientific_name like '%×%'),
  'Cattleya × hardyana:hybrid'
);
select pruebas.iguales('Dendrobium, página 1', (select count(*) || ' de ' || min(total_count)
  from public.list_public_genus_species(pruebas.genero('Dendrobium'))), '50 de 120');
select pruebas.iguales(
  'Dendrobium, página 3',
  (select count(*) || ' desde ' || min(scientific_name) || ', página ' || min(current_page)
     from public.list_public_genus_species(pruebas.genero('Dendrobium'), 50, 3)),
  '20 desde Dendrobium sp101, página 3'
);
select pruebas.iguales(
  'todas las páginas de 7: las 120 públicas, cada una una vez, en orden',
  (select string_agg(e.scientific_name, ',' order by p, e.n)
     from generate_series(1, 18) p
     cross join lateral (
       select l.scientific_name, row_number() over () as n
       from public.list_public_genus_species(pruebas.genero('Dendrobium'), 7, p) l
     ) e
  ),
  (select string_agg('Dendrobium sp' || lpad(i::text, 3, '0'), ',' order by i) from generate_series(1, 120) i)
);

-- prueba: especies de un género: topes y parámetros fuera de rango
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select pruebas.iguales('tamaño enorme, 100', (select count(*) from public.list_public_genus_species(pruebas.genero('Dendrobium'), 2147483647)), 100::bigint);
select pruebas.iguales('tamaño nulo, 50', (select count(*) from public.list_public_genus_species(pruebas.genero('Dendrobium'), null)), 50::bigint);
select pruebas.iguales('tamaño negativo, 50', (select count(*) from public.list_public_genus_species(pruebas.genero('Dendrobium'), -5)), 50::bigint);
select pruebas.iguales('página negativa, la 1', pg_temp.especies('Phalaenopsis', 1, -3), 'Phalaenopsis amabilis (total 2, página 1)');
select pruebas.iguales('página nula, la 1', pg_temp.especies('Phalaenopsis', 1, null), 'Phalaenopsis amabilis (total 2, página 1)');
select pruebas.iguales('más allá de la última, la última', pg_temp.especies('Phalaenopsis', 1, 2147483647), 'Phalaenopsis aphrodite (total 2, página 2)');
select pruebas.iguales('género solo con especies no públicas', pg_temp.especies('Oncidium'), 'ninguno');
select pruebas.iguales('género sin especies', pg_temp.especies('Vanda'), 'ninguno');
select pruebas.iguales('género que no existe', (select count(*) from public.list_public_genus_species(gen_random_uuid())), 0::bigint);
select pruebas.iguales('género nulo', (select count(*) from public.list_public_genus_species(null)), 0::bigint);
select pruebas.iguales(
  'ninguna fila no pública',
  (select count(*) from public.list_public_genus_species(pruebas.genero('Dendrobium'), 100, 2) s
     where s.scientific_name like '%b'),
  0::bigint
);

-- prueba: ficha: nombre, género, tipo, fuente, sinónimos y nombres comunes
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select pruebas.iguales(
  'Cattleya labiata',
  (select row(f.scientific_name, f.genus_name, f.genus_id = pruebas.genero('Cattleya'), f.type, f.source, f.source_ref,
              f.synonyms, f.synonym_count, f.common_names, f.common_name_count)::text
     from public.get_public_species(pruebas.especie('Cattleya labiata')) f),
  row('Cattleya labiata', 'Cattleya', true, 'species', 'col', 'COL1',
      array['Ángel labiata', 'Cattleya labiata var. autumnalis', 'Epidendrum labiatum'], 3,
      '[{"name": "flor de mayo", "language": "es"}, {"name": "Labiata sin idioma", "language": null}, {"name": "Queen of orchids", "language": "en"}]'::jsonb,
      3)::text
);
select pruebas.iguales(
  'columnas',
  pg_get_function_result('public.get_public_species(uuid)'::regprocedure),
  'TABLE(id uuid, scientific_name text, genus_id uuid, genus_name text, type species_type, source species_source, '
    || 'source_ref text, synonyms text[], synonym_count bigint, common_names jsonb, common_name_count bigint, reference_photo jsonb)'
);
select pruebas.iguales(
  'sin nombres: arreglos vacíos',
  (select f.synonyms::text || ' ' || f.synonym_count || ' ' || f.common_names::text || ' ' || f.common_name_count
     from public.get_public_species(pruebas.especie('Phalaenopsis amabilis')) f),
  '{} 0 [] 0'
);
select pruebas.iguales(
  'fuente de cada especie pública: la referencia solo de las externas',
  (select string_agg(f.scientific_name || ':' || f.source || ':' || coalesce(f.source_ref, '-'), ', ' order by f.scientific_name collate "C")
     from unnest(array['Cattleya trianae', 'Cattleya aclandiae', 'Cattleya × hardyana', 'Cattleya walkeriana']) n
     cross join lateral public.get_public_species(pruebas.especie(n)) f),
  'Cattleya aclandiae:gbif:G1, Cattleya trianae:col:COL2, Cattleya walkeriana:user_proposal:-, Cattleya × hardyana:curated:-'
);
select pruebas.iguales(
  'híbrido',
  (select f.type::text from public.get_public_species(pruebas.especie('Cattleya × hardyana')) f),
  'hybrid'
);

-- prueba: ficha: una especie no pública o que no existe no devuelve nada, sin distinguir los dos casos
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select pruebas.iguales(
  'filas de cada caso',
  (select string_agg(c.caso || ':' || (select count(*) from public.get_public_species(c.id)), ', ' order by c.caso)
     from (values
       ('propuesta observada', pruebas.especie('Cattleya secreta')),
       ('propuesta importada', pruebas.especie('Cattleya oculta')),
       ('no existe', gen_random_uuid()),
       ('nula', null::uuid)
     ) c (caso, id)),
  'no existe:0, nula:0, propuesta importada:0, propuesta observada:0'
);
select pruebas.debe_funcionar('una propuesta no da error', $$select * from public.get_public_species(pruebas.especie('Cattleya secreta'))$$);
-- Validada por el administrador, pasa a ser pública.
set local role postgres;
update public.species set status = 'validated' where scientific_name = 'Cattleya secreta';
set local role anon;
select pruebas.iguales(
  'validada',
  (select f.scientific_name || ' ' || f.synonyms::text from public.get_public_species(pruebas.especie('Cattleya secreta')) f),
  'Cattleya secreta {"Laelia secretissima"}'
);
select pruebas.iguales('y sale en la búsqueda', pg_temp.buscar('laelia secretissima'), 'Cattleya secreta');
select pruebas.iguales('y en su género', (select min(total_count) from public.list_public_genus_species(pruebas.genero('Cattleya'))), 6::bigint);

-- prueba: ficha: hasta 100 sinónimos y 100 nombres comunes, con el total de cada uno
set local role postgres;
insert into public.species_names (species_id, name, type, language)
select pruebas.especie('Phalaenopsis amabilis'), 'Sinonimo ' || lpad(i::text, 3, '0'), 'synonym', null
from generate_series(1, 130) i;
insert into public.species_names (species_id, name, type, language)
select pruebas.especie('Phalaenopsis amabilis'), 'comun ' || lpad(i::text, 3, '0'), 'common', 'es'
from generate_series(1, 105) i;
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select pruebas.iguales(
  'topes y totales',
  (select cardinality(f.synonyms) || ' de ' || f.synonym_count || ', ' || jsonb_array_length(f.common_names)
          || ' de ' || f.common_name_count || ', hasta ' || f.synonyms[100] || ' y ' || (f.common_names -> 99 ->> 'name')
     from public.get_public_species(pruebas.especie('Phalaenopsis amabilis')) f),
  '100 de 130, 100 de 105, hasta Sinonimo 100 y comun 100'
);

-- prueba: índices: los géneros usan species_public_genus_idx, las especies de un género species_public_genus_name_idx y la ficha las claves
-- Con los recorridos secuenciales desactivados, como en las demás pruebas de índices: si la
-- condición no coincidiera con la de los índices parciales, Postgres no podría usarlos. Se
-- anotan los índices recorridos en esta transacción durante cada llamada.
-- Con tan pocas filas y sin vacuum (no se puede dentro de la transacción), Postgres no hace
-- recorridos solo del índice y podría preferir species_genus_id_idx o species_genus_id_name_idx,
-- que no son parciales; con el catálogo real usa los parciales (ver "Catálogo público" en
-- supabase/README.md, medido con npm run db:perf). Aquí se quitan esos dos (vuelven con el
-- rollback) para comprobar lo que importa: que la condición de las funciones deja usar los
-- parciales.
set local role postgres;
drop index public.species_genus_id_idx;
drop index public.species_genus_id_name_idx;
analyze public.species, public.species_names, public.genera;
create temp table recorridos (indice text, antes bigint);
create function pg_temp.recorridos_desde_la_marca() returns text language sql as $$
  select coalesce(string_agg(r.indice, ', ' order by r.indice), 'ninguno')
  from pg_temp.recorridos r
  where pg_stat_get_xact_numscans(r.indice::regclass) > r.antes
$$;
create function pg_temp.marcar() returns void language sql as $$
  delete from pg_temp.recorridos;
  insert into pg_temp.recorridos
  select i, pg_stat_get_xact_numscans(i::regclass)
  from unnest(array['species_public_genus_idx', 'species_public_genus_name_idx', 'species_pkey',
                    'species_names_species_id_name_key', 'genera_pkey']) i;
$$;
grant select, insert, delete on pg_temp.recorridos to anon;
set local enable_seqscan = off;
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select pg_temp.marcar();
select count(*) from public.list_public_genera();
select pruebas.iguales('géneros', pg_temp.recorridos_desde_la_marca(), 'genera_pkey, species_public_genus_idx');
select pg_temp.marcar();
select count(*) from public.list_public_genus_species(pruebas.genero('Dendrobium'), 50, 2);
select pruebas.iguales('especies de un género', pg_temp.recorridos_desde_la_marca(),
  'genera_pkey, species_public_genus_idx, species_public_genus_name_idx');
select pg_temp.marcar();
select count(*) from public.get_public_species(pruebas.especie('Cattleya labiata'));
select pruebas.iguales('ficha', pg_temp.recorridos_desde_la_marca(),
  'genera_pkey, species_names_species_id_name_key, species_pkey');

-- prueba: índices: los dos índices parciales tienen la condición de especie pública
select pruebas.iguales(
  'definición',
  pg_get_indexdef('public.species_public_genus_name_idx'::regclass) || '; '
    || pg_get_indexdef('public.species_public_genus_idx'::regclass),
  'CREATE INDEX species_public_genus_name_idx ON public.species USING btree (genus_id, normalize_search_text(scientific_name) COLLATE "C", id) '
    || 'WHERE ((source <> ''user_proposal''::species_source) OR (status = ''validated''::species_status)); '
    || 'CREATE INDEX species_public_genus_idx ON public.species USING btree (genus_id) '
    || 'WHERE ((source <> ''user_proposal''::species_source) OR (status = ''validated''::species_status))'
);
