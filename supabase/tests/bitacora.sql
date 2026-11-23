-- Bitácora de las plantas (issue #264, parte de #263), de la migración
-- 20261124120000_identificador_notas_y_bitacora.sql: public.plant_log_entries,
-- add_plant_log_entry(), list_plant_log_entries() y las fotos de la bitácora en el bucket
-- plant-photos (<usuario>/<planta>/log/<archivo>), que el administrador del catálogo no ve nunca.
--
-- Como en fotos_storage.sql, storage es la simulación mínima: leer, descargar o firmar una URL
-- es un select de storage.objects.
--
-- Datos de partida, como postgres:
--   - P1 de user_a, por validar, con su foto principal.
--   - P2 de user_a, validada.
--   - P3 de user_b, por validar.
--   - En storage, la foto de P1 y dos fotos de bitácora de P1 y una de P3.

insert into public.species (scientific_name, genus_id, type, status, source)
values ('Cattleya labiata', pruebas.genero('Cattleya'), 'species', 'validated', 'curated');

insert into public.plants (id, user_id, entered_name, genus_id, type, photo_path, thumbnail_path)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'user_a', 'Flor de A', pruebas.genero('Vanda'), 'unknown',
   'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-0.webp',
   'user_a/aaaaaaaa-0000-4000-8000-000000000001/thumb-0.webp'),
  ('bbbbbbbb-0000-4000-8000-000000000003', 'user_b', 'Flor de B', pruebas.genero('Vanda'), 'unknown', null, null);
insert into public.plants (id, user_id, entered_name, species_id)
values ('aaaaaaaa-0000-4000-8000-000000000002', 'user_a', 'Mi labiata', pruebas.especie('Cattleya labiata'));

insert into storage.objects (bucket_id, name)
values
  ('plant-photos', 'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-0.webp'),
  ('plant-photos', 'user_a/aaaaaaaa-0000-4000-8000-000000000001/thumb-0.webp'),
  ('plant-photos', 'user_a/aaaaaaaa-0000-4000-8000-000000000001/log/photo-1.webp'),
  ('plant-photos', 'user_a/aaaaaaaa-0000-4000-8000-000000000001/log/thumb-1.webp'),
  ('plant-photos', 'user_b/bbbbbbbb-0000-4000-8000-000000000003/log/photo-1.webp');

-- prueba: un registro con lo mínimo: la base pone el dueño, la fecha y deja lo demás sin indicar
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
insert into public.plant_log_entries (plant_id, type, title)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'watering', 'Riego');
select pruebas.iguales(
  'registro',
  (select user_id || ' ' || type || ' ' || title || ' ' || coalesce(description, '-') || ' '
          || coalesce(photo_path, '-') || ' ' || coalesce(in_bloom::text, 'sin indicar') || ' '
          || coalesce(idempotency_key::text, '-') || ' ' || (created_at = now())::text
     from public.plant_log_entries),
  'user_a watering Riego - - sin indicar - true'
);
select pruebas.debe_fallar(
  'authenticated pone la fecha',
  $$insert into public.plant_log_entries (plant_id, type, title, created_at)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'watering', 'Riego', '2020-01-01')$$,
  '42501'
);
select pruebas.debe_fallar(
  'tipo desconocido',
  $$insert into public.plant_log_entries (plant_id, type, title)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'pruning', 'Poda')$$,
  '22P02'
);

-- prueba: título obligatorio de 1 a 120 caracteres, descripción opcional hasta 2000, nunca en blanco
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.debe_funcionar(
  'título de 120 y descripción de 2000',
  $$insert into public.plant_log_entries (plant_id, type, title, description)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'nutrition', repeat('t', 120), repeat('d', 2000))$$
);
select pruebas.debe_funcionar(
  'título de un carácter',
  $$insert into public.plant_log_entries (plant_id, type, title)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'nutrition', 'A')$$
);
select pruebas.debe_fallar(
  'título de 121',
  $$insert into public.plant_log_entries (plant_id, type, title)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'nutrition', repeat('t', 121))$$,
  '23514', 'plant_log_entries_title_valid'
);
select pruebas.debe_fallar(
  'título en blanco',
  $$insert into public.plant_log_entries (plant_id, type, title)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'nutrition', E' \n\t')$$,
  '23514', 'plant_log_entries_title_valid'
);
select pruebas.debe_fallar(
  'sin título',
  $$insert into public.plant_log_entries (plant_id, type) values ('aaaaaaaa-0000-4000-8000-000000000001', 'nutrition')$$,
  '23502'
);
select pruebas.debe_fallar(
  'descripción de 2001',
  $$insert into public.plant_log_entries (plant_id, type, title, description)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'nutrition', 'Abono', repeat('d', 2001))$$,
  '23514', 'plant_log_entries_description_valid'
);
select pruebas.debe_fallar(
  'descripción en blanco',
  $$insert into public.plant_log_entries (plant_id, type, title, description)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'nutrition', 'Abono', '  ')$$,
  '23514', 'plant_log_entries_description_valid'
);

