-- Fotos de referencia de las especies (#234, parte de #180): public.species_photos, la memoria
-- de retiradas public.species_photo_rejections, el bucket species-photos, la foto en las
-- funciones del catálogo público, public.retire_species_photo() y la foto en merge_species(), de
-- la migración 20261124110000_fotos_de_referencia.sql.
--
-- La carga escribe como postgres (conexión directa) o con la clave de servicio: aquí se simula
-- insertando como postgres con pg_temp.foto(). El administrador lleva el claim app_role =
-- catalog_admin, como en el backoffice. Cada llamada a la API es una transacción; el final de
-- una se simula vaciando orki.catalog_action_id (como en fusion_especies.sql). Los nombres
-- inventados se señalan con «ficticio».

-- Datos de partida, sin token (no dejan auditoría).
insert into public.genera (name) values ('Doritis');

insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
values
  ('Phalaenopsis amabilis', pruebas.genero('Phalaenopsis'), 'species', 'imported', 'col', 'PAMA1'),
  ('Phalaenopsis aphrodite', pruebas.genero('Phalaenopsis'), 'species', 'imported', 'col', 'PAPH1'),
  ('Phalaenopsis pulcherrima', pruebas.genero('Phalaenopsis'), 'species', 'imported', 'col', 'PPUL1'),
  ('Doritis pulcherrima', pruebas.genero('Doritis'), 'species', 'imported', 'col', 'DPUL1'),
  ('Cattleya labiata', pruebas.genero('Cattleya'), 'species', 'validated', 'col', 'CLAB1'),
  -- ficticio: propuesta de un usuario sin validar, no pública.
  ('Cattleya escondida', pruebas.genero('Cattleya'), 'species', 'observed', 'user_proposal', null);

insert into public.profiles (id) values ('user_a'), ('user_b');
insert into public.plants (user_id, entered_name, species_id)
values ('user_a', 'Mi doritis', pruebas.especie('Doritis pulcherrima'));

-- Inserta como la carga la foto de iNaturalist «id» para una especie, con las rutas de la
-- convención, y devuelve el id de la fila.
create function pg_temp.foto(
  especie text,
  id_foto text,
  licencia text default 'cc-by',
  autor text default 'Ana Pérez'
)
returns uuid
language sql
as $$
  insert into public.species_photos (
    species_id, medium_path, medium_width, medium_height, thumbnail_path, thumbnail_width,
    thumbnail_height, source, source_photo_id, source_taxon_id, source_selection, source_url,
    license, author_name, attribution, obtained_at
  )
  select s.id, s.id::text || '/medium-' || id_foto || '.webp', 500, 375,
         s.id::text || '/thumb-' || id_foto || '.webp', 160, 120,
         'inaturalist', id_foto, '47215', 'taxon_default',
         'https://www.inaturalist.org/photos/' || id_foto,
         licencia, autor, '(c) ' || autor || ', some rights reserved (CC BY)', now() - interval '1 day'
  from public.species s
  where s.scientific_name = especie
  returning id
$$;

-- La foto de una especie: «id de la foto (licencia, autor) rutas», o «ninguna».
create function pg_temp.foto_de(especie text)
returns text
language sql
as $$
  select coalesce(
    (select p.source_photo_id || ' (' || p.license || ', ' || p.author_name || ') '
            || replace(p.medium_path, s.id::text, '<especie>') || ' '
            || replace(p.thumbnail_path, s.id::text, '<especie>')
       from public.species_photos p
       join public.species s on s.id = p.species_id
       where s.scientific_name = especie),
    'ninguna')
$$;

-- Las retiradas de una especie: «id de la foto:motivo», en orden, o «ninguna».
create function pg_temp.retiradas(especie text)
returns text
language sql
as $$
  select coalesce(string_agg(r.source_photo_id || ':' || r.reason, ', ' order by r.source_photo_id), 'ninguna')
  from public.species_photo_rejections r
  join public.species s on s.id = r.species_id
  where s.scientific_name = especie
$$;

-- Fin de una petición a la API.
create function pg_temp.fin_de_peticion()
returns void
language sql
as $$
  select set_config('orki.catalog_action_id', '', true)
$$;

-- Una fila de species_photos completa y válida para la especie, con un cambio aplicado (columna
-- = valor, como texto SQL); para probar cada restricción con una sola columna distinta.
create function pg_temp.insertar_con(especie text, columna text, valor text)
returns text
language sql
as $$
  select format(
    $f$insert into public.species_photos (
      species_id, medium_path, medium_width, medium_height, thumbnail_path, thumbnail_width,
      thumbnail_height, source, source_photo_id, source_observation_id, source_taxon_id,
      source_selection, source_url, license, author_name, attribution, obtained_at)
    select v.species_id, v.medium_path, v.medium_width, v.medium_height, v.thumbnail_path,
      v.thumbnail_width, v.thumbnail_height, v.source::public.species_photo_source, v.source_photo_id,
      v.source_observation_id, v.source_taxon_id, v.source_selection, v.source_url, v.license,
      v.author_name, v.attribution, v.obtained_at
    from (select s.id as species_id,
                 s.id::text || '/medium-900.webp' as medium_path, 500 as medium_width, 375 as medium_height,
                 s.id::text || '/thumb-900.webp' as thumbnail_path, 160 as thumbnail_width, 120 as thumbnail_height,
                 'inaturalist' as source, '900' as source_photo_id, null::text as source_observation_id,
                 '47215' as source_taxon_id, 'taxon_default' as source_selection,
                 'https://www.inaturalist.org/photos/900' as source_url, 'cc-by' as license,
                 'Ana Pérez' as author_name, '(c) Ana Pérez, some rights reserved (CC BY)' as attribution,
                 now() as obtained_at
          from public.species s where s.scientific_name = %L) d
    cross join lateral jsonb_populate_record(
      null::pg_temp.fila_foto, to_jsonb(d) || jsonb_build_object(%L, %s)) v$f$,
    especie, columna, valor)
$$;

create type pg_temp.fila_foto as (
  species_id uuid, medium_path text, medium_width integer, medium_height integer,
  thumbnail_path text, thumbnail_width integer, thumbnail_height integer, source text,
  source_photo_id text, source_observation_id text, source_taxon_id text, source_selection text,
  source_url text, license text, author_name text, attribution text, obtained_at timestamptz
);

-- Desde el #283, las funciones que crea postgres no nacen ejecutables por PUBLIC: las de
-- ayuda de este archivo se abren a mano para poder llamarlas con otros roles.
grant execute on all functions in schema pg_temp to public;

-- prueba: restricciones: solo las cuatro licencias aceptadas, con los códigos de iNaturalist
select pruebas.debe_funcionar('cc0', $$select pg_temp.foto('Phalaenopsis amabilis', '1', 'cc0')$$);
select pruebas.debe_funcionar('pd', $$select pg_temp.foto('Phalaenopsis aphrodite', '2', 'pd')$$);
select pruebas.debe_funcionar('cc-by', $$select pg_temp.foto('Phalaenopsis pulcherrima', '3', 'cc-by')$$);
select pruebas.debe_funcionar('cc-by-sa', $$select pg_temp.foto('Doritis pulcherrima', '4', 'cc-by-sa')$$);
do $$
declare
  licencia text;
begin
  foreach licencia in array array['cc-by-nc', 'cc-by-nd', 'cc-by-nc-sa', 'cc-by-nc-nd', 'CC-BY', 'cc by', '', 'c'] loop
    perform pruebas.debe_fallar('licencia ' || licencia,
      format($f$select pg_temp.foto('Cattleya labiata', '5', %L)$f$, licencia),
      '23514', 'species_photos_license_accepted');
  end loop;
end;
$$;
select pruebas.debe_fallar('licencia nula (todos los derechos reservados)',
  $$select pg_temp.foto('Cattleya labiata', '5', null)$$, '23502');
select pruebas.debe_fallar('cambiar la licencia a una no aceptada',
  $$update public.species_photos set license = 'cc-by-nc'$$, '23514', 'species_photos_license_accepted');

-- prueba: restricciones: no puede existir una foto sin autor ni atribución
select pruebas.debe_fallar('autor en blanco', $$select pg_temp.foto('Cattleya labiata', '5', 'cc-by', '   ')$$,
  '23514', 'species_photos_author_name_valid');
select pruebas.debe_fallar('autor nulo', $$select pg_temp.foto('Cattleya labiata', '5', 'cc-by', null)$$, '23502');
select pruebas.debe_fallar('autor de más de 200 caracteres',
  $$select pg_temp.foto('Cattleya labiata', '5', 'cc-by', repeat('a', 201))$$, '23514', 'species_photos_author_name_valid');
select pruebas.debe_fallar('atribución en blanco',
  pg_temp.insertar_con('Cattleya labiata', 'attribution', $$' '$$), '23514', 'species_photos_attribution_valid');
select pruebas.debe_fallar('atribución nula',
  pg_temp.insertar_con('Cattleya labiata', 'attribution', 'null'), '23502');
select pruebas.debe_fallar('atribución de más de 500 caracteres',
  pg_temp.insertar_con('Cattleya labiata', 'attribution', $$repeat('a', 501)$$), '23514', 'species_photos_attribution_valid');
select pruebas.debe_funcionar('la fila de partida es válida', pg_temp.insertar_con('Cattleya labiata', 'license', $$'cc0'$$));

-- prueba: restricciones: una foto por especie
select pg_temp.foto('Phalaenopsis amabilis', '1');
select pruebas.debe_fallar('segunda foto de la misma especie',
  $$select pg_temp.foto('Phalaenopsis amabilis', '6')$$, '23505', 'species_photos_species_id_key');
select pruebas.debe_funcionar('la misma foto de iNaturalist en otra especie',
  $$select pg_temp.foto('Phalaenopsis aphrodite', '1')$$);

-- prueba: restricciones: identificadores, enlace, selección, rutas y medidas
select pruebas.debe_fallar('id de foto que no es un número',
  pg_temp.insertar_con('Cattleya labiata', 'source_photo_id', $$'abc'$$), '23514', 'species_photos_source_ids_valid');
select pruebas.debe_fallar('id de observación que no es un número',
  pg_temp.insertar_con('Cattleya labiata', 'source_observation_id', $$'0'$$), '23514', 'species_photos_source_ids_valid');
select pruebas.debe_fallar('id de taxón que no es un número',
  pg_temp.insertar_con('Cattleya labiata', 'source_taxon_id', $$'-1'$$), '23514', 'species_photos_source_ids_valid');
select pruebas.debe_fallar('enlace a otra foto',
  pg_temp.insertar_con('Cattleya labiata', 'source_url', $$'https://www.inaturalist.org/photos/901'$$),
  '23514', 'species_photos_source_url_valid');
select pruebas.debe_fallar('enlace a otro sitio',
  pg_temp.insertar_con('Cattleya labiata', 'source_url', $$'http://example.com/900'$$),
  '23514', 'species_photos_source_url_valid');
select pruebas.debe_fallar('enlace nulo', pg_temp.insertar_con('Cattleya labiata', 'source_url', 'null'), '23502');
select pruebas.debe_fallar('selección desconocida',
  pg_temp.insertar_con('Cattleya labiata', 'source_selection', $$'random'$$), '23514', 'species_photos_source_selection_valid');
select pruebas.debe_fallar('foto de observación sin la observación',
  pg_temp.insertar_con('Cattleya labiata', 'source_selection', $$'observation'$$), '23514', 'species_photos_source_selection_valid');
select pruebas.debe_fallar('ruta sin carpeta de especie',
  pg_temp.insertar_con('Cattleya labiata', 'medium_path', $$'medium-900.webp'$$), '23514', 'species_photos_medium_path_valid');
select pruebas.debe_fallar('ruta con subcarpetas',
  pg_temp.insertar_con('Cattleya labiata', 'thumbnail_path', $$d.species_id::text || '/a/thumb-900.webp'$$),
  '23514', 'species_photos_thumbnail_path_valid');
select pruebas.debe_fallar('ruta en JPEG',
  pg_temp.insertar_con('Cattleya labiata', 'medium_path', $$d.species_id::text || '/medium-900.jpg'$$),
  '23514', 'species_photos_medium_path_valid');
select pruebas.debe_fallar('ruta con el id de usuario de Clerk',
  pg_temp.insertar_con('Cattleya labiata', 'medium_path', $$'user_a/medium-900.webp'$$), '23514', 'species_photos_medium_path_valid');
select pruebas.debe_fallar('las dos versiones en carpetas distintas',
  pg_temp.insertar_con('Cattleya labiata', 'thumbnail_path', $$gen_random_uuid()::text || '/thumb-900.webp'$$),
  '23514', 'species_photos_paths_same_folder');
select pruebas.debe_fallar('la misma ruta para las dos',
  pg_temp.insertar_con('Cattleya labiata', 'thumbnail_path', $$d.species_id::text || '/medium-900.webp'$$),
  '23514', 'species_photos_paths_same_folder');
select pruebas.debe_fallar('medio sin reducir',
  pg_temp.insertar_con('Cattleya labiata', 'medium_width', '2048'), '23514', 'species_photos_medium_size_valid');
select pruebas.debe_fallar('miniatura demasiado grande',
  pg_temp.insertar_con('Cattleya labiata', 'thumbnail_height', '500'), '23514', 'species_photos_thumbnail_size_valid');
select pruebas.debe_fallar('medida cero',
  pg_temp.insertar_con('Cattleya labiata', 'thumbnail_width', '0'), '23514', 'species_photos_thumbnail_size_valid');
select pruebas.debe_fallar('fuente desconocida',
  pg_temp.insertar_con('Cattleya labiata', 'source', $$'flickr'$$), '22P02');
select pruebas.debe_funcionar('foto de observación con la observación',
  pg_temp.insertar_con('Cattleya labiata', 'source_observation_id', $$'123456'$$));
select pruebas.iguales(
  'adaptada por defecto, y fechas',
  (select p.is_modified || ' ' || (p.created_at = now()) || ' ' || (p.updated_at = now())
     from public.species_photos p where p.species_id = pruebas.especie('Cattleya labiata')),
  'true true true'
);

-- prueba: cascada: al borrar la especie se borran su foto y sus retiradas
select pg_temp.foto('Cattleya labiata', '10');
insert into public.species_photo_rejections (species_id, source, source_photo_id, source_url, author_name, reason, rejected_by, action_id)
values (pruebas.especie('Cattleya labiata'), 'inaturalist', '9', 'https://www.inaturalist.org/photos/9', 'Ana Pérez',
        'misidentified', 'admin_1', gen_random_uuid());
delete from public.species where scientific_name = 'Cattleya labiata';
select pruebas.iguales('fotos que quedan', (select count(*) from public.species_photos), 0::bigint);
select pruebas.iguales('retiradas que quedan', (select count(*) from public.species_photo_rejections), 0::bigint);

-- prueba: permisos: RLS en las dos tablas y privilegios por rol
select pruebas.iguales(
  'RLS',
  (select string_agg(c.relname || '=' || c.relrowsecurity, ', ' order by c.relname)
     from pg_class c where c.oid in ('public.species_photos'::regclass, 'public.species_photo_rejections'::regclass)),
  'species_photo_rejections=true, species_photos=true'
);
select pruebas.iguales(
  'privilegios',
  (select string_agg(t.tabla || ':' || r.rol || '=' || p.privilegio, ', ' order by t.tabla, r.rol, p.privilegio)
     from (values ('species_photos'), ('species_photo_rejections')) t (tabla)
     cross join (values ('anon'), ('authenticated'), ('service_role')) r (rol)
     cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p (privilegio)
     where has_table_privilege(r.rol, 'public.' || t.tabla, p.privilegio)),
  'species_photo_rejections:authenticated=SELECT, species_photo_rejections:service_role=SELECT, '
    || 'species_photos:authenticated=SELECT, species_photos:service_role=DELETE, species_photos:service_role=INSERT, '
    || 'species_photos:service_role=SELECT, species_photos:service_role=UPDATE'
);
select pruebas.iguales(
  'políticas',
  (select string_agg(p.tablename || '.' || p.policyname || ':' || p.cmd || ':' || array_to_string(p.roles, ','), ', '
                     order by p.tablename, p.policyname)
     from pg_policies p
     where p.schemaname = 'public' and p.tablename in ('species_photos', 'species_photo_rejections')),
  'species_photo_rejections.species_photo_rejections_select_catalog_admin:SELECT:authenticated, '
    || 'species_photos.species_photos_select_all:SELECT:authenticated'
);

-- prueba: permisos: dos usuarios leen todas las fotos y ninguna retirada; anon no lee ninguna tabla; nadie escribe por la API
select pg_temp.foto('Phalaenopsis amabilis', '1');
select pg_temp.foto('Cattleya escondida', '7');
insert into public.species_photo_rejections (species_id, source, source_photo_id, source_url, author_name, reason, rejected_by, action_id)
values (pruebas.especie('Phalaenopsis amabilis'), 'inaturalist', '9', 'https://www.inaturalist.org/photos/9', 'Ana Pérez',
        'misidentified', 'admin_1', gen_random_uuid());
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.iguales('user_a: fotos', (select count(*) from public.species_photos), 2::bigint);
select pruebas.iguales('user_a: retiradas', (select count(*) from public.species_photo_rejections), 0::bigint);
set local request.jwt.claims = '{"sub": "user_b", "role": "authenticated"}';
select pruebas.iguales('user_b: fotos', (select count(*) from public.species_photos), 2::bigint);
select pruebas.iguales('user_b: retiradas', (select count(*) from public.species_photo_rejections), 0::bigint);
set local request.jwt.claims = '{"sub": "admin_1", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales('administrador: retiradas', (select count(*) from public.species_photo_rejections), 1::bigint);
do $$
declare
  claims text;
begin
  foreach claims in array array[
    '{"sub": "user_a", "role": "authenticated"}',
    '{"sub": "admin_1", "role": "authenticated", "app_role": "catalog_admin"}'
  ] loop
    perform set_config('request.jwt.claims', claims, true);
    perform pruebas.debe_fallar(claims || ': inserta una foto',
      $f$select pg_temp.foto('Phalaenopsis aphrodite', '8')$f$, '42501');
    perform pruebas.debe_fallar(claims || ': cambia una foto',
      $f$update public.species_photos set author_name = 'Otro'$f$, '42501');
    perform pruebas.debe_fallar(claims || ': borra una foto', $f$delete from public.species_photos$f$, '42501');
    perform pruebas.debe_fallar(claims || ': anota una retirada',
      $f$insert into public.species_photo_rejections (species_id, source, source_photo_id, source_url, author_name, reason, rejected_by, action_id)
         values (pruebas.especie('Phalaenopsis aphrodite'), 'inaturalist', '1', 'x', 'x', 'other', 'x', gen_random_uuid())$f$,
      '42501');
    perform pruebas.debe_fallar(claims || ': borra una retirada', $f$delete from public.species_photo_rejections$f$, '42501');
  end loop;
end;
$$;
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select pruebas.debe_fallar('anon lee las fotos', $$select * from public.species_photos$$, '42501');
select pruebas.debe_fallar('anon lee las retiradas', $$select * from public.species_photo_rejections$$, '42501');

-- prueba: permisos: la clave de servicio escribe las fotos y solo lee las retiradas
insert into public.species_photo_rejections (species_id, source, source_photo_id, source_url, author_name, reason, rejected_by, action_id)
values (pruebas.especie('Phalaenopsis amabilis'), 'inaturalist', '9', 'https://www.inaturalist.org/photos/9', 'Ana Pérez',
        'misidentified', 'admin_1', gen_random_uuid());
set local role service_role;
set local request.jwt.claims = '{"role": "service_role"}';
select pruebas.debe_funcionar('inserta', $$select pg_temp.foto('Phalaenopsis aphrodite', '8')$$);
select pruebas.debe_funcionar('sustituye',
  $$update public.species_photos set source_photo_id = '11', source_url = 'https://www.inaturalist.org/photos/11',
      medium_path = species_id::text || '/medium-11.webp', thumbnail_path = species_id::text || '/thumb-11.webp'
    where species_id = pruebas.especie('Phalaenopsis aphrodite')$$);
select pruebas.debe_funcionar('borra', $$delete from public.species_photos where species_id = pruebas.especie('Phalaenopsis aphrodite')$$);
select pruebas.iguales('lee las retiradas', (select count(*) from public.species_photo_rejections), 1::bigint);
select pruebas.debe_fallar('no anota retiradas',
  $$insert into public.species_photo_rejections (species_id, source, source_photo_id, source_url, author_name, reason, rejected_by, action_id)
    values (pruebas.especie('Phalaenopsis aphrodite'), 'inaturalist', '1', 'x', 'x', 'other', 'x', gen_random_uuid())$$, '42501');
select pruebas.debe_fallar('no borra retiradas', $$delete from public.species_photo_rejections$$, '42501');
select pruebas.debe_fallar('no pone una foto retirada',
  $$select pg_temp.foto('Phalaenopsis amabilis', '9')$$, '23514', 'species_photos_not_rejected');

-- prueba: catálogo público: la ficha trae la foto con su autor, licencia y enlace, y nula si no hay
select pg_temp.foto('Phalaenopsis amabilis', '1', 'cc-by-sa', 'Rodrigo Sala');
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select pruebas.iguales(
  'ficha con foto',
  (select f.reference_photo - 'obtained_at' - 'medium_path' - 'thumbnail_path'
     from public.get_public_species(pruebas.especie('Phalaenopsis amabilis')) f),
  jsonb_build_object(
    'medium_width', 500, 'medium_height', 375, 'thumbnail_width', 160, 'thumbnail_height', 120,
    'author_name', 'Rodrigo Sala', 'attribution', '(c) Rodrigo Sala, some rights reserved (CC BY)',
    'license', 'cc-by-sa', 'source', 'inaturalist', 'source_url', 'https://www.inaturalist.org/photos/1',
    'source_observation_id', null, 'is_modified', true)
);
select pruebas.iguales(
  'rutas y fecha',
  (select (f.reference_photo ->> 'medium_path') = f.id::text || '/medium-1.webp'
          and (f.reference_photo ->> 'thumbnail_path') = f.id::text || '/thumb-1.webp'
          and (f.reference_photo ->> 'obtained_at')::timestamptz = now() - interval '1 day'
     from public.get_public_species(pruebas.especie('Phalaenopsis amabilis')) f),
  true
);
select pruebas.iguales(
  'ficha sin foto',
  (select coalesce(f.reference_photo::text, 'nula') from public.get_public_species(pruebas.especie('Phalaenopsis aphrodite')) f),
  'nula'
);
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.iguales(
  'con sesión, lo mismo',
  (select f.reference_photo ->> 'author_name' from public.get_public_species(pruebas.especie('Phalaenopsis amabilis')) f),
  'Rodrigo Sala'
);

-- prueba: catálogo público: la búsqueda y las especies de un género traen la miniatura
select pg_temp.foto('Phalaenopsis amabilis', '1', 'cc0', 'Rodrigo Sala');
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select pruebas.iguales(
  'búsqueda',
  (select string_agg(s.scientific_name || ':' || coalesce(
            (s.reference_thumbnail - 'thumbnail_path')::text || ' ' || ((s.reference_thumbnail ->> 'thumbnail_path') = s.id::text || '/thumb-1.webp'),
            'sin foto'), ', ' order by s.scientific_name)
     from public.search_public_species('phalaenopsis a') s),
  'Phalaenopsis amabilis:{"source": "inaturalist", "license": "cc0", "source_url": "https://www.inaturalist.org/photos/1", '
    || '"author_name": "Rodrigo Sala", "is_modified": true, "thumbnail_width": 160, "thumbnail_height": 120} true, '
    || 'Phalaenopsis aphrodite:sin foto, Phalaenopsis pulcherrima:sin foto'
);
select pruebas.iguales(
  'especies de un género',
  (select string_agg(s.scientific_name || ':' || coalesce(s.reference_thumbnail ->> 'author_name', 'sin foto'), ', ' order by s.scientific_name)
     from public.list_public_genus_species(pruebas.genero('Phalaenopsis')) s),
  'Phalaenopsis amabilis:Rodrigo Sala, Phalaenopsis aphrodite:sin foto, Phalaenopsis pulcherrima:sin foto'
);
select pruebas.iguales(
  'la miniatura no trae el medio ni la atribución larga',
  (select string_agg(distinct k, ',' order by k)
     from public.list_public_genus_species(pruebas.genero('Phalaenopsis')) s
     cross join lateral jsonb_object_keys(s.reference_thumbnail) k),
  'author_name,is_modified,license,source,source_url,thumbnail_height,thumbnail_path,thumbnail_width'
);

-- prueba: catálogo público: la foto de una especie no pública no sale por ninguna función
select pg_temp.foto('Cattleya escondida', '7');
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select pruebas.iguales('ficha', (select count(*) from public.get_public_species(pruebas.especie('Cattleya escondida'))), 0::bigint);
select pruebas.iguales('búsqueda', (select count(*) from public.search_public_species('cattleya escondida')), 0::bigint);
select pruebas.iguales(
  'especies de su género',
  (select count(*) from public.list_public_genus_species(pruebas.genero('Cattleya')) s
     where s.reference_thumbnail ->> 'source_url' like '%/7'),
  0::bigint
);
-- Con sesión, la tabla sí la muestra (authenticated lee todo el catálogo, también lo no público).
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.iguales('con sesión, por la tabla', (select count(*) from public.species_photos), 1::bigint);
select pruebas.iguales('con sesión, por la ficha pública',
  (select count(*) from public.get_public_species(pruebas.especie('Cattleya escondida'))), 0::bigint);

-- prueba: retirada: propiedades y permisos de retire_species_photo
select pruebas.iguales(
  'propiedades',
  (select p.prosecdef || ' ' || array_to_string(p.proconfig, ',') || ' ' || pg_get_userbyid(p.proowner)
          || ' ' || pg_get_function_result(p.oid)
     from pg_proc p where p.oid = 'public.retire_species_photo(uuid, text, text)'::regprocedure),
  'true search_path="" postgres TABLE(action_id uuid, medium_path text, thumbnail_path text)'
);
select pruebas.iguales(
  'quién la ejecuta',
  (select string_agg(r.rol || '=' || has_function_privilege(r.rol, 'public.retire_species_photo(uuid, text, text)', 'execute'), ', ' order by r.rol)
     from (values ('anon'), ('authenticated'), ('service_role')) r (rol)),
  'anon=false, authenticated=true, service_role=false'
);
select pg_temp.foto('Phalaenopsis amabilis', '1');
do $$
declare
  caso text[];
begin
  foreach caso slice 1 in array array[
    array['anon', '{"role": "anon", "app_role": "catalog_admin"}'],
    array['authenticated', '{"sub": "user_a", "role": "authenticated"}'],
    array['authenticated', '{"sub": "user_a", "role": "authenticated", "app_role": "admin"}'],
    array['service_role', '{"role": "service_role"}']
  ] loop
    execute format('set local role %I', caso[1]);
    perform set_config('request.jwt.claims', caso[2], true);
    perform pruebas.debe_fallar(caso[2] || ': retira',
      $f$select * from public.retire_species_photo(pruebas.especie('Phalaenopsis amabilis'), '1', 'misidentified')$f$,
      '42501');
    reset role;
  end loop;
end;
$$;
select pruebas.iguales('la foto sigue', pg_temp.foto_de('Phalaenopsis amabilis'),
  '1 (cc-by, Ana Pérez) <especie>/medium-1.webp <especie>/thumb-1.webp');
select pruebas.iguales('sin retiradas', pg_temp.retiradas('Phalaenopsis amabilis'), 'ninguna');

-- prueba: retirada: borra la foto, la recuerda, devuelve las rutas y deja la acción en la auditoría y en el historial
select pg_temp.foto('Phalaenopsis amabilis', '1', 'cc-by', 'Ana Pérez');
create temp table resultado (action_id uuid, medium_path text, thumbnail_path text);
grant select, insert on pg_temp.resultado to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub": "admin_1", "role": "authenticated", "app_role": "catalog_admin"}';
insert into pg_temp.resultado
  select * from public.retire_species_photo(pruebas.especie('Phalaenopsis amabilis'), '1', 'misidentified');
select pruebas.iguales(
  'rutas devueltas',
  (select replace(r.medium_path, pruebas.especie('Phalaenopsis amabilis')::text, '<especie>') || ' '
          || replace(r.thumbnail_path, pruebas.especie('Phalaenopsis amabilis')::text, '<especie>')
     from pg_temp.resultado r),
  '<especie>/medium-1.webp <especie>/thumb-1.webp'
);
select pruebas.iguales('el administrador ve la retirada',
  (select r.source_photo_id || ':' || r.reason || ':' || r.rejected_by || ':' || r.source_url || ':' || r.author_name
          || ':' || (r.rejected_at = now()) || ':' || (r.action_id = (select x.action_id from pg_temp.resultado x))
     from public.species_photo_rejections r),
  '1:misidentified:admin_1:https://www.inaturalist.org/photos/1:Ana Pérez:true:true'
);
select pruebas.iguales('y ya no ve la foto', (select count(*) from public.species_photos), 0::bigint);
select pruebas.iguales(
  'historial de la especie',
  (select h.action || ' ' || h.actor || ' ' || (h.details ->> 'reason') || ' ' || (h.details ->> 'source_photo_id')
          || ' ' || (h.details ->> 'license') || ' ' || (h.details ->> 'scientific_name')
     from public.species_history(pruebas.especie('Phalaenopsis amabilis')) h),
  'retire_species_photo admin_1 misidentified 1 cc-by Phalaenopsis amabilis'
);
set local role postgres;
select pruebas.iguales(
  'una sola fila en la auditoría',
  (select string_agg(a.action || ':' || a.table_name || ':' || (a.row_id = pruebas.especie('Phalaenopsis amabilis')), ', ')
     from public.catalog_audit_log a),
  'retire_species_photo:species:true'
);
select pruebas.iguales('foto', pg_temp.foto_de('Phalaenopsis amabilis'), 'ninguna');
select pruebas.iguales('retiradas', pg_temp.retiradas('Phalaenopsis amabilis'), '1:misidentified');

-- prueba: retirada: rechazos con su motivo, sin cambiar nada
select pg_temp.foto('Phalaenopsis amabilis', '1');
set local role authenticated;
set local request.jwt.claims = '{"sub": "admin_1", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.debe_fallar('otra foto distinta de la actual',
  $$select * from public.retire_species_photo(pruebas.especie('Phalaenopsis amabilis'), '2', 'misidentified')$$, 'P0002');
