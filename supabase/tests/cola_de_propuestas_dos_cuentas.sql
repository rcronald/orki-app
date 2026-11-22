-- Cola de propuestas de extremo a extremo con dos cuentas (issue #142, parte de #22), en la
-- base desechable: el mismo guion que la comprobación manual en desarrollo, con las mismas
-- peticiones que hacen la app y el backoffice (como authenticated, con el token de cada
-- cuenta). No sustituye a la comprobación en desarrollo, que además cubre Clerk, Storage y la
-- API de verdad (ver supabase/README.md, "Cola de propuestas").
--
-- Cuentas: user_b, una cuenta sin rol que registra plantas, y admin_1, el administrador del
-- catálogo. Los nombres inventados se señalan con "ficticio".
--
-- Guion:
--   1. user_b registra dos plantas con el mismo nombre no catalogado (una con foto) y otra con
--      un nombre distinto, como lo hace la app (insert en plants con su token, sin validation).
--   2. admin_1 lista la cola: ve dos grupos, con nombre, género, tipo, número y foto, y nada más.
--   3. admin_1 enlaza el primer grupo y marca el segundo como no identificable.
--   4. user_b ve sus plantas con el estado nuevo, y la cola queda vacía.
--   5. Las dos resoluciones están en la auditoría, sin el id de user_b.

insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
values ('Phalaenopsis amabilis', pruebas.genero('Phalaenopsis'), 'species', 'imported', 'col', '4FR2J');

insert into storage.objects (bucket_id, name)
values
  ('plant-photos', 'user_b/bbbbbbbb-0000-4000-8000-0000000000a1/photo-v1.webp'),
  ('plant-photos', 'user_b/bbbbbbbb-0000-4000-8000-0000000000a1/thumb-v1.webp');

-- Paso 1, como la app: con el token de user_b.
set role authenticated;
select set_config('request.jwt.claims', '{"sub": "user_b", "role": "authenticated"}', false);
insert into public.plants
  (id, entered_name, genus_id, type, origin, location, nickname, photo_path, thumbnail_path)
values
  -- ficticio
  ('bbbbbbbb-0000-4000-8000-0000000000a1', 'Mariposa de la feria', pruebas.genero('Phalaenopsis'), 'unknown',
   'Feria de Miraflores', 'Sala', 'La primera',
   'user_b/bbbbbbbb-0000-4000-8000-0000000000a1/photo-v1.webp',
   'user_b/bbbbbbbb-0000-4000-8000-0000000000a1/thumb-v1.webp'),
  ('bbbbbbbb-0000-4000-8000-0000000000a2', 'mariposa de la Feria ', pruebas.genero('Phalaenopsis'), 'species',
   null, null, null, null, null),
  ('bbbbbbbb-0000-4000-8000-0000000000a3', 'Orquídea del mercado', pruebas.genero('Cattleya'), 'unknown',
   'Mercado', null, null, null, null);
reset role;
select set_config('request.jwt.claims', '', false);

create function pg_temp.fin_de_peticion()
returns void
language sql
as $$
  select set_config('orki.catalog_action_id', '', true)
$$;

-- prueba: el guion completo con dos cuentas
-- 2. El administrador lista la cola. El tipo del primer grupo es "species": una planta de cada
--    tipo, y a igualdad gana el primero del enumerado.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "admin_1", "role": "authenticated", "app_role": "catalog_admin"}', true);
select pruebas.iguales(
  'la cola que ve el administrador',
  (select string_agg(g.proposed_name || ' | ' || g.genus_name || ' | ' || g.type || ' | ' || g.plant_count
                       || ' | fotos ' || jsonb_array_length(g.photos), ' / ' order by g.plant_count desc)
     from public.list_proposal_groups() g),
  'Mariposa de la feria | Phalaenopsis | species | 2 | fotos 1 / Orquídea del mercado | Cattleya | unknown | 1 | fotos 0'
);
select pruebas.comprobar(
  'la respuesta no lleva origen, ubicación, apodo, fechas ni ids de plantas',
  (select bool_and(to_jsonb(g)::text !~ '(Feria de Miraflores|Mercado"|Sala|La primera|bbbbbbbb-0000-4000-8000-0000000000a[23]|created_at|updated_at|user_id)')
     from public.list_proposal_groups() g)
);
select pruebas.iguales(
  'las claves de la respuesta',
  (select string_agg(k, ', ' order by k) from (select distinct jsonb_object_keys(to_jsonb(g)) k from public.list_proposal_groups() g) c),
  'genus_id, genus_name, name_key, photos, plant_count, proposed_name, total_count, type'
);
select pruebas.iguales(
  'el administrador lee la foto de la propuesta',
  (select count(*) from storage.objects o where o.bucket_id = 'plant-photos'),
  2::bigint
);
select pruebas.iguales('el administrador no lee las plantas', (select count(*) from public.plants), 0::bigint);

