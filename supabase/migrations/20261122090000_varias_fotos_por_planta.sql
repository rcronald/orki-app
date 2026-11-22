-- Varias fotos por planta: tabla plant_photos (issue #182, parte de #181).
--
-- Hasta ahora cada planta tenía una sola foto, en tres columnas de public.plants (photo_path,
-- thumbnail_path y photo_in_bloom). Desde esta migración una planta tiene de 0 a 6 fotos en
-- public.plant_photos, cada una con su fecha y su nota opcionales. Este cambio es solo de la
-- base de datos: la app se adapta en sub-issues posteriores.
--
-- Qué crea:
--   1. La tabla public.plant_photos, con sus restricciones e índices.
--   2. El disparador check_plant: bloquea la planta mientras se escriben sus fotos y
--      garantiza que el dueño de la foto es el de la planta.
--   3. La sincronización en los dos sentidos con las columnas de plants (ver abajo).
--   4. RLS y permisos: cada usuario lo suyo; el administrador del catálogo solo lee las fotos
--      de plantas por validar, con la nueva función public.is_pending_plant().
--   5. La copia de las fotos que ya existen.
--
-- Foto principal y columnas de plants
-- -----------------------------------
-- La foto principal es la de position más baja. plants.photo_path, plants.thumbnail_path y
-- plants.photo_in_bloom se mantienen como copia de la principal porque hay versiones de la app
-- ya instaladas (PWA con service worker) que solo leen y escriben esas columnas; también las
-- leen list_proposal_groups(), is_pending_plant_photo() (y con ella la política del bucket
-- para el administrador) y el script de fotos huérfanas, que no cambian aquí. Se retirarán en
-- el #186, cuando ninguna versión instalada las use.
--
-- Sincronización (todo con disparadores, para que valga desde la app nueva, la antigua, los
-- scripts y el editor SQL):
--   - plant_photos -> plants: tras insertar, borrar o cambiar la posición, las rutas o
--     in_bloom de una foto, se copia la principal a plants (o null, null, false si no queda
--     ninguna). Solo se escribe plants si algo cambia, así que añadir una foto que no es la
--     principal no toca la planta ni su updated_at.
--   - plants -> plant_photos (lo que hace la app antigua):
--       * poner una foto (rutas no nulas y la planta sin fotos): se crea la fila en la
--         posición 0, con in_bloom = photo_in_bloom.
--       * sustituirla (rutas nuevas): se cambian las rutas e in_bloom de la principal, y su
--         fecha y su nota vuelven a null, porque describían la foto anterior. Las demás fotos
--         no cambian.
--       * cambiar solo photo_in_bloom: se cambia in_bloom de la principal.
--       * quitarla (las dos rutas a null): se borra solo la principal y la siguiente pasa a
--         serlo; la misma sentencia devuelve ya la planta con la foto nueva, así la app antigua
--         la muestra en lugar de quedarse sin foto. Si no queda ninguna, la planta queda sin
--         foto y photo_in_bloom conserva lo que mande la app, como hasta ahora.
--       * una sola de las dos rutas: se rechaza (23514). La app nunca lo hace, y no hay forma
--         de reflejarlo en plant_photos, que exige las dos.
--
-- Sin recursión: cada lado escribe en el otro con la marca de transacción orki.photo_sync
-- puesta (set_config(..., true)) y la devuelve a su valor anterior en cuanto termina la
-- sentencia. Los disparadores del otro lado ven la marca y no hacen nada, así que cada cambio
-- da como mucho un salto. Si la sentencia falla, Postgres revierte también la marca (los
-- valores de set_config se deshacen con la subtransacción o la transacción). Se descartó
-- pg_trigger_depth(): también saltaría la sincronización cuando la escritura viene de
-- cualquier otro disparador o de una cascada futura, sin que se note.
--
-- Disparadores existentes de plants: set_updated_at sigue actuando en cada actualización (si
-- la sincronización cambia las columnas de la foto, updated_at avanza, igual que cuando la app
-- antigua cambia la foto) y sync_with_species no mira estas columnas. La app antigua no ve
-- ninguna diferencia en lo que escribe ni en lo que le devuelve la base, salvo la promoción de
-- la siguiente foto al quitar la principal, que solo puede pasar si la app nueva añadió más.
--
-- Máximo de 6 fotos, también con inserciones concurrentes
-- -------------------------------------------------------
-- Lo garantizan dos restricciones, sin contar filas: position va de 0 a 5
-- (plant_photos_position_range) y es única por planta (plant_photos_plant_id_position_key).
-- Una planta no puede tener más de seis posiciones distintas, así que no hay séptima foto. La
-- unicidad la comprueba el índice único, que ve también las filas sin confirmar de otras
-- transacciones: si dos inserciones concurrentes eligen la misma posición, la segunda espera
-- a la primera y falla con 23505. Vale con cualquier nivel de aislamiento.
-- Se descartó un disparador que cuente las fotos con la planta bloqueada: en REPEATABLE READ el
-- recuento usa la instantánea del inicio de la transacción y dejaría pasar una séptima.
-- La unicidad es "deferrable initially immediate": se comprueba al final de cada sentencia, no
-- fila a fila, para poder reordenar (intercambiar posiciones) con un solo update.
--
-- Concurrencia de la sincronización
-- ---------------------------------
-- Antes de escribir una foto, check_plant bloquea la fila de la planta (for no key update).
-- Así las escrituras de fotos de una misma planta se hacen de una en una, y la copia de la
-- principal a plants siempre parte de lo ya confirmado: sin el bloqueo, dos transacciones que
-- añaden fotos a la vez podrían copiar cada una "su" principal y dejar en plants la que no es.
-- La app antigua, al actualizar plants, ya tiene la fila bloqueada. El bloqueo no frena a
-- quien solo lee la planta.

-- 1. Tabla -----------------------------------------------------------------------------

create table public.plant_photos (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid not null references public.plants (id) on delete cascade,
  -- Dueño de la foto: id de usuario de Clerk, como plants.user_id y por defecto el del token.
  -- Siempre es el dueño de la planta (lo garantiza el disparador check_plant; sin token, lo
  -- toma de la planta).
  user_id text not null default (auth.jwt() ->> 'sub'),
  -- Rutas dentro del bucket plant-photos, sin el nombre del bucket, con la convención
  -- <user_id>/<plant_id>/<archivo> de la migración del bucket.
  photo_path text not null,
  thumbnail_path text not null,
  -- Si la foto es en floración.
  in_bloom boolean not null default false,
  -- Fecha de la foto, según el usuario. Opcional.
  taken_at date,
  -- Nota libre sobre la foto. Opcional.
  note text,
  -- Orden de las fotos de la planta: la más baja es la principal. De 0 a 5 (máximo de 6).
  position integer not null,
  created_at timestamptz not null default now(),

  constraint plant_photos_position_range check (position between 0 and 5),
  constraint plant_photos_plant_id_position_key unique (plant_id, position)
    deferrable initially immediate,
  -- La ruta empieza por "<user_id>/<plant_id>/" (el uuid en minúsculas, como lo escribe
  -- Postgres) y sigue con un nombre de archivo sin más barras. El tope de 1024 caracteres es
  -- el de plants. starts_with y no like, porque el id de Clerk podría traer "_" o "%".
  constraint plant_photos_photo_path_valid check (
    char_length(photo_path) <= 1024
    and starts_with(photo_path, user_id || '/' || plant_id::text || '/')
    and char_length(photo_path) > char_length(user_id) + 38
    and strpos(substr(photo_path, char_length(user_id) + 39), '/') = 0
  ),
  constraint plant_photos_thumbnail_path_valid check (
    char_length(thumbnail_path) <= 1024
    and starts_with(thumbnail_path, user_id || '/' || plant_id::text || '/')
    and char_length(thumbnail_path) > char_length(user_id) + 38
    and strpos(substr(thumbnail_path, char_length(user_id) + 39), '/') = 0
  ),
  -- Como los textos libres de plants: no en blanco (para "sin nota" está null) y con tope. Una
  -- nota es más larga que un apodo o una ubicación (120), pero sigue siendo una línea o dos.
  constraint plant_photos_note_valid check (
    note is null or (btrim(note) <> '' and char_length(note) <= 500)
  ),
  -- Como plants.acquired_on: no futura, con un día de margen por las zonas horarias.
  constraint plant_photos_taken_at_not_future check (taken_at <= current_date + 1)
);

comment on table public.plant_photos is
  'Fotos de cada planta (hasta 6). La principal, la de position más baja, se copia a plants.photo_path, thumbnail_path y photo_in_bloom.';

-- Las fotos de una planta en orden: el índice único (plant_id, position) ya sirve, también
-- para la clave foránea y para buscar la principal. Las fotos de un usuario:
create index plant_photos_user_id_idx on public.plant_photos (user_id);

-- 2. Bloqueo de la planta y dueño de la foto -------------------------------------------
--
-- Antes de insertar, cambiar o borrar una foto: bloquea la planta (ver "Concurrencia de la
-- sincronización" arriba) y, al insertar o cambiar, comprueba que user_id es el dueño de la
-- planta o lo toma de ella si viene nulo. Con la marca de sincronización puesta, la escritura
-- viene de un disparador de plants que ya tiene la fila bloqueada y no se vuelve a bloquear.
-- Si la planta no existe, no hace nada: la rechaza la clave foránea (23503). El mensaje de
-- error no dice de quién es la planta.

create function private.check_plant_photo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  syncing boolean := coalesce(pg_catalog.current_setting('orki.photo_sync', true), '') = 'on';
  owner_id text;
begin
  if tg_op in ('UPDATE', 'DELETE') and not syncing then
    perform from public.plants p where p.id = old.plant_id for no key update;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  if syncing then
    select p.user_id into owner_id from public.plants p where p.id = new.plant_id;
  else
    select p.user_id into owner_id from public.plants p where p.id = new.plant_id for no key update;
  end if;
  if not found then
    return new;
  end if;

  if new.user_id is null then
    new.user_id := owner_id;
  elsif new.user_id <> owner_id then
    raise exception 'el dueño de la foto tiene que ser el de la planta'
      using errcode = '23514', constraint = 'plant_photos_user_id_matches_plant';
  end if;
  return new;
end;
$$;

comment on function private.check_plant_photo() is
  'Disparador: bloquea la planta al escribir sus fotos y exige que la foto sea del dueño de la planta.';

create trigger check_plant
  before insert or update or delete on public.plant_photos
  for each row execute function private.check_plant_photo();

-- Cambiar el dueño de una planta con fotos (solo puede hacerlo service_role o el dueño de las
-- tablas: la política de plants no deja pasar una planta a otro usuario) se rechaza: las
-- fotos están en la carpeta del dueño anterior.
create function private.check_plant_owner_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select from public.plant_photos f where f.plant_id = new.id) then
    raise exception 'una planta con fotos no puede cambiar de dueño'
      using errcode = '23514', constraint = 'plant_photos_user_id_matches_plant';
  end if;
  return null;
end;
$$;

comment on function private.check_plant_owner_change() is
  'Disparador: impide cambiar el dueño de una planta que tiene fotos.';

create trigger check_photos_owner
  after update of user_id on public.plants
  for each row
  when (old.user_id is distinct from new.user_id)
  execute function private.check_plant_owner_change();

-- 3. Sincronización ----------------------------------------------------------------------

-- plant_photos -> plants: copia la principal de una planta a sus columnas de foto.
create function private.copy_main_photo_to_plant(target_plant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  main_photo_path text;
  main_thumbnail_path text;
  main_in_bloom boolean := false;
  previous_flag text := coalesce(pg_catalog.current_setting('orki.photo_sync', true), '');
begin
  select f.photo_path, f.thumbnail_path, f.in_bloom
    into main_photo_path, main_thumbnail_path, main_in_bloom
    from public.plant_photos f
    where f.plant_id = target_plant_id
    order by f.position
    limit 1;
  if not found then
    main_in_bloom := false;
  end if;

  perform pg_catalog.set_config('orki.photo_sync', 'on', true);
  update public.plants p
    set photo_path = main_photo_path,
        thumbnail_path = main_thumbnail_path,
        photo_in_bloom = main_in_bloom
    where p.id = target_plant_id
      and (p.photo_path is distinct from main_photo_path
           or p.thumbnail_path is distinct from main_thumbnail_path
           or p.photo_in_bloom is distinct from main_in_bloom);
  perform pg_catalog.set_config('orki.photo_sync', previous_flag, true);
end;
$$;

comment on function private.copy_main_photo_to_plant(uuid) is
  'Copia la foto principal (position más baja) a plants.photo_path, thumbnail_path y photo_in_bloom.';

create function private.sync_plant_from_photos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(pg_catalog.current_setting('orki.photo_sync', true), '') = 'on' then
    return null;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    perform private.copy_main_photo_to_plant(old.plant_id);
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.plant_id is distinct from old.plant_id) then
    perform private.copy_main_photo_to_plant(new.plant_id);
  end if;
  return null;
end;
$$;

comment on function private.sync_plant_from_photos() is
  'Disparador: tras escribir una foto, copia la principal de la planta a plants.';

-- Al borrar una planta, la cascada borra sus fotos y este disparador no encuentra la planta:
-- el update no toca ninguna fila.
create trigger sync_plant
  after insert or delete or update of plant_id, position, photo_path, thumbnail_path, in_bloom
  on public.plant_photos
  for each row execute function private.sync_plant_from_photos();

-- plants -> plant_photos, al quitar la foto (las dos rutas a null). Es "before" para que la
-- sentencia de la app antigua devuelva ya la siguiente foto como principal.
create function private.remove_main_photo_from_plant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_flag text := coalesce(pg_catalog.current_setting('orki.photo_sync', true), '');
  next_photo record;
begin
  if previous_flag = 'on' then
    return new;
  end if;

  perform pg_catalog.set_config('orki.photo_sync', 'on', true);
  delete from public.plant_photos f
    where f.id = (select m.id from public.plant_photos m
                   where m.plant_id = new.id
                   order by m.position
                   limit 1);
  perform pg_catalog.set_config('orki.photo_sync', previous_flag, true);

  select f.photo_path, f.thumbnail_path, f.in_bloom
    into next_photo
    from public.plant_photos f
    where f.plant_id = new.id
    order by f.position
    limit 1;
  if found then
    new.photo_path := next_photo.photo_path;
    new.thumbnail_path := next_photo.thumbnail_path;
    new.photo_in_bloom := next_photo.in_bloom;
  end if;
  return new;
end;
$$;

comment on function private.remove_main_photo_from_plant() is
  'Disparador: al quitar la foto de una planta desde plants, borra la principal y promueve la siguiente.';

create trigger remove_main_photo
  before update of photo_path, thumbnail_path on public.plants
  for each row
  when (new.photo_path is null and new.thumbnail_path is null
        and (old.photo_path is not null or old.thumbnail_path is not null))
  execute function private.remove_main_photo_from_plant();

-- plants -> plant_photos, al poner o sustituir la foto o cambiar photo_in_bloom. Es "after"
-- para que la planta ya exista (al insertarla) y haya pasado sus propias restricciones: una
-- ruta en blanco o demasiado larga la rechaza plants con su restricción, como siempre.
create function private.copy_plant_photo_to_photos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_flag text := coalesce(pg_catalog.current_setting('orki.photo_sync', true), '');
  main_photo record;
  has_photos boolean;
begin
  if previous_flag = 'on' then
    return null;
  end if;

  if new.photo_path is null or new.thumbnail_path is null then
    if (new.photo_path is null) <> (new.thumbnail_path is null)
       and (tg_op = 'INSERT'
            or new.photo_path is distinct from old.photo_path
            or new.thumbnail_path is distinct from old.thumbnail_path) then
      raise exception 'la foto y la miniatura de una planta van juntas: las dos o ninguna'
        using errcode = '23514', constraint = 'plants_photo_paths_together';
    end if;
    return null;
  end if;

  select f.id, f.photo_path, f.thumbnail_path, f.in_bloom
    into main_photo
    from public.plant_photos f
    where f.plant_id = new.id
    order by f.position
    limit 1;
  has_photos := found;

  perform pg_catalog.set_config('orki.photo_sync', 'on', true);
  if not has_photos then
    insert into public.plant_photos (plant_id, user_id, photo_path, thumbnail_path, in_bloom, position)
      values (new.id, new.user_id, new.photo_path, new.thumbnail_path, new.photo_in_bloom, 0);
  elsif main_photo.photo_path <> new.photo_path or main_photo.thumbnail_path <> new.thumbnail_path then
    update public.plant_photos f
      set photo_path = new.photo_path,
          thumbnail_path = new.thumbnail_path,
          in_bloom = new.photo_in_bloom,
          taken_at = null,
          note = null
      where f.id = main_photo.id;
  elsif main_photo.in_bloom <> new.photo_in_bloom then
    update public.plant_photos f
      set in_bloom = new.photo_in_bloom
      where f.id = main_photo.id;
  end if;
  perform pg_catalog.set_config('orki.photo_sync', previous_flag, true);
  return null;
end;
$$;

comment on function private.copy_plant_photo_to_photos() is
  'Disparador: refleja en plant_photos la foto que se pone, sustituye o marca en floración desde plants.';

create trigger copy_photo_to_photos
  after insert on public.plants
  for each row
  when (new.photo_path is not null or new.thumbnail_path is not null)
  execute function private.copy_plant_photo_to_photos();

create trigger copy_photo_to_photos_on_update
  after update of photo_path, thumbnail_path, photo_in_bloom on public.plants
  for each row
  when (old.photo_path is distinct from new.photo_path
        or old.thumbnail_path is distinct from new.thumbnail_path
        or old.photo_in_bloom is distinct from new.photo_in_bloom)
  execute function private.copy_plant_photo_to_photos();

-- Nadie fuera del dueño ejecuta estas funciones (los disparadores no lo necesitan).
revoke all on function private.check_plant_photo() from public;
revoke all on function private.check_plant_owner_change() from public;
revoke all on function private.copy_main_photo_to_plant(uuid) from public;
revoke all on function private.sync_plant_from_photos() from public;
revoke all on function private.remove_main_photo_from_plant() from public;
revoke all on function private.copy_plant_photo_to_photos() from public;

-- 4. RLS y permisos --------------------------------------------------------------------

-- ¿Está la planta por validar? Para la lectura del administrador: el mismo criterio que
-- is_pending_plant_photo() aplica al bucket (planta con validation = 'pending'), pero para
-- todas sus fotos y no solo para la ruta actual de plants. Como aquella, es una función de
-- administrador (security definer, guardián primero, solo authenticated) porque el
-- administrador no lee las plantas de otros usuarios y la política se evalúa con sus permisos.
-- Solo responde verdadero o falso. La lee por la clave primaria.
create function public.is_pending_plant(target_plant_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_catalog_admin();

  return exists (
    select from public.plants p where p.id = target_plant_id and p.validation = 'pending'
  );
end;
$$;

comment on function public.is_pending_plant(uuid) is
  'Solo administradores: si la planta está por validar (para leer sus fotos en plant_photos).';

revoke all on function public.is_pending_plant(uuid) from public, anon, authenticated, service_role;
grant execute on function public.is_pending_plant(uuid) to authenticated;

alter table public.plant_photos enable row level security;

revoke all on table public.plant_photos from anon, authenticated, service_role;

grant select, insert, update, delete on table public.plant_photos to service_role;

-- authenticated: leer, borrar, insertar todas las columnas menos created_at y cambiar solo lo
-- que describe la foto. Una foto no se cambia de planta ni de dueño: se borra y se crea otra.
grant select, delete on table public.plant_photos to authenticated;
grant insert (id, plant_id, user_id, photo_path, thumbnail_path, in_bloom, taken_at, note, position)
  on table public.plant_photos to authenticated;
grant update (photo_path, thumbnail_path, in_bloom, taken_at, note, position)
  on table public.plant_photos to authenticated;

-- Una sola política de lectura para el dueño y el administrador, como en storage.objects, y
-- con el mismo "case" para que los usuarios sin rol nunca lleguen al guardián.
create policy "Cada usuario lee sus fotos y el administrador las de plantas por validar"
  on public.plant_photos
  for select
  to authenticated
  using (
    user_id = (select public.requesting_user_id())
    or case
      when (select public.is_catalog_admin()) then public.is_pending_plant(plant_id)
      else false
    end
  );

-- with check: nadie crea una foto a nombre de otro. Que la planta sea suya lo exige además
-- check_plant (el dueño de la foto es el de la planta).
create policy "Cada usuario crea sus fotos"
  on public.plant_photos
  for insert
  to authenticated
  with check (user_id = (select public.requesting_user_id()));

create policy "Cada usuario edita sus fotos"
  on public.plant_photos
  for update
  to authenticated
  using (user_id = (select public.requesting_user_id()))
  with check (user_id = (select public.requesting_user_id()));

create policy "Cada usuario borra sus fotos"
  on public.plant_photos
  for delete
  to authenticated
  using (user_id = (select public.requesting_user_id()));

-- 5. Copia de las fotos existentes ------------------------------------------------------
--
-- Cada planta con foto y miniatura pasa a tener su fila en la posición 0, con in_bloom de
-- photo_in_bloom. created_at toma el de la planta: casi todas las fotos se ponen al
-- registrarla, y plants no guarda cuándo se cambió la foto (updated_at cambia con cualquier
-- edición). Idempotente: no copia la planta que ya tiene alguna foto. Los disparadores de
-- plant_photos se ejecutan, pero la principal ya coincide con plants y no la reescriben, así
-- que updated_at de las plantas no cambia.
--
-- Una planta con una sola de las dos rutas, o con rutas fuera de la convención (la app nunca
-- las ha escrito así), no se puede copiar: se deja como está y se avisa con su número. Si la
-- app antigua vuelve a poner su foto, se crea la fila entonces.
--
-- Va en una función para que tests/fotos_de_plantas.sql la pruebe sobre plantas antiguas (en
-- la base de pruebas no hay datos al aplicar la migración). Solo la ejecuta su dueño.

create function private.copy_legacy_plant_photos()
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  copied bigint;
  skipped bigint;
begin
  insert into public.plant_photos (plant_id, user_id, photo_path, thumbnail_path, in_bloom, position, created_at)
  select p.id, p.user_id, p.photo_path, p.thumbnail_path, p.photo_in_bloom, 0, p.created_at
    from public.plants p
    where p.photo_path is not null
      and p.thumbnail_path is not null
      and starts_with(p.photo_path, p.user_id || '/' || p.id::text || '/')
      and char_length(p.photo_path) > char_length(p.user_id) + 38
      and strpos(substr(p.photo_path, char_length(p.user_id) + 39), '/') = 0
      and starts_with(p.thumbnail_path, p.user_id || '/' || p.id::text || '/')
      and char_length(p.thumbnail_path) > char_length(p.user_id) + 38
      and strpos(substr(p.thumbnail_path, char_length(p.user_id) + 39), '/') = 0
      and not exists (select from public.plant_photos f where f.plant_id = p.id);
  get diagnostics copied = row_count;

  select pg_catalog.count(*) into skipped
    from public.plants p
    where (p.photo_path is not null or p.thumbnail_path is not null)
      and not exists (select from public.plant_photos f where f.plant_id = p.id);
  if skipped > 0 then
    raise warning 'plant_photos: % plantas con foto no se copiaron (una sola ruta o fuera de la convención)', skipped;
  end if;
  return copied;
end;
$$;

comment on function private.copy_legacy_plant_photos() is
  'Copia a plant_photos la foto de las plantas que aún no tienen ninguna (migración del #182). Idempotente.';

revoke all on function private.copy_legacy_plant_photos() from public;

select private.copy_legacy_plant_photos();