select pruebas.debe_fallar('una especie sin foto',
  $$select * from public.retire_species_photo(pruebas.especie('Phalaenopsis aphrodite'), '1', 'misidentified')$$, 'P0002');
select pruebas.debe_fallar('una especie que no existe',
  $$select * from public.retire_species_photo(gen_random_uuid(), '1', 'misidentified')$$, 'P0002');
select pruebas.debe_fallar('id de foto nulo',
  $$select * from public.retire_species_photo(pruebas.especie('Phalaenopsis amabilis'), null, 'misidentified')$$, 'P0002');
select pruebas.debe_fallar('motivo nulo',
  $$select * from public.retire_species_photo(pruebas.especie('Phalaenopsis amabilis'), '1', null)$$, '22023');
select pruebas.debe_fallar('motivo desconocido',
  $$select * from public.retire_species_photo(pruebas.especie('Phalaenopsis amabilis'), '1', 'ugly')$$, '22023');
do $$
declare
  detalle text;
begin
  perform public.retire_species_photo(pruebas.especie('Phalaenopsis amabilis'), '2', 'other');
exception when sqlstate 'P0002' then
  get stacked diagnostics detalle = pg_exception_detail;
  perform pruebas.iguales('detalle', (detalle::jsonb - 'species_id')::text,
    '{"reason": "species_photo_not_found", "source_photo_id": "2", "current_source_photo_id": "1"}');
