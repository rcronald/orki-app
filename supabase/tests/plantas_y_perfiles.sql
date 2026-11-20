-- Restricciones de plants y profiles.

-- Datos de partida: una especie y un híbrido del catálogo.
insert into public.species (scientific_name, genus_id, type, status, source)
values
  ('Cattleya labiata', pruebas.genero('Cattleya'), 'species', 'validated', 'curated'),
  ('Phalaenopsis Sogo Yukidian', pruebas.genero('Phalaenopsis'), 'hybrid', 'validated', 'curated');

-- prueba: la restricción exige validated si y solo si hay especie (sin el disparador que la ajusta)
-- Se desactiva el disparador de sincronización para comprobar la restricción por sí sola.
alter table public.plants disable trigger sync_with_species;
select pruebas.debe_fallar(
  'validated sin especie',
  $$insert into public.plants (user_id, entered_name, genus_id, type, validation)
    values ('user_a', 'Sin especie', pruebas.genero('Vanda'), 'unknown', 'validated')$$,
  '23514', 'plants_validated_iff_species'
);
select pruebas.debe_fallar(
  'con especie y pending',
  $$insert into public.plants (user_id, entered_name, genus_id, type, validation, species_id)
    values ('user_a', 'Con especie', pruebas.genero('Cattleya'), 'species', 'pending', pruebas.especie('Cattleya labiata'))$$,
  '23514', 'plants_validated_iff_species'
);
select pruebas.debe_fallar(
  'con especie y unidentifiable',
  $$insert into public.plants (user_id, entered_name, genus_id, type, validation, species_id)
    values ('user_a', 'Con especie', pruebas.genero('Cattleya'), 'species', 'unidentifiable', pruebas.especie('Cattleya labiata'))$$,
  '23514', 'plants_validated_iff_species'
);

-- prueba: con todos los disparadores, una planta sin especie no puede quedar validated
select pruebas.debe_fallar(
  'insertar validated sin especie',
  $$insert into public.plants (user_id, entered_name, genus_id, type, validation)
    values ('user_a', 'Sin especie', pruebas.genero('Vanda'), 'unknown', 'validated')$$,
  '23514', 'plants_validated_iff_species'
);
insert into public.plants (user_id, entered_name, genus_id, type)
values ('user_a', 'Pendiente', pruebas.genero('Vanda'), 'unknown');
select pruebas.debe_fallar(
  'pasar a validated sin especie',
  $$update public.plants set validation = 'validated' where entered_name = 'Pendiente'$$,
  '23514', 'plants_validated_iff_species'
);

-- prueba: una planta puede existir sin especie, pendiente o no identificable
select pruebas.debe_funcionar(
  'pending y unidentifiable sin especie',
  $$insert into public.plants (user_id, entered_name, genus_id, type, validation)
    values ('user_a', 'Pendiente', pruebas.genero('Vanda'), 'unknown', 'pending'),
           ('user_a', 'Rara', pruebas.genero('Vanda'), 'hybrid', 'unidentifiable')$$
);

-- prueba: un usuario puede tener varias plantas de la misma especie
insert into public.plants (user_id, entered_name, species_id)
select 'user_a', 'Labiata ' || n, pruebas.especie('Cattleya labiata') from generate_series(1, 3) n;
select pruebas.iguales(
  'plantas de user_a de Cattleya labiata',
  (select count(*) from public.plants where user_id = 'user_a' and species_id = pruebas.especie('Cattleya labiata')),
  3::bigint
);

-- prueba: valores por defecto de una planta nueva
insert into public.plants (user_id, entered_name, genus_id, type)
values ('user_a', 'Por defecto', pruebas.genero('Oncidium'), 'unknown');
select pruebas.iguales(
  'estado, validación, floración, fecha y textos opcionales',
  (select row(status, validation, photo_in_bloom, acquired_on = current_date, origin, location, nickname, flower_color, photo_path, thumbnail_path)::text
     from public.plants where entered_name = 'Por defecto'),
  row('active', 'pending', false, true, null, null, null, null, null, null)::text
);

-- prueba: el dueño de una planta no puede quedar en blanco ni faltar
select pruebas.debe_fallar(
  'user_id en blanco',
  $$insert into public.plants (user_id, entered_name, genus_id, type) values ('  ', 'x', pruebas.genero('Vanda'), 'unknown')$$,
  '23514', 'plants_user_id_not_blank'
);
select pruebas.debe_fallar(
  'sin user_id y sin token de sesión',
  $$insert into public.plants (entered_name, genus_id, type) values ('x', pruebas.genero('Vanda'), 'unknown')$$,
  '23502'
);

-- prueba: una planta sin especie necesita género y tipo
select pruebas.debe_fallar(
  'sin género',
  $$insert into public.plants (user_id, entered_name, type) values ('user_a', 'x', 'unknown')$$,
  '23502'
);
select pruebas.debe_fallar(
  'sin tipo',
  $$insert into public.plants (user_id, entered_name, genus_id) values ('user_a', 'x', pruebas.genero('Vanda'))$$,
  '23502'
);

