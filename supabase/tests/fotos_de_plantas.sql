-- Varias fotos por planta: public.plant_photos (issue #182, parte de #181).
--
-- Restricciones, dueño y rutas, máximo de 6, sincronización en los dos sentidos con las
-- columnas de foto de plants (incluido lo que hace la app antigua, que solo escribe plants),
-- cascada, RLS con dos cuentas y el administrador, y la copia de las fotos existentes.
--
-- Las peticiones de la API se reproducen con "set local role" y "set local request.jwt.claims";
-- para mirar la tabla sin RLS se vuelve a "set local role postgres". No se puede probar aquí la
-- concurrencia real (cada prueba es una sola sesión): el máximo con inserciones concurrentes
-- se apoya en el rango de position y en su índice único (ver la migración), y lo prueba con
-- dos sesiones concurrencia.test.mjs (npm run db:concurrencia).
--
-- Datos de partida, insertados como postgres con marcas de tiempo antiguas (al insertar no
-- actúa set_updated_at), para ver cuándo cambia updated_at. Las plantas con foto se crean con
-- photo_path y thumbnail_path, como la app antigua, y eso crea su principal en plant_photos:
--   - user_a: A1 por validar, sin fotos y con photo_in_bloom (como queda al registrar una planta
--     "en floración" antes de subir la foto); A2 por validar, sin fotos; A4 por validar, con
--     dos fotos (la principal en floración y con fecha y nota, y otra en la posición 4).
--   - user_b: B1 por validar, con dos fotos (la principal en floración); B2 validada, con una.

insert into public.species (scientific_name, genus_id, type, status, source)
values ('Cattleya labiata', pruebas.genero('Cattleya'), 'species', 'validated', 'curated');

insert into public.plants
  (id, user_id, entered_name, genus_id, type, photo_in_bloom, photo_path, thumbnail_path, created_at, updated_at)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'user_a', 'Planta A1', pruebas.genero('Vanda'), 'unknown', true,
   null, null, '2000-01-01', '2000-01-01'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'user_a', 'Planta A2', pruebas.genero('Vanda'), 'unknown', false,
   null, null, '2000-01-01', '2000-01-01'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'user_a', 'Planta A4', pruebas.genero('Vanda'), 'unknown', true,
   'user_a/aaaaaaaa-0000-4000-8000-000000000004/photo-0.webp',
   'user_a/aaaaaaaa-0000-4000-8000-000000000004/thumb-0.webp', '2000-01-01', '2000-01-01'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'user_b', 'Planta B1', pruebas.genero('Vanda'), 'unknown', true,
   'user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-1.webp',
   'user_b/bbbbbbbb-0000-4000-8000-000000000001/thumb-1.webp', '2000-01-01', '2000-01-01');
insert into public.plants
  (id, user_id, entered_name, genus_id, type, species_id, photo_path, thumbnail_path, created_at, updated_at)
values
  ('bbbbbbbb-0000-4000-8000-000000000002', 'user_b', 'Planta B2', pruebas.genero('Cattleya'), 'species',
   pruebas.especie('Cattleya labiata'),
   'user_b/bbbbbbbb-0000-4000-8000-000000000002/photo-1.webp',
   'user_b/bbbbbbbb-0000-4000-8000-000000000002/thumb-1.webp', '2000-01-01', '2000-01-01');

insert into public.plant_photos (plant_id, photo_path, thumbnail_path, in_bloom, position, note, taken_at)
values
  ('aaaaaaaa-0000-4000-8000-000000000004',
   'user_a/aaaaaaaa-0000-4000-8000-000000000004/photo-4.webp',
   'user_a/aaaaaaaa-0000-4000-8000-000000000004/thumb-4.webp', false, 4, 'Otra', '2026-01-01'),
  ('bbbbbbbb-0000-4000-8000-000000000001',
   'user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-2.webp',
   'user_b/bbbbbbbb-0000-4000-8000-000000000001/thumb-2.webp', false, 1, null, null);
update public.plant_photos set note = 'Nota de la principal', taken_at = '2026-02-01'
  where plant_id = 'aaaaaaaa-0000-4000-8000-000000000004' and position = 0;

-- prueba: las fotos de partida quedan en plant_photos y su principal en plants, sin tocar updated_at
select pruebas.iguales(
  'fotos de partida',
  (select string_agg(row(p.entered_name, f.user_id, f.position, f.photo_path, f.thumbnail_path, f.in_bloom)::text,
                     '; ' order by p.entered_name, f.position)
     from public.plant_photos f join public.plants p on p.id = f.plant_id),
  '("Planta A4",user_a,0,user_a/aaaaaaaa-0000-4000-8000-000000000004/photo-0.webp,user_a/aaaaaaaa-0000-4000-8000-000000000004/thumb-0.webp,t); '
    || '("Planta A4",user_a,4,user_a/aaaaaaaa-0000-4000-8000-000000000004/photo-4.webp,user_a/aaaaaaaa-0000-4000-8000-000000000004/thumb-4.webp,f); '
    || '("Planta B1",user_b,0,user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-1.webp,user_b/bbbbbbbb-0000-4000-8000-000000000001/thumb-1.webp,t); '
    || '("Planta B1",user_b,1,user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-2.webp,user_b/bbbbbbbb-0000-4000-8000-000000000001/thumb-2.webp,f); '
    || '("Planta B2",user_b,0,user_b/bbbbbbbb-0000-4000-8000-000000000002/photo-1.webp,user_b/bbbbbbbb-0000-4000-8000-000000000002/thumb-1.webp,f)'
);
select pruebas.iguales(
  'columnas de foto de las plantas',
  (select string_agg(entered_name || ': ' || coalesce(photo_path, '-') || ' ' || photo_in_bloom::text
                     || ' ' || updated_at::date::text, '; ' order by entered_name)
     from public.plants),
  'Planta A1: - true 2000-01-01; Planta A2: - false 2000-01-01; '
    || 'Planta A4: user_a/aaaaaaaa-0000-4000-8000-000000000004/photo-0.webp true 2000-01-01; '
    || 'Planta B1: user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-1.webp true 2000-01-01; '
    || 'Planta B2: user_b/bbbbbbbb-0000-4000-8000-000000000002/photo-1.webp false 2000-01-01'
);
select pruebas.iguales(
  'la marca de sincronización queda vacía',
  coalesce(current_setting('orki.photo_sync', true), ''),
  ''
);

