-- Sincronización de género y tipo entre plantas y especies, y marcas de tiempo (issue #49).
--
-- Una planta enlazada a una especie tiene siempre el género y el tipo de la especie y queda
-- validada; al desenlazarla conserva género y tipo y vuelve a pendiente (salvo que se marque
-- no identificable); y si cambian el género o el tipo de la especie, se propagan a sus plantas.

-- Datos de partida: tres especies y una planta de user_a sin especie, de Cattleya y tipo
-- desconocido.
insert into public.species (scientific_name, genus_id, type, status, source)
values
  ('Phalaenopsis amabilis', pruebas.genero('Phalaenopsis'), 'species', 'validated', 'curated'),
  ('Phalaenopsis Sogo Yukidian', pruebas.genero('Phalaenopsis'), 'hybrid', 'validated', 'curated'),
  ('Cattleya labiata', pruebas.genero('Cattleya'), 'species', 'validated', 'curated');
insert into public.plants (user_id, entered_name, genus_id, type)
values ('user_a', 'Mi phal', pruebas.genero('Cattleya'), 'unknown');

-- prueba: al enlazar una planta toma el género y el tipo de la especie y queda validada
update public.plants set species_id = pruebas.especie('Phalaenopsis amabilis') where entered_name = 'Mi phal';
select pruebas.iguales(
  'género, tipo y validación',
  (select g.name || ' ' || p.type || ' ' || p.validation
     from public.plants p join public.genera g on g.id = p.genus_id where p.entered_name = 'Mi phal'),
  'Phalaenopsis species validated'
);
-- El nombre ingresado se conserva.
select pruebas.iguales(
  'nombre ingresado',
  (select entered_name from public.plants where species_id = pruebas.especie('Phalaenopsis amabilis')),
  'Mi phal'
);

-- prueba: al insertar una planta ya enlazada se corrigen el género, el tipo y la validación
insert into public.plants (user_id, entered_name, genus_id, type, validation, species_id)
values ('user_b', 'Insertada', pruebas.genero('Vanda'), 'unknown', 'pending', pruebas.especie('Phalaenopsis Sogo Yukidian'));
select pruebas.iguales(
  'género, tipo y validación',
  (select g.name || ' ' || p.type || ' ' || p.validation
     from public.plants p join public.genera g on g.id = p.genus_id where p.entered_name = 'Insertada'),
  'Phalaenopsis hybrid validated'
);

-- prueba: al insertar una planta enlazada sin género ni tipo, los toma de la especie
insert into public.plants (user_id, entered_name, species_id)
values ('user_b', 'Solo especie', pruebas.especie('Cattleya labiata'));
select pruebas.iguales(
  'género, tipo y validación',
  (select g.name || ' ' || p.type || ' ' || p.validation
     from public.plants p join public.genera g on g.id = p.genus_id where p.entered_name = 'Solo especie'),
  'Cattleya species validated'
);

-- prueba: al desenlazar, la planta conserva género y tipo y vuelve a pending
update public.plants set species_id = pruebas.especie('Phalaenopsis amabilis') where entered_name = 'Mi phal';
update public.plants set species_id = null where entered_name = 'Mi phal';
select pruebas.iguales(
  'especie, género, tipo y validación',
  (select coalesce(p.species_id::text, 'sin especie') || ' ' || g.name || ' ' || p.type || ' ' || p.validation
     from public.plants p join public.genera g on g.id = p.genus_id where p.entered_name = 'Mi phal'),
  'sin especie Phalaenopsis species pending'
);

-- prueba: al desenlazar marcando unidentifiable, queda unidentifiable
update public.plants set species_id = pruebas.especie('Phalaenopsis amabilis') where entered_name = 'Mi phal';
update public.plants set species_id = null, validation = 'unidentifiable' where entered_name = 'Mi phal';
select pruebas.iguales(
  'especie, género, tipo y validación',
  (select coalesce(p.species_id::text, 'sin especie') || ' ' || g.name || ' ' || p.type || ' ' || p.validation
     from public.plants p join public.genera g on g.id = p.genus_id where p.entered_name = 'Mi phal'),
  'sin especie Phalaenopsis species unidentifiable'
);

-- prueba: al enlazar una planta no identificable, pasa a validated
update public.plants set validation = 'unidentifiable' where entered_name = 'Mi phal';
update public.plants set species_id = pruebas.especie('Cattleya labiata') where entered_name = 'Mi phal';
select pruebas.iguales(
  'validación',
  (select validation::text from public.plants where entered_name = 'Mi phal'),
  'validated'
);

-- prueba: cambiar el género, el tipo o la validación de una planta enlazada no la descuadra
update public.plants set species_id = pruebas.especie('Phalaenopsis amabilis') where entered_name = 'Mi phal';
update public.plants set genus_id = pruebas.genero('Vanda') where entered_name = 'Mi phal';
update public.plants set type = 'unknown' where entered_name = 'Mi phal';
update public.plants set validation = 'pending' where entered_name = 'Mi phal';
update public.plants set validation = 'unidentifiable' where entered_name = 'Mi phal';
select pruebas.iguales(
  'género, tipo y validación',
  (select g.name || ' ' || p.type || ' ' || p.validation
     from public.plants p join public.genera g on g.id = p.genus_id where p.entered_name = 'Mi phal'),
  'Phalaenopsis species validated'
);

-- prueba: al cambiar de especie, la planta toma el género y el tipo de la nueva
update public.plants set species_id = pruebas.especie('Phalaenopsis Sogo Yukidian') where entered_name = 'Mi phal';
update public.plants set species_id = pruebas.especie('Cattleya labiata') where entered_name = 'Mi phal';
select pruebas.iguales(
  'género, tipo y validación',
  (select g.name || ' ' || p.type || ' ' || p.validation
     from public.plants p join public.genera g on g.id = p.genus_id where p.entered_name = 'Mi phal'),
  'Cattleya species validated'
);

-- prueba: enlazar a una especie inexistente se rechaza
-- Si la planta ya estaba enlazada, la rechaza la clave foránea.
update public.plants set species_id = pruebas.especie('Cattleya labiata') where entered_name = 'Mi phal';
select pruebas.debe_fallar(
  'planta enlazada a una especie inexistente',
  $$update public.plants set species_id = gen_random_uuid() where entered_name = 'Mi phal'$$,
  '23503', 'plants_species_id_fkey'
);
-- Si no lo estaba, también: el disparador marca la fila como validada para que la restricción
-- de coherencia no salte antes y el error sea el de la clave foránea, que describe el problema.
update public.plants set species_id = null where entered_name = 'Mi phal';
select pruebas.debe_fallar(
  'planta sin enlazar a una especie inexistente',
  $$update public.plants set species_id = gen_random_uuid() where entered_name = 'Mi phal'$$,
  '23503', 'plants_species_id_fkey'
);
select pruebas.debe_fallar(
  'planta nueva con una especie inexistente',
  $$insert into public.plants (user_id, entered_name, genus_id, type, species_id)
    values ('user_a', 'x', pruebas.genero('Vanda'), 'unknown', gen_random_uuid())$$,
  '23503', 'plants_species_id_fkey'
);

-- prueba: una planta sin especie puede cambiar libremente de género y tipo
update public.plants set genus_id = pruebas.genero('Vanda'), type = 'hybrid' where entered_name = 'Mi phal';
select pruebas.iguales(
  'género, tipo y validación',
  (select g.name || ' ' || p.type || ' ' || p.validation
     from public.plants p join public.genera g on g.id = p.genus_id where p.entered_name = 'Mi phal'),
  'Vanda hybrid pending'
);

-- prueba: al cambiar el género de una especie, se propaga a sus plantas de todos los usuarios
insert into public.plants (user_id, entered_name, species_id)
values
  ('user_a', 'Amabilis A1', pruebas.especie('Phalaenopsis amabilis')),
  ('user_a', 'Amabilis A2', pruebas.especie('Phalaenopsis amabilis')),
  ('user_b', 'Amabilis B1', pruebas.especie('Phalaenopsis amabilis')),
  ('user_c', 'Yukidian C1', pruebas.especie('Phalaenopsis Sogo Yukidian'));
update public.species set genus_id = pruebas.genero('Dendrobium') where scientific_name = 'Phalaenopsis amabilis';
select pruebas.iguales(
  'género de las plantas de la especie',
  (select string_agg(p.user_id || ':' || g.name, ', ' order by p.entered_name)
     from public.plants p join public.genera g on g.id = p.genus_id
     where p.species_id = pruebas.especie('Phalaenopsis amabilis')),
  'user_a:Dendrobium, user_a:Dendrobium, user_b:Dendrobium'
);
select pruebas.iguales(
  'las plantas de otra especie no cambian',
  (select g.name from public.plants p join public.genera g on g.id = p.genus_id where p.entered_name = 'Yukidian C1'),
  'Phalaenopsis'
);

-- prueba: al cambiar el tipo de una especie, se propaga a sus plantas
insert into public.plants (user_id, entered_name, species_id)
values
  ('user_a', 'Amabilis A1', pruebas.especie('Phalaenopsis amabilis')),
  ('user_b', 'Amabilis B1', pruebas.especie('Phalaenopsis amabilis'));
update public.species set type = 'hybrid' where scientific_name = 'Phalaenopsis amabilis';
select pruebas.iguales(
  'tipo de las plantas de la especie',
  (select string_agg(distinct p.type::text, ', ')
     from public.plants p where p.species_id = pruebas.especie('Phalaenopsis amabilis')),
  'hybrid'
);
-- Género y tipo a la vez.
update public.species
  set genus_id = pruebas.genero('Oncidium'), type = 'species'
  where scientific_name = 'Phalaenopsis amabilis';
select pruebas.iguales(
  'género y tipo de las plantas de la especie',
  (select string_agg(distinct g.name || ' ' || p.type, ', ')
     from public.plants p join public.genera g on g.id = p.genus_id
     where p.species_id = pruebas.especie('Phalaenopsis amabilis')),
  'Oncidium species'
);

-- prueba: la propagación funciona aunque quien edita la especie no tenga permisos sobre plants
-- Un rol de prueba que solo puede leer y actualizar especies (como lo hará un administrador
-- desde la API en #6). Los roles también se revierten con la transacción.
create role orki_pruebas_editor nologin;
grant usage on schema public to orki_pruebas_editor;
grant select, update on public.species to orki_pruebas_editor;
-- Quien escribe en species calcula el índice de búsqueda del nombre científico (#68), y para
-- eso necesita usar el esquema extensions, que postgres no puede conceder. Como aquí solo
-- importa la propagación, se quitan los índices (vuelven con el rollback de la prueba): el de
-- trigramas y el de orden por prefijo de la migración 20261120230000. El caso real, un
-- administrador con authenticated, está en politicas_catalogo.sql.
drop index public.species_scientific_name_trgm_idx;
drop index public.species_scientific_name_prefix_idx;
create policy orki_pruebas_editor_species on public.species
  for all to orki_pruebas_editor using (true) with check (true);
insert into public.plants (user_id, entered_name, species_id)
values ('user_a', 'Amabilis A1', pruebas.especie('Phalaenopsis amabilis'));
select pruebas.comprobar(
  'el editor no tiene privilegios sobre plants',
  not has_table_privilege('orki_pruebas_editor', 'public.plants', 'select, update')
);
-- El id del género se obtiene antes, porque el editor no puede leer genera.
select pruebas.genero('Vanda') as id_vanda \gset
set local role orki_pruebas_editor;
update public.species set genus_id = :'id_vanda' where scientific_name = 'Phalaenopsis amabilis';
set local role postgres;
select pruebas.iguales(
  'género de la planta tras el cambio del editor',
  (select g.name from public.plants p join public.genera g on g.id = p.genus_id where p.entered_name = 'Amabilis A1'),
  'Vanda'
);

-- prueba: al actualizar cualquier tabla, updated_at pasa a ser la hora actual y created_at no cambia
-- Filas con marcas antiguas (al insertar no actúa ningún disparador), que después se
-- actualizan intentando también reescribir las marcas.
insert into public.genera (name, created_at, updated_at) values ('Restrepia', '2000-01-01', '2000-01-01');
insert into public.genus_abbreviations (genus_id, abbreviation, created_at, updated_at)
values (pruebas.genero('Restrepia'), 'Rstp.', '2000-01-01', '2000-01-01');
insert into public.species (scientific_name, genus_id, type, status, source, created_at, updated_at)
values ('Restrepia coccinea', pruebas.genero('Restrepia'), 'species', 'validated', 'curated', '2000-01-01', '2000-01-01');
insert into public.species_names (species_id, name, type, created_at, updated_at)
values (pruebas.especie('Restrepia coccinea'), 'Restrepia roja', 'common', '2000-01-01', '2000-01-01');
insert into public.profiles (id, created_at, updated_at) values ('user_marcas', '2000-01-01', '2000-01-01');
insert into public.plants (user_id, entered_name, genus_id, type, created_at, updated_at)
values ('user_marcas', 'Marcas', pruebas.genero('Restrepia'), 'unknown', '2000-01-01', '2000-01-01');
update public.genera set is_quick_access = false, created_at = '1999-01-01', updated_at = '1999-01-01' where name = 'Restrepia';
update public.genus_abbreviations set abbreviation = 'Restr.', created_at = '1999-01-01', updated_at = '1999-01-01' where abbreviation = 'Rstp.';
update public.species set status = 'observed', created_at = '1999-01-01', updated_at = '1999-01-01' where scientific_name = 'Restrepia coccinea';
update public.species_names set language = 'es', created_at = '1999-01-01', updated_at = '1999-01-01' where name = 'Restrepia roja';
update public.profiles set preferred_language = 'en', created_at = '1999-01-01', updated_at = '1999-01-01' where id = 'user_marcas';
update public.plants set nickname = 'Roja', created_at = '1999-01-01', updated_at = '1999-01-01' where entered_name = 'Marcas';
select pruebas.iguales(
  'tablas cuyo updated_at es ahora y cuyo created_at sigue en 2000',
  (select string_agg(tabla, ', ' order by tabla) from (
     select 'genera' as tabla, created_at, updated_at from public.genera where name = 'Restrepia'
     union all select 'genus_abbreviations', created_at, updated_at from public.genus_abbreviations where abbreviation = 'Restr.'
     union all select 'species', created_at, updated_at from public.species where scientific_name = 'Restrepia coccinea'
     union all select 'species_names', created_at, updated_at from public.species_names where name = 'Restrepia roja'
     union all select 'profiles', created_at, updated_at from public.profiles where id = 'user_marcas'
     union all select 'plants', created_at, updated_at from public.plants where entered_name = 'Marcas'
   ) filas
   where updated_at = now() and created_at = '2000-01-01'),
  'genera, genus_abbreviations, plants, profiles, species, species_names'
);

-- prueba: la propagación desde la especie también actualiza updated_at de las plantas afectadas
insert into public.plants (user_id, entered_name, species_id, created_at, updated_at)
values
  ('user_a', 'Afectada', pruebas.especie('Phalaenopsis amabilis'), '2000-01-01', '2000-01-01'),
  ('user_a', 'No afectada', pruebas.especie('Cattleya labiata'), '2000-01-01', '2000-01-01');
update public.species set genus_id = pruebas.genero('Vanda') where scientific_name = 'Phalaenopsis amabilis';
select pruebas.iguales(
  'updated_at de la planta de la especie cambiada',
  (select updated_at = now() from public.plants where entered_name = 'Afectada'),
  true
);
select pruebas.iguales(
  'updated_at de la planta de otra especie',
  (select updated_at from public.plants where entered_name = 'No afectada'),
  '2000-01-01'::timestamptz
);

-- prueba: ninguna planta enlazada queda con género, tipo o validación distintos de su especie
-- Comprobación global tras una serie de cambios mezclados en especies y plantas.
insert into public.plants (user_id, entered_name, species_id)
select 'user_' || n, 'Mezcla ' || n,
  case n % 3 when 0 then pruebas.especie('Phalaenopsis amabilis')
             when 1 then pruebas.especie('Phalaenopsis Sogo Yukidian')
             else pruebas.especie('Cattleya labiata') end
from generate_series(1, 12) n;
update public.plants set species_id = null where entered_name in ('Mezcla 1', 'Mezcla 2');
update public.plants set species_id = pruebas.especie('Cattleya labiata') where entered_name = 'Mezcla 3';
update public.species set genus_id = pruebas.genero('Dendrobium'), type = 'hybrid' where scientific_name = 'Cattleya labiata';
update public.species set type = 'species' where scientific_name = 'Phalaenopsis Sogo Yukidian';
select pruebas.iguales(
  'plantas incoherentes',
  (select count(*) from public.plants p left join public.species s on s.id = p.species_id
     where (p.species_id is not null
            and (p.genus_id <> s.genus_id or p.type::text <> s.type::text or p.validation <> 'validated'))
        or (p.species_id is null and p.validation = 'validated')),
  0::bigint
);
