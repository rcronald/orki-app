-- Sinónimos, nombres comunes, géneros y abreviaturas desde el backoffice (issue #107, parte de
-- #20): las funciones de la migración 20261121130000_nombres_generos_y_abreviaturas_del_
-- backoffice.sql.
--
-- Como en backoffice_escritura_especies.sql, cada prueba se pone el rol authenticated con el
-- claim app_role = catalog_admin (salvo las de permisos) y los rechazos se comprueban con
-- pruebas.motivo_error(). Los géneros y abreviaturas cargados por las migraciones se usan tal
-- cual (Phal., C., V., Rlc. de × Rhyncholaeliocattleya...). Lo inventado se señala con
-- "ficticio".

insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
values
  ('Cattleya purpurata', pruebas.genero('Cattleya'), 'species', 'imported', 'col', '3Z4W2'),
  ('Vanda coerulea', pruebas.genero('Vanda'), 'species', 'validated', 'col', '6VX01');
insert into public.species_names (species_id, name, type, language)
values
  (pruebas.especie('Cattleya purpurata'), 'Laelia purpurata', 'synonym', null),
  (pruebas.especie('Cattleya purpurata'), 'flor de la reina', 'common', 'es');
-- ficticio: un género sin especies, con una abreviatura, y otro con una planta sin especie.
insert into public.genera (name) values ('Restrepia'), ('Porroglossum');
insert into public.genus_abbreviations (genus_id, abbreviation) values (pruebas.genero('Restrepia'), 'Rstp.');
insert into public.profiles (id) values ('user_a');
insert into public.plants (user_id, entered_name, genus_id, type)
values ('user_a', 'La del mercado', pruebas.genero('Porroglossum'), 'unknown');

-- prueba: permisos: anon, un usuario sin rol, otro rol y la clave de servicio reciben 42501
do $$
declare
  peticion text[];
  sentencia text;
begin
  foreach peticion slice 1 in array array[
    array['anon', '{"role": "anon", "app_role": "catalog_admin"}'],
    array['authenticated', '{"sub": "user_a", "role": "authenticated"}'],
    array['authenticated', '{"sub": "user_a", "role": "authenticated", "app_role": "admin"}'],
    array['service_role', '{"role": "service_role"}']
  ] loop
    execute format('set local role %I', peticion[1]);
    perform set_config('request.jwt.claims', peticion[2], true);
    foreach sentencia in array array[
      $q$select public.add_species_name(pruebas.especie('Vanda coerulea'), 'vanda azul', 'common', 'es')$q$,
      $q$select public.update_species_name((select id from public.species_names where name = 'Laelia purpurata'), 'Laelia x', 'synonym')$q$,
      $q$select public.delete_species_name((select id from public.species_names where name = 'Laelia purpurata'))$q$,
      $q$select public.create_catalog_genus('Pleurothallis')$q$,
      $q$select public.update_catalog_genus(pruebas.genero('Restrepia'), 'Restrepia', true)$q$,
      $q$select public.delete_catalog_genus(pruebas.genero('Restrepia'))$q$,
      $q$select public.add_genus_abbreviation(pruebas.genero('Restrepia'), 'Rst.')$q$,
      $q$select public.update_genus_abbreviation((select id from public.genus_abbreviations where abbreviation = 'Rstp.'), 'Rst.')$q$,
      $q$select public.delete_genus_abbreviation((select id from public.genus_abbreviations where abbreviation = 'Rstp.'))$q$
    ] loop
      perform pruebas.debe_fallar(peticion[1] || ' ' || peticion[2] || ': ' || sentencia, sentencia, '42501');
    end loop;
    reset role;
  end loop;
end;
$$;
select pruebas.iguales(
  'nada cambió',
  (select row((select count(*) from public.species_names), (select count(*) from public.genera where name = 'Pleurothallis'),
              (select is_quick_access from public.genera where name = 'Restrepia'),
              (select string_agg(abbreviation, ',') from public.genus_abbreviations where genus_id = pruebas.genero('Restrepia')))::text),
  '(2,0,f,Rstp.)'
);

-- prueba: permisos y propiedades: solo authenticated, definer, search_path vacío y el guardián primero
select pruebas.iguales(
  'quién puede ejecutarlas, fuera de lo esperado',
  (select string_agg(p.proname || ':' || r.rol, ', ' order by p.proname, r.rol)
     from pg_proc p
     cross join (values ('anon'), ('authenticated'), ('service_role')) r (rol)
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('add_species_name', 'update_species_name', 'delete_species_name',
                         'create_catalog_genus', 'update_catalog_genus', 'delete_catalog_genus',
                         'add_genus_abbreviation', 'update_genus_abbreviation', 'delete_genus_abbreviation')
       and has_function_privilege(r.rol, p.oid, 'execute') <> (r.rol = 'authenticated')),
  null::text
);
select pruebas.iguales(
  'definer con search_path vacío y el guardián primero',
  (select count(*) from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('add_species_name', 'update_species_name', 'delete_species_name',
                         'create_catalog_genus', 'update_catalog_genus', 'delete_catalog_genus',
                         'add_genus_abbreviation', 'update_genus_abbreviation', 'delete_genus_abbreviation')
       and p.prosecdef
       and 'search_path=""' = any (p.proconfig)
       and pruebas.llama_primero_al_guardian('plpgsql', p.prosrc)),
  9::bigint
);

-- prueba: nombres: añadir un sinónimo y un nombre común, sin espacios sobrantes, y la búsqueda los encuentra al momento
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'sinónimo: el idioma se ignora',
  (select row(n.name, n.type, n.language)::text
     from public.add_species_name(pruebas.especie('Vanda coerulea'), '  Vanda   caerulea ', 'synonym', 'la') n),
  '("Vanda caerulea",synonym,)'
);
select pruebas.iguales(
  'nombre común con idioma',
  (select row(n.name, n.type, n.language)::text
     from public.add_species_name(pruebas.especie('Vanda coerulea'), 'vanda azul', 'common', ' ES ') n),
  '("vanda azul",common,es)'
);
select pruebas.iguales(
  'nombre común con idioma regional y sin idioma',
  (select string_agg(coalesce(n.language, '-'), ',')
     from (select * from public.add_species_name(pruebas.especie('Vanda coerulea'), 'orquídea azul', 'common', 'pt-BR')
           union all
           select * from public.add_species_name(pruebas.especie('Vanda coerulea'), 'blue vanda', 'common', '')) n),
  'pt-BR,-'
);
select pruebas.iguales('el buscador encuentra el sinónimo',
  (select r.scientific_name || ':' || r.matched_name_type from public.search_species('vanda caerul') r limit 1),
  'Vanda coerulea:synonym');
