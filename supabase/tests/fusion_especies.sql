-- Fusión de especies (issue #135, parte de #21): la memoria public.species_merge_keys,
-- private.species_merge_plan(), public.preview_species_merge() y public.merge_species(), de la
-- migración 20261121160000_fusion_de_especies.sql.
--
-- Las llamadas se hacen como authenticated con el claim app_role = catalog_admin, igual que el
-- backoffice. Las plantas, la memoria y la auditoría se leen como postgres ("set local role
-- postgres"), salvo en las pruebas de permisos. Cada llamada a la API es una transacción; aquí se
-- simula el final de una vaciando el ajuste orki.catalog_action_id (como en auditoria.sql). Los
-- nombres inventados se señalan con "ficticio".

-- Datos de partida, sin token (no dejan auditoría): Doritis pulcherrima, importada de COL, se
-- fusionará en Phalaenopsis pulcherrima, también importada; las dos tienen sinónimos y nombres
-- comunes que se repiten tras normalizar, y plantas de dos usuarios.
insert into public.genera (name) values ('Doritis');

insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
values
  ('Doritis pulcherrima', pruebas.genero('Doritis'), 'species', 'imported', 'col', 'DPUL1'),
  ('Phalaenopsis pulcherrima', pruebas.genero('Phalaenopsis'), 'species', 'imported', 'col', 'PPUL1'),
  ('Phalaenopsis tetraspis', pruebas.genero('Phalaenopsis'), 'species', 'validated', 'col', 'PTET1'),
  ('Phalaenopsis Sogo Yukidian', pruebas.genero('Phalaenopsis'), 'hybrid', 'validated', 'curated', 'HIB-0001'),
  ('Vanda coerulea', pruebas.genero('Vanda'), 'species', 'observed', 'col', '6VX01'),
  -- ficticio: dada de alta a mano, sin referencia de fuente.
  ('Vanda ficticia', pruebas.genero('Vanda'), 'species', 'validated', 'curated', null);

insert into public.species_names (species_id, name, type, language)
values
  (pruebas.especie('Doritis pulcherrima'), 'Doritis buyssoniana', 'synonym', null),
  -- Igual que el nombre científico de la conservada.
  (pruebas.especie('Doritis pulcherrima'), 'Phalaenopsis pulcherrima', 'synonym', null),
  -- Igual que un sinónimo de la conservada, con otras mayúsculas.
  (pruebas.especie('Doritis pulcherrima'), 'DORITIS ESMERALDA', 'synonym', null),
  -- Dos nombres comunes que solo cambian en la tilde y las mayúsculas.
  (pruebas.especie('Doritis pulcherrima'), 'orquídea joya', 'common', 'es'),
  (pruebas.especie('Doritis pulcherrima'), 'Orquidea Joya', 'common', 'en'),
  (pruebas.especie('Phalaenopsis pulcherrima'), 'Doritis esmeralda', 'synonym', null),
  (pruebas.especie('Phalaenopsis pulcherrima'), 'Phalaenopsis esmeralda', 'synonym', null);

insert into public.profiles (id) values ('user_a'), ('user_b');
insert into public.plants (user_id, entered_name, species_id)
values
  ('user_a', 'Mi doritis', pruebas.especie('Doritis pulcherrima')),
  ('user_b', 'Regalo de mamá', pruebas.especie('Doritis pulcherrima')),
  ('user_b', 'La de la ventana', pruebas.especie('Phalaenopsis pulcherrima'));

-- Fin de una petición a la API.
create function pg_temp.fin_de_peticion()
returns void
language sql
as $$
  select set_config('orki.catalog_action_id', '', true)
$$;

-- Los nombres alternativos de una especie, en una línea: nombre:tipo[:idioma], en orden.
create function pg_temp.nombres(especie text)
returns text
language sql
as $$
  select coalesce(string_agg(n.name || ':' || n.type || coalesce(':' || n.language, ''), ', '
                             order by n.name collate "C"), 'ninguno')
  from public.species_names n
  join public.species s on s.id = n.species_id
  where s.scientific_name = especie
$$;

-- Las plantas, en una línea: usuario/nombre ingresado → especie (género, tipo, validación).
-- Se llama como postgres (RLS oculta las plantas de otros usuarios).
create function pg_temp.plantas()
returns text
language sql
as $$
  select string_agg(
           p.user_id || '/' || p.entered_name || ' → ' || coalesce(s.scientific_name, '-')
             || ' (' || g.name || ', ' || p.type || ', ' || p.validation || ')',
           ', ' order by p.user_id, p.entered_name)
  from public.plants p
  join public.genera g on g.id = p.genus_id
  left join public.species s on s.id = p.species_id
$$;

-- La memoria de las fusiones, en una línea: fuente/clave → especie (nombre absorbido).
create function pg_temp.memoria()
returns text
language sql
as $$
  select coalesce(string_agg(
           k.source || '/' || k.source_ref || ' → ' || s.scientific_name
             || ' (' || k.merged_scientific_name || ')',
           ', ' order by k.source, k.source_ref), 'vacía')
  from public.species_merge_keys k
  join public.species s on s.id = k.species_id
$$;

-- Una lista de nombres de la vista previa (moved_names o existing_names) en una línea.
create function pg_temp.lista(nombres jsonb)
returns text
language sql
as $$
  select coalesce(string_agg(
           (e ->> 'name') || ':' || (e ->> 'type') || ':' || (e ->> 'origin')
             || coalesce(':' || (e ->> 'language'), '')
             || coalesce(' ' || (e ->> 'reason') || ' ' || (e ->> 'existing_name') || ':' || (e ->> 'existing_type'), ''),
           ', ' order by o.n), 'ninguno')
  from jsonb_array_elements(nombres) with ordinality o (e, n)
$$;

-- El historial de una especie en una línea por entrada (como en historial_especie.sql).
create function pg_temp.historial(especie uuid)
returns text
language sql
as $$
  select coalesce(string_agg(
           coalesce(h.action, '-') || ' ['
             || coalesce((select string_agg((c ->> 'table_name') || ':' || (c ->> 'action'), ', '
                                           order by (c ->> 'table_name') || ':' || (c ->> 'action') collate "C")
                            from jsonb_array_elements(h.changes) c), '')
             || ']'
             || case when h.other_change_count > 0 then ' +' || h.other_change_count else '' end,
           ' | ' order by h.entry_id desc), 'nada')
  from public.species_history(especie) h
$$;

-- Todo lo que la fusión puede cambiar, en un texto. Se llama como postgres.
create function pg_temp.foto()
returns text
language sql
as $$
  select concat_ws(' || ',
    (select string_agg(s.scientific_name || ':' || s.status || ':' || s.genus_id, ', ' order by s.scientific_name)
       from public.species s),
    (select string_agg(n.species_id || ':' || n.name || ':' || n.type, ', ' order by n.id) from public.species_names n),
    (select string_agg(p.id || ':' || p.species_id || ':' || p.genus_id || ':' || p.type || ':' || p.updated_at, ', ' order by p.id)
       from public.plants p),
    pg_temp.memoria(),
    (select count(*)::text from public.catalog_audit_log)
  )
$$;

-- Desde el #283, las funciones que crea postgres no nacen ejecutables por PUBLIC: las de
-- ayuda de este archivo se abren a mano para poder llamarlas con otros roles.
grant execute on all functions in schema pg_temp to public;

-- prueba: permisos: anon, un usuario sin rol, otro rol y la clave de servicio reciben 42501 y nada cambia
set local role postgres;
select pg_temp.foto() as antes \gset
do $$
declare
  peticion text[];
  sentencia text;
begin
  foreach peticion slice 1 in array array[
    array['anon', '{"role": "anon"}'],
    array['anon', '{"role": "anon", "app_role": "catalog_admin"}'],
    array['authenticated', '{"sub": "user_a", "role": "authenticated"}'],
    array['authenticated', '{"sub": "user_a", "role": "authenticated", "app_role": "admin"}'],
    array['service_role', '{"role": "service_role"}']
  ] loop
    execute format('set local role %I', peticion[1]);
    perform set_config('request.jwt.claims', peticion[2], true);
    foreach sentencia in array array[
      $q$select * from public.preview_species_merge(pruebas.especie('Doritis pulcherrima'), pruebas.especie('Phalaenopsis pulcherrima'))$q$,
      $q$select * from public.merge_species(pruebas.especie('Doritis pulcherrima'), pruebas.especie('Phalaenopsis pulcherrima'))$q$,
      -- Con ids que no existen: el rol se comprueba antes que nada.
      $q$select * from public.merge_species(gen_random_uuid(), gen_random_uuid())$q$
    ] loop
      perform pruebas.debe_fallar(peticion[1] || ' ' || peticion[2] || ': ' || sentencia, sentencia, '42501');
    end loop;
    reset role;
  end loop;
end;
$$;
set local role postgres;
select pruebas.iguales('nada cambió', pg_temp.foto(), :'antes');

-- prueba: propiedades: solo authenticated las ejecuta, definer, search_path vacío y el guardián primero
select pruebas.iguales(
  'quién puede ejecutarlas',
  (select string_agg(f.firma || ':' || r.rol, ', ' order by f.firma, r.rol)
     from (values
       ('public.preview_species_merge(uuid, uuid)'),
       ('public.merge_species(uuid, uuid)'),
       ('private.species_merge_plan(uuid, uuid)')
     ) f (firma)
     cross join (values ('anon'), ('authenticated'), ('service_role')) r (rol)
     where has_function_privilege(r.rol, f.firma, 'execute')),
  'public.merge_species(uuid, uuid):authenticated, public.preview_species_merge(uuid, uuid):authenticated'
);
select pruebas.iguales(
  'security definer, search_path y guardián',
  (select string_agg(p.proname || ' definer=' || p.prosecdef || ' ' || array_to_string(p.proconfig, ',')
                       || ' guardián=' || pruebas.llama_primero_al_guardian('plpgsql', p.prosrc), '; ' order by p.proname)
     from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('preview_species_merge', 'merge_species')),
  'merge_species definer=true search_path="" guardián=true; '
  'preview_species_merge definer=true search_path="" guardián=true'
);
select pruebas.iguales('la vista previa no escribe', (select provolatile from pg_proc where oid = 'public.preview_species_merge(uuid, uuid)'::regprocedure), 's'::"char");

-- prueba: memoria: RLS, solo leen authenticated y service_role, y la política exige el rol
select pruebas.comprobar(
  'RLS activada',
  (select c.relrowsecurity from pg_class c where c.oid = 'public.species_merge_keys'::regclass)
);
select pruebas.iguales(
  'privilegios sobre la tabla',
  (select string_agg(r.rol || ':' || p.privilegio, ', ' order by r.rol, p.privilegio)
     from (values ('anon'), ('authenticated'), ('service_role')) r (rol)
     cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p (privilegio)
     where has_table_privilege(r.rol, 'public.species_merge_keys', p.privilegio)),
  'authenticated:SELECT, service_role:SELECT'
);
select pruebas.iguales(
  'políticas',
  (select string_agg(p.policyname || ':' || p.cmd || ':' || array_to_string(p.roles, ','), ', ')
     from pg_policies p
     where p.schemaname = 'public' and p.tablename = 'species_merge_keys'),
  'species_merge_keys_select_catalog_admin:SELECT:authenticated'
);

-- prueba: memoria: el administrador la lee; un usuario sin rol no ve nada y anon no puede leerla
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select * from public.merge_species(pruebas.especie('Doritis pulcherrima'), pruebas.especie('Phalaenopsis pulcherrima'));
select pruebas.iguales('filas que ve el administrador', (select count(*) from public.species_merge_keys), 1::bigint);
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.iguales('filas que ve un usuario sin rol', (select count(*) from public.species_merge_keys), 0::bigint);
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated", "app_role": "admin"}';
select pruebas.iguales('filas que ve otro valor de app_role', (select count(*) from public.species_merge_keys), 0::bigint);
set local role anon;
set local request.jwt.claims = '{"role": "anon", "app_role": "catalog_admin"}';
select pruebas.debe_fallar('anon la lee', $$select count(*) from public.species_merge_keys$$, '42501');

-- prueba: memoria: nadie inserta, edita, borra ni vacía la memoria por la API, tenga o no el rol
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select * from public.merge_species(pruebas.especie('Doritis pulcherrima'), pruebas.especie('Phalaenopsis pulcherrima'));
do $$
declare
  peticion text[];
  sentencia text;
begin
  foreach peticion slice 1 in array array[
    array['anon', '{"role": "anon"}'],
    array['anon', '{"role": "anon", "app_role": "catalog_admin"}'],
    array['authenticated', '{"sub": "user_a", "role": "authenticated"}'],
    array['authenticated', '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}'],
    array['service_role', '{"role": "service_role"}']
  ] loop
    execute format('set local role %I', peticion[1]);
    perform set_config('request.jwt.claims', peticion[2], true);
    foreach sentencia in array array[
      $q$insert into public.species_merge_keys (source, source_ref, species_id, merged_species_id, merged_scientific_name, merged_by, action_id)
         values ('col', 'FICTICIA', pruebas.especie('Vanda coerulea'), gen_random_uuid(), 'Vanda ficticia', 'user_a', gen_random_uuid())$q$,
      $q$update public.species_merge_keys set species_id = pruebas.especie('Vanda coerulea')$q$,
      $q$delete from public.species_merge_keys$q$,
      $q$truncate public.species_merge_keys$q$
    ] loop
      perform pruebas.debe_fallar(peticion[1] || ' ' || peticion[2] || ': ' || sentencia, sentencia, '42501');
    end loop;
    reset role;
  end loop;
end;
$$;
set local role postgres;
select pruebas.iguales('la memoria no cambió', pg_temp.memoria(), 'col/DPUL1 → Phalaenopsis pulcherrima (Doritis pulcherrima)');

-- prueba: vista previa: plantas, nombres que pasan y que ya existían, diferencias, validación y claves, sin cambiar nada
set local role postgres;
select pg_temp.foto() as antes \gset
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select * from public.preview_species_merge(pruebas.especie('Doritis pulcherrima'), pruebas.especie('Phalaenopsis pulcherrima')) \gset vista_
select pruebas.iguales(
  'la absorbida',
  concat_ws(' ', :'vista_merged_scientific_name', :'vista_merged_genus_name', :'vista_merged_type',
            :'vista_merged_status', :'vista_merged_source', :'vista_merged_source_ref',
            :'vista_merged_genus_id' = pruebas.genero('Doritis')::text),
  'Doritis pulcherrima Doritis species imported col DPUL1 t'
);
select pruebas.iguales(
  'la conservada',
  concat_ws(' ', :'vista_kept_scientific_name', :'vista_kept_genus_name', :'vista_kept_type', :'vista_kept_status',
            :'vista_kept_genus_id' = pruebas.genero('Phalaenopsis')::text),
  'Phalaenopsis pulcherrima Phalaenopsis species imported t'
);
select pruebas.iguales('plantas que se mueven (de dos usuarios)', :'vista_plant_count'::bigint, 2::bigint);
select pruebas.iguales(
  'nombres que pasan',
  pg_temp.lista(:'vista_moved_names'),
  'Doritis pulcherrima:synonym:scientific_name, Doritis buyssoniana:synonym:synonym, Orquidea Joya:common:common:en'
);
select pruebas.iguales(
  'nombres que ya existían',
  pg_temp.lista(:'vista_existing_names'),
  'DORITIS ESMERALDA:synonym:synonym already_in_kept Doritis esmeralda:synonym, '
  'Phalaenopsis pulcherrima:synonym:synonym already_in_kept Phalaenopsis pulcherrima:scientific_name, '
  'orquídea joya:common:common:es repeated_in_merged Orquidea Joya:common'
);
select pruebas.iguales(
  'diferencias y validación',
  concat_ws(' ', :'vista_genus_differs', :'vista_type_differs', :'vista_kept_becomes_validated'),
  't f t'
);
select pruebas.iguales(
  'claves que se recordarán',
  :'vista_remembered_keys'::jsonb,
  '[{"source": "col", "source_ref": "DPUL1", "inherited": false}]'::jsonb
);
set local role postgres;
select pruebas.iguales('no cambió nada', pg_temp.foto(), :'antes');

-- prueba: vista previa: señala un tipo distinto, y una conservada validada no cambia de estado
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'híbrido en especie del mismo género',
  (select concat_ws(' ', v.genus_differs, v.type_differs, v.kept_becomes_validated, v.plant_count, v.remembered_keys::text)
     from public.preview_species_merge(pruebas.especie('Phalaenopsis Sogo Yukidian'), pruebas.especie('Phalaenopsis tetraspis')) v),
  'f t f 0 [{"source": "curated", "inherited": false, "source_ref": "HIB-0001"}]'
);
select pruebas.iguales(
  'especie sin referencia: no hay clave que recordar',
  (select v.remembered_keys::text || ' ' || pg_temp.lista(v.moved_names)
     from public.preview_species_merge(pruebas.especie('Vanda ficticia'), pruebas.especie('Vanda coerulea')) v),
  '[] Vanda ficticia:synonym:scientific_name'
);

-- prueba: rechazos con su motivo: la misma especie, una especie que no existe y un id nulo
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales('fusionar consigo misma',
  pruebas.motivo_error($$select * from public.merge_species(pruebas.especie('Vanda coerulea'), pruebas.especie('Vanda coerulea'))$$),
  '22023 same_species');
select pruebas.iguales('vista previa consigo misma',
  pruebas.motivo_error($$select * from public.preview_species_merge(pruebas.especie('Vanda coerulea'), pruebas.especie('Vanda coerulea'))$$),
  '22023 same_species');
select pruebas.iguales('la absorbida no existe',
  pruebas.motivo_error($$select * from public.merge_species(gen_random_uuid(), pruebas.especie('Vanda coerulea'))$$, 'species_role'),
  'P0002 species_not_found merged');
select pruebas.iguales('la conservada no existe',
  pruebas.motivo_error($$select * from public.merge_species(pruebas.especie('Vanda coerulea'), gen_random_uuid())$$, 'species_role'),
  'P0002 species_not_found kept');
select pruebas.iguales('vista previa: la conservada no existe',
  pruebas.motivo_error($$select * from public.preview_species_merge(pruebas.especie('Vanda coerulea'), gen_random_uuid())$$, 'species_role'),
  'P0002 species_not_found kept');
select pruebas.iguales('id nulo',
  pruebas.motivo_error($$select * from public.merge_species(null, pruebas.especie('Vanda coerulea'))$$, 'species_role'),
  'P0002 species_not_found merged');
select pruebas.iguales('los dos nulos',
  pruebas.motivo_error($$select * from public.merge_species(null, null)$$, 'species_role'),
  'P0002 species_not_found merged');
set local role postgres;
select pruebas.iguales('nada en la auditoría', (select count(*) from public.catalog_audit_log), 0::bigint);

-- prueba: fusión: las plantas de los dos usuarios pasan a la conservada con su género y su tipo, sin tocar el nombre ingresado
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select * from public.merge_species(pruebas.especie('Doritis pulcherrima'), pruebas.especie('Phalaenopsis pulcherrima')) \gset fusion_
select pruebas.iguales(
  'resultado',
  concat_ws(' ', :'fusion_plant_count', :'fusion_moved_name_count', :'fusion_skipped_name_count', :'fusion_kept_validated'),
  '2 3 3 t'
);
select pruebas.iguales(
  'claves recordadas',
  :'fusion_remembered_keys'::jsonb,
  '[{"source": "col", "source_ref": "DPUL1", "inherited": false}]'::jsonb
);
set local role postgres;
select pruebas.iguales(
  'plantas',
  pg_temp.plantas(),
  'user_a/Mi doritis → Phalaenopsis pulcherrima (Phalaenopsis, species, validated), '
  'user_b/La de la ventana → Phalaenopsis pulcherrima (Phalaenopsis, species, validated), '
  'user_b/Regalo de mamá → Phalaenopsis pulcherrima (Phalaenopsis, species, validated)'
);
select pruebas.iguales(
  'ninguna planta apunta a una especie que no existe',
  (select count(*) from public.plants p
     where p.species_id is not null and not exists (select from public.species s where s.id = p.species_id)),
  0::bigint
);
select pruebas.iguales(
  'todas tienen el género y el tipo de su especie',
  (select count(*) from public.plants p join public.species s on s.id = p.species_id
     where p.genus_id <> s.genus_id or p.type::text <> s.type::text),
  0::bigint
);
select pruebas.comprobar('la absorbida ya no existe',
  not exists (select from public.species where scientific_name = 'Doritis pulcherrima'));
select pruebas.iguales('ni sus nombres que no pasaron',
  (select count(*) from public.species_names n where not exists (select from public.species s where s.id = n.species_id)),
  0::bigint);

-- prueba: fusión: los nombres pasan sin duplicar y el nombre científico absorbido queda como sinónimo; la conservada queda validada
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select n.id as id_buyssoniana from public.species_names n where n.name = 'Doritis buyssoniana' \gset
select * from public.merge_species(pruebas.especie('Doritis pulcherrima'), pruebas.especie('Phalaenopsis pulcherrima'));
select pruebas.iguales(
  'nombres de la conservada',
  pg_temp.nombres('Phalaenopsis pulcherrima'),
  'Doritis buyssoniana:synonym, Doritis esmeralda:synonym, Doritis pulcherrima:synonym, '
  'Orquidea Joya:common:en, Phalaenopsis esmeralda:synonym'
);
select pruebas.iguales('un nombre que pasa conserva su fila',
  (select n.species_id from public.species_names n where n.id = :'id_buyssoniana'),
  pruebas.especie('Phalaenopsis pulcherrima'));
select pruebas.iguales(
  'estado y fuente de la conservada',
  (select s.status || ' ' || s.source || ' ' || s.source_ref from public.species s where s.scientific_name = 'Phalaenopsis pulcherrima'),
  'validated col PPUL1'
);

-- prueba: búsqueda: el nombre absorbido y sus sinónimos encuentran la conservada
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select * from public.merge_species(pruebas.especie('Doritis pulcherrima'), pruebas.especie('Phalaenopsis pulcherrima'));
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.iguales(
  'Doritis pulcherrima',
  (select r.scientific_name || ' por ' || r.matched_name || ':' || r.matched_name_type
     from public.search_species('Doritis pulcherrima') r limit 1),
  'Phalaenopsis pulcherrima por Doritis pulcherrima:synonym'
);
select pruebas.iguales(
  'abreviado y con errores',
  (select string_agg(distinct r.scientific_name, ', ') from public.search_species('dor pulcherima') r),
  'Phalaenopsis pulcherrima'
);
select pruebas.iguales(
  'un sinónimo que pasó',
  (select string_agg(r.scientific_name, ', ') from public.search_species('doritis buyss') r),
  'Phalaenopsis pulcherrima'
);

-- prueba: memoria: la clave de la absorbida apunta a la conservada, con quién, cuándo y la acción
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.especie('Doritis pulcherrima') as id_doritis \gset
select * from public.merge_species(:'id_doritis', pruebas.especie('Phalaenopsis pulcherrima')) \gset fusion_
set local role postgres;
select pruebas.iguales(
  'fila de la memoria',
  (select row(k.source, k.source_ref, k.species_id = pruebas.especie('Phalaenopsis pulcherrima'),
              k.merged_species_id = :'id_doritis', k.merged_scientific_name, k.merged_by,
              k.merged_at = now(), k.action_id = :'fusion_action_id')::text
     from public.species_merge_keys k),
  '(col,DPUL1,t,t,"Doritis pulcherrima",user_admin,t,t)'
);
select pruebas.iguales(
  'la importación la encuentra por su clave',
  (select s.scientific_name from public.species_merge_keys k join public.species s on s.id = k.species_id
     where k.source = 'col' and k.source_ref = 'DPUL1'),
  'Phalaenopsis pulcherrima'
);

-- prueba: cadena: A en B y después B en C deja las claves de A y de B en C
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select * from public.merge_species(pruebas.especie('Doritis pulcherrima'), pruebas.especie('Phalaenopsis pulcherrima')) \gset primera_
select pg_temp.fin_de_peticion();
select pruebas.iguales(
  'la vista previa de la segunda muestra la clave heredada',
  (select v.remembered_keys from public.preview_species_merge(pruebas.especie('Phalaenopsis pulcherrima'), pruebas.especie('Phalaenopsis tetraspis')) v),
  '[{"source": "col", "source_ref": "PPUL1", "inherited": false}, {"source": "col", "source_ref": "DPUL1", "inherited": true}]'::jsonb
);
set local request.jwt.claims = '{"sub": "user_admin_2", "role": "authenticated", "app_role": "catalog_admin"}';
select * from public.merge_species(pruebas.especie('Phalaenopsis pulcherrima'), pruebas.especie('Phalaenopsis tetraspis')) \gset segunda_
select pruebas.iguales(
  'claves de la segunda',
  :'segunda_remembered_keys'::jsonb,
  '[{"source": "col", "source_ref": "PPUL1", "inherited": false}, {"source": "col", "source_ref": "DPUL1", "inherited": true}]'::jsonb
);
set local role postgres;
select pruebas.iguales(
  'memoria',
  pg_temp.memoria(),
  'col/DPUL1 → Phalaenopsis tetraspis (Doritis pulcherrima), col/PPUL1 → Phalaenopsis tetraspis (Phalaenopsis pulcherrima)'
);
select pruebas.iguales(
  'la clave heredada conserva quién y qué fusión la absorbió',
  (select k.merged_by || ' ' || (k.action_id = :'primera_action_id') from public.species_merge_keys k where k.source_ref = 'DPUL1'),
  'user_admin true'
);
select pruebas.iguales(
  'la nueva, la segunda fusión',
  (select k.merged_by || ' ' || (k.action_id = :'segunda_action_id') from public.species_merge_keys k where k.source_ref = 'PPUL1'),
  'user_admin_2 true'
);
select pruebas.iguales(
  'plantas',
  pg_temp.plantas(),
  'user_a/Mi doritis → Phalaenopsis tetraspis (Phalaenopsis, species, validated), '
  'user_b/La de la ventana → Phalaenopsis tetraspis (Phalaenopsis, species, validated), '
  'user_b/Regalo de mamá → Phalaenopsis tetraspis (Phalaenopsis, species, validated)'
);
select pruebas.iguales(
  'nombres de C',
  pg_temp.nombres('Phalaenopsis tetraspis'),
  'Doritis buyssoniana:synonym, Doritis esmeralda:synonym, Doritis pulcherrima:synonym, '
  'Orquidea Joya:common:en, Phalaenopsis esmeralda:synonym, Phalaenopsis pulcherrima:synonym'
);
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.iguales(
  'la búsqueda del primer nombre absorbido llega a C',
  (select r.scientific_name from public.search_species('Doritis pulcherrima') r limit 1),
  'Phalaenopsis tetraspis'
);

-- prueba: memoria: una clave que ya estaba (la especie se volvió a crear) pasa a la fusión nueva
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select * from public.merge_species(pruebas.especie('Doritis pulcherrima'), pruebas.especie('Phalaenopsis pulcherrima'));
select pg_temp.fin_de_peticion();
-- Una carga sin la memoria la vuelve a crear con su clave.
set local role postgres;
insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
values ('Doritis pulcherrima', pruebas.genero('Doritis'), 'species', 'imported', 'col', 'DPUL1');
set local role authenticated;
select * from public.merge_species(pruebas.especie('Doritis pulcherrima'), pruebas.especie('Phalaenopsis tetraspis')) \gset otra_
set local role postgres;
select pruebas.iguales(
  'memoria',
  pg_temp.memoria(),
  'col/DPUL1 → Phalaenopsis tetraspis (Doritis pulcherrima)'
);
select pruebas.iguales('con la acción nueva',
  (select k.action_id from public.species_merge_keys k), :'otra_action_id'::uuid);

-- prueba: memoria: una especie sin referencia no deja clave, y una de la lista curada de híbridos sí
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'sin referencia',
  (select m.remembered_keys::text from public.merge_species(pruebas.especie('Vanda ficticia'), pruebas.especie('Vanda coerulea')) m),
  '[]'
);
select pg_temp.fin_de_peticion();
select * from public.merge_species(pruebas.especie('Phalaenopsis Sogo Yukidian'), pruebas.especie('Phalaenopsis tetraspis'));
set local role postgres;
select pruebas.iguales('memoria', pg_temp.memoria(), 'curated/HIB-0001 → Phalaenopsis tetraspis (Phalaenopsis Sogo Yukidian)');
select pruebas.iguales('el estado de una conservada validada u observada no cambia',
  (select string_agg(s.scientific_name || ':' || s.status, ', ' order by s.scientific_name)
     from public.species s where s.scientific_name in ('Vanda coerulea', 'Phalaenopsis tetraspis')),
  'Phalaenopsis tetraspis:validated, Vanda coerulea:observed');

