-- Bucket de fotos de plantas y políticas de storage.objects (issue #80, parte de #10).
--
-- El esquema storage es una simulación (scripts/db-desechable/supabase-minimo.sql): estas
-- pruebas comprueban las propiedades del bucket y las políticas RLS tal como las evalúa
-- Postgres, no la API de Storage. Una operación del cliente se reproduce con la orden SQL que
-- exige su política: subir es insert, leer, listar, descargar y firmar una URL es select,
-- reemplazar (upsert) es insert ... on conflict do update o update, y borrar es delete con
-- storage.allow_delete_query = 'true', como hace la API. Los límites de tamaño y de tipo los
-- aplica la API de Storage, así que aquí solo se comprueba que están en el bucket.
--
-- Datos de partida, insertados como postgres (sin RLS):
--   - user_a: una planta por validar con foto y miniatura.
--   - user_b: una planta por validar con foto y miniatura, una validada con foto y un objeto
--     suelto en su carpeta que no es foto de ninguna planta.
--   - Otro bucket, other-bucket, con un objeto en la carpeta de user_a.

insert into public.species (scientific_name, genus_id, type, status, source)
values ('Cattleya labiata', pruebas.genero('Cattleya'), 'species', 'validated', 'curated');

insert into public.plants (id, user_id, entered_name, genus_id, type, photo_path, thumbnail_path)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'user_a', 'Planta de A', pruebas.genero('Vanda'), 'unknown',
   'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-v1.webp',
   'user_a/aaaaaaaa-0000-4000-8000-000000000001/thumb-v1.webp'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'user_b', 'Pendiente de B', pruebas.genero('Vanda'), 'unknown',
   'user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-v1.webp',
   'user_b/bbbbbbbb-0000-4000-8000-000000000001/thumb-v1.jpg');
insert into public.plants (id, user_id, entered_name, genus_id, type, species_id, photo_path, thumbnail_path)
values
  ('bbbbbbbb-0000-4000-8000-000000000002', 'user_b', 'Validada de B', pruebas.genero('Cattleya'), 'species',
   pruebas.especie('Cattleya labiata'),
   'user_b/bbbbbbbb-0000-4000-8000-000000000002/photo-v1.webp',
   'user_b/bbbbbbbb-0000-4000-8000-000000000002/thumb-v1.webp');

insert into storage.buckets (id, name) values ('other-bucket', 'other-bucket');

insert into storage.objects (bucket_id, name)
values
  ('plant-photos', 'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-v1.webp'),
  ('plant-photos', 'user_a/aaaaaaaa-0000-4000-8000-000000000001/thumb-v1.webp'),
  ('plant-photos', 'user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-v1.webp'),
  ('plant-photos', 'user_b/bbbbbbbb-0000-4000-8000-000000000001/thumb-v1.jpg'),
  ('plant-photos', 'user_b/bbbbbbbb-0000-4000-8000-000000000002/photo-v1.webp'),
  ('plant-photos', 'user_b/bbbbbbbb-0000-4000-8000-000000000002/thumb-v1.webp'),
  ('plant-photos', 'user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-v0.webp'),
  ('other-bucket', 'user_a/otro.webp');

-- prueba: el bucket plant-photos es privado, con tope de 1 MiB y solo WebP y JPEG
select pruebas.iguales(
  'propiedades del bucket',
  (select b.name || ' public=' || b.public || ' limit=' || b.file_size_limit || ' types=' || b.allowed_mime_types::text
     from storage.buckets b where b.id = 'plant-photos'),
  'plant-photos public=false limit=1048576 types={image/webp,image/jpeg}'
);

-- prueba: storage.objects tiene una política por orden para el bucket, solo para authenticated
select pruebas.iguales(
  'políticas de storage.objects',
  (select string_agg(p.policyname || ':' || p.cmd || ':' || array_to_string(p.roles, ','), ', ' order by p.policyname)
     from pg_policies p
     where p.schemaname = 'storage' and p.tablename = 'objects'),
  'plant_photos_delete_own:DELETE:authenticated, plant_photos_insert_own:INSERT:authenticated, '
    || 'plant_photos_select_own_or_pending_for_admin:SELECT:authenticated, plant_photos_update_own:UPDATE:authenticated'
);

