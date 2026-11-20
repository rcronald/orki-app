-- Id del usuario que hace la petición, tal como lo ve Postgres (issue #58).
--
-- Es el claim "sub" del token de sesión de Clerk que el cliente de Supabase envía en cada
-- petición y que Supabase valida (integración de terceros con Clerk). Es texto, el id de Clerk
-- (user_...). Sin sesión, la petición llega con la clave publicable, sin "sub", y la función
-- devuelve null.
--
-- Para qué sirve:
--   - Comprobar la integración de extremo a extremo: el panel de diagnóstico de la app (solo
--     fuera de producción) la llama por la API (/rest/v1/rpc/requesting_user_id) y compara el
--     resultado con el id que muestra Clerk.
--   - Ser la única forma de leer el usuario en las políticas RLS de perfiles y plantas del
--     issue #6, por ejemplo:
--         using (user_id = (select public.requesting_user_id()))
--     El "(select ...)" hace que Postgres la evalúe una vez por consulta y no una por fila.
--
-- Seguridad:
--   - security invoker: se ejecuta con los permisos de quien la llama y solo lee el token de
--     su propia petición (auth.jwt()). No toca ninguna tabla, así que no da acceso a nada.
--   - stable: dentro de una consulta el token no cambia.
--   - search_path vacío y nombres completos: no depende del search_path de quien la llama.
--   - Ejecutable por anon y authenticated (la API la expone) y por service_role; se retira
--     el permiso a PUBLIC, que Postgres concede por defecto a toda función nueva.

create function public.requesting_user_id()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select nullif(auth.jwt() ->> 'sub', '')
$$;

comment on function public.requesting_user_id() is
  'Id de usuario de Clerk (claim sub del token de sesión) de la petición; null sin sesión.';

revoke all on function public.requesting_user_id() from public;
grant execute on function public.requesting_user_id() to anon, authenticated, service_role;
