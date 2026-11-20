-- Identidad de la petición: public.requesting_user_id() (issue #58).
--
-- Devuelve el claim sub del token de sesión de Clerk que llega en la petición, o null sin
-- sesión. Las peticiones de la API se reproducen con "set local role" y
-- "set local request.jwt.claims", como en acceso_por_rol.sql.

-- Datos de partida: un perfil y una planta de user_a.
insert into public.profiles (id) values ('user_a');
insert into public.plants (user_id, entered_name, genus_id, type)
values ('user_a', 'Mi planta', pruebas.genero('Vanda'), 'unknown');

-- prueba: sin token, devuelve null
set local role anon;
select pruebas.iguales('sin claims', public.requesting_user_id(), null::text);

-- prueba: con la clave publicable (anon, sin sub), devuelve null
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select pruebas.iguales('anon sin sub', public.requesting_user_id(), null::text);

-- prueba: con un sub vacío, devuelve null
set local role authenticated;
set local request.jwt.claims = '{"sub": "", "role": "authenticated"}';
select pruebas.iguales('sub vacío', public.requesting_user_id(), null::text);

-- prueba: con el token de sesión de Clerk, devuelve su sub
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_2abcDEF", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales('sub del token', public.requesting_user_id(), 'user_2abcDEF');

-- prueba: anon, authenticated y service_role pueden ejecutarla; PUBLIC no
select pruebas.iguales(
  'permiso de ejecución por rol',
  (select string_agg(r.rol || ':' || has_function_privilege(r.rol, 'public.requesting_user_id()', 'execute'), ', ' order by r.rol)
     from (values ('anon'), ('authenticated'), ('service_role')) r (rol)),
  'anon:true, authenticated:true, service_role:true'
);
select pruebas.iguales(
  'PUBLIC en los permisos de la función',
  (select count(*)
     from pg_proc p
     cross join lateral aclexplode(p.proacl) a
     where p.oid = 'public.requesting_user_id()'::regprocedure and a.grantee = 0),
  0::bigint
);

-- prueba: es stable, security invoker, con search_path vacío, devuelve texto y es de postgres
select pruebas.iguales(
  'propiedades de la función',
  (select p.provolatile::text || ' definer=' || p.prosecdef || ' ' || array_to_string(p.proconfig, ',')
          || ' ' || format_type(p.prorettype, null) || ' ' || pg_get_userbyid(p.proowner)
     from pg_proc p
     where p.oid = 'public.requesting_user_id()'::regprocedure),
  's definer=false search_path="" text postgres'
);

-- prueba: no abre ningún acceso nuevo a perfiles ni plantas
select pruebas.iguales(
  'privilegios de anon y authenticated sobre profiles y plants',
  (select string_agg(r.rol || ':' || t.tabla || ':' || has_table_privilege(r.rol, 'public.' || t.tabla, 'select,insert,update,delete,truncate'), ', ' order by r.rol, t.tabla)
     from (values ('anon'), ('authenticated')) r (rol)
     cross join (values ('plants'), ('profiles')) t (tabla)),
  'anon:plants:false, anon:profiles:false, authenticated:plants:false, authenticated:profiles:false'
);
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.iguales('el usuario de la petición es user_a', public.requesting_user_id(), 'user_a');
select pruebas.debe_fallar('user_a lee profiles', 'select * from public.profiles', '42501');
select pruebas.debe_fallar('user_a lee plants', 'select * from public.plants', '42501');
select pruebas.debe_fallar(
  'user_a lee sus plantas filtrando por la función',
  'select * from public.plants where user_id = public.requesting_user_id()',
  '42501'
);
