-- Auditoría del catálogo: tabla, disparadores y permisos (issue #131, parte de #23).
--
-- Esta migración:
--   1. Crea la tabla public.catalog_audit_log, de solo anexar: cada fila es un cambio de una
--      fila del catálogo (alta, edición o baja) o una acción con sentido propio (una fusión,
--      una validación de la cola...). Solo la leen los administradores del catálogo; nadie la
--      escribe por la API.
--   2. Crea el disparador audit_change en las cuatro tablas del catálogo (genera,
--      genus_abbreviations, species y species_names), que registra cada alta, edición y baja
--      hecha con un token de usuario.
--   3. Crea private.log_catalog_action(), para que la fusión (#21) y la cola (#22) registren
--      su acción y agrupen bajo ella los cambios de fila que provocan.
--
-- Quién
-- -----
-- El id de usuario de Clerk de la petición (public.requesting_user_id(), el claim "sub"). Una
-- acción registrada sin token (una carga por script, #132) lleva el identificador de la carga
-- que le pase quien la registra. Nada de datos personales: solo ids de Clerk y datos del
-- catálogo.
--
-- Sesiones sin token de usuario: sin auditoría fila a fila
-- --------------------------------------------------------
-- El disparador solo registra si la petición trae un usuario (public.requesting_user_id() no
-- es null). Las cargas por script (scripts/catalog-import, con conexión directa o con la
-- clave de servicio) no traen "sub", así que no dejan una fila por registro: una importación
-- de COL toca decenas de miles de filas y llenaría el plan gratuito. Cada carga dejará una
-- fila de resumen con su identificador (#132). La comprobación es lo primero que hace la
-- función, antes de convertir la fila a JSON, para que una carga solo pague leer el token.
-- No va en el "when" del disparador porque ahí se evalúa con el rol de quien escribe, y un
-- rol sin permiso sobre requesting_user_id() no podría escribir el catálogo (lo prueba
-- sincronizacion.sql con un rol editor sin más permisos).
--
-- Qué se guarda de cada cambio
-- ----------------------------
--   insert: new_values con la fila entera; old_values null.
--   update: old_values y new_values solo con las columnas que cambian. updated_at no cuenta
--           (lo mueve el disparador set_updated_at en cada update): una edición que no
--           cambia ningún otro valor no deja registro.
--   delete: old_values con la fila entera; new_values null. Los borrados en cascada (los
--           nombres de una especie, las abreviaturas de un género) dejan su propio registro.
--
-- Acciones e id de acción
-- -----------------------
-- Todas las filas de la auditoría llevan un action_id (uuid) que agrupa los cambios que van
-- juntos. Vive en el ajuste local de la transacción "orki.catalog_action_id":
--   - Si nadie registró una acción, el primer cambio auditado de la transacción crea un id y
--     lo guarda ahí, y los siguientes de la misma transacción lo reutilizan. Como cada llamada
--     a la API es una transacción, todo lo que hace una función del backoffice (un lote de
--     set_catalog_species_status(), una especie borrada con sus nombres) queda agrupado.
--   - private.log_catalog_action() crea un id nuevo, inserta la fila de la acción con ese id
--     y lo deja en el ajuste: los cambios de fila que vienen después en la transacción quedan
--     bajo esa acción. Ver el comentario de la función para cómo usarla.
-- El ajuste se fija con set_config(..., true), así que desaparece al terminar la transacción
-- (también si se revierte) y no pasa a la siguiente petición que reutilice la conexión.
--
-- Permisos
-- --------
-- RLS activada. authenticated solo tiene select, y la política exige
-- (select public.is_catalog_admin()); anon no tiene ningún permiso; service_role solo lee
-- (es la excepción a "service_role lee y escribe todo": la auditoría es de solo anexar). Solo
-- escriben el disparador (security definer, se ejecuta como postgres) y las funciones que
-- corren como postgres. La secuencia del id tampoco se concede a nadie.
--
-- Conservación: en la Fase 1 no se borra ningún registro (decisión pendiente en #134).

-- Tabla ---------------------------------------------------------------------------------------

create table public.catalog_audit_log (
  -- Orden de llegada: dentro de una misma transacción created_at es igual para todas.
  id bigint generated always as identity primary key,
  -- Agrupa los cambios que van juntos (ver "Acciones e id de acción").
  action_id uuid not null,
  -- Id de usuario de Clerk, o identificador de la carga por script.
  actor text not null,
  -- insert, update o delete para un cambio de fila; otro nombre (merge_species,
  -- validate_plant...) para una acción con sentido propio.
  action text not null,
  -- Tabla y fila afectadas: obligatorias en un cambio de fila, opcionales en una acción.
  table_name text,
  row_id uuid,
  -- Valores anteriores y nuevos (ver "Qué se guarda de cada cambio"). Solo en cambios de fila.
  old_values jsonb,
  new_values jsonb,
  -- Datos de una acción con sentido propio (por ejemplo, de qué especie a cuál se fusiona).
  details jsonb,
  created_at timestamptz not null default now(),
  constraint catalog_audit_log_actor_not_blank check (btrim(actor) <> ''),
  constraint catalog_audit_log_action_format check (action ~ '^[a-z][a-z_]*$'),
  constraint catalog_audit_log_table_name_format check (table_name is null or table_name ~ '^[a-z][a-z_]*$'),
  constraint catalog_audit_log_row_change_shape check (
    case action
      when 'insert' then table_name is not null and row_id is not null
        and old_values is null and new_values is not null and details is null
      when 'update' then table_name is not null and row_id is not null
        and old_values is not null and new_values is not null and details is null
      when 'delete' then table_name is not null and row_id is not null
        and old_values is not null and new_values is null and details is null
      else old_values is null and new_values is null
    end
  )
);

comment on table public.catalog_audit_log is
  'Auditoría del catálogo, de solo anexar: cambios de fila hechos con token de usuario y acciones con sentido propio.';

-- Historial de una fila (el de una especie en el backoffice, #133), en orden.
create index catalog_audit_log_row_idx on public.catalog_audit_log (table_name, row_id, id);
-- Consultas por fecha (lo último que cambió, revisar el tamaño en #134).
create index catalog_audit_log_created_at_idx on public.catalog_audit_log (created_at);
-- Todos los cambios de una acción (una fusión con las filas que tocó).
create index catalog_audit_log_action_id_idx on public.catalog_audit_log (action_id);

alter table public.catalog_audit_log enable row level security;

revoke all on table public.catalog_audit_log from public, anon, authenticated, service_role;
grant select on table public.catalog_audit_log to authenticated, service_role;

-- Supabase (y la base desechable de las pruebas) concede por defecto las secuencias nuevas
-- de public; nadie de la API la necesita, porque solo insertan funciones que corren como
-- postgres.
revoke all on sequence public.catalog_audit_log_id_seq from public, anon, authenticated, service_role;

create policy catalog_audit_log_select_catalog_admin on public.catalog_audit_log
  for select to authenticated
  using ((select public.is_catalog_admin()));

-- Id de acción de la transacción --------------------------------------------------------------
--
-- Devuelve el id de acción de la transacción en curso y, si todavía no hay ninguno, crea uno
-- y lo guarda en el ajuste local "orki.catalog_action_id". current_setting devuelve null si el
-- ajuste nunca se fijó en la sesión y '' si se fijó en una transacción anterior.

create function private.current_catalog_action_id()
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_id text;
begin
  current_id := nullif(pg_catalog.current_setting('orki.catalog_action_id', true), '');
  if current_id is null then
    current_id := pg_catalog.gen_random_uuid()::text;
    perform pg_catalog.set_config('orki.catalog_action_id', current_id, true);
  end if;
  return current_id::uuid;
end;
$$;

comment on function private.current_catalog_action_id() is
  'Id de acción de la auditoría para la transacción en curso; lo crea si no hay ninguno.';

revoke all on function private.current_catalog_action_id() from public;

-- Acción con sentido propio -------------------------------------------------------------------
--
-- private.log_catalog_action(action_name, details, target_table, target_row_id, load_actor)
--
-- Registra una acción (merge_species, validate_plant...) y la deja como acción en curso de la
-- transacción: los cambios de fila que se hagan después en la misma transacción llevan su
-- action_id. Devuelve ese id. Uso, dentro de una función de administrador:
--
--   begin
--     perform private.require_catalog_admin();
--     ...comprobaciones...
--     perform private.log_catalog_action(
--       'merge_species',
--       jsonb_build_object('source_id', source_id, 'target_id', target_id),
--       'species', target_id);
--     update public.plants ...;           -- (plants no se audita)
--     delete from public.species ...;     -- queda con el action_id de la fusión
--   end;
--
--   - Se llama antes de las escrituras: lo que se escribió antes en la transacción queda con
--     el id anterior.
--   - Otra llamada en la misma transacción empieza una acción nueva.
--   - Quién: el usuario del token. Sin token (una carga por script, #132), load_actor, el
--     identificador de la carga; si tampoco hay, error 22023. Sin token, los cambios de fila
--     siguen sin auditarse: la acción es el único registro.
--   - details no debe llevar datos personales: ids y datos del catálogo.
--
-- Vive en private y solo la ejecuta su dueño: la llaman funciones security definer (que corren
-- como postgres) y los scripts con conexión directa. Es security invoker por eso mismo.

create function private.log_catalog_action(
  action_name text,
  details jsonb default null,
  target_table text default null,
  target_row_id uuid default null,
  load_actor text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_action_id uuid;
  who text;
begin
  if action_name in ('insert', 'update', 'delete') then
    raise exception 'Los cambios de fila los registra el disparador: elige otro nombre para la acción.'
      using errcode = '22023';
  end if;
  who := coalesce(public.requesting_user_id(), nullif(pg_catalog.btrim(load_actor), ''));
  if who is null then
    raise exception 'Una acción sin token de usuario necesita el identificador de la carga.'
      using errcode = '22023';
  end if;

  new_action_id := pg_catalog.gen_random_uuid();
  perform pg_catalog.set_config('orki.catalog_action_id', new_action_id::text, true);

  insert into public.catalog_audit_log (action_id, actor, action, table_name, row_id, details)
  values (new_action_id, who, action_name, target_table, target_row_id, details);
  return new_action_id;
end;
$$;

comment on function private.log_catalog_action(text, jsonb, text, uuid, text) is
  'Registra una acción con sentido propio en la auditoría y agrupa bajo ella los cambios de fila que siguen en la transacción.';

revoke all on function private.log_catalog_action(text, jsonb, text, uuid, text) from public;

-- Disparador de cambios de fila ---------------------------------------------------------------
--
-- after insert or update or delete, por fila. Sin token de usuario no hace nada (ver arriba).
-- Es security definer porque inserta en la auditoría, que nadie de la API puede escribir: un
-- administrador que escribe directamente en una tabla del catálogo lo dispara como
-- authenticated. Las cuatro tablas tienen la clave "id" uuid.

create function private.audit_catalog_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  who text;
  old_row jsonb;
  new_row jsonb;
  old_changed jsonb;
  new_changed jsonb;
  target_id uuid;
begin
  who := public.requesting_user_id();
  if who is null then
    return null;
  end if;

  if tg_op = 'INSERT' then
    new_row := pg_catalog.to_jsonb(new);
    target_id := new_row ->> 'id';
  elsif tg_op = 'DELETE' then
    old_row := pg_catalog.to_jsonb(old);
    target_id := old_row ->> 'id';
  else
    old_row := pg_catalog.to_jsonb(old);
    new_row := pg_catalog.to_jsonb(new);
    target_id := new_row ->> 'id';
    -- Solo las columnas que cambian, sin updated_at. Si no cambia ninguna, no hay registro.
    select pg_catalog.jsonb_object_agg(n.key, o.value), pg_catalog.jsonb_object_agg(n.key, n.value)
      into old_changed, new_changed
      from pg_catalog.jsonb_each(new_row) n
      left join pg_catalog.jsonb_each(old_row) o on o.key = n.key
      where n.key <> 'updated_at'
        and n.value is distinct from o.value;
    if new_changed is null then
      return null;
    end if;
    old_row := old_changed;
    new_row := new_changed;
  end if;

  insert into public.catalog_audit_log (action_id, actor, action, table_name, row_id, old_values, new_values)
  values (
    private.current_catalog_action_id(),
    who,
    pg_catalog.lower(tg_op),
    tg_table_name,
    target_id,
    old_row,
    new_row
  );
  return null;
end;
$$;

comment on function private.audit_catalog_change() is
  'Disparador: registra en la auditoría un alta, una edición (solo las columnas que cambian) o una baja del catálogo hecha con token de usuario.';

revoke all on function private.audit_catalog_change() from public;

create trigger audit_change
  after insert or update or delete on public.genera
  for each row execute function private.audit_catalog_change();

create trigger audit_change
  after insert or update or delete on public.genus_abbreviations
  for each row execute function private.audit_catalog_change();

create trigger audit_change
  after insert or update or delete on public.species
  for each row execute function private.audit_catalog_change();

create trigger audit_change
  after insert or update or delete on public.species_names
  for each row execute function private.audit_catalog_change();
