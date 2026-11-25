-- Plazo de conservación de los eventos de producto: 13 meses (#293, parte de #277).
--
-- Qué crea:
--   public.purge_expired_product_events(), que borra los eventos de producto de más de 13
--   meses y devuelve cuántos borró. La llama cada día el workflow «Retención de eventos»
--   (.github/workflows/retencion-de-eventos.yml) con la clave secreta del proyecto
--   (service_role), por la API: POST /rest/v1/rpc/purge_expired_product_events.
--
-- Por qué así
-- -----------
-- El plazo vive en la base, no en el workflow: quien la llame no elige qué se borra, solo
-- cuándo. 13 meses dejan comparar un mes con el mismo mes del año anterior en los indicadores
-- (docs/indicadores-de-eventos.sql) y nada más.
--
-- No se usa pg_cron: ninguna migración lo activa, el Postgres de las pruebas (la imagen
-- oficial postgres:17) no lo trae y activarlo en el proyecto real es un cambio de
-- configuración que no se puede probar aquí. Si algún día se activa (Integrations > Cron en
-- el panel de Supabase), basta con programar la misma función:
--   select cron.schedule('retencion-de-eventos', '17 4 * * *',
--                        'select public.purge_expired_product_events()');
-- y desactivar el workflow. Ver docs/operacion/retencion-y-limpieza.md.
--
-- Qué fecha cuenta: occurred_at, cuándo ocurrió el evento según el dispositivo. La base ya
-- exige que esté entre 30 días antes y 1 hora después de received_at, así que un reloj mal
-- puesto no puede adelantar ni retrasar el borrado más que eso.
--
-- Compatibilidad: solo añade una función que la app no llama; no toca la tabla ni sus
-- permisos. Los eventos de más de 13 meses se borran en la primera ejecución del workflow
-- después de aplicar esta migración, no al aplicarla.
--
-- Quién puede ejecutarla: service_role (el workflow) y postgres (su dueño, desde el editor
-- SQL). anon y authenticated no: un usuario no decide cuándo se borran los eventos de todos.
-- security invoker: borra con los permisos de quien llama; service_role ya tiene select y
-- delete sobre product_events y se salta RLS (20261121170000_eventos_de_producto.sql).

create function public.purge_expired_product_events()
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  deleted integer;
begin
  delete from public.product_events
    where occurred_at < pg_catalog.now() - interval '13 months';
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

comment on function public.purge_expired_product_events() is
  'Borra los eventos de producto de más de 13 meses (por occurred_at) y devuelve cuántos borró. Solo para service_role (workflow «Retención de eventos»).';

revoke all on function public.purge_expired_product_events() from public, anon, authenticated, service_role;
grant execute on function public.purge_expired_product_events() to service_role;