select pruebas.iguales('y el nombre común',
  (select r.scientific_name || ':' || r.matched_name_type from public.search_species('vanda azul') r limit 1),
  'Vanda coerulea:common');

-- prueba: nombres: errores con su motivo
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales('vacío',
  pruebas.motivo_error($$select public.add_species_name(pruebas.especie('Cattleya purpurata'), '  ', 'common')$$),
  '22023 name_required');
select pruebas.iguales('sin tipo',
  pruebas.motivo_error($$select public.add_species_name(pruebas.especie('Cattleya purpurata'), 'x y', null)$$),
  '22023 name_type_required');
select pruebas.iguales('el mismo nombre con otras mayúsculas, aunque sea de otro tipo',
  pruebas.motivo_error($$select public.add_species_name(pruebas.especie('Cattleya purpurata'), 'LAELIA PURPURATA', 'common')$$, 'existing_type'),
  '23505 duplicate_alternative_name synonym');
select pruebas.iguales('solo cambian las tildes',
  pruebas.motivo_error($$select public.add_species_name(pruebas.especie('Cattleya purpurata'), 'flor de la réina', 'common')$$, 'existing_name'),
  '23505 similar_alternative_name flor de la reina');
select pruebas.iguales('el nombre científico de la especie',
  pruebas.motivo_error($$select public.add_species_name(pruebas.especie('Cattleya purpurata'), 'cattleya purpurata', 'synonym')$$),
  '23505 name_is_scientific_name');
select pruebas.iguales('idioma mal escrito',
  pruebas.motivo_error($$select public.add_species_name(pruebas.especie('Cattleya purpurata'), 'reina', 'common', 'español')$$),
  '22023 invalid_language');
select pruebas.iguales('especie inexistente',
  pruebas.motivo_error($$select public.add_species_name(gen_random_uuid(), 'reina', 'common')$$),
  'P0002 species_not_found');
-- El mismo nombre en otra especie sí vale.
select pruebas.iguales('en otra especie vale',
  (select n.name from public.add_species_name(pruebas.especie('Vanda coerulea'), 'Laelia purpurata', 'synonym') n),
  'Laelia purpurata');

