-- Acceso por rol, como llegan las peticiones a través de la API de Supabase.
--
-- PostgREST ejecuta cada petición con el rol del token (anon sin sesión, authenticated con
-- sesión de Clerk, service_role con la clave de servicio) y deja las claims del token en
-- request.jwt.claims. Aquí se reproduce con "set local role" y "set local request.jwt.claims".
-- Hasta el issue #6, el catálogo es de solo lectura y perfiles y plantas están cerrados.

-- Datos de partida: una especie con un nombre, un perfil y una planta de user_a.
insert into public.species (scientific_name, genus_id, type, status, source)
values ('Cattleya labiata', pruebas.genero('Cattleya'), 'species', 'validated', 'curated');
insert into public.species_names (species_id, name, type)
values (pruebas.especie('Cattleya labiata'), 'Flor de mayo', 'common');
insert into public.profiles (id) values ('user_a');
insert into public.plants (user_id, entered_name, species_id)
values ('user_a', 'Mi labiata', pruebas.especie('Cattleya labiata'));

-- prueba: anon lee las cuatro tablas del catálogo
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select pruebas.iguales(
  'filas visibles de genera, genus_abbreviations, species y species_names',
  (select row((select count(*) from public.genera), (select count(*) from public.genus_abbreviations),
              (select count(*) from public.species), (select count(*) from public.species_names))::text),
  '(5,5,1,1)'
);

-- prueba: authenticated lee las cuatro tablas del catálogo
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.iguales(
  'filas visibles de genera, genus_abbreviations, species y species_names',
  (select row((select count(*) from public.genera), (select count(*) from public.genus_abbreviations),
              (select count(*) from public.species), (select count(*) from public.species_names))::text),
  '(5,5,1,1)'
);

-- prueba: ni anon ni authenticated pueden insertar, actualizar, borrar ni vaciar el catálogo
do $$
declare
  rol text;
  tabla text;
begin
  foreach rol in array array['anon', 'authenticated'] loop
    execute format('set local role %I', rol);
    perform set_config('request.jwt.claims', '{"sub": "user_a", "role": "' || rol || '"}', true);
    foreach tabla in array array['genera', 'genus_abbreviations', 'species', 'species_names'] loop
      perform pruebas.debe_fallar(
        format('%s inserta en %s', rol, tabla),
        format('insert into public.%I default values', tabla),
        '42501'
      );
      perform pruebas.debe_fallar(
        format('%s actualiza %s', rol, tabla),
        format('update public.%I set updated_at = now()', tabla),
        '42501'
      );
      perform pruebas.debe_fallar(
        format('%s borra de %s', rol, tabla),
        format('delete from public.%I', tabla),
        '42501'
      );
      perform pruebas.debe_fallar(
        format('%s vacía %s', rol, tabla),
        format('truncate public.%I cascade', tabla),
        '42501'
      );
    end loop;
  end loop;
end;
$$;

-- prueba: ni anon ni authenticated pueden leer ni escribir profiles ni plants
do $$
declare
  rol text;
begin
  foreach rol in array array['anon', 'authenticated'] loop
    execute format('set local role %I', rol);
    perform set_config('request.jwt.claims', '{"sub": "user_a", "role": "' || rol || '"}', true);
    perform pruebas.debe_fallar(rol || ' lee profiles', 'select * from public.profiles', '42501');
    perform pruebas.debe_fallar(rol || ' crea su perfil', 'insert into public.profiles default values', '42501');
    perform pruebas.debe_fallar(rol || ' actualiza profiles', $q$update public.profiles set preferred_language = 'en'$q$, '42501');
    perform pruebas.debe_fallar(rol || ' borra profiles', 'delete from public.profiles', '42501');
    perform pruebas.debe_fallar(rol || ' lee plants', 'select * from public.plants', '42501');
    perform pruebas.debe_fallar(
      rol || ' crea su planta',
      $q$insert into public.plants (entered_name, genus_id, type) values ('x', pruebas.genero('Vanda'), 'unknown')$q$,
      '42501'
    );
    perform pruebas.debe_fallar(rol || ' actualiza plants', $q$update public.plants set nickname = 'x'$q$, '42501');
    perform pruebas.debe_fallar(rol || ' borra plants', 'delete from public.plants', '42501');
    perform pruebas.debe_fallar(rol || ' vacía plants', 'truncate public.plants', '42501');
  end loop;