end;
$$;
set local role postgres;
select pruebas.iguales('la foto sigue', pg_temp.foto_de('Phalaenopsis amabilis'),
  '1 (cc-by, Ana Pérez) <especie>/medium-1.webp <especie>/thumb-1.webp');
select pruebas.iguales('sin retiradas', pg_temp.retiradas('Phalaenopsis amabilis'), 'ninguna');
select pruebas.iguales('sin auditoría', (select count(*) from public.catalog_audit_log), 0::bigint);

-- prueba: memoria: la carga no puede volver a poner una foto retirada, pero sí proponer otra
select pg_temp.foto('Phalaenopsis amabilis', '1');
select pg_temp.foto('Phalaenopsis aphrodite', '1');
set local role authenticated;
set local request.jwt.claims = '{"sub": "admin_1", "role": "authenticated", "app_role": "catalog_admin"}';
select * from public.retire_species_photo(pruebas.especie('Phalaenopsis amabilis'), '1', 'inappropriate');
select pg_temp.fin_de_peticion();
set local role postgres;
select pruebas.debe_fallar('la misma foto otra vez, como postgres',
  $$select pg_temp.foto('Phalaenopsis amabilis', '1')$$, '23514', 'species_photos_not_rejected');
select pruebas.debe_funcionar('otra foto', $$select pg_temp.foto('Phalaenopsis amabilis', '2')$$);
select pruebas.debe_fallar('sustituir la otra por la retirada',
  $$update public.species_photos set source_photo_id = '1', source_url = 'https://www.inaturalist.org/photos/1',
      medium_path = species_id::text || '/medium-1.webp', thumbnail_path = species_id::text || '/thumb-1.webp'
    where species_id = pruebas.especie('Phalaenopsis amabilis')$$,
  '23514', 'species_photos_not_rejected');