-- prueba: nombres: editar (nombre, tipo e idioma) y quitar
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'de nombre común a sinónimo: pierde el idioma',
  (select row(n.name, n.type, n.language)::text
     from public.update_species_name((select id from public.species_names where name = 'flor de la reina'), 'Cattleya  reina', 'synonym', 'es') n),
  '("Cattleya reina",synonym,)'
);
select pruebas.iguales(
  'cambiar solo las mayúsculas de su propio nombre',
  (select n.name from public.update_species_name((select id from public.species_names where name = 'Laelia purpurata'), 'Laelia Purpurata', 'synonym') n),
  'Laelia Purpurata'
);
select pruebas.iguales('chocar con otro nombre de la especie',
  pruebas.motivo_error($$select public.update_species_name((select id from public.species_names where name = 'Laelia Purpurata'), 'cattleya reina', 'synonym')$$),
  '23505 duplicate_alternative_name');
select public.delete_species_name((select id from public.species_names where name = 'Laelia Purpurata'));
select pruebas.iguales('quitado', (select count(*) from public.species_names where name = 'Laelia Purpurata'), 0::bigint);
select pruebas.iguales('la búsqueda ya no la encuentra por él',
  (select count(*) from public.search_species('laelia purpurata') r where r.matched_name_type = 'synonym'), 0::bigint);
select pruebas.iguales('quitar uno que no existe',
  pruebas.motivo_error($$select public.delete_species_name(gen_random_uuid())$$), 'P0002 name_not_found');
select pruebas.iguales('editar uno que no existe',
  pruebas.motivo_error($$select public.update_species_name(gen_random_uuid(), 'x', 'synonym')$$), 'P0002 name_not_found');

-- prueba: géneros: crear (también un nothogénero con el signo pegado) y la búsqueda de géneros lo encuentra
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales('género nuevo',
  (select row(g.name, g.is_quick_access)::text from public.create_catalog_genus('  Pleurothallis ') g),
  '(Pleurothallis,f)');
select pruebas.iguales('nothogénero con el signo pegado, de acceso rápido',
  (select row(g.name, g.is_quick_access)::text from public.create_catalog_genus('×Mokara', true) g),
  '("× Mokara",t)');
select pruebas.iguales('search_genera lo encuentra',
  (select string_agg(r.name, ', ') from public.search_genera('pleurothal') r), 'Pleurothallis');

-- prueba: géneros: errores con su motivo
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales('vacío',
  pruebas.motivo_error($$select public.create_catalog_genus(' ')$$), '22023 name_required');
select pruebas.iguales('dos palabras',
  pruebas.motivo_error($$select public.create_catalog_genus('Cattleya alba')$$), '22023 invalid_genus_name');
select pruebas.iguales('sin acceso rápido',
  pruebas.motivo_error($$select public.create_catalog_genus('Pleurothallis', null)$$), '22023 quick_access_required');
select pruebas.iguales('mismo nombre con otras mayúsculas',
  pruebas.motivo_error($$select public.create_catalog_genus('CATTLEYA')$$, 'existing_name'), '23505 duplicate_genus Cattleya');
select pruebas.iguales('solo cambia el signo de híbrido',
  pruebas.motivo_error($$select public.create_catalog_genus('× Rhyncholaeliocattleya')$$, 'existing_name'),
  '23505 similar_genus Rhyncholaeliocattleya');

-- prueba: géneros: renombrar (poner y quitar el signo) y marcar o quitar el acceso rápido
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales('poner el signo y marcar acceso rápido',
  (select row(g.name, g.is_quick_access)::text
     from public.update_catalog_genus(pruebas.genero('Rhyncholaeliocattleya'), '×Rhyncholaeliocattleya', true) g),
  '("× Rhyncholaeliocattleya",t)');
select pruebas.iguales('volver a quitarlo',
  (select g.name from public.update_catalog_genus(pruebas.genero('× Rhyncholaeliocattleya'), 'Rhyncholaeliocattleya', true) g),
  'Rhyncholaeliocattleya');
select pruebas.iguales('quitar el acceso rápido a Vanda',
  (select g.is_quick_access::text from public.update_catalog_genus(pruebas.genero('Vanda'), 'Vanda', false) g), 'false');
select pruebas.iguales('sus abreviaturas siguen funcionando',
  (select string_agg(r.name, ', ') from public.search_genera('rlc') r), 'Rhyncholaeliocattleya');
select pruebas.iguales('renombrar como otro',
  pruebas.motivo_error($$select public.update_catalog_genus(pruebas.genero('Restrepia'), 'vanda', false)$$, 'existing_name'),
  '23505 duplicate_genus Vanda');
select pruebas.iguales('no existe',
  pruebas.motivo_error($$select public.update_catalog_genus(gen_random_uuid(), 'Restrepia', false)$$), 'P0002 genus_not_found');
-- El nombre científico de las especies no cambia.
select public.update_catalog_genus(pruebas.genero('Vanda'), 'Vandaa', false);
select pruebas.iguales('las especies conservan su nombre',
  (select scientific_name from public.species where genus_id = pruebas.genero('Vandaa')), 'Vanda coerulea');

