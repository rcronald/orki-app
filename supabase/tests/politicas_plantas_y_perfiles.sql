-- Políticas RLS y permisos de profiles y plants (issue #64).
--
-- Cada usuario con sesión (authenticated) lee, crea, edita y borra solo su perfil y sus
-- plantas; anon no tiene acceso; un administrador de catálogo (claim app_role) no ve más
-- inventario que el suyo; y nadie escribe validation desde la API. Las peticiones se
-- reproducen con "set local role" y "set local request.jwt.claims", como en
-- acceso_por_rol.sql. Para comprobar lo que quedó en la tabla sin RLS se vuelve a
-- "set local role postgres".

-- Datos de partida: una especie, los perfiles de user_a, user_b y un administrador, y una
-- planta sin especie de cada uno.
insert into public.species (scientific_name, genus_id, type, status, source)
values ('Cattleya labiata', pruebas.genero('Cattleya'), 'species', 'validated', 'curated');
insert into public.profiles (id) values ('user_a'), ('user_b'), ('user_admin');
insert into public.plants (user_id, entered_name, genus_id, type)
values
  ('user_a', 'Planta de A', pruebas.genero('Vanda'), 'unknown'),
  ('user_b', 'Planta de B', pruebas.genero('Vanda'), 'unknown'),
  ('user_admin', 'Planta del admin', pruebas.genero('Vanda'), 'unknown');

-- prueba: anon no puede leer ni escribir profiles ni plants, aunque el token traiga un sub
set local role anon;
set local request.jwt.claims = '{"sub": "user_a", "role": "anon"}';
select pruebas.debe_fallar('anon lee profiles', 'select * from public.profiles', '42501');
select pruebas.debe_fallar('anon crea un perfil', 'insert into public.profiles default values', '42501');
select pruebas.debe_fallar('anon actualiza profiles', $$update public.profiles set preferred_language = 'en'$$, '42501');
select pruebas.debe_fallar('anon borra profiles', 'delete from public.profiles', '42501');
select pruebas.debe_fallar('anon lee plants', 'select * from public.plants', '42501');
select pruebas.debe_fallar(
  'anon crea una planta',
  $$insert into public.plants (entered_name, genus_id, type) values ('x', pruebas.genero('Vanda'), 'unknown')$$,
  '42501'
);
select pruebas.debe_fallar('anon actualiza plants', $$update public.plants set nickname = 'x'$$, '42501');
select pruebas.debe_fallar('anon borra plants', 'delete from public.plants', '42501');

-- prueba: privilegios de authenticated: todo sobre profiles, y sobre plants todo menos escribir validation, el identificador y vaciar
select pruebas.iguales(
  'privilegios de tabla de authenticated',
  (select string_agg(t.tabla || ':' || p.priv || ':' || has_table_privilege('authenticated', 'public.' || t.tabla, p.priv), ', '
                     order by t.tabla, p.priv)
     from (values ('plants'), ('profiles')) t (tabla)
     cross join (values ('select'), ('insert'), ('update'), ('delete'), ('truncate')) p (priv)),
  'plants:delete:true, plants:insert:false, plants:select:true, plants:truncate:false, plants:update:false, '
    || 'profiles:delete:true, profiles:insert:true, profiles:select:true, profiles:truncate:false, profiles:update:true'
);
select pruebas.iguales(
  'columnas de plants que authenticated no puede insertar o actualizar',
  (select string_agg(a.attname, ', ' order by a.attname)
     from pg_attribute a
     where a.attrelid = 'public.plants'::regclass and a.attnum > 0 and not a.attisdropped
       and not (has_column_privilege('authenticated', 'public.plants', a.attname, 'insert')
                and has_column_privilege('authenticated', 'public.plants', a.attname, 'update'))),
  'code, code_number, code_prefix, validation'
);
select pruebas.iguales(
  'privilegios de anon sobre profiles y plants',
  (select string_agg(t.tabla || ':' || has_table_privilege('anon', 'public.' || t.tabla, 'select,insert,update,delete,truncate'), ', ' order by t.tabla)
     from (values ('plants'), ('profiles')) t (tabla)),
  'plants:false, profiles:false'
);

-- prueba: cada usuario lee solo su perfil y sus plantas
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.iguales('perfiles visibles para user_a', (select string_agg(id, ', ') from public.profiles), 'user_a');
select pruebas.iguales('plantas visibles para user_a', (select string_agg(entered_name, ', ') from public.plants), 'Planta de A');
select pruebas.iguales(
  'user_a busca el perfil y las plantas de user_b',
  (select count(*) from public.profiles where id = 'user_b') + (select count(*) from public.plants where user_id = 'user_b'),
  0::bigint
);
set local request.jwt.claims = '{"sub": "user_b", "role": "authenticated"}';
select pruebas.iguales('perfiles visibles para user_b', (select string_agg(id, ', ') from public.profiles), 'user_b');
select pruebas.iguales('plantas visibles para user_b', (select string_agg(entered_name, ', ') from public.plants), 'Planta de B');

-- prueba: un token authenticated sin sub no ve ni escribe nada del inventario
set local role authenticated;
set local request.jwt.claims = '{"role": "authenticated"}';
select pruebas.iguales('perfiles visibles', (select count(*) from public.profiles), 0::bigint);
select pruebas.iguales('plantas visibles', (select count(*) from public.plants), 0::bigint);
select pruebas.debe_fallar(
  'crear un perfil a nombre de user_nuevo',
  $$insert into public.profiles (id) values ('user_nuevo')$$,
  '42501'
);
select pruebas.debe_fallar(
  'crear una planta a nombre de user_a',
  $$insert into public.plants (user_id, entered_name, genus_id, type) values ('user_a', 'x', pruebas.genero('Vanda'), 'unknown')$$,
  '42501'
);

-- prueba: un usuario crea su perfil, con el id del token, y no el de otro
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_nuevo", "role": "authenticated"}';
select pruebas.debe_funcionar('crear su perfil sin indicar id', 'insert into public.profiles default values');
select pruebas.iguales('perfil visible tras crearlo', (select string_agg(id, ', ') from public.profiles), 'user_nuevo');
select pruebas.debe_fallar(
  'crear un perfil con el id de otro',
  $$insert into public.profiles (id) values ('user_otro')$$,
  '42501'
);
set local role postgres;
select pruebas.iguales('perfil user_otro', (select count(*) from public.profiles where id = 'user_otro'), 0::bigint);

-- prueba: un usuario actualiza su perfil, no el de otro, y no puede cambiarse el id
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.debe_funcionar('actualizar su idioma', $$update public.profiles set preferred_language = 'en'$$);
update public.profiles set preferred_language = 'pt' where id = 'user_b';
select pruebas.debe_fallar(
  'pasar su perfil al id de otro',
  $$update public.profiles set id = 'user_otro' where id = 'user_a'$$,
  '42501'
);
set local role postgres;
select pruebas.iguales(
  'idiomas de user_a y user_b',
  (select string_agg(id || ':' || preferred_language, ', ' order by id) from public.profiles where id in ('user_a', 'user_b')),
  'user_a:en, user_b:es'
);

-- prueba: un usuario borra su perfil y no el de otro
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
delete from public.profiles where id = 'user_b';
select pruebas.debe_funcionar('borrar su perfil', 'delete from public.profiles');
set local role postgres;
select pruebas.iguales(
  'perfiles que quedan',
  (select string_agg(id, ', ' order by id) from public.profiles),
  'user_admin, user_b'
);

-- prueba: un usuario crea sus plantas y no puede crearlas a nombre de otro
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.debe_funcionar(
  'crear su planta sin indicar user_id',
  $$insert into public.plants (entered_name, genus_id, type) values ('Nueva de A', pruebas.genero('Oncidium'), 'hybrid')$$
);
select pruebas.debe_funcionar(
  'crear su planta indicando su user_id',
  $$insert into public.plants (user_id, entered_name, genus_id, type) values ('user_a', 'Otra de A', pruebas.genero('Oncidium'), 'hybrid')$$
);
select pruebas.debe_fallar(
  'crear una planta con el user_id de user_b',
  $$insert into public.plants (user_id, entered_name, genus_id, type) values ('user_b', 'Regalo', pruebas.genero('Vanda'), 'unknown')$$,
  '42501'
);
set local role postgres;
select pruebas.iguales(
  'plantas por dueño',
  (select string_agg(user_id || ':' || entered_name, ', ' order by user_id, entered_name) from public.plants),
  'user_a:Nueva de A, user_a:Otra de A, user_a:Planta de A, user_admin:Planta del admin, user_b:Planta de B'
);

-- prueba: un usuario edita sus plantas, no las de otro, y no puede cambiar el dueño
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.debe_funcionar('editar su planta', $$update public.plants set nickname = 'La mía', status = 'gifted'$$);
with editadas as (update public.plants set nickname = 'Robada' where user_id = 'user_b' returning 1)
select pruebas.iguales('plantas de user_b editadas por user_a', (select count(*) from editadas), 0::bigint);
select pruebas.debe_fallar(
  'pasarle su planta a user_b',
  $$update public.plants set user_id = 'user_b' where entered_name = 'Planta de A'$$,
  '42501'
);
set local role postgres;
select pruebas.iguales(
  'dueño, apodo y estado de cada planta',
  (select string_agg(entered_name || ':' || user_id || ':' || coalesce(nickname, '-') || ':' || status, ', ' order by entered_name)
     from public.plants),
  'Planta de A:user_a:La mía:gifted, Planta de B:user_b:-:active, Planta del admin:user_admin:-:active'
);

-- prueba: un usuario borra sus plantas y no las de otro
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_b", "role": "authenticated"}';
with borradas as (delete from public.plants where user_id = 'user_a' returning 1)
select pruebas.iguales('plantas de user_a borradas por user_b', (select count(*) from borradas), 0::bigint);
select pruebas.debe_funcionar('borrar su planta', 'delete from public.plants');
set local role postgres;
select pruebas.iguales(
  'plantas que quedan',
  (select string_agg(entered_name, ', ' order by entered_name) from public.plants),
  'Planta de A, Planta del admin'
);

-- prueba: un usuario no puede dejar sus plantas en no identificable ni validadas sin especie
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.debe_fallar(
  'crear una planta no identificable',
  $$insert into public.plants (entered_name, genus_id, type, validation) values ('x', pruebas.genero('Vanda'), 'unknown', 'unidentifiable')$$,
  '42501'
);
select pruebas.debe_fallar(
  'crear una planta validada sin especie',
  $$insert into public.plants (entered_name, genus_id, type, validation) values ('x', pruebas.genero('Vanda'), 'unknown', 'validated')$$,
  '42501'
);
select pruebas.debe_fallar(
  'marcar su planta como no identificable',
  $$update public.plants set validation = 'unidentifiable' where entered_name = 'Planta de A'$$,
  '42501'
);
select pruebas.debe_fallar(
  'marcar su planta como validada sin especie',
  $$update public.plants set validation = 'validated' where entered_name = 'Planta de A'$$,
  '42501'
);
-- El disparador permite desenlazar marcando no identificable en la misma actualización; desde
-- la API tampoco se puede, porque nombra validation.
update public.plants set species_id = pruebas.especie('Cattleya labiata') where entered_name = 'Planta de A';
select pruebas.debe_fallar(
  'desenlazar marcando no identificable',
  $$update public.plants set species_id = null, validation = 'unidentifiable' where entered_name = 'Planta de A'$$,
  '42501'
);
set local role postgres;
select pruebas.iguales(
  'validación de las plantas de user_a',
  (select string_agg(entered_name || ':' || validation, ', ' order by entered_name) from public.plants where user_id = 'user_a'),
  'Planta de A:validated'
);

-- prueba: registrar una planta con especie como authenticated rellena género, tipo y validación, y al desenlazarla vuelve a pendiente
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
insert into public.plants (entered_name, species_id) values ('Mi labiata', pruebas.especie('Cattleya labiata'));
select pruebas.iguales(
  'dueño, género, tipo y validación al registrarla',
  (select p.user_id || ' ' || g.name || ' ' || p.type || ' ' || p.validation
     from public.plants p join public.genera g on g.id = p.genus_id where p.entered_name = 'Mi labiata'),
  'user_a Cattleya species validated'
);
update public.plants set species_id = null where entered_name = 'Mi labiata';
select pruebas.iguales(
  'género, tipo y validación al desenlazarla',
  (select g.name || ' ' || p.type || ' ' || p.validation
     from public.plants p join public.genera g on g.id = p.genus_id where p.entered_name = 'Mi labiata'),
  'Cattleya species pending'
);

-- prueba: un usuario sigue pudiendo editar y enlazar una planta que otro dejó no identificable
update public.plants set validation = 'unidentifiable' where entered_name = 'Planta de A';
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.debe_funcionar('cambiar el apodo', $$update public.plants set nickname = 'Misteriosa' where entered_name = 'Planta de A'$$);
select pruebas.iguales(
  'validación tras cambiar el apodo',
  (select validation::text from public.plants where entered_name = 'Planta de A'),
  'unidentifiable'
);
update public.plants set species_id = pruebas.especie('Cattleya labiata') where entered_name = 'Planta de A';
select pruebas.iguales(
  'validación tras enlazarla',
  (select validation::text from public.plants where entered_name = 'Planta de A'),
  'validated'
);

-- prueba: service_role sí puede poner una planta en no identificable
set local role service_role;
set local request.jwt.claims = '{"role": "service_role"}';
select pruebas.debe_funcionar(
  'marcar no identificable y crear una ya no identificable',
  $$update public.plants set validation = 'unidentifiable' where entered_name = 'Planta de A';
    insert into public.plants (user_id, entered_name, genus_id, type, validation)
    values ('user_a', 'Rara', pruebas.genero('Vanda'), 'unknown', 'unidentifiable')$$
);
select pruebas.iguales(
  'plantas no identificables',
  (select string_agg(entered_name, ', ' order by entered_name) from public.plants where validation = 'unidentifiable'),
  'Planta de A, Rara'
);

-- prueba: un administrador de catálogo solo ve y toca su propio inventario
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales('perfiles visibles', (select string_agg(id, ', ') from public.profiles), 'user_admin');
select pruebas.iguales('plantas visibles', (select string_agg(entered_name, ', ') from public.plants), 'Planta del admin');
with editadas as (update public.plants set nickname = 'Del admin' where user_id <> 'user_admin' returning 1)
select pruebas.iguales('plantas ajenas editadas', (select count(*) from editadas), 0::bigint);
with borradas as (delete from public.plants where user_id <> 'user_admin' returning 1)
select pruebas.iguales('plantas ajenas borradas', (select count(*) from borradas), 0::bigint);
select pruebas.debe_fallar(
  'crear una planta a nombre de user_a',
  $$insert into public.plants (user_id, entered_name, genus_id, type) values ('user_a', 'x', pruebas.genero('Vanda'), 'unknown')$$,
  '42501'
);
select pruebas.debe_fallar(
  'marcar su planta como no identificable',
  $$update public.plants set validation = 'unidentifiable'$$,
  '42501'
);
set local role postgres;
select pruebas.iguales(
  'plantas de user_a y user_b intactas',
  (select string_agg(entered_name || ':' || coalesce(nickname, '-'), ', ' order by entered_name)
     from public.plants where user_id <> 'user_admin'),
  'Planta de A:-, Planta de B:-'
);