select pruebas.debe_fallar('pasar a esta especie la foto de otra que es la retirada',
  $$update public.species_photos set species_id = pruebas.especie('Phalaenopsis amabilis')
    where species_id = pruebas.especie('Phalaenopsis aphrodite')$$,
  '23514', 'species_photos_not_rejected');
select pruebas.iguales('la foto retirada sigue valiendo para otra especie', pg_temp.foto_de('Phalaenopsis aphrodite'),
  '1 (cc-by, Ana Pérez) <especie>/medium-1.webp <especie>/thumb-1.webp');
-- La segunda retirada de la especie se añade a la memoria.
set local role authenticated;
set local request.jwt.claims = '{"sub": "admin_1", "role": "authenticated", "app_role": "catalog_admin"}';
select * from public.retire_species_photo(pruebas.especie('Phalaenopsis amabilis'), '2', 'author_request');
set local role postgres;
select pruebas.iguales('dos retiradas', pg_temp.retiradas('Phalaenopsis amabilis'), '1:inappropriate, 2:author_request');
set local role service_role;
set local request.jwt.claims = '{"role": "service_role"}';
select pruebas.debe_fallar('la clave de servicio tampoco la pone',
  $$select pg_temp.foto('Phalaenopsis amabilis', '2')$$, '23514', 'species_photos_not_rejected');
