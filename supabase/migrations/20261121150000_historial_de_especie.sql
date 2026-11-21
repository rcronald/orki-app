-- Historial de una especie en el backoffice (issue #133, parte de #23).
--
-- Esta migración:
--   1. Añade a public.catalog_audit_log la columna species_id: la especie a la que se refiere
--      cada registro. La rellena un disparador al insertar y se calcula para los registros que
--      ya hay.
--   2. Crea el índice (species_id, id) para leer el historial de una especie en orden.
--   3. Crea public.species_history(), una función de administrador que devuelve el historial
--      de una especie por páginas, del más reciente al más antiguo, agrupado por acción.
--
-- De qué especie es cada registro
-- -------------------------------
-- En los registros de species, la especie es la propia fila (row_id). En los de species_names
-- hay que saber de qué especie era el nombre, y los valores no siempre lo dicen: un alta y una
-- baja guardan la fila entera (con species_id), pero una edición guarda solo las columnas que
-- cambian, sin species_id salvo que cambie. Buscarlo al leer, en la tabla de nombres, falla con
-- un nombre que se editó y después se borró sin token (una carga por script no deja registro
-- de la baja, ver la migración 20261121140000): ya no está en la tabla y ningún registro
-- auditado lo une a su especie.
--
-- Por eso se guarda al escribir: el disparador fill_species_id (before insert en
-- catalog_audit_log, función private.set_audit_species_id()) pone en species_id:
--   - species: row_id.
--   - species_names: el species_id de los valores nuevos (alta, o una edición que lo cambia),
--     si no el de los anteriores (baja), y si no el de la fila de species_names, que en una
--     edición existe todavía (el disparador de auditoría es "after update").
--   - Una acción con sentido propio cuyo objetivo es una especie (target_table = 'species'):
--     su target_row_id. Así una fusión aparece en el historial de la especie que queda.
--   - Lo demás (géneros, abreviaturas, acciones sin especie): null.
-- Un nombre que pasa de una especie a otra (una fusión que mueve sinónimos) queda en el
-- historial de la especie de destino, con el cambio de species_id entre sus valores.
--
-- El disparador es security invoker: corre como quien inserta en la auditoría, que solo es
-- postgres (el disparador de auditoría y las funciones de administrador son security definer;
-- los scripts usan conexión directa). Solo lee una fila de species_names por su clave.
--
-- Agrupación por acción
-- ---------------------
-- Cada entrada del historial es un action_id: todo lo que hizo una llamada a la API (borrar la
-- especie con sus nombres) o una acción con sentido propio (una fusión, una validación de la
-- cola) es una sola entrada, con sus cambios de fila anidados. Los cambios de la misma acción
-- sobre otras especies o tablas no se devuelven, solo se cuentan (other_change_count): una
-- fusión vista desde la especie que queda muestra la fusión y sus propios cambios, y cuántos
-- cambios más hizo en el catálogo.
--
-- Paginación
-- ----------
-- Por clave: entry_id es el id más alto de la entrada entre los registros de la especie, y la
-- página siguiente pide las entradas con entry_id menor que el de la última (before_entry_id).
-- La auditoría es de solo anexar y una acción termina con su transacción, así que la clave de
-- una entrada no cambia y las páginas no saltan ni repiten entradas aunque lleguen registros
-- nuevos mientras tanto. page_size: 20 por defecto, 100 como máximo (nulo, cero o negativo,
-- 20). has_more dice si hay más entradas detrás de la página.
--
-- Por qué una función de administrador: la auditoría solo la leen los administradores (RLS),
-- pero la función reúne registros de varias acciones y necesita leer la acción completa (sus
-- cambios sobre otras filas, para contarlos). Sigue el patrón de "Funciones de administrador"
-- en supabase/README.md: security definer, search_path vacío, el guardián como primera
-- sentencia y solo authenticated.

-- Columna e índice --------------------------------------------------------------------------

alter table public.catalog_audit_log add column species_id uuid;

comment on column public.catalog_audit_log.species_id is
  'Especie a la que se refiere el registro: la fila de species, la especie de un nombre o el objetivo de una acción. La rellena el disparador fill_species_id.';

-- Historial de una especie (species_history), en orden de llegada.
create index catalog_audit_log_species_idx on public.catalog_audit_log (species_id, id);

-- Disparador --------------------------------------------------------------------------------

create function private.set_audit_species_id()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.table_name = 'species' then
    new.species_id := new.row_id;
  elsif new.table_name = 'species_names' and new.action in ('insert', 'update', 'delete') then
    new.species_id := coalesce(
      (new.new_values ->> 'species_id')::uuid,
      (new.old_values ->> 'species_id')::uuid,
      (select n.species_id from public.species_names n where n.id = new.row_id)
    );
  else
    new.species_id := null;
  end if;
  return new;
end;
$$;

comment on function private.set_audit_species_id() is
  'Disparador: pone en species_id la especie a la que se refiere un registro de la auditoría.';

revoke all on function private.set_audit_species_id() from public;

create trigger fill_species_id
  before insert on public.catalog_audit_log
  for each row execute function private.set_audit_species_id();

-- Registros que ya había (los que dejó la migración anterior en este ambiente). Un nombre
-- editado que ya no está en la tabla se busca en los demás registros de esa fila (su alta o
-- su baja).
update public.catalog_audit_log a
set species_id = a.row_id
where a.table_name = 'species';

update public.catalog_audit_log a
set species_id = coalesce(
  (a.new_values ->> 'species_id')::uuid,
  (a.old_values ->> 'species_id')::uuid,
  (select n.species_id from public.species_names n where n.id = a.row_id),
  (select coalesce((b.new_values ->> 'species_id')::uuid, (b.old_values ->> 'species_id')::uuid)
     from public.catalog_audit_log b
     where b.table_name = 'species_names'
       and b.row_id = a.row_id
       and b.id > a.id
       and coalesce(b.new_values, b.old_values) ? 'species_id'
     order by b.id
     limit 1),
  (select coalesce((b.new_values ->> 'species_id')::uuid, (b.old_values ->> 'species_id')::uuid)
     from public.catalog_audit_log b
     where b.table_name = 'species_names'
       and b.row_id = a.row_id
       and b.id < a.id
       and coalesce(b.new_values, b.old_values) ? 'species_id'
     order by b.id desc
     limit 1)
)
where a.table_name = 'species_names' and a.action in ('insert', 'update', 'delete');

-- Historial ---------------------------------------------------------------------------------
--
-- public.species_history(target_species_id, page_size = 20, before_entry_id = null)
--
-- Una fila por entrada (action_id), de la más reciente a la más antigua:
--   entry_id            Clave de la entrada para pedir la página siguiente.
--   action_id           Id de la acción.
--   actor               Id de usuario de Clerk o identificador de la carga.
--   action              Nombre de la acción con sentido propio (merge_species...), o null si
--                       la entrada son solo cambios de fila.
--   details             Datos de esa acción, o null.
--   created_at          Cuándo.
--   changes             Los cambios de fila de la especie y de sus nombres, en orden: un
--                       array de objetos con table_name, row_id, action (insert, update o
--                       delete), old_values y new_values. Vacío si la acción no cambió filas
--                       de la especie.
--   other_change_count  Cambios de fila de la misma acción sobre otras filas del catálogo.
--   genus_names         Nombre actual de cada género que aparece en los cambios (genus_id),
--                       como objeto {id: nombre}; un género borrado no está.
--   has_more            Si hay más entradas después de esta página (igual en todas las filas).
-- Una especie sin registros (o que no existe) no devuelve ninguna fila.
--
-- Rendimiento: lee los registros de la especie con catalog_audit_log_species_idx (agrupa
-- todos para ordenar las entradas; el historial de una especie es corto) y, por cada entrada
-- de la página, los de su acción con catalog_audit_log_action_id_idx.

create function public.species_history(
  target_species_id uuid,
  page_size integer default 20,
  before_entry_id bigint default null
)
returns table (
  entry_id bigint,
  action_id uuid,
  actor text,
  action text,
  details jsonb,
  created_at timestamptz,
  changes jsonb,
  other_change_count integer,
  genus_names jsonb,
  has_more boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select private.require_catalog_admin();

  with entries as (
    select a.action_id, pg_catalog.max(a.id) as entry_id
    from public.catalog_audit_log a
    where a.species_id = target_species_id
    group by a.action_id
    having before_entry_id is null or pg_catalog.max(a.id) < before_entry_id
    order by pg_catalog.max(a.id) desc
    limit (case when page_size is null or page_size < 1 then 20 else least(page_size, 100) end) + 1
  ),
  page as (
    select e.action_id, e.entry_id,
           pg_catalog.count(*) over () > (case when page_size is null or page_size < 1 then 20 else least(page_size, 100) end) as more
    from entries e
    order by e.entry_id desc
    limit (case when page_size is null or page_size < 1 then 20 else least(page_size, 100) end)
  )
  select
    p.entry_id,
    p.action_id,
    coalesce(act.actor, own.actor),
    act.action,
    act.details,
    coalesce(act.created_at, own.created_at),
    coalesce(own.changes, '[]'::jsonb),
    others.total,
    genus.names,
    p.more
  from page p
  -- La acción con sentido propio, si la hay (la primera de la acción: se registra antes de
  -- sus cambios).
  left join lateral (
    select a.actor, a.action, a.details, a.created_at
    from public.catalog_audit_log a
    where a.action_id = p.action_id
      and a.action not in ('insert', 'update', 'delete')
    order by a.id
    limit 1
  ) act on true
  -- Los cambios de fila de la especie y de sus nombres.
  cross join lateral (
    select
      (pg_catalog.array_agg(a.actor order by a.id))[1] as actor,
      pg_catalog.min(a.created_at) as created_at,
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'table_name', a.table_name,
          'row_id', a.row_id,
          'action', a.action,
          'old_values', a.old_values,
          'new_values', a.new_values
        )
        order by a.id
      ) as changes
    from public.catalog_audit_log a
    where a.action_id = p.action_id
      and a.species_id = target_species_id
      and a.action in ('insert', 'update', 'delete')
  ) own
  -- Cuántos cambios de fila hizo la misma acción en el resto del catálogo.
  cross join lateral (
    select pg_catalog.count(*)::integer as total
    from public.catalog_audit_log a
    where a.action_id = p.action_id
      and a.species_id is distinct from target_species_id
      and a.action in ('insert', 'update', 'delete')
  ) others
  -- Los nombres de los géneros que aparecen en los cambios de la especie.
  cross join lateral (
    select coalesce(pg_catalog.jsonb_object_agg(g.id, g.name), '{}'::jsonb) as names
    from public.genera g
    where g.id in (
      select (v.value ->> 'genus_id')::uuid
      from pg_catalog.jsonb_array_elements(own.changes) c (value)
      cross join lateral (values (c.value -> 'old_values'), (c.value -> 'new_values')) v (value)
      where c.value ->> 'table_name' = 'species'
        and pg_catalog.jsonb_typeof(v.value) = 'object'
        and v.value ? 'genus_id'
    )
  ) genus
  order by p.entry_id desc;
$$;

comment on function public.species_history(uuid, integer, bigint) is
  'Historial de una especie (sus cambios, los de sus nombres y las acciones que la tienen como objetivo), agrupado por acción y paginado, del más reciente al más antiguo. Solo administradores del catálogo.';

revoke all on function public.species_history(uuid, integer, bigint) from public, anon, authenticated, service_role;
grant execute on function public.species_history(uuid, integer, bigint) to authenticated;
