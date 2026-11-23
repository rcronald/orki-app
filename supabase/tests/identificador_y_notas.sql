-- Identificador del ejemplar (CAT-012) y notas de la planta (issue #264, parte de #263), de la
-- migración 20261124120000_identificador_notas_y_bitacora.sql.
--
-- Datos de partida, como postgres: géneros de prueba con signo de híbrido, tildes y de dos
-- letras, y una especie de Cattleya.

insert into public.genera (name) values ('× Brassocattleya'), ('Aa'), ('Ónix');

insert into public.species (scientific_name, genus_id, type, status, source)
values ('Cattleya labiata', pruebas.genero('Cattleya'), 'species', 'validated', 'curated');

-- prueba: prefijo: tres letras del género en mayúsculas, sin tildes ni signos, con X si faltan
select pruebas.iguales(
  'prefijos',
  (select string_agg(private.plant_code_prefix(n), ', ' order by o)
     from (values (1, 'Cattleya'), (2, '×Brassocattleya'), (3, '× Rhyncholaeliocattleya'), (4, 'Aa'),
                  (5, 'Ónix'), (6, 'x Vanda'), (7, 'Ñu'), (8, ''), (9, null)) v (o, n)),
  'CAT, BRA, RHY, AAX, ONI, VAN, NUX, XXX, XXX'
);

-- prueba: al insertar, cada planta recibe su identificador correlativo por usuario y prefijo
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
insert into public.plants (entered_name, genus_id, type)
values ('Uno', pruebas.genero('Cattleya'), 'unknown'),
       ('Dos', pruebas.genero('Cattleya'), 'unknown'),
       ('Tres', pruebas.genero('Vanda'), 'unknown'),
       ('Cuatro', pruebas.genero('× Brassocattleya'), 'hybrid'),
       ('Cinco', pruebas.genero('Aa'), 'unknown'),
       ('Seis', pruebas.genero('Ónix'), 'unknown');
set local request.jwt.claims = '{"sub": "user_b", "role": "authenticated"}';
insert into public.plants (entered_name, genus_id, type)
values ('De B', pruebas.genero('Cattleya'), 'unknown');
set local role postgres;
select pruebas.iguales(
  'identificadores',
  (select string_agg(user_id || ':' || entered_name || '=' || code, ', ' order by user_id, code_prefix, code_number)
     from public.plants),
  'user_a:Cinco=AAX-001, user_a:Cuatro=BRA-001, user_a:Uno=CAT-001, user_a:Dos=CAT-002, user_a:Seis=ONI-001, '
    || 'user_a:Tres=VAN-001, user_b:De B=CAT-001'
);
select pruebas.iguales(
  'contadores',
  (select string_agg(user_id || ':' || prefix || '=' || last_number, ', ' order by user_id, prefix)
     from private.plant_code_counters),
  'user_a:AAX=1, user_a:BRA=1, user_a:CAT=2, user_a:ONI=1, user_a:VAN=1, user_b:CAT=1'
);

-- prueba: formato del número: al menos tres cifras, sin cortar los de cuatro o más
insert into private.plant_code_counters (user_id, prefix, last_number) values ('user_a', 'CAT', 98);
insert into public.plants (user_id, entered_name, genus_id, type)
select 'user_a', 'P' || i, pruebas.genero('Cattleya'), 'unknown' from generate_series(1, 3) i;
update private.plant_code_counters set last_number = 998 where user_id = 'user_a' and prefix = 'CAT';
insert into public.plants (user_id, entered_name, genus_id, type)
select 'user_a', 'Q' || i, pruebas.genero('Cattleya'), 'unknown' from generate_series(1, 3) i;
select pruebas.iguales(
  'códigos',
  (select string_agg(code, ', ' order by code_number) from public.plants),
  'CAT-099, CAT-100, CAT-101, CAT-999, CAT-1000, CAT-1001'
);

-- prueba: con especie, el prefijo es el del género de la especie, no el que se envía
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
insert into public.plants (entered_name, genus_id, type, species_id)
values ('Labiata', pruebas.genero('Vanda'), 'unknown', pruebas.especie('Cattleya labiata'));
select pruebas.iguales('identificador', (select code from public.plants where entered_name = 'Labiata'), 'CAT-001');

-- prueba: el identificador es único por usuario
insert into public.plants (user_id, entered_name, genus_id, type)
values ('user_a', 'Uno', pruebas.genero('Cattleya'), 'unknown');
-- Se pierde el contador (lo que pasaría al borrar el perfil sin las plantas): el siguiente
-- sigue después del mayor número, sin chocar.
delete from private.plant_code_counters;
insert into public.plants (user_id, entered_name, genus_id, type)
values ('user_a', 'Dos', pruebas.genero('Cattleya'), 'unknown');
select pruebas.iguales('sin contador', (select code from public.plants where entered_name = 'Dos'), 'CAT-002');
-- Una fila repetida a mano choca con el índice único.
alter table public.plants disable trigger tag_code;
select pruebas.debe_fallar(
  'mismo prefijo y número para el mismo usuario',
  $$insert into public.plants (user_id, entered_name, genus_id, type, code_prefix, code_number)
    values ('user_a', 'Copia', pruebas.genero('Cattleya'), 'unknown', 'CAT', 1)$$,
  '23505', 'plants_user_id_code_key'
);
select pruebas.debe_funcionar(
  'mismo identificador para otro usuario',
  $$insert into public.plants (user_id, entered_name, genus_id, type, code_prefix, code_number)
    values ('user_b', 'Copia', pruebas.genero('Cattleya'), 'unknown', 'CAT', 1)$$
);
select pruebas.debe_fallar(
  'sin el disparador, el valor por defecto no pasa',
  $$insert into public.plants (user_id, entered_name, genus_id, type)
    values ('user_b', 'Sin código', pruebas.genero('Cattleya'), 'unknown')$$,
  '23514'
);
select pruebas.debe_fallar(
  'número cero',
  $$insert into public.plants (user_id, entered_name, genus_id, type, code_prefix, code_number)
    values ('user_b', 'Cero', pruebas.genero('Cattleya'), 'unknown', 'CAT', 0)$$,
  '23514', 'plants_code_number_positive'
);
select pruebas.debe_fallar(
  'prefijo en minúsculas',
  $$insert into public.plants (user_id, entered_name, genus_id, type, code_prefix, code_number)
    values ('user_b', 'Minúsculas', pruebas.genero('Cattleya'), 'unknown', 'cat', 5)$$,
  '23514', 'plants_code_prefix_valid'
);

-- prueba: lo que envíe quien inserta no cuenta: la base pone el identificador
insert into public.plants (user_id, entered_name, genus_id, type, code_prefix, code_number)
values ('user_a', 'Elegido', pruebas.genero('Cattleya'), 'unknown', 'ZZZ', 500);
select pruebas.iguales('como postgres', (select code from public.plants where entered_name = 'Elegido'), 'CAT-001');
set local role service_role;
insert into public.plants (user_id, entered_name, genus_id, type, code_prefix, code_number)
values ('user_a', 'Elegido por el servicio', pruebas.genero('Cattleya'), 'unknown', 'ZZZ', 500);
set local role postgres;
select pruebas.iguales('como service_role', (select code from public.plants where entered_name = 'Elegido por el servicio'), 'CAT-002');
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.debe_fallar(
  'authenticated envía el prefijo',
  $$insert into public.plants (entered_name, genus_id, type, code_prefix) values ('X', pruebas.genero('Cattleya'), 'unknown', 'ZZZ')$$,
  '42501'
);
select pruebas.debe_fallar(
  'authenticated envía el número',
  $$insert into public.plants (entered_name, genus_id, type, code_number) values ('X', pruebas.genero('Cattleya'), 'unknown', 7)$$,
  '42501'
);
select pruebas.debe_fallar(
  'authenticated envía el identificador generado',
  $$insert into public.plants (entered_name, genus_id, type, code) values ('X', pruebas.genero('Cattleya'), 'unknown', 'ZZZ-007')$$,
  '428C9'
);

-- prueba: el identificador no cambia: ni al cambiar de género o de especie, ni por la API, ni como dueño
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
insert into public.plants (id, entered_name, genus_id, type)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'Mía', pruebas.genero('Vanda'), 'unknown');
update public.plants set genus_id = pruebas.genero('Cattleya') where id = 'aaaaaaaa-0000-4000-8000-000000000001';
select pruebas.iguales('tras cambiar el género', (select code from public.plants where entered_name = 'Mía'), 'VAN-001');
update public.plants set species_id = pruebas.especie('Cattleya labiata') where id = 'aaaaaaaa-0000-4000-8000-000000000001';
select pruebas.iguales('tras enlazar la especie', (select code from public.plants where entered_name = 'Mía'), 'VAN-001');
select pruebas.debe_fallar(
  'authenticated cambia el prefijo',
  $$update public.plants set code_prefix = 'CAT' where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '42501'
);
select pruebas.debe_fallar(
  'authenticated cambia el número',
  $$update public.plants set code_number = 9 where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '42501'
);
select pruebas.debe_fallar(
  'authenticated cambia el identificador generado',
  $$update public.plants set code = 'CAT-009' where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '428C9'
);
set local role service_role;
select pruebas.debe_fallar(
  'service_role cambia el número',
  $$update public.plants set code_number = 9 where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '23514', 'plants_code_immutable'
);
set local role postgres;
select pruebas.debe_fallar(
  'postgres cambia el prefijo',
  $$update public.plants set code_prefix = 'CAT' where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '23514', 'plants_code_immutable'
);
select pruebas.debe_fallar(
  'postgres intenta escribir la columna generada',
  $$update public.plants set code = 'CAT-009' where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '428C9'
);
select pruebas.debe_funcionar(
  'reescribir el mismo valor no es un cambio',
  $$update public.plants set code_number = code_number where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$
);