select pruebas.debe_funcionar('una tercera, sí', $$select pg_temp.foto('Phalaenopsis amabilis', '3')$$);

-- prueba: fusión: si la conservada no tiene foto, se queda con la de la absorbida, con sus rutas
select pg_temp.foto('Doritis pulcherrima', '40', 'cc-by-sa', 'Rodrigo Sala');
set local role authenticated;
set local request.jwt.claims = '{"sub": "admin_1", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'resultado de la fusión, sin cambios de forma',
  (select m.plant_count || ' ' || m.kept_validated
     from public.merge_species(pruebas.especie('Doritis pulcherrima'), pruebas.especie('Phalaenopsis pulcherrima')) m),
  '1 true'
);
set local role postgres;
select pruebas.iguales(
  'la foto pasa a la conservada con la carpeta de la absorbida',
  (select p.source_photo_id || ' ' || p.author_name || ' '
          || (split_part(p.medium_path, '/', 1) <> p.species_id::text) || ' ' || (p.medium_path like '%/medium-40.webp')
     from public.species_photos p
     where p.species_id = pruebas.especie('Phalaenopsis pulcherrima')),
  '40 Rodrigo Sala true true'
);
select pruebas.iguales('una sola foto', (select count(*) from public.species_photos), 1::bigint);
select pruebas.iguales(
  'detalles de la fusión',
  (select a.details -> 'reference_photo' from public.catalog_audit_log a where a.action = 'merge_species'),
  '{"outcome": "moved", "kept_source_photo_id": null, "merged_source_photo_id": "40", "moved_rejection_count": 0}'::jsonb
);
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select pruebas.iguales(
  'la ficha pública de la conservada la muestra',
  (select f.reference_photo ->> 'author_name' from public.get_public_species(pruebas.especie('Phalaenopsis pulcherrima')) f),
  'Rodrigo Sala'
);