-- prueba: foto: las dos rutas o ninguna, en la carpeta log de la planta y del dueño
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.debe_funcionar(
  'foto y miniatura en log',
  $$insert into public.plant_log_entries (plant_id, type, title, photo_path, thumbnail_path, in_bloom)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'preventive_health', 'Revisión',
            'user_a/aaaaaaaa-0000-4000-8000-000000000001/log/photo-1.webp',
            'user_a/aaaaaaaa-0000-4000-8000-000000000001/log/thumb-1.webp', true)$$
);
select pruebas.debe_fallar(
  'solo la foto',
  $$insert into public.plant_log_entries (plant_id, type, title, photo_path)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'preventive_health', 'Revisión',
            'user_a/aaaaaaaa-0000-4000-8000-000000000001/log/photo-2.webp')$$,
  '23514', 'plant_log_entries_photo_paths_together'
);
select pruebas.debe_fallar(
  'solo la miniatura',
  $$insert into public.plant_log_entries (plant_id, type, title, thumbnail_path)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'preventive_health', 'Revisión',
            'user_a/aaaaaaaa-0000-4000-8000-000000000001/log/thumb-2.webp')$$,
  '23514', 'plant_log_entries_photo_paths_together'
);
select pruebas.debe_fallar(
  'foto fuera de log, en la carpeta de la galería',
  $$insert into public.plant_log_entries (plant_id, type, title, photo_path, thumbnail_path)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'preventive_health', 'Revisión',
            'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-0.webp',
            'user_a/aaaaaaaa-0000-4000-8000-000000000001/log/thumb-2.webp')$$,
  '23514', 'plant_log_entries_photo_path_valid'
);
select pruebas.debe_fallar(
  'miniatura en la carpeta log de otra planta',
  $$insert into public.plant_log_entries (plant_id, type, title, photo_path, thumbnail_path)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'preventive_health', 'Revisión',
            'user_a/aaaaaaaa-0000-4000-8000-000000000001/log/photo-2.webp',
            'user_a/aaaaaaaa-0000-4000-8000-000000000002/log/thumb-2.webp')$$,
  '23514', 'plant_log_entries_thumbnail_path_valid'
);
select pruebas.debe_fallar(
  'foto en la carpeta de otro usuario',
  $$insert into public.plant_log_entries (plant_id, type, title, photo_path, thumbnail_path)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'preventive_health', 'Revisión',
            'user_b/aaaaaaaa-0000-4000-8000-000000000001/log/photo-2.webp',
            'user_a/aaaaaaaa-0000-4000-8000-000000000001/log/thumb-2.webp')$$,
  '23514', 'plant_log_entries_photo_path_valid'
);
select pruebas.debe_fallar(
  'subcarpeta dentro de log',
  $$insert into public.plant_log_entries (plant_id, type, title, photo_path, thumbnail_path)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'preventive_health', 'Revisión',
            'user_a/aaaaaaaa-0000-4000-8000-000000000001/log/x/photo-2.webp',
            'user_a/aaaaaaaa-0000-4000-8000-000000000001/log/thumb-2.webp')$$,
  '23514', 'plant_log_entries_photo_path_valid'
);
select pruebas.debe_fallar(
  'carpeta log sin archivo',
  $$insert into public.plant_log_entries (plant_id, type, title, photo_path, thumbnail_path)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'preventive_health', 'Revisión',
            'user_a/aaaaaaaa-0000-4000-8000-000000000001/log/',
            'user_a/aaaaaaaa-0000-4000-8000-000000000001/log/thumb-2.webp')$$,
  '23514', 'plant_log_entries_photo_path_valid'
);
-- La galería sigue sin admitir rutas con subcarpetas: una foto de bitácora no puede pasar por
-- una foto de la planta (ni contar en las seis ni en photo_count).
select pruebas.debe_fallar(
  'foto de la galería en log',
  $$insert into public.plant_photos (plant_id, photo_path, thumbnail_path, position)
    values ('aaaaaaaa-0000-4000-8000-000000000001',
            'user_a/aaaaaaaa-0000-4000-8000-000000000001/log/photo-1.webp',
            'user_a/aaaaaaaa-0000-4000-8000-000000000001/log/thumb-1.webp', 1)$$,
  '23514', 'plant_photos_photo_path_valid'
);
select pruebas.iguales(
  'photo_count no cuenta la bitácora',
  (select public.photo_count(p) from public.plants p where p.id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  1
);

-- prueba: el dueño del registro es siempre el de la planta
select pruebas.debe_fallar(
  'registro de user_b en una planta de user_a',
  $$insert into public.plant_log_entries (plant_id, user_id, type, title)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'user_b', 'watering', 'Riego')$$,
  '23514', 'plant_log_entries_user_id_matches_plant'
);
-- Sin token ni user_id (clave de servicio, editor SQL), lo toma de la planta.
insert into public.plant_log_entries (plant_id, user_id, type, title)
values ('aaaaaaaa-0000-4000-8000-000000000001', null, 'watering', 'Riego');
select pruebas.iguales('dueño tomado de la planta', (select user_id from public.plant_log_entries), 'user_a');
select pruebas.debe_fallar(
  'planta inexistente',
  $$insert into public.plant_log_entries (plant_id, user_id, type, title)
    values ('dddddddd-0000-4000-8000-000000000009', 'user_a', 'watering', 'Riego')$$,
  '23503'
);
select pruebas.debe_fallar(
  'mover el registro a otra planta de otro dueño',
  $$update public.plant_log_entries set plant_id = 'bbbbbbbb-0000-4000-8000-000000000003'$$,
  '23514', 'plant_log_entries_user_id_matches_plant'
);
-- P2 no tiene fotos: lo que lo impide es la bitácora.
insert into public.plant_log_entries (plant_id, type, title)
values ('aaaaaaaa-0000-4000-8000-000000000002', 'watering', 'Riego');
select pruebas.debe_fallar(
  'una planta con registros no cambia de dueño',
  $$update public.plants set user_id = 'user_b' where id = 'aaaaaaaa-0000-4000-8000-000000000002'$$,
  '23514', 'plant_log_entries_user_id_matches_plant'
);

