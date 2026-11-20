-- Borrados en cascada y restringidos.
--
-- Se borra en cascada lo que pertenece a otra fila (abreviaturas de un género, nombres de una
-- especie) y se restringe lo que se perdería sin querer (géneros con especies o plantas,
-- especies con plantas).

-- Datos de partida: un género sin especies con su abreviatura, y dos especies con nombres.
insert into public.genera (name) values ('Masdevallia');
insert into public.genus_abbreviations (genus_id, abbreviation) values (pruebas.genero('Masdevallia'), 'Masd.');
insert into public.species (scientific_name, genus_id, type, status, source)
values
  ('Cattleya labiata', pruebas.genero('Cattleya'), 'species', 'validated', 'curated'),
  ('Cattleya trianae', pruebas.genero('Cattleya'), 'species', 'validated', 'curated');
insert into public.species_names (species_id, name, type)
values
  (pruebas.especie('Cattleya labiata'), 'Cattleya de Pernambuco', 'common'),
  (pruebas.especie('Cattleya labiata'), 'Epidendrum labiatum', 'synonym'),
  (pruebas.especie('Cattleya trianae'), 'Flor de mayo', 'common');

-- prueba: un género con especies no se puede borrar
select pruebas.debe_fallar(
  'borrar Cattleya, que tiene especies',
  $$delete from public.genera where name = 'Cattleya'$$,
  '23503', 'species_genus_id_fkey'
);

-- prueba: al borrar un género sin especies se borran sus abreviaturas
delete from public.genera where name = 'Masdevallia';
select pruebas.iguales(
  'abreviaturas de Masdevallia que quedan',
  (select count(*) from public.genus_abbreviations where abbreviation = 'Masd.'),
  0::bigint
);
select pruebas.iguales('abreviaturas de otros géneros', (select count(*) from public.genus_abbreviations), 5::bigint);

-- prueba: al borrar una especie se borran sus nombres alternativos y solo los suyos
delete from public.species where scientific_name = 'Cattleya labiata';
select pruebas.iguales(
  'nombres alternativos que quedan',
  (select string_agg(name, ', ') from public.species_names),
  'Flor de mayo'
);

-- prueba: una especie con plantas enlazadas no se puede borrar
insert into public.plants (user_id, entered_name, species_id)
values ('user_borrados', 'Mi labiata', pruebas.especie('Cattleya labiata'));
select pruebas.debe_fallar(
  'borrar Cattleya labiata, que tiene una planta',
  $$delete from public.species where scientific_name = 'Cattleya labiata'$$,
  '23503', 'plants_species_id_fkey'
);
-- Desenlazada la planta, ya se puede borrar.
update public.plants set species_id = null where entered_name = 'Mi labiata';
select pruebas.debe_funcionar(
  'borrar la especie tras desenlazar la planta',
  $$delete from public.species where scientific_name = 'Cattleya labiata'$$
);

-- prueba: un género usado por una planta sin especie no se puede borrar
insert into public.plants (user_id, entered_name, genus_id, type)
values ('user_borrados', 'Mi masdevallia', pruebas.genero('Masdevallia'), 'unknown');
select pruebas.debe_fallar(
  'borrar Masdevallia, que tiene una planta',
  $$delete from public.genera where name = 'Masdevallia'$$,
  '23503', 'plants_genus_id_fkey'
);

-- prueba: borrar una planta no toca su especie ni el género
insert into public.plants (user_id, entered_name, species_id)
values ('user_borrados', 'Mi trianae', pruebas.especie('Cattleya trianae'));
delete from public.plants where entered_name = 'Mi trianae';
select pruebas.iguales(
  'la especie sigue',
  (select count(*) from public.species where scientific_name = 'Cattleya trianae'),
  1::bigint
);
select pruebas.iguales('su nombre común sigue', (select count(*) from public.species_names), 3::bigint);