-- Restricciones ----------------------------------------------------------------------------

-- prueba: position va de 0 a 5 y no se repite en la misma planta
select pruebas.debe_fallar(
  'posición -1',
  $$insert into public.plant_photos (plant_id, photo_path, thumbnail_path, position)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'user_a/aaaaaaaa-0000-4000-8000-000000000001/p.webp',
            'user_a/aaaaaaaa-0000-4000-8000-000000000001/t.webp', -1)$$,
  '23514', 'plant_photos_position_range'
);
select pruebas.debe_fallar(
  'posición 6',
  $$insert into public.plant_photos (plant_id, photo_path, thumbnail_path, position)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'user_a/aaaaaaaa-0000-4000-8000-000000000001/p.webp',
            'user_a/aaaaaaaa-0000-4000-8000-000000000001/t.webp', 6)$$,
  '23514', 'plant_photos_position_range'
);
select pruebas.debe_fallar(
  'posición repetida en la misma planta',
  $$insert into public.plant_photos (plant_id, photo_path, thumbnail_path, position)
    values ('bbbbbbbb-0000-4000-8000-000000000001', 'user_b/bbbbbbbb-0000-4000-8000-000000000001/p.webp',
            'user_b/bbbbbbbb-0000-4000-8000-000000000001/t.webp', 1)$$,
  '23505', 'plant_photos_plant_id_position_key'
);
select pruebas.debe_funcionar(
  'la misma posición en otra planta',
  $$insert into public.plant_photos (plant_id, photo_path, thumbnail_path, position)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'user_a/aaaaaaaa-0000-4000-8000-000000000001/p.webp',
            'user_a/aaaaaaaa-0000-4000-8000-000000000001/t.webp', 1)$$
);
select pruebas.debe_fallar(
  'sin posición',
  $$insert into public.plant_photos (plant_id, photo_path, thumbnail_path)
    values ('aaaaaaaa-0000-4000-8000-000000000002', 'user_a/aaaaaaaa-0000-4000-8000-000000000002/p.webp',
            'user_a/aaaaaaaa-0000-4000-8000-000000000002/t.webp')$$,
  '23502'
);

-- prueba: como mucho 6 fotos por planta
insert into public.plant_photos (plant_id, photo_path, thumbnail_path, position)
select 'aaaaaaaa-0000-4000-8000-000000000002',
       'user_a/aaaaaaaa-0000-4000-8000-000000000002/photo-' || n || '.webp',
       'user_a/aaaaaaaa-0000-4000-8000-000000000002/thumb-' || n || '.webp', n
  from generate_series(0, 5) n;
select pruebas.iguales(
  'fotos de A2',
  (select count(*) from public.plant_photos where plant_id = 'aaaaaaaa-0000-4000-8000-000000000002'),
  6::bigint
);
do $$
declare
  posicion integer;
begin
  for posicion in 0..5 loop
    perform pruebas.debe_fallar(
      'séptima foto en la posición ' || posicion,
      format($q$insert into public.plant_photos (plant_id, photo_path, thumbnail_path, position)
                values ('aaaaaaaa-0000-4000-8000-000000000002', 'user_a/aaaaaaaa-0000-4000-8000-000000000002/photo-x.webp',
                        'user_a/aaaaaaaa-0000-4000-8000-000000000002/thumb-x.webp', %s)$q$, posicion),
      '23505', 'plant_photos_plant_id_position_key'
    );
  end loop;
end;
$$;
select pruebas.debe_fallar(
  'séptima foto en la posición 6',
  $$insert into public.plant_photos (plant_id, photo_path, thumbnail_path, position)
    values ('aaaaaaaa-0000-4000-8000-000000000002', 'user_a/aaaaaaaa-0000-4000-8000-000000000002/photo-x.webp',
            'user_a/aaaaaaaa-0000-4000-8000-000000000002/thumb-x.webp', 6)$$,
  '23514', 'plant_photos_position_range'
);
-- La app antigua tampoco añade una séptima: con fotos, poner la foto sustituye la principal.
update public.plants
  set photo_path = 'user_a/aaaaaaaa-0000-4000-8000-000000000002/photo-nueva.webp',
      thumbnail_path = 'user_a/aaaaaaaa-0000-4000-8000-000000000002/thumb-nueva.webp'
  where id = 'aaaaaaaa-0000-4000-8000-000000000002';
select pruebas.iguales(
  'fotos de A2 tras poner la foto desde plants',
  (select count(*) from public.plant_photos where plant_id = 'aaaaaaaa-0000-4000-8000-000000000002'),
  6::bigint
);

-- prueba: las rutas están en la carpeta de la planta y de su dueño, con un nombre de archivo
do $$
declare
  ruta text;
begin
  foreach ruta in array array[
    'user_b/aaaaaaaa-0000-4000-8000-000000000001/p.webp',  -- carpeta de otro usuario
    'user_a/aaaaaaaa-0000-4000-8000-000000000002/p.webp',  -- otra planta del mismo usuario
    'user_a/AAAAAAAA-0000-4000-8000-000000000001/p.webp',  -- uuid en mayúsculas
    'user_a/aaaaaaaa-0000-4000-8000-000000000001/',        -- sin nombre de archivo
    'user_a/aaaaaaaa-0000-4000-8000-000000000001/x/p.webp',-- subcarpeta
    'aaaaaaaa-0000-4000-8000-000000000001/p.webp',         -- sin usuario
    'p.webp',
    ''
  ] loop
    perform pruebas.debe_fallar(
      'foto en «' || ruta || '»',
      format($q$insert into public.plant_photos (plant_id, photo_path, thumbnail_path, position)
                values ('aaaaaaaa-0000-4000-8000-000000000001', %L, 'user_a/aaaaaaaa-0000-4000-8000-000000000001/t.webp', 0)$q$, ruta),
      '23514', 'plant_photos_photo_path_valid'
    );
    perform pruebas.debe_fallar(
      'miniatura en «' || ruta || '»',
      format($q$insert into public.plant_photos (plant_id, photo_path, thumbnail_path, position)
                values ('aaaaaaaa-0000-4000-8000-000000000001', 'user_a/aaaaaaaa-0000-4000-8000-000000000001/p.webp', %L, 0)$q$, ruta),
      '23514', 'plant_photos_thumbnail_path_valid'
    );
  end loop;