-- prueba: RLS con dos cuentas: cada usuario lee, crea y borra solo lo suyo, y nadie edita
insert into public.plant_log_entries (plant_id, type, title)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'watering', 'De A'),
       ('bbbbbbbb-0000-4000-8000-000000000003', 'watering', 'De B');
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.iguales('user_a lee', (select string_agg(title, ', ') from public.plant_log_entries), 'De A');
select pruebas.debe_fallar(
  'user_a crea en la planta de user_b a su nombre',
  $$insert into public.plant_log_entries (plant_id, type, title)
    values ('bbbbbbbb-0000-4000-8000-000000000003', 'watering', 'Intruso')$$,
  '23514', 'plant_log_entries_user_id_matches_plant'
);
select pruebas.debe_fallar(
  'user_a crea en la planta de user_b a nombre de user_b',
  $$insert into public.plant_log_entries (plant_id, user_id, type, title)
    values ('bbbbbbbb-0000-4000-8000-000000000003', 'user_b', 'watering', 'Intruso')$$,
  '42501'
);
select pruebas.debe_fallar(
  'user_a edita su registro',
  $$update public.plant_log_entries set title = 'Otro' where title = 'De A'$$,
  '42501'
);
delete from public.plant_log_entries where title = 'De B';
delete from public.plant_log_entries where title = 'De A';
select pruebas.iguales('user_a borra el suyo', (select count(*) from public.plant_log_entries), 0::bigint);
set local request.jwt.claims = '{"sub": "user_b", "role": "authenticated"}';
select pruebas.iguales('el de user_b sigue', (select string_agg(title, ', ') from public.plant_log_entries), 'De B');
set local request.jwt.claims = '{"role": "authenticated"}';
select pruebas.iguales('un token sin sub no lee nada', (select count(*) from public.plant_log_entries), 0::bigint);
select pruebas.debe_fallar(
  'un token sin sub no crea nada',
  $$insert into public.plant_log_entries (plant_id, type, title)
    values ('bbbbbbbb-0000-4000-8000-000000000003', 'watering', 'Sin sub')$$,
  '42501'
);

