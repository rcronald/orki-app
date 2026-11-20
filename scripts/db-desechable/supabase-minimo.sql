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
--     a anon, authenticated y service_role). Es el peor caso: las migraciones deben retirarlos
--     de forma explícita, y las pruebas comprueban que lo hacen.

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