-- prueba: anon no lee, no sube, no reemplaza ni borra nada, aunque el token traiga un sub
set local role anon;
set local request.jwt.claims = '{"sub": "user_a", "role": "anon"}';
set local storage.allow_delete_query = 'true';
select pruebas.iguales('objetos visibles para anon', (select count(*) from storage.objects), 0::bigint);
select pruebas.debe_fallar(
  'anon sube a la carpeta de user_a',
  $$insert into storage.objects (bucket_id, name) values ('plant-photos', 'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-v2.webp')$$,
  '42501'
);
with cambiadas as (update storage.objects set metadata = '{}' returning 1)
select pruebas.iguales('filas que anon reemplaza', (select count(*) from cambiadas), 0::bigint);
with borradas as (delete from storage.objects returning 1)
select pruebas.iguales('filas que anon borra', (select count(*) from borradas), 0::bigint);
select pruebas.debe_fallar(
  'anon llama a is_pending_plant_photo',
  $$select public.is_pending_plant_photo('user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-v1.webp')$$,
  '42501'
);

-- prueba: cada usuario lee (lista, descarga, firma) solo los objetos de su carpeta
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.iguales(
  'objetos visibles para user_a',
  (select string_agg(name, ', ' order by name) from storage.objects),
  'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-v1.webp, user_a/aaaaaaaa-0000-4000-8000-000000000001/thumb-v1.webp'
);
select pruebas.iguales(
  'user_a busca una foto de user_b por su ruta',
  (select count(*) from storage.objects
    where bucket_id = 'plant-photos' and name = 'user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-v1.webp'),
  0::bigint
);
set local request.jwt.claims = '{"sub": "user_b", "role": "authenticated"}';
select pruebas.iguales('objetos visibles para user_b', (select count(*) from storage.objects), 5::bigint);

-- prueba: un token authenticated sin sub no ve ni sube nada
set local role authenticated;
set local request.jwt.claims = '{"role": "authenticated"}';
select pruebas.iguales('objetos visibles', (select count(*) from storage.objects), 0::bigint);
select pruebas.debe_fallar(
  'subir sin sub',
  $$insert into storage.objects (bucket_id, name) values ('plant-photos', 'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-v2.webp')$$,
  '42501'
);

-- prueba: cada usuario sube a su carpeta, pero no a la de otro ni a la raíz del bucket
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.debe_funcionar(
  'user_a sube a su carpeta',
  $$insert into storage.objects (bucket_id, name, owner_id) values ('plant-photos', 'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-v2.webp', 'user_a')$$
);
select pruebas.debe_fallar(
  'user_a sube a la carpeta de user_b',
  $$insert into storage.objects (bucket_id, name) values ('plant-photos', 'user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-v2.webp')$$,
  '42501'
);
select pruebas.debe_fallar(
  'user_a sube a la raíz del bucket',
  $$insert into storage.objects (bucket_id, name) values ('plant-photos', 'photo-v2.webp')$$,
  '42501'
);
select pruebas.debe_fallar(
  'user_a sube a una carpeta que solo empieza por su id',
  $$insert into storage.objects (bucket_id, name) values ('plant-photos', 'user_ab/x/photo-v2.webp')$$,
  '42501'
);

-- prueba: cada usuario reemplaza (upsert) lo suyo, pero no lo ajeno
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.debe_funcionar(
  'user_a sobrescribe su foto con upsert',
  $$insert into storage.objects (bucket_id, name, metadata)
    values ('plant-photos', 'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-v1.webp', '{"size": 1}')
    on conflict (bucket_id, name) do update set metadata = excluded.metadata$$
);
with cambiadas as (
  update storage.objects set metadata = '{"size": 2}'
  where name = 'user_a/aaaaaaaa-0000-4000-8000-000000000001/thumb-v1.webp'
  returning 1
)
select pruebas.iguales('filas que user_a reemplaza de lo suyo', (select count(*) from cambiadas), 1::bigint);
select pruebas.debe_fallar(
  'user_a sobrescribe la foto de user_b con upsert',
  $$insert into storage.objects (bucket_id, name, metadata)
    values ('plant-photos', 'user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-v1.webp', '{"size": 1}')
    on conflict (bucket_id, name) do update set metadata = excluded.metadata$$,
  '42501'
);
with cambiadas as (update storage.objects set metadata = '{}' where name like 'user_b/%' returning 1)
select pruebas.iguales('filas que user_a reemplaza de user_b', (select count(*) from cambiadas), 0::bigint);
select pruebas.debe_fallar(
  'user_a mueve su foto a la carpeta de user_b',
  $$update storage.objects set name = 'user_b/robada.webp'
    where name = 'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-v1.webp'$$,
  '42501'
);
select pruebas.debe_fallar(
  'user_a mueve su foto a otro bucket',
  $$update storage.objects set bucket_id = 'other-bucket'
    where name = 'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-v1.webp'$$,
  '42501'
);
set local role postgres;
select pruebas.iguales(
  'las fotos de user_b no cambiaron',
  (select count(*) from storage.objects where name like 'user_b/%' and metadata is not null),
  0::bigint
);

