-- Auditoría del catálogo (issue #131, parte de #23): la tabla catalog_audit_log, el disparador
-- audit_change de las cuatro tablas del catálogo y private.log_catalog_action(), de la
-- migración 20261121140000_auditoria_del_catalogo.sql.
--
-- Las escrituras con token se hacen como authenticated con el claim app_role = catalog_admin,
-- igual que el backoffice. Las cargas por script se simulan como postgres sin claims (conexión
-- directa) o con el token de la clave de servicio, que no trae "sub". La auditoría se lee como
-- postgres ("set local role postgres") salvo en las pruebas de permisos. Los nombres
-- inventados se señalan con "ficticio".

-- Datos de partida: especies importadas, una con sus nombres, y una planta enlazada. Se cargan
-- sin token, así que no dejan auditoría.
insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
values
  ('Phalaenopsis amabilis', pruebas.genero('Phalaenopsis'), 'species', 'imported', 'col', '4FR2J'),
  ('Cattleya labiata', pruebas.genero('Cattleya'), 'species', 'imported', 'col', '3Z4W1'),
  ('Cattleya purpurata', pruebas.genero('Cattleya'), 'species', 'imported', 'col', '3Z4W2'),
  ('Vanda coerulea', pruebas.genero('Vanda'), 'species', 'observed', 'col', '6VX01');

insert into public.species_names (species_id, name, type, language)
values
  (pruebas.especie('Cattleya purpurata'), 'Laelia purpurata', 'synonym', null),
  (pruebas.especie('Cattleya purpurata'), 'flor de la reina', 'common', 'es');

insert into public.profiles (id) values ('user_a');
insert into public.plants (user_id, entered_name, species_id)
values ('user_a', 'Mi mariposa', pruebas.especie('Phalaenopsis amabilis'));

-- prueba: las migraciones y los datos de partida (sin token) no dejan auditoría
select pruebas.iguales('filas de auditoría', (select count(*) from public.catalog_audit_log), 0::bigint);

-- prueba: permisos: RLS activada, authenticated y service_role solo leen, anon nada, y la secuencia no es de nadie
select pruebas.comprobar(
  'RLS activada',
  (select c.relrowsecurity from pg_class c where c.oid = 'public.catalog_audit_log'::regclass)
);
select pruebas.iguales(
  'privilegios sobre la tabla',
  (select string_agg(r.rol || ':' || p.privilegio, ', ' order by r.rol, p.privilegio)
     from (values ('anon'), ('authenticated'), ('service_role')) r (rol)
     cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p (privilegio)
     where has_table_privilege(r.rol, 'public.catalog_audit_log', p.privilegio)),
  'authenticated:SELECT, service_role:SELECT'
);
select pruebas.iguales(
  'privilegios sobre la secuencia del id',
  (select string_agg(r.rol || ':' || p.privilegio, ', ')
     from (values ('anon'), ('authenticated'), ('service_role')) r (rol)
     cross join (values ('USAGE'), ('SELECT'), ('UPDATE')) p (privilegio)
     where has_sequence_privilege(r.rol, 'public.catalog_audit_log_id_seq', p.privilegio)),
  null::text
);
select pruebas.iguales(
  'políticas',
  (select string_agg(p.policyname || ':' || p.cmd || ':' || array_to_string(p.roles, ','), ', ')
     from pg_policies p
     where p.schemaname = 'public' and p.tablename = 'catalog_audit_log'),
  'catalog_audit_log_select_catalog_admin:SELECT:authenticated'
);

-- prueba: permisos: solo su dueño ejecuta las funciones de la auditoría
select pruebas.iguales(
  'quién puede ejecutarlas',
  (select string_agg(f.firma || ':' || r.rol, ', ' order by f.firma, r.rol)
     from (values
       ('private.audit_catalog_change()'),
       ('private.current_catalog_action_id()'),
       ('private.log_catalog_action(text, jsonb, text, uuid, text)')
     ) f (firma)
     cross join (values ('anon'), ('authenticated'), ('service_role')) r (rol)
     where has_function_privilege(r.rol, f.firma, 'execute')),
  null::text
);
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.debe_fallar(
  'el administrador llama a log_catalog_action',
  $$select private.log_catalog_action('merge_species')$$,
  '42501'
);

-- prueba: lectura: el administrador lee la auditoría; un usuario sin rol no ve nada y anon no puede leerla
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select public.create_catalog_species('Vanda tricolor', pruebas.genero('Vanda'), 'species');
select pruebas.iguales('filas que ve el administrador', (select count(*) from public.catalog_audit_log), 1::bigint);
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.iguales('filas que ve un usuario sin rol', (select count(*) from public.catalog_audit_log), 0::bigint);
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated", "app_role": "admin"}';
select pruebas.iguales('filas que ve otro valor de app_role', (select count(*) from public.catalog_audit_log), 0::bigint);
set local role anon;
set local request.jwt.claims = '{"role": "anon", "app_role": "catalog_admin"}';
select pruebas.debe_fallar('anon lee la auditoría', $$select count(*) from public.catalog_audit_log$$, '42501');

-- prueba: escritura: nadie inserta, edita, borra ni vacía la auditoría por la API, tenga o no el rol
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select public.create_catalog_species('Vanda tricolor', pruebas.genero('Vanda'), 'species');
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
      $q$insert into public.catalog_audit_log (action_id, actor, action) values (gen_random_uuid(), 'user_a', 'merge_species')$q$,
      $q$update public.catalog_audit_log set actor = 'user_a'$q$,
      $q$delete from public.catalog_audit_log$q$,
      $q$truncate public.catalog_audit_log$q$
    ] loop
      perform pruebas.debe_fallar(peticion[1] || ' ' || peticion[2] || ': ' || sentencia, sentencia, '42501');
    end loop;
    reset role;
  end loop;
