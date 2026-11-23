-- Ficha del ejemplar: identificador, notas y bitácora (issue #264, parte de #263).
--
-- Qué crea:
--   1. El identificador del ejemplar (CAT-012) en plants: code_prefix, code_number y la columna
--      generada code, asignados por un disparador al insertar e inmutables. Los contadores por
--      usuario y prefijo viven en private.plant_code_counters. Las plantas existentes reciben
--      el suyo por orden de alta.
--   2. Las notas de la planta: plants.notes, texto opcional de hasta 2000 caracteres.
--   3. La bitácora: la tabla public.plant_log_entries, con su enumerado, sus restricciones, RLS,
--      la función public.add_plant_log_entry() (alta sin duplicar al reintentar) y la función
--      public.list_plant_log_entries() (lectura por páginas con cursor).
--   4. Fotos de la bitácora en el bucket plant-photos, en <usuario>/<planta>/log/<archivo>:
--      public.is_pending_plant_photo() deja de aceptar cualquier ruta con subcarpetas, así que
--      el administrador del catálogo nunca las ve.
--   5. La limpieza con la cuenta: los contadores se borran con el perfil.
--
-- Segura para la app ya desplegada:
--   - La app inserta plantas sin las columnas nuevas: el disparador pone el identificador y
--     notes queda en null. Las tres columnas del identificador tienen un valor por defecto
--     ('' y 0) solo para que la API y los tipos generados las traten como opcionales al
--     insertar; ese valor no cumple las restricciones, así que si alguna vez faltara el
--     disparador el alta fallaría en lugar de guardar una planta sin identificador.
--   - La app lee columnas concretas (COLLECTION_PLANT_SELECT): las nuevas no le llegan hasta
--     que las pida, y PostgREST no cambia la forma de lo que ya pide.
--   - Ninguna función ni política existente cambia de firma; is_pending_plant_photo() solo
--     rechaza además rutas que hoy no puede tener ninguna foto de la galería.
--
-- Identificador: modelo y alternativas
-- ------------------------------------
-- Se guarda partido: code_prefix (tres letras) y code_number (entero), más la columna generada
-- code ('CAT-012', 'CAT-1000') para mostrar y buscar. Partido, para ordenar por número real
-- (con un solo texto, 'CAT-1000' iría antes que 'CAT-200') y para que el único por usuario sea
-- un índice sobre (user_id, code_prefix, code_number), que sirve también para ese orden y para
-- calcular el máximo de un prefijo. Se descartó un solo texto (orden malo, y el número habría
-- que extraerlo para el siguiente) y una secuencia global (no es correlativo por usuario).
--
-- Prefijo: las tres primeras letras del nombre del género de la planta al darla de alta (tras
-- el disparador sync_with_species, que pone el de la especie si la hay), normalizado con
-- normalize_search_text() (sin tildes ni signo de híbrido) y sin nada que no sea una letra de
-- la a a la z, en mayúsculas. '×Brassocattleya' da BRA. Un género con menos de tres letras
-- (Aa) se completa con X: AAX. Así todos los prefijos tienen tres letras, el formato es fijo y
-- AA no se confunde con el comienzo de otro identificador. Sin ninguna letra (no hay géneros
-- así), XXX.
--
-- Número: correlativo por usuario y prefijo, desde 1, con al menos tres cifras al mostrarlo.
-- Lo da un contador por (usuario, prefijo) en private.plant_code_counters, que se incrementa
-- con un único "insert ... on conflict do update ... returning": la fila del contador queda
-- bloqueada hasta el final de la transacción, así que dos altas simultáneas del mismo usuario
-- y prefijo se ordenan y reciben números distintos (la segunda espera a la primera). Los
-- números no se reutilizan al borrar una planta, porque el contador no baja. Puede haber
-- huecos: un alta que falla después de tomar el número (se revierte con ella) no deja hueco,
-- pero un "insert ... on conflict do nothing" que choca sí consume uno (la app no lo usa).
-- Se descartó calcular max(code_number) + 1 con un bloqueo consultivo: reutilizaría el número
-- de la última planta borrada.
--
-- Al crear el contador de un prefijo, empieza en el mayor número que ya tenga el usuario con
-- ese prefijo (normalmente ninguno). Así, si un contador se pierde (por ejemplo, se borra el
-- perfil sin borrar las plantas), el siguiente número no choca con uno existente.
--
-- Inmutable: authenticated no tiene permiso para escribir esas columnas (ni code, que es
-- generada), y el disparador keep_code rechaza cualquier cambio venga de quien venga. Cambiar
-- el género después no lo cambia.

-- 1. Identificador del ejemplar -------------------------------------------------------------

-- Prefijo a partir del nombre de un género. immutable, como normalize_search_text().
create function private.plant_code_prefix(genus_name text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select pg_catalog.rpad(
    pg_catalog.upper(
      pg_catalog.substr(
        pg_catalog.regexp_replace(coalesce(public.normalize_search_text(genus_name), ''), '[^a-z]', '', 'g'),
        1, 3
      )
    ),
    3, 'X'
  )
$$;

comment on function private.plant_code_prefix(text) is
  'Prefijo del identificador de una planta: tres primeras letras del género, sin tildes ni signos, en mayúsculas; con X si faltan.';

revoke all on function private.plant_code_prefix(text) from public;

-- Contadores por usuario y prefijo. En private: la API no los ve y solo los usan los
-- disparadores (security definer). RLS activada sin políticas, por si algún día se concede
-- algo por error.
create table private.plant_code_counters (
  user_id text not null,
  prefix text not null,
  last_number integer not null,
  primary key (user_id, prefix),
  constraint plant_code_counters_prefix_valid check (prefix ~ '^[A-Z]{3}$'),
  constraint plant_code_counters_last_number_positive check (last_number >= 1)
);

comment on table private.plant_code_counters is
  'Último número de identificador dado a cada usuario y prefijo (CAT-012). Nunca baja: los números no se reutilizan.';

alter table private.plant_code_counters enable row level security;
revoke all on table private.plant_code_counters from public, anon, authenticated, service_role;

-- Columnas nuevas de plants. El valor por defecto ('' y 0) no cumple las restricciones (ver
-- arriba): siempre lo sustituye el disparador.
alter table public.plants
  add column code_prefix text not null default '',
  add column code_number integer not null default 0,
  add column notes text;

comment on column public.plants.code_prefix is
  'Prefijo del identificador (tres letras del género al darla de alta). Lo pone la base al insertar y no cambia.';
comment on column public.plants.code_number is
  'Número del identificador, correlativo por usuario y prefijo desde 1. Lo pone la base al insertar y no cambia.';
comment on column public.plants.notes is
  'Notas libres del usuario sobre la planta (hasta 2000 caracteres); null si no hay.';

-- Relleno de las plantas existentes, por orden de alta (created_at, id) dentro de cada usuario
-- y prefijo, con el género que tienen hoy (no se guarda el de su alta). Continúa desde el
-- contador si ya existe, así que es idempotente: solo toca las plantas sin identificador
-- (code_number = 0). No mueve updated_at: set_updated_at se desactiva mientras dura (el
-- identificador no es un cambio del usuario). Ningún otro disparador de plants mira estas
-- columnas. Va en una función para que tests/identificador_y_notas.sql la pruebe (en la base
-- de pruebas no hay plantas al aplicar la migración). Solo la ejecuta su dueño.
create function private.backfill_plant_codes()
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  filled bigint;
begin
  alter table public.plants disable trigger set_updated_at;

  with pending as (
    select p.id,
           p.user_id,
           private.plant_code_prefix(g.name) as prefix,
           pg_catalog.row_number() over (
             partition by p.user_id, private.plant_code_prefix(g.name)
             order by p.created_at, p.id
           ) as ord
      from public.plants p
      join public.genera g on g.id = p.genus_id
      where p.code_number = 0
  ),
  numbered as (
    select pe.id,
           pe.prefix,
           pe.ord + greatest(
             coalesce((select c.last_number from private.plant_code_counters c
                        where c.user_id = pe.user_id and c.prefix = pe.prefix), 0),
             coalesce((select pg_catalog.max(p.code_number) from public.plants p
                        where p.user_id = pe.user_id and p.code_prefix = pe.prefix), 0)
           ) as number
      from pending pe
  )
  update public.plants p
     set code_prefix = n.prefix,
         code_number = n.number
    from numbered n
   where p.id = n.id;
  get diagnostics filled = row_count;

  alter table public.plants enable trigger set_updated_at;

  insert into private.plant_code_counters (user_id, prefix, last_number)
  select p.user_id, p.code_prefix, pg_catalog.max(p.code_number)
    from public.plants p
    where p.code_number > 0
    group by p.user_id, p.code_prefix
  on conflict (user_id, prefix) do update
    set last_number = greatest(private.plant_code_counters.last_number, excluded.last_number);

  return filled;
end;
$$;

comment on function private.backfill_plant_codes() is
  'Da identificador a las plantas que no lo tienen, por orden de alta dentro de cada usuario y prefijo (migración del #264). Idempotente.';

revoke all on function private.backfill_plant_codes() from public;

select private.backfill_plant_codes();

-- Restricciones, ya con todas las plantas rellenas.
alter table public.plants
  add constraint plants_code_prefix_valid check (code_prefix ~ '^[A-Z]{3}$'),
  add constraint plants_code_number_positive check (code_number >= 1),
  add constraint plants_notes_valid check (
    notes is null or (notes ~ '[^[:space:]]' and char_length(notes) <= 2000)
  ),
  add constraint plants_user_id_code_key unique (user_id, code_prefix, code_number);

-- Para mostrar y buscar: 'CAT-012', 'CAT-1000'. Generada, así nadie la escribe.
alter table public.plants
  add column code text generated always as (
    code_prefix || '-' || case
      when code_number < 1000 then pg_catalog.lpad(code_number::text, 3, '0')
      else code_number::text
    end
  ) stored;

comment on column public.plants.code is
  'Identificador del ejemplar para mostrar (CAT-012): prefijo, guion y número con al menos tres cifras. Generada.';

-- Disparador de alta. Se llama tag_code para ejecutarse después de sync_with_species (Postgres
-- ejecuta los disparadores "before" del mismo evento por orden alfabético), que pone el
-- género de la especie: el prefijo es el del género con el que queda la planta. Siempre
-- sustituye lo que venga (authenticated no puede enviarlo; service_role y el dueño, aunque
-- lo envíen, no eligen el identificador).
create function private.assign_plant_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  genus_name text;
begin
  select g.name into genus_name from public.genera g where g.id = new.genus_id;
  -- Sin género (la clave foránea lo rechazará después), cualquier prefijo vale.
  new.code_prefix := private.plant_code_prefix(genus_name);

  insert into private.plant_code_counters as c (user_id, prefix, last_number)
  values (
    new.user_id,
    new.code_prefix,
    1 + coalesce((select pg_catalog.max(p.code_number) from public.plants p
                   where p.user_id = new.user_id and p.code_prefix = new.code_prefix), 0)
  )
  on conflict (user_id, prefix) do update
    set last_number = c.last_number + 1
  returning c.last_number into new.code_number;

  return new;
end;
$$;

comment on function private.assign_plant_code() is
  'Disparador: da a la planta nueva su identificador (prefijo del género y siguiente número del usuario para ese prefijo).';

revoke all on function private.assign_plant_code() from public;

create trigger tag_code
  before insert on public.plants
  for each row execute function private.assign_plant_code();

-- Inmutable: ningún cambio del identificador, venga de donde venga. La única excepción es una
-- planta que aún no lo tiene (code_number = 0, el valor por defecto), que solo puede existir
-- antes de las restricciones de arriba: es lo que hace backfill_plant_codes().
create function private.keep_plant_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'el identificador de una planta no cambia'
    using errcode = '23514', constraint = 'plants_code_immutable';
end;
$$;

comment on function private.keep_plant_code() is
  'Disparador: rechaza cualquier cambio del identificador de una planta.';

revoke all on function private.keep_plant_code() from public;

create trigger keep_code
  before update of code_prefix, code_number on public.plants
  for each row
  when (old.code_number <> 0
        and (old.code_prefix is distinct from new.code_prefix or old.code_number is distinct from new.code_number))
  execute function private.keep_plant_code();

-- 2. Notas: authenticated las escribe como el resto de columnas (no el identificador). select
-- ya está concedido sobre la tabla entera, así que code, code_prefix, code_number y notes se
-- leen sin más, siempre con la política "Cada usuario lee sus plantas".
grant insert (notes), update (notes) on table public.plants to authenticated;

-- 3. Bitácora --------------------------------------------------------------------------------
--
-- Registros de lo que el usuario hace u observa en un ejemplar (no en la especie). En este
-- issue se crean y se consultan; no se editan. El dueño sí puede borrar los suyos (permiso y
-- política), para no necesitar otra migración si la interfaz lo añade; hoy no lo ofrece.
--
-- Reintento sin duplicar: idempotency_key, un uuid que genera la app para cada alta y conserva
-- al reintentar, único por usuario. La app crea los registros con add_plant_log_entry(), que
-- devuelve el registro nuevo o, si la clave ya se usó para esa planta, el que ya existía. Se
-- prefirió la función a un upsert por la API: con "on conflict do nothing" PostgREST no
-- devuelve la fila existente y la app tendría que leerla aparte, y con "do update" la
-- reescribiría.

create type public.plant_log_entry_type as enum (
  'watering',
  'nutrition',
  'preventive_maintenance',
  'preventive_health'
);

comment on type public.plant_log_entry_type is
  'Tipo de registro de la bitácora: riego, nutrición, mantenimiento preventivo, sanidad preventiva.';

create table public.plant_log_entries (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid not null references public.plants (id) on delete cascade,
  -- Dueño: id de Clerk, por defecto el del token. Siempre el de la planta (disparador
  -- check_plant, como en plant_photos).
  user_id text not null default (auth.jwt() ->> 'sub'),
  type public.plant_log_entry_type not null,
  title text not null,
  description text,
  -- Foto opcional, en <user_id>/<plant_id>/log/<archivo> del bucket plant-photos: las dos rutas
  -- o ninguna.
  photo_path text,
  thumbnail_path text,
  -- Floración observada: null = sin indicar.
  in_bloom boolean,
  -- Clave de reintento, generada por la app. Opcional; única por usuario.
  idempotency_key uuid,
  -- La pone la base; authenticated no puede escribirla.
  created_at timestamptz not null default now(),

  constraint plant_log_entries_title_valid check (
    title ~ '[^[:space:]]' and char_length(title) <= 120
  ),
  constraint plant_log_entries_description_valid check (
    description is null or (description ~ '[^[:space:]]' and char_length(description) <= 2000)
  ),
  constraint plant_log_entries_photo_paths_together check (
    (photo_path is null) = (thumbnail_path is null)
  ),
  -- "<user_id>/<plant_id>/log/" (el uuid en minúsculas) y un nombre de archivo sin más barras.
  -- 42 = 1 (barra) + 36 (uuid) + 5 ("/log/").
  constraint plant_log_entries_photo_path_valid check (
    photo_path is null or (
      char_length(photo_path) <= 1024
      and starts_with(photo_path, user_id || '/' || plant_id::text || '/log/')
      and char_length(photo_path) > char_length(user_id) + 42
      and strpos(substr(photo_path, char_length(user_id) + 43), '/') = 0
    )
  ),
  constraint plant_log_entries_thumbnail_path_valid check (
    thumbnail_path is null or (
      char_length(thumbnail_path) <= 1024
      and starts_with(thumbnail_path, user_id || '/' || plant_id::text || '/log/')
      and char_length(thumbnail_path) > char_length(user_id) + 42
      and strpos(substr(thumbnail_path, char_length(user_id) + 43), '/') = 0
    )
  ),
  constraint plant_log_entries_user_id_idempotency_key_key unique (user_id, idempotency_key)
);

comment on table public.plant_log_entries is
  'Bitácora de cada planta: riego, nutrición, mantenimiento y sanidad preventivos, con foto opcional. Solo se crea y se consulta.';

-- Lectura de una planta de la más reciente a la más antigua (con o sin filtro por tipo: una
-- planta tiene pocos registros) y la clave foránea al borrar la planta.
create index plant_log_entries_plant_id_created_at_idx
  on public.plant_log_entries (plant_id, created_at desc, id desc);

-- Dueño igual al de la planta, como check_plant_photo(). No bloquea la planta: no hay nada que
-- sincronizar con ella.
create function private.check_plant_log_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id text;
begin
  select p.user_id into owner_id from public.plants p where p.id = new.plant_id;
  if not found then
    -- La rechaza la clave foránea (23503).
    return new;
  end if;
  if new.user_id is null then
    new.user_id := owner_id;
  elsif new.user_id <> owner_id then
    raise exception 'el dueño del registro tiene que ser el de la planta'
      using errcode = '23514', constraint = 'plant_log_entries_user_id_matches_plant';
  end if;
  return new;
end;
$$;

comment on function private.check_plant_log_entry() is
  'Disparador: exige que el registro de bitácora sea del dueño de la planta.';

revoke all on function private.check_plant_log_entry() from public;

create trigger check_plant
  before insert or update of plant_id, user_id on public.plant_log_entries
  for each row execute function private.check_plant_log_entry();

-- Una planta con registros no cambia de dueño (solo podría hacerlo service_role): sus fotos
-- están en la carpeta del dueño anterior. Como check_photos_owner.
create function private.check_plant_log_owner_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select from public.plant_log_entries e where e.plant_id = new.id) then
    raise exception 'una planta con registros de bitácora no puede cambiar de dueño'
      using errcode = '23514', constraint = 'plant_log_entries_user_id_matches_plant';
  end if;
  return null;
end;
$$;

comment on function private.check_plant_log_owner_change() is
  'Disparador: impide cambiar el dueño de una planta que tiene registros de bitácora.';

revoke all on function private.check_plant_log_owner_change() from public;

create trigger check_log_owner
  after update of user_id on public.plants
  for each row
  when (old.user_id is distinct from new.user_id)
  execute function private.check_plant_log_owner_change();

-- RLS y privilegios: el dueño lee, crea y borra los suyos; nadie los edita por la API. El
-- administrador del catálogo no tiene ningún acceso (ni siquiera de plantas por validar).
alter table public.plant_log_entries enable row level security;

revoke all on table public.plant_log_entries from anon, authenticated, service_role;

grant select, insert, update, delete on table public.plant_log_entries to service_role;

grant select, delete on table public.plant_log_entries to authenticated;
grant insert (id, plant_id, user_id, type, title, description, photo_path, thumbnail_path, in_bloom, idempotency_key)
  on table public.plant_log_entries to authenticated;

create policy "Cada usuario lee sus registros de bitácora"
  on public.plant_log_entries
  for select
  to authenticated
  using (user_id = (select public.requesting_user_id()));

-- Que la planta sea suya lo exige además check_plant.
create policy "Cada usuario crea sus registros de bitácora"
  on public.plant_log_entries
  for insert
  to authenticated
  with check (user_id = (select public.requesting_user_id()));

create policy "Cada usuario borra sus registros de bitácora"
  on public.plant_log_entries
  for delete
  to authenticated
  using (user_id = (select public.requesting_user_id()));

-- Alta sin duplicar. security invoker: valen la RLS y los permisos por columna de quien llama.
-- Sin clave, inserta siempre. Con clave:
--   - nueva: inserta y devuelve el registro;
--   - ya usada por este usuario para la misma planta: no inserta y devuelve el que existe, tal
--     como está (aunque el resto de datos venga distinto: es un reintento);
--   - ya usada para otra planta: 22023 (un error de la app, no un reintento).
-- Dos llamadas simultáneas con la misma clave: la segunda espera a la primera en el índice
-- único, no inserta, y lee el registro ya confirmado (cada sentencia ve lo confirmado antes de
-- empezar, en READ COMMITTED, el nivel de PostgREST).
create function public.add_plant_log_entry(
  target_plant_id uuid,
  entry_type public.plant_log_entry_type,
  title text,
  description text default null,
  photo_path text default null,
  thumbnail_path text default null,
  in_bloom boolean default null,
  idempotency_key uuid default null
)
returns public.plant_log_entries
language plpgsql
volatile
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  entry public.plant_log_entries;
begin
  insert into public.plant_log_entries as e
    (plant_id, user_id, type, title, description, photo_path, thumbnail_path, in_bloom, idempotency_key)
  values (
    add_plant_log_entry.target_plant_id,
    (select public.requesting_user_id()),
    add_plant_log_entry.entry_type,
    add_plant_log_entry.title,
    add_plant_log_entry.description,
    add_plant_log_entry.photo_path,
    add_plant_log_entry.thumbnail_path,
    add_plant_log_entry.in_bloom,
    add_plant_log_entry.idempotency_key
  )
  on conflict on constraint plant_log_entries_user_id_idempotency_key_key do nothing
  returning e.* into entry;

  if entry.id is not null then
    return entry;
  end if;

  select e.* into entry
    from public.plant_log_entries e
    where e.user_id = (select public.requesting_user_id())
      and e.idempotency_key = add_plant_log_entry.idempotency_key;
  if entry.plant_id is distinct from add_plant_log_entry.target_plant_id then
    raise exception 'la clave de reintento ya se usó para otra planta' using errcode = '22023';
  end if;
  return entry;
end;
$$;

comment on function public.add_plant_log_entry(uuid, public.plant_log_entry_type, text, text, text, text, boolean, uuid) is
  'Crea un registro de bitácora de una planta propia. Con la misma idempotency_key devuelve el registro ya creado en lugar de duplicarlo.';

revoke all on function public.add_plant_log_entry(uuid, public.plant_log_entry_type, text, text, text, text, boolean, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.add_plant_log_entry(uuid, public.plant_log_entry_type, text, text, text, text, boolean, uuid)
  to authenticated;

-- Lectura por páginas: los registros de una planta de la más reciente a la más antigua
-- (created_at y, a igualdad, id), opcionalmente de un tipo, después del cursor (el created_at
-- y el id del último registro de la página anterior, los dos o ninguno, tal como llegaron:
-- el texto de created_at lleva microsegundos, que un Date de JavaScript perdería). De 1 a 100
-- por página, 20 por defecto. security invoker: cada usuario solo ve los suyos; una planta
-- ajena o inexistente no devuelve nada.
create function public.list_plant_log_entries(
  target_plant_id uuid,
  entry_type public.plant_log_entry_type default null,
  before_created_at timestamptz default null,
  before_id uuid default null,
  page_size integer default 20
)
returns setof public.plant_log_entries
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  size integer := least(greatest(coalesce(list_plant_log_entries.page_size, 20), 1), 100);
begin
  if (list_plant_log_entries.before_created_at is null) <> (list_plant_log_entries.before_id is null) then
    raise exception 'el cursor lleva created_at e id, o ninguno' using errcode = '22023';
  end if;

  if list_plant_log_entries.before_created_at is null then
    return query
      select e.*
        from public.plant_log_entries e
        where e.plant_id = list_plant_log_entries.target_plant_id
          and (list_plant_log_entries.entry_type is null or e.type = list_plant_log_entries.entry_type)
        order by e.created_at desc, e.id desc
        limit size;
  else
    return query
      select e.*
        from public.plant_log_entries e
        where e.plant_id = list_plant_log_entries.target_plant_id
          and (e.created_at, e.id) < (list_plant_log_entries.before_created_at, list_plant_log_entries.before_id)
          and (list_plant_log_entries.entry_type is null or e.type = list_plant_log_entries.entry_type)
        order by e.created_at desc, e.id desc
        limit size;
  end if;
end;
$$;

comment on function public.list_plant_log_entries(uuid, public.plant_log_entry_type, timestamptz, uuid, integer) is
  'Registros de bitácora de una planta propia, del más reciente al más antiguo, con filtro por tipo y cursor (created_at, id).';

revoke all on function public.list_plant_log_entries(uuid, public.plant_log_entry_type, timestamptz, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_plant_log_entries(uuid, public.plant_log_entry_type, timestamptz, uuid, integer)
  to authenticated, service_role;

-- 4. Fotos de la bitácora y el administrador ---------------------------------------------
--
-- Van en <usuario>/<planta>/log/<archivo>. Las políticas del dueño (primer segmento) ya las
-- cubren: sube, lee y borra las suyas, y nadie más. La del administrador llama a
-- is_pending_plant_photo(), que solo acepta rutas que cita una fila de plant_photos o las
-- columnas de foto de plants. Una foto de bitácora no puede estar en plant_photos (su
-- restricción de ruta no admite subcarpetas), y en plants solo podría acabar saltándose la
-- sincronización. Para que el administrador no las vea nunca, se exige además aquí que la ruta
-- tenga exactamente tres segmentos (<usuario>/<planta>/<archivo>): cualquier subcarpeta, y por
-- tanto toda foto de bitácora, queda fuera. Lo demás no cambia (ver la migración
-- 20261124090000_varias_fotos_cola_y_recuento.sql).

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

  if object_name is null
     or pg_catalog.array_length(pg_catalog.string_to_array(object_name, '/'), 1) <> 3 then
    return false;
  end if;

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
  'Solo administradores: si la ruta es una foto o miniatura de una planta por validar (sus filas de plant_photos o la principal de plants), en el bucket plant-photos. Nunca una ruta con subcarpetas (fotos de bitácora).';

revoke all on function public.is_pending_plant_photo(text) from public, anon, authenticated, service_role;
grant execute on function public.is_pending_plant_photo(text) to authenticated;

-- 5. Limpieza con la cuenta ------------------------------------------------------------------
--
-- La eliminación de cuenta borra las fotos (toda la carpeta del usuario, también log/), las
-- plantas (y con ellas, en cascada, sus fotos y sus registros de bitácora) y el perfil. Los
-- contadores del identificador no tienen dueño por la API: se borran con el perfil, como los
-- eventos de producto. Si quedaran plantas del usuario, el contador se recrea desde su mayor
-- número (ver assign_plant_code()), así que no hay choque.

create function private.delete_profile_plant_codes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.plant_code_counters where user_id = old.id;
  return old;
end;
$$;

comment on function private.delete_profile_plant_codes() is
  'Disparador de profiles: borra los contadores de identificador del usuario cuyo perfil se borra.';

revoke all on function private.delete_profile_plant_codes() from public;

create trigger delete_plant_code_counters
  after delete on public.profiles
  for each row execute function private.delete_profile_plant_codes();
