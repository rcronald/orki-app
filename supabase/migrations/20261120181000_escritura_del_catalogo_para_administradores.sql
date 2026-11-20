-- Escritura del catálogo para administradores y guardián de las funciones de administrador
-- (issue #65, parte de #6).
--
-- El rol de la app viaja en el claim "app_role" del token de sesión de Clerk, con el valor
-- "catalog_admin". Sale de user.public_metadata.role, que solo se cambia desde el panel o el
-- backend de Clerk (con la clave secreta), así que el usuario no puede ponérselo. No es el
-- claim "role": ese lo reserva Supabase para elegir el rol de Postgres y vale "authenticated".
-- No hay ninguna columna de rol en la base de datos: el rol solo vive en Clerk.
--
-- Esta migración:
--   1. Crea public.is_catalog_admin(), que dice si la petición es de un administrador.
--   2. Concede a authenticated insertar, editar y borrar en las cuatro tablas del catálogo, con
--      políticas RLS que solo dejan hacerlo a un administrador. La lectura pública no cambia y
--      anon sigue sin poder escribir.
--   3. Crea private.require_catalog_admin(), el guardián que llaman primero las funciones de
--      administrador que necesitan saltarse RLS (fusión #21, cola #22, auditoría #23). El
--      patrón completo está en supabase/README.md, "Funciones de administrador".
--
-- Las tablas del catálogo usan claves uuid con gen_random_uuid() (sin secuencias, así que no
-- hace falta permiso sobre ninguna) y sus disparadores no necesitan permisos de quien escribe:
-- set_updated_at solo toca la fila nueva, y propagate_species_to_plants es security definer,
-- así que al cambiar el género o el tipo de una especie actualiza también las plantas de otros
-- usuarios, que el administrador no puede ver.

-- ¿Es administrador del catálogo? ---------------------------------------------------------
--
-- Verdadero solo si el claim de primer nivel app_role es exactamente "catalog_admin" (texto,
-- con esas mayúsculas y sin espacios). Falso sin sesión, sin el claim, con otro valor o con el
-- rol puesto en otro claim (user_metadata, unsafe_metadata, public_metadata anidado...). Nunca
-- devuelve null, para que se pueda usar tal cual en un "if not".
--
-- Seguridad, igual que public.requesting_user_id():
--   - security invoker: solo lee el token de su propia petición; no toca ninguna tabla.
--   - stable: dentro de una consulta el token no cambia. En las políticas se escribe
--     "(select public.is_catalog_admin())" para que Postgres la evalúe una vez por consulta.
--   - search_path vacío y nombres completos.
--   - Ejecutable por anon, authenticated y service_role (la API la expone en
--     /rest/v1/rpc/is_catalog_admin); se retira el permiso a PUBLIC.

create function public.is_catalog_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'app_role' = 'catalog_admin', false)
$$;

comment on function public.is_catalog_admin() is
  'Si la petición es de un administrador del catálogo (claim app_role = catalog_admin del token de sesión).';

revoke all on function public.is_catalog_admin() from public;
grant execute on function public.is_catalog_admin() to anon, authenticated, service_role;

-- Escritura del catálogo -----------------------------------------------------------------
--
-- authenticated recibe insert, update y delete (no truncate, que ignora RLS). Las políticas
-- son una por orden y solo para authenticated, para que no se solapen con la de lectura (el
-- asesor de Supabase avisa de varias políticas permisivas para el mismo rol y la misma orden).
-- Un usuario sin rol no puede insertar (error 42501) y sus update y delete no afectan a
-- ninguna fila. anon no recibe ningún permiso nuevo.

grant insert, update, delete
  on table public.genera, public.genus_abbreviations, public.species, public.species_names
  to authenticated;

create policy genera_insert_catalog_admin on public.genera
  for insert to authenticated
  with check ((select public.is_catalog_admin()));

create policy genera_update_catalog_admin on public.genera
  for update to authenticated
  using ((select public.is_catalog_admin()))
  with check ((select public.is_catalog_admin()));

create policy genera_delete_catalog_admin on public.genera
  for delete to authenticated
  using ((select public.is_catalog_admin()));

create policy genus_abbreviations_insert_catalog_admin on public.genus_abbreviations
  for insert to authenticated
  with check ((select public.is_catalog_admin()));

create policy genus_abbreviations_update_catalog_admin on public.genus_abbreviations
  for update to authenticated
  using ((select public.is_catalog_admin()))
  with check ((select public.is_catalog_admin()));

create policy genus_abbreviations_delete_catalog_admin on public.genus_abbreviations
  for delete to authenticated
  using ((select public.is_catalog_admin()));

create policy species_insert_catalog_admin on public.species
  for insert to authenticated
  with check ((select public.is_catalog_admin()));

create policy species_update_catalog_admin on public.species
  for update to authenticated
  using ((select public.is_catalog_admin()))
  with check ((select public.is_catalog_admin()));

create policy species_delete_catalog_admin on public.species
  for delete to authenticated
  using ((select public.is_catalog_admin()));

create policy species_names_insert_catalog_admin on public.species_names
  for insert to authenticated
  with check ((select public.is_catalog_admin()));

create policy species_names_update_catalog_admin on public.species_names
  for update to authenticated
  using ((select public.is_catalog_admin()))
  with check ((select public.is_catalog_admin()));

create policy species_names_delete_catalog_admin on public.species_names
  for delete to authenticated
  using ((select public.is_catalog_admin()));

-- Guardián de las funciones de administrador ----------------------------------------------
--
-- Una función de administrador que necesita saltarse RLS es security definer (se ejecuta como
-- su dueño, postgres) y vive en public para que la API la exponga. Su primera sentencia es
-- "perform private.require_catalog_admin();", que lanza el error 42501 (permiso denegado) si
-- quien llama no es administrador. La regla general de supabase/tests/seguridad_general.sql
-- rechaza cualquier función security definer de public que authenticated pueda ejecutar sin
-- empezar así.
--
-- Vive en private (la API no lo expone) y solo lo ejecuta su dueño: lo llaman funciones
-- security definer, que corren como postgres. Es security invoker porque no necesita más
-- permisos que los de esa función; lee el token con public.is_catalog_admin(), así que la
-- comprobación del rol está en un único sitio. Es volatile (por defecto) para que Postgres
-- nunca omita ni reutilice la llamada.

create function private.require_catalog_admin()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.is_catalog_admin() then
    raise exception 'Solo un administrador del catálogo puede hacer esto.'
      using errcode = '42501',
            hint = 'El rol se asigna en Clerk (public_metadata.role = catalog_admin) y llega en el claim app_role del token.';
  end if;
end;
$$;

comment on function private.require_catalog_admin() is
  'Guardián de las funciones de administrador: error 42501 si la petición no es de un administrador del catálogo.';

revoke all on function private.require_catalog_admin() from public;
