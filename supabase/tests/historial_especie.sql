-- Historial de una especie en el backoffice (issue #133, parte de #23): la columna species_id
-- de la auditoría con su disparador fill_species_id, y public.species_history(), de la
-- migración 20261121150000_historial_de_especie.sql.
--
-- Las escrituras se hacen como authenticated con el claim app_role = catalog_admin, igual que
-- el backoffice. Cada llamada a la API es una transacción; aquí se simula el final de una
-- transacción vaciando el ajuste orki.catalog_action_id (como en auditoria.sql), porque una
-- prueba no puede abrir transacciones. Los nombres inventados se señalan con "ficticio".

-- Datos de partida, sin token (no dejan auditoría).
insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
values
  ('Cattleya labiata', pruebas.genero('Cattleya'), 'species', 'imported', 'col', '3Z4W1'),
  ('Cattleya purpurata', pruebas.genero('Cattleya'), 'species', 'imported', 'col', '3Z4W2'),
  ('Vanda coerulea', pruebas.genero('Vanda'), 'species', 'observed', 'col', '6VX01');

insert into public.species_names (species_id, name, type, language)
values
  (pruebas.especie('Cattleya purpurata'), 'Laelia purpurata', 'synonym', null),
  (pruebas.especie('Cattleya purpurata'), 'flor de la reina', 'common', 'es');

-- El historial de una especie en una línea por entrada, de la más reciente a la más antigua:
-- la acción (o "-"), sus cambios (tabla:acción, en orden alfabético: los borrados en cascada
-- de una misma sentencia no tienen un orden fijo) y, si los hay, los cambios en otras filas.
create function pg_temp.historial(especie uuid, tamano integer default 20, antes bigint default null)
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
  from public.species_history(especie, tamano, antes) h
$$;

-- Fin de una petición a la API.
create function pg_temp.fin_de_peticion()
returns void
language sql
as $$
  select set_config('orki.catalog_action_id', '', true)
$$;

-- Desde el #283, las funciones que crea postgres no nacen ejecutables por PUBLIC: las de
-- ayuda de este archivo se abren a mano para poder llamarlas con otros roles.
grant execute on all functions in schema pg_temp to public;

-- prueba: permisos: solo authenticated la ejecuta, y solo un administrador obtiene el historial
select pruebas.iguales(
  'quién puede ejecutarla',
  (select string_agg(r.rol, ', ' order by r.rol)
     from (values ('anon'), ('authenticated'), ('service_role')) r (rol)
     where has_function_privilege(r.rol, 'public.species_history(uuid, integer, bigint)', 'execute')),
  'authenticated'
);
select pruebas.iguales(
  'propiedades',
  (select p.prosecdef || ' ' || array_to_string(p.proconfig, ',')
     from pg_proc p where p.oid = 'public.species_history(uuid, integer, bigint)'::regprocedure),
  'true search_path=""'
);
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select public.update_catalog_species(
  pruebas.especie('Vanda coerulea'), 'Vanda coerulea', pruebas.genero('Vanda'), 'species', 'validated'
);
select pruebas.iguales('el administrador lo obtiene', pg_temp.historial(pruebas.especie('Vanda coerulea')), '- [species:update]');
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.debe_fallar(
  'usuario sin rol',
  $$select * from public.species_history(pruebas.especie('Vanda coerulea'))$$,
  '42501'
);
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated", "app_role": "admin"}';
select pruebas.debe_fallar(
  'otro valor de app_role',
  $$select * from public.species_history(pruebas.especie('Vanda coerulea'))$$,
  '42501'
);
set local role anon;
set local request.jwt.claims = '{"role": "anon", "app_role": "catalog_admin"}';
select pruebas.debe_fallar(
  'anon',
  $$select * from public.species_history(pruebas.especie('Vanda coerulea'))$$,
  '42501'
);
set local role service_role;
set local request.jwt.claims = '{"role": "service_role"}';
select pruebas.debe_fallar(
  'clave de servicio',
  $$select * from public.species_history(pruebas.especie('Vanda coerulea'))$$,
  '42501'
);

-- prueba: species_id: la especie de cada registro, también en la edición de un nombre (que no lo trae en sus valores)
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.especie('Cattleya purpurata') as id_purpurata \gset
select (public.add_species_name(:'id_purpurata', 'Bletia purpurata', 'synonym')).id as id_nombre \gset
select public.update_species_name(:'id_nombre', 'Bletia purpurata ficticia', 'synonym');
select public.delete_species_name(:'id_nombre');
select public.update_catalog_species(:'id_purpurata', 'Cattleya purpurata', pruebas.genero('Cattleya'), 'species', 'observed');
-- ficticio: un género sin especie.
select public.create_catalog_genus('Ficticiara');
set local role postgres;
select pruebas.iguales(
  'especie de cada registro',
  (select string_agg(a.table_name || ':' || a.action || ':' || coalesce((a.species_id = :'id_purpurata')::text, 'null'),
                     ', ' order by a.id)
     from public.catalog_audit_log a),
  'species_names:insert:true, species_names:update:true, species_names:delete:true, '
  'species:update:true, genera:insert:null'
);
select pruebas.iguales(
  'la edición del nombre no trae species_id en sus valores',
  (select a.new_values ? 'species_id' or a.old_values ? 'species_id'
     from public.catalog_audit_log a where a.table_name = 'species_names' and a.action = 'update'),
  false
);

-- prueba: un nombre editado y después borrado sin token (una carga) sigue en el historial de su especie
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.especie('Cattleya purpurata') as id_purpurata \gset
select public.update_species_name(
  (select n.id from public.species_names n where n.name = 'Laelia purpurata'), 'Laelia purpurata', 'common', 'es'
);
select pg_temp.fin_de_peticion();
-- La carga, con conexión directa y sin token, borra el nombre: no deja registro.
set local role postgres;
set local request.jwt.claims = '';
delete from public.species_names where name = 'Laelia purpurata';
select pruebas.iguales('registros', (select count(*) from public.catalog_audit_log), 1::bigint);
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales('historial', pg_temp.historial(:'id_purpurata'), '- [species_names:update]');
select pruebas.iguales(
  'la entrada',
  (select jsonb_build_object('actor', h.actor, 'fecha', h.created_at = now(), 'cambios', h.changes,
                             'otros', h.other_change_count, 'generos', h.genus_names, 'mas', h.has_more)
     from public.species_history(:'id_purpurata') h),
  jsonb_build_object(
    'actor', 'user_admin', 'fecha', true, 'otros', 0, 'generos', '{}'::jsonb, 'mas', false,
    'cambios', jsonb_build_array(jsonb_build_object(
      'table_name', 'species_names',
      'row_id', (select a.row_id from public.catalog_audit_log a),
      'action', 'update',
      'old_values', '{"type": "synonym", "language": null}'::jsonb,
      'new_values', '{"type": "common", "language": "es"}'::jsonb
    ))
  )
);

-- prueba: orden y agrupación: del más reciente al más antiguo, una entrada por petición, sin lo de otras especies
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select (public.create_catalog_species('Vanda ficticia', pruebas.genero('Vanda'), 'species')).id as id_vanda \gset
select pg_temp.fin_de_peticion();
select public.add_species_name(:'id_vanda', 'vanda de mentira', 'common', 'es');
select pg_temp.fin_de_peticion();
-- Otra especie en otra petición, y un lote que cambia las dos.
select public.update_catalog_species(pruebas.especie('Vanda coerulea'), 'Vanda coerulea', pruebas.genero('Vanda'), 'species', 'validated');
select pg_temp.fin_de_peticion();
select public.set_catalog_species_status(array[:'id_vanda'::uuid, pruebas.especie('Vanda coerulea')], 'observed');
select pg_temp.fin_de_peticion();
select public.update_catalog_species(:'id_vanda', 'Vanda ficticia', pruebas.genero('Cattleya'), 'hybrid', 'observed');
select pruebas.iguales(
  'historial',
  pg_temp.historial(:'id_vanda'),
  '- [species:update] | - [species:update] +1 | - [species_names:insert] | - [species:insert]'
);
select pruebas.iguales(
  'la edición más reciente, con los nombres de sus géneros',
  (select jsonb_build_object('cambios', h.changes -> 0 -> 'new_values', 'antes', h.changes -> 0 -> 'old_values', 'generos', h.genus_names)
     from public.species_history(:'id_vanda') h order by h.entry_id desc limit 1),
  jsonb_build_object(
    'cambios', jsonb_build_object('genus_id', pruebas.genero('Cattleya'), 'type', 'hybrid'),
    'antes', jsonb_build_object('genus_id', pruebas.genero('Vanda'), 'type', 'species'),
    'generos', jsonb_build_object(pruebas.genero('Cattleya'), 'Cattleya', pruebas.genero('Vanda'), 'Vanda')
  )
);
select pruebas.iguales(
  'el alta trae la fila entera y el nombre de su género',
  (select (h.changes -> 0 -> 'new_values' ->> 'scientific_name') || ' ' || (h.genus_names ->> (pruebas.genero('Vanda'))::text)
     from public.species_history(:'id_vanda') h order by h.entry_id limit 1),
  'Vanda ficticia Vanda'
);
select pruebas.iguales(
  'la otra especie no ve las de esta',
  pg_temp.historial(pruebas.especie('Vanda coerulea')),
  '- [species:update] +1 | - [species:update]'
);

-- prueba: baja de una especie: una sola entrada con la especie y sus nombres borrados en cascada
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.especie('Cattleya purpurata') as id_purpurata \gset
select public.update_catalog_species(:'id_purpurata', 'Cattleya purpurata', pruebas.genero('Cattleya'), 'species', 'validated');
select pg_temp.fin_de_peticion();
select public.delete_catalog_species(:'id_purpurata');
select pruebas.iguales(
  'historial de la especie borrada',
  pg_temp.historial(:'id_purpurata'),
  '- [species:delete, species_names:delete, species_names:delete] | - [species:update]'
);

-- prueba: una acción con sentido propio es una sola entrada, en el historial de su objetivo y en el de las filas que toca
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.especie('Cattleya labiata') as id_labiata \gset
select pruebas.especie('Cattleya purpurata') as id_purpurata \gset
select public.update_catalog_species(:'id_labiata', 'Cattleya labiata', pruebas.genero('Cattleya'), 'species', 'observed');
select pg_temp.fin_de_peticion();
-- Lo que haría la fusión (#21), como postgres dentro de una función de administrador: mueve
-- un nombre, añade el nombre de la fuente como sinónimo y borra la fuente.
set local role postgres;
select private.log_catalog_action(
  'merge_species',
  jsonb_build_object('source_id', :'id_labiata', 'target_id', :'id_purpurata'),
  'species',
  :'id_purpurata'
);
insert into public.species_names (species_id, name, type) values (:'id_labiata', 'Cattleya ficticia', 'synonym');
update public.species_names set species_id = :'id_purpurata' where name = 'Cattleya ficticia';
insert into public.species_names (species_id, name, type) values (:'id_purpurata', 'Cattleya labiata', 'synonym');
delete from public.species where id = :'id_labiata';
set local role authenticated;
select pruebas.iguales(
  'historial del objetivo',
  pg_temp.historial(:'id_purpurata'),
  'merge_species [species_names:insert, species_names:update] +2'
);
select pruebas.iguales(
  'la entrada de la fusión',
  (select h.actor || ' ' || (h.details ->> 'source_id' = :'id_labiata') || ' ' || (h.created_at = now())
     from public.species_history(:'id_purpurata') h),
  'user_admin true true'
);
select pruebas.iguales(
  'historial de la especie fusionada',
  pg_temp.historial(:'id_labiata'),
  'merge_species [species:delete, species_names:insert] +2 | - [species:update]'
);

-- prueba: una acción sobre la especie sin cambios de fila sale con los cambios vacíos
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
set local role postgres;
select private.log_catalog_action('validate_plant', '{"plant": "ficticia"}', 'species', pruebas.especie('Vanda coerulea'));
set local role authenticated;
select pruebas.iguales(
  'historial',
  (select h.action || ' ' || h.changes::text || ' ' || h.other_change_count || ' ' || h.genus_names::text
     from public.species_history(pruebas.especie('Vanda coerulea')) h),
  'validate_plant [] 0 {}'
);

-- prueba: paginación por clave: páginas sin saltos ni repeticiones, has_more y tamaño de página
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.especie('Vanda coerulea') as id_coerulea \gset
-- 25 peticiones que cambian el estado, cada una en su propia acción.
do $$
declare
  i integer;
begin
  for i in 1..25 loop
    perform public.set_catalog_species_status(
      array[pruebas.especie('Vanda coerulea')],
      case when i % 2 = 0 then 'observed' else 'validated' end::public.species_status
    );
    perform set_config('orki.catalog_action_id', '', true);
  end loop;
end;
$$;
select pruebas.iguales('entradas en total', (select count(*) from public.species_history(:'id_coerulea', 100)), 25::bigint);
select pruebas.iguales(
  'primera página por defecto',
  (select count(*) || ' ' || bool_and(h.has_more) from public.species_history(:'id_coerulea') h),
  '20 true'
);
select min(h.entry_id) as ultima from public.species_history(:'id_coerulea') h \gset
select pruebas.iguales(
  'segunda página',
  (select count(*) || ' ' || bool_or(h.has_more) from public.species_history(:'id_coerulea', 20, :ultima) h),
  '5 false'
);
select pruebas.iguales(
  'las dos páginas son el historial entero, en orden',
  (select array_agg(p.entry_id order by p.n)
     from (select h.entry_id, row_number() over () as n
             from (select * from public.species_history(:'id_coerulea')
                   union all
                   select * from public.species_history(:'id_coerulea', 20, :ultima)) h) p),
  (select array_agg(h.entry_id order by h.entry_id desc) from public.species_history(:'id_coerulea', 100) h)
);
select pruebas.iguales(
  'tamaño de página nulo, cero, negativo y por encima del máximo',
  (select string_agg(coalesce(t.tamano::text, 'null') || ':' || (select count(*) from public.species_history(:'id_coerulea', t.tamano)), ', ')
     from (values (null::integer), (0), (-1), (3), (1000)) t (tamano)),
  'null:20, 0:20, -1:20, 3:3, 1000:25'
);
select pruebas.iguales(
  'una página de 3 dice que hay más',
  (select bool_and(h.has_more) from public.species_history(:'id_coerulea', 3) h),
  true
);
select pruebas.iguales(
  'sin registros, ninguna fila',
  (select count(*) from public.species_history(gen_random_uuid())),
  0::bigint
);

-- prueba: el historial se lee con el índice de la especie y el de la acción
set local role postgres;
insert into public.catalog_audit_log (action_id, actor, action, table_name, row_id, new_values)
select gen_random_uuid(), 'user_admin', 'insert', 'species', gen_random_uuid(), '{}'
  from generate_series(1, 5000);
analyze public.catalog_audit_log;
select pruebas.iguales(
  'índices',
  (select string_agg(i.indexname || ': ' || regexp_replace(i.indexdef, '^.* USING btree ', ''), '; ' order by i.indexname)
     from pg_indexes i
     where i.schemaname = 'public' and i.tablename = 'catalog_audit_log' and i.indexname = 'catalog_audit_log_species_idx'),
  'catalog_audit_log_species_idx: (species_id, id)'
);
do $$
declare
  linea text;
  plan text := '';
begin
  for linea in execute $q$explain (format text)
    select a.action_id, max(a.id) from public.catalog_audit_log a
    where a.species_id = '00000000-0000-4000-8000-000000000000' group by a.action_id$q$
  loop
    plan := plan || linea || E'\n';
  end loop;
  perform pruebas.comprobar('usa catalog_audit_log_species_idx: ' || plan, plan like '%catalog_audit_log_species_idx%');
end;
$$;