end;
$$;
select pruebas.iguales(
  'la auditoría no cambió',
  (select string_agg(a.actor || ':' || a.action || ':' || a.table_name, ', ') from public.catalog_audit_log a),
  'user_admin:insert:species'
);

-- prueba: alta de especie: registra quién, cuándo, la tabla, la fila y la fila entera como valores nuevos
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select (public.create_catalog_species('Vanda tricolor', pruebas.genero('Vanda'), 'species')).id as id_nueva \gset
set local role postgres;
select pruebas.iguales(
  'registro del alta',
  (select row(a.actor, a.action, a.table_name, a.row_id = :'id_nueva', a.old_values is null,
              a.details is null, a.created_at = now())::text
     from public.catalog_audit_log a),
  '(user_admin,insert,species,t,t,t,t)'
);
select pruebas.iguales(
  'valores nuevos: la fila entera',
  (select a.new_values from public.catalog_audit_log a),
  (select to_jsonb(s) from public.species s where s.id = :'id_nueva')
);

-- prueba: edición de especie: solo las columnas que cambian, con sus valores anteriores y nuevos
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
-- Cattleya labiata es importada: cambiarle el nombre la deja validada (validate_edited_imported).
select public.update_catalog_species(
  pruebas.especie('Cattleya labiata'), 'Cattleya labiata var. ficticia', pruebas.genero('Cattleya'), 'species', 'imported'
);
set local role postgres;
select pruebas.iguales(
  'registro de la edición',
  (select row(a.actor, a.action, a.table_name, a.row_id = pruebas.especie('Cattleya labiata var. ficticia'))::text
     from public.catalog_audit_log a),
  '(user_admin,update,species,t)'
);
select pruebas.iguales(
  'valores anteriores',
  (select a.old_values from public.catalog_audit_log a),
  '{"scientific_name": "Cattleya labiata", "status": "imported"}'::jsonb
);
select pruebas.iguales(
  'valores nuevos',
  (select a.new_values from public.catalog_audit_log a),
  '{"scientific_name": "Cattleya labiata var. ficticia", "status": "validated"}'::jsonb
);