-- prueba: géneros: borrar solo sin especies ni plantas, con sus abreviaturas
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales('con especies',
  pruebas.motivo_error($$select public.delete_catalog_genus(pruebas.genero('Vanda'))$$, 'species_count'),
  '23503 genus_has_species 1');
select pruebas.iguales('con una planta sin especie',
  pruebas.motivo_error($$select public.delete_catalog_genus(pruebas.genero('Porroglossum'))$$, 'plant_count'),
  '23503 genus_has_plants 1');
select public.delete_catalog_genus(pruebas.genero('Restrepia'));
select pruebas.iguales('borrado con su abreviatura',
  (select row((select count(*) from public.genera where name = 'Restrepia'),
              (select count(*) from public.genus_abbreviations where abbreviation = 'Rstp.'))::text),
  '(0,0)');
select pruebas.iguales('no existe',
  pruebas.motivo_error($$select public.delete_catalog_genus(gen_random_uuid())$$), 'P0002 genus_not_found');

-- prueba: abreviaturas: con su punto, y funcionan al momento en las dos búsquedas
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales('sin punto: se añade',
  (select a.abbreviation from public.add_genus_abbreviation(pruebas.genero('Restrepia'), ' Rst ') a), 'Rst.');
insert into public.species (scientific_name, genus_id, type, status, source)
  values ('Restrepia guttulata', pruebas.genero('Restrepia'), 'species', 'validated', 'curated');
select pruebas.iguales('search_species con la abreviatura y el epíteto',
  (select string_agg(r.scientific_name, ', ') from public.search_species('Rst. gutt') r), 'Restrepia guttulata');
select pruebas.iguales('search_genera por la abreviatura',
  (select string_agg(r.name || ':' || r.matched_abbreviation, ', ') from public.search_genera('rst') r), 'Restrepia:Rst.');
select pruebas.iguales('editar',
  (select a.abbreviation from public.update_genus_abbreviation(
     (select id from public.genus_abbreviations where abbreviation = 'Rstp.'), 'Rsp') a), 'Rsp.');
select public.delete_genus_abbreviation((select id from public.genus_abbreviations where abbreviation = 'Rsp.'));
select pruebas.iguales('quitada',
  (select string_agg(abbreviation, ',' order by abbreviation) from public.genus_abbreviations where genus_id = pruebas.genero('Restrepia')),
  'Rst.');

-- prueba: abreviaturas: el choque dice qué género la tiene, sin distinguir mayúsculas, tildes ni el punto
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales('de otro género',
  pruebas.motivo_error($$select public.add_genus_abbreviation(pruebas.genero('Restrepia'), 'PHAL')$$, 'genus_name'),
  '23505 abbreviation_taken Phalaenopsis');
select pruebas.iguales('con tilde',
  pruebas.motivo_error($$select public.add_genus_abbreviation(pruebas.genero('Restrepia'), 'Phál.')$$, 'existing_abbreviation'),
  '23505 abbreviation_taken Phal.');
select pruebas.iguales('del mismo género',
  pruebas.motivo_error($$select public.add_genus_abbreviation(pruebas.genero('Restrepia'), 'rstp')$$, 'genus_name'),
  '23505 abbreviation_taken Restrepia');
select pruebas.iguales('editar a la de otro',
  pruebas.motivo_error($$select public.update_genus_abbreviation((select id from public.genus_abbreviations where abbreviation = 'Rstp.'), 'v')$$, 'genus_name'),
  '23505 abbreviation_taken Vanda');
select pruebas.iguales('editar sus mayúsculas no choca consigo misma',
  (select a.abbreviation from public.update_genus_abbreviation((select id from public.genus_abbreviations where abbreviation = 'Rstp.'), 'RSTP.') a),
  'RSTP.');
select pruebas.iguales('vacía', pruebas.motivo_error($$select public.add_genus_abbreviation(pruebas.genero('Restrepia'), ' . ')$$), '22023 name_required');
select pruebas.iguales('dos palabras', pruebas.motivo_error($$select public.add_genus_abbreviation(pruebas.genero('Restrepia'), 'R. s.')$$), '22023 invalid_abbreviation');
select pruebas.iguales('género inexistente', pruebas.motivo_error($$select public.add_genus_abbreviation(gen_random_uuid(), 'Zz.')$$), 'P0002 genus_not_found');
select pruebas.iguales('quitar una que no existe', pruebas.motivo_error($$select public.delete_genus_abbreviation(gen_random_uuid())$$), 'P0002 abbreviation_not_found');