-- prueba: fusión: si las dos tienen foto, la conservada mantiene la suya y la de la absorbida se va
select pg_temp.foto('Doritis pulcherrima', '40');
select pg_temp.foto('Phalaenopsis pulcherrima', '30');
set local role authenticated;
set local request.jwt.claims = '{"sub": "admin_1", "role": "authenticated", "app_role": "catalog_admin"}';
select count(*) from public.merge_species(pruebas.especie('Doritis pulcherrima'), pruebas.especie('Phalaenopsis pulcherrima'));
set local role postgres;
select pruebas.iguales('la de la conservada', pg_temp.foto_de('Phalaenopsis pulcherrima'),
  '30 (cc-by, Ana Pérez) <especie>/medium-30.webp <especie>/thumb-30.webp');
select pruebas.iguales('ninguna más', (select count(*) from public.species_photos), 1::bigint);
select pruebas.iguales(
  'detalles de la fusión',
  (select a.details -> 'reference_photo' from public.catalog_audit_log a where a.action = 'merge_species'),
  '{"outcome": "discarded", "kept_source_photo_id": "30", "merged_source_photo_id": "40", "moved_rejection_count": 0}'::jsonb
);

-- prueba: fusión: las retiradas pasan a la conservada sin repetirse, y una foto retirada de la conservada no le llega
select pg_temp.foto('Doritis pulcherrima', '40');
insert into public.species_photo_rejections (species_id, source, source_photo_id, source_url, author_name, reason, rejected_by, action_id)
values
  (pruebas.especie('Doritis pulcherrima'), 'inaturalist', '41', 'https://www.inaturalist.org/photos/41', 'Ana Pérez', 'misidentified', 'admin_1', gen_random_uuid()),
  (pruebas.especie('Doritis pulcherrima'), 'inaturalist', '42', 'https://www.inaturalist.org/photos/42', 'Ana Pérez', 'inappropriate', 'admin_1', gen_random_uuid()),
  (pruebas.especie('Phalaenopsis pulcherrima'), 'inaturalist', '40', 'https://www.inaturalist.org/photos/40', 'Ana Pérez', 'misidentified', 'admin_2', gen_random_uuid()),
  (pruebas.especie('Phalaenopsis pulcherrima'), 'inaturalist', '42', 'https://www.inaturalist.org/photos/42', 'Ana Pérez', 'other', 'admin_2', gen_random_uuid());