-- prueba: una edición que no cambia ningún valor no deja registro (aunque mueva updated_at)
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select public.update_catalog_species(
  pruebas.especie('Vanda coerulea'), 'Vanda coerulea', pruebas.genero('Vanda'), 'species', 'observed'
);
update public.species set status = status;
update public.genera set name = name, is_quick_access = is_quick_access;
select public.update_catalog_genus(pruebas.genero('Vanda'), 'Vanda', true);
set local role postgres;
select pruebas.iguales('filas de auditoría', (select count(*) from public.catalog_audit_log), 0::bigint);

-- prueba: cambio de estado por lote: un registro por especie que cambia, todos con el mismo id de acción
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'especies que cambiaron',
  public.set_catalog_species_status(
    array[pruebas.especie('Phalaenopsis amabilis'), pruebas.especie('Cattleya labiata'), pruebas.especie('Vanda coerulea')],
    'validated'
  ),
  3
);
set local role postgres;
select pruebas.iguales(
  'registros del lote',
  (select string_agg(s.scientific_name || ':' || (a.old_values ->> 'status') || '>' || (a.new_values ->> 'status'),
                     ', ' order by s.scientific_name)
     from public.catalog_audit_log a join public.species s on s.id = a.row_id
     where a.action = 'update' and a.new_values ?& array['status'] and (select count(*) from jsonb_object_keys(a.new_values)) = 1),
  'Cattleya labiata:imported>validated, Phalaenopsis amabilis:imported>validated, Vanda coerulea:observed>validated'
);
select pruebas.iguales(
  'ids de acción distintos',
  (select count(distinct a.action_id) from public.catalog_audit_log a),
  1::bigint
);

-- prueba: baja de especie: la fila entera como valores anteriores, y sus nombres borrados en cascada en la misma acción
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.especie('Cattleya purpurata') as id_purpurata \gset
select public.delete_catalog_species(:'id_purpurata');
set local role postgres;
select pruebas.iguales(
  'registros de la baja',
  (select string_agg(a.action || ':' || a.table_name || ':' || coalesce(a.old_values ->> 'scientific_name', a.old_values ->> 'name'),
                     ', ' order by a.table_name, lower(a.old_values ->> 'name'))
     from public.catalog_audit_log a
     where a.new_values is null and a.actor = 'user_admin'),
  'delete:species:Cattleya purpurata, delete:species_names:flor de la reina, delete:species_names:Laelia purpurata'
);
select pruebas.iguales(
  'la especie borrada, entera',
  (select a.old_values - 'updated_at' - 'created_at' from public.catalog_audit_log a where a.table_name = 'species'),
  jsonb_build_object('id', :'id_purpurata', 'scientific_name', 'Cattleya purpurata',
                     'genus_id', pruebas.genero('Cattleya'), 'type', 'species', 'status', 'imported',
                     'source', 'col', 'source_ref', '3Z4W2')
);
select pruebas.iguales(
  'ids de acción distintos',
  (select count(distinct a.action_id) from public.catalog_audit_log a),
  1::bigint
);

