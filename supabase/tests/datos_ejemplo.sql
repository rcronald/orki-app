-- Datos de ejemplo del catálogo para desarrollo (supabase/datos-ejemplo/catalogo.sql, que
-- carga npm run db:seed:dev). No son una migración: se incluyen con \i, con la ruta relativa
-- a la raíz del repositorio.

-- prueba: los datos de ejemplo se cargan sobre el esquema recién migrado
\i supabase/datos-ejemplo/catalogo.sql
-- Los géneros de los datos de ejemplo (Guarianthe, Paphiopedilum y Brassia) y sus abreviaturas
-- ya los carga la migración de abreviaturas: no se duplican.
select pruebas.iguales('géneros', (select count(*) from public.genera), 43::bigint);
select pruebas.iguales('abreviaturas', (select count(*) from public.genus_abbreviations), 43::bigint);
select pruebas.iguales('especies', (select count(*) from public.species), 40::bigint);
select pruebas.iguales(
  'sinónimos',
  (select count(*) from public.species_names where type = 'synonym'),
  10::bigint
);
select pruebas.iguales(
  'nombres comunes',
  (select count(*) from public.species_names where type = 'common'),
  12::bigint
);
select pruebas.comprobar(
  'todas las especies son de la lista curada, sin referencia externa',
  not exists (select from public.species where source <> 'curated' or source_ref is not null)
);
select pruebas.iguales(
  'los géneros de acceso rápido siguen siendo los cinco de la migración',
  (select string_agg(name, ', ' order by name) from public.genera where is_quick_access),
  'Cattleya, Dendrobium, Oncidium, Phalaenopsis, Vanda'
);
select pruebas.iguales(
  'un sinónimo de otro género lleva a la especie aceptada',
  (select g.name || ' / ' || s.scientific_name
     from public.species_names n
     join public.species s on s.id = n.species_id
     join public.genera g on g.id = s.genus_id
     where n.name = 'Cattleya skinneri'),
  'Guarianthe / Guarianthe skinneri'
);
select pruebas.iguales(
  'un nombre común con tilde y eñe',
  (select s.scientific_name
     from public.species_names n
     join public.species s on s.id = n.species_id
     where n.name = 'orquídea araña'),
  'Brassia verrucosa'
);
select pruebas.iguales(
  'cada especie está en el género de su nombre',
  (select count(*) from public.species s join public.genera g on g.id = s.genus_id
     where s.scientific_name not like g.name || ' %'),
  0::bigint
);

-- prueba: cargar los datos de ejemplo dos veces deja los mismos recuentos
\i supabase/datos-ejemplo/catalogo.sql
create temp table recuento_primera as
select
  (select count(*) from public.genera) as genera,
  (select count(*) from public.genus_abbreviations) as abreviaturas,
  (select count(*) from public.species) as especies,
  (select count(*) from public.species_names) as nombres;
\i supabase/datos-ejemplo/catalogo.sql
select pruebas.iguales(
  'recuentos tras la segunda carga',
  (select row(
     (select count(*) from public.genera),
     (select count(*) from public.genus_abbreviations),
     (select count(*) from public.species),
     (select count(*) from public.species_names))::text),
  (select row(genera, abreviaturas, especies, nombres)::text from recuento_primera)
);

-- prueba: los datos de ejemplo no tocan plants ni profiles
insert into public.profiles (id) values ('user_a');
insert into public.plants (user_id, entered_name, genus_id, type)
values ('user_a', 'Mi phalaenopsis', pruebas.genero('Phalaenopsis'), 'unknown');
create temp table antes as
select
  (select string_agg(p::text, '|') from public.profiles p) as perfiles,
  (select string_agg(p::text, '|') from public.plants p) as plantas;
\i supabase/datos-ejemplo/catalogo.sql
\i supabase/datos-ejemplo/catalogo.sql
select pruebas.iguales(
  'perfiles',
  (select string_agg(p::text, '|') from public.profiles p),
  (select perfiles from antes)
);
select pruebas.iguales(
  'plantas',
  (select string_agg(p::text, '|') from public.plants p),
  (select plantas from antes)
);

-- prueba: la migración de abreviaturas se aplica sobre los datos de ejemplo ya cargados, como en desarrollo
-- En el proyecto de desarrollo los datos de ejemplo se cargaron antes que la migración de
-- abreviaturas (#69). Se reproduce quitando lo que cargó esa migración (los géneros que no son
-- de acceso rápido, sin especies todavía, y sus abreviaturas en cascada), cargando los datos de
-- ejemplo y volviendo a ejecutar la migración entera, que está escrita para poder repetirse.
-- Además, un género ya existente con otras mayúsculas y una de sus abreviaturas ya usada por
-- otro género: la migración no los duplica ni falla.
delete from public.genera where not is_quick_access;
\i supabase/datos-ejemplo/catalogo.sql
insert into public.genera (name) values ('CYMBIDIUM');
insert into public.genus_abbreviations (genus_id, abbreviation) values (pruebas.genero('Vanda'), 'masd');
\i supabase/migrations/20261120200000_abreviaturas_y_busqueda_de_generos.sql
select pruebas.iguales('géneros', (select count(*) from public.genera), 43::bigint);
select pruebas.iguales('abreviaturas', (select count(*) from public.genus_abbreviations), 43::bigint);
select pruebas.iguales(
  'abreviaturas de los géneros de los datos de ejemplo',
  (select string_agg(g.name || '=' || a.abbreviation, ', ' order by g.name)
     from public.genera g join public.genus_abbreviations a on a.genus_id = g.id
     where g.name in ('Brassia', 'Guarianthe', 'Paphiopedilum')),
  'Brassia=Brs., Guarianthe=Gur., Paphiopedilum=Paph.'
);
select pruebas.iguales(
  'el género con otras mayúsculas no se duplica y recibe su abreviatura',
  (select string_agg(g.name || '=' || a.abbreviation, ', ')
     from public.genera g join public.genus_abbreviations a on a.genus_id = g.id
     where lower(g.name) = 'cymbidium'),
  'CYMBIDIUM=Cym.'
);
select pruebas.iguales(
  'la abreviatura ya usada se queda en su género y Masdevallia se crea sin ella',
  (select string_agg(g.name || '=' || coalesce(a.abbreviation, '-'), ', ' order by g.name)
     from public.genera g left join public.genus_abbreviations a on a.genus_id = g.id
     where g.name in ('Masdevallia') or a.abbreviation = 'masd'),
  'Masdevallia=-, Vanda=masd'
);
select pruebas.iguales(
  'los géneros de acceso rápido no cambian',
  (select string_agg(name, ', ' order by name) from public.genera where is_quick_access),
  'Cattleya, Dendrobium, Oncidium, Phalaenopsis, Vanda'
);
\i supabase/migrations/20261120200000_abreviaturas_y_busqueda_de_generos.sql
select pruebas.iguales(
  'recuentos tras aplicarla otra vez',
  (select row((select count(*) from public.genera), (select count(*) from public.genus_abbreviations),
              (select count(*) from public.species))::text),
  '(43,43,40)'
);
select pruebas.iguales(
  'la búsqueda expande la abreviatura sobre los datos de ejemplo',
  (select string_agg(s.scientific_name, ', ') from public.search_species('Paph. ins', 1) s),
  'Paphiopedilum insigne'
);