-- prueba: el administrador del catálogo no ve ni escribe la bitácora, tampoco de plantas por validar; anon nada
insert into public.plant_log_entries (plant_id, type, title)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'watering', 'De A');
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales('el administrador lee', (select count(*) from public.plant_log_entries), 0::bigint);
select pruebas.iguales(
  'el administrador lista',
  (select count(*) from public.list_plant_log_entries('aaaaaaaa-0000-4000-8000-000000000001')),
  0::bigint
);
select pruebas.debe_fallar(
  'el administrador crea',
  $$select public.add_plant_log_entry('aaaaaaaa-0000-4000-8000-000000000001', 'watering', 'Del administrador')$$,
  '23514', 'plant_log_entries_user_id_matches_plant'
);
delete from public.plant_log_entries;
set local role anon;
set local request.jwt.claims = '{"sub": "user_a", "role": "anon"}';
select pruebas.debe_fallar('anon lee', $$select * from public.plant_log_entries$$, '42501');
select pruebas.debe_fallar(
  'anon crea',
  $$insert into public.plant_log_entries (plant_id, type, title) values ('aaaaaaaa-0000-4000-8000-000000000001', 'watering', 'Anon')$$,
  '42501'
);
select pruebas.debe_fallar('anon borra', $$delete from public.plant_log_entries$$, '42501');
select pruebas.debe_fallar(
  'anon llama a add_plant_log_entry',
  $$select public.add_plant_log_entry('aaaaaaaa-0000-4000-8000-000000000001', 'watering', 'Anon')$$,
  '42501'
);
select pruebas.debe_fallar(
  'anon llama a list_plant_log_entries',
  $$select * from public.list_plant_log_entries('aaaaaaaa-0000-4000-8000-000000000001')$$,
  '42501'
);
set local role postgres;
select pruebas.iguales('el registro de A sigue', (select count(*) from public.plant_log_entries), 1::bigint);

-- prueba: privilegios por rol de plant_log_entries
select pruebas.iguales(
  'privilegios de tabla',
  (select string_agg(r.rol || ':' || p.priv || ':' || has_table_privilege(r.rol, 'public.plant_log_entries', p.priv), ', '
                     order by r.rol, p.priv)
     from (values ('anon'), ('authenticated'), ('service_role')) r (rol)
     cross join (values ('select'), ('insert'), ('update'), ('delete'), ('truncate')) p (priv)),
  'anon:delete:false, anon:insert:false, anon:select:false, anon:truncate:false, anon:update:false, '
    || 'authenticated:delete:true, authenticated:insert:false, authenticated:select:true, authenticated:truncate:false, authenticated:update:false, '
    || 'service_role:delete:true, service_role:insert:true, service_role:select:true, service_role:truncate:false, service_role:update:true'
);
select pruebas.iguales(
  'columnas que authenticated puede insertar',
  (select string_agg(a.attname, ', ' order by a.attname)
     from pg_attribute a
     where a.attrelid = 'public.plant_log_entries'::regclass and a.attnum > 0 and not a.attisdropped
       and has_column_privilege('authenticated', 'public.plant_log_entries', a.attname, 'insert')),
  'description, id, idempotency_key, in_bloom, photo_path, plant_id, thumbnail_path, title, type, user_id'
);
select pruebas.iguales(
  'columnas que authenticated puede actualizar',
  (select count(*) from pg_attribute a
     where a.attrelid = 'public.plant_log_entries'::regclass and a.attnum > 0 and not a.attisdropped
       and has_column_privilege('authenticated', 'public.plant_log_entries', a.attname, 'update')),
  0::bigint
);