-- prueba: nombres, géneros y abreviaturas: cada alta, edición y baja del backoffice deja su registro
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select (public.add_species_name(pruebas.especie('Vanda coerulea'), 'vanda azul', 'common', 'es')).id as id_nombre \gset
select public.update_species_name(:'id_nombre', 'vanda azul', 'common', 'pt-BR');
select public.delete_species_name(:'id_nombre');
-- ficticio: un nothogénero inventado.
select (public.create_catalog_genus('× Ficticiara')).id as id_genero \gset
select public.update_catalog_genus(:'id_genero', '× Ficticiara', true);
select (public.add_genus_abbreviation(:'id_genero', 'Fic')).id as id_abreviatura \gset
select public.update_genus_abbreviation(:'id_abreviatura', 'Ficc.');
select public.delete_genus_abbreviation(:'id_abreviatura');
select public.add_genus_abbreviation(:'id_genero', 'Ftc.');
select public.delete_catalog_genus(:'id_genero');
set local role postgres;
-- Las claves y las fechas se quitan para comparar; en las bajas se comprueban aparte.
select pruebas.iguales(
  'registros en orden',
  (select string_agg(
            a.action || ' ' || a.table_name || ' '
              || coalesce((a.old_values - 'id' - 'species_id' - 'genus_id' - 'created_at' - 'updated_at')::text, '-') || ' '
              || coalesce((a.new_values - 'id' - 'species_id' - 'genus_id' - 'created_at' - 'updated_at')::text, '-'),
            E'\n' order by a.id)
     from public.catalog_audit_log a
     -- La baja del género y la de su abreviatura en cascada van en la misma sentencia; su
     -- orden relativo no se comprueba aquí.
     where a.id < (select min(b.id) from public.catalog_audit_log b
                     where b.action = 'delete' and b.table_name = 'genera' or b.old_values ->> 'abbreviation' = 'Ftc.')),
  concat_ws(E'\n',
    'insert species_names - {"name": "vanda azul", "type": "common", "language": "es"}',
    'update species_names {"language": "es"} {"language": "pt-BR"}',
    'delete species_names {"name": "vanda azul", "type": "common", "language": "pt-BR"} -',
    'insert genera - {"name": "× Ficticiara", "photo_path": null, "is_quick_access": false}',
    'update genera {"is_quick_access": false} {"is_quick_access": true}',
    'insert genus_abbreviations - {"abbreviation": "Fic."}',
    'update genus_abbreviations {"abbreviation": "Fic."} {"abbreviation": "Ficc."}',
    'delete genus_abbreviations {"abbreviation": "Ficc."} -',
    'insert genus_abbreviations - {"abbreviation": "Ftc."}'
  )
);
select pruebas.iguales(
  'bajas: la fila entera, también la abreviatura borrada en cascada con el género',
  (select string_agg(a.table_name || ':' || (a.old_values ->> 'id' = a.row_id::text)
                       || ':' || coalesce(a.old_values ->> 'name', a.old_values ->> 'abbreviation')
                       || ':' || (a.old_values ? 'created_at'),
                     ', ' order by a.table_name, coalesce(a.old_values ->> 'name', a.old_values ->> 'abbreviation'))
     from public.catalog_audit_log a
     where a.action = 'delete'),
  'genera:true:× Ficticiara:true, genus_abbreviations:true:Ficc.:true, genus_abbreviations:true:Ftc.:true, '
  'species_names:true:vanda azul:true'
);
select pruebas.iguales(
  'la baja del género y su cascada, en la misma acción',
  (select count(distinct a.action_id) from public.catalog_audit_log a
     where a.action = 'delete' and (a.table_name = 'genera' or a.old_values ->> 'abbreviation' = 'Ftc.')),
  1::bigint
);
select pruebas.iguales(
  'todas con el usuario y la fecha',
  (select string_agg(distinct a.actor || ':' || (a.created_at = now()), ', ') from public.catalog_audit_log a),
  'user_admin:true'
);

-- prueba: una escritura directa de un administrador por la API también deja registro
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
update public.species set status = 'observed' where scientific_name = 'Phalaenopsis amabilis';
insert into public.species_names (species_id, name, type) values (pruebas.especie('Phalaenopsis amabilis'), 'Phalaenopsis grandiflora', 'synonym');
set local role postgres;
select pruebas.iguales(
  'registros',
  (select string_agg(a.actor || ':' || a.action || ':' || a.table_name, ', ' order by a.id) from public.catalog_audit_log a),
  'user_admin:update:species, user_admin:insert:species_names'
);

-- prueba: cambiar el género de una especie audita la especie, no las plantas a las que se propaga
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select public.update_catalog_species(
  pruebas.especie('Phalaenopsis amabilis'), 'Phalaenopsis amabilis', pruebas.genero('Vanda'), 'species', 'validated'
);
set local role postgres;
select pruebas.iguales(
  'género de la planta',
  (select g.name from public.plants p join public.genera g on g.id = p.genus_id where p.entered_name = 'Mi mariposa'),
  'Vanda'
);
select pruebas.iguales(
  'registros',
  (select string_agg(a.table_name || ':' || array_to_string(array(select jsonb_object_keys(a.new_values) order by 1), ','), ', ')
     from public.catalog_audit_log a),
  'species:genus_id,status'
);

