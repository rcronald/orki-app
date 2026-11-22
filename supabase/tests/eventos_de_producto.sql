-- Eventos de producto (issue #145): public.product_events y public.record_product_events().
--
-- Solo inserción y solo eventos propios; nadie los lee, edita ni borra por la API; anon nada;
-- reenviar un evento no lo duplica; restricciones de forma y de tamaño; borrado con el perfil;
-- y las consultas de docs/indicadores-de-eventos.sql sobre datos de prueba. Las peticiones se
-- reproducen con "set local role" y "set local request.jwt.claims"; para ver lo que quedó en
-- la tabla se vuelve a "set local role postgres".

-- Datos de partida: los perfiles de user_a y user_b, y un evento de user_b.
insert into public.profiles (id) values ('user_a'), ('user_b');
insert into public.product_events (id, user_id, type, result, duration_ms, generated_offline, occurred_at)
values ('bbbbbbbb-0000-4000-8000-000000000001', 'user_b', 'have_it_search', 'owned', 2000, false, now());

-- prueba: anon no puede insertar, leer, editar ni borrar eventos, ni llamar a la función
set local role anon;
set local request.jwt.claims = '{"sub": "user_a", "role": "anon"}';
select pruebas.debe_fallar('anon lee product_events', 'select * from public.product_events', '42501');
select pruebas.debe_fallar(
  'anon inserta un evento',
  $$insert into public.product_events (id, type, result, duration_ms, generated_offline, occurred_at)
    values (gen_random_uuid(), 'have_it_search', 'owned', 1000, false, now())$$,
  '42501'
);
select pruebas.debe_fallar('anon edita product_events', 'update public.product_events set duration_ms = 1', '42501');
select pruebas.debe_fallar('anon borra product_events', 'delete from public.product_events', '42501');
select pruebas.debe_fallar(
  'anon llama a record_product_events',
  $$select public.record_product_events('[]'::jsonb)$$,
  '42501'
);

-- prueba: privilegios: authenticated solo inserta (sin user_id ni received_at); service_role lee y borra
select pruebas.iguales(
  'privilegios de tabla sobre product_events',
  (select string_agg(r.rol || ':' || p.priv || ':' || has_table_privilege(r.rol, 'public.product_events', p.priv), ', '
                     order by r.rol, p.priv)
     from (values ('anon'), ('authenticated'), ('service_role')) r (rol)
     cross join (values ('select'), ('insert'), ('update'), ('delete'), ('truncate')) p (priv)),
  'anon:delete:false, anon:insert:false, anon:select:false, anon:truncate:false, anon:update:false, '
    || 'authenticated:delete:false, authenticated:insert:false, authenticated:select:false, '
    || 'authenticated:truncate:false, authenticated:update:false, '
    || 'service_role:delete:true, service_role:insert:false, service_role:select:true, '
    || 'service_role:truncate:false, service_role:update:false'
);
select pruebas.iguales(
  'columnas que authenticated puede insertar',
  (select string_agg(a.attname, ', ' order by a.attnum)
     from pg_attribute a
     where a.attrelid = 'public.product_events'::regclass and a.attnum > 0 and not a.attisdropped
       and has_column_privilege('authenticated', 'public.product_events', a.attname, 'insert')),
  'id, type, result, duration_ms, has_photo, name_pending, generated_offline, occurred_at'
);
select pruebas.iguales(
  'columnas que authenticated puede leer o actualizar',
  (select coalesce(string_agg(a.attname, ', '), 'ninguna')
     from pg_attribute a
     where a.attrelid = 'public.product_events'::regclass and a.attnum > 0 and not a.attisdropped
       and (has_column_privilege('authenticated', 'public.product_events', a.attname, 'select')
            or has_column_privilege('authenticated', 'public.product_events', a.attname, 'update'))),
  'ninguna'
);
select pruebas.iguales(
  'políticas de product_events',
  (select string_agg(p.policyname || ':' || p.cmd || ':' || array_to_string(p.roles, ','), ', ')
     from pg_policies p
     where p.schemaname = 'public' and p.tablename = 'product_events'),
  'Cada usuario registra sus eventos:INSERT:authenticated'
);

-- prueba: un usuario registra eventos por lotes; la base pone su id de usuario y la hora de recepción
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select public.record_product_events(jsonb_build_array(
  jsonb_build_object(
    'id', 'aaaaaaaa-0000-4000-8000-000000000001', 'type', 'plant_registered',
    'duration_ms', 42000, 'has_photo', true, 'name_pending', false,
    'generated_offline', false, 'occurred_at', now() - interval '1 minute'
  ),
  jsonb_build_object(
    'id', 'aaaaaaaa-0000-4000-8000-000000000002', 'type', 'have_it_search', 'result', 'similar',
    'duration_ms', 3100, 'generated_offline', true, 'occurred_at', now() - interval '2 days'
  )
));
set local role postgres;
select pruebas.iguales(
  'eventos guardados de user_a',
  (select string_agg(concat_ws(' ', type, result, duration_ms, has_photo, name_pending, generated_offline,
                               occurred_at = now() - interval '2 days', received_at = now()), '; ' order by id)
     from public.product_events where user_id = 'user_a'),
  'plant_registered 42000 t f f f t; have_it_search similar 3100 t t t'
);

-- prueba: un lote vacío no hace nada
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.debe_funcionar('lote vacío', $$select public.record_product_events('[]'::jsonb)$$);
set local role postgres;
select pruebas.iguales('eventos tras el lote vacío', (select count(*) from public.product_events), 1::bigint);

-- prueba: un usuario no puede insertar eventos a nombre de otro
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.debe_fallar(
  'insert directo con user_id',
  $$insert into public.product_events (id, user_id, type, result, duration_ms, generated_offline, occurred_at)
    values (gen_random_uuid(), 'user_b', 'have_it_search', 'owned', 1000, false, now())$$,
  '42501'
);
select pruebas.debe_fallar(
  'insert directo con received_at',
  $$insert into public.product_events (id, type, result, duration_ms, generated_offline, occurred_at, received_at)
    values (gen_random_uuid(), 'have_it_search', 'owned', 1000, false, now(), now())$$,
  '42501'
);
-- La función ignora las claves que no son columnas del evento, user_id incluido.
select public.record_product_events(jsonb_build_array(jsonb_build_object(
  'id', 'aaaaaaaa-0000-4000-8000-000000000003', 'user_id', 'user_b', 'received_at', '2020-01-01T00:00:00Z',
  'type', 'have_it_search', 'result', 'owned', 'duration_ms', 900, 'generated_offline', false,
  'occurred_at', now()
)));
set local role postgres;
select pruebas.iguales(
  'dueño y recepción del evento que intentó ir a nombre de user_b',
  (select user_id || ' ' || (received_at = now()) from public.product_events
     where id = 'aaaaaaaa-0000-4000-8000-000000000003'),
  'user_a true'
);
select pruebas.iguales('eventos de user_b', (select count(*) from public.product_events where user_id = 'user_b'), 1::bigint);

-- prueba: un usuario no puede leer, editar ni borrar eventos, tampoco los suyos
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select public.record_product_events(jsonb_build_array(jsonb_build_object(
  'id', 'aaaaaaaa-0000-4000-8000-000000000004', 'type', 'have_it_search', 'result', 'owned',
  'duration_ms', 900, 'generated_offline', false, 'occurred_at', now()
)));
select pruebas.debe_fallar('user_a lee sus eventos', 'select * from public.product_events', '42501');
select pruebas.debe_fallar(
  'user_a lee el id de sus eventos',
  $$select id from public.product_events where user_id = 'user_a'$$,
  '42501'
);
select pruebas.debe_fallar('user_a edita sus eventos', 'update public.product_events set duration_ms = 1', '42501');
select pruebas.debe_fallar('user_a borra sus eventos', 'delete from public.product_events', '42501');
select pruebas.debe_fallar('user_a vacía la tabla', 'truncate public.product_events', '42501');
-- Un insert con returning necesitaría leer la fila.
select pruebas.debe_fallar(
  'insert con returning',
  $$insert into public.product_events (id, type, result, duration_ms, generated_offline, occurred_at)
    values (gen_random_uuid(), 'have_it_search', 'owned', 1000, false, now()) returning id$$,
  '42501'
);
set local role postgres;
select pruebas.iguales('eventos tras los intentos', (select count(*) from public.product_events), 2::bigint);

-- prueba: un token sin sub no puede registrar eventos
set local role authenticated;
set local request.jwt.claims = '{"role": "authenticated"}';
select pruebas.debe_fallar(
  'token sin sub',
  $$select public.record_product_events(jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'type', 'have_it_search', 'result', 'owned',
      'duration_ms', 900, 'generated_offline', false, 'occurred_at', now())))$$,
  '42501'
);

