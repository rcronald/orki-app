-- Patrón de las funciones de administrador que se saltan RLS (issue #65, parte de #6).
--
-- Una función de administrador vive en public (la API la expone en /rest/v1/rpc), es
-- security definer con search_path vacío, solo la ejecuta authenticated y su primera
-- sentencia es "perform private.require_catalog_admin();". El guardián lanza 42501 si la
-- petición no es de un administrador. La regla general de seguridad_general.sql
-- (pruebas.funciones_definer_expuestas()) rechaza las que no siguen el patrón.
--
-- Los ejemplos se crean aquí, dentro de la transacción de cada prueba, y desaparecen al
-- revertirla. La primera función de administrador real, public.is_pending_plant_photo(), se
-- prueba en fotos_storage.sql.

-- Datos de partida: una planta de user_a y otra de user_b. authenticated no puede leer
-- plants, así que contarlas todas solo es posible saltándose RLS.
insert into public.plants (user_id, entered_name, genus_id, type)
values
  ('user_a', 'Planta de A', pruebas.genero('Vanda'), 'unknown'),
  ('user_b', 'Planta de B', pruebas.genero('Cattleya'), 'unknown');

-- Función de ejemplo que sigue el patrón.
create function public.prueba_contar_plantas()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  total bigint;
begin
  perform private.require_catalog_admin();

  select count(*) into total from public.plants;
  return total;
end;
$$;

revoke all on function public.prueba_contar_plantas() from public, anon, authenticated, service_role;
grant execute on function public.prueba_contar_plantas() to authenticated;

-- prueba: el guardián deja pasar al administrador y lanza 42501 a los demás
-- Se llama como postgres, como lo haría una función security definer.
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.debe_funcionar('administrador', $$select private.require_catalog_admin()$$);
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.debe_fallar('usuario sin rol', $$select private.require_catalog_admin()$$, '42501');
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated", "app_role": "admin"}';
select pruebas.debe_fallar('otro valor de app_role', $$select private.require_catalog_admin()$$, '42501');
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated", "user_metadata": {"app_role": "catalog_admin"}}';
select pruebas.debe_fallar('rol en user_metadata', $$select private.require_catalog_admin()$$, '42501');
set local request.jwt.claims = '{"role": "service_role"}';
select pruebas.debe_fallar('clave de servicio', $$select private.require_catalog_admin()$$, '42501');
reset request.jwt.claims;
select pruebas.debe_fallar('sin token', $$select private.require_catalog_admin()$$, '42501');

-- prueba: nadie más que su dueño puede ejecutar el guardián
select pruebas.iguales(
  'permiso de ejecución del guardián',
  (select string_agg(r.rol || ':' || has_function_privilege(r.rol, 'private.require_catalog_admin()', 'execute'), ', ' order by r.rol)
     from (values ('anon'), ('authenticated'), ('postgres'), ('service_role')) r (rol)),
  'anon:false, authenticated:false, postgres:true, service_role:false'
);
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.debe_fallar('el administrador llama al guardián directamente', $$select private.require_catalog_admin()$$, '42501');

-- prueba: una función que sigue el patrón funciona para el administrador y se salta RLS
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales('plantas que cuenta el administrador', public.prueba_contar_plantas(), 2::bigint);

-- prueba: una función que sigue el patrón falla con 42501 para un usuario sin rol y para anon
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.debe_fallar('usuario sin rol', $$select public.prueba_contar_plantas()$$, '42501');
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated", "app_role": "CATALOG_ADMIN"}';
select pruebas.debe_fallar('app_role con otras mayúsculas', $$select public.prueba_contar_plantas()$$, '42501');
set local role anon;
set local request.jwt.claims = '{"role": "anon", "app_role": "catalog_admin"}';
select pruebas.debe_fallar('anon, aunque traiga app_role', $$select public.prueba_contar_plantas()$$, '42501');

-- prueba: la regla general acepta las funciones que siguen el patrón, en plpgsql y en sql
create function public.prueba_sql_conforme()
returns bigint
language sql
security definer
set search_path = ''
as $$
  -- Primero el guardián.
  select private.require_catalog_admin();
  select count(*) from public.plants;
$$;
revoke all on function public.prueba_sql_conforme() from public, anon, service_role;
grant execute on function public.prueba_sql_conforme() to authenticated;
select pruebas.iguales('funciones expuestas sin el patrón', pruebas.funciones_definer_expuestas(), 'ninguna');
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales('plantas que cuenta el administrador en sql', public.prueba_sql_conforme(), 2::bigint);
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.debe_fallar('usuario sin rol en sql', $$select public.prueba_sql_conforme()$$, '42501');

-- prueba: la regla general rechaza una función de administrador sin guardián
create function public.prueba_sin_guardian()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  return (select count(*) from public.plants);
end;
$$;
revoke all on function public.prueba_sin_guardian() from public, anon, service_role;
grant execute on function public.prueba_sin_guardian() to authenticated;
select pruebas.iguales(
  'funciones expuestas sin el patrón',
  pruebas.funciones_definer_expuestas(),
  'prueba_sin_guardian(): la puede ejecutar authenticated sin llamar primero a private.require_catalog_admin()'
);

-- prueba: la regla general rechaza el guardián que no es la primera sentencia
create function public.prueba_guardian_tarde()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  total bigint;
begin
  select count(*) into total from public.plants;
  perform private.require_catalog_admin();
  return total;
end;
$$;
revoke all on function public.prueba_guardian_tarde() from public, anon, service_role;
grant execute on function public.prueba_guardian_tarde() to authenticated;
select pruebas.iguales(
  'funciones expuestas sin el patrón',
  pruebas.funciones_definer_expuestas(),
  'prueba_guardian_tarde(): la puede ejecutar authenticated sin llamar primero a private.require_catalog_admin()'
);

-- prueba: la regla general rechaza valores iniciales en declare, que se calculan antes del guardián
create function public.prueba_declare_con_valor()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  total bigint := (select count(*) from public.plants);
begin
  perform private.require_catalog_admin();
  return total;
end;
$$;
revoke all on function public.prueba_declare_con_valor() from public, anon, service_role;
grant execute on function public.prueba_declare_con_valor() to authenticated;
select pruebas.iguales(
  'funciones expuestas sin el patrón',
  pruebas.funciones_definer_expuestas(),
  'prueba_declare_con_valor(): la puede ejecutar authenticated sin llamar primero a private.require_catalog_admin()'
);

-- prueba: la regla general no se deja engañar por el guardián dentro de un comentario
create function public.prueba_guardian_comentado()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- perform private.require_catalog_admin();
  /* perform private.require_catalog_admin(); */
  return (select count(*) from public.plants);
end;
$$;
revoke all on function public.prueba_guardian_comentado() from public, anon, service_role;
grant execute on function public.prueba_guardian_comentado() to authenticated;
select pruebas.iguales(
  'funciones expuestas sin el patrón',
  pruebas.funciones_definer_expuestas(),
  'prueba_guardian_comentado(): la puede ejecutar authenticated sin llamar primero a private.require_catalog_admin()'
);

-- prueba: la regla general rechaza una función de administrador sin search_path vacío
create function public.prueba_sin_search_path()
returns void
language plpgsql
security definer
as $$
begin
  perform private.require_catalog_admin();
end;
$$;
create function public.prueba_search_path_public()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform private.require_catalog_admin();
end;
$$;
revoke all on function public.prueba_sin_search_path(), public.prueba_search_path_public()
  from public, anon, service_role;
grant execute on function public.prueba_sin_search_path(), public.prueba_search_path_public()
  to authenticated;
select pruebas.iguales(
  'funciones expuestas sin el patrón',
  pruebas.funciones_definer_expuestas(),
  'prueba_search_path_public(): la puede ejecutar authenticated sin search_path vacío; '
    || 'prueba_sin_search_path(): la puede ejecutar authenticated sin search_path vacío'
);

-- prueba: la regla general rechaza una función security definer que puede ejecutar anon, aunque llame al guardián
-- Es lo que pasa si se olvida el revoke: Supabase concede por defecto la ejecución de toda
-- función nueva de public a anon, authenticated y service_role.
create function public.prueba_sin_revoke()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_catalog_admin();
end;
$$;
select pruebas.iguales(
  'funciones expuestas sin el patrón',
  pruebas.funciones_definer_expuestas(),
  'prueba_sin_revoke(): la puede ejecutar anon'
);

-- prueba: la regla general acepta una función security definer que solo ejecuta service_role
create function public.prueba_solo_servicio()
returns bigint
language sql
security definer
set search_path = ''
as $$
  select count(*) from public.plants;
$$;
revoke all on function public.prueba_solo_servicio() from public, anon, authenticated;
select pruebas.iguales('funciones expuestas sin el patrón', pruebas.funciones_definer_expuestas(), 'ninguna');

-- prueba: la regla general acepta una función de lectura pública del catálogo que solo lee el catálogo
-- Patrón del catálogo público (#231): sql con cuerpo estándar, stable, search_path vacío y
-- dependencias solo del catálogo, de normalize_search_text() y de search_species().
-- En estos archivos el "end;" de un cuerpo begin atomic va en la línea de la última sentencia:
-- el ejecutor de pruebas rechaza una línea que solo dice "end;" (la toma por el fin de la
-- transacción).
create function public.prueba_lectura_publica(objetivo uuid)
returns table (nombre text, sinonimos bigint, encontrada bigint)
language sql
stable
security definer
set search_path = ''
begin atomic
  select s.scientific_name,
    (select count(*) from public.species_names n where n.species_id = s.id),
    (select count(*) from public.search_species(s.scientific_name, 1))
  from public.species s
  join public.genera g on g.id = s.genus_id
  where s.id = prueba_lectura_publica.objetivo
    and public.normalize_search_text(g.name) <> ''; end;
revoke all on function public.prueba_lectura_publica(uuid) from public, service_role;
grant execute on function public.prueba_lectura_publica(uuid) to anon, authenticated;
select pruebas.iguales('funciones expuestas sin el patrón', pruebas.funciones_definer_expuestas(), 'ninguna');
select pruebas.iguales(
  'qué incumple la función conforme',
  coalesce(pruebas.incumple_lectura_publica('public.prueba_lectura_publica(uuid)'::regprocedure), 'nada'),
  'nada'
);

-- prueba: la regla general rechaza una función de lectura pública que lee plantas, perfiles u otra función
create function public.prueba_lectura_de_plantas()
returns bigint
language sql
stable
security definer
set search_path = ''
begin atomic
  select count(*) from public.species s
  where exists (select from public.plants p where p.species_id = s.id); end;
create function public.prueba_lectura_de_perfiles()
returns bigint
language sql
stable
security definer
set search_path = ''
begin atomic
  select count(*) from public.profiles; end;
create function public.prueba_lectura_con_funcion()
returns text
language sql
stable
security definer
set search_path = ''
begin atomic
  select public.requesting_user_id(); end;
revoke all on function public.prueba_lectura_de_plantas(), public.prueba_lectura_de_perfiles(),
  public.prueba_lectura_con_funcion() from public, service_role;
grant execute on function public.prueba_lectura_de_plantas(), public.prueba_lectura_de_perfiles(),
  public.prueba_lectura_con_funcion() to anon, authenticated;
select pruebas.iguales(
  'funciones expuestas sin el patrón',
  pruebas.funciones_definer_expuestas(),
  'prueba_lectura_con_funcion(): la puede ejecutar anon (depende de function requesting_user_id()); '
    || 'prueba_lectura_con_funcion(): la puede ejecutar authenticated sin llamar primero a private.require_catalog_admin(); '
    || 'prueba_lectura_de_perfiles(): la puede ejecutar anon (depende de table profiles); '
    || 'prueba_lectura_de_perfiles(): la puede ejecutar authenticated sin llamar primero a private.require_catalog_admin(); '
    || 'prueba_lectura_de_plantas(): la puede ejecutar anon (depende de table plants); '
    || 'prueba_lectura_de_plantas(): la puede ejecutar authenticated sin llamar primero a private.require_catalog_admin()'
);

-- prueba: la regla general rechaza una lectura pública en plpgsql, con el cuerpo como texto, volatile o sin search_path vacío
-- En plpgsql o con el cuerpo como texto (entre dólares) Postgres no registra lo que usa la
-- función, así que la regla no puede saber qué lee.
create function public.prueba_lectura_plpgsql()
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return (select count(*) from public.species); end;
$$;
create function public.prueba_lectura_entre_dolares()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) from public.species;
$$;
create function public.prueba_lectura_volatile()
returns bigint
language sql
volatile
security definer
set search_path = ''
begin atomic
  select count(*) from public.species; end;
create function public.prueba_lectura_sin_search_path()
returns bigint
language sql
stable
security definer
begin atomic
  select count(*) from public.species; end;
revoke all on function public.prueba_lectura_plpgsql(), public.prueba_lectura_entre_dolares(),
  public.prueba_lectura_volatile(), public.prueba_lectura_sin_search_path() from public, authenticated, service_role;
grant execute on function public.prueba_lectura_plpgsql(), public.prueba_lectura_entre_dolares(),
  public.prueba_lectura_volatile(), public.prueba_lectura_sin_search_path() to anon;
select pruebas.iguales(
  'funciones expuestas sin el patrón',
  pruebas.funciones_definer_expuestas(),
  'prueba_lectura_entre_dolares(): la puede ejecutar anon; '
    || 'prueba_lectura_plpgsql(): la puede ejecutar anon; '
    || 'prueba_lectura_sin_search_path(): la puede ejecutar anon (sin search_path vacío); '
    || 'prueba_lectura_volatile(): la puede ejecutar anon (es volatile)'
);