-- 3. Enlaza el primer grupo y marca el segundo.
select pruebas.iguales(
  'enlazar el primer grupo',
  (select r.plant_count from public.link_proposal_group('mariposa de la feria', pruebas.genero('Phalaenopsis'), pruebas.especie('Phalaenopsis amabilis')) r),
  2::bigint
);
select pg_temp.fin_de_peticion();
select pruebas.iguales(
  'marcar el segundo como no identificable',
  (select r.plant_count from public.mark_proposal_unidentifiable('orquidea del mercado', pruebas.genero('Cattleya')) r),
  1::bigint
);
select pg_temp.fin_de_peticion();
select pruebas.iguales('la cola queda vacía', public.count_proposal_groups(), 0::bigint);
select pruebas.iguales(
  'el administrador ya no lee la foto',
  (select count(*) from storage.objects o where o.bucket_id = 'plant-photos'),
  0::bigint
);

-- 4. user_b ve sus plantas con el estado nuevo (como la app: select de sus plantas).
select set_config('request.jwt.claims', '{"sub": "user_b", "role": "authenticated"}', true);
select pruebas.iguales(
  'las plantas de user_b',
  (select string_agg(p.entered_name || ' → ' || coalesce(s.scientific_name, '-') || ' (' || p.validation || ', ' || p.type || ')',
                     ', ' order by p.id)
     from public.plants p left join public.species s on s.id = p.species_id),
  'Mariposa de la feria → Phalaenopsis amabilis (validated, species), '
  'mariposa de la Feria  → Phalaenopsis amabilis (validated, species), '
  'Orquídea del mercado → - (unidentifiable, unknown)'
);
select pruebas.iguales(
  'user_b sigue viendo su foto',
  (select count(*) from storage.objects o where o.bucket_id = 'plant-photos'),
  2::bigint
);
select pruebas.debe_fallar(
  'user_b no puede listar la cola',
  $$select * from public.list_proposal_groups()$$,
  '42501'
);

-- 5. La auditoría, leída como lo haría un administrador.
select set_config('request.jwt.claims', '{"sub": "admin_1", "role": "authenticated", "app_role": "catalog_admin"}', true);
select pruebas.iguales(
  'resoluciones en la auditoría',
  (select string_agg(a.actor || ' ' || a.action || ' ' || (a.details ->> 'proposed_name') || ' ' || (a.details ->> 'plant_count'),
                     ' | ' order by a.id)
     from public.catalog_audit_log a
     where a.action in ('link_proposal_group', 'mark_proposal_unidentifiable')),
  'admin_1 link_proposal_group Mariposa de la feria 2 | admin_1 mark_proposal_unidentifiable Orquídea del mercado 1'
);
select pruebas.comprobar(
  'sin el id de user_b en la auditoría',
  (select bool_and(coalesce(a.details::text, '') !~ 'user_b' and a.actor <> 'user_b') from public.catalog_audit_log a)
);
select pruebas.iguales(
  'la resolución sale en el historial de la especie',
  (select string_agg(h.action, ', ') from public.species_history(pruebas.especie('Phalaenopsis amabilis')) h),
  'link_proposal_group'
);