-- prueba: reenviar el mismo evento no lo duplica ni lo cambia, en otra llamada o en el mismo lote
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select public.record_product_events(jsonb_build_array(
  jsonb_build_object(
    'id', 'aaaaaaaa-0000-4000-8000-000000000005', 'type', 'have_it_search', 'result', 'owned',
    'duration_ms', 1500, 'generated_offline', true, 'occurred_at', now() - interval '1 hour'
  ),
  jsonb_build_object(
    'id', 'aaaaaaaa-0000-4000-8000-000000000005', 'type', 'have_it_search', 'result', 'owned',
    'duration_ms', 1500, 'generated_offline', true, 'occurred_at', now() - interval '1 hour'
  )
));
-- Reintento con el mismo id, y con otros datos: se ignora sin error.
select pruebas.debe_funcionar(
  'reenvío del mismo lote',
  $$select public.record_product_events(jsonb_build_array(jsonb_build_object(
      'id', 'aaaaaaaa-0000-4000-8000-000000000005', 'type', 'have_it_search', 'result', 'not_owned',
      'duration_ms', 9999, 'generated_offline', false, 'occurred_at', now())))$$
);
set local role postgres;
select pruebas.iguales(
  'el evento reenviado está una vez, con sus datos originales',
  (select string_agg(concat_ws(' ', result, duration_ms, generated_offline), '; ')
     from public.product_events where id = 'aaaaaaaa-0000-4000-8000-000000000005'),
  'owned 1500 t'
);

