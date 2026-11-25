-- Listas blancas de privilegios y privilegios por defecto cerrados (#283).
--
-- Desde la migración 20261125100000_privilegios_por_defecto_cerrados.sql, lo que postgres crea
-- en public nace sin privilegios para anon ni authenticated, y sus funciones nuevas no son
-- ejecutables por PUBLIC. Cada privilegio se concede a propósito en su migración y, en el mismo
-- pull request, se añade a la lista de este archivo. Estas pruebas fallan cuando alguien da a
-- anon, authenticated o PUBLIC algo que no está en la lista (o retira algo que sí está), y
-- cuando aparece una vista que lee con los permisos de su dueño.
--
-- Las listas se leen del catálogo de Postgres con las funciones de tests/soporte/ayudantes.sql
-- (pruebas.privilegios_de_relaciones, pruebas.privilegios_de_columnas,
-- pruebas.funciones_ejecutables y pruebas.vistas_sin_security_invoker). PUBLIC cuenta como un
-- rol más: lo que tiene lo tienen anon y authenticated.

-- prueba: lo que postgres crea en public nace sin privilegios para anon, authenticated ni PUBLIC
-- Se crean, como en una migración, una tabla, una vista sobre plants (la «v_fuga» del #283),
-- una secuencia, una función y un procedimiento sin ningún grant ni revoke.
create table public.prueba_tabla_nueva (id int primary key);
create view public.prueba_v_fuga as select user_id, entered_name from public.plants;
create sequence public.prueba_secuencia_nueva;
create function public.prueba_funcion_nueva() returns int language sql as 'select 1';
create procedure public.prueba_procedimiento_nuevo() language sql as 'select 1';
select pruebas.iguales(
  'privilegios de anon, authenticated o PUBLIC sobre los objetos nuevos',
  (select coalesce(string_agg(o.nombre || ':' || r.rol, ', ' order by o.nombre, r.rol), 'ninguno')
     from (values ('anon'), ('authenticated'), ('public')) r (rol)
     cross join (values
       ('prueba_tabla_nueva', 'public.prueba_tabla_nueva'::regclass::oid, 'r'),
       ('prueba_v_fuga', 'public.prueba_v_fuga'::regclass::oid, 'r'),
       ('prueba_secuencia_nueva', 'public.prueba_secuencia_nueva'::regclass::oid, 's'),
       ('prueba_funcion_nueva', 'public.prueba_funcion_nueva()'::regprocedure::oid, 'f'),
       ('prueba_procedimiento_nuevo', 'public.prueba_procedimiento_nuevo()'::regprocedure::oid, 'f')
     ) o (nombre, objeto, tipo)
     where (o.tipo <> 'f' and exists (
              select from pg_class c
              cross join lateral aclexplode(coalesce(c.relacl, acldefault(o.tipo::"char", c.relowner))) a
              where c.oid = o.objeto
                and a.grantee = case r.rol when 'public' then 0 else (select oid from pg_roles where rolname = r.rol) end))
        or (o.tipo = 'f' and exists (
              select from pg_proc p
              cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid = o.objeto
                and a.grantee = case r.rol when 'public' then 0 else (select oid from pg_roles where rolname = r.rol) end))),
  'ninguno'
);
set local role anon;
select pruebas.debe_fallar('anon lee la vista nueva', 'select * from public.prueba_v_fuga', '42501');
select pruebas.debe_fallar('anon ejecuta la función nueva', 'select public.prueba_funcion_nueva()', '42501');
select pruebas.debe_fallar('anon ejecuta el procedimiento nuevo', 'call public.prueba_procedimiento_nuevo()', '42501');
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.debe_fallar('authenticated lee la vista nueva', 'select * from public.prueba_v_fuga', '42501');
select pruebas.debe_fallar('authenticated ejecuta la función nueva', 'select public.prueba_funcion_nueva()', '42501');
select pruebas.debe_fallar('authenticated usa la secuencia nueva', $$select nextval('public.prueba_secuencia_nueva')$$, '42501');

-- prueba: los privilegios por defecto de postgres no conceden nada a anon, authenticated ni PUBLIC
-- La de funciones sin esquema es la que quita el EXECUTE de PUBLIC (el valor por defecto de
-- Postgres para todos los esquemas); service_role conserva lo suyo en public. Se comparan
-- los roles de cada entrada y no los privilegios exactos, que cambian con la versión (el 17
-- añade MAINTAIN).
select pruebas.iguales(
  'roles con privilegios por defecto de postgres',
  (select string_agg(e.linea, '; ' order by e.espacio, e.tipo)
     from (
       select d.defaclnamespace as espacio, d.defaclobjtype as tipo,
              case when d.defaclnamespace = 0 then '(todos)' else d.defaclnamespace::regnamespace::text end
                || ' ' || d.defaclobjtype::text || ' '
                || string_agg(distinct coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC'), ',') as linea
       from pg_default_acl d
       cross join lateral aclexplode(d.defaclacl) a
       where d.defaclrole = 'postgres'::regrole
       group by d.defaclnamespace, d.defaclobjtype
     ) e),
  '(todos) f postgres; public S service_role; public f service_role; public r service_role'
);

-- prueba: lista blanca de las funciones de public que anon puede ejecutar
-- Las cuatro del catálogo público (#231) y tres que no leen ninguna tabla. Una función nueva
-- para visitantes sin sesión se añade aquí en el mismo pull request.
select pruebas.iguales(
  'funciones de public ejecutables por anon',
  pruebas.funciones_ejecutables('anon'),
  'get_public_species(uuid), is_catalog_admin(), list_public_genera(integer,integer), '
    || 'list_public_genus_species(uuid,integer,integer), normalize_search_text(text), requesting_user_id(), '
    || 'search_public_species(text,integer)'
);

-- prueba: lista blanca de las funciones de public que authenticated puede ejecutar
-- Las security definer siguen además el patrón de seguridad_general.sql (guardián de
-- administrador o lectura pública del catálogo).
select pruebas.iguales(
  'funciones de public ejecutables por authenticated',
  pruebas.funciones_ejecutables('authenticated'),
  'add_genus_abbreviation(uuid,text), '
    || 'add_plant_log_entry(uuid,plant_log_entry_type,text,text,text,text,boolean,uuid), '
    || 'add_species_name(uuid,text,species_name_type,text), '
    || 'catalog_summary(), '
    || 'count_proposal_groups(), '
    || 'count_species_plants(uuid), '
    || 'create_catalog_genus(text,boolean), '
    || 'create_catalog_species(text,uuid,species_type,species_status), '
    || 'create_species_from_proposal(text,uuid,text,uuid,species_type), '
    || 'delete_catalog_genus(uuid), '
    || 'delete_catalog_species(uuid), '
    || 'delete_genus_abbreviation(uuid), '
    || 'delete_species_name(uuid), '
    || 'get_public_species(uuid), '
    || 'is_catalog_admin(), '
    || 'is_pending_plant_photo(text), '
    || 'link_proposal_group(text,uuid,uuid), '
    || 'list_catalog_genera(text,boolean,integer,integer), '
    || 'list_catalog_species(species_status,uuid,species_type,species_source,integer,uuid,uuid,boolean), '
    || 'list_plant_log_entries(uuid,plant_log_entry_type,timestamp with time zone,uuid,integer), '
    || 'list_proposal_groups(integer,integer), '
    || 'list_public_genera(integer,integer), '
    || 'list_public_genus_species(uuid,integer,integer), '
    || 'mark_proposal_unidentifiable(text,uuid), '
    || 'merge_species(uuid,uuid), '
    || 'normalize_search_text(text), '
    || 'photo_count(plants), '
    || 'preview_species_merge(uuid,uuid), '
    || 'record_product_events(jsonb), '
    || 'reorder_plant_photos(uuid,uuid[]), '
    || 'requesting_user_id(), '
    || 'retire_species_photo(uuid,text,text), '
    || 'search_catalog_species(text,species_status,uuid,species_type,species_source,integer,integer), '
    || 'search_genera(text,integer), '
    || 'search_public_species(text,integer), '
    || 'search_species(text,integer), '
    || 'set_catalog_species_status(uuid[],species_status), '
    || 'species_history(uuid,integer,bigint), '
    || 'update_catalog_genus(uuid,text,boolean), '
    || 'update_catalog_species(uuid,text,uuid,species_type,species_status), '
    || 'update_genus_abbreviation(uuid,text), '
    || 'update_species_name(uuid,text,species_name_type,text)'
);

-- prueba: lista de las funciones de public que no ejecutan ni anon ni authenticated
-- Las dos listas anteriores más esta cubren todas las funciones de public: una función nueva
-- que se queda sin ningún grant (nace cerrada desde el #283) también hace fallar las pruebas,
-- para que quien la escribe decida quién la ejecuta y la apunte en su lista. Hoy
-- purge_expired_product_events(), solo para service_role (el workflow «Retención de eventos»,
-- #293), y rls_auto_enable(), que crea Supabase y que nadie llama por la API.
select pruebas.iguales(
  'funciones de public que no ejecutan ni anon ni authenticated',
  (select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text collate "C"), 'ninguna')
     from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and not has_function_privilege('anon', p.oid, 'execute')
       and not has_function_privilege('authenticated', p.oid, 'execute')),
  'purge_expired_product_events(), rls_auto_enable()'
);

-- prueba: lista blanca de los privilegios de tabla de anon, authenticated y PUBLIC en public
-- anon y PUBLIC no tienen ninguno (desde el #231, anon no lee ninguna tabla). La escritura del
-- catálogo la limitan las políticas a los administradores, y la auditoría, la memoria de las
-- fusiones y la de las fotos retiradas solo las leen ellos.
select pruebas.iguales(
  'privilegios de tabla de anon, authenticated y PUBLIC',
  pruebas.privilegios_de_relaciones(),
  'catalog_audit_log authenticated SELECT; '
    || 'genera authenticated DELETE,INSERT,SELECT,UPDATE; '
    || 'genus_abbreviations authenticated DELETE,INSERT,SELECT,UPDATE; '
    || 'plant_log_entries authenticated DELETE,SELECT; '
    || 'plant_photos authenticated DELETE,SELECT; '
    || 'plants authenticated DELETE,SELECT; '
    || 'profiles authenticated DELETE,INSERT,SELECT,UPDATE; '
    || 'species authenticated DELETE,INSERT,SELECT,UPDATE; '
    || 'species_merge_keys authenticated SELECT; '
    || 'species_names authenticated DELETE,INSERT,SELECT,UPDATE; '
    || 'species_photo_rejections authenticated SELECT; '
    || 'species_photos authenticated SELECT'
);

-- prueba: lista blanca de los privilegios por columna de anon, authenticated y PUBLIC en public
-- Solo authenticated, y solo las columnas que la app escribe; las que pone la base (validation
-- y el identificador de plants, created_at de plant_photos, user_id de product_events...)
-- quedan fuera.
select pruebas.iguales(
  'privilegios por columna de anon, authenticated y PUBLIC',
  pruebas.privilegios_de_columnas(),
  'plant_log_entries authenticated INSERT(description, id, idempotency_key, in_bloom, photo_path, plant_id, '
    || 'thumbnail_path, title, type, user_id); '
    || 'plant_photos authenticated INSERT(id, in_bloom, note, photo_path, plant_id, position, taken_at, thumbnail_path, '
    || 'user_id); '
    || 'plant_photos authenticated UPDATE(in_bloom, note, photo_path, position, taken_at, thumbnail_path); '
    || 'plants authenticated INSERT(acquired_on, created_at, entered_name, flower_color, genus_id, id, location, '
    || 'nickname, notes, origin, photo_in_bloom, photo_path, species_id, status, thumbnail_path, type, updated_at, '
    || 'user_id); '
    || 'plants authenticated UPDATE(acquired_on, created_at, entered_name, flower_color, genus_id, id, location, '
    || 'nickname, notes, origin, photo_in_bloom, photo_path, species_id, status, thumbnail_path, type, updated_at, '
    || 'user_id); '
    || 'product_events authenticated INSERT(duration_ms, generated_offline, has_photo, id, name_pending, occurred_at, '
    || 'result, type)'
);

-- prueba: toda vista de public tiene security_invoker = true
-- Hoy no hay ninguna. Una vista sin esa opción lee las tablas como su dueño, sin RLS: con un
-- grant de select, anon o authenticated leerían las filas de todos. Las vistas materializadas
-- no admiten la opción, así que no se permiten en public.
select pruebas.iguales('vistas de public sin security_invoker', pruebas.vistas_sin_security_invoker(), 'ninguna');

-- prueba: las listas blancas detectan una vista sin security_invoker, un grant nuevo y una función abierta
-- Comprueba las funciones de las pruebas anteriores con los objetos que deben detectar.
create view public.prueba_v_fuga as select user_id, entered_name from public.plants;
grant select on public.prueba_v_fuga to anon;
create function public.prueba_funcion_abierta() returns int language sql as 'select 1';
grant execute on function public.prueba_funcion_abierta() to public;
grant insert (nickname) on public.plants to anon;
select pruebas.comprobar(
  'vista sin security_invoker detectada',
  pruebas.vistas_sin_security_invoker() like '%prueba_v_fuga%'
);
select pruebas.comprobar(
  'grant de select a anon detectado',
  pruebas.privilegios_de_relaciones() like '%prueba_v_fuga anon SELECT%'
);
select pruebas.comprobar(
  'función abierta a PUBLIC detectada para anon y authenticated',
  pruebas.funciones_ejecutables('anon') like '%prueba_funcion_abierta()%'
    and pruebas.funciones_ejecutables('authenticated') like '%prueba_funcion_abierta()%'
);
select pruebas.comprobar(
  'privilegio de columna para anon detectado',
  pruebas.privilegios_de_columnas() like '%plants anon INSERT(nickname)%'
);
-- Con security_invoker (Postgres 15 o posterior) la vista deja de contar y lee con los permisos
-- de quien la consulta: anon, sin privilegio sobre plants, no lee nada.
do $$
begin
  if current_setting('server_version_num')::int >= 150000 then
    execute 'alter view public.prueba_v_fuga set (security_invoker = true)';
  end if;
end;
$$;
select pruebas.comprobar(
  'vista con security_invoker',
  (pruebas.vistas_sin_security_invoker() like '%prueba_v_fuga%')
    = (current_setting('server_version_num')::int < 150000)
);
set local role anon;
do $$
begin
  if current_setting('server_version_num')::int >= 150000 then
    perform pruebas.debe_fallar('anon lee plants por la vista con security_invoker', 'select * from public.prueba_v_fuga', '42501');
  end if;
end;
$$;
