-- Alta, edición, baja y cambio de estado de especies desde el backoffice (issue #106, parte de
-- #20): create_catalog_species(), update_catalog_species(), set_catalog_species_status(),
-- delete_catalog_species() y el disparador validate_edited_imported, de la migración
-- 20261121120000_escritura_de_especies_del_backoffice.sql.
--
-- Las funciones son solo para administradores: cada prueba se pone el rol authenticated con el
-- claim app_role = catalog_admin antes de llamarlas (salvo las de permisos). Los rechazos se
-- comprueban por su código y su motivo con pruebas.motivo_error(). Los nombres inventados se
-- señalan con "ficticio".

-- Datos de partida: especies importadas de COL, una validada, una curada de la lista de
-- híbridos, un par que solo se diferencia en el signo de híbrido (como los que trae la fuente),
-- nombres alternativos y plantas de dos usuarios.
insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
values
  ('Phalaenopsis amabilis', pruebas.genero('Phalaenopsis'), 'species', 'imported', 'col', '4FR2J'),
  ('Phalaenopsis aphrodite', pruebas.genero('Phalaenopsis'), 'species', 'validated', 'col', '4FR2K'),
  ('Phalaenopsis × intermedia', pruebas.genero('Phalaenopsis'), 'hybrid', 'imported', 'col', '4FR2L'),
  -- ficticio: se normaliza igual que el híbrido de arriba.
  ('Phalaenopsis intermedia', pruebas.genero('Phalaenopsis'), 'species', 'imported', 'col', '4FR2X'),
  ('Cattleya labiata', pruebas.genero('Cattleya'), 'species', 'imported', 'col', '3Z4W1'),
  ('Cattleya purpurata', pruebas.genero('Cattleya'), 'species', 'imported', 'col', '3Z4W2'),
  ('Vanda coerulea', pruebas.genero('Vanda'), 'species', 'observed', 'col', '6VX01'),
  ('Phalaenopsis Sogo Yukidian', pruebas.genero('Phalaenopsis'), 'hybrid', 'validated', 'curated', 'HIB-0001');

insert into public.species_names (species_id, name, type, language)
values
  (pruebas.especie('Cattleya purpurata'), 'Laelia purpurata', 'synonym', null),
  (pruebas.especie('Cattleya purpurata'), 'flor de la reina', 'common', 'es');

insert into public.profiles (id) values ('user_a'), ('user_b');
insert into public.plants (user_id, entered_name, species_id)
values
  ('user_a', 'Mi mariposa', pruebas.especie('Phalaenopsis amabilis')),
  ('user_b', 'Regalo', pruebas.especie('Phalaenopsis amabilis')),
  ('user_b', 'La de la ventana', pruebas.especie('Cattleya labiata'));

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
      $q$select public.create_catalog_species('Vanda tricolor', pruebas.genero('Vanda'), 'species')$q$,
      $q$select public.update_catalog_species(pruebas.especie('Cattleya labiata'), 'Cattleya labiata', pruebas.genero('Cattleya'), 'species', 'validated')$q$,
      $q$select public.set_catalog_species_status(array[pruebas.especie('Cattleya labiata')], 'validated')$q$,
      $q$select public.delete_catalog_species(pruebas.especie('Vanda coerulea'))$q$
    ] loop
      perform pruebas.debe_fallar(peticion[1] || ' ' || peticion[2] || ': ' || sentencia, sentencia, '42501');
    end loop;
    reset role;
  end loop;
end;
$$;
select pruebas.iguales(
  'nada cambió',
  (select string_agg(scientific_name || ':' || status, ', ' order by scientific_name)
     from public.species where scientific_name in ('Cattleya labiata', 'Vanda coerulea', 'Vanda tricolor')),
  'Cattleya labiata:imported, Vanda coerulea:observed'
);

