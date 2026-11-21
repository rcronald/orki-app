-- Escritura del catálogo para administradores (issue #65, parte de #6).
--
-- Las cuatro tablas del catálogo se leen sin sesión y solo las escribe, desde la API, quien
-- trae en el token el claim de primer nivel app_role = "catalog_admin" (public.is_catalog_admin()).
-- Las peticiones se reproducen con "set local role" y "set local request.jwt.claims", como en
-- acceso_por_rol.sql. Un usuario sin rol no puede insertar (42501) y sus update y delete no
-- afectan a ninguna fila: RLS las filtra sin dar error.

-- Datos de partida: una especie con un nombre, y el perfil y una planta enlazada de user_a.
insert into public.species (scientific_name, genus_id, type, status, source)
values ('Cattleya labiata', pruebas.genero('Cattleya'), 'species', 'validated', 'curated');
insert into public.species_names (species_id, name, type)
values (pruebas.especie('Cattleya labiata'), 'Flor de mayo', 'common');
insert into public.profiles (id) values ('user_a');
insert into public.plants (user_id, entered_name, species_id)
values ('user_a', 'Mi labiata', pruebas.especie('Cattleya labiata'));

-- prueba: sin sesión, el catálogo se sigue leyendo
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select pruebas.iguales(
  'filas visibles de genera, genus_abbreviations, species y species_names',
  (select row((select count(*) from public.genera), (select count(*) from public.genus_abbreviations),
              (select count(*) from public.species), (select count(*) from public.species_names))::text),
  '(5,5,1,1)'
);
select pruebas.iguales('is_catalog_admin() sin sesión', public.is_catalog_admin(), false);
reset request.jwt.claims;
select pruebas.iguales('is_catalog_admin() sin claims', public.is_catalog_admin(), false);

-- prueba: anon no puede insertar, editar ni borrar en el catálogo, ni con app_role en el token
do $$
declare
  claims text;
  tabla text;
begin
  set local role anon;
  foreach claims in array array[
    '{"role": "anon"}',
    '{"role": "anon", "app_role": "catalog_admin"}'
  ] loop
    perform set_config('request.jwt.claims', claims, true);
    perform pruebas.debe_fallar('anon inserta un género ' || claims,
      $q$insert into public.genera (name) values ('Masdevallia')$q$, '42501');
    perform pruebas.debe_fallar('anon inserta una abreviatura ' || claims,
      $q$insert into public.genus_abbreviations (genus_id, abbreviation) values (pruebas.genero('Vanda'), 'Vd.')$q$, '42501');
    perform pruebas.debe_fallar('anon inserta una especie ' || claims,
      $q$insert into public.species (scientific_name, genus_id, type, status, source)
         values ('Vanda coerulea', pruebas.genero('Vanda'), 'species', 'validated', 'curated')$q$, '42501');
    perform pruebas.debe_fallar('anon inserta un nombre ' || claims,
      $q$insert into public.species_names (species_id, name, type)
         values (pruebas.especie('Cattleya labiata'), 'Catleya', 'common')$q$, '42501');
    foreach tabla in array array['genera', 'genus_abbreviations', 'species', 'species_names'] loop
      perform pruebas.debe_fallar(format('anon edita %s %s', tabla, claims),
        format('update public.%I set updated_at = now()', tabla), '42501');
      perform pruebas.debe_fallar(format('anon borra de %s %s', tabla, claims),
        format('delete from public.%I', tabla), '42501');
    end loop;
  end loop;
end;
$$;

-- prueba: un usuario sin rol no puede insertar, editar ni borrar en ninguna tabla del catálogo
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_b", "role": "authenticated"}';
select pruebas.debe_fallar(
  'insertar un género',
  $$insert into public.genera (name) values ('Masdevallia')$$,
  '42501'
);
select pruebas.debe_fallar(
  'insertar una abreviatura',
  $$insert into public.genus_abbreviations (genus_id, abbreviation) values (pruebas.genero('Vanda'), 'Vd.')$$,
  '42501'
);
select pruebas.debe_fallar(
  'insertar una especie',
  $$insert into public.species (scientific_name, genus_id, type, status, source)
    values ('Vanda coerulea', pruebas.genero('Vanda'), 'species', 'validated', 'curated')$$,
  '42501'
);
select pruebas.debe_fallar(
  'insertar un nombre',
  $$insert into public.species_names (species_id, name, type)
    values (pruebas.especie('Cattleya labiata'), 'Catleya', 'common')$$,
  '42501'
);
-- RLS filtra los update y delete sin dar error: no tocan ninguna fila.
update public.genera set is_quick_access = false;
update public.genus_abbreviations set abbreviation = abbreviation || 'x';
update public.species set status = 'observed';
update public.species_names set name = 'Otro';
delete from public.species_names;
delete from public.genus_abbreviations;
delete from public.genera where name = 'Masdevallia' or name = 'Vanda';
set local role postgres;
select pruebas.iguales(
  'catálogo tras los intentos del usuario sin rol',
  (select row((select count(*) from public.genera where is_quick_access), (select count(*) from public.genus_abbreviations),
              (select string_agg(status::text, ',') from public.species), (select string_agg(name, ',') from public.species_names))::text),
  '(5,5,validated,"Flor de mayo")'
);

-- prueba: un administrador inserta, edita y borra en las cuatro tablas del catálogo
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales('is_catalog_admin() del administrador', public.is_catalog_admin(), true);
select pruebas.debe_funcionar(
  'insertar en las cuatro tablas',
  $$insert into public.genera (name) values ('Masdevallia');
    insert into public.genus_abbreviations (genus_id, abbreviation) values (pruebas.genero('Masdevallia'), 'Masd.');
    insert into public.species (scientific_name, genus_id, type, status, source)
      values ('Masdevallia veitchiana', pruebas.genero('Masdevallia'), 'species', 'validated', 'curated');
    insert into public.species_names (species_id, name, type, language)
      values (pruebas.especie('Masdevallia veitchiana'), 'Wiñay wayna', 'common', 'qu')$$
);
update public.genera set is_quick_access = true where name = 'Masdevallia';
update public.genus_abbreviations set abbreviation = 'Masdev.' where abbreviation = 'Masd.';
update public.species set status = 'observed' where scientific_name = 'Masdevallia veitchiana';
update public.species_names set name = 'Flor del inca' where name = 'Wiñay wayna';
select pruebas.iguales(
  'lo que ve el administrador tras editar',
  (select g.is_quick_access || ' ' || a.abbreviation || ' ' || s.status || ' ' || n.name
     from public.genera g
     join public.genus_abbreviations a on a.genus_id = g.id
     join public.species s on s.genus_id = g.id
     join public.species_names n on n.species_id = s.id
     where g.name = 'Masdevallia'),
  'true Masdev. observed Flor del inca'
);
-- El borrado del género se lleva también su abreviatura (cascada); aquí se borra cada una
-- por separado para probar las cuatro políticas.
delete from public.species_names where name = 'Flor del inca';
delete from public.species where scientific_name = 'Masdevallia veitchiana';
delete from public.genus_abbreviations where abbreviation = 'Masdev.';
delete from public.genera where name = 'Masdevallia';
set local role postgres;
select pruebas.iguales(
  'catálogo tras los borrados del administrador',
  (select row((select count(*) from public.genera), (select count(*) from public.genus_abbreviations),
              (select count(*) from public.species), (select count(*) from public.species_names))::text),
  '(5,5,1,1)'
);

-- prueba: el administrador sigue sujeto a las restricciones y a los borrados restringidos
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.debe_fallar(
  'género repetido con otras mayúsculas',
  $$insert into public.genera (name) values ('VANDA')$$,
  '23505', 'genera_name_key'
);
select pruebas.debe_fallar(
  'borrar una especie con plantas enlazadas',
  $$delete from public.species where scientific_name = 'Cattleya labiata'$$,
  '23503'
);

-- prueba: al editar una especie, los disparadores actualizan updated_at y las plantas de otros usuarios
-- propagate_species_to_plants es security definer: actualiza la planta de user_a aunque el
-- administrador no pueda verla.
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
update public.species
  set genus_id = pruebas.genero('Vanda'), type = 'hybrid', updated_at = '2000-01-01'
  where scientific_name = 'Cattleya labiata';
set local role postgres;
select pruebas.comprobar(
  'updated_at de la especie lo pone el disparador',
  (select updated_at > '2000-01-01' from public.species where scientific_name = 'Cattleya labiata')
);
select pruebas.iguales(
  'género y tipo de la planta de user_a',
  (select g.name || ' ' || p.type from public.plants p join public.genera g on g.id = p.genus_id),
  'Vanda hybrid'
);

-- prueba: un token sin app_role, con otro valor o con el rol en un claim que controla el usuario no da permisos
do $$
declare
  claims text;
  filas bigint;
begin
  set local role authenticated;
  foreach claims in array array[
    '{"sub": "user_b", "role": "authenticated"}',
    '{"sub": "user_b", "role": "authenticated", "app_role": null}',
    '{"sub": "user_b", "role": "authenticated", "app_role": "admin"}',
    '{"sub": "user_b", "role": "authenticated", "app_role": "CATALOG_ADMIN"}',
    '{"sub": "user_b", "role": "authenticated", "app_role": "Catalog_Admin"}',
    '{"sub": "user_b", "role": "authenticated", "app_role": ""}',
    '{"sub": "user_b", "role": "authenticated", "app_role": " catalog_admin"}',
    '{"sub": "user_b", "role": "authenticated", "app_role": "catalog_admin "}',
    '{"sub": "user_b", "role": "authenticated", "app_role": ["catalog_admin"]}',
    '{"sub": "user_b", "role": "authenticated", "app_role": {"role": "catalog_admin"}}',
    '{"sub": "user_b", "role": "catalog_admin"}',
    '{"sub": "user_b", "role": "authenticated", "user_metadata": {"role": "catalog_admin"}}',
    '{"sub": "user_b", "role": "authenticated", "user_metadata": {"app_role": "catalog_admin"}}',
    '{"sub": "user_b", "role": "authenticated", "unsafe_metadata": {"role": "catalog_admin"}}',
    '{"sub": "user_b", "role": "authenticated", "public_metadata": {"role": "catalog_admin"}}',
    '{"sub": "user_b", "role": "authenticated", "app_metadata": {"app_role": "catalog_admin"}}',
    '{"sub": "user_b", "role": "authenticated", "metadata": {"app_role": "catalog_admin"}}'
  ] loop
    perform set_config('request.jwt.claims', claims, true);
    perform pruebas.iguales('is_catalog_admin() con ' || claims, public.is_catalog_admin(), false);
    perform pruebas.debe_fallar('insertar un género con ' || claims,
      $q$insert into public.genera (name) values ('Masdevallia')$q$, '42501');
    perform pruebas.debe_fallar('insertar un nombre con ' || claims,
      $q$insert into public.species_names (species_id, name, type)
         values (pruebas.especie('Cattleya labiata'), 'Catleya', 'common')$q$, '42501');
    with f as (update public.species set status = 'observed' returning 1) select count(*) into filas from f;
    perform pruebas.iguales('especies editadas con ' || claims, filas, 0::bigint);
    with f as (delete from public.genus_abbreviations returning 1) select count(*) into filas from f;
    perform pruebas.iguales('abreviaturas borradas con ' || claims, filas, 0::bigint);
  end loop;
end;
$$;

-- prueba: is_catalog_admin() es stable, security invoker, con search_path vacío, devuelve boolean y es de postgres
select pruebas.iguales(
  'propiedades de la función',
  (select p.provolatile::text || ' definer=' || p.prosecdef || ' ' || array_to_string(p.proconfig, ',')
          || ' ' || format_type(p.prorettype, null) || ' ' || pg_get_userbyid(p.proowner)
     from pg_proc p
     where p.oid = 'public.is_catalog_admin()'::regprocedure),
  's definer=false search_path="" boolean postgres'
);

-- prueba: is_catalog_admin() la ejecutan anon, authenticated y service_role; PUBLIC no
select pruebas.iguales(
  'permiso de ejecución por rol',
  (select string_agg(r.rol || ':' || has_function_privilege(r.rol, 'public.is_catalog_admin()', 'execute'), ', ' order by r.rol)
     from (values ('anon'), ('authenticated'), ('service_role')) r (rol)),
  'anon:true, authenticated:true, service_role:true'
);
select pruebas.iguales(
  'PUBLIC en los permisos de la función',
  (select count(*)
     from pg_proc p
     cross join lateral aclexplode(p.proacl) a
     where p.oid = 'public.is_catalog_admin()'::regprocedure and a.grantee = 0),
  0::bigint
);

-- prueba: privilegios sobre el catálogo: anon solo lee y authenticated lee y escribe, sin vaciar
select pruebas.iguales(
  'privilegios de anon y authenticated sobre las tablas del catálogo',
  (select string_agg(distinct x.privilegios, ', ' order by x.privilegios)
     from (values ('anon'), ('authenticated')) r (rol)
     cross join (values ('genera'), ('genus_abbreviations'), ('species'), ('species_names')) t (tabla)
     cross join lateral (
       select r.rol || ':' || concat_ws('',
         case when has_table_privilege(r.rol, 'public.' || t.tabla, 'select') then 'r' end,
         case when has_table_privilege(r.rol, 'public.' || t.tabla, 'insert') then 'a' end,
         case when has_table_privilege(r.rol, 'public.' || t.tabla, 'update') then 'w' end,
         case when has_table_privilege(r.rol, 'public.' || t.tabla, 'delete') then 'd' end,
         case when has_table_privilege(r.rol, 'public.' || t.tabla, 'truncate') then 'D' end) as privilegios
     ) x),
  'anon:r, authenticated:rawd'
);

-- prueba: cada tabla del catálogo tiene sus políticas de escritura solo para authenticated y con is_catalog_admin()
select pruebas.iguales(
  'políticas de escritura del catálogo',
  (select string_agg(p.tablename || '.' || p.cmd || ':' || array_to_string(p.roles, ',') || ':'
                     || (coalesce(p.qual, p.with_check) like '%is_catalog_admin()%')
                     || ':' || (p.qual is null or p.with_check is null or p.qual = p.with_check),
                     ', ' order by p.tablename, p.cmd)
     from pg_policies p
     where p.schemaname = 'public'
       and p.tablename in ('genera', 'genus_abbreviations', 'species', 'species_names')
       and p.cmd <> 'SELECT'),
  'genera.DELETE:authenticated:true:true, genera.INSERT:authenticated:true:true, genera.UPDATE:authenticated:true:true, '
    || 'genus_abbreviations.DELETE:authenticated:true:true, genus_abbreviations.INSERT:authenticated:true:true, '
    || 'genus_abbreviations.UPDATE:authenticated:true:true, '
    || 'species.DELETE:authenticated:true:true, species.INSERT:authenticated:true:true, species.UPDATE:authenticated:true:true, '
    || 'species_names.DELETE:authenticated:true:true, species_names.INSERT:authenticated:true:true, '
    || 'species_names.UPDATE:authenticated:true:true'
);

-- prueba: el administrador no gana acceso a plantas ni perfiles de otros
-- Se compara lo que obtiene el mismo usuario con y sin app_role: el rol no puede cambiar nada
-- sobre plants ni profiles. Así la prueba no depende de las políticas de inventario (#64):
-- hoy cada intento da 42501 y con esas políticas no afectará a ninguna fila de user_a.
do $$
declare
  claims text;
  sentencia text;
  resultado text;
  resultados text[] := '{}';
  filas bigint;
begin
  foreach claims in array array[
    '{"sub": "user_admin", "role": "authenticated"}',
    '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}'
  ] loop
    set local role authenticated;
    perform set_config('request.jwt.claims', claims, true);
    resultado := '';
    foreach sentencia in array array[
      $q$select count(*) from public.plants where user_id = 'user_a'$q$,
      $q$select count(*) from public.profiles where id = 'user_a'$q$,
      $q$with f as (update public.plants set nickname = 'del admin' where user_id = 'user_a' returning 1) select count(*) from f$q$,
      $q$with f as (update public.profiles set preferred_language = 'en' where id = 'user_a' returning 1) select count(*) from f$q$,
      $q$with f as (delete from public.plants where user_id = 'user_a' returning 1) select count(*) from f$q$,
      $q$with f as (delete from public.profiles where id = 'user_a' returning 1) select count(*) from f$q$,
      $q$with f as (insert into public.plants (user_id, entered_name, genus_id, type)
                    values ('user_a', 'Regalo', pruebas.genero('Vanda'), 'unknown') returning 1) select count(*) from f$q$
    ] loop
      begin
        execute sentencia into filas;
        resultado := resultado || filas || ' ';
      exception when others then
        resultado := resultado || sqlstate || ' ';
      end;
    end loop;
    resultados := resultados || resultado;
  end loop;
  perform pruebas.iguales('resultados con app_role frente a sin app_role', resultados[2], resultados[1]);
  perform pruebas.comprobar(
    'cada intento del administrador da 42501 o no afecta a ninguna fila (' || resultados[2] || ')',
    resultados[2] ~ '^((42501|0) )+$'
  );
  set local role postgres;
  perform pruebas.iguales(
    'planta y perfil de user_a tras los intentos',
    (select coalesce(p.nickname, 'sin apodo') || ' ' || f.preferred_language || ' ' || (select count(*) from public.plants)
       from public.plants p join public.profiles f on f.id = p.user_id),
    'sin apodo es 1'
  );
end;
$$;
