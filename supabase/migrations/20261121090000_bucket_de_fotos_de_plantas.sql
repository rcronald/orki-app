-- Bucket privado de fotos de plantas, con sus límites y sus políticas (issue #80, parte de #10).
--
-- Qué crea:
--   1. El bucket "plant-photos" en storage.buckets: privado, con tope de tamaño por archivo y
--      solo WebP o JPEG.
--   2. public.is_pending_plant_photo(), función de administrador que dice si una ruta es la
--      foto o la miniatura actual de una planta "por validar" (para la cola del #22).
--   3. Una política por operación sobre storage.objects, solo para authenticated y solo para
--      este bucket: cada usuario sube, lee, reemplaza y borra los objetos de su carpeta, y el
--      administrador del catálogo además lee las fotos de las plantas por validar.
--
-- Convención de rutas (la usa la app, #82 y #83)
-- ----------------------------------------------
--   <id de usuario de Clerk>/<id de la planta>/photo-<versión>.<ext>
--   <id de usuario de Clerk>/<id de la planta>/thumb-<versión>.<ext>
-- donde:
--   - el primer segmento es el dueño: el claim sub del token (public.requesting_user_id()).
--     Las políticas solo miran este segmento.
--   - el segundo es plants.id (uuid en minúsculas, como lo devuelve Postgres). La app puede
--     generarlo antes de insertar la planta, porque authenticated puede escribir la columna id.
--   - <versión> es un identificador nuevo en cada subida (por ejemplo, crypto.randomUUID() o
--     la fecha en milisegundos en base 36), el mismo para la foto y su miniatura. Así,
--     reemplazar una foto es subir dos objetos con nombre nuevo, guardar las rutas en
--     plants.photo_path y plants.thumbnail_path y borrar los anteriores: ninguna caché (del
--     navegador, del service worker ni de la CDN de Storage) sirve la foto vieja con la URL de
--     la nueva. Sobrescribir con upsert sigue permitido (por ejemplo, para reintentar una
--     subida a medias), pero la app no debería depender de ello.
--   - <ext> es webp o jpg, según lo que haya podido generar el navegador (Safari puede no
--     codificar WebP).
-- plants.photo_path y plants.thumbnail_path guardan la ruta dentro del bucket, sin el nombre
-- del bucket. La lectura del administrador exige que la ruta coincida exactamente con una de
-- esas dos columnas.
--
-- Qué exige Storage a cada operación del cliente (referencia de supabase-js/swift, "RLS policy
-- permissions required", consultada el 21 de noviembre de 2026:
-- https://supabase.com/docs/reference/swift/storage-from-upload y páginas hermanas):
--   - upload sin upsert:              insert
--   - upload con upsert (reemplazar): select, insert y update
--   - download, list, createSignedUrl(s): select
--   - remove:                         select y delete
--   - move (no lo usa la app):        select y update; copy: select e insert
-- Ninguna necesita permisos sobre storage.buckets. Las políticas de abajo cubren las cuatro
-- órdenes.
--
-- Storage con Clerk: Storage recibe el mismo token de Clerk que la base de datos y ejecuta las
-- consultas como authenticated con sus claims, así que auth.jwt() ->> 'sub' es el id de Clerk
-- (la guía de control de acceso usa exactamente "(storage.foldername(name))[1] = (select
-- auth.jwt()->>'sub')": https://supabase.com/docs/guides/storage/security/access-control).
-- Las políticas no usan owner ni owner_id: owner es uuid y está obsoleto, y owner_id se toma
-- del sub (https://supabase.com/docs/guides/storage/security/ownership), pero la ruta ya dice
-- quién es el dueño y no depende de cómo rellene Storage esas columnas con un id que no es uuid.
--
-- Permisos en Supabase real: el esquema storage y sus tablas pertenecen a
-- supabase_storage_admin (https://supabase.com/docs/guides/platform/permissions). Esta
-- migración, que se aplica como postgres, solo hace lo que postgres puede hacer allí:
--   - insertar y actualizar filas de storage.buckets: postgres tiene "all ... with grant
--     option" sobre storage.buckets y storage.objects (migración 0049 de supabase/storage) y la
--     propia documentación crea buckets con "insert into storage.buckets"
--     (https://supabase.com/docs/guides/storage/buckets/creating-buckets).
--   - crear políticas en storage.objects: supautils.policy_grants concede a postgres crear,
--     cambiar y borrar políticas de storage.objects y storage.buckets sin ser su dueño
--     (configuración de supabase/postgres, ansible/files/postgresql_config/supautils.conf.j2).
-- No altera ninguna tabla de storage (RLS ya está activada en storage.objects y en
-- storage.buckets) ni borra objetos.

-- 1. Bucket --------------------------------------------------------------------------------
--
-- file_size_limit va en bytes (migración 0014 de supabase/storage). 1 MiB: las fotos se suben
-- ya comprimidas desde el navegador (objetivo: menos de 300 KB la foto y 30 KB la miniatura),
-- así que deja margen de sobra para una compresión que no alcance el objetivo, y a la vez
-- impide subir una foto sin comprimir de la cámara (varios MB) o llenar el 1 GB del plan
-- gratuito con pocos archivos. El límite global del proyecto (50 MB en el plan gratuito) es
-- mayor, como exige Storage.
--
-- allowed_mime_types: solo image/webp e image/jpeg. Storage rechaza la subida cuyo tipo de
-- contenido no está en la lista.
--
-- "on conflict do update": si el bucket ya existía (por ejemplo, creado a mano desde el panel),
-- queda con estos mismos valores.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('plant-photos', 'plant-photos', false, 1048576, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set name = excluded.name,
      public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. ¿Es la foto de una planta por validar? -----------------------------------------------
--
-- La cola de propuestas (#22) necesita que el administrador vea la foto de las plantas por
-- validar, pero el administrador no lee plants de otros usuarios (RLS), así que la política no
-- puede hacer un "exists" sobre plants con sus permisos. Esta función lo comprueba con los del
-- dueño (security definer) y solo responde verdadero o falso para una ruta concreta: no
-- devuelve ningún dato de la planta.
--
-- Sigue el patrón de las funciones de administrador (supabase/README.md): vive en public,
-- security definer, search_path vacío, primera sentencia el guardián (error 42501 si quien
-- llama no es administrador) y ejecutable solo por authenticated. Se eligió así, y no una
-- función en private, porque una política se evalúa con los permisos de quien consulta:
-- authenticated tendría que tener USAGE sobre private y EXECUTE sobre la función, y la regla
-- general de tests/seguridad_general.sql lo prohíbe para todo private. La contrapartida es que
-- la API la expone en /rest/v1/rpc/is_pending_plant_photo, solo útil para un administrador, que
-- ya puede ver esas fotos.
--
-- Como el guardián lanza un error a quien no es administrador, la política la llama dentro de
-- un "case when (select public.is_catalog_admin()) then ... end": Postgres no garantiza el
-- orden de evaluación de un "and", pero sí el de un case
-- (https://www.postgresql.org/docs/17/sql-expressions.html#SYNTAX-EXPRESS-EVAL). Si alguna vez
-- no lo respetara, la lectura de fotos fallaría con 42501 para los usuarios sin rol: falla
-- cerrada y visible, nunca abre nada.
--
-- Cómo busca: toma la planta del segundo segmento de la ruta y la lee por su clave primaria,
-- así que usa el índice plants_pkey y no hace falta un índice nuevo. Exige además que el
-- primer segmento sea el dueño de la planta, que la planta esté "por validar" y que la ruta
-- sea exactamente su photo_path o su thumbnail_path actuales. Así un usuario no puede abrirle
-- al administrador la foto de otro apuntando su planta a una ruta ajena, y las fotos antiguas
-- o huérfanas de una planta pendiente no quedan visibles. Un segundo segmento que no es un
-- uuid devuelve falso sin intentar convertirlo (la conversión fallaría con error).

create function public.is_pending_plant_photo(object_name text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_segment text;
  plant_segment text;
begin
  perform private.require_catalog_admin();

  owner_segment := split_part(object_name, '/', 1);
  plant_segment := split_part(object_name, '/', 2);
  if owner_segment is null or owner_segment = ''
     or not coalesce(plant_segment ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false) then
    return false;
  end if;

  return exists (
    select
    from public.plants p
    where p.id = plant_segment::uuid
      and p.user_id = owner_segment
      and p.validation = 'pending'
      and (p.photo_path = object_name or p.thumbnail_path = object_name)
  );
end;
$$;

comment on function public.is_pending_plant_photo(text) is
  'Solo administradores: si la ruta es la foto o la miniatura actual de una planta por validar (bucket plant-photos).';

revoke all on function public.is_pending_plant_photo(text) from public, anon, authenticated, service_role;
grant execute on function public.is_pending_plant_photo(text) to authenticated;

-- 3. Políticas de storage.objects ----------------------------------------------------------
--
-- Solo para authenticated (anon no tiene ninguna, así que sin sesión no se lee ni se sube
-- nada), una por orden y todas limitadas a bucket_id = 'plant-photos', para no afectar a otros
-- buckets. La carpeta se compara con (select public.requesting_user_id()), que se evalúa una
-- vez por consulta; sin sub es null y la comparación no deja pasar nada. Un objeto en la raíz
-- del bucket (sin carpeta) tampoco: storage.foldername() devuelve un arreglo vacío.
--
-- La lectura del dueño y la del administrador van en la misma política de select, con un
-- "or", para no tener dos políticas permisivas para el mismo rol y la misma orden (el asesor
-- de Supabase avisa de ello, como en las políticas del catálogo).

create policy plant_photos_select_own_or_pending_for_admin
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'plant-photos'
    and (
      (storage.foldername(name))[1] = (select public.requesting_user_id())
      or case
        when (select public.is_catalog_admin()) then public.is_pending_plant_photo(name)
        else false
      end
    )
  );

create policy plant_photos_insert_own
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'plant-photos'
    and (storage.foldername(name))[1] = (select public.requesting_user_id())
  );

-- using: solo sus objetos; with check: no puede moverlos a otra carpeta ni a otro bucket.
create policy plant_photos_update_own
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'plant-photos'
    and (storage.foldername(name))[1] = (select public.requesting_user_id())
  )
  with check (
    bucket_id = 'plant-photos'
    and (storage.foldername(name))[1] = (select public.requesting_user_id())
  );

create policy plant_photos_delete_own
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'plant-photos'
    and (storage.foldername(name))[1] = (select public.requesting_user_id())
  );
