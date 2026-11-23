-- Lo mínimo de Supabase que necesitan las migraciones de Orki, para prepararlas en una base de
-- datos Postgres vacía y desechable (pruebas de base de datos y, más adelante, generación de
-- tipos). No es una copia de Supabase: solo simula lo que las migraciones usan o lo que
-- cambia el resultado de las pruebas de acceso.
--
-- Se ejecuta como superusuario en la base recién creada, antes de las migraciones, que después
-- se aplican con el rol "postgres", como hace la CLI de Supabase. Es idempotente: si los roles
-- ya existen en el servidor, no los toca.
--
-- Qué simula:
--   - Los roles de la API: anon (sin sesión), authenticated (con sesión) y service_role (clave
--     de servicio, ignora RLS). Y "postgres", dueño de los objetos de las migraciones, que en
--     Supabase no es superusuario.
--   - El esquema "extensions", donde las migraciones instalan las extensiones.
--   - El esquema "auth" con auth.jwt(), que devuelve las claims del token de la petición. En
--     Supabase, PostgREST guarda esas claims en el parámetro request.jwt.claims de la
--     transacción; aquí las pruebas lo fijan con "set local request.jwt.claims".
--   - La función public.rls_auto_enable(), que Supabase crea en los proyectos con la opción
--     de activar Row Level Security en toda tabla nueva. Nace ejecutable por todos los roles;
--     las migraciones le retiran ese permiso y las pruebas lo comprueban. No se simula el
--     disparador de eventos que la usa: las migraciones activan RLS de forma explícita.
--   - Los privilegios por defecto que Supabase concede sobre lo que se crea en "public" (todo
--     a anon, authenticated y service_role). Es el peor caso: la migración
--     20261125100000_privilegios_por_defecto_cerrados.sql (#283) los retira para anon y
--     authenticated, y supabase/tests/listas_blancas.sql comprueba que lo hace.
--   - Lo mínimo del esquema "storage" (Supabase Storage): las tablas storage.buckets y
--     storage.objects, storage.foldername(), el bloqueo de borrados directos y los permisos de
--     los roles. Ver la sección "Esquema storage" al final.

-- Roles ---------------------------------------------------------------------------------

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  -- En Supabase, "postgres" puede iniciar sesión; aquí no hace falta, porque las migraciones
  -- se aplican con "set role postgres" desde la sesión del superusuario.
  if not exists (select from pg_roles where rolname = 'postgres') then
    create role postgres nologin createrole bypassrls;
  end if;
end;
$$;

grant anon, authenticated, service_role to postgres;

-- Base de datos y esquema public --------------------------------------------------------

-- Para crear esquemas (private) e instalar extensiones de confianza (pg_trgm, unaccent).
do $$
begin
  execute format('grant create, temporary on database %I to postgres', current_database());
end;
$$;

alter schema public owner to postgres;
grant usage on schema public to anon, authenticated, service_role;

-- Privilegios por defecto de Supabase sobre lo que "postgres" crea en public.
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to anon, authenticated, service_role;

-- Esquema extensions --------------------------------------------------------------------

create schema if not exists extensions;
grant usage, create on schema extensions to postgres;
grant usage on schema extensions to anon, authenticated, service_role;

-- Esquema auth y auth.jwt() -------------------------------------------------------------

create schema if not exists auth;
grant usage on schema auth to postgres, anon, authenticated, service_role;

-- Misma definición que en Supabase: lee las claims del token que PostgREST deja en la
-- transacción (request.jwt.claim es el nombre antiguo del parámetro).
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

grant execute on function auth.jwt() to postgres, anon, authenticated, service_role;

-- public.rls_auto_enable() --------------------------------------------------------------

-- Misma firma, dueño y permisos que en un proyecto de Supabase con la opción de activar Row
-- Level Security en las tablas nuevas. El cuerpo no importa: nada la llama aquí.
create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
begin
  null;
end;
$$;

alter function public.rls_auto_enable() owner to postgres;
grant execute on function public.rls_auto_enable() to public, anon, authenticated, service_role;

-- Esquema storage -----------------------------------------------------------------------
--
-- Referencia: las migraciones de tenant de supabase/storage (rama master, consultadas el 21
-- de noviembre de 2026, hasta la 0080), en particular 0002 (esquema, tablas, foldername, dueño
-- supabase_storage_admin), 0003 (path_tokens), 0007 (RLS en buckets), 0008 (public), 0013 y
-- 0014 (file_size_limit en bytes y allowed_mime_types), 0016 (version), 0018 (owner_id),
-- 0025 (user_metadata), 0038 (type), 0046 y 0049 (permisos), 0055 (bloqueo de borrados
-- directos), 0060 (foldername immutable) y 0073 (retirada de truncate, references, trigger y
-- maintain a anon y authenticated). Y la documentación de Supabase Storage
-- (https://supabase.com/docs/guides/storage/security/access-control).
--
-- Qué se simula:
--   - El rol supabase_storage_admin, dueño del esquema y de sus tablas y funciones.
--   - storage.buckets y storage.objects con las columnas que usan las migraciones y las
--     pruebas, con sus tipos y valores por defecto reales, RLS activada en las dos y sin
--     ninguna política (las pone cada proyecto).
--   - storage.foldername(), con la misma definición que la 0060.
--   - storage.protect_delete() y sus disparadores (0055): un "delete" directo en las tablas
--     falla con 42501 salvo que la transacción fije storage.allow_delete_query = 'true', como
--     hace la API de Storage al borrar. Las pruebas de borrado lo fijan.
--   - Los permisos: usage sobre el esquema y "all" sobre las dos tablas para anon,
--     authenticated y service_role (menos truncate, references, trigger y maintain para anon y
--     authenticated), y "all ... with grant option" para postgres.
--
-- Diferencia deliberada: en Supabase, postgres crea políticas en storage.objects sin ser su
-- dueño gracias a supautils.policy_grants, que solo le deja crear, cambiar y borrar políticas
-- (supabase/postgres, ansible/files/postgresql_config/supautils.conf.j2). Aquí no hay
-- supautils, así que postgres es miembro de supabase_storage_admin, lo que además le dejaría
-- alterar las tablas: una migración que altere storage pasaría aquí y fallaría en Supabase
-- ("must be owner of table objects"). Las migraciones no deben alterar tablas de storage.
--
-- Qué no se simula: la API de Storage (subida, límites de tamaño y de tipo, URL firmadas,
-- upsert), las funciones de búsqueda y listado (storage.search, list_objects_with_delimiter...),
-- storage.operation() y sus ayudantes, el versionado de objetos y sus índices, prefixes,
-- s3_multipart_uploads, los buckets analíticos y vectoriales y los demás disparadores. El
-- índice único es el de la época sin versiones, (bucket_id, name), en lugar del parcial
-- idx_objects_current_version.

do $$
begin
  if not exists (select from pg_roles where rolname = 'supabase_storage_admin') then
    create role supabase_storage_admin nologin noinherit createrole;
  end if;
end;
$$;

grant supabase_storage_admin to postgres;

create schema if not exists storage authorization supabase_storage_admin;
grant usage on schema storage to postgres, anon, authenticated, service_role;

set role supabase_storage_admin;

do $$
begin
  if not exists (select from pg_type where typname = 'buckettype' and typnamespace = 'storage'::regnamespace) then
    create type storage.buckettype as enum ('STANDARD', 'ANALYTICS', 'VECTOR');
  end if;
end;
$$;

create table if not exists storage.buckets (
  id text not null primary key,
  name text not null,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  public boolean default false,
  avif_autodetection boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  owner_id text,
  type storage.buckettype not null default 'STANDARD'
);
create unique index if not exists bname on storage.buckets using btree (name);

create table if not exists storage.objects (
  id uuid not null default gen_random_uuid() primary key,
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text,
  owner_id text,
  user_metadata jsonb
);
create unique index if not exists bucketid_objname on storage.objects using btree (bucket_id, name);
create index if not exists name_prefix_search on storage.objects (name text_pattern_ops);

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

comment on column storage.objects.owner is 'Field is deprecated, use owner_id instead';
comment on column storage.buckets.owner is 'Field is deprecated, use owner_id instead';

create or replace function storage.foldername(name text)
returns text[]
language plpgsql
immutable
as $function$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1 : array_length(_parts, 1) - 1];
end
$function$;

create or replace function storage.protect_delete()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('storage.allow_delete_query', true), 'false') != 'true' then
    raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
      using hint = 'This prevents accidental data loss from orphaned objects.',
            errcode = '42501';
  end if;
  return null;
end;
$$;

drop trigger if exists protect_buckets_delete on storage.buckets;
create trigger protect_buckets_delete
  before delete on storage.buckets
  for each statement
  execute function storage.protect_delete();

drop trigger if exists protect_objects_delete on storage.objects;
create trigger protect_objects_delete
  before delete on storage.objects
  for each statement
  execute function storage.protect_delete();

grant all on storage.buckets, storage.objects to postgres with grant option;
grant all on storage.buckets, storage.objects to service_role, authenticated, anon;
revoke truncate, references, trigger on storage.buckets, storage.objects from anon, authenticated;
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on storage.buckets, storage.objects from anon, authenticated';
  end if;
end;
$$;
-- Supabase concede por defecto "all" sobre las funciones nuevas de storage a todos los roles
-- de la API (0002); foldername ya es ejecutable por PUBLIC.

reset role;
