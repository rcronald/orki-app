-- Las migraciones se aplican de cero y dejan el esquema esperado.
--
-- Que npm run db:test llegue hasta aquí ya demuestra que todas las migraciones se aplican en
-- orden sobre una base vacía. Estas pruebas comprueban además que el resultado tiene las
-- piezas que el resto de pruebas y la app dan por hechas.

-- prueba: existen las seis tablas del esquema en public
select pruebas.iguales(
  'tablas de public',
  (select string_agg(c.relname, ', ' order by c.relname)
     from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')),
  'genera, genus_abbreviations, plants, profiles, species, species_names'
);

-- prueba: los enumerados tienen los valores acordados, en orden
select pruebas.iguales('species_type', enum_range(null::public.species_type)::text, '{species,hybrid}');
select pruebas.iguales('species_status', enum_range(null::public.species_status)::text, '{imported,validated,observed}');
select pruebas.iguales('species_source', enum_range(null::public.species_source)::text, '{gbif,curated,user_proposal}');
select pruebas.iguales('species_name_type', enum_range(null::public.species_name_type)::text, '{synonym,common}');
select pruebas.iguales('plant_type', enum_range(null::public.plant_type)::text, '{species,hybrid,unknown}');
select pruebas.iguales('plant_status', enum_range(null::public.plant_status)::text, '{active,lost,gifted}');
select pruebas.iguales('plant_validation', enum_range(null::public.plant_validation)::text, '{pending,validated,unidentifiable}');
select pruebas.iguales(
  'flower_color',
  enum_range(null::public.flower_color)::text,
  '{white,pink,purple,yellow,orange,bicolor}'
);

-- prueba: pg_trgm y unaccent están instaladas en el esquema extensions, no en public
select pruebas.iguales(
  'extensiones de búsqueda y su esquema',
  (select string_agg(e.extname || '@' || n.nspname, ', ' order by e.extname)
     from pg_extension e join pg_namespace n on n.oid = e.extnamespace
     where e.extname in ('pg_trgm', 'unaccent')),
  'pg_trgm@extensions, unaccent@extensions'
);

-- prueba: los disparadores de sincronización y de updated_at existen y están activos
select pruebas.iguales(
  'disparadores de public',
  (select string_agg(c.relname || '.' || t.tgname || ':' || t.tgenabled::text, ', ' order by c.relname, t.tgname)
     from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relnamespace = 'public'::regnamespace and not t.tgisinternal),
  'genera.set_updated_at:O, genus_abbreviations.set_updated_at:O, plants.set_updated_at:O, '
    || 'plants.sync_with_species:O, profiles.set_updated_at:O, species.propagate_to_plants:O, '
    || 'species.set_updated_at:O, species_names.set_updated_at:O'
);

-- prueba: las funciones de los disparadores viven en private y fijan un search_path vacío
select pruebas.iguales(
  'funciones de private',
  (select string_agg(p.proname || ' definer=' || p.prosecdef || ' ' || array_to_string(p.proconfig, ','), '; ' order by p.proname)
     from pg_proc p
     where p.pronamespace = 'private'::regnamespace),
  'propagate_species_to_plants definer=true search_path=""; '
    || 'set_updated_at definer=false search_path=""; '
    || 'sync_plant_with_species definer=true search_path=""'
);

-- prueba: las tablas y las funciones pertenecen a postgres, como en Supabase
select pruebas.iguales(
  'dueños de las tablas de public',
  (select string_agg(distinct pg_get_userbyid(c.relowner), ', ')
     from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')),
  'postgres'
);
select pruebas.iguales(
  'dueños de las funciones de private',
  (select string_agg(distinct pg_get_userbyid(p.proowner), ', ')
     from pg_proc p
     where p.pronamespace = 'private'::regnamespace),
  'postgres'
);
