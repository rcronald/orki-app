-- Reordenar las fotos de una planta: public.reorder_plant_photos (issue #183).
--
-- user_a tiene la planta A con tres fotos y la planta A6 con seis; user_b, la planta B con dos.

insert into public.plants (id, user_id, entered_name, genus_id, type)
values
  ('aaaaaaaa-0000-4000-8000-00000000000a', 'user_a', 'Planta A', pruebas.genero('Vanda'), 'unknown'),
  ('aaaaaaaa-0000-4000-8000-00000000006a', 'user_a', 'Planta A6', pruebas.genero('Vanda'), 'unknown'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'user_b', 'Planta B', pruebas.genero('Vanda'), 'unknown');

insert into public.plant_photos (id, plant_id, photo_path, thumbnail_path, position, in_bloom)
select ('aaaaaaaa-1000-4000-8000-00000000000' || n)::uuid,
       'aaaaaaaa-0000-4000-8000-00000000000a',
       'user_a/aaaaaaaa-0000-4000-8000-00000000000a/photo-' || n || '.webp',
       'user_a/aaaaaaaa-0000-4000-8000-00000000000a/thumb-' || n || '.webp', n, n = 2
  from generate_series(0, 2) n;
insert into public.plant_photos (id, plant_id, photo_path, thumbnail_path, position)
select ('aaaaaaaa-6000-4000-8000-00000000000' || n)::uuid,
       'aaaaaaaa-0000-4000-8000-00000000006a',
       'user_a/aaaaaaaa-0000-4000-8000-00000000006a/photo-' || n || '.webp',
       'user_a/aaaaaaaa-0000-4000-8000-00000000006a/thumb-' || n || '.webp', n
  from generate_series(0, 5) n;
insert into public.plant_photos (id, plant_id, photo_path, thumbnail_path, position)
select ('bbbbbbbb-1000-4000-8000-00000000000' || n)::uuid,
       'bbbbbbbb-0000-4000-8000-00000000000b',
       'user_b/bbbbbbbb-0000-4000-8000-00000000000b/photo-' || n || '.webp',
       'user_b/bbbbbbbb-0000-4000-8000-00000000000b/thumb-' || n || '.webp', n
  from generate_series(0, 1) n;

set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';

-- prueba: el dueño pone la última como principal y la base copia la principal nueva a plants
select pruebas.iguales(
  'la función devuelve las tres fotos',
  (select count(*)::text from public.reorder_plant_photos(
     'aaaaaaaa-0000-4000-8000-00000000000a',
     array['aaaaaaaa-1000-4000-8000-000000000002', 'aaaaaaaa-1000-4000-8000-000000000000',
           'aaaaaaaa-1000-4000-8000-000000000001']::uuid[])),
  '3'
);
select pruebas.iguales(
  'orden nuevo',
  (select string_agg(right(photo_path, 12) || '=' || position, ' ' order by position)
     from public.plant_photos where plant_id = 'aaaaaaaa-0000-4000-8000-00000000000a'),
  'photo-2.webp=0 photo-0.webp=1 photo-1.webp=2'
);
select pruebas.iguales(
  'la principal nueva queda copiada en la planta',
  (select right(photo_path, 12) || ' ' || right(thumbnail_path, 12) || ' ' || photo_in_bloom::text
     from public.plants where id = 'aaaaaaaa-0000-4000-8000-00000000000a'),
  'photo-2.webp thumb-2.webp true'
);

-- prueba: con las seis posiciones ocupadas también se puede invertir el orden
select pruebas.debe_funcionar(
  'invertir seis fotos',
  $$select public.reorder_plant_photos(
      'aaaaaaaa-0000-4000-8000-00000000006a',
      array['aaaaaaaa-6000-4000-8000-000000000005', 'aaaaaaaa-6000-4000-8000-000000000004',
            'aaaaaaaa-6000-4000-8000-000000000003', 'aaaaaaaa-6000-4000-8000-000000000002',
            'aaaaaaaa-6000-4000-8000-000000000001', 'aaaaaaaa-6000-4000-8000-000000000000']::uuid[])$$
);
select pruebas.iguales(
  'seis fotos invertidas',
  (select string_agg(right(photo_path, 12), ' ' order by position)
     from public.plant_photos where plant_id = 'aaaaaaaa-0000-4000-8000-00000000006a'),
  'photo-5.webp photo-4.webp photo-3.webp photo-2.webp photo-1.webp photo-0.webp'
);

-- prueba: la lista tiene que ser exactamente las fotos de la planta
select pruebas.debe_fallar(
  'lista incompleta',
  $$select public.reorder_plant_photos(
      'aaaaaaaa-0000-4000-8000-00000000000a',
      array['aaaaaaaa-1000-4000-8000-000000000000', 'aaaaaaaa-1000-4000-8000-000000000001']::uuid[])$$,
  '22023'
);
select pruebas.debe_fallar(
  'una foto repetida',
  $$select public.reorder_plant_photos(
      'aaaaaaaa-0000-4000-8000-00000000000a',
      array['aaaaaaaa-1000-4000-8000-000000000000', 'aaaaaaaa-1000-4000-8000-000000000000',
            'aaaaaaaa-1000-4000-8000-000000000001']::uuid[])$$,
  '22023'
);
select pruebas.debe_fallar(
  'una foto de otra planta',
  $$select public.reorder_plant_photos(
      'aaaaaaaa-0000-4000-8000-00000000000a',
      array['aaaaaaaa-1000-4000-8000-000000000000', 'aaaaaaaa-1000-4000-8000-000000000001',
            'aaaaaaaa-6000-4000-8000-000000000000']::uuid[])$$,
  '22023'
);
select pruebas.debe_fallar(
  'sin lista',
  $$select public.reorder_plant_photos('aaaaaaaa-0000-4000-8000-00000000000a', null)$$,
  '22023'
);

-- prueba: nadie reordena las fotos de otra persona (la RLS las oculta: la lista no cuadra)
select pruebas.debe_fallar(
  'las fotos de otra persona',
  $$select public.reorder_plant_photos(
      'bbbbbbbb-0000-4000-8000-00000000000b',
      array['bbbbbbbb-1000-4000-8000-000000000001', 'bbbbbbbb-1000-4000-8000-000000000000']::uuid[])$$,
  '22023'
);
set local role postgres;
select pruebas.iguales(
  'las fotos de la otra persona siguen igual',
  (select string_agg(right(photo_path, 12), ' ' order by position)
     from public.plant_photos where plant_id = 'bbbbbbbb-0000-4000-8000-00000000000b'),
  'photo-0.webp photo-1.webp'
);

-- prueba: el rol anónimo no puede ejecutarla
set local role anon;
select pruebas.debe_fallar(
  'anon no puede reordenar',
  $$select public.reorder_plant_photos('aaaaaaaa-0000-4000-8000-00000000000a', array[]::uuid[])$$,
  '42501'
);
set local role postgres;