-- prueba: add_plant_log_entry crea el registro y devuelve la fila
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.iguales(
  'fila devuelta',
  (select r.user_id || ' ' || r.type || ' ' || r.title || ' ' || r.description || ' ' || r.in_bloom::text || ' '
          || r.photo_path
     from public.add_plant_log_entry(
       'aaaaaaaa-0000-4000-8000-000000000001', 'preventive_maintenance', 'Cambio de sustrato', 'Corteza nueva',
       'user_a/aaaaaaaa-0000-4000-8000-000000000001/log/photo-1.webp',
       'user_a/aaaaaaaa-0000-4000-8000-000000000001/log/thumb-1.webp', false,
       'eeeeeeee-0000-4000-8000-000000000001') r),
  'user_a preventive_maintenance Cambio de sustrato Corteza nueva false user_a/aaaaaaaa-0000-4000-8000-000000000001/log/photo-1.webp'
);
select pruebas.iguales('registros', (select count(*) from public.plant_log_entries), 1::bigint);
-- Sin clave, cada llamada es un registro nuevo.
select public.add_plant_log_entry('aaaaaaaa-0000-4000-8000-000000000001', 'watering', 'Riego');
select public.add_plant_log_entry('aaaaaaaa-0000-4000-8000-000000000001', 'watering', 'Riego');
select pruebas.iguales('sin clave', (select count(*) from public.plant_log_entries where title = 'Riego'), 2::bigint);
select pruebas.debe_fallar(
  'restricciones por la función',
  $$select public.add_plant_log_entry('aaaaaaaa-0000-4000-8000-000000000001', 'watering', '   ')$$,
  '23514', 'plant_log_entries_title_valid'
);
select pruebas.debe_fallar(
  'planta de otro usuario',
  $$select public.add_plant_log_entry('bbbbbbbb-0000-4000-8000-000000000003', 'watering', 'Intruso')$$,
  '23514', 'plant_log_entries_user_id_matches_plant'
);

-- prueba: reintento con la misma clave: devuelve el registro existente sin duplicarlo
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
do $$
declare
  primera public.plant_log_entries;
  segunda public.plant_log_entries;
begin
  primera := public.add_plant_log_entry('aaaaaaaa-0000-4000-8000-000000000001', 'watering', 'Riego', null, null, null, null,
                                         'eeeeeeee-0000-4000-8000-000000000001');
  segunda := public.add_plant_log_entry('aaaaaaaa-0000-4000-8000-000000000001', 'nutrition', 'Otro título', 'Otra',
                                         null, null, true, 'eeeeeeee-0000-4000-8000-000000000001');
  perform pruebas.iguales('mismo id', segunda.id, primera.id);
  perform pruebas.iguales('tal como estaba', segunda.type || ' ' || segunda.title, 'watering Riego');
end;
$$;
select pruebas.iguales('un solo registro', (select count(*) from public.plant_log_entries), 1::bigint);
select pruebas.debe_fallar(
  'la misma clave en otra planta',
  $$select public.add_plant_log_entry('aaaaaaaa-0000-4000-8000-000000000002', 'watering', 'Riego', null, null, null, null,
                                      'eeeeeeee-0000-4000-8000-000000000001')$$,
  '22023'
);
select pruebas.debe_fallar(
  'un insert directo con la clave repetida',
  $$insert into public.plant_log_entries (plant_id, type, title, idempotency_key)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'watering', 'Riego', 'eeeeeeee-0000-4000-8000-000000000001')$$,
  '23505', 'plant_log_entries_user_id_idempotency_key_key'
);
-- La clave es única por usuario: otro usuario puede usar la misma.
set local request.jwt.claims = '{"sub": "user_b", "role": "authenticated"}';
select pruebas.iguales(
  'otro usuario con la misma clave',
  (select title from public.add_plant_log_entry('bbbbbbbb-0000-4000-8000-000000000003', 'watering', 'De B', null, null, null,
                                                null, 'eeeeeeee-0000-4000-8000-000000000001')),
  'De B'
);
set local role postgres;
select pruebas.iguales('registros en total', (select count(*) from public.plant_log_entries), 2::bigint);

