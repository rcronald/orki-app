-- Comprobaciones generales de seguridad sobre todo el esquema.
--
-- No nombran tablas ni funciones concretas: recorren el catálogo de Postgres, así que fallan
-- solas cuando una migración futura crea una tabla sin Row Level Security, concede escritura
-- a anon o deja una función sin proteger. Si una de ellas falla, el mensaje dice qué objeto.

-- prueba: ninguna tabla de public queda sin Row Level Security
select pruebas.iguales(
  'tablas de public sin RLS activada',
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), 'ninguna')
     from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p')
       and not c.relrowsecurity),
  'ninguna'
);

-- prueba: anon no tiene más privilegio que SELECT sobre ninguna tabla ni vista de public
-- Se leen los permisos concedidos directamente a anon y a PUBLIC (todos los roles).
select pruebas.iguales(
  'privilegios distintos de SELECT de anon o PUBLIC',
  (select coalesce(string_agg(distinct c.relname || ':' || a.privilege_type, ', '), 'ninguno')
     from pg_class c
     cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p', 'v', 'm', 'f')
       and a.grantee in (0, 'anon'::regrole)
       and a.privilege_type <> 'SELECT'),
  'ninguno'
);

-- prueba: ni anon ni authenticated pueden vaciar (TRUNCATE) tablas de public, porque truncate ignora RLS
select pruebas.iguales(
  'tablas que anon o authenticated pueden vaciar',
  (select coalesce(string_agg(r.rol || ':' || c.relname, ', ' order by r.rol, c.relname), 'ninguna')
     from pg_class c
     cross join (values ('anon'), ('authenticated')) r (rol)
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p')
       and has_table_privilege(r.rol, c.oid, 'TRUNCATE')),
  'ninguna'
);

-- prueba: ninguna función de private es ejecutable por anon ni authenticated, ni pueden usar el esquema
select pruebas.iguales(
  'funciones de private ejecutables por anon o authenticated',
  (select coalesce(string_agg(r.rol || ':' || p.proname, ', ' order by r.rol, p.proname), 'ninguna')
     from pg_proc p
     cross join (values ('anon'), ('authenticated')) r (rol)
     where p.pronamespace = 'private'::regnamespace
       and has_function_privilege(r.rol, p.oid, 'execute')),
  'ninguna'
);
select pruebas.comprobar(
  'anon y authenticated no tienen USAGE sobre el esquema private',
  not has_schema_privilege('anon', 'private', 'usage')
    and not has_schema_privilege('authenticated', 'private', 'usage')
);

-- prueba: las funciones security definer de public que expone la API siguen el patrón de administrador
-- Las funciones de public quedan expuestas en la API (/rest/v1/rpc); una security definer se
-- ejecuta con los permisos de su dueño y se salta RLS. anon no puede ejecutar ninguna, y
-- authenticated solo las de administrador: search_path vacío y, como primera sentencia, la
-- llamada a private.require_catalog_admin() (pruebas.funciones_definer_expuestas, en
-- tests/soporte/ayudantes.sql). Incluye rls_auto_enable(), que crea Supabase y que la
-- migración de avisos deja sin permiso para anon ni authenticated.
select pruebas.iguales(
  'funciones security definer de public expuestas sin el patrón de administrador',
  pruebas.funciones_definer_expuestas(),
  'ninguna'
);

-- prueba: toda función security definer de public y private fija su search_path
-- Sin search_path fijo, quien la llama podría hacer que resuelva nombres en otro esquema y
-- ejecutar código suyo con los permisos del dueño.
select pruebas.iguales(
  'funciones security definer sin search_path',
  (select coalesce(string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname), 'ninguna')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and p.prosecdef
       and not exists (select from unnest(p.proconfig) c where c like 'search_path=%')),
  'ninguna'
);