-- prueba: un id que ya usó otro usuario se ignora sin error y sin tocar el evento ajeno
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.debe_funcionar(
  'user_a envía el id de un evento de user_b',
  $$select public.record_product_events(jsonb_build_array(jsonb_build_object(
      'id', 'bbbbbbbb-0000-4000-8000-000000000001', 'type', 'have_it_search', 'result', 'not_owned',
      'duration_ms', 9999, 'generated_offline', false, 'occurred_at', now())))$$
);
set local role postgres;
select pruebas.iguales(
  'evento de user_b',
  (select string_agg(concat_ws(' ', user_id, result, duration_ms), '; ')
     from public.product_events where id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  'user_b owned 2000'
);
select pruebas.iguales('eventos de user_a', (select count(*) from public.product_events where user_id = 'user_a'), 0::bigint);

-- prueba: fuera de la función, un id repetido sí falla, y el upsert de supabase-js no está permitido
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_b", "role": "authenticated"}';
-- Lo que envía PostgREST con on_conflict=id y "Prefer: resolution=ignore-duplicates": exige
-- leer la columna id, que authenticated no puede leer.
select pruebas.debe_fallar(
  'insert directo con on conflict (id) do nothing',
  $$insert into public.product_events (id, type, result, duration_ms, generated_offline, occurred_at)
    values ('bbbbbbbb-0000-4000-8000-000000000001', 'have_it_search', 'owned', 2000, false, now())
    on conflict (id) do nothing$$,
  '42501'
);
set local role postgres;
select pruebas.debe_fallar(
  'insert directo repetido',
  $$insert into public.product_events (id, user_id, type, result, duration_ms, generated_offline, occurred_at)
    values ('bbbbbbbb-0000-4000-8000-000000000001', 'user_b', 'have_it_search', 'owned', 2000, false, now())$$,
  '23505', 'product_events_pkey'
);

-- prueba: la función rechaza lo que no es un arreglo y los lotes de más de 100 eventos
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.debe_fallar('nulo', 'select public.record_product_events(null)', '22023');
select pruebas.debe_fallar('objeto', $$select public.record_product_events('{}'::jsonb)$$, '22023');
select pruebas.debe_fallar('texto', $$select public.record_product_events('"hola"'::jsonb)$$, '22023');
select pruebas.debe_fallar(
  '101 eventos',
  $$select public.record_product_events((
      select jsonb_agg(jsonb_build_object(
        'id', gen_random_uuid(), 'type', 'have_it_search', 'result', 'owned',
        'duration_ms', 900, 'generated_offline', false, 'occurred_at', now()))
      from generate_series(1, 101)))$$,
  '22023'
);
select pruebas.debe_funcionar(
  '100 eventos',
  $$select public.record_product_events((
      select jsonb_agg(jsonb_build_object(
        'id', gen_random_uuid(), 'type', 'have_it_search', 'result', 'owned',
        'duration_ms', 900, 'generated_offline', false, 'occurred_at', now()))
      from generate_series(1, 100)))$$
);
set local role postgres;
select pruebas.iguales('eventos de user_a', (select count(*) from public.product_events where user_id = 'user_a'), 100::bigint);

-- prueba: valores fuera de las listas cerradas o de otro tipo se rechazan
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.debe_fallar(
  'tipo de evento desconocido',
  $$select public.record_product_events(jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'type', 'page_view', 'duration_ms', 900, 'generated_offline', false,
      'occurred_at', now())))$$,
  '22P02'
);
select pruebas.debe_fallar(
  'resultado desconocido',
  $$select public.record_product_events(jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'type', 'have_it_search', 'result', 'Phalaenopsis amabilis',
      'duration_ms', 900, 'generated_offline', false, 'occurred_at', now())))$$,
  '22P02'
);
select pruebas.debe_fallar(
  'duración con texto',
  $$select public.record_product_events(jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'type', 'have_it_search', 'result', 'owned',
      'duration_ms', 'mucho', 'generated_offline', false, 'occurred_at', now())))$$,
  '22P02'
);
select pruebas.debe_fallar(
  'id que no es un uuid',
  $$select public.record_product_events(jsonb_build_array(jsonb_build_object(
      'id', 'evento-1', 'type', 'have_it_search', 'result', 'owned',
      'duration_ms', 900, 'generated_offline', false, 'occurred_at', now())))$$,
  '22P02'
);
select pruebas.debe_fallar(
  'sin id',
  $$select public.record_product_events(jsonb_build_array(jsonb_build_object(
      'type', 'have_it_search', 'result', 'owned',
      'duration_ms', 900, 'generated_offline', false, 'occurred_at', now())))$$,
  '23502'
);
select pruebas.debe_fallar(
  'sin generated_offline',
  $$select public.record_product_events(jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'type', 'have_it_search', 'result', 'owned',
      'duration_ms', 900, 'occurred_at', now())))$$,
  '23502'
);
select pruebas.debe_fallar(
  'sin occurred_at',
  $$select public.record_product_events(jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'type', 'have_it_search', 'result', 'owned',
      'duration_ms', 900, 'generated_offline', false)))$$,
  '23502'
);