-- prueba: permisos y propiedades: solo authenticated las ejecuta, definer, search_path vacío y el guardián primero
select pruebas.iguales(
  'quién puede ejecutarlas',
  (select string_agg(f.firma || ':' || r.rol || '=' || has_function_privilege(r.rol, f.firma, 'execute'), ', '
                     order by f.firma, r.rol)
     from (values
       ('public.create_catalog_species(text, uuid, public.species_type, public.species_status)'),
       ('public.update_catalog_species(uuid, text, uuid, public.species_type, public.species_status)'),
       ('public.set_catalog_species_status(uuid[], public.species_status)'),
       ('public.delete_catalog_species(uuid)')
     ) f (firma)
     cross join (values ('anon'), ('authenticated'), ('service_role')) r (rol)
     where has_function_privilege(r.rol, f.firma, 'execute') <> (r.rol = 'authenticated')),
  null::text
);
select pruebas.iguales(
  'security definer y search_path',
  (select string_agg(p.proname || ' definer=' || p.prosecdef || ' ' || array_to_string(p.proconfig, ','), '; ' order by p.proname)
     from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('create_catalog_species', 'update_catalog_species', 'set_catalog_species_status', 'delete_catalog_species')),
  'create_catalog_species definer=true search_path=""; '
  'delete_catalog_species definer=true search_path=""; '
  'set_catalog_species_status definer=true search_path=""; '
  'update_catalog_species definer=true search_path=""'
);
select pruebas.iguales(
  'funciones que no llaman primero al guardián',
  (select string_agg(p.proname, ', ')
     from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('create_catalog_species', 'update_catalog_species', 'set_catalog_species_status', 'delete_catalog_species')
       and not pruebas.llama_primero_al_guardian('plpgsql', p.prosrc)),
  null::text
);

-- prueba: alta: fuente curated sin referencia, validada por defecto, sin espacios sobrantes, y se encuentra en la búsqueda
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'especie creada',
  (select row(s.scientific_name, s.type, s.status, s.source, s.source_ref is null)::text
     from public.create_catalog_species('  Vanda   tricolor ', pruebas.genero('Vanda'), 'species') s),
  '("Vanda tricolor",species,validated,curated,t)'
);
select pruebas.iguales(
  'híbrido observado',
  (select row(s.scientific_name, s.type, s.status)::text
     from public.create_catalog_species('Vanda Robert''s Delight', pruebas.genero('Vanda'), 'hybrid', 'observed') s),
  '("Vanda Robert''s Delight",hybrid,observed)'
);
select pruebas.iguales(
  'la búsqueda la encuentra al momento',
  (select string_agg(r.scientific_name, ', ') from public.search_species('vanda tric') r),
  'Vanda tricolor'
);
select pruebas.iguales(
  'y por la abreviatura del género',
  (select string_agg(r.scientific_name, ', ') from public.search_species('V. tricolor') r),
  'Vanda tricolor'
);

-- prueba: alta: errores con su motivo (vacío, importada, duplicado, casi igual, género inexistente)
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales('nombre vacío',
  pruebas.motivo_error($$select public.create_catalog_species('   ', pruebas.genero('Vanda'), 'species')$$),
  '22023 name_required');
select pruebas.iguales('sin tipo',
  pruebas.motivo_error($$select public.create_catalog_species('Vanda tricolor', pruebas.genero('Vanda'), null)$$),
  '22023 type_required');
select pruebas.iguales('sin estado',
  pruebas.motivo_error($$select public.create_catalog_species('Vanda tricolor', pruebas.genero('Vanda'), 'species', null)$$),
  '22023 status_required');
select pruebas.iguales('importada',
  pruebas.motivo_error($$select public.create_catalog_species('Vanda tricolor', pruebas.genero('Vanda'), 'species', 'imported')$$),
  '22023 invalid_status');
select pruebas.iguales('mismo nombre con otras mayúsculas y espacios',
  pruebas.motivo_error($$select public.create_catalog_species(' cattleya  LABIATA', pruebas.genero('Cattleya'), 'species')$$, 'existing_name'),
  '23505 duplicate_name Cattleya labiata');