end;
$$;
select pruebas.debe_fallar(
  'ruta de 1025 caracteres',
  $$insert into public.plant_photos (plant_id, photo_path, thumbnail_path, position)
    values ('aaaaaaaa-0000-4000-8000-000000000001',
            'user_a/aaaaaaaa-0000-4000-8000-000000000001/' || repeat('a', 1025 - 44),
            'user_a/aaaaaaaa-0000-4000-8000-000000000001/t.webp', 0)$$,
  '23514', 'plant_photos_photo_path_valid'
);
select pruebas.debe_funcionar(
  'ruta de 1024 caracteres',
  $$insert into public.plant_photos (plant_id, photo_path, thumbnail_path, position)
    values ('aaaaaaaa-0000-4000-8000-000000000001',
            'user_a/aaaaaaaa-0000-4000-8000-000000000001/' || repeat('a', 1024 - 44),
            'user_a/aaaaaaaa-0000-4000-8000-000000000001/t.webp', 0)$$
);
select pruebas.debe_fallar(
  'sin miniatura',
  $$insert into public.plant_photos (plant_id, photo_path, position)
    values ('aaaaaaaa-0000-4000-8000-000000000002', 'user_a/aaaaaaaa-0000-4000-8000-000000000002/p.webp', 0)$$,
  '23502'
);
-- Un id de usuario con comodines de like no abre otras carpetas.
insert into public.plants (id, user_id, entered_name, genus_id, type)
values ('dddddddd-0000-4000-8000-000000000001', 'user_%', 'Comodín', pruebas.genero('Vanda'), 'unknown');
select pruebas.debe_fallar(
  'usuario con «%» y ruta de otra carpeta',
  $$insert into public.plant_photos (plant_id, photo_path, thumbnail_path, position)
    values ('dddddddd-0000-4000-8000-000000000001', 'user_x/dddddddd-0000-4000-8000-000000000001/p.webp',
            'user_%/dddddddd-0000-4000-8000-000000000001/t.webp', 0)$$,
  '23514', 'plant_photos_photo_path_valid'
);

-- prueba: la nota no queda en blanco ni pasa de 500 caracteres y la fecha no es futura
select pruebas.debe_fallar(
  'nota en blanco',
  $$update public.plant_photos set note = '  ' where position = 1 and plant_id = 'bbbbbbbb-0000-4000-8000-000000000001'$$,
  '23514', 'plant_photos_note_valid'
);
select pruebas.debe_fallar(
  'nota de 501 caracteres',
  $$update public.plant_photos set note = repeat('a', 501) where position = 1 and plant_id = 'bbbbbbbb-0000-4000-8000-000000000001'$$,
  '23514', 'plant_photos_note_valid'
);
select pruebas.debe_funcionar(
  'nota de 500 caracteres y fecha de mañana',
  $$update public.plant_photos set note = repeat('a', 500), taken_at = current_date + 1
    where position = 1 and plant_id = 'bbbbbbbb-0000-4000-8000-000000000001'$$
);
select pruebas.debe_fallar(
  'fecha de pasado mañana',
  $$update public.plant_photos set taken_at = current_date + 2 where position = 1 and plant_id = 'bbbbbbbb-0000-4000-8000-000000000001'$$,
  '23514', 'plant_photos_taken_at_not_future'
);
select pruebas.iguales(
  'valores por defecto',
  (select row(in_bloom, taken_at, note, created_at = now(), id is not null)::text
     from public.plant_photos where plant_id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  '(f,,,t,t)'
);

-- Dueño ------------------------------------------------------------------------------------

-- prueba: el dueño de la foto es siempre el de la planta
select pruebas.debe_fallar(
  'foto de user_b en una planta de user_a',
  $$insert into public.plant_photos (plant_id, user_id, photo_path, thumbnail_path, position)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'user_b',
            'user_b/aaaaaaaa-0000-4000-8000-000000000001/p.webp', 'user_b/aaaaaaaa-0000-4000-8000-000000000001/t.webp', 0)$$,
  '23514', 'plant_photos_user_id_matches_plant'
);
-- Sin token (clave de servicio, editor SQL) y sin user_id, lo toma de la planta.
insert into public.plant_photos (plant_id, photo_path, thumbnail_path, position)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'user_a/aaaaaaaa-0000-4000-8000-000000000001/p.webp',
        'user_a/aaaaaaaa-0000-4000-8000-000000000001/t.webp', 0);