-- prueba: cada usuario borra lo suyo, pero no lo ajeno
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
set local storage.allow_delete_query = 'true';
with borradas as (delete from storage.objects where name like 'user_b/%' returning 1)
select pruebas.iguales('filas de user_b que borra user_a', (select count(*) from borradas), 0::bigint);
with borradas as (delete from storage.objects returning name)
select pruebas.iguales(
  'filas que borra user_a',
  (select string_agg(name, ', ' order by name) from borradas),
  'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-v1.webp, user_a/aaaaaaaa-0000-4000-8000-000000000001/thumb-v1.webp'
);
set local role postgres;
select pruebas.iguales('objetos que quedan', (select count(*) from storage.objects), 6::bigint);

-- prueba: como en Storage, un delete directo sin storage.allow_delete_query falla
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.debe_fallar(
  'delete sin pasar por la API de Storage',
  $$delete from storage.objects where name like 'user_a/%'$$,
  '42501'
);

-- prueba: las políticas no abren otros buckets, ni siquiera la carpeta propia
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.iguales(
  'objetos de other-bucket visibles para user_a',
  (select count(*) from storage.objects where bucket_id = 'other-bucket'),
  0::bigint
);
select pruebas.debe_fallar(
  'user_a sube a su carpeta de other-bucket',
  $$insert into storage.objects (bucket_id, name) values ('other-bucket', 'user_a/nuevo.webp')$$,
  '42501'
);
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'objetos de other-bucket visibles para el administrador',
  (select count(*) from storage.objects where bucket_id = 'other-bucket'),
  0::bigint
);

-- prueba: el administrador ve la foto y la miniatura de una planta ajena por validar, y nada más
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'objetos visibles para el administrador',
  (select string_agg(name, ', ' order by name) from storage.objects),
  'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-v1.webp, user_a/aaaaaaaa-0000-4000-8000-000000000001/thumb-v1.webp, '
    || 'user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-v1.webp, user_b/bbbbbbbb-0000-4000-8000-000000000001/thumb-v1.jpg'
);
-- No ve la de la planta validada ni el objeto suelto (una foto anterior de la planta pendiente).
select pruebas.iguales(
  'fotos de la planta validada y objeto suelto visibles para el administrador',
  (select count(*) from storage.objects
    where name in ('user_b/bbbbbbbb-0000-4000-8000-000000000002/photo-v1.webp',
                   'user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-v0.webp')),
  0::bigint
);
-- Un app_role que no es catalog_admin no da nada.
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "admin"}';
select pruebas.iguales('objetos visibles con otro app_role', (select count(*) from storage.objects), 0::bigint);

-- prueba: el administrador deja de ver la foto cuando la planta queda validada
set local role postgres;
update public.plants set species_id = pruebas.especie('Cattleya labiata')
  where id = 'bbbbbbbb-0000-4000-8000-000000000001';
select pruebas.iguales(
  'la planta quedó validada',
  (select validation::text from public.plants where id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  'validated'
);
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'objetos de user_b visibles para el administrador',
  (select count(*) from storage.objects where name like 'user_b/%'),
  0::bigint
);

-- prueba: el administrador deja de ver la foto anterior cuando la planta cambia de foto
set local role postgres;
update public.plants
  set photo_path = 'user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-v0.webp'
  where id = 'bbbbbbbb-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'objetos de user_b visibles para el administrador',
  (select string_agg(name, ', ' order by name) from storage.objects where name like 'user_b/%'),
  'user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-v0.webp, user_b/bbbbbbbb-0000-4000-8000-000000000001/thumb-v1.jpg'
);

-- prueba: un usuario no puede abrirle al administrador la foto de otro apuntando su planta a ella
-- Caso 1: user_a apunta su planta pendiente a la foto de la planta validada de user_b. La
-- planta se toma de la ruta (la validada), así que no se abre.
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
update public.plants
  set photo_path = 'user_b/bbbbbbbb-0000-4000-8000-000000000002/photo-v1.webp',
      thumbnail_path = 'user_b/bbbbbbbb-0000-4000-8000-000000000002/thumb-v1.webp'
  where id = 'aaaaaaaa-0000-4000-8000-000000000001';
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'fotos de la planta validada de user_b visibles para el administrador',
  (select count(*) from storage.objects where name like 'user_b/bbbbbbbb-0000-4000-8000-000000000002/%'),
  0::bigint
);
-- Caso 2: en la carpeta de user_b hay un objeto con el id de la planta pendiente de user_a en
-- la ruta, y user_a apunta su planta a él. No se abre porque la carpeta no es la del dueño de
-- la planta.
set local role postgres;
insert into storage.objects (bucket_id, name)
values ('plant-photos', 'user_b/aaaaaaaa-0000-4000-8000-000000000001/photo-v9.webp');
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
update public.plants
  set photo_path = 'user_b/aaaaaaaa-0000-4000-8000-000000000001/photo-v9.webp'
  where id = 'aaaaaaaa-0000-4000-8000-000000000001';
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'objeto de user_b con el id de la planta de user_a visible para el administrador',
  (select count(*) from storage.objects where name = 'user_b/aaaaaaaa-0000-4000-8000-000000000001/photo-v9.webp'),
  0::bigint
);

