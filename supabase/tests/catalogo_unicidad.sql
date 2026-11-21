-- Unicidad sin distinguir mayúsculas y nombres limpios en el catálogo.
--
-- Los nombres del catálogo se guardan sin espacios al principio ni al final y sin espacios
-- repetidos por dentro (restricciones *_clean), y son únicos ignorando mayúsculas (índices
-- únicos sobre lower(...)).

-- Datos de partida: una especie importada de GBIF con un nombre común.
insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
values ('Phalaenopsis amabilis', pruebas.genero('Phalaenopsis'), 'species', 'imported', 'gbif', '2817457');
insert into public.species_names (species_id, name, type, language)
values (pruebas.especie('Phalaenopsis amabilis'), 'Moth orchid', 'common', 'en');

-- prueba: géneros: no se repite un nombre con otras mayúsculas
select pruebas.debe_fallar(
  'PHALAENOPSIS ya existe como Phalaenopsis',
  $$insert into public.genera (name) values ('PHALAENOPSIS')$$,
  '23505', 'genera_name_key'
);
select pruebas.debe_funcionar('un género nuevo', $$insert into public.genera (name) values ('Restrepia')$$);
select pruebas.debe_fallar(
  'restrepia ya existe como Restrepia',
  $$insert into public.genera (name) values ('restrepia')$$,
  '23505', 'genera_name_key'
);

-- prueba: géneros: rechaza nombres vacíos o con espacios sobrantes
select pruebas.debe_fallar('vacío', $$insert into public.genera (name) values ('')$$, '23514', 'genera_name_clean');
select pruebas.debe_fallar('espacio inicial', $$insert into public.genera (name) values (' Restrepia')$$, '23514', 'genera_name_clean');
select pruebas.debe_fallar('espacio final', $$insert into public.genera (name) values ('Restrepia ')$$, '23514', 'genera_name_clean');
select pruebas.debe_fallar('espacio doble', $$insert into public.genera (name) values ('Restre  pia')$$, '23514', 'genera_name_clean');
select pruebas.debe_fallar('tabulador', $$insert into public.genera (name) values (E'Restrepia\t')$$, '23514', 'genera_name_clean');
select pruebas.debe_fallar(
  'renombrar uno existente con espacio final',
  $$update public.genera set name = 'Vanda ' where name = 'Vanda'$$,
  '23514', 'genera_name_clean'
);

-- prueba: géneros: la ruta de la foto, si existe, no puede quedar en blanco
select pruebas.debe_fallar(
  'ruta en blanco',
  $$update public.genera set photo_path = '  ' where name = 'Vanda'$$,
  '23514', 'genera_photo_path_not_blank'
);
select pruebas.debe_funcionar('ruta válida', $$update public.genera set photo_path = 'genera/vanda.jpg' where name = 'Vanda'$$);

-- prueba: abreviaturas: no se repiten con otras mayúsculas, ni siquiera en otro género
select pruebas.debe_fallar(
  'phal. ya es la abreviatura de Phalaenopsis',
  $$insert into public.genus_abbreviations (genus_id, abbreviation) values (pruebas.genero('Phalaenopsis'), 'phal.')$$,
  '23505', 'genus_abbreviations_abbreviation_key'
);
select pruebas.debe_fallar(
  'PHAL. en otro género',
  $$insert into public.genus_abbreviations (genus_id, abbreviation) values (pruebas.genero('Vanda'), 'PHAL.')$$,
  '23505', 'genus_abbreviations_abbreviation_key'
);

-- prueba: abreviaturas: un género puede tener varias, siempre limpias
select pruebas.debe_funcionar(
  'segunda abreviatura de Phalaenopsis',
  $$insert into public.genus_abbreviations (genus_id, abbreviation) values (pruebas.genero('Phalaenopsis'), 'Phalaen.')$$
);
select pruebas.debe_fallar(
  'abreviatura con espacio final',
  $$insert into public.genus_abbreviations (genus_id, abbreviation) values (pruebas.genero('Vanda'), 'Vd. ')$$,
  '23514', 'genus_abbreviations_abbreviation_clean'
);
select pruebas.debe_fallar(
  'abreviatura vacía',
  $$insert into public.genus_abbreviations (genus_id, abbreviation) values (pruebas.genero('Vanda'), '')$$,
  '23514', 'genus_abbreviations_abbreviation_clean'
);