-- prueba: el nombre ingresado no puede quedar en blanco ni pasar de 200 caracteres
select pruebas.debe_fallar(
  'en blanco',
  $$insert into public.plants (user_id, entered_name, genus_id, type) values ('user_a', '   ', pruebas.genero('Vanda'), 'unknown')$$,
  '23514', 'plants_entered_name_valid'
);
select pruebas.debe_fallar(
  '201 caracteres',
  $$insert into public.plants (user_id, entered_name, genus_id, type) values ('user_a', repeat('a', 201), pruebas.genero('Vanda'), 'unknown')$$,
  '23514', 'plants_entered_name_valid'
);
select pruebas.debe_funcionar(
  '200 caracteres',
  $$insert into public.plants (user_id, entered_name, genus_id, type) values ('user_a', repeat('a', 200), pruebas.genero('Vanda'), 'unknown')$$
);

-- prueba: origen, ubicación y apodo, si existen, no quedan en blanco ni pasan de 120 caracteres
do $$
declare
  columna text;
begin
  foreach columna in array array['origin', 'location', 'nickname'] loop
    perform pruebas.debe_fallar(
      columna || ' en blanco',
      format($q$insert into public.plants (user_id, entered_name, genus_id, type, %I)
                values ('user_a', 'x', pruebas.genero('Vanda'), 'unknown', ' ')$q$, columna),
      '23514', format('plants_%s_valid', columna)
    );
    perform pruebas.debe_fallar(
      columna || ' de 121 caracteres',
      format($q$insert into public.plants (user_id, entered_name, genus_id, type, %I)
                values ('user_a', 'x', pruebas.genero('Vanda'), 'unknown', repeat('a', 121))$q$, columna),
      '23514', format('plants_%s_valid', columna)
    );
    perform pruebas.debe_funcionar(
      columna || ' de 120 caracteres',
      format($q$insert into public.plants (user_id, entered_name, genus_id, type, %I)
                values ('user_a', 'x', pruebas.genero('Vanda'), 'unknown', repeat('a', 120))$q$, columna)
    );
  end loop;
end;
$$;

-- prueba: las rutas de foto y miniatura, si existen, no quedan en blanco ni pasan de 1024 caracteres
do $$
declare
  columna text;
begin
  foreach columna in array array['photo_path', 'thumbnail_path'] loop
    perform pruebas.debe_fallar(
      columna || ' en blanco',
      format($q$insert into public.plants (user_id, entered_name, genus_id, type, %I)
                values ('user_a', 'x', pruebas.genero('Vanda'), 'unknown', '')$q$, columna),
      '23514', format('plants_%s_valid', columna)
    );
    perform pruebas.debe_fallar(
      columna || ' de 1025 caracteres',
      format($q$insert into public.plants (user_id, entered_name, genus_id, type, %I)
                values ('user_a', 'x', pruebas.genero('Vanda'), 'unknown', repeat('a', 1025))$q$, columna),
      '23514', format('plants_%s_valid', columna)
    );
  end loop;
end;
$$;

-- prueba: la fecha de adquisición admite mañana (zonas horarias por delante de UTC) pero no más
select pruebas.debe_funcionar(
  'mañana',
  $$insert into public.plants (user_id, entered_name, genus_id, type, acquired_on)
    values ('user_a', 'x', pruebas.genero('Vanda'), 'unknown', current_date + 1)$$
);
select pruebas.debe_fallar(
  'pasado mañana',
  $$insert into public.plants (user_id, entered_name, genus_id, type, acquired_on)
    values ('user_a', 'x', pruebas.genero('Vanda'), 'unknown', current_date + 2)$$,
  '23514', 'plants_acquired_on_not_future'
);

-- prueba: los enumerados de la planta rechazan valores fuera de la lista
select pruebas.debe_fallar(
  'color de flor green',
  $$insert into public.plants (user_id, entered_name, genus_id, type, flower_color)
    values ('user_a', 'x', pruebas.genero('Vanda'), 'unknown', 'green')$$,
  '22P02'
);
select pruebas.debe_fallar(
  'estado sold',
  $$insert into public.plants (user_id, entered_name, genus_id, type, status)
    values ('user_a', 'x', pruebas.genero('Vanda'), 'unknown', 'sold')$$,
  '22P02'
);

-- prueba: un perfil tiene idioma es por defecto y un id único que no queda en blanco
insert into public.profiles (id) values ('user_perfil');
select pruebas.iguales(
  'idioma por defecto',
  (select preferred_language from public.profiles where id = 'user_perfil'),
  'es'
);
select pruebas.debe_fallar(
  'el mismo id dos veces',
  $$insert into public.profiles (id) values ('user_perfil')$$,
  '23505', 'profiles_pkey'
);
select pruebas.debe_fallar(
  'id en blanco',
  $$insert into public.profiles (id) values (' ')$$,
  '23514', 'profiles_id_not_blank'
);
select pruebas.debe_fallar(
  'sin id y sin token de sesión',
  $$insert into public.profiles default values$$,
  '23502'
);

-- prueba: el idioma del perfil es un código de dos letras minúsculas
select pruebas.debe_funcionar('en', $$insert into public.profiles (id, preferred_language) values ('user_en', 'en')$$);
select pruebas.debe_fallar(
  'ES',
  $$insert into public.profiles (id, preferred_language) values ('user_es', 'ES')$$,
  '23514', 'profiles_preferred_language_format'
);
select pruebas.debe_fallar(
  'spa',
  $$insert into public.profiles (id, preferred_language) values ('user_es', 'spa')$$,
  '23514', 'profiles_preferred_language_format'
);
select pruebas.debe_fallar(
  'es-PE',
  $$insert into public.profiles (id, preferred_language) values ('user_es', 'es-PE')$$,
  '23514', 'profiles_preferred_language_format'
);