end;
$$;

-- prueba: aunque authenticated tuviera privilegios, RLS sin políticas no le deja ver ni escribir el inventario
-- Defensa en profundidad: si una migración futura concede privilegios sin escribir las
-- políticas (issue #6), RLS sigue cerrando perfiles y plantas.
grant select, insert, update, delete on public.profiles, public.plants to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.iguales('perfiles visibles', (select count(*) from public.profiles), 0::bigint);
select pruebas.iguales('plantas visibles', (select count(*) from public.plants), 0::bigint);
select pruebas.debe_fallar(
  'crear su planta',
  $$insert into public.plants (entered_name, genus_id, type) values ('x', pruebas.genero('Vanda'), 'unknown')$$,
  '42501'
);
select pruebas.debe_fallar('crear su perfil', $$insert into public.profiles (id) values ('user_nuevo')$$, '42501');
update public.plants set nickname = 'cambiada';
set local role postgres;
select pruebas.iguales(
  'apodo de la planta tras el update de authenticated',
  (select coalesce(nickname, 'sin apodo') from public.plants where entered_name = 'Mi labiata'),
  'sin apodo'
);

-- prueba: service_role lee y escribe el catálogo, los perfiles y las plantas
set local role service_role;
set local request.jwt.claims = '{"role": "service_role"}';
select pruebas.iguales('plantas visibles', (select count(*) from public.plants), 1::bigint);
select pruebas.iguales('perfiles visibles', (select count(*) from public.profiles), 1::bigint);
select pruebas.debe_funcionar(
  'escribir en el catálogo',
  $$insert into public.genera (name) values ('Masdevallia');
    update public.species set status = 'observed';
    delete from public.species_names$$
);
select pruebas.debe_funcionar(
  'escribir perfiles y plantas',
  $$insert into public.profiles (id) values ('user_b');
    insert into public.plants (user_id, entered_name, genus_id, type) values ('user_b', 'x', pruebas.genero('Vanda'), 'unknown');
    update public.plants set nickname = 'Del servicio';
    delete from public.plants where user_id = 'user_a'$$
);

-- prueba: user_id y profiles.id toman por defecto el sub del token de sesión
set local role service_role;
set local request.jwt.claims = '{"sub": "user_token", "role": "authenticated"}';
insert into public.profiles default values;
insert into public.plants (entered_name, genus_id, type) values ('Del token', pruebas.genero('Vanda'), 'unknown');
select pruebas.iguales(
  'id del perfil creado sin id',
  (select id from public.profiles where id <> 'user_a'),
  'user_token'
);
select pruebas.iguales(
  'user_id de la planta creada sin user_id',
  (select user_id from public.plants where entered_name = 'Del token'),
  'user_token'
);
-- Un user_id explícito prevalece sobre el del token.
insert into public.plants (user_id, entered_name, genus_id, type)
values ('user_explicito', 'Explícita', pruebas.genero('Vanda'), 'unknown');
select pruebas.iguales(
  'user_id explícito',
  (select user_id from public.plants where entered_name = 'Explícita'),
  'user_explicito'
);

-- prueba: sin sub en el token, user_id hay que indicarlo
set local role service_role;
set local request.jwt.claims = '{"role": "service_role"}';
select pruebas.debe_fallar(
  'planta sin user_id con un token sin sub',
  $$insert into public.plants (entered_name, genus_id, type) values ('x', pruebas.genero('Vanda'), 'unknown')$$,
  '23502'
);

-- prueba: anon y authenticated no pueden ejecutar las funciones de private ni usar el esquema
select pruebas.iguales(
  'privilegios de anon y authenticated sobre private y sus funciones',
  (select string_agg(r.rol || ':' || has_schema_privilege(r.rol, 'private', 'usage')
                     || ':' || has_function_privilege(r.rol, p.oid, 'execute'), ', ' order by r.rol, p.proname)
     from (values ('anon'), ('authenticated')) r (rol)
     cross join pg_proc p
     where p.pronamespace = 'private'::regnamespace),
  'anon:false:false, anon:false:false, anon:false:false, '
    || 'authenticated:false:false, authenticated:false:false, authenticated:false:false'
);
set local role authenticated;
select pruebas.debe_fallar(
  'authenticated llama a private.set_updated_at()',
  $$select private.set_updated_at()$$,
  '42501'
);
