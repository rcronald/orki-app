-- Las migraciones se aplican de cero y dejan el esquema esperado.
--
-- Que npm run db:test llegue hasta aquí ya demuestra que todas las migraciones se aplican en
-- orden sobre una base vacía. Estas pruebas comprueban además que el resultado tiene las
-- piezas que el resto de pruebas y la app dan por hechas.

-- prueba: existen las trece tablas del esquema en public
select pruebas.iguales(
  'tablas de public',
  (select string_agg(c.relname, ', ' order by c.relname)
     from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')),
  'catalog_audit_log, genera, genus_abbreviations, plant_log_entries, plant_photos, plants, product_events, profiles, species, species_merge_keys, '
    || 'species_names, species_photo_rejections, species_photos'
);

-- prueba: los enumerados tienen los valores acordados, en orden
select pruebas.iguales('species_type', enum_range(null::public.species_type)::text, '{species,hybrid}');
select pruebas.iguales('species_status', enum_range(null::public.species_status)::text, '{imported,validated,observed}');
select pruebas.iguales('species_source', enum_range(null::public.species_source)::text, '{gbif,curated,user_proposal,col}');
select pruebas.iguales('species_name_type', enum_range(null::public.species_name_type)::text, '{synonym,common}');
select pruebas.iguales('species_photo_source', enum_range(null::public.species_photo_source)::text, '{inaturalist}');
select pruebas.iguales('species_match_type', enum_range(null::public.species_match_type)::text, '{scientific,synonym,common}');
select pruebas.iguales('plant_type', enum_range(null::public.plant_type)::text, '{species,hybrid,unknown}');
select pruebas.iguales('plant_status', enum_range(null::public.plant_status)::text, '{active,lost,gifted}');
select pruebas.iguales('plant_validation', enum_range(null::public.plant_validation)::text, '{pending,validated,unidentifiable}');
select pruebas.iguales(
  'flower_color',
  enum_range(null::public.flower_color)::text,
  '{white,pink,purple,yellow,orange,bicolor}'
);
select pruebas.iguales('product_event_type', enum_range(null::public.product_event_type)::text, '{plant_registered,have_it_search}');
select pruebas.iguales('product_event_result', enum_range(null::public.product_event_result)::text, '{owned,not_owned,similar}');
select pruebas.iguales(
  'plant_log_entry_type',
  enum_range(null::public.plant_log_entry_type)::text,
  '{watering,nutrition,preventive_maintenance,preventive_health}'
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
  'catalog_audit_log.fill_species_id:O, genera.audit_change:O, genera.set_updated_at:O, genus_abbreviations.audit_change:O, '
    || 'genus_abbreviations.set_updated_at:O, plant_log_entries.check_plant:O, plant_photos.check_plant:O, plant_photos.sync_plant:O, '
    || 'plants.check_log_owner:O, plants.check_photos_owner:O, plants.copy_photo_to_photos:O, plants.copy_photo_to_photos_on_update:O, '
    || 'plants.keep_code:O, plants.remove_main_photo:O, plants.set_updated_at:O, '
    || 'plants.sync_with_species:O, plants.tag_code:O, profiles.delete_plant_code_counters:O, profiles.delete_product_events:O, profiles.set_updated_at:O, species.audit_change:O, '
    || 'species.propagate_to_plants:O, species.set_updated_at:O, '
    || 'species.validate_edited_imported:O, species_names.audit_change:O, '
    || 'species_names.set_updated_at:O, species_photos.check_not_rejected:O, species_photos.set_updated_at:O'
);

-- prueba: las funciones de los disparadores y el guardián de administrador viven en private y fijan un search_path vacío
select pruebas.iguales(
  'funciones de private',
  (select string_agg(p.proname || ' definer=' || p.prosecdef || ' ' || array_to_string(p.proconfig, ','), '; ' order by p.proname)
     from pg_proc p
     where p.pronamespace = 'private'::regnamespace),
  'assign_plant_code definer=true search_path=""; '
    || 'audit_catalog_change definer=true search_path=""; '
    || 'backfill_plant_codes definer=false search_path=""; '
    || 'check_abbreviation_free definer=false search_path=""; '
    || 'check_alternative_name definer=false search_path=""; '
    || 'check_genus_name_free definer=false search_path=""; '
    || 'check_plant_log_entry definer=true search_path=""; '
    || 'check_plant_log_owner_change definer=true search_path=""; '
    || 'check_plant_owner_change definer=true search_path=""; '
    || 'check_plant_photo definer=true search_path=""; '
    || 'check_species_name_free definer=false search_path=""; '
    || 'check_species_photo_not_rejected definer=false search_path=""; '
    || 'clean_abbreviation definer=false search_path=""; '
    || 'clean_catalog_text definer=false search_path=""; '
    || 'clean_genus_name definer=false search_path=""; '
    || 'clean_name_language definer=false search_path=""; '
    || 'copy_legacy_plant_photos definer=false search_path=""; '
    || 'copy_main_photo_to_plant definer=true search_path=""; '
    || 'copy_plant_photo_to_photos definer=true search_path=""; '
    || 'current_catalog_action_id definer=false search_path=""; '
    || 'delete_profile_events definer=true search_path=""; '
    || 'delete_profile_plant_codes definer=true search_path=""; '
    || 'keep_plant_code definer=true search_path=""; '
    || 'log_catalog_action definer=false search_path=""; '
    || 'plant_code_prefix definer=false search_path=""; '
    || 'propagate_species_to_plants definer=true search_path=""; '
    || 'raise_catalog_error definer=false search_path=""; '
    || 'remove_main_photo_from_plant definer=true search_path=""; '
    || 'require_catalog_admin definer=false search_path=""; '
    || 'set_audit_species_id definer=false search_path=""; '
    || 'set_updated_at definer=false search_path=""; '
    || 'species_merge_plan definer=false search_path=""; '
    || 'sync_plant_from_photos definer=true search_path=""; '
    || 'sync_plant_with_species definer=true search_path=""; '
    || 'validate_edited_imported_species definer=false search_path=""'
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
