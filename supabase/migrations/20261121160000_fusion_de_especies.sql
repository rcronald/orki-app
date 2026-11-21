-- Fusión de especies: función y memoria de claves absorbidas (issue #135, parte de #21).
--
-- Esta migración:
--   1. Crea la tabla public.species_merge_keys, la memoria de las fusiones: a qué especie fue a
--      parar cada clave de fuente (source, source_ref) de una especie absorbida. La importación
--      (#137) la leerá para no volver a crear lo que un administrador fusionó.
--   2. Crea private.species_merge_plan(), que calcula qué nombres pasan de la especie absorbida
--      a la conservada y cuáles se descartan porque ya existen.
--   3. Crea dos funciones de administrador:
--        public.preview_species_merge()  Vista previa, solo lectura.
--        public.merge_species()          La fusión, en una transacción.
--
-- Vocabulario: la especie "absorbida" (merged) desaparece; la "conservada" (kept) se queda con
-- sus plantas, sus nombres y su clave de fuente.
--
-- Qué hace la fusión
-- ------------------
-- En una sola transacción (la de la llamada a la API; si algo falla, no queda nada a medias):
--   1. Comprueba el rol (el guardián, primera sentencia), que las dos especies son distintas y
--      que existen.
--   2. Bloquea las dos especies "for update", siempre en orden de id (ver "Concurrencia").
--   3. Registra la acción merge_species en la auditoría (private.log_catalog_action), antes de
--      escribir nada: todos los cambios de fila que siguen quedan bajo esa acción, que el
--      historial (species_history) muestra como una sola entrada en la conservada (su objetivo)
--      y en la absorbida (su baja).
--   4. Mueve las plantas de todos los usuarios a la conservada. La función es security definer y
--      corre como postgres, dueño de plants, así que no la frena RLS. El disparador
--      sync_with_species les pone el género y el tipo de la conservada; el nombre que ingresó el
--      usuario (entered_name) no se toca.
--   5. Pasa los sinónimos y nombres comunes de la absorbida a la conservada (se mueve la fila:
--      conserva su id, su tipo y su idioma) y añade el nombre científico de la absorbida como
--      sinónimo, sin duplicar nada (ver "Nombres").
--   6. Deja la conservada como "validated" si era "imported", para que la importación de COL,
--      que solo actualiza las especies que siguen importadas, no pise el resultado.
--   7. Guarda la memoria (ver "Memoria de las fusiones").
--   8. Borra la absorbida; sus nombres que no pasaron (los repetidos) se van con ella en cascada.
--
-- Nombres
-- -------
-- Los nombres se comparan con public.normalize_search_text(), como las funciones de edición
-- del backoffice: sin mayúsculas, tildes ni signo de híbrido. Un nombre de la absorbida no pasa
-- si la conservada ya tiene uno igual tras normalizar, sea su nombre científico, un sinónimo o
-- un nombre común (el índice único species_names_species_id_name_key no distingue el tipo). Si
-- dos nombres de la absorbida se normalizan igual (los puede traer la fuente), pasa uno solo:
-- primero el nombre científico, después los sinónimos, después los comunes y, a igualdad, el
-- primero en orden alfabético. Así la conservada nunca queda con dos nombres que la búsqueda
-- confundiría, y nunca choca con el índice único.
--
-- Especies de géneros o tipos distintos
-- -------------------------------------
-- Se permite fusionarlas (propuesta del #21, por confirmar): las plantas toman el género y el
-- tipo de la conservada, y la vista previa lo señala (genus_differs, type_differs) para que la
-- pantalla lo avise antes de confirmar.
--
-- Memoria de las fusiones (public.species_merge_keys)
-- ---------------------------------------------------
-- Una fila por clave de fuente absorbida: (source, source_ref) → species_id, la especie que la
-- conserva hoy. Solo se guardan las especies absorbidas con source_ref (las importadas de COL,
-- las de la lista curada de híbridos); una especie sin referencia (dada de alta a mano) no
-- tiene nada que la importación pueda volver a crear.
--   - Cadena: si la conservada se fusiona después en otra, las claves que heredó pasan a
--     apuntar a la nueva (A en B y después B en C deja las claves de A y de B en C). Por eso
--     nunca hay que seguir una cadena al leerla: species_id es siempre una especie que existe.
--   - Si la misma clave ya estaba en la memoria (la importación volvió a crear la especie antes
--     de #137 y se vuelve a fusionar), se sobrescribe con la fusión nueva.
--   - Si se borra la conservada (delete_catalog_species, solo posible sin plantas), su memoria
--     se borra con ella (on delete cascade): las claves vuelven a estar "libres" y la siguiente
--     importación crearía de nuevo esas especies, igual que crearía de nuevo la propia conservada
--     si viene de la fuente. Se descartó "on delete restrict" porque obligaría a cambiar la baja
--     de especies y su motivo de error, y "set null" porque dejaría claves que no llevan a
--     ninguna parte sin que la importación sepa qué hacer con ellas. La baja queda en la
--     auditoría con la fusión anterior, así que se puede reconstruir qué pasó.
--   - merged_by y merged_at son de la fusión que absorbió la clave; si después la clave pasa a
--     otra especie por una cadena, no cambian (la fusión nueva queda en la auditoría, con
--     inherited_keys en sus detalles). action_id une la fila con la acción de la auditoría.
--
-- Cómo la consulta la importación (conexión directa como postgres, que no está sujeto a RLS):
--
--   -- ¿Esta clave de COL ya se fusionó en otra especie? Si devuelve una fila, la importación no
--   -- debe crear la especie: la clave vive en species_id.
--   select k.species_id
--     from public.species_merge_keys k
--     where k.source = 'col' and k.source_ref = $1;
--
--   -- Todas de una vez, para una carga por conjuntos:
--   select k.source_ref, k.species_id
--     from public.species_merge_keys k
--     where k.source = 'col';
--
-- La clave primaria (source, source_ref) resuelve las dos consultas.
--
-- Permisos de la memoria: RLS activada; authenticated solo tiene select y la política exige
-- (select public.is_catalog_admin()); anon nada; service_role solo lee, como la auditoría.
-- Nadie la escribe por la API: solo merge_species(), que corre como postgres.
--
-- Concurrencia
-- ------------
-- La fusión bloquea las dos especies "for update" en orden de id: dos fusiones que comparten
-- una especie (A en B y B en C a la vez) esperan una a la otra sin interbloquearse, y la
-- segunda ve que su especie ya no existe (species_not_found). Mientras tanto nadie puede
-- enlazar una planta a ninguna de las dos (el disparador sync_with_species bloquea la especie
-- "for share"), ni añadir, editar o borrar sus nombres desde el backoffice (esas funciones
-- bloquean la especie "for update"). Las plantas que se mueven se bloquean al contarlas, así
-- que el número de la auditoría es exactamente el de las que se mueven.
--
-- Errores (con private.raise_catalog_error, como el resto del backoffice):
--   22023 same_species        Las dos especies son la misma.
--   P0002 species_not_found   Una de las dos no existe (o es null): species_id y
--                             species_role ("merged" o "kept").
--   42501                     Sin el rol de administrador (el guardián).

-- Memoria de las fusiones -------------------------------------------------------------------

create table public.species_merge_keys (
  -- Clave de fuente de la especie absorbida, como estaba en species (source, source_ref).
  source public.species_source not null,
  source_ref text not null,
  -- Especie que conserva hoy la clave. Si se borra, la memoria se va con ella (ver arriba).
  species_id uuid not null references public.species (id) on delete cascade,
  -- Id y nombre científico que tenía la especie absorbida, para leer la memoria sin la
  -- auditoría (la especie ya no existe).
  merged_species_id uuid not null,
  merged_scientific_name text not null,
  -- Quién y cuándo se absorbió la clave (id de usuario de Clerk; hora de la transacción).
  merged_by text not null,
  merged_at timestamptz not null default now(),
  -- La acción merge_species de la auditoría que la absorbió.
  action_id uuid not null,
  primary key (source, source_ref),
  constraint species_merge_keys_source_ref_not_blank check (btrim(source_ref) <> ''),
  constraint species_merge_keys_merged_by_not_blank check (btrim(merged_by) <> '')
);

comment on table public.species_merge_keys is
  'Memoria de las fusiones: a qué especie fue a parar cada clave de fuente de una especie absorbida. Solo la leen los administradores; la escribe merge_species().';

-- Claves de una especie: la cadena de fusiones y la clave foránea al borrarla.
create index species_merge_keys_species_id_idx on public.species_merge_keys (species_id);

alter table public.species_merge_keys enable row level security;

revoke all on table public.species_merge_keys from public, anon, authenticated, service_role;
grant select on table public.species_merge_keys to authenticated, service_role;

create policy species_merge_keys_select_catalog_admin on public.species_merge_keys
  for select to authenticated
  using ((select public.is_catalog_admin()));

-- Plan de nombres ---------------------------------------------------------------------------
--
-- private.species_merge_plan(merged_species_id, kept_species_id)
--
-- Una fila por nombre de la absorbida (su nombre científico y cada sinónimo o nombre común):
--   name_id         Id de la fila de species_names, o null para el nombre científico.
--   name            El nombre.
--   name_type       El tipo que tendrá en la conservada (el científico pasa como sinónimo).
--   language        Su idioma (solo en los nombres comunes).
--   origin          De dónde viene: scientific_name, synonym o common.
--   moves           Si pasa a la conservada.
--   skip_reason     Si no pasa: already_in_kept (la conservada ya tiene uno igual tras
--                   normalizar) o repeated_in_merged (pasa otro de la absorbida igual).
--   existing_name   El nombre igual que ya existe (en la conservada o el que pasa).
--   existing_type   Su tipo: scientific_name, synonym o common.
--   sort_order      Orden: el nombre científico, los sinónimos y los comunes, cada grupo
--                   alfabético.
--
-- La usan preview_species_merge() y merge_species(), que corren como postgres. Lee las tablas
-- con los permisos de quien la llama (security invoker) y solo la ejecuta su dueño.

create function private.species_merge_plan(merged_species_id uuid, kept_species_id uuid)
returns table (
  name_id uuid,
  name text,
  name_type public.species_name_type,
  language text,
  origin text,
  moves boolean,
  skip_reason text,
  existing_name text,
  existing_type text,
  sort_order bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with kept_names as (
    select public.normalize_search_text(s.scientific_name) as name_key,
           s.scientific_name as name,
           'scientific_name'::text as origin,
           0 as rank
      from public.species s
      where s.id = kept_species_id
    union all
    select public.normalize_search_text(n.name), n.name, n.type::text,
           case n.type when 'synonym' then 1 else 2 end
      from public.species_names n
      where n.species_id = kept_species_id
  ),
  candidates as (
    select null::uuid as name_id,
           s.scientific_name as name,
           'synonym'::public.species_name_type as name_type,
           null::text as language,
           'scientific_name'::text as origin,
           0 as rank,
           public.normalize_search_text(s.scientific_name) as name_key
      from public.species s
      where s.id = merged_species_id
    union all
    select n.id, n.name, n.type, n.language, n.type::text,
           case n.type when 'synonym' then 1 else 2 end,
           public.normalize_search_text(n.name)
      from public.species_names n
      where n.species_id = merged_species_id
  ),
  ranked as (
    select c.*,
           pg_catalog.row_number() over w as position,
           pg_catalog.first_value(c.name) over w as first_name,
           pg_catalog.first_value(c.origin) over w as first_origin
      from candidates c
      window w as (partition by c.name_key order by c.rank, c.name collate "C", c.name_id)
  )
  select r.name_id,
         r.name,
         r.name_type,
         r.language,
         r.origin,
         k.name is null and r.position = 1,
         case
           when k.name is not null then 'already_in_kept'
           when r.position > 1 then 'repeated_in_merged'
         end,
         coalesce(k.name, case when r.position > 1 then r.first_name end),
         coalesce(k.origin, case when r.position > 1 then r.first_origin end),
         pg_catalog.row_number() over (order by r.rank, r.name collate "C", r.name_id)
    from ranked r
    left join lateral (
      select kn.name, kn.origin
        from kept_names kn
        where kn.name_key = r.name_key
        order by kn.rank, kn.name collate "C"
        limit 1
    ) k on true
    order by r.rank, r.name collate "C", r.name_id;
$$;

comment on function private.species_merge_plan(uuid, uuid) is
  'Fusión: qué nombres de la especie absorbida pasan a la conservada y cuáles no (ya existen tras normalizar).';

revoke all on function private.species_merge_plan(uuid, uuid) from public;

-- Vista previa ------------------------------------------------------------------------------
--
-- public.preview_species_merge(merged_species_id, kept_species_id)
--
-- Solo lectura. Una fila con:
--   merged_scientific_name, merged_genus_id, merged_genus_name, merged_type, merged_status,
--   merged_source, merged_source_ref                  La absorbida.
--   kept_scientific_name, kept_genus_id, kept_genus_name, kept_type, kept_status
--                                                     La conservada.
--   plant_count           Plantas de usuarios (de cualquier dueño y estado) que se mueven.
--   moved_names           Array de {name, type, language, origin} con los nombres que pasan;
--                         type es el que tendrán en la conservada (el científico, synonym).
--   existing_names        Array de {name, type, language, origin, reason, existing_name,
--                         existing_type} con los que no pasan porque ya existen (reason:
--                         already_in_kept o repeated_in_merged).
--   genus_differs         Si el género de las dos es distinto (las plantas tomarán el de la
--                         conservada).
--   type_differs          Igual con el tipo (especie o híbrido).
--   kept_becomes_validated  Si la conservada pasará de imported a validated.
--   remembered_keys       Array de {source, source_ref, inherited} con las claves que la memoria
--                         asignará a la conservada: la de la absorbida (inherited = false) y las
--                         que la absorbida heredó de fusiones anteriores (inherited = true).
-- Con los mismos rechazos que la fusión. No bloquea nada: lo que muestre puede cambiar antes de
-- confirmar, y la fusión vuelve a calcularlo todo.

create function public.preview_species_merge(merged_species_id uuid, kept_species_id uuid)
returns table (
  merged_scientific_name text,
  merged_genus_id uuid,
  merged_genus_name text,
  merged_type public.species_type,
  merged_status public.species_status,
  merged_source public.species_source,
  merged_source_ref text,
  kept_scientific_name text,
  kept_genus_id uuid,
  kept_genus_name text,
  kept_type public.species_type,
  kept_status public.species_status,
  plant_count bigint,
  moved_names jsonb,
  existing_names jsonb,
  genus_differs boolean,
  type_differs boolean,
  kept_becomes_validated boolean,
  remembered_keys jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  merged_id uuid;
  kept_id uuid;
  merged public.species;
  kept public.species;
begin
  perform private.require_catalog_admin();

  merged_id := preview_species_merge.merged_species_id;
  kept_id := preview_species_merge.kept_species_id;
  if merged_id = kept_id then
    perform private.raise_catalog_error('22023', 'same_species',
      'Elige dos especies distintas: una especie no se puede fusionar consigo misma.');
  end if;
  select s.* into merged from public.species s where s.id = merged_id;
  if not found then
    perform private.raise_catalog_error('P0002', 'species_not_found',
      'La especie que se absorbe ya no está en el catálogo.',
      pg_catalog.jsonb_build_object('species_id', merged_id, 'species_role', 'merged'));
  end if;
  select s.* into kept from public.species s where s.id = kept_id;
  if not found then
    perform private.raise_catalog_error('P0002', 'species_not_found',
      'La especie que se conserva ya no está en el catálogo.',
      pg_catalog.jsonb_build_object('species_id', kept_id, 'species_role', 'kept'));
  end if;

  return query
  select
    merged.scientific_name,
    merged.genus_id,
    (select g.name from public.genera g where g.id = merged.genus_id),
    merged.type,
    merged.status,
    merged.source,
    merged.source_ref,
    kept.scientific_name,
    kept.genus_id,
    (select g.name from public.genera g where g.id = kept.genus_id),
    kept.type,
    kept.status,
    (select pg_catalog.count(*) from public.plants p where p.species_id = merged.id),
    (select coalesce(pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'name', o.name, 'type', o.name_type, 'language', o.language, 'origin', o.origin)
              order by o.sort_order), '[]'::jsonb)
       from private.species_merge_plan(merged.id, kept.id) o
       where o.moves),
    (select coalesce(pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'name', o.name, 'type', o.name_type, 'language', o.language, 'origin', o.origin,
                'reason', o.skip_reason, 'existing_name', o.existing_name,
                'existing_type', o.existing_type)
              order by o.sort_order), '[]'::jsonb)
       from private.species_merge_plan(merged.id, kept.id) o
       where not o.moves),
    merged.genus_id <> kept.genus_id,
    merged.type <> kept.type,
    kept.status = 'imported',
    (select coalesce(pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object('source', r.source, 'source_ref', r.source_ref, 'inherited', r.inherited)
              order by r.inherited, r.source, r.source_ref collate "C"), '[]'::jsonb)
       from (
         select merged.source, merged.source_ref, false as inherited
           where merged.source_ref is not null
         union all
         select k.source, k.source_ref, true
           from public.species_merge_keys k
           where k.species_id = merged.id
       ) r);
end;
$$;

comment on function public.preview_species_merge(uuid, uuid) is
  'Backoffice: vista previa de la fusión de dos especies (plantas, nombres, diferencias y claves), sin cambiar nada. Función de administrador.';

revoke all on function public.preview_species_merge(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_species_merge(uuid, uuid) to authenticated;

-- Fusión ------------------------------------------------------------------------------------
--
-- public.merge_species(merged_species_id, kept_species_id)
--
-- Fusiona la especie merged_species_id en kept_species_id (ver "Qué hace la fusión"). Devuelve
-- una fila con:
--   action_id           La acción merge_species de la auditoría.
--   plant_count         Plantas que se movieron.
--   moved_name_count    Nombres que pasaron (incluido el científico, si pasó).
--   skipped_name_count  Nombres que no pasaron porque ya existían.
--   kept_validated      Si la conservada pasó de imported a validated.
--   remembered_keys     Array de {source, source_ref, inherited} con las claves que la memoria
--                       asigna ahora a la conservada por esta fusión.
--
-- La acción de la auditoría lleva en details: merged_species_id, merged_scientific_name,
-- merged_source, merged_source_ref, kept_species_id, kept_scientific_name, plant_count,
-- moved_names y skipped_names (arrays de nombres), kept_validated y remembered_keys (como el
-- resultado). Sin datos personales: ids y datos del catálogo.

create function public.merge_species(merged_species_id uuid, kept_species_id uuid)
returns table (
  action_id uuid,
  plant_count bigint,
  moved_name_count integer,
  skipped_name_count integer,
  kept_validated boolean,
  remembered_keys jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  merged_id uuid;
  kept_id uuid;
  merged public.species;
  kept public.species;
  plan jsonb;
  keys jsonb;
  moving_plants bigint;
  new_action_id uuid;
  who text;
begin
  perform private.require_catalog_admin();

  merged_id := merge_species.merged_species_id;
  kept_id := merge_species.kept_species_id;
  if merged_id = kept_id then
    perform private.raise_catalog_error('22023', 'same_species',
      'Elige dos especies distintas: una especie no se puede fusionar consigo misma.');
  end if;

  -- Las dos a la vez y en orden de id: dos fusiones que comparten una especie no se
  -- interbloquean (ver "Concurrencia").
  perform from public.species s
    where s.id in (merged_id, kept_id)
    order by s.id
    for update;

  select s.* into merged from public.species s where s.id = merged_id;
  if not found then
    perform private.raise_catalog_error('P0002', 'species_not_found',
      'La especie que se absorbe ya no está en el catálogo.',
      pg_catalog.jsonb_build_object('species_id', merged_id, 'species_role', 'merged'));
  end if;
  select s.* into kept from public.species s where s.id = kept_id;
  if not found then
    perform private.raise_catalog_error('P0002', 'species_not_found',
      'La especie que se conserva ya no está en el catálogo.',
      pg_catalog.jsonb_build_object('species_id', kept_id, 'species_role', 'kept'));
  end if;

  -- Lo que se va a hacer, calculado antes de escribir nada.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p)), '[]'::jsonb) into plan
    from private.species_merge_plan(merged_id, kept_id) p;

  select coalesce(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object('source', r.source, 'source_ref', r.source_ref, 'inherited', r.inherited)
           order by r.inherited, r.source, r.source_ref collate "C"), '[]'::jsonb)
    into keys
    from (
      select merged.source, merged.source_ref, false as inherited
        where merged.source_ref is not null
      union all
      select k.source, k.source_ref, true
        from public.species_merge_keys k
        where k.species_id = merged_id
    ) r;

  -- Las plantas que se mueven, bloqueadas: nadie las desenlaza entre la cuenta y el cambio, y
  -- nadie puede enlazar otra a la absorbida mientras está bloqueada.
  select pg_catalog.count(*) into moving_plants
    from (select from public.plants p where p.species_id = merged_id for update) locked;

  -- 1. La acción, antes de escribir: lo que sigue queda bajo ella.
  new_action_id := private.log_catalog_action(
    'merge_species',
    pg_catalog.jsonb_build_object(
      'merged_species_id', merged.id,
      'merged_scientific_name', merged.scientific_name,
      'merged_source', merged.source,
      'merged_source_ref', merged.source_ref,
      'kept_species_id', kept.id,
      'kept_scientific_name', kept.scientific_name,
      'plant_count', moving_plants,
      'moved_names', (select coalesce(pg_catalog.jsonb_agg(e -> 'name'), '[]'::jsonb)
                        from pg_catalog.jsonb_array_elements(plan) e
                        where (e ->> 'moves')::boolean),
      'skipped_names', (select coalesce(pg_catalog.jsonb_agg(e -> 'name'), '[]'::jsonb)
                          from pg_catalog.jsonb_array_elements(plan) e
                          where not (e ->> 'moves')::boolean),
      'kept_validated', kept.status = 'imported',
      'remembered_keys', keys
    ),
    'species',
    kept.id
  );
  who := public.requesting_user_id();

  -- 2. Las plantas de todos los usuarios. sync_with_species les pone el género y el tipo de la
  --    conservada; entered_name no cambia.
  update public.plants p
    set species_id = kept_id
    where p.species_id = merged_id;

  -- 3. Los nombres que pasan: se mueve la fila (conserva id, tipo e idioma)...
  update public.species_names n
    set species_id = kept_id
    where n.species_id = merged_id
      and n.id in (
        select (e ->> 'name_id')::uuid
          from pg_catalog.jsonb_array_elements(plan) e
          where (e ->> 'moves')::boolean and e ->> 'name_id' is not null
      );

  -- ...y el nombre científico de la absorbida, como sinónimo, si no existía.
  insert into public.species_names (species_id, name, type, language)
  select kept_id, e ->> 'name', 'synonym', null
    from pg_catalog.jsonb_array_elements(plan) e
    where (e ->> 'moves')::boolean and e ->> 'origin' = 'scientific_name';

  -- 4. La conservada queda validada si era importada.
  update public.species s
    set status = 'validated'
    where s.id = kept_id and s.status = 'imported';

  -- 5. Memoria: las claves heredadas pasan a la conservada (antes de borrar la absorbida, que
  --    se las llevaría en cascada) y se guarda la clave propia de la absorbida.
  update public.species_merge_keys k
    set species_id = kept_id
    where k.species_id = merged_id;

  if merged.source_ref is not null then
    insert into public.species_merge_keys
      (source, source_ref, species_id, merged_species_id, merged_scientific_name, merged_by, action_id)
    values
      (merged.source, merged.source_ref, kept_id, merged.id, merged.scientific_name, who, new_action_id)
    on conflict (source, source_ref) do update
      set species_id = excluded.species_id,
          merged_species_id = excluded.merged_species_id,
          merged_scientific_name = excluded.merged_scientific_name,
          merged_by = excluded.merged_by,
          merged_at = excluded.merged_at,
          action_id = excluded.action_id;
  end if;

  -- 6. La absorbida, con los nombres que no pasaron.
  delete from public.species s where s.id = merged_id;

  return query
  select
    new_action_id,
    moving_plants,
    (select pg_catalog.count(*)::integer from pg_catalog.jsonb_array_elements(plan) e
       where (e ->> 'moves')::boolean),
    (select pg_catalog.count(*)::integer from pg_catalog.jsonb_array_elements(plan) e
       where not (e ->> 'moves')::boolean),
    kept.status = 'imported',
    keys;
end;
$$;

comment on function public.merge_species(uuid, uuid) is
  'Backoffice: fusiona una especie en otra (plantas, nombres, memoria de su clave) y borra la absorbida, en una transacción. Función de administrador.';

revoke all on function public.merge_species(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.merge_species(uuid, uuid) to authenticated;