-- prueba: un lote con un evento inválido no guarda ninguno
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.debe_fallar(
  'lote con un evento válido y otro inválido',
  $$select public.record_product_events(jsonb_build_array(
      jsonb_build_object(
        'id', gen_random_uuid(), 'type', 'have_it_search', 'result', 'owned',
        'duration_ms', 900, 'generated_offline', false, 'occurred_at', now()),
      jsonb_build_object(
        'id', gen_random_uuid(), 'type', 'have_it_search', 'result', 'owned',
        'duration_ms', -1, 'generated_offline', false, 'occurred_at', now())))$$,
  '23514', 'product_events_duration_ms_range'
);
set local role postgres;
select pruebas.iguales('eventos de user_a', (select count(*) from public.product_events where user_id = 'user_a'), 0::bigint);

-- prueba: cada tipo lleva sus campos y solo los suyos
select pruebas.debe_funcionar(
  'registro con foto y nombre por validar',
  $$insert into public.product_events (id, user_id, type, duration_ms, has_photo, name_pending, generated_offline, occurred_at)
    values (gen_random_uuid(), 'user_a', 'plant_registered', 30000, false, true, false, now())$$
);
select pruebas.debe_fallar(
  'registro con resultado',
  $$insert into public.product_events (id, user_id, type, result, duration_ms, has_photo, name_pending, generated_offline, occurred_at)
    values (gen_random_uuid(), 'user_a', 'plant_registered', 'owned', 30000, false, true, false, now())$$,
  '23514', 'product_events_fields_match_type'
);
select pruebas.debe_fallar(
  'registro sin has_photo',
  $$insert into public.product_events (id, user_id, type, duration_ms, name_pending, generated_offline, occurred_at)
    values (gen_random_uuid(), 'user_a', 'plant_registered', 30000, true, false, now())$$,
  '23514', 'product_events_fields_match_type'
);
select pruebas.debe_fallar(
  'registro sin name_pending',
  $$insert into public.product_events (id, user_id, type, duration_ms, has_photo, generated_offline, occurred_at)
    values (gen_random_uuid(), 'user_a', 'plant_registered', 30000, true, false, now())$$,
  '23514', 'product_events_fields_match_type'
);
select pruebas.debe_fallar(
  'búsqueda sin resultado',
  $$insert into public.product_events (id, user_id, type, duration_ms, generated_offline, occurred_at)
    values (gen_random_uuid(), 'user_a', 'have_it_search', 1000, false, now())$$,
  '23514', 'product_events_fields_match_type'
);
select pruebas.debe_fallar(
  'búsqueda con has_photo',
  $$insert into public.product_events (id, user_id, type, result, duration_ms, has_photo, generated_offline, occurred_at)
    values (gen_random_uuid(), 'user_a', 'have_it_search', 'owned', 1000, true, false, now())$$,
  '23514', 'product_events_fields_match_type'
);
select pruebas.debe_fallar(
  'búsqueda con name_pending',
  $$insert into public.product_events (id, user_id, type, result, duration_ms, name_pending, generated_offline, occurred_at)
    values (gen_random_uuid(), 'user_a', 'have_it_search', 'owned', 1000, false, false, now())$$,
  '23514', 'product_events_fields_match_type'
);

