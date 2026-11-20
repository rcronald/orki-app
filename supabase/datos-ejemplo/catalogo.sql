-- Datos de ejemplo del catálogo, SOLO para el proyecto de desarrollo (issue #52).
--
-- Unas pocas especies e híbridos reales, con sinónimos y nombres comunes, para probar el
-- registro y el autocompletado (#7) sin esperar al catálogo real, que llega con la
-- importación del issue #8. No es una migración ni un seed de la CLI: "supabase db push" no
-- lo aplica, así que nunca llega a producción. Se carga con:
--
--   npm run db:seed:dev
--
-- y las pruebas de base de datos (supabase/tests/datos_ejemplo.sql) lo cargan sobre la base
-- desechable.
--
-- Idempotente: cada inserción usa "on conflict ... do nothing" sobre las claves únicas reales
-- del esquema (lower(name) en genera, lower(abbreviation) en genus_abbreviations,
-- lower(scientific_name) en species y (species_id, lower(name)) en species_names). Volver a
-- cargarlo no duplica nada ni modifica lo que ya existe: tampoco los cinco géneros de acceso
-- rápido que siembra la migración ni las especies que alguien haya editado a mano. Por eso,
-- si se cambia aquí el género o el tipo de una especie ya cargada, el cambio no se aplica.
-- Nunca toca plants ni profiles.
--
-- Todo va en un único bloque "do", que Postgres ejecuta como una sola sentencia: o se carga
-- entero o no se carga nada, lo envíe quien lo envíe (la CLI de Supabase o psql), y se puede
-- incluir dentro de la transacción de una prueba. El archivo no debe tener ninguna otra
-- sentencia: "supabase db query" ejecuta el archivo como una sola consulta preparada y
-- rechaza las que tienen varias ("cannot insert multiple commands into a prepared
-- statement"). El resumen de lo cargado lo muestra npm run db:seed:dev aparte.
--
-- Casos pensados para el autocompletado:
--   - Nombres que comparten prefijo: Phalaenopsis schilleriana, stuartiana y Sogo Yukidian;
--     Cattleya walkeriana y warscewiczii; Oncidium sphacelatum, Sharry Baby y
--     Sharry Baby 'Sweet Fragrance'.
--   - Tildes y eñes en nombres comunes: "orquídea araña", "orquídea luna".
--   - Un mismo nombre común en dos especies: "flor de mayo" (Cattleya mossiae y C. trianae).
--   - Sinónimos de otro género distinto del aceptado: Cattleya skinneri (hoy Guarianthe),
--     Laelia purpurata y Sophronitis coccinea (hoy Cattleya), Doritis pulcherrima (hoy
--     Phalaenopsis), Neofinetia falcata y Euanthe sanderiana (hoy Vanda), Odontoglossum
--     crispum (hoy Oncidium alexandrae), Cypripedium insigne (hoy Paphiopedilum).
--   - Híbridos con nombre de grex, que se escribe sin comillas (Phalaenopsis Sogo Yukidian),
--     con apóstrofo (Vanda Robert's Delight) y con un cultivar entre comillas simples
--     (Oncidium Sharry Baby 'Sweet Fragrance').
--
-- Las abreviaturas de los géneros nuevos son las estándar de la RHS (la misma lista que cita
-- la migración del catálogo): Guarianthe = Gur., Paphiopedilum = Paph., Brassia = Brs.

do $$
declare
  faltan text;
begin
  -- Datos de entrada, en tablas temporales que se borran al final del bloque.
  create temp table seed_genera (name text not null, abbreviation text not null);
  create temp table seed_species (
    genus_name text not null,
    scientific_name text not null,
    type public.species_type not null,
    status public.species_status not null
  );
  create temp table seed_species_names (
    scientific_name text not null,
    name text not null,
    type public.species_name_type not null,
    language text
  );

  -- Géneros que no son de acceso rápido (los cinco de acceso rápido los crea la migración).
  insert into seed_genera (name, abbreviation)
  values
    ('Guarianthe', 'Gur.'),
    ('Paphiopedilum', 'Paph.'),
    ('Brassia', 'Brs.');

  insert into seed_species (genus_name, scientific_name, type, status)
  values
    -- Phalaenopsis
    ('Phalaenopsis', 'Phalaenopsis amabilis', 'species', 'validated'),
    ('Phalaenopsis', 'Phalaenopsis aphrodite', 'species', 'validated'),
    ('Phalaenopsis', 'Phalaenopsis schilleriana', 'species', 'validated'),
    ('Phalaenopsis', 'Phalaenopsis stuartiana', 'species', 'validated'),
    ('Phalaenopsis', 'Phalaenopsis equestris', 'species', 'validated'),
    ('Phalaenopsis', 'Phalaenopsis bellina', 'species', 'validated'),
    ('Phalaenopsis', 'Phalaenopsis violacea', 'species', 'validated'),
    ('Phalaenopsis', 'Phalaenopsis pulcherrima', 'species', 'validated'),
    ('Phalaenopsis', 'Phalaenopsis Sogo Yukidian', 'hybrid', 'validated'),
    -- Cattleya
    ('Cattleya', 'Cattleya labiata', 'species', 'validated'),
    ('Cattleya', 'Cattleya trianae', 'species', 'validated'),
    ('Cattleya', 'Cattleya mossiae', 'species', 'validated'),
    ('Cattleya', 'Cattleya warscewiczii', 'species', 'validated'),
    ('Cattleya', 'Cattleya walkeriana', 'species', 'validated'),
    ('Cattleya', 'Cattleya coccinea', 'species', 'validated'),
    ('Cattleya', 'Cattleya purpurata', 'species', 'validated'),
    ('Cattleya', 'Cattleya Bow Bells', 'hybrid', 'validated'),
    -- Dendrobium
    ('Dendrobium', 'Dendrobium nobile', 'species', 'validated'),
    ('Dendrobium', 'Dendrobium kingianum', 'species', 'validated'),
    ('Dendrobium', 'Dendrobium lindleyi', 'species', 'validated'),
    ('Dendrobium', 'Dendrobium chrysotoxum', 'species', 'validated'),
    ('Dendrobium', 'Dendrobium Berry Oda', 'hybrid', 'imported'),
    -- Oncidium
    ('Oncidium', 'Oncidium sphacelatum', 'species', 'validated'),
    ('Oncidium', 'Oncidium ornithorhynchum', 'species', 'validated'),
    ('Oncidium', 'Oncidium alexandrae', 'species', 'validated'),
    ('Oncidium', 'Oncidium Sharry Baby', 'hybrid', 'validated'),
    ('Oncidium', 'Oncidium Sharry Baby ''Sweet Fragrance''', 'hybrid', 'imported'),
    ('Oncidium', 'Oncidium Twinkle', 'hybrid', 'observed'),
    -- Vanda
    ('Vanda', 'Vanda coerulea', 'species', 'validated'),
    ('Vanda', 'Vanda sanderiana', 'species', 'validated'),
    ('Vanda', 'Vanda falcata', 'species', 'validated'),
    ('Vanda', 'Vanda tricolor', 'species', 'validated'),
    ('Vanda', 'Vanda Robert''s Delight', 'hybrid', 'validated'),
    -- Guarianthe
    ('Guarianthe', 'Guarianthe skinneri', 'species', 'validated'),
    ('Guarianthe', 'Guarianthe aurantiaca', 'species', 'validated'),
    -- Paphiopedilum
    ('Paphiopedilum', 'Paphiopedilum insigne', 'species', 'validated'),
    ('Paphiopedilum', 'Paphiopedilum rothschildianum', 'species', 'validated'),
    ('Paphiopedilum', 'Paphiopedilum Maudiae', 'hybrid', 'validated'),
    -- Brassia
    ('Brassia', 'Brassia verrucosa', 'species', 'validated'),
    ('Brassia', 'Brassia caudata', 'species', 'validated');

  insert into seed_species_names (scientific_name, name, type, language)
  values
    -- Sinónimos (nombres antiguos, muchos de otro género).
    ('Phalaenopsis pulcherrima', 'Doritis pulcherrima', 'synonym', null),
    ('Cattleya coccinea', 'Sophronitis coccinea', 'synonym', null),
    ('Cattleya purpurata', 'Laelia purpurata', 'synonym', null),
    ('Dendrobium lindleyi', 'Dendrobium aggregatum', 'synonym', null),
    ('Oncidium alexandrae', 'Odontoglossum crispum', 'synonym', null),
    ('Vanda sanderiana', 'Euanthe sanderiana', 'synonym', null),
    ('Vanda falcata', 'Neofinetia falcata', 'synonym', null),
    ('Guarianthe skinneri', 'Cattleya skinneri', 'synonym', null),
    ('Guarianthe aurantiaca', 'Cattleya aurantiaca', 'synonym', null),
    ('Paphiopedilum insigne', 'Cypripedium insigne', 'synonym', null),
    -- Nombres comunes.
    ('Phalaenopsis amabilis', 'orquídea luna', 'common', 'es'),
    ('Phalaenopsis amabilis', 'moon orchid', 'common', 'en'),
    ('Cattleya mossiae', 'flor de mayo', 'common', 'es'),
    ('Cattleya trianae', 'flor de mayo', 'common', 'es'),
    ('Oncidium sphacelatum', 'lluvia de oro', 'common', 'es'),
    ('Oncidium Sharry Baby', 'orquídea chocolate', 'common', 'es'),
    ('Vanda coerulea', 'vanda azul', 'common', 'es'),
    ('Vanda coerulea', 'blue vanda', 'common', 'en'),
    ('Vanda sanderiana', 'waling-waling', 'common', null),
    ('Guarianthe skinneri', 'guaria morada', 'common', 'es'),
    ('Dendrobium kingianum', 'pink rock orchid', 'common', 'en'),
    ('Brassia verrucosa', 'orquídea araña', 'common', 'es');

  -- Todo lo que se va a cargar tiene que encontrar su género o su especie: si no, un error
  -- de escritura en este archivo haría que una fila se perdiera sin avisar.
  select string_agg(distinct genus_name, ', ') into faltan
  from seed_species e
  where not exists (select from seed_genera g where g.name = e.genus_name)
    and not exists (select from public.genera g where lower(g.name) = lower(e.genus_name));
  if faltan is not null then
    raise exception 'Datos de ejemplo: géneros desconocidos: %', faltan;
  end if;

  select string_agg(distinct scientific_name, ', ') into faltan
  from seed_species_names n
  where not exists (select from seed_species e where e.scientific_name = n.scientific_name);
  if faltan is not null then
    raise exception 'Datos de ejemplo: nombres alternativos de especies que no están en la lista: %', faltan;
  end if;

  -- Carga.
  insert into public.genera (name)
  select name from seed_genera
  on conflict ((lower(name))) do nothing;

  insert into public.genus_abbreviations (genus_id, abbreviation)
  select g.id, s.abbreviation
  from seed_genera s
  join public.genera g on lower(g.name) = lower(s.name)
  on conflict ((lower(abbreviation))) do nothing;

  insert into public.species (scientific_name, genus_id, type, status, source)
  select e.scientific_name, g.id, e.type, e.status, 'curated'
  from seed_species e
  join public.genera g on lower(g.name) = lower(e.genus_name)
  on conflict ((lower(scientific_name))) do nothing;

  insert into public.species_names (species_id, name, type, language)
  select s.id, n.name, n.type, n.language
  from seed_species_names n
  join public.species s on lower(s.scientific_name) = lower(n.scientific_name)
  on conflict (species_id, (lower(name))) do nothing;

  drop table seed_genera, seed_species, seed_species_names;
end;
$$;

