-- Sinónimos, nombres comunes, géneros y abreviaturas desde el backoffice (issue #107, parte
-- de #20).
--
-- Funciones de administrador para escribir el resto del catálogo, con el mismo patrón y las
-- mismas razones que las de especies (migración 20261121120000_escritura_de_especies_del_
-- backoffice.sql): una transacción por operación, rechazos con un motivo estable en "detail"
-- (private.raise_catalog_error) y un punto único donde la auditoría (#23) podrá registrar la
-- acción. Las políticas RLS de escritura no cambian.
--
--   Nombres de una especie:  add_species_name(), update_species_name(), delete_species_name()
--   Géneros:                 create_catalog_genus(), update_catalog_genus(),
--                            delete_catalog_genus()
--   Abreviaturas:            add_genus_abbreviation(), update_genus_abbreviation(),
--                            delete_genus_abbreviation()
--
-- Motivos de error nuevos (además de los de la migración de especies):
--   22023 invalid_language          El idioma no es una etiqueta corta (es, en, pt-BR).
--   22023 name_type_required        Falta el tipo de nombre.
--   23505 duplicate_alternative_name La especie ya tiene ese nombre sin distinguir mayúsculas
--                                   (existing_name, existing_type).
--   23505 similar_alternative_name  La especie ya tiene uno que solo cambia en tildes o en el
--                                   signo "×" (existing_name, existing_type).
--   23505 name_is_scientific_name   Es el nombre científico de la propia especie.
--   P0002 name_not_found            El nombre ya no existe.
--   22023 invalid_genus_name        Un género es una sola palabra, con "× " delante si es un
--                                   nothogénero.
--   22023 quick_access_required     Falta la marca de acceso rápido.
--   23505 duplicate_genus           Ya hay un género con ese nombre (existing_name).
--   23505 similar_genus             Ya hay uno que solo cambia en tildes o en el signo "×"
--                                   (existing_name).
--   23503 genus_has_species         No se puede borrar: tiene especies (species_count).
--   23503 genus_has_plants          No se puede borrar: hay plantas de usuarios registradas con
--                                   ese género sin especie (plant_count).
--   P0002 genus_not_found           El género ya no existe (también 23503 al elegirlo).
--   22023 invalid_abbreviation      Una abreviatura es una palabra con su punto final.
--   23505 abbreviation_taken        Otra abreviatura igual, sin distinguir mayúsculas ni el
--                                   punto final, ya es de un género (genus_id, genus_name,
--                                   existing_abbreviation).
--   P0002 abbreviation_not_found    La abreviatura ya no existe.

-- Nombres de una especie -----------------------------------------------------------------------
--
-- Un nombre alternativo es un sinónimo o un nombre común. Mismas reglas que la tabla (único
-- por especie sin distinguir mayúsculas ni el tipo, sin espacios sobrantes), y además: no
-- puede ser el nombre científico de la propia especie, ni repetir otro de sus nombres que solo
-- cambie en tildes o en el signo "×" (la búsqueda los encontraría igual). El idioma solo se
-- guarda en los nombres comunes (los sinónimos son nombres científicos, en latín): etiqueta
-- corta en minúsculas ("es", "en", "pt-BR"), opcional; en un sinónimo se ignora.

create function private.check_alternative_name(
  target_species_id uuid,
  candidate text,
  excluded_name_id uuid
)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  scientific text;
  existing_name text;
  existing_type public.species_name_type;
begin
  select s.scientific_name into scientific from public.species s where s.id = target_species_id;
  if pg_catalog.lower(scientific) = pg_catalog.lower(candidate) then
    perform private.raise_catalog_error('23505', 'name_is_scientific_name',
      'Ese es el nombre científico de la especie.');
  end if;

  select n.name, n.type into existing_name, existing_type
    from public.species_names n
    where n.species_id = target_species_id
      and pg_catalog.lower(n.name) = pg_catalog.lower(candidate)
      and n.id is distinct from excluded_name_id
    limit 1;
  if existing_name is not null then
    perform private.raise_catalog_error('23505', 'duplicate_alternative_name',
      pg_catalog.format('La especie ya tiene el nombre «%s».', existing_name),
      pg_catalog.jsonb_build_object('existing_name', existing_name, 'existing_type', existing_type));
  end if;

  select n.name, n.type into existing_name, existing_type
    from public.species_names n
    where n.species_id = target_species_id
      and public.normalize_search_text(n.name) = public.normalize_search_text(candidate)
      and n.id is distinct from excluded_name_id
    limit 1;
  if existing_name is not null then
    perform private.raise_catalog_error('23505', 'similar_alternative_name',
      pg_catalog.format('La especie ya tiene un nombre que se escribe casi igual: «%s».', existing_name),
      pg_catalog.jsonb_build_object('existing_name', existing_name, 'existing_type', existing_type));
  end if;
end;
$$;

comment on function private.check_alternative_name(uuid, text, uuid) is
  'Error si el nombre alternativo choca con el nombre científico o con otro nombre de la especie.';

revoke all on function private.check_alternative_name(uuid, text, uuid) from public;

-- Idioma limpio de un nombre: null en los sinónimos o si viene vacío; error si no tiene la
-- forma que exige species_names_language_format.
create function private.clean_name_language(name_type public.species_name_type, language text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  clean text;
begin
  if name_type is distinct from 'common' then
    return null;
  end if;
  clean := nullif(pg_catalog.btrim(language), '');
  if clean is null then
    return null;
  end if;
  -- La subetiqueta principal en minúsculas: "ES" o "Es" valen como "es".
  clean := pg_catalog.lower(pg_catalog.split_part(clean, '-', 1))
    || pg_catalog.substr(clean, pg_catalog.length(pg_catalog.split_part(clean, '-', 1)) + 1);
  if clean !~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$' then
    perform private.raise_catalog_error('22023', 'invalid_language',
      'El idioma es una etiqueta corta, como es, en o pt-BR.');
  end if;
  return clean;
end;
$$;

comment on function private.clean_name_language(public.species_name_type, text) is
  'Idioma de un nombre alternativo: solo en los comunes, como etiqueta corta, o error invalid_language.';

revoke all on function private.clean_name_language(public.species_name_type, text) from public;

create function public.add_species_name(
  target_species_id uuid,
  new_name text,
  new_type public.species_name_type,
  new_language text default null
)
returns public.species_names
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_name text;
  created public.species_names;
begin
  perform private.require_catalog_admin();

  -- Bloquea la especie: dos altas a la vez del mismo nombre esperan una a la otra.
  perform from public.species s where s.id = target_species_id for update;
  if not found then
    perform private.raise_catalog_error('P0002', 'species_not_found', 'Esta especie ya no está en el catálogo.');
  end if;
  clean_name := private.clean_catalog_text(new_name);
  if clean_name is null then
    perform private.raise_catalog_error('22023', 'name_required', 'Escribe el nombre.');
  end if;
  if new_type is null then
    perform private.raise_catalog_error('22023', 'name_type_required', 'Elige si es un sinónimo o un nombre común.');
  end if;
  perform private.check_alternative_name(target_species_id, clean_name, null);

  insert into public.species_names (species_id, name, type, language)
  values (target_species_id, clean_name, new_type, private.clean_name_language(new_type, new_language))
  returning * into created;
  return created;
end;
$$;

comment on function public.add_species_name(uuid, text, public.species_name_type, text) is
  'Backoffice: añade un sinónimo o un nombre común a una especie. Función de administrador.';

create function public.update_species_name(
  target_name_id uuid,
  new_name text,
  new_type public.species_name_type,
  new_language text default null
)
returns public.species_names
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
  clean_name text;
  updated public.species_names;
begin
  perform private.require_catalog_admin();

  select n.species_id into owner_id from public.species_names n where n.id = target_name_id;
  if owner_id is null then
    perform private.raise_catalog_error('P0002', 'name_not_found', 'Este nombre ya no está en el catálogo.');
  end if;
  perform from public.species s where s.id = owner_id for update;
  clean_name := private.clean_catalog_text(new_name);
  if clean_name is null then
    perform private.raise_catalog_error('22023', 'name_required', 'Escribe el nombre.');
  end if;
  if new_type is null then
    perform private.raise_catalog_error('22023', 'name_type_required', 'Elige si es un sinónimo o un nombre común.');
  end if;
  perform private.check_alternative_name(owner_id, clean_name, target_name_id);

  update public.species_names n
    set name = clean_name,
        type = new_type,
        language = private.clean_name_language(new_type, new_language)
    where n.id = target_name_id
    returning * into updated;
  return updated;
end;
$$;

comment on function public.update_species_name(uuid, text, public.species_name_type, text) is
  'Backoffice: cambia un sinónimo o un nombre común (nombre, tipo e idioma). Función de administrador.';

create function public.delete_species_name(target_name_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_catalog_admin();

  delete from public.species_names n where n.id = target_name_id;
  if not found then
    perform private.raise_catalog_error('P0002', 'name_not_found', 'Este nombre ya no está en el catálogo.');
  end if;
end;
$$;

comment on function public.delete_species_name(uuid) is
  'Backoffice: quita un sinónimo o un nombre común. Función de administrador.';

-- Géneros ----------------------------------------------------------------------------------------
--
-- El nombre de un género es una sola palabra; un nothogénero lleva el signo de híbrido delante,
-- separado por un espacio, como lo escribe la fuente ("× Rhyncholaeliocattleya"). Se acepta
-- también pegado ("×Rhyncholaeliocattleya") y se guarda con el espacio. Dos géneros no pueden
-- tener el mismo nombre sin distinguir mayúsculas (genera_name_key) ni el mismo nombre
-- normalizado: "Rhyncholaeliocattleya" y "× Rhyncholaeliocattleya" serían el mismo género
-- para la búsqueda. Renombrar no cambia el nombre científico de sus especies.
--
-- La marca de acceso rápido decide qué géneros salen como chips en el formulario de registro
-- de todos los usuarios.
--
-- Un género se borra solo si no tiene especies (species_genus_id_fkey) ni plantas de usuarios
-- registradas con él sin especie (plants_genus_id_fkey); sus abreviaturas se van con él.

create function private.clean_genus_name(name text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  clean text;
begin
  clean := private.clean_catalog_text(name);
  if clean is null then
    perform private.raise_catalog_error('22023', 'name_required', 'Escribe el nombre del género.');
  end if;
  clean := pg_catalog.regexp_replace(clean, '^×\s*', '× ');
  if clean !~ '^(× )?[^\s×]+$' then
    perform private.raise_catalog_error('22023', 'invalid_genus_name',
      'El nombre de un género es una sola palabra, con «× » delante si es un nothogénero.');
  end if;
  return clean;
end;
$$;

comment on function private.clean_genus_name(text) is
  'Nombre de género limpio ("× " delante de un nothogénero) o error name_required o invalid_genus_name.';

revoke all on function private.clean_genus_name(text) from public;

create function private.check_genus_name_free(candidate text, excluded_id uuid)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  existing_name text;
begin
  select g.name into existing_name
    from public.genera g
    where pg_catalog.lower(g.name) = pg_catalog.lower(candidate)
      and g.id is distinct from excluded_id
    limit 1;
  if existing_name is not null then
    perform private.raise_catalog_error('23505', 'duplicate_genus',
      pg_catalog.format('Ya hay un género con el nombre «%s».', existing_name),
      pg_catalog.jsonb_build_object('existing_name', existing_name));
  end if;

  select g.name into existing_name
    from public.genera g
    where public.normalize_search_text(g.name) = public.normalize_search_text(candidate)
      and g.id is distinct from excluded_id
    limit 1;
  if existing_name is not null then
    perform private.raise_catalog_error('23505', 'similar_genus',
      pg_catalog.format('Ya hay un género que se escribe casi igual: «%s» (solo cambian las tildes o el signo de híbrido).', existing_name),
      pg_catalog.jsonb_build_object('existing_name', existing_name));
  end if;
end;
$$;

comment on function private.check_genus_name_free(text, uuid) is
  'Error duplicate_genus o similar_genus si otro género tiene ese nombre, sin distinguir mayúsculas o tras normalizar.';

revoke all on function private.check_genus_name_free(text, uuid) from public;

create function public.create_catalog_genus(new_name text, new_is_quick_access boolean default false)
returns public.genera
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_name text;
  created public.genera;
begin
  perform private.require_catalog_admin();

  clean_name := private.clean_genus_name(new_name);
  if new_is_quick_access is null then
    perform private.raise_catalog_error('22023', 'quick_access_required', 'Indica si es de acceso rápido.');
  end if;
  perform private.check_genus_name_free(clean_name, null);

  insert into public.genera (name, is_quick_access)
  values (clean_name, new_is_quick_access)
  returning * into created;
  return created;
end;
$$;

comment on function public.create_catalog_genus(text, boolean) is
  'Backoffice: crea un género. Función de administrador.';

create function public.update_catalog_genus(
  target_genus_id uuid,
  new_name text,
  new_is_quick_access boolean
)
returns public.genera
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_name text;
  clean_name text;
  updated public.genera;
begin
  perform private.require_catalog_admin();

  select g.name into current_name from public.genera g where g.id = target_genus_id for update;
  if not found then
    perform private.raise_catalog_error('P0002', 'genus_not_found', 'Este género ya no está en el catálogo.');
  end if;
  clean_name := private.clean_genus_name(new_name);
  if new_is_quick_access is null then
    perform private.raise_catalog_error('22023', 'quick_access_required', 'Indica si es de acceso rápido.');
  end if;
  if clean_name <> current_name then
    perform private.check_genus_name_free(clean_name, target_genus_id);
  end if;

  update public.genera g
    set name = clean_name,
        is_quick_access = new_is_quick_access
    where g.id = target_genus_id
    returning * into updated;
  return updated;
end;
$$;

comment on function public.update_catalog_genus(uuid, text, boolean) is
  'Backoffice: renombra un género y cambia su marca de acceso rápido. Función de administrador.';

create function public.delete_catalog_genus(target_genus_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  species_count bigint;
  plant_count bigint;
begin
  perform private.require_catalog_admin();

  perform from public.genera g where g.id = target_genus_id for update;
  if not found then
    perform private.raise_catalog_error('P0002', 'genus_not_found', 'Este género ya no está en el catálogo.');
  end if;
  select pg_catalog.count(*) into species_count from public.species s where s.genus_id = target_genus_id;
  if species_count > 0 then
    perform private.raise_catalog_error('23503', 'genus_has_species',
      pg_catalog.format('No se puede borrar: el género tiene especies (%s).', species_count),
      pg_catalog.jsonb_build_object('species_count', species_count));
  end if;
  select pg_catalog.count(*) into plant_count from public.plants p where p.genus_id = target_genus_id;
  if plant_count > 0 then
    perform private.raise_catalog_error('23503', 'genus_has_plants',
      pg_catalog.format('No se puede borrar: hay plantas de usuarios registradas con este género (%s).', plant_count),
      pg_catalog.jsonb_build_object('plant_count', plant_count));
  end if;

  delete from public.genera g where g.id = target_genus_id;
end;
$$;

comment on function public.delete_catalog_genus(uuid) is
  'Backoffice: borra un género sin especies ni plantas, con sus abreviaturas. Función de administrador.';

-- Abreviaturas -----------------------------------------------------------------------------------
--
-- Convención: se guardan con su punto final ("Phal."); si se escribe sin él, se añade. Una
-- abreviatura es una sola palabra. Pertenece a un solo género, sin distinguir mayúsculas,
-- tildes ni el punto final: la clave es la del índice único genus_abbreviations_search_key
-- (normalize_search_text(rtrim(abbreviation, '.'))), la misma con la que la búsqueda la
-- resuelve. Si choca, el error dice qué género la tiene.

create function private.clean_abbreviation(abbreviation text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  clean text;
begin
  clean := private.clean_catalog_text(abbreviation);
  if clean is null or pg_catalog.rtrim(clean, '.') = '' then
    perform private.raise_catalog_error('22023', 'name_required', 'Escribe la abreviatura.');
  end if;
  clean := pg_catalog.rtrim(clean, '.') || '.';
  if clean !~ '^[^\s.]+\.$' then
    perform private.raise_catalog_error('22023', 'invalid_abbreviation',
      'Una abreviatura es una sola palabra con su punto final, como Phal.');
  end if;
  return clean;
end;
$$;

comment on function private.clean_abbreviation(text) is
  'Abreviatura limpia con su punto final, o error name_required o invalid_abbreviation.';

revoke all on function private.clean_abbreviation(text) from public;

create function private.check_abbreviation_free(candidate text, excluded_id uuid)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  owner_id uuid;
  owner_name text;
  existing text;
begin
  -- Misma expresión que genus_abbreviations_search_key, para que use el índice.
  select g.id, g.name, a.abbreviation into owner_id, owner_name, existing
    from public.genus_abbreviations a
    join public.genera g on g.id = a.genus_id
    where public.normalize_search_text(pg_catalog.rtrim(a.abbreviation, '.'))
          = public.normalize_search_text(pg_catalog.rtrim(candidate, '.'))
      and a.id is distinct from excluded_id
    limit 1;
  if owner_id is not null then
    perform private.raise_catalog_error('23505', 'abbreviation_taken',
      pg_catalog.format('La abreviatura «%s» ya es del género %s.', existing, owner_name),
      pg_catalog.jsonb_build_object('genus_id', owner_id, 'genus_name', owner_name,
                                    'existing_abbreviation', existing));
  end if;
end;
$$;

comment on function private.check_abbreviation_free(text, uuid) is
  'Error abbreviation_taken, con el género que la tiene, si otra abreviatura tiene la misma clave de búsqueda.';

revoke all on function private.check_abbreviation_free(text, uuid) from public;

create function public.add_genus_abbreviation(target_genus_id uuid, new_abbreviation text)
returns public.genus_abbreviations
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean text;
  created public.genus_abbreviations;
begin
  perform private.require_catalog_admin();

  perform from public.genera g where g.id = target_genus_id for update;
  if not found then
    perform private.raise_catalog_error('P0002', 'genus_not_found', 'Este género ya no está en el catálogo.');
  end if;
  clean := private.clean_abbreviation(new_abbreviation);
  perform private.check_abbreviation_free(clean, null);

  insert into public.genus_abbreviations (genus_id, abbreviation)
  values (target_genus_id, clean)
  returning * into created;
  return created;
end;
$$;

comment on function public.add_genus_abbreviation(uuid, text) is
  'Backoffice: añade una abreviatura a un género (con su punto final). Función de administrador.';

create function public.update_genus_abbreviation(target_abbreviation_id uuid, new_abbreviation text)
returns public.genus_abbreviations
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean text;
  updated public.genus_abbreviations;
begin
  perform private.require_catalog_admin();

  perform from public.genus_abbreviations a where a.id = target_abbreviation_id for update;
  if not found then
    perform private.raise_catalog_error('P0002', 'abbreviation_not_found', 'Esta abreviatura ya no está en el catálogo.');
  end if;
  clean := private.clean_abbreviation(new_abbreviation);
  perform private.check_abbreviation_free(clean, target_abbreviation_id);

  update public.genus_abbreviations a
    set abbreviation = clean
    where a.id = target_abbreviation_id
    returning * into updated;
  return updated;
end;
$$;

comment on function public.update_genus_abbreviation(uuid, text) is
  'Backoffice: cambia una abreviatura. Función de administrador.';

create function public.delete_genus_abbreviation(target_abbreviation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_catalog_admin();

  delete from public.genus_abbreviations a where a.id = target_abbreviation_id;
  if not found then
    perform private.raise_catalog_error('P0002', 'abbreviation_not_found', 'Esta abreviatura ya no está en el catálogo.');
  end if;
end;
$$;

comment on function public.delete_genus_abbreviation(uuid) is
  'Backoffice: quita una abreviatura. Función de administrador.';

-- Permisos: solo authenticated (y dentro, el guardián) --------------------------------------------

do $$
declare
  signature text;
begin
  foreach signature in array array[
    'public.add_species_name(uuid, text, public.species_name_type, text)',
    'public.update_species_name(uuid, text, public.species_name_type, text)',
    'public.delete_species_name(uuid)',
    'public.create_catalog_genus(text, boolean)',
    'public.update_catalog_genus(uuid, text, boolean)',
    'public.delete_catalog_genus(uuid)',
    'public.add_genus_abbreviation(uuid, text)',
    'public.update_genus_abbreviation(uuid, text)',
    'public.delete_genus_abbreviation(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', signature);
    execute format('grant execute on function %s to authenticated', signature);
  end loop;
end;
$$;
