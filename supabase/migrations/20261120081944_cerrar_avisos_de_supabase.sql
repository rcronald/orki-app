-- Cierra dos avisos de los asesores de Supabase tras aplicar el esquema (issue #52).

-- Índice para la clave foránea plants.genus_id. Los demás índices de plants empiezan por
-- user_id o son de species_id, así que ninguno sirve a la comprobación de la clave foránea
-- al borrar un género, ni a "las plantas de un género" sin importar el usuario.
create index plants_genus_id_idx on public.plants (genus_id);

-- public.rls_auto_enable() no es de Orki: la crea Supabase en los proyectos que tienen
-- activada la opción de poner Row Level Security a toda tabla nueva de public, junto con el
-- disparador de eventos "ensure_rls". Es security definer y nace ejecutable por todos los
-- roles, así que queda expuesta en la API como /rest/v1/rpc/rls_auto_enable. No se puede
-- invocar así (devuelve event_trigger), pero no hay motivo para que anon y authenticated
-- tengan el permiso. El disparador de eventos sigue funcionando: Postgres no comprueba el
-- permiso de ejecución al dispararlo.
--
-- Es condicional porque la función no existe en todos los proyectos (depende de esa opción).
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;