-- prueba: memoria: si se borra la conservada, su memoria se va con ella
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select * from public.merge_species(pruebas.especie('Vanda coerulea'), pruebas.especie('Vanda ficticia'));
select pg_temp.fin_de_peticion();
set local role postgres;
select pruebas.iguales('antes de borrar', pg_temp.memoria(), 'col/6VX01 → Vanda ficticia (Vanda coerulea)');
set local role authenticated;
select public.delete_catalog_species(pruebas.especie('Vanda ficticia'));
set local role postgres;
select pruebas.iguales('después', pg_temp.memoria(), 'vacía');

-- prueba: atomicidad: un nombre en conflicto a mitad de la fusión no deja ningún cambio
-- Un índice único creado solo para esta prueba hace fallar el alta del nombre científico
-- absorbido como sinónimo, después de mover las plantas y los nombres.
set local role postgres;
insert into public.species_names (species_id, name, type)
values (pruebas.especie('Vanda coerulea'), 'Doritis pulcherrima', 'synonym');  -- ficticio
create unique index prueba_nombre_en_conflicto on public.species_names (lower(name))
  where lower(name) = 'doritis pulcherrima';
select pg_temp.foto() as antes \gset
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.debe_fallar(
  'la fusión falla',
  $$select * from public.merge_species(pruebas.especie('Doritis pulcherrima'), pruebas.especie('Phalaenopsis pulcherrima'))$$,
  '23505', 'prueba_nombre_en_conflicto'
);
set local role postgres;
select pruebas.iguales('no queda ningún cambio', pg_temp.foto(), :'antes');
select pruebas.iguales('ni en la auditoría', (select count(*) from public.catalog_audit_log), 0::bigint);
select pruebas.iguales('las plantas siguen en la absorbida',
  (select count(*) from public.plants where species_id = pruebas.especie('Doritis pulcherrima')), 2::bigint);