-- prueba: lectura: de la más reciente a la más antigua, con filtro por tipo y cursor, sin saltos ni repeticiones
-- 25 registros de P1 en fechas distintas (cada quinto es de riego) y tres con la misma fecha,
-- para que decida el id; y uno de otra planta.
insert into public.plant_log_entries (id, plant_id, type, title, created_at)
select ('cccccccc-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'aaaaaaaa-0000-4000-8000-000000000001',
       (case when i % 5 = 0 then 'watering' else 'nutrition' end)::public.plant_log_entry_type,
       'R' || i, '2026-11-01'::timestamptz + make_interval(hours => i)
  from generate_series(1, 25) i;
insert into public.plant_log_entries (id, plant_id, type, title, created_at)
values ('cccccccc-0000-4000-8000-100000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'watering', 'Mismo 1', '2026-12-01'),
       ('cccccccc-0000-4000-8000-100000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'watering', 'Mismo 3', '2026-12-01'),
       ('cccccccc-0000-4000-8000-100000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'watering', 'Mismo 2', '2026-12-01'),
       ('cccccccc-0000-4000-8000-200000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'watering', 'Otra planta', '2026-12-02');
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.iguales(
  'primera página de 5',
  (select string_agg(title, ', ') from public.list_plant_log_entries('aaaaaaaa-0000-4000-8000-000000000001', page_size => 5)),
  'Mismo 3, Mismo 2, Mismo 1, R25, R24'
);
-- Recorre todas las páginas de 4 con el cursor de la última fila.
do $$
declare
  cursor_at timestamptz;
  cursor_id uuid;
  seen text[] := '{}';
  page_rows integer;
  pages integer := 0;
  r record;
begin
  loop
    page_rows := 0;
    for r in select * from public.list_plant_log_entries('aaaaaaaa-0000-4000-8000-000000000001', null, cursor_at, cursor_id, 4)
    loop
      seen := seen || r.title;
      cursor_at := r.created_at;
      cursor_id := r.id;
      page_rows := page_rows + 1;
    end loop;
    pages := pages + 1;
    exit when page_rows < 4;
  end loop;
  -- Siete páginas llenas y una vacía, que dice que no hay más.
  perform pruebas.iguales('páginas', pages, 8);
  perform pruebas.iguales(
    'todos, en orden y una vez',
    array_to_string(seen, ','),
    'Mismo 3,Mismo 2,Mismo 1,R25,R24,R23,R22,R21,R20,R19,R18,R17,R16,R15,R14,R13,R12,R11,R10,R9,R8,R7,R6,R5,R4,R3,R2,R1'
  );
end;
$$;
select pruebas.iguales(
  'solo riego',
  (select string_agg(title, ', ') from public.list_plant_log_entries('aaaaaaaa-0000-4000-8000-000000000001', 'watering')),
  'Mismo 3, Mismo 2, Mismo 1, R25, R20, R15, R10, R5'
);
select pruebas.iguales(
  'solo riego después de R20',
  (select string_agg(title, ', ')
     from public.list_plant_log_entries('aaaaaaaa-0000-4000-8000-000000000001', 'watering',
                                        '2026-11-01'::timestamptz + interval '20 hours',
                                        'cccccccc-0000-4000-8000-000000000020', 2)),
  'R15, R10'
);
select pruebas.iguales(
  'tamaño por defecto 20, máximo 100, mínimo 1',
  (select string_agg(n::text, ', ')
     from (values
       ((select count(*) from public.list_plant_log_entries('aaaaaaaa-0000-4000-8000-000000000001'))),
       ((select count(*) from public.list_plant_log_entries('aaaaaaaa-0000-4000-8000-000000000001', page_size => 1000))),
       ((select count(*) from public.list_plant_log_entries('aaaaaaaa-0000-4000-8000-000000000001', page_size => 0))),
       ((select count(*) from public.list_plant_log_entries('aaaaaaaa-0000-4000-8000-000000000001', page_size => null)))
     ) v (n)),
  '20, 28, 1, 20'
);
select pruebas.debe_fallar(
  'cursor a medias',
  $$select * from public.list_plant_log_entries('aaaaaaaa-0000-4000-8000-000000000001', null, now(), null)$$,
  '22023'
);
select pruebas.iguales(
  'planta inexistente o nula',
  (select count(*) from public.list_plant_log_entries('dddddddd-0000-4000-8000-000000000009'))
    + (select count(*) from public.list_plant_log_entries(null)),
  0::bigint
);
set local request.jwt.claims = '{"sub": "user_b", "role": "authenticated"}';
select pruebas.iguales(
  'user_b lista la planta de user_a',
  (select count(*) from public.list_plant_log_entries('aaaaaaaa-0000-4000-8000-000000000001')),
  0::bigint
);

-- prueba: add_plant_log_entry y list_plant_log_entries: security invoker, search_path fijo y solo para authenticated
select pruebas.iguales(
  'propiedades',
  (select string_agg(p.proname || ' definer=' || p.prosecdef::text || ' ' || p.provolatile::text || ' ' || array_to_string(p.proconfig, ','),
                     '; ' order by p.proname)
     from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname in ('add_plant_log_entry', 'list_plant_log_entries')),
  'add_plant_log_entry definer=false v search_path=""; list_plant_log_entries definer=false s search_path=""'
);
select pruebas.iguales(
  'quién las ejecuta',
  (select string_agg(p.proname || ':' || r.rol || '=' || has_function_privilege(r.rol, p.oid, 'execute'), ', '
                     order by p.proname, r.rol)
     from pg_proc p
     cross join (values ('anon'), ('authenticated'), ('service_role')) r (rol)
     where p.pronamespace = 'public'::regnamespace and p.proname in ('add_plant_log_entry', 'list_plant_log_entries')),
  'add_plant_log_entry:anon=false, add_plant_log_entry:authenticated=true, add_plant_log_entry:service_role=false, '
    || 'list_plant_log_entries:anon=false, list_plant_log_entries:authenticated=true, list_plant_log_entries:service_role=true'
);

-- prueba: al borrar la planta se borran sus registros; al borrar las plantas de la cuenta, todos
insert into public.plant_log_entries (plant_id, type, title)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'watering', 'P1'),
       ('aaaaaaaa-0000-4000-8000-000000000002', 'watering', 'P2'),
       ('bbbbbbbb-0000-4000-8000-000000000003', 'watering', 'P3');
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
delete from public.plants where id = 'aaaaaaaa-0000-4000-8000-000000000001';
set local role postgres;
select pruebas.iguales('tras borrar P1', (select string_agg(title, ', ' order by title) from public.plant_log_entries), 'P2, P3');
-- La eliminación de cuenta: fotos, plantas y perfil, con el token del usuario.
insert into public.profiles (id) values ('user_a');
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
delete from public.plants where user_id = 'user_a';
delete from public.profiles where id = 'user_a';
set local role postgres;
select pruebas.iguales('tras eliminar la cuenta de user_a', (select string_agg(title, ', ') from public.plant_log_entries), 'P3');
select pruebas.iguales(
  'contadores de user_a',
  (select count(*) from private.plant_code_counters where user_id = 'user_a'),
  0::bigint
);

-- prueba: fotos de la bitácora: el dueño las sube, lee y borra; otro usuario y anon no
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.iguales(
  'user_a ve sus fotos de bitácora',
  (select string_agg(substr(name, 45), ', ' order by name) from storage.objects where name like '%/log/%'),
  'log/photo-1.webp, log/thumb-1.webp'
);
select pruebas.debe_funcionar(
  'user_a sube a su carpeta log',
  $$insert into storage.objects (bucket_id, name) values ('plant-photos', 'user_a/aaaaaaaa-0000-4000-8000-000000000001/log/photo-2.webp')$$
);
select pruebas.debe_fallar(
  'user_a sube a la carpeta log de user_b',
  $$insert into storage.objects (bucket_id, name) values ('plant-photos', 'user_b/bbbbbbbb-0000-4000-8000-000000000003/log/photo-2.webp')$$,
  '42501'
);
set local storage.allow_delete_query = 'true';
delete from storage.objects where name like 'user_b/%';
delete from storage.objects where name = 'user_a/aaaaaaaa-0000-4000-8000-000000000001/log/photo-2.webp';
set local request.jwt.claims = '{"sub": "user_b", "role": "authenticated"}';
select pruebas.iguales('user_b ve de user_a', (select count(*) from storage.objects where name like 'user_a/%'), 0::bigint);
select pruebas.iguales('user_b conserva la suya', (select count(*) from storage.objects where name like 'user_b/%/log/%'), 1::bigint);
set local role anon;
set local request.jwt.claims = '{"sub": "user_a", "role": "anon"}';
select pruebas.iguales('anon ve', (select count(*) from storage.objects), 0::bigint);
set local role postgres;
select pruebas.iguales(
  'objetos tras los borrados',
  (select count(*) from storage.objects where name like '%/log/%'),
  3::bigint
);

-- prueba: el administrador nunca ve una foto de bitácora, aunque la planta esté por validar
-- P1 está por validar, y su foto principal sí la ve: las de su carpeta log, no.
insert into public.plant_log_entries (plant_id, type, title, photo_path, thumbnail_path)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'preventive_health', 'Con foto',
        'user_a/aaaaaaaa-0000-4000-8000-000000000001/log/photo-1.webp',
        'user_a/aaaaaaaa-0000-4000-8000-000000000001/log/thumb-1.webp');
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'objetos visibles para el administrador',
  (select string_agg(name, ', ' order by name) from storage.objects),
  'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-0.webp, user_a/aaaaaaaa-0000-4000-8000-000000000001/thumb-0.webp'
);
select pruebas.iguales(
  'is_pending_plant_photo con rutas de bitácora',
  (select string_agg(public.is_pending_plant_photo(r)::text, ', ' order by r)
     from unnest(array[
       'user_a/aaaaaaaa-0000-4000-8000-000000000001/log/photo-1.webp',
       'user_a/aaaaaaaa-0000-4000-8000-000000000001/log/thumb-1.webp',
       'user_b/bbbbbbbb-0000-4000-8000-000000000003/log/photo-1.webp',
       'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-0.webp'
     ]) r),
  'false, false, true, false'
);
-- Defensa en profundidad: aunque la planta llegara a apuntar su foto principal a una foto de
-- bitácora (solo se puede saltándose la sincronización, como en fotos_storage.sql), la ruta
-- tiene subcarpetas y no se abre.
set local role postgres;
set local orki.photo_sync = 'on';
update public.plants
  set photo_path = 'user_a/aaaaaaaa-0000-4000-8000-000000000001/log/photo-1.webp',
      thumbnail_path = 'user_a/aaaaaaaa-0000-4000-8000-000000000001/log/thumb-1.webp'
  where id = 'aaaaaaaa-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'fotos de bitácora visibles con la planta apuntando a ellas',
  (select count(*) from storage.objects where name like '%/log/%'),
  0::bigint
);
select pruebas.iguales(
  'is_pending_plant_photo con la planta apuntando a ellas',
  public.is_pending_plant_photo('user_a/aaaaaaaa-0000-4000-8000-000000000001/log/photo-1.webp'),
  false
);

-- prueba: la lectura de una planta usa el índice de la bitácora, con y sin tipo
-- 200 plantas de user_a con 30 registros cada una, y estadísticas.
insert into public.plants (id, user_id, entered_name, genus_id, type)
select ('ffffffff-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'user_a', 'Relleno ' || i, pruebas.genero('Vanda'), 'unknown'
  from generate_series(1, 200) i;
insert into public.plant_log_entries (plant_id, type, title, created_at)
select p.id, (enum_range(null::public.plant_log_entry_type))[1 + n % 4], 'R' || n, now() - make_interval(days => n)
  from public.plants p cross join generate_series(1, 30) n
  where p.entered_name like 'Relleno %';
analyze public.plants;
analyze public.plant_log_entries;
do $$
declare
  plan text;
  linea text;
  consulta text;
begin
  foreach consulta in array array[
    $q$select e.* from public.plant_log_entries e
        where e.plant_id = 'ffffffff-0000-4000-8000-000000000007'::uuid
        order by e.created_at desc, e.id desc limit 20$q$,
    $q$select e.* from public.plant_log_entries e
        where e.plant_id = 'ffffffff-0000-4000-8000-000000000007'::uuid and e.type = 'watering'
        order by e.created_at desc, e.id desc limit 20$q$,
    $q$select e.* from public.plant_log_entries e
        where e.plant_id = 'ffffffff-0000-4000-8000-000000000007'::uuid
          and (e.created_at, e.id) < (now() - interval '10 days', 'ffffffff-0000-4000-8000-000000000000'::uuid)
        order by e.created_at desc, e.id desc limit 20$q$
  ] loop
    plan := '';
    for linea in execute 'explain ' || consulta loop
      plan := plan || linea || E'\n';
    end loop;
    perform pruebas.comprobar('usa plant_log_entries_plant_id_created_at_idx:' || E'\n' || plan,
                              plan like '%plant_log_entries_plant_id_created_at_idx%');
    perform pruebas.comprobar('no ordena:' || E'\n' || plan, plan not like '%Sort%');
    perform pruebas.comprobar('no recorre la tabla:' || E'\n' || plan, plan not like '%Seq Scan%');
  end loop;
end;
$$;
