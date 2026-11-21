-- Alta, edición, baja y cambio de estado de especies desde el backoffice (issue #106, parte
-- de #20).
--
-- Esta migración:
--   1. Crea el disparador "editada pasa a validada": cuando un administrador del catálogo
--      cambia el nombre, el género o el tipo de una especie importada y la deja como
--      importada, la base la marca como validada. Así la importación (scripts/catalog-import),
--      que no toca las especies cuyo estado no es "imported", no pisa la edición.
--   2. Crea cuatro funciones de administrador para escribir especies:
--      create_catalog_species(), update_catalog_species(), set_catalog_species_status() y
--      delete_catalog_species().
--   3. Crea dos funciones auxiliares en private: limpiar un nombre y lanzar un error del
--      catálogo con un motivo que la app sabe traducir.
--
-- Por qué funciones y no escrituras directas en las tablas
-- ---------------------------------------------------------
-- Las políticas de la migración 20261120181000 ya dejan a un administrador insertar, editar y
-- borrar en las cuatro tablas del catálogo, y esas políticas no cambian: siguen valiendo para
-- quien escriba directamente. Pero la pantalla escribe a través de funciones porque:
--   - Cada operación es una sola llamada y una sola transacción: editar los datos y cambiar
--     el estado a la vez, o cambiar el estado de un lote entero o de ninguna especie.
--   - Los errores salen con un motivo estable (en "detail", como JSON) y los datos que hacen
--     falta para explicarlos: qué especie tiene ya ese nombre, cuántas plantas impiden borrar.
--   - Pueden hacer comprobaciones que no son restricciones del esquema, como rechazar un
--     nombre que solo se diferencia de otro en las tildes o en el signo "×" (en el catálogo
--     real ya hay pares así, que vienen de la fuente, así que no puede ser una restricción).
--   - Son el punto único por el que el backoffice escribe el catálogo: la auditoría (#23)
--     podrá registrar ahí, además de con sus disparadores, la acción con su sentido (alta,
--     edición, cambio de estado por lote, baja).
-- Lo que no puede depender de que la interfaz pase por ellas ("editada pasa a validada") va
-- en un disparador, que vale también para una escritura directa por la API.
--
-- Son funciones de administrador (security definer con el guardián como primera sentencia;
-- ver "Funciones de administrador" en supabase/README.md): necesitan contar las plantas de
-- todos los usuarios, que RLS oculta al administrador, y usar las funciones auxiliares de
-- private, que solo ejecuta su dueño.
--
-- Errores
-- -------
-- Todos los rechazos de estas funciones llevan un código SQLSTATE estándar (que PostgREST
-- traduce a un estado HTTP), un mensaje en español y, en "detail", un objeto JSON con el
-- motivo ("reason") y sus datos. La app traduce el motivo (apps/web/src/lib/catalogWrites.ts).
--   22023 name_required          El nombre está vacío.
--   22023 status_required        Falta el estado.
--   22023 type_required          Falta el tipo.
--   22023 invalid_status         Una especie nueva no puede quedar como importada.
--   22023 no_species             El lote está vacío.
--   22023 too_many_species       El lote tiene más de 100 especies (max).
--   23505 duplicate_name         Ya hay una especie con ese nombre sin distinguir mayúsculas
--                                (existing_id, existing_name).
--   23505 similar_name           Ya hay una que solo se diferencia en las tildes o en el
--                                signo de híbrido (existing_id, existing_name).
--   23503 genus_not_found        El género no existe.
--   23503 species_has_plants     No se puede borrar: tiene plantas enlazadas (plant_count).
--   P0002 species_not_found      La especie no existe (en un lote: missing_count).

-- Funciones auxiliares ------------------------------------------------------------------------

-- Un nombre del catálogo tal como lo exigen las restricciones "_clean" de las tablas: sin
-- espacios al principio ni al final y sin espacios repetidos por dentro. null si queda vacío.
create function private.clean_catalog_text(value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select nullif(
    pg_catalog.regexp_replace(pg_catalog.btrim(value), '\s+', ' ', 'g'),
    ''
  )
$$;

comment on function private.clean_catalog_text(text) is
  'Nombre del catálogo sin espacios sobrantes (como exigen las restricciones _clean), o null si queda vacío.';

-- Lanza un error del catálogo: el código SQLSTATE, el mensaje y, en detail, el motivo y sus
-- datos como JSON. No vuelve nunca.
create function private.raise_catalog_error(
  error_code text,
  reason text,
  message text,
  extra jsonb default '{}'
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = error_code,
    message = message,
    detail = (pg_catalog.jsonb_build_object('reason', reason) || coalesce(extra, '{}'))::text;
end;
$$;

comment on function private.raise_catalog_error(text, text, text, jsonb) is
  'Lanza un error del catálogo con un motivo estable en detail (JSON) para que la app lo traduzca.';

revoke all on function private.clean_catalog_text(text) from public;
revoke all on function private.raise_catalog_error(text, text, text, jsonb) from public;

-- Comprueba que un nombre científico nuevo no choca con el de otra especie: igual sin
-- distinguir mayúsculas (lo que impide el índice único species_scientific_name_key, aquí con
-- el nombre de la que ya lo tiene) o igual tras normalizar (sin tildes, mayúsculas ni signo de
-- híbrido, la misma clave que usa la búsqueda). excluded_id es la especie que se edita.
create function private.check_species_name_free(name text, excluded_id uuid)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  existing_id uuid;
  existing_name text;
begin
  select s.id, s.scientific_name into existing_id, existing_name
    from public.species s
    where pg_catalog.lower(s.scientific_name) = pg_catalog.lower(name)
      and s.id is distinct from excluded_id
    limit 1;
  if existing_id is not null then
    perform private.raise_catalog_error('23505', 'duplicate_name',
      pg_catalog.format('Ya hay una especie con el nombre «%s».', existing_name),
      pg_catalog.jsonb_build_object('existing_id', existing_id, 'existing_name', existing_name));
  end if;

  -- Misma expresión que el índice species_scientific_name_prefix_idx, para que lo use.
  select s.id, s.scientific_name into existing_id, existing_name
    from public.species s
    where public.normalize_search_text(s.scientific_name) collate "C"
          = public.normalize_search_text(name) collate "C"
      and s.id is distinct from excluded_id
    limit 1;
  if existing_id is not null then
    perform private.raise_catalog_error('23505', 'similar_name',
      pg_catalog.format('Ya hay una especie que se escribe casi igual: «%s» (solo cambian las tildes o el signo de híbrido).', existing_name),
      pg_catalog.jsonb_build_object('existing_id', existing_id, 'existing_name', existing_name));
  end if;
end;
$$;

comment on function private.check_species_name_free(text, uuid) is
  'Error duplicate_name o similar_name si otra especie tiene ese nombre, sin distinguir mayúsculas o tras normalizar.';

revoke all on function private.check_species_name_free(text, uuid) from public;

-- Editada pasa a validada ------------------------------------------------------------------
--
-- Si un administrador del catálogo cambia el nombre científico, el género o el tipo de una
-- especie importada y no le cambia el estado, la especie pasa a "validated". La importación de
-- COL solo actualiza las especies que siguen "imported" (scripts/catalog-import/README.md), así
-- que la edición queda protegida. Si en la misma edición el administrador elige "observed", se
-- respeta. Cambiar solo el estado (también volver a "imported") no lo activa.
--
-- Va en un disparador para que no dependa de la interfaz: vale para las funciones de esta
-- migración y para una escritura directa en la tabla por la API. Solo actúa con el rol de
-- administrador en el token (public.is_catalog_admin()): la importación escribe con conexión
-- directa, sin token, y sus cambios no validan nada.
--
-- Es security invoker: solo toca la fila nueva y lee el token de la petición.

create function private.validate_edited_imported_species()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if public.is_catalog_admin() then
    new.status := 'validated';
  end if;
  return new;
end;
$$;

comment on function private.validate_edited_imported_species() is
  'Disparador: una especie importada a la que un administrador cambia el nombre, el género o el tipo pasa a validada.';

revoke all on function private.validate_edited_imported_species() from public;

create trigger validate_edited_imported
  before update of scientific_name, genus_id, type on public.species
  for each row
  when (
    old.status = 'imported'
    and new.status = 'imported'
    and (old.scientific_name, old.genus_id, old.type)
        is distinct from (new.scientific_name, new.genus_id, new.type)
  )
  execute function private.validate_edited_imported_species();

-- Alta -------------------------------------------------------------------------------------
--
-- public.create_catalog_species(new_scientific_name, new_genus_id, new_type, new_status)
--
-- Da de alta una especie o un híbrido con fuente "curated" (lista curada) y sin source_ref: lo
-- que da de alta un administrador no viene de ninguna fuente externa, y la carga de la lista de
-- híbridos (que usa source_ref) no la reconoce como suya. El nombre se guarda sin espacios
-- sobrantes. El estado es "validated" por defecto; "observed" también vale; "imported" no,
-- porque nadie la importó. Devuelve la especie creada.

create function public.create_catalog_species(
  new_scientific_name text,
  new_genus_id uuid,
  new_type public.species_type,
  new_status public.species_status default 'validated'
)
returns public.species
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_name text;
  created public.species;
begin
  perform private.require_catalog_admin();

  clean_name := private.clean_catalog_text(new_scientific_name);
  if clean_name is null then
    perform private.raise_catalog_error('22023', 'name_required', 'Escribe el nombre científico.');
  end if;
  if new_type is null then
    perform private.raise_catalog_error('22023', 'type_required', 'Elige si es una especie o un híbrido.');
  end if;
  if new_status is null then
    perform private.raise_catalog_error('22023', 'status_required', 'Elige el estado.');
  end if;
  if new_status = 'imported' then
    perform private.raise_catalog_error('22023', 'invalid_status',
      'Una especie dada de alta a mano no puede quedar como importada: elige validada u observada.');
  end if;
  perform from public.genera g where g.id = new_genus_id;
  if not found then
    perform private.raise_catalog_error('23503', 'genus_not_found', 'El género elegido ya no existe.');
  end if;
  perform private.check_species_name_free(clean_name, null);

  insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
  values (clean_name, new_genus_id, new_type, new_status, 'curated', null)
  returning * into created;
  return created;
end;
$$;

comment on function public.create_catalog_species(text, uuid, public.species_type, public.species_status) is
  'Backoffice: da de alta una especie o un híbrido (fuente curated, sin referencia). Función de administrador.';

revoke all on function public.create_catalog_species(text, uuid, public.species_type, public.species_status)
  from public, anon, authenticated, service_role;
grant execute on function public.create_catalog_species(text, uuid, public.species_type, public.species_status)
  to authenticated;

-- Edición ----------------------------------------------------------------------------------
--
-- public.update_catalog_species(target_species_id, new_scientific_name, new_genus_id, new_type,
--                               new_status)
--
-- Cambia los datos y el estado de una especie en una sola sentencia. Todos los valores son
-- obligatorios (la pantalla envía el formulario entero). La fuente y su referencia no se tocan.
-- Si cambia el género o el tipo, el disparador propagate_to_plants los copia a las plantas
-- enlazadas de todos los usuarios; la pantalla avisa antes con count_species_plants(). Si era
-- importada y cambian sus datos, el disparador validate_edited_imported la deja validada.
-- El nombre solo se compara con los demás si cambia, para no rechazar un cambio de estado de
-- una especie que ya tenía un par casi igual de la fuente. Devuelve la especie como queda.

create function public.update_catalog_species(
  target_species_id uuid,
  new_scientific_name text,
  new_genus_id uuid,
  new_type public.species_type,
  new_status public.species_status
)
returns public.species
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_name text;
  current_name text;
  updated public.species;
begin
  perform private.require_catalog_admin();

  select s.scientific_name into current_name
    from public.species s where s.id = target_species_id
    for update;
  if not found then
    perform private.raise_catalog_error('P0002', 'species_not_found', 'Esta especie ya no está en el catálogo.');
  end if;

  clean_name := private.clean_catalog_text(new_scientific_name);
  if clean_name is null then
    perform private.raise_catalog_error('22023', 'name_required', 'Escribe el nombre científico.');
  end if;
  if new_type is null then
    perform private.raise_catalog_error('22023', 'type_required', 'Elige si es una especie o un híbrido.');
  end if;
  if new_status is null then
    perform private.raise_catalog_error('22023', 'status_required', 'Elige el estado.');
  end if;
  perform from public.genera g where g.id = new_genus_id;
  if not found then
    perform private.raise_catalog_error('23503', 'genus_not_found', 'El género elegido ya no existe.');
  end if;
  if clean_name <> current_name then
    perform private.check_species_name_free(clean_name, target_species_id);
  end if;

  update public.species s
    set scientific_name = clean_name,
        genus_id = new_genus_id,
        type = new_type,
        status = new_status
    where s.id = target_species_id
    returning * into updated;
  return updated;
end;
$$;

comment on function public.update_catalog_species(uuid, text, uuid, public.species_type, public.species_status) is
  'Backoffice: cambia el nombre, el género, el tipo y el estado de una especie. Función de administrador.';

revoke all on function public.update_catalog_species(uuid, text, uuid, public.species_type, public.species_status)
  from public, anon, authenticated, service_role;
grant execute on function public.update_catalog_species(uuid, text, uuid, public.species_type, public.species_status)
  to authenticated;

-- Cambio de estado por lote -----------------------------------------------------------------
--
-- public.set_catalog_species_status(target_species_ids, new_status)
--
-- Pone el mismo estado a un lote de especies (de 1 a 100, lo que cabe en una página de la
-- tabla), todas o ninguna: si alguna ya no existe, no cambia nada y el error dice cuántas
-- faltan. Los ids repetidos cuentan una vez. Solo escribe las que tienen otro estado, para no
-- mover updated_at de las demás. Cualquier estado vale, también volver a "imported" (la
-- importación las volverá a actualizar). Devuelve cuántas especies cambiaron de estado.

create function public.set_catalog_species_status(
  target_species_ids uuid[],
  new_status public.species_status
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  wanted integer;
  found_count integer;
  changed integer;
begin
  perform private.require_catalog_admin();

  if new_status is null then
    perform private.raise_catalog_error('22023', 'status_required', 'Elige el estado.');
  end if;
  select pg_catalog.count(distinct x.id) into wanted
    from pg_catalog.unnest(target_species_ids) as x (id)
    where x.id is not null;
  if wanted = 0 then
    perform private.raise_catalog_error('22023', 'no_species', 'Elige al menos una especie.');
  end if;
  if wanted > 100 then
    perform private.raise_catalog_error('22023', 'too_many_species',
      'Se pueden cambiar como mucho 100 especies a la vez.',
      pg_catalog.jsonb_build_object('max', 100));
  end if;

  -- Bloquea el lote entero antes de escribir: si falta alguna, nada cambia.
  select pg_catalog.count(*) into found_count
    from (select from public.species s where s.id = any (target_species_ids) for update) locked;
  if found_count < wanted then
    perform private.raise_catalog_error('P0002', 'species_not_found',
      'Alguna de las especies elegidas ya no está en el catálogo: no se cambió ninguna.',
      pg_catalog.jsonb_build_object('missing_count', wanted - found_count));
  end if;

  update public.species s
    set status = new_status
    where s.id = any (target_species_ids)
      and s.status <> new_status;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

comment on function public.set_catalog_species_status(uuid[], public.species_status) is
  'Backoffice: pone un estado a un lote de 1 a 100 especies, todas o ninguna. Función de administrador.';

revoke all on function public.set_catalog_species_status(uuid[], public.species_status)
  from public, anon, authenticated, service_role;
grant execute on function public.set_catalog_species_status(uuid[], public.species_status)
  to authenticated;

-- Baja -------------------------------------------------------------------------------------
--
-- public.delete_catalog_species(target_species_id)
--
-- Borra una especie sin plantas enlazadas (de ningún usuario ni estado), con sus sinónimos y
-- nombres comunes (en cascada). Con plantas, no borra nada y el error dice cuántas hay: la
-- forma de quitarla del catálogo será fusionarla con otra (#21). La clave foránea
-- plants_species_id_fkey lo impediría igualmente; la comprobación previa da el número. La
-- especie se bloquea antes de contar: enlazar una planta la bloquea "for share" (disparador
-- sync_with_species), así que nadie la enlaza entre la cuenta y el borrado.

create function public.delete_catalog_species(target_species_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  plant_count bigint;
begin
  perform private.require_catalog_admin();

  perform from public.species s where s.id = target_species_id for update;
  if not found then
    perform private.raise_catalog_error('P0002', 'species_not_found', 'Esta especie ya no está en el catálogo.');
  end if;

  select pg_catalog.count(*) into plant_count
    from public.plants p where p.species_id = target_species_id;
  if plant_count > 0 then
    perform private.raise_catalog_error('23503', 'species_has_plants',
      pg_catalog.format('No se puede borrar: hay plantas de usuarios enlazadas a esta especie (%s).', plant_count),
      pg_catalog.jsonb_build_object('plant_count', plant_count));
  end if;

  delete from public.species s where s.id = target_species_id;
end;
$$;

comment on function public.delete_catalog_species(uuid) is
  'Backoffice: borra una especie sin plantas enlazadas, con sus nombres. Función de administrador.';

revoke all on function public.delete_catalog_species(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_catalog_species(uuid) to authenticated;
