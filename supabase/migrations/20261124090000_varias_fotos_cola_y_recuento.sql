-- Varias fotos: cola de propuestas, acceso del administrador y número de fotos (issue #184,
-- parte de #181).
--
-- Desde el #182 cada planta tiene de 0 a 6 fotos en public.plant_photos. Esta migración adapta
-- lo que aún leía solo la foto principal (las columnas de plants) y añade el número de fotos:
--   1. public.is_pending_plant_photo(): el administrador del catálogo descarga TODAS las fotos
--      de las plantas por validar, no solo la principal, y solo esas.
--   2. public.list_proposal_groups(): las fotos de cada grupo salen de plant_photos, hasta seis,
--      repartidas entre las plantas del grupo y con las principales primero.
--   3. public.photo_count(plants): número de fotos de una planta, como campo calculado de
--      PostgREST (select=...,photo_count), para el inventario y la exportación.
--
-- Segura para la app ya instalada: las tres firmas no cambian (las dos primeras se reemplazan
-- con "create or replace") y la tercera es nueva, así que ninguna petición de una versión
-- anterior cambia de forma. La cola devuelve el mismo array de {photo_path, thumbnail_path},
-- con hasta seis fotos en lugar de cuatro, y la pantalla ya pinta las que lleguen.
--
-- Sin índices nuevos: las fotos de una planta se encuentran por el índice único
-- plant_photos_plant_id_position_key (plant_id, position), cuya primera columna es plant_id, y
-- la planta por plants_pkey. tests/fotos_storage.sql comprueba ese plan.

-- 1. ¿Es una foto de una planta por validar? -------------------------------------------
--
-- La política plant_photos_select_own_or_pending_for_admin de storage.objects (migración
-- 20261121090000) no cambia: sigue llamando a esta función, dentro del "case" que solo deja
-- llegar al administrador. Lo que cambia es qué rutas acepta. Antes, solo photo_path y
-- thumbnail_path de plants (la principal); ahora, además, cualquier foto o miniatura de una
-- fila de plant_photos de esa planta. Las demás condiciones son las de antes: la planta es la
-- del segundo segmento de la ruta, su dueño es el primero y está por validar. Las fotos
-- antiguas o huérfanas de la carpeta siguen cerradas (no las cita ninguna fila), y las de una
-- planta validada o no identificable también.
--
-- Se conserva la comparación con las columnas de plants, aunque hoy sean una copia de la
-- principal: cubre una planta antigua que no se pudo copiar a plant_photos (con una sola
-- ruta, ver private.copy_legacy_plant_photos()) y no cuesta nada, porque es la misma fila. Se
-- retirará con las columnas en el #186.
--
-- Coste: la política se evalúa por archivo. Son dos consultas por clave, cada una de una fila
-- o de pocas: la primera lee la planta por plants_pkey; la segunda, solo si la ruta no es la
-- principal, la planta por plants_pkey y sus fotos (6 como mucho) por el índice único
-- (plant_id, position). Van separadas, y no con un "or exists", para que cada una tenga un plan
-- simple por índice.

create or replace function public.is_pending_plant_photo(object_name text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_segment text;
  plant_segment text;
  target_plant_id uuid;
begin
  perform private.require_catalog_admin();

  owner_segment := split_part(object_name, '/', 1);
  plant_segment := split_part(object_name, '/', 2);
  if owner_segment is null or owner_segment = ''
     or not coalesce(plant_segment ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false) then
    return false;
  end if;
  target_plant_id := plant_segment::uuid;

  -- La principal, en las columnas de plants.
  if exists (
    select
    from public.plants p
    where p.id = target_plant_id
      and p.user_id = owner_segment
      and p.validation = 'pending'
      and (p.photo_path = object_name or p.thumbnail_path = object_name)
  ) then
    return true;
  end if;

  -- Cualquier foto de la planta en plant_photos.
  return exists (
    select
    from public.plants p
    join public.plant_photos f on f.plant_id = p.id
    where p.id = target_plant_id
      and f.plant_id = target_plant_id
      and p.user_id = owner_segment
      and p.validation = 'pending'
      and (f.photo_path = object_name or f.thumbnail_path = object_name)
  );
end;
$$;

comment on function public.is_pending_plant_photo(text) is
  'Solo administradores: si la ruta es una foto o miniatura de una planta por validar (sus filas de plant_photos o la principal de plants), en el bucket plant-photos.';

-- "create or replace" conserva los permisos; se repiten por claridad.
revoke all on function public.is_pending_plant_photo(text) from public, anon, authenticated, service_role;
grant execute on function public.is_pending_plant_photo(text) to authenticated;

-- 2. Cola de propuestas: fotos de cada grupo --------------------------------------------
--
-- Misma firma y mismas columnas que en 20261121180000_cola_de_propuestas.sql. Solo cambia
-- photos:
--   - De dónde: de plant_photos de las plantas del grupo. Una planta antigua sin filas en
--     plant_photos pero con foto y miniatura en plants (no debería quedar ninguna) aporta esa
--     como su principal, para no perderla.
--   - Cuántas: hasta seis por grupo (el máximo de fotos de una planta, así un grupo de una sola
--     planta las muestra todas). Son las que mejor ayudan a identificar el nombre; más
--     alargarían la tarjeta y las peticiones de URL firmadas.
--   - Cuáles y en qué orden: por turnos. Primero la principal de cada planta, de la planta más
--     reciente a la más antigua; después la segunda foto de cada planta, en el mismo orden; y
--     así hasta llegar a seis. Así un grupo de varias plantas muestra una foto de cada una
--     antes que varias de la misma, y uno de una sola planta muestra sus fotos en su orden.
--     A igualdad de fecha, por el id de la planta.
--   - Qué lleva cada una: solo {photo_path, thumbnail_path}, como antes. Ni la fecha ni la
--     nota de la foto (texto libre del usuario), ni in_bloom, ni el id de la foto o de la
--     planta. Las rutas llevan el id del usuario: la app solo las usa para pedir la URL
--     firmada, nunca las muestra ni las registra.

create or replace function public.list_proposal_groups(page_size integer default 20, page_offset integer default 0)
returns table (
  name_key text,
  proposed_name text,
  genus_id uuid,
  genus_name text,
  type public.plant_type,
  plant_count bigint,
  photos jsonb,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  size integer;
  skip integer;
begin
  perform private.require_catalog_admin();

  size := coalesce(list_proposal_groups.page_size, 20);
  if size <= 0 then
    size := 20;
  end if;
  size := least(size, 100);
  skip := greatest(coalesce(list_proposal_groups.page_offset, 0), 0);

  return query
  with pending as (
    select p.id,
           public.normalize_search_text(p.entered_name) as key,
           pg_catalog.regexp_replace(pg_catalog.btrim(p.entered_name), '\s+', ' ', 'g') as written,
           p.genus_id as genus,
           p.type as plant_type,
           p.photo_path,
           p.thumbnail_path,
           p.created_at
      from public.plants p
      where p.validation = 'pending'
  ),
  groups as (
    select pe.key, pe.genus, pg_catalog.count(*) as plants
      from pending pe
      group by pe.key, pe.genus
  )
  select
    g.key,
    (select pe.written
       from pending pe
       where pe.key = g.key and pe.genus = g.genus
       group by pe.written
       order by pg_catalog.count(*) desc, pe.written collate "C"
       limit 1),
    g.genus,
    ge.name,
    (select pe.plant_type
       from pending pe
       where pe.key = g.key and pe.genus = g.genus
       group by pe.plant_type
       order by pg_catalog.count(*) desc, pe.plant_type
       limit 1),
    g.plants,
    (select coalesce(pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object('photo_path', s.photo_path, 'thumbnail_path', s.thumbnail_path)
              order by s.turn, s.plant_created_at desc, s.plant, s.photo_position), '[]'::jsonb)
       from (
         select c.photo_path, c.thumbnail_path, c.turn, c.plant_created_at, c.plant, c.photo_position
           from (
             select f.photo_path,
                    f.thumbnail_path,
                    pg_catalog.row_number() over (partition by f.plant_id order by f.position) as turn,
                    pe.created_at as plant_created_at,
                    pe.id as plant,
                    f.position as photo_position
               from pending pe
               join public.plant_photos f on f.plant_id = pe.id
               where pe.key = g.key and pe.genus = g.genus
             union all
             select pe.photo_path, pe.thumbnail_path, 1::bigint, pe.created_at, pe.id, 0
               from pending pe
               where pe.key = g.key and pe.genus = g.genus
                 and pe.photo_path is not null and pe.thumbnail_path is not null
                 and not exists (select from public.plant_photos f where f.plant_id = pe.id)
           ) c
           order by c.turn, c.plant_created_at desc, c.plant, c.photo_position
           limit 6
       ) s),
    pg_catalog.count(*) over ()
  from groups g
  join public.genera ge on ge.id = g.genus
  order by g.plants desc, g.key collate "C", ge.name collate "C", g.genus
  limit size
  offset skip;
end;
$$;

comment on function public.list_proposal_groups(integer, integer) is
  'Backoffice: grupos de la cola de propuestas (nombre por validar), con nombre, género, tipo, número de plantas y hasta seis fotos (principales primero, repartidas entre las plantas), sin datos del usuario. Función de administrador.';

revoke all on function public.list_proposal_groups(integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_proposal_groups(integer, integer) to authenticated;

-- 3. Número de fotos de una planta -------------------------------------------------------
--
-- public.photo_count(plants) es un campo calculado de PostgREST: una función cuyo único
-- argumento es una fila de plants se pide como si fuera una columna
-- (GET /rest/v1/plants?select=id,...,photo_count), también en el "select" de un insert o un
-- update. La app lo lee con el resto de la planta (COLLECTION_PLANT_SELECT).
--
-- Por qué un recuento en la consulta y no un contador en plants:
--   - Un contador mantenido por disparadores obligaría a escribir plants al añadir o quitar
--     una foto que no es la principal; hoy eso no toca la planta ni su updated_at (decisión
--     del #182), y lo seguiría tocando también desde la app antigua.
--   - El recuento es barato: por cada planta, una búsqueda en el índice único
--     plant_photos_plant_id_position_key de como mucho seis entradas. Medido en la base
--     desechable (Postgres 14, en un portátil) con 500 plantas y 1 500 fotos de un usuario y
--     5 000 plantas de otros, leyendo como ese usuario con RLS: la consulta de la colección
--     pasa de 0,2 ms a unos 7 ms (unos 14 µs por planta, sobre todo la llamada a la función y
--     la política de plant_photos; en PL/pgSQL cuesta lo mismo). Es poco frente a la red y a
--     la serialización de PostgREST, y una página de 1 000 plantas añadiría unos 14 ms.
--   - No depende de las funciones de agregado de PostgREST (plant_photos(count)), que Supabase
--     trae desactivadas.
--
-- security invoker: cuenta con los permisos de quien llama, así que RLS de plant_photos se
-- aplica y cada usuario cuenta solo sus fotos (las de sus plantas). Un administrador, que no
-- lee plants ajenas, nunca llega a pedirla de una planta ajena. anon no la ejecuta.
--
-- Detalle de PostgREST: en un insert o un update con "select", la función ve el estado
-- anterior a la sentencia (es stable), así que si la sentencia crea la principal por la
-- sincronización con plants (app antigua), devuelve 0 aunque la planta ya tenga foto. La app
-- toma como mínimo 1 si hay principal (photo_path), y la siguiente lectura trae el número
-- exacto.

create function public.photo_count(plant public.plants)
returns integer
language sql
stable
set search_path = ''
as $$
  select pg_catalog.count(*)::integer
    from public.plant_photos f
    where f.plant_id = plant.id
$$;

comment on function public.photo_count(public.plants) is
  'Número de fotos de la planta en plant_photos (0 a 6). Campo calculado de PostgREST: select=...,photo_count.';

revoke all on function public.photo_count(public.plants) from public, anon, authenticated, service_role;
grant execute on function public.photo_count(public.plants) to authenticated, service_role;
