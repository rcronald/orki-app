-- Varias fotos en la cola de propuestas y número de fotos (issue #184, parte de #181), de la
-- migración 20261124090000_varias_fotos_cola_y_recuento.sql: is_pending_plant_photo() abre al
-- administrador todas las fotos de las plantas por validar, list_proposal_groups() toma las
-- fotos de plant_photos (hasta seis, por turnos) y public.photo_count(plants).
--
-- Como en fotos_storage.sql, storage es la simulación mínima: se comprueban las políticas tal
-- como las evalúa Postgres (leer, descargar o firmar una URL es un select de storage.objects).
--
-- Datos de partida, como postgres. Las plantas con foto se crean con photo_path y
-- thumbnail_path, que crea su principal en plant_photos; las demás fotos se insertan después:
--   - Grupo «Flor de prueba» en Vanda, por validar:
--       P1 de user_a (creada el 1 de noviembre): fotos en las posiciones 0, 1, 2 y 3.
--       P2 de user_b (creada el 2 de noviembre): fotos en las posiciones 0, 2 y 5.
--   - P3 de user_b, validada, con dos fotos.
--   - P4 de user_c, no identificable, con dos fotos.
--   - P5 de user_c, «Otra flor» en Vanda, por validar, planta antigua con foto solo en las
--     columnas de plants (sin fila en plant_photos: se crea con la sincronización apagada).
--   - En storage, los archivos de todas esas fotos y uno suelto en la carpeta de P1.

insert into public.species (scientific_name, genus_id, type, status, source)
values ('Cattleya labiata', pruebas.genero('Cattleya'), 'species', 'validated', 'curated');

insert into public.plants (id, user_id, entered_name, genus_id, type, photo_path, thumbnail_path, created_at)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'user_a', 'Flor de prueba', pruebas.genero('Vanda'), 'unknown',
   'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-0.webp',
   'user_a/aaaaaaaa-0000-4000-8000-000000000001/thumb-0.webp', '2026-11-01'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'user_b', 'flor de Prueba', pruebas.genero('Vanda'), 'unknown',
   'user_b/bbbbbbbb-0000-4000-8000-000000000002/photo-0.webp',
   'user_b/bbbbbbbb-0000-4000-8000-000000000002/thumb-0.webp', '2026-11-02'),
  ('cccccccc-0000-4000-8000-000000000004', 'user_c', 'Rara', pruebas.genero('Vanda'), 'unknown',
   'user_c/cccccccc-0000-4000-8000-000000000004/photo-0.webp',
   'user_c/cccccccc-0000-4000-8000-000000000004/thumb-0.webp', '2026-11-04');
insert into public.plants (id, user_id, entered_name, species_id, photo_path, thumbnail_path, created_at)
values
  ('bbbbbbbb-0000-4000-8000-000000000003', 'user_b', 'Mi labiata', pruebas.especie('Cattleya labiata'),
   'user_b/bbbbbbbb-0000-4000-8000-000000000003/photo-0.webp',
   'user_b/bbbbbbbb-0000-4000-8000-000000000003/thumb-0.webp', '2026-11-03');
update public.plants set validation = 'unidentifiable' where id = 'cccccccc-0000-4000-8000-000000000004';

insert into public.plant_photos (plant_id, user_id, photo_path, thumbnail_path, position, taken_at, note)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'user_a', 'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-1.webp',
   'user_a/aaaaaaaa-0000-4000-8000-000000000001/thumb-1.webp', 1, '2026-10-01', 'Nota secreta'),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'user_a', 'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-2.webp',
   'user_a/aaaaaaaa-0000-4000-8000-000000000001/thumb-2.webp', 2, null, null),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'user_a', 'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-3.webp',
   'user_a/aaaaaaaa-0000-4000-8000-000000000001/thumb-3.webp', 3, null, null),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'user_b', 'user_b/bbbbbbbb-0000-4000-8000-000000000002/photo-2.webp',
   'user_b/bbbbbbbb-0000-4000-8000-000000000002/thumb-2.webp', 2, null, null),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'user_b', 'user_b/bbbbbbbb-0000-4000-8000-000000000002/photo-5.webp',
   'user_b/bbbbbbbb-0000-4000-8000-000000000002/thumb-5.webp', 5, null, null),
  ('bbbbbbbb-0000-4000-8000-000000000003', 'user_b', 'user_b/bbbbbbbb-0000-4000-8000-000000000003/photo-1.webp',
   'user_b/bbbbbbbb-0000-4000-8000-000000000003/thumb-1.webp', 1, null, null),
  ('cccccccc-0000-4000-8000-000000000004', 'user_c', 'user_c/cccccccc-0000-4000-8000-000000000004/photo-1.webp',
   'user_c/cccccccc-0000-4000-8000-000000000004/thumb-1.webp', 1, null, null);