select pruebas.iguales('solo cambia el signo de híbrido',
  pruebas.motivo_error($$select public.create_catalog_species('Cattleya × labiata', pruebas.genero('Cattleya'), 'hybrid')$$, 'existing_name'),
  '23505 similar_name Cattleya labiata');
select pruebas.iguales('solo cambian las tildes',
  pruebas.motivo_error($$select public.create_catalog_species('Cattleya labiatá', pruebas.genero('Cattleya'), 'species')$$, 'existing_name'),
  '23505 similar_name Cattleya labiata');
select pruebas.iguales('el motivo trae el id de la que ya existe',
  pruebas.motivo_error($$select public.create_catalog_species('cattleya labiata', pruebas.genero('Cattleya'), 'species')$$, 'existing_id'),
  '23505 duplicate_name ' || pruebas.especie('Cattleya labiata'));
select pruebas.iguales('género inexistente',
  pruebas.motivo_error($$select public.create_catalog_species('Vanda tricolor', gen_random_uuid(), 'species')$$),
  '23503 genus_not_found');
select pruebas.iguales('ninguna alta', (select count(*) from public.species where source = 'curated'), 1::bigint);

-- prueba: edición: una importada a la que se cambian los datos pasa a validada y conserva la fuente
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'nombre corregido, importada',
  (select row(s.scientific_name, s.status, s.source, s.source_ref)::text
     from public.update_catalog_species(pruebas.especie('Cattleya labiata'), 'Cattleya  labiata  ', pruebas.genero('Cattleya'), 'hybrid', 'imported') s),
  '("Cattleya labiata",validated,col,3Z4W1)'
);
select pruebas.iguales(
  'datos cambiados eligiendo observada: se respeta',
  (select s.status::text
     from public.update_catalog_species(pruebas.especie('Cattleya purpurata'), 'Cattleya purpurata', pruebas.genero('Cattleya'), 'hybrid', 'observed') s),
  'observed'
);
select pruebas.iguales(
  'solo el estado, de observada a importada: se respeta',
  (select s.status::text
     from public.update_catalog_species(pruebas.especie('Cattleya purpurata'), 'Cattleya purpurata', pruebas.genero('Cattleya'), 'hybrid', 'imported') s),
  'imported'
);
select pruebas.iguales(
  'sin cambiar nada: sigue importada',
  (select s.status::text
     from public.update_catalog_species(pruebas.especie('Phalaenopsis amabilis'), 'Phalaenopsis amabilis', pruebas.genero('Phalaenopsis'), 'species', 'imported') s),
  'imported'
);
select pruebas.iguales(
  'una validada sigue validada',
  (select s.status::text
     from public.update_catalog_species(pruebas.especie('Phalaenopsis aphrodite'), 'Phalaenopsis aphrodite', pruebas.genero('Phalaenopsis'), 'hybrid', 'validated') s),
  'validated'
);

-- prueba: edición: el disparador valida también una escritura directa por la API, pero no la importación
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
update public.species set type = 'hybrid' where scientific_name = 'Cattleya labiata';
update public.species set status = 'observed' where scientific_name = 'Vanda coerulea';
update public.species set status = 'imported', type = 'hybrid' where scientific_name = 'Vanda coerulea';
select pruebas.iguales(
  'escritura directa de un administrador',
  (select string_agg(scientific_name || ':' || status, ', ' order by scientific_name)
     from public.species where scientific_name in ('Cattleya labiata', 'Vanda coerulea')),
  -- Vanda coerulea no era importada antes de la segunda sentencia: volver a importada con otro
  -- tipo no la valida (el disparador solo mira una importada que sigue importada).
  'Cattleya labiata:validated, Vanda coerulea:imported'
);
-- La importación escribe con conexión directa como postgres, sin token.
reset role;
reset request.jwt.claims;
update public.species set genus_id = pruebas.genero('Cattleya'), scientific_name = 'Cattleya × intermedia'
  where scientific_name = 'Phalaenopsis × intermedia';
