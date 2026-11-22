-- Cola de propuestas del backoffice: funciones de administrador (issue #139, parte de #22).
--
-- La cola no es una tabla: son las plantas con validation = 'pending' ("nombre por validar").
-- Los administradores no leen plants (RLS), así que lo que ven de una propuesta se expone con
-- funciones de administrador que devuelven solo lo necesario.
--
-- Esta migración:
--   1. Crea el índice plants_pending_group_idx, para encontrar las plantas de un grupo.
--   2. Crea cinco funciones de administrador:
--        public.list_proposal_groups()            Los grupos por validar, paginados.
--        public.count_proposal_groups()           Cuántos grupos hay (para la pestaña).
--        public.link_proposal_group()             Enlaza un grupo a una especie existente.
--        public.create_species_from_proposal()    Crea la especie y enlaza el grupo.
--        public.mark_proposal_unidentifiable()    Marca un grupo como no identificable.
--
-- Grupos
-- ------
-- Un grupo es el conjunto de plantas por validar con el mismo nombre normalizado y el mismo
-- género: (public.normalize_search_text(entered_name), genus_id). La normalización es la de la
-- búsqueda: sin tildes, mayúsculas, espacios sobrantes ni signo de híbrido. La clave del grupo
-- que reciben las funciones de resolución es esa pareja (name_key, genus_id), tal como la
-- devuelve list_proposal_groups(); name_key se vuelve a normalizar al recibirlo, así que también
-- vale el nombre tal como se escribió. Las plantas de cualquier estado (activa, perdida, regalada)
-- y de cualquier dueño cuentan.
--
-- Qué se devuelve (y qué no)
-- --------------------------
-- De un grupo: la clave, el nombre propuesto (la forma más frecuente tal como se escribió, con
-- los espacios sobrantes quitados), el género, el tipo (el más frecuente), el número de plantas
-- y hasta cuatro fotos. Nunca el usuario, el origen, la ubicación, el apodo, las fechas ni el
-- id de las plantas. Las fotos van como sus rutas en el bucket (photo_path y thumbnail_path),
-- porque la app necesita la ruta para pedir la URL firmada a Storage; las rutas contienen el id
-- del usuario, así que la interfaz no las muestra ni las registra. Ninguna función registra en
-- la auditoría el id de los usuarios ni las rutas.
--
-- Acceso a las fotos
-- ------------------
-- No cambia nada en Storage: la política plant_photos_select_own_or_pending_for_admin
-- (migración 20261121090000) ya deja al administrador leer la foto y la miniatura actuales de
-- las plantas por validar, y solo esas, con public.is_pending_plant_photo(). Al resolverse el
-- grupo, sus plantas dejan de estar "pending" y el administrador deja de poder leerlas.
--
-- Resolver un grupo
-- -----------------
--   - Enlazar (link_proposal_group): species_id de todas las plantas del grupo pasa a la
--     especie elegida. El disparador sync_with_species las marca "validated" y les pone el
--     género y el tipo de la especie; entered_name no cambia.
--   - Crear la especie (create_species_from_proposal): da de alta la especie con fuente
--     "user_proposal", sin source_ref y estado "validated" (decisión del #22: la crea un
--     administrador), con las mismas comprobaciones que create_catalog_species() (nombre,
--     tipo, género, nombre libre), y enlaza el grupo, en la misma transacción.
--   - No identificable (mark_proposal_unidentifiable): validation pasa a "unidentifiable". La
--     planta sale de la cola y sigue en el inventario de su dueño, sin especie.
-- No se avisa al usuario (decisión del #22): ve el cambio cuando su inventario se actualiza.
--
-- Concurrencia (dos administradores a la vez)
-- -------------------------------------------
-- Cada resolución bloquea "for update" (en orden de id, para que dos resoluciones del mismo
-- grupo no se interbloqueen) las plantas pendientes del grupo antes de cambiarlas, y
-- cambia solo esas (where validation = 'pending'). Si otro administrador resolvió el grupo a la
-- vez, la segunda resolución espera a la primera, vuelve a comprobar la condición (en "read
-- committed" Postgres relee las filas bloqueadas) y no encuentra ninguna: devuelve
-- plant_count = 0, sin error, sin tocar las plantas ya resueltas y sin registrar nada en la
-- auditoría. create_species_from_proposal() tampoco crea la especie en ese caso (devuelve
-- species_id nulo): una especie sin plantas que nadie pidió no debe quedar en el catálogo. La
-- pantalla usa plant_count = 0 para decir que otro administrador ya lo resolvió.
--
-- Auditoría (#23)
-- ---------------
-- Cada resolución con plantas registra una acción con private.log_catalog_action():
--   link_proposal_group            target species (aparece en el historial de la especie).
--   create_species_from_proposal   target species; el alta de la especie queda bajo la acción.
--   mark_proposal_unidentifiable   sin target.
-- details: name_key, proposed_name, genus_id, genus_name, plant_count y, al enlazar o crear,
-- species_id y scientific_name. Sin ids de usuario ni rutas de fotos. Las plantas no se
-- auditan fila a fila (como en la fusión). La auditoría no se borra (decisión del #22).
--
-- Errores (con private.raise_catalog_error, como el resto del backoffice):
--   22023 group_required     Falta la clave del grupo (name_key vacío o genus_id nulo).
--   P0002 species_not_found  La especie elegida para enlazar ya no existe.
--   Al crear, los de create_catalog_species(): name_required, type_required, genus_not_found,
--   duplicate_name, similar_name.
--   42501                    Sin el rol de administrador (el guardián).

-- 1. Índice ---------------------------------------------------------------------------------
--
-- Las plantas por validar de un grupo, con la misma expresión que usan las funciones. Es
-- parcial: la cola es una parte pequeña de plants.

create index plants_pending_group_idx
  on public.plants (genus_id, public.normalize_search_text(entered_name))
  where validation = 'pending';

-- 2. Listado --------------------------------------------------------------------------------
--
-- public.list_proposal_groups(page_size = 20, page_offset = 0)
--
-- Una fila por grupo, del que tiene más plantas al que tiene menos (a igualdad, por la clave y
-- el género):
--   name_key       Clave del grupo (el nombre normalizado); se pasa tal cual para resolverlo.
--   proposed_name  La forma más frecuente del nombre tal como se escribió (a igualdad, la
--                  primera en orden alfabético con intercalación C).
--   genus_id, genus_name  El género del grupo.
--   type           El tipo más frecuente de sus plantas (species, hybrid o unknown).
--   plant_count    Plantas del grupo, de cualquier dueño y estado.
--   photos         Array de hasta cuatro {photo_path, thumbnail_path}, de las plantas con
--                  miniatura, de la más reciente a la más antigua.
--   total_count    Total de grupos (igual en todas las filas), para paginar.
-- page_size: 20 por defecto y 100 como máximo (nulo, cero o negativo, 20). page_offset: nulo
-- o negativo, 0.

create function public.list_proposal_groups(page_size integer default 20, page_offset integer default 0)
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
              pg_catalog.jsonb_build_object('photo_path', f.photo_path, 'thumbnail_path', f.thumbnail_path)
              order by f.created_at desc, f.id), '[]'::jsonb)
       from (
         select pe.id, pe.photo_path, pe.thumbnail_path, pe.created_at
           from pending pe
           where pe.key = g.key and pe.genus = g.genus and pe.thumbnail_path is not null
           order by pe.created_at desc, pe.id
           limit 4
       ) f),
    pg_catalog.count(*) over ()
  from groups g
  join public.genera ge on ge.id = g.genus
  order by g.plants desc, g.key collate "C", ge.name collate "C", g.genus
  limit size
  offset skip;
end;
$$;

comment on function public.list_proposal_groups(integer, integer) is
  'Backoffice: grupos de la cola de propuestas (nombre por validar), con nombre, género, tipo, número de plantas y fotos, sin datos del usuario. Función de administrador.';

revoke all on function public.list_proposal_groups(integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_proposal_groups(integer, integer) to authenticated;

-- public.count_proposal_groups(): cuántos grupos hay en la cola, para el número de la pestaña.

create function public.count_proposal_groups()
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_catalog_admin();

  return (
    select pg_catalog.count(*)
      from (
        select
          from public.plants p
          where p.validation = 'pending'
          group by public.normalize_search_text(p.entered_name), p.genus_id
      ) g
  );
end;
$$;

comment on function public.count_proposal_groups() is
  'Backoffice: número de grupos en la cola de propuestas. Función de administrador.';

revoke all on function public.count_proposal_groups() from public, anon, authenticated, service_role;
grant execute on function public.count_proposal_groups() to authenticated;

-- 3. Resolución -----------------------------------------------------------------------------
--
-- Las tres funciones reciben la clave del grupo (group_name_key, group_genus_id) y devuelven
-- una fila con action_id (la acción de la auditoría, nulo si no había plantas) y plant_count
-- (las plantas que resolvieron; 0 si otro administrador ya lo había hecho).

-- public.link_proposal_group(group_name_key, group_genus_id, target_species_id)

create function public.link_proposal_group(group_name_key text, group_genus_id uuid, target_species_id uuid)
returns table (
  action_id uuid,
  plant_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  key text;
  genus uuid;
  target public.species;
  locked_ids uuid[];
  proposed text;
  new_action_id uuid;
begin
  perform private.require_catalog_admin();

  key := nullif(public.normalize_search_text(link_proposal_group.group_name_key), '');
  genus := link_proposal_group.group_genus_id;
  if key is null or genus is null then
    perform private.raise_catalog_error('22023', 'group_required', 'Falta el grupo de la propuesta.');
  end if;

  -- La especie, bloqueada como la bloquea sync_with_species: nadie la borra ni la fusiona
  -- mientras se enlazan las plantas.
  select s.* into target from public.species s where s.id = link_proposal_group.target_species_id for share;
  if not found then
    perform private.raise_catalog_error('P0002', 'species_not_found',
      'La especie elegida ya no está en el catálogo.',
      pg_catalog.jsonb_build_object('species_id', link_proposal_group.target_species_id));
  end if;

  -- Las plantas pendientes del grupo, bloqueadas (ver "Concurrencia").
  select coalesce(pg_catalog.array_agg(l.id), '{}')
    into locked_ids
    from (
      select p.id
        from public.plants p
        where p.validation = 'pending'
          and p.genus_id = genus
          and public.normalize_search_text(p.entered_name) = key
        order by p.id
        for update
    ) l;

  if pg_catalog.cardinality(locked_ids) = 0 then
    return query select null::uuid, 0::bigint;
    return;
  end if;

  -- La forma más frecuente del nombre, como en list_proposal_groups().
  select w.written into proposed
    from (
      select pg_catalog.regexp_replace(pg_catalog.btrim(p.entered_name), '\s+', ' ', 'g') as written
        from public.plants p
        where p.id = any (locked_ids)
    ) w
    group by w.written
    order by pg_catalog.count(*) desc, w.written collate "C"
    limit 1;

  new_action_id := private.log_catalog_action(
    'link_proposal_group',
    pg_catalog.jsonb_build_object(
      'name_key', key,
      'proposed_name', proposed,
      'genus_id', genus,
      'genus_name', (select g.name from public.genera g where g.id = genus),
      'species_id', target.id,
      'scientific_name', target.scientific_name,
      'plant_count', pg_catalog.cardinality(locked_ids)
    ),
    'species',
    target.id
  );

  -- sync_with_species las deja validadas con el género y el tipo de la especie.
  update public.plants p
    set species_id = target.id
    where p.id = any (locked_ids)
      and p.validation = 'pending';

  return query select new_action_id, pg_catalog.cardinality(locked_ids)::bigint;
end;
$$;

comment on function public.link_proposal_group(text, uuid, uuid) is
  'Backoffice: enlaza todas las plantas por validar de un grupo a una especie existente. Función de administrador.';

revoke all on function public.link_proposal_group(text, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.link_proposal_group(text, uuid, uuid) to authenticated;

-- public.create_species_from_proposal(group_name_key, group_genus_id, new_scientific_name,
--                                     new_genus_id, new_type)
--
-- El nombre, el género y el tipo de la especie los decide el administrador (la pantalla los
-- trae rellenos con los del grupo). Devuelve además species_id, la especie creada (nula si el
-- grupo ya no tenía plantas: entonces no se crea nada).

create function public.create_species_from_proposal(
  group_name_key text,
  group_genus_id uuid,
  new_scientific_name text,
  new_genus_id uuid,
  new_type public.species_type
)
returns table (
  action_id uuid,
  plant_count bigint,
  species_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  key text;
  genus uuid;
  clean_name text;
  locked_ids uuid[];
  proposed text;
  new_action_id uuid;
  created_id uuid;
begin
  perform private.require_catalog_admin();

  key := nullif(public.normalize_search_text(create_species_from_proposal.group_name_key), '');
  genus := create_species_from_proposal.group_genus_id;
  if key is null or genus is null then
    perform private.raise_catalog_error('22023', 'group_required', 'Falta el grupo de la propuesta.');
  end if;

  -- Las mismas comprobaciones que create_catalog_species().
  clean_name := private.clean_catalog_text(new_scientific_name);
  if clean_name is null then
    perform private.raise_catalog_error('22023', 'name_required', 'Escribe el nombre científico.');
  end if;
  if new_type is null then
    perform private.raise_catalog_error('22023', 'type_required', 'Elige si es una especie o un híbrido.');
  end if;
  perform from public.genera g where g.id = new_genus_id;
  if not found then
    perform private.raise_catalog_error('23503', 'genus_not_found', 'El género elegido ya no existe.');
  end if;
  perform private.check_species_name_free(clean_name, null);

  select coalesce(pg_catalog.array_agg(l.id), '{}')
    into locked_ids
    from (
      select p.id
        from public.plants p
        where p.validation = 'pending'
          and p.genus_id = genus
          and public.normalize_search_text(p.entered_name) = key
        order by p.id
        for update
    ) l;

  if pg_catalog.cardinality(locked_ids) = 0 then
    return query select null::uuid, 0::bigint, null::uuid;
    return;
  end if;

  -- La forma más frecuente del nombre, como en list_proposal_groups().
  select w.written into proposed
    from (
      select pg_catalog.regexp_replace(pg_catalog.btrim(p.entered_name), '\s+', ' ', 'g') as written
        from public.plants p
        where p.id = any (locked_ids)
    ) w
    group by w.written
    order by pg_catalog.count(*) desc, w.written collate "C"
    limit 1;

  -- La acción antes del alta: el insert de la especie queda bajo ella. El objetivo se fija
  -- después, cuando ya existe la especie (ver abajo).
  created_id := pg_catalog.gen_random_uuid();
  new_action_id := private.log_catalog_action(
    'create_species_from_proposal',
    pg_catalog.jsonb_build_object(
      'name_key', key,
      'proposed_name', proposed,
      'genus_id', genus,
      'genus_name', (select g.name from public.genera g where g.id = genus),
      'species_id', created_id,
      'scientific_name', clean_name,
      'plant_count', pg_catalog.cardinality(locked_ids)
    ),
    'species',
    created_id
  );

  insert into public.species (id, scientific_name, genus_id, type, status, source, source_ref)
  values (created_id, clean_name, new_genus_id, new_type, 'validated', 'user_proposal', null);

  update public.plants p
    set species_id = created_id
    where p.id = any (locked_ids)
      and p.validation = 'pending';

  return query select new_action_id, pg_catalog.cardinality(locked_ids)::bigint, created_id;
end;
$$;

comment on function public.create_species_from_proposal(text, uuid, text, uuid, public.species_type) is
  'Backoffice: crea una especie (fuente propuesta de usuario, validada) y le enlaza las plantas por validar de un grupo, en una transacción. Función de administrador.';

revoke all on function public.create_species_from_proposal(text, uuid, text, uuid, public.species_type)
  from public, anon, authenticated, service_role;
grant execute on function public.create_species_from_proposal(text, uuid, text, uuid, public.species_type)
  to authenticated;

-- public.mark_proposal_unidentifiable(group_name_key, group_genus_id)

create function public.mark_proposal_unidentifiable(group_name_key text, group_genus_id uuid)
returns table (
  action_id uuid,
  plant_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  key text;
  genus uuid;
  locked_ids uuid[];
  proposed text;
  new_action_id uuid;
begin
  perform private.require_catalog_admin();

  key := nullif(public.normalize_search_text(mark_proposal_unidentifiable.group_name_key), '');
  genus := mark_proposal_unidentifiable.group_genus_id;
  if key is null or genus is null then
    perform private.raise_catalog_error('22023', 'group_required', 'Falta el grupo de la propuesta.');
  end if;

  select coalesce(pg_catalog.array_agg(l.id), '{}')
    into locked_ids
    from (
      select p.id
        from public.plants p
        where p.validation = 'pending'
          and p.genus_id = genus
          and public.normalize_search_text(p.entered_name) = key
        order by p.id
        for update
    ) l;

  if pg_catalog.cardinality(locked_ids) = 0 then
    return query select null::uuid, 0::bigint;
    return;
  end if;

  -- La forma más frecuente del nombre, como en list_proposal_groups().
  select w.written into proposed
    from (
      select pg_catalog.regexp_replace(pg_catalog.btrim(p.entered_name), '\s+', ' ', 'g') as written
        from public.plants p
        where p.id = any (locked_ids)
    ) w
    group by w.written
    order by pg_catalog.count(*) desc, w.written collate "C"
    limit 1;

  new_action_id := private.log_catalog_action(
    'mark_proposal_unidentifiable',
    pg_catalog.jsonb_build_object(
      'name_key', key,
      'proposed_name', proposed,
      'genus_id', genus,
      'genus_name', (select g.name from public.genera g where g.id = genus),
      'plant_count', pg_catalog.cardinality(locked_ids)
    )
  );

  update public.plants p
    set validation = 'unidentifiable'
    where p.id = any (locked_ids)
      and p.validation = 'pending';

  return query select new_action_id, pg_catalog.cardinality(locked_ids)::bigint;
end;
$$;

comment on function public.mark_proposal_unidentifiable(text, uuid) is
  'Backoffice: marca como no identificables todas las plantas por validar de un grupo. Siguen en el inventario de su dueño. Función de administrador.';

revoke all on function public.mark_proposal_unidentifiable(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mark_proposal_unidentifiable(text, uuid) to authenticated;