set local role authenticated;
set local request.jwt.claims = '{"sub": "admin_1", "role": "authenticated", "app_role": "catalog_admin"}';
select count(*) from public.merge_species(pruebas.especie('Doritis pulcherrima'), pruebas.especie('Phalaenopsis pulcherrima'));
set local role postgres;
select pruebas.iguales('la conservada sigue sin foto', pg_temp.foto_de('Phalaenopsis pulcherrima'), 'ninguna');
select pruebas.iguales('ninguna foto', (select count(*) from public.species_photos), 0::bigint);
select pruebas.iguales('retiradas de la conservada: las suyas y la nueva', pg_temp.retiradas('Phalaenopsis pulcherrima'),
  '40:misidentified, 41:misidentified, 42:other');
select pruebas.iguales('ninguna huérfana', (select count(*) from public.species_photo_rejections), 3::bigint);
select pruebas.iguales(
  'detalles de la fusión',
  (select a.details -> 'reference_photo' from public.catalog_audit_log a where a.action = 'merge_species'),
  '{"outcome": "discarded", "kept_source_photo_id": null, "merged_source_photo_id": "40", "moved_rejection_count": 1}'::jsonb
);
select pruebas.debe_fallar('la carga tampoco puede ponérsela después',
  $$select pg_temp.foto('Phalaenopsis pulcherrima', '41')$$, '23514', 'species_photos_not_rejected');

-- prueba: fusión: si la absorbida no tiene foto, la de la conservada no se toca
select pg_temp.foto('Phalaenopsis pulcherrima', '30');
select xmin::text as version_antes from public.species_photos \gset
set local role authenticated;
set local request.jwt.claims = '{"sub": "admin_1", "role": "authenticated", "app_role": "catalog_admin"}';
select count(*) from public.merge_species(pruebas.especie('Doritis pulcherrima'), pruebas.especie('Phalaenopsis pulcherrima'));
set local role postgres;
select pruebas.iguales('sin tocar la fila', (select xmin::text from public.species_photos), :'version_antes');
select pruebas.iguales(
  'detalles de la fusión',
  (select a.details -> 'reference_photo' from public.catalog_audit_log a where a.action = 'merge_species'),
  '{"outcome": null, "kept_source_photo_id": "30", "merged_source_photo_id": null, "moved_rejection_count": 0}'::jsonb
);

-- prueba: bucket species-photos: público, con tope de 256 KiB, solo WebP y sin políticas
select pruebas.iguales(
  'propiedades del bucket',
  (select b.name || ' public=' || b.public || ' limit=' || b.file_size_limit || ' types=' || b.allowed_mime_types::text
     from storage.buckets b where b.id = 'species-photos'),
  'species-photos public=true limit=262144 types={image/webp}'
);
select pruebas.iguales(
  'políticas de storage.objects que nombran el bucket',
  (select coalesce(string_agg(p.policyname, ', '), 'ninguna')
     from pg_policies p
     where p.schemaname = 'storage'
       and (coalesce(p.qual, '') || coalesce(p.with_check, '')) like '%species-photos%'),
  'ninguna'
);

