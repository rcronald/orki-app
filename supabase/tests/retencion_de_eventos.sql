-- Plazo de conservación de los eventos de producto (#293): public.purge_expired_product_events().
--
-- Borra los eventos de más de 13 meses, de todas las cuentas, y solo esos; la ejecuta
-- service_role (el workflow «Retención de eventos») y no anon ni authenticated.

-- Datos de partida: dos cuentas, cada una con un evento de 14 meses, uno de 13 meses y un día,
-- uno de 12 meses y uno de hoy. received_at va con occurred_at para cumplir la restricción de
-- la tabla (entre 30 días antes y 1 hora después de recibirlo).
insert into public.profiles (id) values ('user_a'), ('user_b');
insert into public.product_events (id, user_id, type, result, duration_ms, generated_offline, occurred_at, received_at)
select e.id::uuid, e.usuario, 'have_it_search', 'owned', 1000, false,
       now() - e.antiguedad::interval, now() - e.antiguedad::interval
  from (values
    ('aaaaaaaa-0000-4000-8000-000000000014', 'user_a', '14 months'),
    ('aaaaaaaa-0000-4000-8000-000000000013', 'user_a', '13 months 1 day'),
    ('aaaaaaaa-0000-4000-8000-000000000012', 'user_a', '12 months'),
    ('aaaaaaaa-0000-4000-8000-000000000000', 'user_a', '0 seconds'),
    ('bbbbbbbb-0000-4000-8000-000000000014', 'user_b', '14 months'),
    ('bbbbbbbb-0000-4000-8000-000000000013', 'user_b', '13 months 1 day'),
    ('bbbbbbbb-0000-4000-8000-000000000012', 'user_b', '12 months'),
    ('bbbbbbbb-0000-4000-8000-000000000000', 'user_b', '0 seconds')
  ) e (id, usuario, antiguedad);

-- prueba: service_role borra los eventos de más de 13 meses de todas las cuentas y conserva los demás
set local role service_role;
select pruebas.iguales('eventos borrados', public.purge_expired_product_events(), 4);
set local role postgres;
select pruebas.iguales(
  'eventos que quedan',
  (select string_agg(id::text, ', ' order by id) from public.product_events),
  'aaaaaaaa-0000-4000-8000-000000000000, aaaaaaaa-0000-4000-8000-000000000012, '
    || 'bbbbbbbb-0000-4000-8000-000000000000, bbbbbbbb-0000-4000-8000-000000000012'
);

-- prueba: volver a ejecutarla no borra nada más
set local role service_role;
select public.purge_expired_product_events();
select pruebas.iguales('eventos borrados la segunda vez', public.purge_expired_product_events(), 0);
select pruebas.iguales('eventos que quedan', (select count(*) from public.product_events), 4::bigint);

-- prueba: el evento de 12 meses se conserva y el de 14 se borra, también para postgres
select public.purge_expired_product_events();
select pruebas.iguales(
  'eventos de 14 y de 12 meses que quedan',
  (select string_agg(id::text, ', ' order by id) from public.product_events
     where id::text like '%-000000000014' or id::text like '%-000000000012'),
  'aaaaaaaa-0000-4000-8000-000000000012, bbbbbbbb-0000-4000-8000-000000000012'
);

-- prueba: anon y authenticated no pueden ejecutarla ni borrar eventos de otro modo
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select pruebas.debe_fallar('anon la ejecuta', 'select public.purge_expired_product_events()', '42501');
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.debe_fallar('user_a la ejecuta', 'select public.purge_expired_product_events()', '42501');
set local request.jwt.claims = '{"sub": "user_b", "role": "authenticated"}';
select pruebas.debe_fallar('user_b la ejecuta', 'select public.purge_expired_product_events()', '42501');
set local role postgres;
select pruebas.iguales('no se borró nada', (select count(*) from public.product_events), 8::bigint);

-- prueba: es security invoker, con search_path vacío, y solo la ejecuta service_role
select pruebas.iguales(
  'propiedades de purge_expired_product_events',
  (select 'definer=' || p.prosecdef || ' ' || array_to_string(p.proconfig, ',')
     from pg_proc p where p.oid = 'public.purge_expired_product_events()'::regprocedure),
  'definer=false search_path=""'
);
select pruebas.iguales(
  'quién puede ejecutar purge_expired_product_events',
  (select string_agg(r.rol || ':' || has_function_privilege(r.rol, 'public.purge_expired_product_events()', 'execute'), ', ' order by r.rol)
     from (values ('anon'), ('authenticated'), ('public'), ('service_role')) r (rol)
     where r.rol <> 'public')
    || ', public:' || (select exists (
         select from pg_proc p cross join lateral aclexplode(p.proacl) a
         where p.oid = 'public.purge_expired_product_events()'::regprocedure and a.grantee = 0)),
  'anon:false, authenticated:false, service_role:true, public:false'
);