-- prueba: especies: no se repite un nombre científico con otras mayúsculas
select pruebas.debe_fallar(
  'phalaenopsis AMABILIS',
  $$insert into public.species (scientific_name, genus_id, type, status, source)
    values ('phalaenopsis AMABILIS', pruebas.genero('Phalaenopsis'), 'species', 'imported', 'curated')$$,
  '23505', 'species_scientific_name_key'
);

-- prueba: especies: rechaza nombres científicos vacíos o con espacios sobrantes
select pruebas.debe_fallar(
  'espacio doble',
  $$insert into public.species (scientific_name, genus_id, type, status, source)
    values ('Phalaenopsis  aphrodite', pruebas.genero('Phalaenopsis'), 'species', 'imported', 'curated')$$,
  '23514', 'species_scientific_name_clean'
);
select pruebas.debe_fallar(
  'espacio inicial',
  $$insert into public.species (scientific_name, genus_id, type, status, source)
    values (' Phalaenopsis aphrodite', pruebas.genero('Phalaenopsis'), 'species', 'imported', 'curated')$$,
  '23514', 'species_scientific_name_clean'
);
select pruebas.debe_fallar(
  'vacío',
  $$insert into public.species (scientific_name, genus_id, type, status, source)
    values ('', pruebas.genero('Phalaenopsis'), 'species', 'imported', 'curated')$$,
  '23514', 'species_scientific_name_clean'
);

-- prueba: especies: la referencia de la fuente es única dentro de cada fuente
select pruebas.debe_fallar(
  'la misma referencia de GBIF en otra especie',
  $$insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
    values ('Phalaenopsis aphrodite', pruebas.genero('Phalaenopsis'), 'species', 'imported', 'gbif', '2817457')$$,
  '23505', 'species_source_ref_key'
);
select pruebas.debe_funcionar(
  'la misma referencia en otra fuente',
  $$insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
    values ('Phalaenopsis aphrodite', pruebas.genero('Phalaenopsis'), 'species', 'imported', 'curated', '2817457')$$
);
select pruebas.debe_funcionar(
  'dos especies curadas sin referencia',
  $$insert into public.species (scientific_name, genus_id, type, status, source)
    values ('Vanda coerulea', pruebas.genero('Vanda'), 'species', 'validated', 'curated'),
           ('Vanda tricolor', pruebas.genero('Vanda'), 'species', 'validated', 'curated')$$
);

-- prueba: especies: la referencia no puede quedar en blanco y GBIF siempre la trae
select pruebas.debe_fallar(
  'referencia en blanco',
  $$insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
    values ('Vanda coerulea', pruebas.genero('Vanda'), 'species', 'validated', 'curated', ' ')$$,
  '23514', 'species_source_ref_not_blank'
);
select pruebas.debe_fallar(
  'especie de GBIF sin referencia',
  $$insert into public.species (scientific_name, genus_id, type, status, source)
    values ('Vanda coerulea', pruebas.genero('Vanda'), 'species', 'imported', 'gbif')$$,
  '23514', 'species_gbif_has_source_ref'
);

-- prueba: especies: lo importado del Catalogue of Life (col) siempre trae su referencia
select pruebas.debe_fallar(
  'especie de COL sin referencia',
  $$insert into public.species (scientific_name, genus_id, type, status, source)
    values ('Vanda coerulea', pruebas.genero('Vanda'), 'species', 'imported', 'col')$$,
  '23514', 'species_col_has_source_ref'
);
select pruebas.debe_funcionar(
  'especie de COL con referencia',
  $$insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
    values ('Vanda coerulea', pruebas.genero('Vanda'), 'species', 'imported', 'col', '4G2KQ')$$
);
select pruebas.debe_fallar(
  'quitar la referencia a una especie de COL',
  $$update public.species set source_ref = null where source = 'col' and source_ref = '4G2KQ'$$,
  '23514', 'species_col_has_source_ref'
);
select pruebas.debe_fallar(
  'la misma referencia de COL en otra especie',
  $$insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
    values ('Vanda tricolor', pruebas.genero('Vanda'), 'species', 'imported', 'col', '4G2KQ')$$,
  '23505', 'species_source_ref_key'
);
select pruebas.debe_funcionar(
  'la misma referencia en otra fuente no choca',
  $$insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
    values ('Vanda tricolor', pruebas.genero('Vanda'), 'species', 'imported', 'gbif', '4G2KQ')$$
);