-- P5: planta antigua sin fila en plant_photos.
select set_config('orki.photo_sync', 'on', false);
insert into public.plants (id, user_id, entered_name, genus_id, type, photo_path, thumbnail_path, created_at)
values
  ('cccccccc-0000-4000-8000-000000000005', 'user_c', 'Otra flor', pruebas.genero('Vanda'), 'unknown',
   'user_c/cccccccc-0000-4000-8000-000000000005/photo-0.webp',
   'user_c/cccccccc-0000-4000-8000-000000000005/thumb-0.webp', '2026-11-05');
select set_config('orki.photo_sync', '', false);

insert into storage.objects (bucket_id, name)
select 'plant-photos', r.ruta
  from (
    select photo_path as ruta from public.plant_photos
    union all select thumbnail_path from public.plant_photos
    union all select 'user_c/cccccccc-0000-4000-8000-000000000005/photo-0.webp'
    union all select 'user_c/cccccccc-0000-4000-8000-000000000005/thumb-0.webp'
    union all select 'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-viejo.webp'
  ) r;

-- prueba: datos de partida: las fotos de cada planta y la planta antigua sin filas
select pruebas.iguales(
  'fotos por planta',
  (select string_agg(p.entered_name || ':' || (select count(*) from public.plant_photos f where f.plant_id = p.id), ', '
                     order by p.created_at)
     from public.plants p),
  'Flor de prueba:4, flor de Prueba:3, Mi labiata:2, Rara:2, Otra flor:0'
);

-- prueba: el administrador descarga todas las fotos de las plantas por validar, también las secundarias
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'objetos visibles para el administrador',
  (select string_agg(substr(name, 1, 6) || substr(name, 44), ', ' order by name) from storage.objects),
  'user_a/photo-0.webp, user_a/photo-1.webp, user_a/photo-2.webp, user_a/photo-3.webp, '
    || 'user_a/thumb-0.webp, user_a/thumb-1.webp, user_a/thumb-2.webp, user_a/thumb-3.webp, '
    || 'user_b/photo-0.webp, user_b/photo-2.webp, user_b/photo-5.webp, '
    || 'user_b/thumb-0.webp, user_b/thumb-2.webp, user_b/thumb-5.webp, '
    || 'user_c/photo-0.webp, user_c/thumb-0.webp'
);
-- Los dos de user_c son de P5 (la planta antigua, por las columnas de plants).
select pruebas.iguales(
  'de user_c, solo la planta antigua por validar',
  (select string_agg(distinct split_part(name, '/', 2), ', ') from storage.objects where name like 'user_c/%'),
  'cccccccc-0000-4000-8000-000000000005'
);
select pruebas.iguales(
  'ni la validada, ni la no identificable, ni el archivo suelto',
  (select count(*) from storage.objects
    where name like 'user_b/bbbbbbbb-0000-4000-8000-000000000003/%'
       or name like 'user_c/cccccccc-0000-4000-8000-000000000004/%'
       or name like '%photo-viejo.webp'),
  0::bigint
);

-- prueba: al resolverse el grupo, el administrador deja de ver también las secundarias
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'plantas resueltas',
  (select plant_count from public.mark_proposal_unidentifiable('flor de prueba', pruebas.genero('Vanda'))),
  2::bigint
);
select pruebas.iguales(
  'objetos visibles después',
  (select string_agg(name, ', ' order by name) from storage.objects),
  'user_c/cccccccc-0000-4000-8000-000000000005/photo-0.webp, user_c/cccccccc-0000-4000-8000-000000000005/thumb-0.webp'
);

-- prueba: un usuario sin rol ve solo lo suyo y anon nada
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.iguales(
  'objetos visibles para user_a',
  (select count(*) from storage.objects where name like 'user_a/%'),
  9::bigint
);
select pruebas.iguales(
  'objetos ajenos visibles para user_a',
  (select count(*) from storage.objects where name not like 'user_a/%'),
  0::bigint
);
set local role anon;
set local request.jwt.claims = '{"sub": "user_a", "role": "anon"}';
select pruebas.iguales('objetos visibles para anon', (select count(*) from storage.objects), 0::bigint);
select pruebas.debe_fallar(
  'anon llama a is_pending_plant_photo',
  $$select public.is_pending_plant_photo('user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-1.webp')$$,
  '42501'
);