-- prueba: la duración va de 0 a 24 horas
select pruebas.debe_funcionar(
  'duraciones en los extremos',
  $$insert into public.product_events (id, user_id, type, result, duration_ms, generated_offline, occurred_at)
    values (gen_random_uuid(), 'user_a', 'have_it_search', 'owned', 0, false, now()),
           (gen_random_uuid(), 'user_a', 'have_it_search', 'owned', 86400000, false, now())$$
);
select pruebas.debe_fallar(
  'duración negativa',
  $$insert into public.product_events (id, user_id, type, result, duration_ms, generated_offline, occurred_at)
    values (gen_random_uuid(), 'user_a', 'have_it_search', 'owned', -1, false, now())$$,
  '23514', 'product_events_duration_ms_range'
);
select pruebas.debe_fallar(
  'duración de más de 24 horas',
  $$insert into public.product_events (id, user_id, type, result, duration_ms, generated_offline, occurred_at)
    values (gen_random_uuid(), 'user_a', 'have_it_search', 'owned', 86400001, false, now())$$,
  '23514', 'product_events_duration_ms_range'
);

-- prueba: cuándo ocurrió va de 30 días antes a 1 hora después de recibirlo
select pruebas.debe_funcionar(
  'fechas en los extremos',
  $$insert into public.product_events (id, user_id, type, result, duration_ms, generated_offline, occurred_at)
    values (gen_random_uuid(), 'user_a', 'have_it_search', 'owned', 1000, true, now() - interval '30 days'),
           (gen_random_uuid(), 'user_a', 'have_it_search', 'owned', 1000, false, now() + interval '1 hour')$$
);
select pruebas.debe_fallar(
  'evento de hace más de 30 días',
  $$insert into public.product_events (id, user_id, type, result, duration_ms, generated_offline, occurred_at)
    values (gen_random_uuid(), 'user_a', 'have_it_search', 'owned', 1000, true, now() - interval '30 days 1 second')$$,
  '23514', 'product_events_occurred_at_range'
);
select pruebas.debe_fallar(
  'evento de más de 1 hora en el futuro',
  $$insert into public.product_events (id, user_id, type, result, duration_ms, generated_offline, occurred_at)
    values (gen_random_uuid(), 'user_a', 'have_it_search', 'owned', 1000, false, now() + interval '61 minutes')$$,
  '23514', 'product_events_occurred_at_range'
);
-- La comparación es con received_at, no con la hora actual: un evento antiguo con su
-- recepción de entonces sigue siendo válido (por ejemplo, al restaurar una copia).
select pruebas.debe_funcionar(
  'evento antiguo recibido en su momento',
  $$insert into public.product_events (id, user_id, type, result, duration_ms, generated_offline, occurred_at, received_at)
    values (gen_random_uuid(), 'user_a', 'have_it_search', 'owned', 1000, false, '2026-01-01T10:00:00Z', '2026-01-02T10:00:00Z')$$
);