select pruebas.iguales(
  'dueño tomado de la planta',
  (select user_id from public.plant_photos where plant_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'user_a'
);
select pruebas.debe_fallar(
  'cambiar el dueño de la foto',
  $$update public.plant_photos set user_id = 'user_b' where plant_id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '23514', 'plant_photos_user_id_matches_plant'
);
select pruebas.debe_fallar(
  'pasar la foto a una planta de otro usuario',
  $$update public.plant_photos set plant_id = 'bbbbbbbb-0000-4000-8000-000000000002' where plant_id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '23514', 'plant_photos_user_id_matches_plant'
);
select pruebas.debe_fallar(
  'foto de una planta que no existe',
  $$insert into public.plant_photos (plant_id, user_id, photo_path, thumbnail_path, position)
    values ('eeeeeeee-0000-4000-8000-000000000001', 'user_a',
            'user_a/eeeeeeee-0000-4000-8000-000000000001/p.webp', 'user_a/eeeeeeee-0000-4000-8000-000000000001/t.webp', 0)$$,
  '23503'
);

-- prueba: una planta con fotos no cambia de dueño; sin fotos, sí
select pruebas.debe_fallar(
  'cambiar el dueño de B1, que tiene fotos',
  $$update public.plants set user_id = 'user_c' where id = 'bbbbbbbb-0000-4000-8000-000000000001'$$,
  '23514', 'plant_photos_user_id_matches_plant'
);
select pruebas.debe_funcionar(
  'cambiar el dueño de A1, sin fotos',
  $$update public.plants set user_id = 'user_c' where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$
);

-- Sincronización: de plant_photos a plants ------------------------------------------------

-- prueba: la primera foto pasa a plants; otra que no es la principal no toca la planta
insert into public.plant_photos (plant_id, photo_path, thumbnail_path, in_bloom, position)
values ('aaaaaaaa-0000-4000-8000-000000000002', 'user_a/aaaaaaaa-0000-4000-8000-000000000002/photo-2.webp',
        'user_a/aaaaaaaa-0000-4000-8000-000000000002/thumb-2.webp', false, 2);
select pruebas.iguales(
  'A2 con su primera foto (en la posición 2)',
  (select row(photo_path, thumbnail_path, photo_in_bloom, updated_at = now())::text
     from public.plants where id = 'aaaaaaaa-0000-4000-8000-000000000002'),
  '(user_a/aaaaaaaa-0000-4000-8000-000000000002/photo-2.webp,user_a/aaaaaaaa-0000-4000-8000-000000000002/thumb-2.webp,f,t)'
);
insert into public.plant_photos (plant_id, photo_path, thumbnail_path, in_bloom, position)
values ('bbbbbbbb-0000-4000-8000-000000000001', 'user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-3.webp',
        'user_b/bbbbbbbb-0000-4000-8000-000000000001/thumb-3.webp', false, 3);
select pruebas.iguales(
  'B1 tras añadir una foto que no es la principal',
  (select row(photo_path, photo_in_bloom, updated_at)::text
     from public.plants where id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  '(user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-1.webp,t,"2000-01-01 00:00:00+00")'
);
-- Una foto en una posición más baja pasa a ser la principal.
insert into public.plant_photos (plant_id, photo_path, thumbnail_path, in_bloom, position)
values ('aaaaaaaa-0000-4000-8000-000000000002', 'user_a/aaaaaaaa-0000-4000-8000-000000000002/photo-0.webp',
        'user_a/aaaaaaaa-0000-4000-8000-000000000002/thumb-0.webp', true, 0);
select pruebas.iguales(
  'A2 con una foto delante',
  (select row(photo_path, thumbnail_path, photo_in_bloom)::text from public.plants where id = 'aaaaaaaa-0000-4000-8000-000000000002'),
  '(user_a/aaaaaaaa-0000-4000-8000-000000000002/photo-0.webp,user_a/aaaaaaaa-0000-4000-8000-000000000002/thumb-0.webp,t)'
);

-- prueba: reordenar con un solo update cambia la principal
update public.plant_photos
  set position = case position when 0 then 1 else 0 end
  where plant_id = 'bbbbbbbb-0000-4000-8000-000000000001' and position in (0, 1);
select pruebas.iguales(
  'fotos de B1 en orden',
  (select string_agg(position || ':' || photo_path, ', ' order by position)
     from public.plant_photos where plant_id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  '0:user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-2.webp, 1:user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-1.webp'
);
select pruebas.iguales(
  'B1 tras el cambio de orden',
  (select row(photo_path, thumbnail_path, photo_in_bloom, updated_at = now())::text
     from public.plants where id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  '(user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-2.webp,user_b/bbbbbbbb-0000-4000-8000-000000000001/thumb-2.webp,f,t)'
);
-- Llevar la última al principio, moviendo las demás, también en un solo update.
insert into public.plant_photos (plant_id, photo_path, thumbnail_path, position)
values ('bbbbbbbb-0000-4000-8000-000000000001', 'user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-3.webp',
        'user_b/bbbbbbbb-0000-4000-8000-000000000001/thumb-3.webp', 3);
update public.plant_photos
  set position = case position when 3 then 0 else position + 1 end
  where plant_id = 'bbbbbbbb-0000-4000-8000-000000000001';
select pruebas.iguales(
  'B1 con la última al principio',
  (select photo_path from public.plants where id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  'user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-3.webp'
);

-- prueba: cambiar in_bloom o las rutas de la principal se copia; de otra foto, no
update public.plant_photos set in_bloom = true
  where plant_id = 'bbbbbbbb-0000-4000-8000-000000000002';
select pruebas.iguales(
  'B2 en floración',
  (select row(photo_in_bloom, updated_at = now())::text from public.plants where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  '(t,t)'
);
update public.plant_photos
  set photo_path = 'user_b/bbbbbbbb-0000-4000-8000-000000000002/photo-9.webp',
      thumbnail_path = 'user_b/bbbbbbbb-0000-4000-8000-000000000002/thumb-9.webp'
  where plant_id = 'bbbbbbbb-0000-4000-8000-000000000002';
select pruebas.iguales(
  'B2 con las rutas nuevas',
  (select photo_path || ' ' || thumbnail_path from public.plants where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  'user_b/bbbbbbbb-0000-4000-8000-000000000002/photo-9.webp user_b/bbbbbbbb-0000-4000-8000-000000000002/thumb-9.webp'
);
update public.plant_photos set in_bloom = true, note = 'Segunda vara', taken_at = '2026-10-01'
  where plant_id = 'bbbbbbbb-0000-4000-8000-000000000001' and position = 1;
select pruebas.iguales(
  'B1 tras marcar en floración una foto que no es la principal',
  (select row(photo_path, photo_in_bloom, updated_at)::text from public.plants where id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  '(user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-1.webp,t,"2000-01-01 00:00:00+00")'
);

-- prueba: al borrar la principal pasa a serlo la siguiente; sin fotos, la planta queda sin foto
delete from public.plant_photos
  where plant_id = 'bbbbbbbb-0000-4000-8000-000000000001' and position = 0;
select pruebas.iguales(
  'B1 tras borrar la principal',
  (select row(photo_path, thumbnail_path, photo_in_bloom)::text from public.plants where id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  '(user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-2.webp,user_b/bbbbbbbb-0000-4000-8000-000000000001/thumb-2.webp,f)'
);
delete from public.plant_photos where plant_id = 'bbbbbbbb-0000-4000-8000-000000000001';
select pruebas.iguales(
  'B1 sin fotos',
  (select row(photo_path, thumbnail_path, photo_in_bloom)::text from public.plants where id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  '(,,f)'
);
select pruebas.iguales(
  'la marca de sincronización queda vacía',
  coalesce(current_setting('orki.photo_sync', true), ''),
  ''
);

-- Sincronización: de plants a plant_photos (la app antigua) --------------------------------
--
-- La app antigua, con la sesión de user_a: registra la planta (A1, con photo_in_bloom ya
-- puesto), pone la foto con un update de photo_path y thumbnail_path, la sustituye, cambia
-- photo_in_bloom en la edición y la quita poniendo las dos rutas a null.

-- prueba: app antigua: poner la foto crea la principal en la posición 0, con photo_in_bloom
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
update public.plants
  set photo_path = 'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-v1.webp',
      thumbnail_path = 'user_a/aaaaaaaa-0000-4000-8000-000000000001/thumb-v1.webp'
  where id = 'aaaaaaaa-0000-4000-8000-000000000001' and user_id = 'user_a';
select pruebas.iguales(
  'fotos de A1',
  (select string_agg(row(user_id, position, photo_path, thumbnail_path, in_bloom)::text, '; ')
     from public.plant_photos where plant_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  '(user_a,0,user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-v1.webp,user_a/aaaaaaaa-0000-4000-8000-000000000001/thumb-v1.webp,t)'
);
select pruebas.iguales(
  'A1 como la dejó la app antigua',
  (select row(photo_path, photo_in_bloom, updated_at = now())::text from public.plants where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  '(user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-v1.webp,t,t)'
);

-- prueba: app antigua: sustituir la foto cambia la principal, sin añadir fotos
select id as id_principal from public.plant_photos
  where plant_id = 'aaaaaaaa-0000-4000-8000-000000000004' and position = 0 \gset
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
update public.plants
  set photo_path = 'user_a/aaaaaaaa-0000-4000-8000-000000000004/photo-v2.webp',
      thumbnail_path = 'user_a/aaaaaaaa-0000-4000-8000-000000000004/thumb-v2.webp'
  where id = 'aaaaaaaa-0000-4000-8000-000000000004' and user_id = 'user_a';
select pruebas.iguales(
  'fotos de A4 tras sustituir la principal',
  (select string_agg(row(id = :'id_principal', position, photo_path, in_bloom, note, taken_at)::text, '; ' order by position)
     from public.plant_photos where plant_id = 'aaaaaaaa-0000-4000-8000-000000000004'),
  '(t,0,user_a/aaaaaaaa-0000-4000-8000-000000000004/photo-v2.webp,t,,); '
    || '(f,4,user_a/aaaaaaaa-0000-4000-8000-000000000004/photo-4.webp,f,Otra,2026-01-01)'
);
select pruebas.iguales(
  'A4 como la dejó la app antigua',
  (select row(photo_path, thumbnail_path, photo_in_bloom, updated_at = now())::text
     from public.plants where id = 'aaaaaaaa-0000-4000-8000-000000000004'),
  '(user_a/aaaaaaaa-0000-4000-8000-000000000004/photo-v2.webp,user_a/aaaaaaaa-0000-4000-8000-000000000004/thumb-v2.webp,t,t)'
);

-- prueba: app antigua: cambiar solo photo_in_bloom lo cambia en la principal
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
update public.plants set photo_in_bloom = false
  where id = 'aaaaaaaa-0000-4000-8000-000000000004' and user_id = 'user_a';
select pruebas.iguales(
  'in_bloom de las fotos de A4',
  (select string_agg(position || ':' || in_bloom::text, ', ' order by position)
     from public.plant_photos where plant_id = 'aaaaaaaa-0000-4000-8000-000000000004'),
  '0:false, 4:false'
);
update public.plants set photo_in_bloom = true
  where id = 'aaaaaaaa-0000-4000-8000-000000000004' and user_id = 'user_a';
select pruebas.iguales(
  'in_bloom de las fotos de A4 otra vez',
  (select string_agg(position || ':' || in_bloom::text, ', ' order by position)
     from public.plant_photos where plant_id = 'aaaaaaaa-0000-4000-8000-000000000004'),
  '0:true, 4:false'
);

-- prueba: app antigua: quitar la foto borra solo la principal y la misma sentencia devuelve la siguiente
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
with cambiada as (
  update public.plants set photo_path = null, thumbnail_path = null
    where id = 'aaaaaaaa-0000-4000-8000-000000000004' and user_id = 'user_a'
    returning photo_path, thumbnail_path, photo_in_bloom
)
select pruebas.iguales(
  'planta devuelta a la app antigua',
  (select row(photo_path, thumbnail_path, photo_in_bloom)::text from cambiada),
  '(user_a/aaaaaaaa-0000-4000-8000-000000000004/photo-4.webp,user_a/aaaaaaaa-0000-4000-8000-000000000004/thumb-4.webp,f)'
);
select pruebas.iguales(
  'fotos de A4 tras quitar la principal',
  (select string_agg(position || ':' || photo_path, ', ' order by position)
     from public.plant_photos where plant_id = 'aaaaaaaa-0000-4000-8000-000000000004'),
  '4:user_a/aaaaaaaa-0000-4000-8000-000000000004/photo-4.webp'
);
select pruebas.iguales(
  'A4 en la base',
  (select row(photo_path, photo_in_bloom)::text from public.plants where id = 'aaaaaaaa-0000-4000-8000-000000000004'),
  '(user_a/aaaaaaaa-0000-4000-8000-000000000004/photo-4.webp,f)'
);
select pruebas.iguales(
  'la marca de sincronización queda vacía',
  coalesce(current_setting('orki.photo_sync', true), ''),
  ''
);

-- prueba: app antigua: quitar la única foto deja la planta sin fotos y photo_in_bloom como lo mande
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
update public.plants
  set photo_path = 'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-v1.webp',
      thumbnail_path = 'user_a/aaaaaaaa-0000-4000-8000-000000000001/thumb-v1.webp'
  where id = 'aaaaaaaa-0000-4000-8000-000000000001' and user_id = 'user_a';
update public.plants set photo_path = null, thumbnail_path = null
  where id = 'aaaaaaaa-0000-4000-8000-000000000001' and user_id = 'user_a';
select pruebas.iguales(
  'A1 sin foto y con photo_in_bloom como lo dejó la registración',
  (select row(photo_path, thumbnail_path, photo_in_bloom)::text from public.plants where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  '(,,t)'
);
select pruebas.iguales(
  'fotos de A1',
  (select count(*) from public.plant_photos where plant_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  0::bigint
);

-- prueba: app antigua: crear la planta ya con foto también crea la principal
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
insert into public.plants (id, entered_name, genus_id, type, photo_in_bloom, photo_path, thumbnail_path)
values ('aaaaaaaa-0000-4000-8000-000000000003', 'Planta A3', pruebas.genero('Vanda'), 'unknown', true,
        'user_a/aaaaaaaa-0000-4000-8000-000000000003/photo-v1.webp',
        'user_a/aaaaaaaa-0000-4000-8000-000000000003/thumb-v1.webp');
select pruebas.iguales(
  'fotos de A3',
  (select string_agg(row(user_id, position, photo_path, in_bloom)::text, '; ')
     from public.plant_photos where plant_id = 'aaaaaaaa-0000-4000-8000-000000000003'),
  '(user_a,0,user_a/aaaaaaaa-0000-4000-8000-000000000003/photo-v1.webp,t)'
);

-- prueba: app antigua: editar otras columnas no toca las fotos, y una sola ruta se rechaza
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
update public.plants
  set photo_path = 'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-v1.webp',
      thumbnail_path = 'user_a/aaaaaaaa-0000-4000-8000-000000000001/thumb-v1.webp'
  where id = 'aaaaaaaa-0000-4000-8000-000000000001';
update public.plants set nickname = 'La consentida', location = 'Balcón'
  where id = 'aaaaaaaa-0000-4000-8000-000000000001';
select pruebas.iguales(
  'fotos de A1 tras editar el apodo',
  (select string_agg(row(position, photo_path, in_bloom)::text, '; ')
     from public.plant_photos where plant_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  '(0,user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-v1.webp,t)'
);
select pruebas.debe_fallar(
  'quitar solo la miniatura',
  $$update public.plants set thumbnail_path = null where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '23514', 'plants_photo_paths_together'
);
select pruebas.debe_fallar(
  'crear una planta con foto y sin miniatura',
  $$insert into public.plants (entered_name, genus_id, type, photo_path)
    values ('x', pruebas.genero('Vanda'), 'unknown', 'user_a/aaaaaaaa-0000-4000-8000-000000000009/photo.webp')$$,
  '23514', 'plants_photo_paths_together'
);
select pruebas.debe_fallar(
  'poner una foto fuera de la carpeta de la planta',
  $$update public.plants
      set photo_path = 'user_a/aaaaaaaa-0000-4000-8000-000000000002/photo-0.webp',
          thumbnail_path = 'user_a/aaaaaaaa-0000-4000-8000-000000000002/thumb-0.webp'
      where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '23514', 'plant_photos_photo_path_valid'
);
-- Las restricciones propias de plants siguen siendo las que rechazan una ruta en blanco.
select pruebas.debe_fallar(
  'ruta en blanco',
  $$update public.plants set photo_path = '', thumbnail_path = '' where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '23514', 'plants_photo_path_valid'
);

-- Cascada ------------------------------------------------------------------------------------

-- prueba: al borrar una planta se borran sus fotos, también desde la app antigua
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
delete from public.plants where id = 'aaaaaaaa-0000-4000-8000-000000000004' and user_id = 'user_a';
set local role postgres;
select pruebas.iguales(
  'fotos que quedan de A4',
  (select count(*) from public.plant_photos where plant_id = 'aaaaaaaa-0000-4000-8000-000000000004'),
  0::bigint
);
select pruebas.iguales(
  'fotos de las demás plantas',
  (select count(*) from public.plant_photos),
  3::bigint
);

-- RLS y permisos -----------------------------------------------------------------------------

-- prueba: privilegios: anon nada; authenticated lee, borra y escribe solo las columnas permitidas
select pruebas.iguales(
  'privilegios de tabla',
  (select string_agg(r.rol || ':' || p.priv || ':' || has_table_privilege(r.rol, 'public.plant_photos', p.priv), ', '
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
     where a.attrelid = 'public.plant_photos'::regclass and a.attnum > 0 and not a.attisdropped
       and has_column_privilege('authenticated', 'public.plant_photos', a.attname, 'insert')),
  'id, in_bloom, note, photo_path, plant_id, position, taken_at, thumbnail_path, user_id'
);
select pruebas.iguales(
  'columnas que authenticated puede actualizar',
  (select string_agg(a.attname, ', ' order by a.attname)
     from pg_attribute a
     where a.attrelid = 'public.plant_photos'::regclass and a.attnum > 0 and not a.attisdropped
       and has_column_privilege('authenticated', 'public.plant_photos', a.attname, 'update')),
  'in_bloom, note, photo_path, position, taken_at, thumbnail_path'
);
select pruebas.iguales(
  'políticas de plant_photos',
  (select string_agg(p.cmd || ':' || array_to_string(p.roles, ','), ', ' order by p.cmd)
     from pg_policies p where p.schemaname = 'public' and p.tablename = 'plant_photos'),
  'DELETE:authenticated, INSERT:authenticated, SELECT:authenticated, UPDATE:authenticated'
);

-- prueba: anon no lee ni escribe fotos, aunque el token traiga un sub
set local role anon;
set local request.jwt.claims = '{"sub": "user_b", "role": "anon"}';
select pruebas.debe_fallar('anon lee', 'select * from public.plant_photos', '42501');
select pruebas.debe_fallar(
  'anon crea',
  $$insert into public.plant_photos (plant_id, photo_path, thumbnail_path, position)
    values ('bbbbbbbb-0000-4000-8000-000000000001', 'user_b/bbbbbbbb-0000-4000-8000-000000000001/p.webp',
            'user_b/bbbbbbbb-0000-4000-8000-000000000001/t.webp', 5)$$,
  '42501'
);
select pruebas.debe_fallar('anon edita', 'update public.plant_photos set in_bloom = true', '42501');
select pruebas.debe_fallar('anon borra', 'delete from public.plant_photos', '42501');

-- prueba: cada usuario lee, crea, edita y borra solo sus fotos
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_b", "role": "authenticated"}';
select pruebas.iguales(
  'fotos visibles para user_b',
  (select string_agg(photo_path, ', ' order by photo_path) from public.plant_photos),
  'user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-1.webp, user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-2.webp, '
    || 'user_b/bbbbbbbb-0000-4000-8000-000000000002/photo-1.webp'
);
-- Crea una foto en su planta sin indicar user_id (lo toma del token).
select pruebas.debe_funcionar(
  'user_b añade una foto a su planta',
  $$insert into public.plant_photos (plant_id, photo_path, thumbnail_path, position, note)
    values ('bbbbbbbb-0000-4000-8000-000000000002', 'user_b/bbbbbbbb-0000-4000-8000-000000000002/photo-2.webp',
            'user_b/bbbbbbbb-0000-4000-8000-000000000002/thumb-2.webp', 1, 'Desde la app nueva')$$
);
select pruebas.debe_funcionar(
  'user_b reordena y edita sus fotos',
  $$update public.plant_photos set position = case position when 0 then 1 else 0 end, taken_at = '2026-11-01'
      where plant_id = 'bbbbbbbb-0000-4000-8000-000000000002'$$
);
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.iguales(
  'fotos visibles para user_a',
  (select string_agg(photo_path, ', ' order by photo_path) from public.plant_photos),
  'user_a/aaaaaaaa-0000-4000-8000-000000000004/photo-0.webp, user_a/aaaaaaaa-0000-4000-8000-000000000004/photo-4.webp'
);
select pruebas.debe_fallar(
  'user_a añade una foto a la planta de user_b',
  $$insert into public.plant_photos (plant_id, photo_path, thumbnail_path, position)
    values ('bbbbbbbb-0000-4000-8000-000000000001', 'user_a/bbbbbbbb-0000-4000-8000-000000000001/p.webp',
            'user_a/bbbbbbbb-0000-4000-8000-000000000001/t.webp', 5)$$,
  '23514', 'plant_photos_user_id_matches_plant'
);
select pruebas.debe_fallar(
  'user_a añade una foto a nombre de user_b',
  $$insert into public.plant_photos (plant_id, user_id, photo_path, thumbnail_path, position)
    values ('bbbbbbbb-0000-4000-8000-000000000001', 'user_b', 'user_b/bbbbbbbb-0000-4000-8000-000000000001/p.webp',
            'user_b/bbbbbbbb-0000-4000-8000-000000000001/t.webp', 5)$$,
  '42501'
);
with cambiadas as (update public.plant_photos set in_bloom = true where user_id = 'user_b' returning 1)
select pruebas.iguales('fotos de user_b que edita user_a', (select count(*) from cambiadas), 0::bigint);
with borradas as (delete from public.plant_photos where user_id = 'user_b' returning 1)
select pruebas.iguales('fotos de user_b que borra user_a', (select count(*) from borradas), 0::bigint);
select pruebas.debe_fallar(
  'user_a mueve su foto a otra planta',
  $$update public.plant_photos set plant_id = 'aaaaaaaa-0000-4000-8000-000000000001'
      where plant_id = 'aaaaaaaa-0000-4000-8000-000000000004'$$,
  '42501'
);
select pruebas.debe_fallar(
  'user_a cambia el dueño de su foto',
  $$update public.plant_photos set user_id = 'user_b' where plant_id = 'aaaaaaaa-0000-4000-8000-000000000004'$$,
  '42501'
);
select pruebas.debe_fallar(
  'user_a reescribe created_at',
  $$update public.plant_photos set created_at = '2000-01-01' where plant_id = 'aaaaaaaa-0000-4000-8000-000000000004'$$,
  '42501'
);
with borradas as (delete from public.plant_photos where plant_id = 'aaaaaaaa-0000-4000-8000-000000000004' and position = 4 returning 1)
select pruebas.iguales('fotos propias que borra user_a', (select count(*) from borradas), 1::bigint);
set local role postgres;
select pruebas.iguales(
  'fotos de user_b intactas, con la nueva y el orden cambiado',
  (select string_agg(position || ':' || photo_path || ':' || coalesce(taken_at::text, '-'), ', ' order by plant_id, position)
     from public.plant_photos where user_id = 'user_b'),
  '0:user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-1.webp:-, 1:user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-2.webp:-, '
    || '0:user_b/bbbbbbbb-0000-4000-8000-000000000002/photo-2.webp:2026-11-01, '
    || '1:user_b/bbbbbbbb-0000-4000-8000-000000000002/photo-1.webp:2026-11-01'
);
select pruebas.iguales(
  'principal de B2 tras reordenar desde la app nueva',
  (select photo_path from public.plants where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  'user_b/bbbbbbbb-0000-4000-8000-000000000002/photo-2.webp'
);

-- prueba: un token sin sub no ve ni crea fotos
set local role authenticated;
set local request.jwt.claims = '{"role": "authenticated"}';
select pruebas.iguales('fotos visibles', (select count(*) from public.plant_photos), 0::bigint);
select pruebas.debe_fallar(
  'crear sin sub',
  $$insert into public.plant_photos (plant_id, photo_path, thumbnail_path, position)
    values ('bbbbbbbb-0000-4000-8000-000000000001', 'user_b/bbbbbbbb-0000-4000-8000-000000000001/p.webp',
            'user_b/bbbbbbbb-0000-4000-8000-000000000001/t.webp', 5)$$,
  '42501'
);

-- prueba: el administrador lee solo sus fotos: ninguna fila ajena, tampoco de plantas por validar
-- Desde el #283 la política de lectura no tiene rama del administrador: la cola le da las rutas
-- (list_proposal_groups) y Storage le deja descargarlas (is_pending_plant_photo), pero no lee
-- las filas de plant_photos de otros usuarios, con su nota y su fecha. B1 (de user_b) y A4 (de
-- user_a) están por validar y tienen fotos con nota y fecha.
set local role postgres;
insert into public.plants (id, user_id, entered_name, genus_id, type, photo_path, thumbnail_path)
values ('dddddddd-0000-4000-8000-000000000001', 'user_admin', 'Planta del administrador', pruebas.genero('Vanda'),
        'unknown', 'user_admin/dddddddd-0000-4000-8000-000000000001/photo-1.webp',
        'user_admin/dddddddd-0000-4000-8000-000000000001/thumb-1.webp');
select pruebas.iguales(
  'fotos ajenas de plantas por validar en la base',
  (select count(*) from public.plant_photos f join public.plants p on p.id = f.plant_id
     where p.validation = 'pending' and f.user_id <> 'user_admin'),
  4::bigint
);
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'filas ajenas de plant_photos que lee el administrador',
  (select count(*) from (select user_id, note, taken_at, photo_path from public.plant_photos
                          where user_id <> 'user_admin') f),
  0::bigint
);
select pruebas.iguales(
  'filas de la planta por validar B1 que lee el administrador',
  (select count(*) from public.plant_photos where plant_id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  0::bigint
);
select pruebas.iguales(
  'fotos que lee el administrador',
  (select string_agg(photo_path, ', ' order by photo_path) from public.plant_photos),
  'user_admin/dddddddd-0000-4000-8000-000000000001/photo-1.webp'
);
with cambiadas as (update public.plant_photos set in_bloom = true where user_id <> 'user_admin' returning 1)
select pruebas.iguales('fotos ajenas que edita el administrador', (select count(*) from cambiadas), 0::bigint);
with borradas as (delete from public.plant_photos where user_id <> 'user_admin' returning 1)
select pruebas.iguales('fotos ajenas que borra el administrador', (select count(*) from borradas), 0::bigint);
select pruebas.debe_fallar(
  'el administrador añade una foto a una planta de user_b',
  $$insert into public.plant_photos (plant_id, user_id, photo_path, thumbnail_path, position)
    values ('bbbbbbbb-0000-4000-8000-000000000001', 'user_b', 'user_b/bbbbbbbb-0000-4000-8000-000000000001/p.webp',
            'user_b/bbbbbbbb-0000-4000-8000-000000000001/t.webp', 5)$$,
  '42501'
);
-- La cola sigue dándole las rutas de las fotos de B1 (sin nota ni fecha).
select pruebas.comprobar(
  'list_proposal_groups da al administrador las fotos de B1',
  exists (select from public.list_proposal_groups(50, 0) g
           cross join lateral jsonb_array_elements(g.photos) f
           where f ->> 'thumbnail_path' = 'user_b/bbbbbbbb-0000-4000-8000-000000000001/thumb-1.webp')
);
-- Un app_role que no es catalog_admin tampoco da nada.
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "admin"}';
select pruebas.iguales(
  'fotos ajenas visibles con otro app_role',
  (select count(*) from public.plant_photos where user_id <> 'user_admin'),
  0::bigint
);

-- prueba: la política de lectura de plant_photos solo compara con el usuario de la petición
select pruebas.iguales(
  'política de lectura de plant_photos',
  (select p.policyname || ': ' || p.qual
     from pg_policies p
     where p.schemaname = 'public' and p.tablename = 'plant_photos' and p.cmd = 'SELECT'),
  'Cada usuario lee sus fotos: (user_id = ( SELECT requesting_user_id() AS requesting_user_id))'
);
select pruebas.comprobar(
  'is_pending_plant(uuid) ya no existe',
  to_regprocedure('public.is_pending_plant(uuid)') is null
);

-- Copia de las fotos existentes ------------------------------------------------------------

-- prueba: la copia de la migración crea la fila de cada planta con foto, una sola vez
-- Plantas como las que había antes del #182: con la marca puesta, plants no se copia a
-- plant_photos.
set local orki.photo_sync = 'on';
insert into public.plants (id, user_id, entered_name, genus_id, type, photo_in_bloom, photo_path, thumbnail_path, created_at)
values
  ('cccccccc-0000-4000-8000-000000000001', 'user_c', 'Antigua en flor', pruebas.genero('Vanda'), 'unknown', true,
   'user_c/cccccccc-0000-4000-8000-000000000001/photo-v1.webp',
   'user_c/cccccccc-0000-4000-8000-000000000001/thumb-v1.jpg', '2026-05-01'),
  ('cccccccc-0000-4000-8000-000000000002', 'user_c', 'Antigua', pruebas.genero('Vanda'), 'unknown', false,
   'user_c/cccccccc-0000-4000-8000-000000000002/photo-v1.webp',
   'user_c/cccccccc-0000-4000-8000-000000000002/thumb-v1.webp', '2026-06-01'),
  ('cccccccc-0000-4000-8000-000000000003', 'user_c', 'Sin foto', pruebas.genero('Vanda'), 'unknown', true,
   null, null, '2026-06-01'),
  ('cccccccc-0000-4000-8000-000000000004', 'user_c', 'Solo foto', pruebas.genero('Vanda'), 'unknown', false,
   'user_c/cccccccc-0000-4000-8000-000000000004/photo-v1.webp', null, '2026-06-01'),
  ('cccccccc-0000-4000-8000-000000000005', 'user_c', 'Fuera de la convención', pruebas.genero('Vanda'), 'unknown', false,
   'user_c/photo-v1.webp', 'user_c/thumb-v1.webp', '2026-06-01');
set local orki.photo_sync = '';
select pruebas.iguales('filas copiadas', private.copy_legacy_plant_photos(), 2::bigint);
select pruebas.iguales(
  'fotos de user_c',
  (select string_agg(row(plant_id, user_id, position, photo_path, thumbnail_path, in_bloom, taken_at, note, created_at)::text,
                     '; ' order by plant_id)
     from public.plant_photos where user_id = 'user_c'),
  '(cccccccc-0000-4000-8000-000000000001,user_c,0,user_c/cccccccc-0000-4000-8000-000000000001/photo-v1.webp,'
    || 'user_c/cccccccc-0000-4000-8000-000000000001/thumb-v1.jpg,t,,,"2026-05-01 00:00:00+00"); '
    || '(cccccccc-0000-4000-8000-000000000002,user_c,0,user_c/cccccccc-0000-4000-8000-000000000002/photo-v1.webp,'
    || 'user_c/cccccccc-0000-4000-8000-000000000002/thumb-v1.webp,f,,,"2026-06-01 00:00:00+00")'
);
select pruebas.iguales('filas copiadas la segunda vez', private.copy_legacy_plant_photos(), 0::bigint);
select pruebas.iguales(
  'fotos de user_c tras copiar dos veces',
  (select count(*) from public.plant_photos where user_id = 'user_c'),
  2::bigint
);
select pruebas.iguales(
  'plantas copiadas sin cambiar',
  (select string_agg(row(photo_path, photo_in_bloom)::text, '; ' order by id)
     from public.plants where user_id = 'user_c' and id in ('cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000002')),
  '(user_c/cccccccc-0000-4000-8000-000000000001/photo-v1.webp,t); (user_c/cccccccc-0000-4000-8000-000000000002/photo-v1.webp,f)'
);
select pruebas.comprobar(
  'nadie fuera del dueño ejecuta la copia',
  not has_function_privilege('authenticated', 'private.copy_legacy_plant_photos()', 'execute')
    and not has_function_privilege('service_role', 'private.copy_legacy_plant_photos()', 'execute')
);