-- prueba: los números no se reutilizan al borrar una planta
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
insert into public.plants (entered_name, genus_id, type)
values ('Uno', pruebas.genero('Cattleya'), 'unknown'), ('Dos', pruebas.genero('Cattleya'), 'unknown');
delete from public.plants where entered_name = 'Dos';
insert into public.plants (entered_name, genus_id, type) values ('Tres', pruebas.genero('Cattleya'), 'unknown');
delete from public.plants;
insert into public.plants (entered_name, genus_id, type) values ('Cuatro', pruebas.genero('Cattleya'), 'unknown');
select pruebas.iguales('tras borrar', (select string_agg(code, ', ') from public.plants), 'CAT-004');

-- prueba: un alta que falla no gasta número
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
insert into public.plants (entered_name, genus_id, type) values ('Uno', pruebas.genero('Cattleya'), 'unknown');
select pruebas.debe_fallar(
  'nombre en blanco',
  $$insert into public.plants (entered_name, genus_id, type) values ('  ', pruebas.genero('Cattleya'), 'unknown')$$,
  '23514', 'plants_entered_name_valid'
);
insert into public.plants (entered_name, genus_id, type) values ('Dos', pruebas.genero('Cattleya'), 'unknown');
select pruebas.iguales('números', (select string_agg(code, ', ' order by code) from public.plants), 'CAT-001, CAT-002');