-- prueba: un id de acción por transacción: una transacción nueva empieza otro grupo
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select public.create_catalog_species('Vanda tricolor', pruebas.genero('Vanda'), 'species');
select public.create_catalog_species('Vanda sanderiana', pruebas.genero('Vanda'), 'species');
-- Al terminar una transacción, el ajuste local vuelve a '' (así lo ve la siguiente transacción
-- de la misma conexión). Se simula aquí, porque una prueba no puede abrir transacciones.
select set_config('orki.catalog_action_id', '', true);
select public.create_catalog_species('Vanda ficticia', pruebas.genero('Vanda'), 'species');
set local role postgres;
select pruebas.iguales(
  'grupos',
  (select string_agg(g.nombres, ' | ' order by g.primero)
     from (select string_agg(a.new_values ->> 'scientific_name', ', ' order by a.id) as nombres, min(a.id) as primero
             from public.catalog_audit_log a group by a.action_id) g),
  'Vanda tricolor, Vanda sanderiana | Vanda ficticia'
);

-- prueba: log_catalog_action: registra la acción y agrupa bajo ella los cambios que la siguen
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
-- Un cambio antes de la acción queda en otro grupo.
update public.species set status = 'observed' where scientific_name = 'Cattleya labiata';
select private.log_catalog_action(
  'merge_species',
  jsonb_build_object('source_id', pruebas.especie('Cattleya labiata'), 'target_id', pruebas.especie('Cattleya purpurata')),
  'species',
  pruebas.especie('Cattleya purpurata')
) as id_accion \gset
-- Lo que haría la fusión (#21), como postgres dentro de una función de administrador.
update public.plants set species_id = pruebas.especie('Cattleya purpurata') where species_id = pruebas.especie('Cattleya labiata');
insert into public.species_names (species_id, name, type) values (pruebas.especie('Cattleya purpurata'), 'Cattleya labiata', 'synonym');
delete from public.species where scientific_name = 'Cattleya labiata';
select pruebas.iguales(
  'la acción',
  (select row(a.actor, a.action, a.table_name, a.row_id = pruebas.especie('Cattleya purpurata'),
              a.details ->> 'source_id' is not null, a.old_values is null and a.new_values is null)::text
     from public.catalog_audit_log a where a.id = (select min(id) from public.catalog_audit_log where action_id = :'id_accion')),
  '(user_admin,merge_species,species,t,t,t)'
);
select pruebas.iguales(
  'su grupo',
  (select string_agg(a.action || ':' || a.table_name, ', ' order by a.id)
     from public.catalog_audit_log a where a.action_id = :'id_accion'),
  'merge_species:species, insert:species_names, delete:species'
);
select pruebas.iguales(
  'el cambio anterior queda fuera',
  (select count(*) from public.catalog_audit_log a where a.action_id <> :'id_accion'),
  1::bigint
);
-- Otra acción en la misma transacción empieza otro grupo.
select private.log_catalog_action('validate_plant') as id_otra \gset
update public.species set status = 'validated' where scientific_name = 'Vanda coerulea';
select pruebas.iguales(
  'la segunda acción',
  (select string_agg(a.action, ', ' order by a.id) from public.catalog_audit_log a where a.action_id = :'id_otra'),
  'validate_plant, update'
);

-- prueba: log_catalog_action: sin token necesita el identificador de la carga, y no audita las filas
select pruebas.debe_fallar(
  'sin token ni identificador',
  $$select private.log_catalog_action('import_summary')$$,
  '22023'
);
select pruebas.debe_fallar(
  'identificador vacío',
  $$select private.log_catalog_action('import_summary', null, null, null, '  ')$$,
  '22023'
);
select pruebas.debe_fallar(
  'un nombre de cambio de fila',
  $$select private.log_catalog_action('update', null, null, null, 'carga-ficticia')$$,
  '22023'
);
select private.log_catalog_action('import_summary', '{"species": 1}', null, null, 'carga-ficticia') as id_carga \gset
insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
values ('Vanda ficticia', pruebas.genero('Vanda'), 'species', 'imported', 'col', 'FIC01');
select pruebas.iguales(
  'registros',
  (select string_agg(a.actor || ':' || a.action || ':' || (a.action_id = :'id_carga') || ':' || a.details::text, ', ')
     from public.catalog_audit_log a),
  'carga-ficticia:import_summary:true:{"species": 1}'
);
-- Con token, el usuario prevalece sobre el identificador.
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select private.log_catalog_action('validate_plant', null, null, null, 'carga-ficticia');
select pruebas.iguales(
  'actor con token',
  (select a.actor from public.catalog_audit_log a where a.action = 'validate_plant'),
  'user_admin'
);

-- prueba: una carga de miles de filas sin token (conexión directa o clave de servicio) no audita fila a fila
-- Conexión directa como postgres, sin claims: 3 000 especies y 3 000 nombres, editadas y borradas.
insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
select 'Vanda ficticia ' || i, pruebas.genero('Vanda'), 'species', 'imported', 'col', 'FIC' || i
  from generate_series(1, 3000) i;
insert into public.species_names (species_id, name, type)
select s.id, 'Vanda sinónimo ' || s.source_ref, 'synonym'
  from public.species s where s.source_ref like 'FIC%';
update public.species set status = 'validated' where source_ref like 'FIC%';
update public.genera set is_quick_access = not is_quick_access where name = 'Vanda';
-- Clave de servicio por la API: su token no trae "sub".
set local role service_role;
set local request.jwt.claims = '{"role": "service_role"}';
update public.species set status = 'observed' where source_ref like 'FIC%';
delete from public.species where source_ref like 'FIC%';
insert into public.genus_abbreviations (genus_id, abbreviation) values (pruebas.genero('Vanda'), 'Vdaf.');
set local role postgres;
select pruebas.iguales('especies de la carga que quedan', (select count(*) from public.species where source_ref like 'FIC%'), 0::bigint);
select pruebas.iguales('filas de auditoría', (select count(*) from public.catalog_audit_log), 0::bigint);

-- prueba: restricciones: forma de un cambio de fila y de una acción
select pruebas.debe_fallar(
  'un update sin valores anteriores',
  $$insert into public.catalog_audit_log (action_id, actor, action, table_name, row_id, new_values)
    values (gen_random_uuid(), 'user_admin', 'update', 'species', gen_random_uuid(), '{}')$$,
  '23514', 'catalog_audit_log_row_change_shape'
);
select pruebas.debe_fallar(
  'una acción con valores de fila',
  $$insert into public.catalog_audit_log (action_id, actor, action, old_values)
    values (gen_random_uuid(), 'user_admin', 'merge_species', '{}')$$,
  '23514', 'catalog_audit_log_row_change_shape'
);
select pruebas.debe_fallar(
  'actor vacío',
  $$insert into public.catalog_audit_log (action_id, actor, action) values (gen_random_uuid(), ' ', 'merge_species')$$,
  '23514', 'catalog_audit_log_actor_not_blank'
);
select pruebas.debe_fallar(
  'acción con otro formato',
  $$insert into public.catalog_audit_log (action_id, actor, action) values (gen_random_uuid(), 'user_admin', 'Merge species')$$,
  '23514', 'catalog_audit_log_action_format'
);

-- prueba: índices por fila (tabla e id) y por fecha
select pruebas.iguales(
  'índices',
  (select string_agg(i.indexname || ': ' || regexp_replace(i.indexdef, '^.* USING btree ', ''), '; ' order by i.indexname)
     from pg_indexes i
     where i.schemaname = 'public' and i.tablename = 'catalog_audit_log'),
  'catalog_audit_log_action_id_idx: (action_id); '
  'catalog_audit_log_created_at_idx: (created_at); '
  'catalog_audit_log_pkey: (id); '
  'catalog_audit_log_row_idx: (table_name, row_id, id); '
  -- De la migración del historial de una especie (historial_especie.sql).
  'catalog_audit_log_species_idx: (species_id, id)'
);
