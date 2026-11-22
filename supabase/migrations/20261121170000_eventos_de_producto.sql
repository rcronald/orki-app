-- Eventos de producto para medir los dos objetivos de la Fase 1 (issue #145, parte de #24).
--
-- Objetivos (sección 1 de docs/specification.md): registrar una orquídea en menos de 1 minuto
-- y responder "¿Ya la tengo?" en menos de 5 segundos. La app (#146) envía dos eventos:
--   - plant_registered: registro completado, con su duración, si llevaba foto y si el nombre
--     quedó por validar.
--   - have_it_search: búsqueda "¿Ya la tengo?", con su duración y su resultado (la tengo, no
--     la tengo, parecidas).
-- Las consultas de los indicadores están en docs/indicadores-de-eventos.sql.
--
-- Qué crea:
--   1. Los enumerados product_event_type y product_event_result.
--   2. La tabla public.product_events, de solo inserción.
--   3. public.record_product_events(events jsonb), con la que la app envía un lote.
--   4. Un disparador que borra los eventos de un usuario al borrar su perfil.
--
-- Qué se guarda y qué no
-- ----------------------
-- Solo valores de forma y tamaño fijos: un uuid, dos enumerados, un entero, tres booleanos y
-- dos fechas, más el id de Clerk, que pone la base. Ninguna columna de texto libre: ni nombres
-- de plantas ni textos buscados, ni correo, ni nombre. No hay columna de ambiente: cada
-- proyecto de Supabase es un ambiente. Así la tabla no sirve de almacén arbitrario: cada fila
-- ocupa siempre lo mismo y solo admite los valores de las listas cerradas.
--
-- Quién puede qué
-- ---------------
--   - authenticated: solo insertar, y solo eventos suyos. user_id no se puede escribir desde
--     la API (permiso por columna): lo pone el valor por defecto, public.requesting_user_id(),
--     y la política lo vuelve a exigir. received_at tampoco: lo pone la base. No puede leer,
--     editar, borrar ni vaciar, tampoco sus propios eventos.
--   - anon: nada. Un evento sin sesión no tiene dueño; la app lo guarda hasta tener sesión.
--   - service_role: leer y borrar, para los scripts de mantenimiento (por ejemplo, el de
--     datos de usuarios que ya no existen en Clerk, #26). No inserta ni edita: los eventos
--     solo los genera la app de cada usuario y no cambian.
--   - postgres (dueño, desde el editor SQL de Supabase o una conexión directa): todo. Es
--     quien ejecuta las consultas de los indicadores.
--
-- Reintentos sin duplicados
-- -------------------------
-- El id lo genera la app al crear el evento (crypto.randomUUID()) y lo conserva en su cola
-- hasta que el envío se confirma. Si la respuesta se pierde y la app reenvía el lote,
-- record_product_events() inserta con "on conflict do nothing": el evento ya guardado se
-- ignora sin error y sin cambiarlo. La función no devuelve nada, así que tampoco dice si un id
-- ya existía (ni si era de otro usuario: un choque de uuid aleatorios es improbable, y aun así
-- solo descartaría el evento nuevo, sin revelar ni tocar el ajeno).
--
-- Va sin columna de conflicto ("on conflict (id)") porque Postgres exige permiso de lectura
-- sobre esa columna, y authenticated no lee nada de esta tabla. Hoy la única restricción única
-- es la clave primaria, así que es lo mismo; si algún día se añade otra, sus choques también
-- se ignorarán en silencio. Por la misma razón, un upsert de supabase-js con ignoreDuplicates
-- (como el de profiles) falla con 42501, y un insert directo con un id repetido falla con
-- 23505: la app debe usar la función.
--
-- Borrado con la cuenta
-- ---------------------
-- Como plants, product_events no tiene clave foránea hacia profiles: se puede registrar un
-- evento aunque la creación del perfil (ProfileBootstrap, #66) aún no haya llegado a la base,
-- por ejemplo sin conexión. Las plantas las borra la app en la eliminación de cuenta (#26),
-- antes del perfil; los eventos no, porque nadie los borra por la API. Por eso un disparador
-- de profiles borra los eventos del usuario cuando se borra su perfil, sea desde la app, con
-- la clave de servicio o desde el editor SQL. La app debe vaciar su cola de eventos antes de
-- borrar el perfil (#146 y #26): un evento que llegue después quedaría sin perfil, y lo
-- encontraría el script de datos sin dueño (#26).

-- Enumerados ----------------------------------------------------------------------------

-- Tipo de evento: registro completado y búsqueda "¿Ya la tengo?".
create type public.product_event_type as enum ('plant_registered', 'have_it_search');

-- Resultado de una búsqueda "¿Ya la tengo?": la tengo, no la tengo, tengo parecidas. El
-- registro completado no tiene resultado (siempre es "guardada").
create type public.product_event_result as enum ('owned', 'not_owned', 'similar');

-- Tabla ---------------------------------------------------------------------------------

create table public.product_events (
  -- Generado por la app; es lo que evita duplicados al reintentar. Sin valor por defecto: un
  -- evento sin id propio no se podría reenviar sin duplicarlo.
  id uuid primary key,
  -- Id de Clerk del usuario, el del token de la petición. authenticated no puede escribirlo.
  user_id text not null default public.requesting_user_id(),
  type public.product_event_type not null,
  -- Solo en have_it_search.
  result public.product_event_result,
  -- Duración medida en la app, en milisegundos.
  duration_ms integer not null,
  -- Solo en plant_registered: si se registró con foto y si el nombre quedó por validar.
  has_photo boolean,
  name_pending boolean,
  -- Si el evento se generó sin conexión y se envió después.
  generated_offline boolean not null,
  -- Cuándo ocurrió, según el reloj del dispositivo.
  occurred_at timestamptz not null,
  -- Cuándo llegó a la base. authenticated no puede escribirlo.
  received_at timestamptz not null default now(),

  constraint product_events_user_id_valid check (
    btrim(user_id) <> '' and char_length(user_id) <= 100
  ),
  -- Cada tipo con sus campos: el registro lleva foto y nombre por validar y no lleva
  -- resultado; la búsqueda lleva resultado y no lleva los otros dos.
  constraint product_events_fields_match_type check (
    case type
      when 'plant_registered' then
        result is null and has_photo is not null and name_pending is not null
      when 'have_it_search' then
        result is not null and has_photo is null and name_pending is null
    end
  ),
  -- Entre 0 y 24 horas: lo que pase de ahí es un error de medida (por ejemplo, un formulario
  -- abierto de un día para otro), no un registro lento.
  constraint product_events_duration_ms_range check (duration_ms between 0 and 86400000),
  -- Hasta 30 días antes de recibirlo (la cola de la app descarta los más antiguos, #146) y
  -- hasta 1 hora después, por relojes adelantados. Se compara con received_at y no con now()
  -- para que la restricción no cambie con el tiempo: así una copia de seguridad restaurada
  -- más tarde sigue cumpliéndola.
  constraint product_events_occurred_at_range check (
    occurred_at between received_at - interval '30 days' and received_at + interval '1 hour'
  )
);

comment on table public.product_events is
  'Eventos de producto (registro completado y búsqueda "¿Ya la tengo?"), de solo inserción. Sin textos libres.';

-- Los indicadores agrupan por tipo y semana.
create index product_events_type_occurred_at_idx on public.product_events (type, occurred_at);

-- Borrar los eventos de un usuario al borrar su perfil.
create index product_events_user_id_idx on public.product_events (user_id);

-- Row Level Security y privilegios ------------------------------------------------------

alter table public.product_events enable row level security;

revoke all on table public.product_events from anon, authenticated, service_role;

-- Todas las columnas menos user_id y received_at, que pone la base.
grant insert (
  id, type, result, duration_ms, has_photo, name_pending, generated_offline, occurred_at
) on table public.product_events to authenticated;

grant select, delete on table public.product_events to service_role;

-- La única política: sin políticas de select, update ni delete, RLS no deja leer, editar ni
-- borrar nada aunque se concediera el permiso por error.
create policy "Cada usuario registra sus eventos"
  on public.product_events
  for insert
  to authenticated
  with check (user_id = (select public.requesting_user_id()));

-- Envío por lotes -----------------------------------------------------------------------
--
-- La app llama a POST /rest/v1/rpc/record_product_events con {"events": [...]}, donde cada
-- elemento es un objeto con id, type, result, duration_ms, has_photo, name_pending,
-- generated_offline y occurred_at (las claves que falten valen null; las que sobren se
-- ignoran). Como mucho 100 eventos por llamada.
--
-- El lote es atómico: si un evento incumple una restricción o trae un valor que no es del tipo
-- (por ejemplo, un enumerado desconocido), falla entero y no se guarda ninguno. Esos errores
-- (clase 22 o 23, salvo los duplicados, que no dan error) no se arreglan reintentando: la app
-- debe descartar el lote. Un error de red, 5xx o de sesión, en cambio, se reintenta.
--
-- security invoker: inserta con los permisos de quien llama, así que se aplican los permisos
-- por columna y la política de arriba, igual que un insert directo.

create function public.record_product_events(events jsonb)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if events is null or jsonb_typeof(events) <> 'array' then
    raise exception 'events debe ser un arreglo de eventos'
      using errcode = '22023';
  end if;
  if jsonb_array_length(events) > 100 then
    raise exception 'como mucho 100 eventos por llamada'
      using errcode = '22023';
  end if;

  insert into public.product_events (
    id, type, result, duration_ms, has_photo, name_pending, generated_offline, occurred_at
  )
  select e.id, e.type, e.result, e.duration_ms, e.has_photo, e.name_pending,
         e.generated_offline, e.occurred_at
    from jsonb_to_recordset(events) as e (
      id uuid,
      type public.product_event_type,
      result public.product_event_result,
      duration_ms integer,
      has_photo boolean,
      name_pending boolean,
      generated_offline boolean,
      occurred_at timestamptz
    )
  on conflict do nothing;
end;
$$;

comment on function public.record_product_events(jsonb) is
  'Registra un lote de hasta 100 eventos de producto del usuario de la petición. Un id ya registrado se ignora sin error.';

revoke all on function public.record_product_events(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.record_product_events(jsonb) to authenticated;

-- Borrado con el perfil -----------------------------------------------------------------
--
-- security definer: quien borra su perfil (authenticated) no tiene permiso para borrar
-- eventos; la función se ejecuta como el dueño de la tabla, que no está sujeto a RLS. Vive en
-- private, sin permiso de ejecución para nadie más que su dueño: los disparadores no lo
-- necesitan.

create function private.delete_profile_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.product_events where user_id = old.id;
  return old;
end;
$$;

comment on function private.delete_profile_events() is
  'Disparador de profiles: borra los eventos de producto del usuario cuyo perfil se borra.';

revoke all on function private.delete_profile_events() from public;

create trigger delete_product_events
  after delete on public.profiles
  for each row execute function private.delete_profile_events();