select pruebas.iguales(
  'la importación no valida nada',
  (select status::text from public.species where scientific_name = 'Cattleya × intermedia'),
  'imported'
);

-- prueba: edición: errores con su motivo, y el nombre solo se compara si cambia
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales('no existe',
  pruebas.motivo_error($$select public.update_catalog_species(gen_random_uuid(), 'Vanda x', pruebas.genero('Vanda'), 'species', 'validated')$$),
  'P0002 species_not_found');
select pruebas.iguales('nombre vacío',
  pruebas.motivo_error($$select public.update_catalog_species(pruebas.especie('Vanda coerulea'), '', pruebas.genero('Vanda'), 'species', 'validated')$$),
  '22023 name_required');
select pruebas.iguales('nombre de otra',
  pruebas.motivo_error($$select public.update_catalog_species(pruebas.especie('Vanda coerulea'), 'PHALAENOPSIS AMABILIS', pruebas.genero('Vanda'), 'species', 'validated')$$, 'existing_name'),
  '23505 duplicate_name Phalaenopsis amabilis');
select pruebas.iguales('casi igual a otra',
  pruebas.motivo_error($$select public.update_catalog_species(pruebas.especie('Vanda coerulea'), 'Phalaenopsis × amabilis', pruebas.genero('Vanda'), 'species', 'validated')$$, 'existing_name'),
  '23505 similar_name Phalaenopsis amabilis');
select pruebas.iguales('género inexistente',
  pruebas.motivo_error($$select public.update_catalog_species(pruebas.especie('Vanda coerulea'), 'Vanda coerulea', gen_random_uuid(), 'species', 'validated')$$),
  '23503 genus_not_found');
select pruebas.iguales('sin estado',
  pruebas.motivo_error($$select public.update_catalog_species(pruebas.especie('Vanda coerulea'), 'Vanda coerulea', pruebas.genero('Vanda'), 'species', null)$$),
  '22023 status_required');
-- El par de la fuente que solo se diferencia en el signo: cambiarle el estado funciona.
select pruebas.iguales(
  'cambiar el estado de una especie con un par casi igual',
  (select s.status::text
     from public.update_catalog_species(pruebas.especie('Phalaenopsis intermedia'), 'Phalaenopsis intermedia', pruebas.genero('Phalaenopsis'), 'species', 'observed') s),
  'observed'
);
-- Corregir solo las mayúsculas de su propio nombre no choca consigo misma.
select pruebas.iguales(
  'mayúsculas del propio nombre',
  (select s.scientific_name
     from public.update_catalog_species(pruebas.especie('Vanda coerulea'), 'Vanda Coerulea', pruebas.genero('Vanda'), 'species', 'validated') s),
  'Vanda Coerulea'
);

-- prueba: edición: cambiar el género o el tipo se propaga a las plantas de todos los usuarios, y count_species_plants lo anticipa
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales('plantas afectadas',
  public.count_species_plants(pruebas.especie('Phalaenopsis amabilis')), 2::bigint);
select public.update_catalog_species(
  pruebas.especie('Phalaenopsis amabilis'), 'Phalaenopsis amabilis', pruebas.genero('Dendrobium'), 'hybrid', 'imported');
reset role;
select pruebas.iguales(
  'plantas de user_a y user_b con el género y el tipo nuevos',
  (select string_agg(p.user_id || ':' || g.name || ':' || p.type, ', ' order by p.user_id)
     from public.plants p join public.genera g on g.id = p.genus_id
     where p.species_id = pruebas.especie('Phalaenopsis amabilis')),
  'user_a:Dendrobium:hybrid, user_b:Dendrobium:hybrid'
);
select pruebas.iguales('y la especie queda validada',
  (select status::text from public.species where scientific_name = 'Phalaenopsis amabilis'), 'validated');