-- prueba: bucket species-photos: ni anon ni dos usuarios ni el administrador listan, suben, reemplazan ni borran; la clave de servicio sí
insert into storage.objects (bucket_id, name)
values ('species-photos', '11111111-1111-4111-8111-111111111111/medium-1.webp'),
       ('species-photos', '11111111-1111-4111-8111-111111111111/thumb-1.webp');
do $$
declare
  caso text[];
  cambiadas bigint;
begin
  foreach caso slice 1 in array array[
    array['anon', '{"role": "anon"}'],
    array['authenticated', '{"sub": "user_a", "role": "authenticated"}'],
    array['authenticated', '{"sub": "user_b", "role": "authenticated"}'],
    array['authenticated', '{"sub": "admin_1", "role": "authenticated", "app_role": "catalog_admin"}']
  ] loop
    execute format('set local role %I', caso[1]);
    perform set_config('request.jwt.claims', caso[2], true);
    perform set_config('storage.allow_delete_query', 'true', true);
    perform pruebas.iguales(caso[2] || ': objetos que lista',
      (select count(*) from storage.objects o where o.bucket_id = 'species-photos'), 0::bigint);
    perform pruebas.debe_fallar(caso[2] || ': sube',
      $f$insert into storage.objects (bucket_id, name) values ('species-photos', '11111111-1111-4111-8111-111111111111/medium-2.webp')$f$,
      '42501');
    with x as (update storage.objects set metadata = '{}' where bucket_id = 'species-photos' returning 1)
    select count(*) into cambiadas from x;
    perform pruebas.iguales(caso[2] || ': reemplaza', cambiadas, 0::bigint);
    with x as (delete from storage.objects where bucket_id = 'species-photos' returning 1)
    select count(*) into cambiadas from x;
    perform pruebas.iguales(caso[2] || ': borra', cambiadas, 0::bigint);
    reset role;
  end loop;
end;
$$;
set local role service_role;
set local request.jwt.claims = '{"role": "service_role"}';
set local storage.allow_delete_query = 'true';
select pruebas.debe_funcionar('la clave de servicio sube',
  $$insert into storage.objects (bucket_id, name) values ('species-photos', '11111111-1111-4111-8111-111111111111/medium-2.webp')$$);
select pruebas.iguales('y lista', (select count(*) from storage.objects o where o.bucket_id = 'species-photos'), 3::bigint);
select pruebas.debe_funcionar('y borra',
  $$delete from storage.objects where bucket_id = 'species-photos' and name like '%/medium-2.webp'$$);

-- prueba: índices: la foto se busca por species_photos_species_id_key en la ficha, las listas, la búsqueda y la retirada
-- Como en catalogo_publico.sql: sin recorridos secuenciales, se anotan los índices recorridos
-- durante cada llamada.
select pg_temp.foto('Phalaenopsis amabilis', '1');
select pg_temp.foto('Phalaenopsis aphrodite', '2');
analyze public.species_photos, public.species_photo_rejections;
create temp table recorridos (indice text, antes bigint);
create function pg_temp.recorridos_desde_la_marca() returns text language sql as $$
  select coalesce(string_agg(r.indice, ', ' order by r.indice), 'ninguno')
  from pg_temp.recorridos r
  where pg_stat_get_xact_numscans(r.indice::regclass) > r.antes
$$;
create function pg_temp.marcar() returns void language sql as $$
  delete from pg_temp.recorridos;
  insert into pg_temp.recorridos
  select i, pg_stat_get_xact_numscans(i::regclass)
  from unnest(array['species_photos_species_id_key', 'species_photos_pkey', 'species_photo_rejections_pkey']) i;
$$;
grant select, insert, delete on pg_temp.recorridos to anon, authenticated;
grant execute on function pg_temp.marcar(), pg_temp.recorridos_desde_la_marca() to public;
set local enable_seqscan = off;
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select pg_temp.marcar();
select count(*) from public.get_public_species(pruebas.especie('Phalaenopsis amabilis'));
select pruebas.iguales('ficha', pg_temp.recorridos_desde_la_marca(), 'species_photos_species_id_key');
select pg_temp.marcar();
select count(*) from public.list_public_genus_species(pruebas.genero('Phalaenopsis'));
select pruebas.iguales('especies de un género', pg_temp.recorridos_desde_la_marca(), 'species_photos_species_id_key');
select pg_temp.marcar();
select count(*) from public.search_public_species('phalaenopsis');
select pruebas.iguales('búsqueda', pg_temp.recorridos_desde_la_marca(), 'species_photos_species_id_key');
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pg_temp.marcar();
select count(*) from public.species_photos where species_id = pruebas.especie('Phalaenopsis amabilis');
select pruebas.iguales('la foto de la especie elegida en el registro', pg_temp.recorridos_desde_la_marca(), 'species_photos_species_id_key');
select pg_temp.marcar();
select count(*) from public.species_photos
  where species_id in (pruebas.especie('Phalaenopsis amabilis'), pruebas.especie('Phalaenopsis aphrodite'));
select pruebas.iguales('las de un lote de sugerencias', pg_temp.recorridos_desde_la_marca(), 'species_photos_species_id_key');
set local request.jwt.claims = '{"sub": "admin_1", "role": "authenticated", "app_role": "catalog_admin"}';
select pg_temp.marcar();
select count(*) from public.retire_species_photo(pruebas.especie('Phalaenopsis amabilis'), '1', 'other');
-- La clave de las retiradas, por el «on conflict» al anotarla.
select pruebas.iguales('retirada', pg_temp.recorridos_desde_la_marca(),
  'species_photo_rejections_pkey, species_photos_pkey, species_photos_species_id_key');
reset role;
select pg_temp.marcar();
select pruebas.debe_fallar('la comprobación de la carga', $$select pg_temp.foto('Phalaenopsis amabilis', '1')$$, '23514');
select pruebas.iguales('comprobación de la carga', pg_temp.recorridos_desde_la_marca(), 'species_photo_rejections_pkey');