-- prueba: auditoría: la fusión es una sola entrada en el historial de la conservada y en el de la absorbida
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.especie('Doritis pulcherrima') as id_doritis \gset
select pruebas.especie('Phalaenopsis pulcherrima') as id_conservada \gset
select * from public.merge_species(:'id_doritis', :'id_conservada') \gset fusion_
select pruebas.iguales(
  'historial de la conservada',
  pg_temp.historial(:'id_conservada'),
  'merge_species [species:update, species_names:insert, species_names:update, species_names:update] +4'
);
select pruebas.iguales(
  'historial de la absorbida',
  pg_temp.historial(:'id_doritis'),
  'merge_species [species:delete, species_names:delete, species_names:delete, species_names:delete] +4'
);
select pruebas.iguales(
  'la entrada',
  (select concat_ws(' ', h.action_id = :'fusion_action_id', h.actor, h.created_at = now(),
                    h.details ->> 'merged_species_id' = :'id_doritis',
                    h.details ->> 'kept_species_id' = :'id_conservada',
                    h.details ->> 'merged_scientific_name', h.details ->> 'merged_source_ref',
                    h.details ->> 'plant_count', h.details -> 'moved_names', h.details -> 'skipped_names',
                    h.details ->> 'kept_validated')
     from public.species_history(:'id_conservada') h),
  't user_admin t t t Doritis pulcherrima DPUL1 2 '
  '["Doritis pulcherrima", "Doritis buyssoniana", "Orquidea Joya"] '
  '["DORITIS ESMERALDA", "Phalaenopsis pulcherrima", "orquídea joya"] true'
);
set local role postgres;
select pruebas.iguales(
  'una sola acción en toda la auditoría',
  (select string_agg(distinct a.action_id::text, ', ') from public.catalog_audit_log a),
  :'fusion_action_id'
);
select pruebas.iguales(
  'la acción va primero',
  (select a.action from public.catalog_audit_log a order by a.id limit 1),
  'merge_species'
);