-- prueba: el usuario no puede quedar en blanco ni ser desmesurado
select pruebas.debe_fallar(
  'user_id en blanco',
  $$insert into public.product_events (id, user_id, type, result, duration_ms, generated_offline, occurred_at)
    values (gen_random_uuid(), '  ', 'have_it_search', 'owned', 1000, false, now())$$,
  '23514', 'product_events_user_id_valid'
);
select pruebas.debe_fallar(
  'user_id de 101 caracteres',
  $$insert into public.product_events (id, user_id, type, result, duration_ms, generated_offline, occurred_at)
    values (gen_random_uuid(), repeat('u', 101), 'have_it_search', 'owned', 1000, false, now())$$,
  '23514', 'product_events_user_id_valid'
);

-- prueba: la tabla no tiene columnas de texto libre más allá del id de usuario
select pruebas.iguales(
  'columnas de product_events y sus tipos',
  (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
     from pg_attribute a
     where a.attrelid = 'public.product_events'::regclass and a.attnum > 0 and not a.attisdropped),
  'id:uuid, user_id:text, type:product_event_type, result:product_event_result, duration_ms:integer, '
    || 'has_photo:boolean, name_pending:boolean, generated_offline:boolean, '
    || 'occurred_at:timestamp with time zone, received_at:timestamp with time zone'
);

-- prueba: record_product_events es security invoker, con search_path vacío y solo para authenticated
select pruebas.iguales(
  'propiedades de record_product_events',
  (select 'definer=' || p.prosecdef || ' ' || array_to_string(p.proconfig, ',')
     from pg_proc p where p.oid = 'public.record_product_events(jsonb)'::regprocedure),
  'definer=false search_path=""'
);
select pruebas.iguales(
  'quién puede ejecutar record_product_events',
  (select string_agg(r.rol || ':' || has_function_privilege(r.rol, 'public.record_product_events(jsonb)', 'execute'), ', ' order by r.rol)
     from (values ('anon'), ('authenticated'), ('service_role')) r (rol)),
  'anon:false, authenticated:true, service_role:false'
);

-- prueba: service_role lee y borra eventos, pero no los inserta ni los edita
set local role service_role;
select pruebas.iguales('eventos que ve service_role', (select count(*) from public.product_events), 1::bigint);
select pruebas.debe_fallar(
  'service_role inserta un evento',
  $$insert into public.product_events (id, user_id, type, result, duration_ms, generated_offline, occurred_at)
    values (gen_random_uuid(), 'user_a', 'have_it_search', 'owned', 1000, false, now())$$,
  '42501'
);
select pruebas.debe_fallar('service_role edita un evento', 'update public.product_events set duration_ms = 1', '42501');
select pruebas.debe_funcionar('service_role borra eventos', 'delete from public.product_events');

-- prueba: al borrar un perfil desde la app se borran sus eventos y solo los suyos
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select public.record_product_events(jsonb_build_array(jsonb_build_object(
  'id', gen_random_uuid(), 'type', 'have_it_search', 'result', 'owned',
  'duration_ms', 900, 'generated_offline', false, 'occurred_at', now()
)));
delete from public.profiles where id = 'user_a';
set local role postgres;
select pruebas.iguales(
  'eventos que quedan, por usuario',
  (select string_agg(user_id || ':' || n, ', ' order by user_id)
     from (select user_id, count(*) n from public.product_events group by user_id) t),
  'user_b:1'
);