-- prueba: is_pending_plant_photo responde por cada ruta, sin abrir rutas de otra carpeta
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'respuestas',
  (select string_agg(coalesce(public.is_pending_plant_photo(r.ruta)::text, 'null'), ', ' order by r.orden)
     from (values
       (1, 'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-0.webp'),
       (2, 'user_a/aaaaaaaa-0000-4000-8000-000000000001/thumb-3.webp'),
       (3, 'user_b/bbbbbbbb-0000-4000-8000-000000000002/photo-5.webp'),
       (4, 'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-viejo.webp'),
       (5, 'user_b/bbbbbbbb-0000-4000-8000-000000000003/photo-1.webp'),
       (6, 'user_c/cccccccc-0000-4000-8000-000000000004/photo-1.webp'),
       -- La ruta de una foto de P1 con el dueño cambiado.
       (7, 'user_b/aaaaaaaa-0000-4000-8000-000000000001/photo-1.webp'),
       (8, 'user_c/cccccccc-0000-4000-8000-000000000005/thumb-0.webp'),
       (9, null)
     ) r (orden, ruta)),
  'true, true, true, false, false, false, false, true, false'
);

-- prueba: la cola reparte hasta seis fotos entre las plantas del grupo, principales primero
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
-- Turno 1: la principal de P2 (la más reciente) y la de P1; turno 2: la segunda de cada una
-- (posición 2 de P2, 1 de P1); turno 3: posición 5 de P2 y 2 de P1. La posición 3 de P1 no cabe.
select pruebas.iguales(
  'fotos de «Flor de prueba»',
  (select string_agg(substr(f ->> 'thumbnail_path', 1, 6) || substr(f ->> 'thumbnail_path', 44), ', ' order by o.n)
     from public.list_proposal_groups() g
     cross join lateral jsonb_array_elements(g.photos) with ordinality o (f, n)
     where g.name_key = 'flor de prueba'),
  'user_b/thumb-0.webp, user_a/thumb-0.webp, user_b/thumb-2.webp, user_a/thumb-1.webp, user_b/thumb-5.webp, user_a/thumb-2.webp'
);
select pruebas.iguales(
  'foto y miniatura de la misma fila',
  (select bool_and(replace(f ->> 'photo_path', '/photo-', '/thumb-') = f ->> 'thumbnail_path')
     from public.list_proposal_groups() g cross join lateral jsonb_array_elements(g.photos) f),
  true
);
-- La planta antigua sin filas en plant_photos aporta la foto de plants.
select pruebas.iguales(
  'fotos de «Otra flor»',
  (select g.photos::text from public.list_proposal_groups() g where g.name_key = 'otra flor'),
  '[{"photo_path": "user_c/cccccccc-0000-4000-8000-000000000005/photo-0.webp", "thumbnail_path": "user_c/cccccccc-0000-4000-8000-000000000005/thumb-0.webp"}]'
);
-- Cada foto, solo sus dos rutas: ni la fecha ni la nota de la foto.
select pruebas.iguales(
  'claves de cada foto',
  (select string_agg(distinct k, ', ' order by k)
     from public.list_proposal_groups() g
     cross join lateral jsonb_array_elements(g.photos) f
     cross join lateral jsonb_object_keys(f) k),
  'photo_path, thumbnail_path'
);
select pruebas.comprobar(
  'sin la nota ni la fecha de las fotos',
  (select bool_and(to_jsonb(g)::text !~ '(Nota secreta|2026-10-01)') from public.list_proposal_groups() g)
);
-- Todo lo que devuelve la cola lo puede descargar.
select pruebas.comprobar(
  'las rutas del listado son las que puede leer',
  (select bool_and(exists (select from storage.objects o where o.name = f ->> 'thumbnail_path')
                   and exists (select from storage.objects o where o.name = f ->> 'photo_path'))
     from public.list_proposal_groups() g cross join lateral jsonb_array_elements(g.photos) f)
);

-- prueba: la cola de un grupo de una sola planta muestra sus seis fotos en orden
set local role postgres;
insert into public.plant_photos (plant_id, user_id, photo_path, thumbnail_path, position)
select 'aaaaaaaa-0000-4000-8000-000000000001', 'user_a',
       'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-' || n || '.webp',
       'user_a/aaaaaaaa-0000-4000-8000-000000000001/thumb-' || n || '.webp', n
  from generate_series(4, 5) n;
update public.plants set entered_name = 'Flor sola' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'fotos de «Flor sola»',
  (select string_agg(substr(f ->> 'thumbnail_path', 45), ', ' order by o.n)
     from public.list_proposal_groups() g
     cross join lateral jsonb_array_elements(g.photos) with ordinality o (f, n)
     where g.name_key = 'flor sola'),
  'thumb-0.webp, thumb-1.webp, thumb-2.webp, thumb-3.webp, thumb-4.webp, thumb-5.webp'
);