-- prueba: el administrador no sube, reemplaza ni borra fotos ajenas, tampoco las que puede ver
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
set local storage.allow_delete_query = 'true';
select pruebas.debe_fallar(
  'el administrador sube a la carpeta de user_b',
  $$insert into storage.objects (bucket_id, name) values ('plant-photos', 'user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-v2.webp')$$,
  '42501'
);
select pruebas.debe_fallar(
  'el administrador sobrescribe la foto pendiente de user_b con upsert',
  $$insert into storage.objects (bucket_id, name, metadata)
    values ('plant-photos', 'user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-v1.webp', '{"size": 1}')
    on conflict (bucket_id, name) do update set metadata = excluded.metadata$$,
  '42501'
);
with cambiadas as (update storage.objects set metadata = '{}' returning 1)
select pruebas.iguales('filas que reemplaza el administrador', (select count(*) from cambiadas), 0::bigint);
with borradas as (delete from storage.objects returning 1)
select pruebas.iguales('filas que borra el administrador', (select count(*) from borradas), 0::bigint);
set local role postgres;
select pruebas.iguales('objetos que quedan', (select count(*) from storage.objects), 8::bigint);

-- prueba: is_pending_plant_photo sigue el patrón de administrador y solo responde verdadero o falso
select pruebas.iguales(
  'permiso de ejecución',
  (select string_agg(r.rol || ':' || has_function_privilege(r.rol, 'public.is_pending_plant_photo(text)', 'execute'), ', ' order by r.rol)
     from (values ('anon'), ('authenticated'), ('service_role')) r (rol)),
  'anon:false, authenticated:true, service_role:false'
);
select pruebas.iguales(
  'propiedades',
  (select p.prosecdef || ' ' || array_to_string(p.proconfig, ',') || ' ' || p.prorettype::regtype::text
     from pg_proc p where p.oid = 'public.is_pending_plant_photo(text)'::regprocedure),
  'true search_path="" boolean'
);
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_b", "role": "authenticated"}';
select pruebas.debe_fallar(
  'un usuario sin rol la llama, aunque sea con su propia foto',
  $$select public.is_pending_plant_photo('user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-v1.webp')$$,
  '42501'
);
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'respuestas para el administrador',
  (select string_agg(coalesce(public.is_pending_plant_photo(r.ruta)::text, 'null'), ', ' order by r.orden)
     from (values
       (1, 'user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-v1.webp'),
       (2, 'user_b/bbbbbbbb-0000-4000-8000-000000000001/thumb-v1.jpg'),
       (3, 'user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-v0.webp'),
       (4, 'user_b/bbbbbbbb-0000-4000-8000-000000000002/photo-v1.webp'),
       (5, 'user_a/bbbbbbbb-0000-4000-8000-000000000001/photo-v1.webp'),
       (6, 'user_b/BBBBBBBB-0000-4000-8000-000000000001/photo-v1.webp'),
       (7, 'user_b/no-es-un-uuid/photo-v1.webp'),
       (8, 'user_b'),
       (9, ''),
       (10, null)
     ) r (orden, ruta)),
  'true, true, false, false, false, false, false, false, false, false'
);


-- prueba: la consulta de is_pending_plant_photo lee la planta por la clave primaria
-- Es la misma consulta que hace la función, con los valores ya extraídos de la ruta, sobre
-- 5000 plantas más del mismo usuario y con estadísticas, para que el plan sea el de una tabla
-- con datos y no el de una casi vacía.
insert into public.plants (user_id, entered_name, genus_id, type, photo_path)
select 'user_b', 'Relleno ' || i, pruebas.genero('Vanda'), 'unknown', 'user_b/' || gen_random_uuid() || '/photo-v1.webp'
from generate_series(1, 5000) i;
analyze public.plants;
do $$
declare
  plan text := '';
  linea text;
begin
  for linea in
    explain
    select
    from public.plants p
    where p.id = 'bbbbbbbb-0000-4000-8000-000000000001'::uuid
      and p.user_id = 'user_b'
      and p.validation = 'pending'
      and (p.photo_path = 'user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-v1.webp'
           or p.thumbnail_path = 'user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-v1.webp')
  loop
    plan := plan || linea || E'\n';
  end loop;
  perform pruebas.comprobar('el plan usa plants_pkey:' || E'\n' || plan, plan like '%plants_pkey%');
end;
$$;