-- prueba: el identificador se lee con las columnas de la colección, sin romper la consulta de la app desplegada
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
insert into public.plants (entered_name, genus_id, type, notes)
values ('Mía', pruebas.genero('Cattleya'), 'unknown', 'Riego los lunes');
-- Las columnas que pide hoy COLLECTION_PLANT_SELECT, sin las nuevas, siguen funcionando igual.
select pruebas.debe_funcionar(
  'consulta de la app desplegada',
  $$select id, entered_name, type, validation, status, acquired_on, origin, location, nickname, flower_color,
           photo_in_bloom, photo_path, thumbnail_path, public.photo_count(p), created_at, updated_at
      from public.plants p$$
);
select pruebas.iguales(
  'con las nuevas',
  (select code || ' ' || code_prefix || ' ' || code_number || ' ' || notes from public.plants),
  'CAT-001 CAT 1 Riego los lunes'
);

-- prueba: notas: opcionales, hasta 2000 caracteres, nunca en blanco; el dueño las escribe
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
insert into public.plants (id, entered_name, genus_id, type)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'Mía', pruebas.genero('Cattleya'), 'unknown');
select pruebas.iguales('sin notas', (select notes from public.plants), null::text);
select pruebas.debe_funcionar(
  'notas de 2000 caracteres',
  $$update public.plants set notes = repeat('a', 2000) where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$
);
select pruebas.debe_fallar(
  'notas de 2001 caracteres',
  $$update public.plants set notes = repeat('a', 2001) where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '23514', 'plants_notes_valid'
);
select pruebas.debe_fallar(
  'notas en blanco',
  $$update public.plants set notes = E' \n ' where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '23514', 'plants_notes_valid'
);
select pruebas.debe_fallar(
  'notas vacías',
  $$update public.plants set notes = '' where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '23514', 'plants_notes_valid'
);
select pruebas.debe_funcionar(
  'quitar las notas',
  $$update public.plants set notes = null where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$
);