-- prueba: la consulta de plant_photos de is_pending_plant_photo usa las claves de plants y de plant_photos
-- La segunda consulta de la función, con los valores ya extraídos de la ruta, sobre 3000
-- plantas más de user_b con tres fotos cada una y con estadísticas.
insert into public.plants (id, user_id, entered_name, genus_id, type, photo_path, thumbnail_path)
select r.id, 'user_b', 'Relleno ' || r.i, pruebas.genero('Vanda'), 'unknown',
       'user_b/' || r.id::text || '/photo-0.webp', 'user_b/' || r.id::text || '/thumb-0.webp'
from (select i, gen_random_uuid() as id from generate_series(1, 3000) i) r;
insert into public.plant_photos (plant_id, user_id, photo_path, thumbnail_path, position)
select p.id, 'user_b', 'user_b/' || p.id::text || '/photo-' || n || '.webp',
       'user_b/' || p.id::text || '/thumb-' || n || '.webp', n
  from public.plants p cross join generate_series(1, 2) n
  where p.entered_name like 'Relleno %';
analyze public.plants;
analyze public.plant_photos;
do $$
declare
  plan text := '';
  linea text;
begin
  for linea in
    explain
    select
    from public.plants p
    join public.plant_photos f on f.plant_id = p.id
    where p.id = 'bbbbbbbb-0000-4000-8000-000000000002'::uuid
      and f.plant_id = 'bbbbbbbb-0000-4000-8000-000000000002'::uuid
      and p.user_id = 'user_b'
      and p.validation = 'pending'
      and (f.photo_path = 'user_b/bbbbbbbb-0000-4000-8000-000000000002/photo-5.webp'
           or f.thumbnail_path = 'user_b/bbbbbbbb-0000-4000-8000-000000000002/photo-5.webp')
  loop
    plan := plan || linea || E'\n';
  end loop;
  perform pruebas.comprobar('el plan usa plants_pkey:' || E'\n' || plan, plan like '%plants_pkey%');
  perform pruebas.comprobar('el plan usa plant_photos_plant_id_position_key:' || E'\n' || plan,
                            plan like '%plant_photos_plant_id_position_key%');
  perform pruebas.comprobar('el plan no recorre tablas enteras:' || E'\n' || plan, plan not like '%Seq Scan%');
end;
$$;

-- prueba: photo_count cuenta las fotos de cada planta del usuario, también como campo de la fila
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_b", "role": "authenticated"}';
select pruebas.iguales(
  'fotos de las plantas de user_b',
  (select string_agg(p.entered_name || ':' || public.photo_count(p), ', ' order by p.created_at)
     from public.plants p),
  'flor de Prueba:3, Mi labiata:2'
);
-- La sintaxis de campo (p.photo_count) es la que usa PostgREST.
select pruebas.iguales(
  'como campo',
  (select p.photo_count from public.plants p where p.id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  3
);
-- Sin fotos, 0.
set local request.jwt.claims = '{"sub": "user_c", "role": "authenticated"}';
select pruebas.iguales(
  'planta antigua sin filas',
  (select p.photo_count from public.plants p where p.id = 'cccccccc-0000-4000-8000-000000000005'),
  0
);

-- prueba: photo_count no cuenta fotos ajenas, tampoco el administrador, y anon no la ejecuta
-- Con una fila de plants construida a mano (no se puede leer la ajena), el recuento pasa por
-- RLS de plant_photos: 0.
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.iguales(
  'user_a cuenta una planta de user_b',
  public.photo_count(jsonb_populate_record(null::public.plants,
                                           '{"id": "bbbbbbbb-0000-4000-8000-000000000003", "user_id": "user_b"}')),
  0
);
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select pruebas.debe_fallar(
  'anon llama a photo_count',
  $$select public.photo_count(p) from public.plants p$$,
  '42501'
);

-- prueba: photo_count es de lectura, security invoker, con search_path fijo y solo para authenticated y service_role
select pruebas.iguales(
  'propiedades y permisos',
  (select 'definer=' || p.prosecdef::text || ' volatilidad=' || p.provolatile::text || ' ' || array_to_string(p.proconfig, ',')
          || ' anon=' || has_function_privilege('anon', p.oid, 'execute')::text
          || ' authenticated=' || has_function_privilege('authenticated', p.oid, 'execute')::text
          || ' service_role=' || has_function_privilege('service_role', p.oid, 'execute')::text
     from pg_proc p where p.oid = 'public.photo_count(public.plants)'::regprocedure),
  'definer=false volatilidad=s search_path="" anon=false authenticated=true service_role=true'
);