select pruebas.iguales('la otra planta no cambia',
  (select g.name from public.plants p join public.genera g on g.id = p.genus_id where p.entered_name = 'La de la ventana'),
  'Cattleya');

-- prueba: lote: cambia el estado de todas, cuenta solo las que cambian y no toca updated_at de las demás
-- Fecha antigua en todas, sin el disparador que la pone al día, para ver cuáles cambian.
alter table public.species disable trigger set_updated_at;
update public.species set updated_at = '2026-01-01' where true;
alter table public.species enable trigger set_updated_at;
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'cambiadas',
  public.set_catalog_species_status(
    array[pruebas.especie('Cattleya labiata'), pruebas.especie('Cattleya purpurata'),
          pruebas.especie('Phalaenopsis aphrodite'), pruebas.especie('Cattleya labiata')],
    'validated'),
  2
);
select pruebas.iguales(
  'estados y updated_at',
  (select string_agg(scientific_name || ':' || status || ':' || (updated_at > '2026-01-01'), ', ' order by scientific_name)
     from public.species
     where scientific_name in ('Cattleya labiata', 'Cattleya purpurata', 'Phalaenopsis aphrodite', 'Vanda coerulea')),
  'Cattleya labiata:validated:true, Cattleya purpurata:validated:true, '
  'Phalaenopsis aphrodite:validated:false, Vanda coerulea:observed:false'
);
select pruebas.iguales(
  'volver a importada vale',
  public.set_catalog_species_status(array[pruebas.especie('Cattleya labiata')], 'imported'),
  1
);

-- prueba: lote: todas o ninguna, vacío, más de 100 y sin estado
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales('una que no existe',
  pruebas.motivo_error($$select public.set_catalog_species_status(
    array[pruebas.especie('Cattleya labiata'), gen_random_uuid(), gen_random_uuid()], 'observed')$$, 'missing_count'),
  'P0002 species_not_found 2');
select pruebas.iguales('ninguna cambió',
  (select status::text from public.species where scientific_name = 'Cattleya labiata'), 'imported');
select pruebas.iguales('vacío',
  pruebas.motivo_error($$select public.set_catalog_species_status(array[]::uuid[], 'observed')$$),
  '22023 no_species');
select pruebas.iguales('nulo',
  pruebas.motivo_error($$select public.set_catalog_species_status(null, 'observed')$$),
  '22023 no_species');
select pruebas.iguales('más de 100',
  pruebas.motivo_error($$select public.set_catalog_species_status(
    array(select gen_random_uuid() from generate_series(1, 101)), 'observed')$$, 'max'),
  '22023 too_many_species 100');
select pruebas.iguales('sin estado',
  pruebas.motivo_error($$select public.set_catalog_species_status(array[pruebas.especie('Cattleya labiata')], null)$$),
  '22023 status_required');

-- prueba: baja: sin plantas se borra con sus nombres; con plantas no se borra nada y se dice cuántas
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales('con plantas',
  pruebas.motivo_error($$select public.delete_catalog_species(pruebas.especie('Phalaenopsis amabilis'))$$, 'plant_count'),
  '23503 species_has_plants 2');
select pruebas.iguales('sigue en el catálogo',
  (select count(*) from public.species where scientific_name = 'Phalaenopsis amabilis'), 1::bigint);
select public.delete_catalog_species(pruebas.especie('Cattleya purpurata'));
select pruebas.iguales('borrada con sus nombres',
  (select row((select count(*) from public.species where scientific_name = 'Cattleya purpurata'),
              (select count(*) from public.species_names where name in ('Laelia purpurata', 'flor de la reina')))::text),
  '(0,0)');
select pruebas.iguales('la búsqueda ya no la encuentra',
  (select count(*) from public.search_species('laelia purpurata')), 0::bigint);
select pruebas.iguales('no existe',
  pruebas.motivo_error($$select public.delete_catalog_species(gen_random_uuid())$$),
  'P0002 species_not_found');