-- prueba: los eventos se borran también si el perfil lo borra la clave de servicio
set local role service_role;
delete from public.profiles where id = 'user_b';
set local role postgres;
select pruebas.iguales('eventos que quedan', (select count(*) from public.product_events), 0::bigint);

-- prueba: los eventos de un usuario sin perfil se guardan igual
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_sin_perfil", "role": "authenticated"}';
select pruebas.debe_funcionar(
  'evento de un usuario sin perfil',
  $$select public.record_product_events(jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'type', 'have_it_search', 'result', 'not_owned',
      'duration_ms', 900, 'generated_offline', true, 'occurred_at', now())))$$
);

-- prueba: las consultas de docs/ dan los indicadores por semana sobre datos de prueba
-- Semana del 2 de noviembre de 2026 (hora de Lima): cinco registros, tres en menos de 1 minuto
-- (uno el domingo 8 a las 22:00 de Lima, que en UTC ya es lunes 9), y cuatro búsquedas, tres
-- en menos de 5 segundos. Semana del 9: dos registros, uno en menos de 1 minuto (60 000 ms
-- justos no cuentan). Más el evento de user_b de los datos de partida, en la semana actual.
insert into public.product_events (id, user_id, type, result, duration_ms, has_photo, name_pending, generated_offline, occurred_at, received_at)
select gen_random_uuid(), 'user_a', e.type::public.product_event_type, e.result::public.product_event_result,
       e.duration_ms, e.has_photo, e.name_pending, e.generated_offline, e.occurred_at::timestamptz,
       e.occurred_at::timestamptz + interval '1 day'
  from (values
    ('plant_registered', null, 30000, true, false, false, '2026-11-02 09:00:00-05'),
    ('plant_registered', null, 45000, false, false, true, '2026-11-03 09:00:00-05'),
    ('plant_registered', null, 50000, true, true, false, '2026-11-04 09:00:00-05'),
    ('plant_registered', null, 70000, false, false, false, '2026-11-05 09:00:00-05'),
    ('plant_registered', null, 120000, true, false, false, '2026-11-09 03:00:00+00'),
    ('plant_registered', null, 20000, true, false, false, '2026-11-09 09:00:00-05'),
    ('plant_registered', null, 60000, true, false, true, '2026-11-15 09:00:00-05'),
    ('have_it_search', 'owned', 1000, null, null, false, '2026-11-02 10:00:00-05'),
    ('have_it_search', 'not_owned', 3000, null, null, true, '2026-11-03 10:00:00-05'),
    ('have_it_search', 'similar', 4000, null, null, false, '2026-11-04 10:00:00-05'),
    ('have_it_search', 'owned', 9000, null, null, false, '2026-11-05 10:00:00-05')
  ) e (type, result, duration_ms, has_photo, name_pending, generated_offline, occurred_at);
\i docs/indicadores-de-eventos.sql
select pruebas.iguales(
  'indicador de registro',
  (select string_agg(concat_ws(' ', semana, registros, en_menos_de_1_minuto, porcentaje, mediana_ms, p90_ms, sin_conexion),
                     '; ' order by semana)
     from indicador_registro),
  '2026-11-02 5 3 60.0 50000 100000 1; 2026-11-09 2 1 50.0 40000 56000 1'
);
select pruebas.iguales(
  'indicador de "¿Ya la tengo?"',
  (select string_agg(concat_ws(' ', semana, busquedas, en_menos_de_5_segundos, porcentaje, mediana_ms, p90_ms, sin_conexion),
                     '; ' order by semana)
     from indicador_ya_la_tengo
     where semana < '2026-11-09'),
  '2026-11-02 4 3 75.0 3500 7500 1'
);
select pruebas.iguales(
  'semanas de "¿Ya la tengo?" con eventos',
  (select count(*) from indicador_ya_la_tengo),
  2::bigint
);
