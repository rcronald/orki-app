-- Sincronización de las plantas con su especie y marcas de última modificación
-- (issue #49, parte del esquema de #4).
--
-- Todo vive en la base de datos, con disparadores, para que valga igual desde la app, el
-- backoffice y los scripts de importación:
--   - Al enlazar una planta a una especie (al insertarla o al actualizarla), su género y su
--     tipo se sobrescriben con los de la especie y su validación pasa a "validated".
--   - Al desenlazarla, conserva género y tipo y vuelve a "pending", salvo que en la misma
--     actualización se marque "unidentifiable".
--   - Si cambia el género o el tipo de una especie, el cambio se propaga a sus plantas.
--   - updated_at se actualiza solo en todas las tablas, y created_at no se puede cambiar.
--
-- Las funciones viven en el esquema "private", que la API no expone, y tienen search_path
-- vacío con todos los nombres calificados, como recomienda Supabase. Las dos que leen o
-- escriben otra tabla son "security definer" (se ejecutan como el dueño de las tablas, que no
-- está sujeto a RLS): así la sincronización no depende de lo que el usuario que edita pueda
-- ver o escribir. No se pueden llamar directamente: una función de disparador solo se ejecuta
-- como disparador, y además nadie más que el dueño tiene permiso de ejecución.

create schema if not exists private;

revoke all on schema private from public;

-- Marcas de tiempo ----------------------------------------------------------------------

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  -- La fecha de creación no se reescribe.
  new.created_at := old.created_at;
  return new;
end;
$$;

comment on function private.set_updated_at() is
  'Disparador: mantiene updated_at al actualizar una fila y conserva created_at.';

create trigger set_updated_at before update on public.genera
  for each row execute function private.set_updated_at();

create trigger set_updated_at before update on public.genus_abbreviations
  for each row execute function private.set_updated_at();

create trigger set_updated_at before update on public.species
  for each row execute function private.set_updated_at();

create trigger set_updated_at before update on public.species_names
  for each row execute function private.set_updated_at();

create trigger set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

create trigger set_updated_at before update on public.plants
  for each row execute function private.set_updated_at();

-- Planta: género, tipo y validación según su especie ------------------------------------

create or replace function private.sync_plant_with_species()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked_genus_id uuid;
  linked_type public.species_type;
begin
  if new.species_id is not null then
    -- "for share" bloquea la especie hasta el final de la transacción: si alguien cambia a
    -- la vez su género o su tipo, una de las dos transacciones espera a la otra y la
    -- propagación siempre ve esta planta. Como "security definer", la lectura no depende de
    -- las políticas de la especie que vea quien edita la planta.
    select s.genus_id, s.type
      into linked_genus_id, linked_type
      from public.species s
      where s.id = new.species_id
      for share;

    if found then
      new.genus_id := linked_genus_id;
      new.type := linked_type::text::public.plant_type;
    end if;
    -- También si la especie no existe: así la restricción de coherencia no salta antes y la
    -- fila la rechaza la clave foránea, con su propio error (23503), que es el que describe
    -- el problema.
    new.validation := 'validated';
  elsif tg_op = 'UPDATE' and old.species_id is not null and new.validation = 'validated' then
    -- Se desenlazó sin indicar otra validación: vuelve a "nombre por validar". Género y tipo
    -- se conservan. Una planta sin especie que se intente insertar o dejar como "validated"
    -- por otro camino la rechaza la restricción plants_validated_iff_species.
    new.validation := 'pending';
  end if;

  return new;
end;
$$;

comment on function private.sync_plant_with_species() is
  'Disparador: copia a la planta el género y el tipo de su especie y ajusta la validación.';

create trigger sync_with_species
  before insert or update of species_id, genus_id, type, validation on public.plants
  for each row execute function private.sync_plant_with_species();

-- Especie: propagar género y tipo a sus plantas -----------------------------------------

create or replace function private.propagate_species_to_plants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Solo toca plantas, nunca especies, así que no hay recursión: el disparador de las
  -- plantas vuelve a leer la especie (ya actualizada) y llega a los mismos valores. Como
  -- "security definer", funciona aunque quien edita la especie no tenga permiso sobre
  -- las plantas de otros usuarios.
  update public.plants p
    set genus_id = new.genus_id,
        type = new.type::text::public.plant_type
    where p.species_id = new.id
      and (p.genus_id <> new.genus_id or p.type::text <> new.type::text);

  return null;
end;
$$;

comment on function private.propagate_species_to_plants() is
  'Disparador: propaga el género y el tipo de una especie a sus plantas enlazadas.';

create trigger propagate_to_plants
  after update of genus_id, type on public.species
  for each row
  when (old.genus_id is distinct from new.genus_id or old.type is distinct from new.type)
  execute function private.propagate_species_to_plants();

-- Nadie fuera del dueño ejecuta estas funciones (los disparadores no lo necesitan).
revoke all on function private.set_updated_at() from public;
revoke all on function private.sync_plant_with_species() from public;
revoke all on function private.propagate_species_to_plants() from public;

-- Por si ya hubiera plantas enlazadas con datos distintos de su especie, se alinean una vez.
update public.plants p
  set genus_id = s.genus_id,
      type = s.type::text::public.plant_type
  from public.species s
  where p.species_id = s.id
    and (p.genus_id <> s.genus_id or p.type::text <> s.type::text);