-- prueba: especies: la importación actualiza por (source, source_ref) sin duplicar
insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
values ('Phalaenopsis amabilis', pruebas.genero('Phalaenopsis'), 'species', 'validated', 'gbif', '2817457')
on conflict (source, source_ref) do update set status = excluded.status;
select pruebas.iguales(
  'especies con la referencia 2817457 de GBIF',
  (select count(*) from public.species where source = 'gbif' and source_ref = '2817457'),
  1::bigint
);
select pruebas.iguales(
  'estado actualizado',
  (select status::text from public.species where source = 'gbif' and source_ref = '2817457'),
  'validated'
);

-- prueba: nombres alternativos: un nombre una sola vez por especie, sin distinguir mayúsculas ni tipo
select pruebas.debe_fallar(
  'moth ORCHID como sinónimo de la misma especie',
  $$insert into public.species_names (species_id, name, type)
    values (pruebas.especie('Phalaenopsis amabilis'), 'moth ORCHID', 'synonym')$$,
  '23505', 'species_names_species_id_name_key'
);
insert into public.species (scientific_name, genus_id, type, status, source)
values ('Phalaenopsis aphrodite', pruebas.genero('Phalaenopsis'), 'species', 'validated', 'curated');
select pruebas.debe_funcionar(
  'el mismo nombre en otra especie',
  $$insert into public.species_names (species_id, name, type, language)
    values (pruebas.especie('Phalaenopsis aphrodite'), 'Moth orchid', 'common', 'en')$$
);

-- prueba: nombres alternativos: rechaza nombres vacíos o con espacios sobrantes
select pruebas.debe_fallar(
  'espacio final',
  $$insert into public.species_names (species_id, name, type)
    values (pruebas.especie('Phalaenopsis amabilis'), 'Synadena amabilis ', 'synonym')$$,
  '23514', 'species_names_name_clean'
);
select pruebas.debe_fallar(
  'espacio doble',
  $$insert into public.species_names (species_id, name, type)
    values (pruebas.especie('Phalaenopsis amabilis'), 'Synadena  amabilis', 'synonym')$$,
  '23514', 'species_names_name_clean'
);
select pruebas.debe_fallar(
  'vacío',
  $$insert into public.species_names (species_id, name, type)
    values (pruebas.especie('Phalaenopsis amabilis'), '', 'synonym')$$,
  '23514', 'species_names_name_clean'
);

-- prueba: nombres alternativos: el idioma es una etiqueta corta como es, spa o pt-BR
select pruebas.debe_funcionar(
  'es, spa y pt-BR',
  $$insert into public.species_names (species_id, name, type, language)
    values (pruebas.especie('Phalaenopsis amabilis'), 'Orquídea mariposa', 'common', 'es'),
           (pruebas.especie('Phalaenopsis amabilis'), 'Orquídea polilla', 'common', 'spa'),
           (pruebas.especie('Phalaenopsis amabilis'), 'Orquídea-borboleta', 'common', 'pt-BR')$$
);
select pruebas.debe_fallar(
  'Español',
  $$insert into public.species_names (species_id, name, type, language)
    values (pruebas.especie('Phalaenopsis amabilis'), 'Flor de luna', 'common', 'Español')$$,
  '23514', 'species_names_language_format'
);
select pruebas.debe_fallar(
  'ES en mayúsculas',
  $$insert into public.species_names (species_id, name, type, language)
    values (pruebas.especie('Phalaenopsis amabilis'), 'Flor de luna', 'common', 'ES')$$,
  '23514', 'species_names_language_format'
);