-- prueba: notas e identificador: otro usuario, el administrador y anon no los ven ni los escriben
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
insert into public.plants (id, entered_name, genus_id, type, notes)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'Mía', pruebas.genero('Cattleya'), 'unknown', 'Secreto');
set local request.jwt.claims = '{"sub": "user_b", "role": "authenticated"}';
select pruebas.iguales('user_b lee', (select count(*) from public.plants), 0::bigint);
update public.plants set notes = 'De B' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales('el administrador lee', (select count(*) from public.plants), 0::bigint);
update public.plants set notes = 'Del administrador' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
set local role anon;
set local request.jwt.claims = '{"sub": "user_a", "role": "anon"}';
select pruebas.debe_fallar('anon lee', $$select notes, code from public.plants$$, '42501');
select pruebas.debe_fallar(
  'anon escribe',
  $$update public.plants set notes = 'anon' where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '42501'
);
set local role postgres;
select pruebas.iguales('notas intactas', (select notes from public.plants), 'Secreto');

-- prueba: relleno: las plantas existentes reciben su identificador por orden de alta, sin mover updated_at
-- Se reproduce el estado de antes de la migración: plantas sin identificador (los valores por
-- defecto) y sin contadores. El disparador de alta y la restricción se apartan solo en esta
-- transacción.
alter table public.plants disable trigger tag_code;
alter table public.plants drop constraint plants_code_prefix_valid;
alter table public.plants drop constraint plants_code_number_positive;
alter table public.plants drop constraint plants_user_id_code_key;
insert into public.plants (id, user_id, entered_name, genus_id, type, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000003', 'user_a', 'A3', pruebas.genero('Cattleya'), 'unknown', '2026-01-02', '2026-02-01'),
  ('00000000-0000-4000-8000-000000000001', 'user_a', 'A1', pruebas.genero('Cattleya'), 'unknown', '2026-01-01', '2026-02-01'),
  -- Mismo created_at que A3: decide el id.
  ('00000000-0000-4000-8000-000000000002', 'user_a', 'A2', pruebas.genero('Cattleya'), 'unknown', '2026-01-02', '2026-02-01'),
  ('00000000-0000-4000-8000-000000000004', 'user_a', 'A4', pruebas.genero('Vanda'), 'unknown', '2026-01-03', '2026-02-01'),
  ('00000000-0000-4000-8000-000000000005', 'user_a', 'A5', pruebas.genero('× Brassocattleya'), 'unknown', '2025-12-31', '2026-02-01'),
  ('00000000-0000-4000-8000-000000000006', 'user_b', 'B1', pruebas.genero('Cattleya'), 'unknown', '2026-03-01', '2026-02-01');
alter table public.plants enable trigger tag_code;
select pruebas.iguales('plantas rellenadas', private.backfill_plant_codes(), 6::bigint);
alter table public.plants add constraint plants_code_prefix_valid check (code_prefix ~ '^[A-Z]{3}$');
alter table public.plants add constraint plants_code_number_positive check (code_number >= 1);
alter table public.plants add constraint plants_user_id_code_key unique (user_id, code_prefix, code_number);
select pruebas.iguales(
  'identificadores',
  (select string_agg(entered_name || '=' || code, ', ' order by entered_name) from public.plants),
  'A1=CAT-001, A2=CAT-002, A3=CAT-003, A4=VAN-001, A5=BRA-001, B1=CAT-001'
);
select pruebas.iguales(
  'updated_at no se mueve',
  (select count(*) from public.plants where updated_at <> '2026-02-01'),
  0::bigint
);
select pruebas.iguales(
  'contadores',
  (select string_agg(user_id || ':' || prefix || '=' || last_number, ', ' order by user_id, prefix)
     from private.plant_code_counters),
  'user_a:BRA=1, user_a:CAT=3, user_a:VAN=1, user_b:CAT=1'
);
select pruebas.iguales('set_updated_at vuelve a estar activo',
  (select tgenabled::text from pg_trigger where tgname = 'set_updated_at' and tgrelid = 'public.plants'::regclass), 'O');
-- Idempotente, y la siguiente alta sigue la numeración.
select pruebas.iguales('segunda pasada', private.backfill_plant_codes(), 0::bigint);
insert into public.plants (user_id, entered_name, genus_id, type)
values ('user_a', 'Nueva', pruebas.genero('Cattleya'), 'unknown');
select pruebas.iguales('siguiente', (select code from public.plants where entered_name = 'Nueva'), 'CAT-004');

-- prueba: los contadores se borran con el perfil y no se leen por la API
insert into public.profiles (id) values ('user_a'), ('user_b');
insert into public.plants (user_id, entered_name, genus_id, type)
values ('user_a', 'Uno', pruebas.genero('Cattleya'), 'unknown'), ('user_b', 'Dos', pruebas.genero('Cattleya'), 'unknown');
delete from public.plants where user_id = 'user_a';
delete from public.profiles where id = 'user_a';
select pruebas.iguales(
  'contadores que quedan',
  (select string_agg(user_id || ':' || prefix, ', ') from private.plant_code_counters),
  'user_b:CAT'
);
select pruebas.comprobar(
  'nadie más que su dueño usa la tabla de contadores',
  not has_table_privilege('authenticated', 'private.plant_code_counters', 'select,insert,update,delete')
    and not has_table_privilege('anon', 'private.plant_code_counters', 'select,insert,update,delete')
    and not has_table_privilege('service_role', 'private.plant_code_counters', 'select,insert,update,delete')
);

-- prueba: las plantas de un usuario por identificador y el máximo de un prefijo usan el índice único
insert into public.plants (user_id, entered_name, genus_id, type)
select 'user_' || (i % 50), 'Relleno ' || i, pruebas.genero(case when i % 3 = 0 then 'Vanda' else 'Cattleya' end), 'unknown'
  from generate_series(1, 5000) i;
analyze public.plants;
do $$
declare
  plan text := '';
  linea text;
begin
  for linea in
    explain
    select p.code from public.plants p
     where p.user_id = 'user_7'
     order by p.code_prefix, p.code_number
  loop
    plan := plan || linea || E'\n';
  end loop;
  perform pruebas.comprobar('el plan usa plants_user_id_code_key:' || E'\n' || plan, plan like '%plants_user_id_code_key%');
  -- El máximo de un prefijo, que calcula el disparador de alta.
  plan := '';
  for linea in
    explain
    select max(p.code_number) from public.plants p where p.user_id = 'user_7' and p.code_prefix = 'CAT'
  loop
    plan := plan || linea || E'\n';
  end loop;
  perform pruebas.comprobar('el máximo usa plants_user_id_code_key:' || E'\n' || plan, plan like '%plants_user_id_code_key%');
end;
$$;
