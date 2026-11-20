-- Datos de ejemplo del catálogo para desarrollo (supabase/datos-ejemplo/catalogo.sql, que
-- carga npm run db:seed:dev). No son una migración: se incluyen con \i, con la ruta relativa
-- a la raíz del repositorio.

-- prueba: los datos de ejemplo se cargan sobre el esquema recién migrado
\i supabase/datos-ejemplo/catalogo.sql
select pruebas.iguales('géneros', (select count(*) from public.genera), 8::bigint);
select pruebas.iguales('abreviaturas', (select count(*) from public.genus_abbreviations), 8::bigint);
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
