-- Cola de propuestas (issue #139, parte de #22): list_proposal_groups(), count_proposal_groups(),
-- link_proposal_group(), create_species_from_proposal() y mark_proposal_unidentifiable(), de la
-- migración 20261121180000_cola_de_propuestas.sql, y el acceso del administrador a las fotos.
--
-- Las llamadas se hacen como authenticated con el claim app_role = catalog_admin, igual que el
-- backoffice. Las plantas y la auditoría se leen como postgres ("set local role postgres"),
-- salvo en las pruebas de permisos. Cada llamada a la API es una transacción; aquí se simula
-- el final de una vaciando el ajuste orki.catalog_action_id (como en fusion_especies.sql). Los
-- nombres inventados se señalan con "ficticio".

-- Datos de partida, sin token (no dejan auditoría):
--   - Grupo "rosa del monte" en Vanda: cuatro plantas de tres usuarios, escritas de tres formas
--     (la más frecuente es "rosa del Monte"), una perdida y dos con foto.
--   - Grupo "rosa del monte" en Phalaenopsis: mismo nombre, otro género, otro grupo.
--   - Grupo "nube blanca" en Phalaenopsis: cinco plantas de user_c, todas con foto.
--   - Una planta validada de user_b, con foto, y especies para enlazar.
insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
values
  ('Vanda coerulea', pruebas.genero('Vanda'), 'species', 'imported', 'col', '6VX01'),
  ('Cattleya labiata', pruebas.genero('Cattleya'), 'species', 'validated', 'col', '3Z4W1'),
  -- ficticio
  ('Vanda Rosa Ficticia', pruebas.genero('Vanda'), 'hybrid', 'validated', 'curated', null);

insert into public.plants
  (id, user_id, entered_name, genus_id, type, status, origin, location, nickname, photo_path, thumbnail_path, created_at)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'user_a', '  Rosa   del monte ', pruebas.genero('Vanda'), 'unknown', 'active',
   'Vivero secreto', 'Balcón', 'La consentida',
   'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-v1.webp',
   'user_a/aaaaaaaa-0000-4000-8000-000000000001/thumb-v1.webp', '2026-11-01'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'user_b', 'rosa del Monte', pruebas.genero('Vanda'), 'species', 'active',
   null, null, null,
   'user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-v1.webp',
   'user_b/bbbbbbbb-0000-4000-8000-000000000001/thumb-v1.webp', '2026-11-02'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'user_b', 'Rósa del monte', pruebas.genero('Vanda'), 'unknown', 'lost',
   null, null, null, null, null, '2026-11-03'),
  ('cccccccc-0000-4000-8000-000000000001', 'user_c', 'rosa del Monte', pruebas.genero('Vanda'), 'species', 'active',
   null, null, null, null, null, '2026-11-04'),
  ('bbbbbbbb-0000-4000-8000-000000000003', 'user_b', 'Rosa del monte', pruebas.genero('Phalaenopsis'), 'hybrid', 'active',
   null, null, null, null, null, '2026-11-05');

insert into public.plants (id, user_id, entered_name, genus_id, type, photo_path, thumbnail_path, created_at)
select ('cccccccc-0000-4000-8000-00000000001' || n)::uuid, 'user_c', 'Nube blanca', pruebas.genero('Phalaenopsis'), 'hybrid',
       'user_c/cccccccc-0000-4000-8000-00000000001' || n || '/photo-v1.webp',
       'user_c/cccccccc-0000-4000-8000-00000000001' || n || '/thumb-v1.webp',
       ('2026-11-1' || n)::timestamptz
  from generate_series(1, 5) n;

insert into public.plants (id, user_id, entered_name, species_id, photo_path, thumbnail_path)
values
  ('bbbbbbbb-0000-4000-8000-000000000009', 'user_b', 'Mi labiata', pruebas.especie('Cattleya labiata'),
   'user_b/bbbbbbbb-0000-4000-8000-000000000009/photo-v1.webp',
   'user_b/bbbbbbbb-0000-4000-8000-000000000009/thumb-v1.webp');

insert into storage.objects (bucket_id, name)
values
  ('plant-photos', 'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-v1.webp'),
  ('plant-photos', 'user_a/aaaaaaaa-0000-4000-8000-000000000001/thumb-v1.webp'),
  ('plant-photos', 'user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-v1.webp'),
  ('plant-photos', 'user_b/bbbbbbbb-0000-4000-8000-000000000001/thumb-v1.webp'),
  ('plant-photos', 'user_b/bbbbbbbb-0000-4000-8000-000000000009/photo-v1.webp'),
  ('plant-photos', 'user_b/bbbbbbbb-0000-4000-8000-000000000009/thumb-v1.webp');

-- Fin de una petición a la API.
create function pg_temp.fin_de_peticion()
returns void
language sql
as $$
  select set_config('orki.catalog_action_id', '', true)
$$;

-- Actuar como el administrador del catálogo.
create function pg_temp.como_admin()
returns void
language sql
as $$
  select set_config('request.jwt.claims', '{"sub": "admin_1", "role": "authenticated", "app_role": "catalog_admin"}', true)
$$;

-- La cola, en una línea por grupo: nombre propuesto [clave] género tipo ×plantas fotos:n.
create function pg_temp.cola()
returns text
language sql
as $$
  select coalesce(string_agg(
           g.proposed_name || ' [' || g.name_key || '] ' || g.genus_name || ' ' || g.type
             || ' ×' || g.plant_count || ' fotos:' || jsonb_array_length(g.photos),
           ' | ' order by o.n), 'vacía')
  from public.list_proposal_groups() with ordinality o (name_key, proposed_name, genus_id, genus_name, type,
                                                         plant_count, photos, total_count, n)
  cross join lateral (select o.name_key, o.proposed_name, o.genus_name, o.type, o.plant_count, o.photos) g
$$;

-- Las plantas, en una línea: usuario/nombre ingresado → especie (género, tipo, validación).
-- Se llama como postgres (RLS oculta las plantas de otros usuarios).
create function pg_temp.plantas()
returns text
language sql
as $$
  select string_agg(
           p.user_id || '/' || p.entered_name || ' → ' || coalesce(s.scientific_name, '-')
             || ' (' || g.name || ', ' || p.type || ', ' || p.validation || ')',
           ', ' order by p.user_id, p.entered_name collate "C", p.id)
  from public.plants p
  join public.genera g on g.id = p.genus_id
  left join public.species s on s.id = p.species_id
  where p.entered_name not like 'Nube%'
$$;

-- Todo lo que una resolución podría cambiar, para comprobar que nada cambió.
create function pg_temp.foto()
returns text
language sql
as $$
  select coalesce((select string_agg(p.id || ':' || coalesce(p.species_id::text, '-') || ':' || p.validation, ',' order by p.id)
                     from public.plants p), '')
    || ' | ' || (select count(*) from public.species)
    || ' | ' || (select count(*) from public.catalog_audit_log)
$$;

-- prueba: permisos: anon, un usuario sin rol, otro rol y la clave de servicio reciben 42501 y nada cambia
set local role postgres;
select pg_temp.foto() as antes \gset
do $$
declare
  peticion text[];
  sentencia text;
begin
  foreach peticion slice 1 in array array[
    array['anon', '{"role": "anon"}'],
    array['anon', '{"role": "anon", "app_role": "catalog_admin"}'],
    array['authenticated', '{"sub": "user_a", "role": "authenticated"}'],
    array['authenticated', '{"sub": "user_a", "role": "authenticated", "app_role": "admin"}'],
    array['service_role', '{"role": "service_role"}']
  ] loop
    execute format('set local role %I', peticion[1]);
    perform set_config('request.jwt.claims', peticion[2], true);
    foreach sentencia in array array[
      $q$select * from public.list_proposal_groups()$q$,
      $q$select public.count_proposal_groups()$q$,
      $q$select * from public.link_proposal_group('rosa del monte', pruebas.genero('Vanda'), pruebas.especie('Vanda coerulea'))$q$,
      $q$select * from public.create_species_from_proposal('rosa del monte', pruebas.genero('Vanda'), 'Vanda ficticia', pruebas.genero('Vanda'), 'species')$q$,
      $q$select * from public.mark_proposal_unidentifiable('rosa del monte', pruebas.genero('Vanda'))$q$,
      -- Con datos que no existen: el rol se comprueba antes que nada.
      $q$select * from public.link_proposal_group(null, null, gen_random_uuid())$q$
    ] loop
      perform pruebas.debe_fallar(peticion[1] || ' ' || peticion[2] || ': ' || sentencia, sentencia, '42501');
    end loop;
    reset role;
  end loop;
end;
$$;
set local role postgres;
select pruebas.iguales('nada cambió', pg_temp.foto(), :'antes');

-- prueba: propiedades: solo authenticated las ejecuta, definer, search_path vacío y el guardián primero
select pruebas.iguales(
  'quién puede ejecutarlas',
  (select string_agg(f.firma || ':' || r.rol, ', ' order by f.firma, r.rol)
     from (values
       ('public.list_proposal_groups(integer, integer)'),
       ('public.count_proposal_groups()'),
       ('public.link_proposal_group(text, uuid, uuid)'),
       ('public.create_species_from_proposal(text, uuid, text, uuid, public.species_type)'),
       ('public.mark_proposal_unidentifiable(text, uuid)')
     ) f (firma)
     cross join (values ('anon'), ('authenticated'), ('service_role')) r (rol)
     where has_function_privilege(r.rol, f.firma, 'execute')),
  'public.count_proposal_groups():authenticated, '
  'public.create_species_from_proposal(text, uuid, text, uuid, public.species_type):authenticated, '
  'public.link_proposal_group(text, uuid, uuid):authenticated, '
  'public.list_proposal_groups(integer, integer):authenticated, '
  'public.mark_proposal_unidentifiable(text, uuid):authenticated'
);
select pruebas.iguales(
  'security definer, search_path y guardián',
  (select string_agg(p.proname || ' definer=' || p.prosecdef || ' ' || array_to_string(p.proconfig, ',')
                       || ' guardián=' || pruebas.llama_primero_al_guardian('plpgsql', p.prosrc), '; ' order by p.proname)
     from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('list_proposal_groups', 'count_proposal_groups', 'link_proposal_group',
                         'create_species_from_proposal', 'mark_proposal_unidentifiable')),
  'count_proposal_groups definer=true search_path="" guardián=true; '
  'create_species_from_proposal definer=true search_path="" guardián=true; '
  'link_proposal_group definer=true search_path="" guardián=true; '
  'list_proposal_groups definer=true search_path="" guardián=true; '
  'mark_proposal_unidentifiable definer=true search_path="" guardián=true'
);
select pruebas.iguales(
  'el listado y la cuenta no escriben',
  (select string_agg(p.proname || '=' || p.provolatile::text, ', ' order by p.proname)
     from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('list_proposal_groups', 'count_proposal_groups')),
  'count_proposal_groups=s, list_proposal_groups=s'
);

-- prueba: datos: las columnas del resultado son solo las de la propuesta, sin usuario, origen, ubicación, apodo, fechas ni ids de plantas
select pruebas.iguales(
  'columnas de list_proposal_groups',
  (select array_to_string(p.proargnames[3:], ', ')
     from pg_proc p where p.oid = 'public.list_proposal_groups(integer, integer)'::regprocedure),
  'name_key, proposed_name, genus_id, genus_name, type, plant_count, photos, total_count'
);
select pruebas.iguales(
  'columnas de la resolución',
  (select string_agg(p.proname || '(' || array_to_string(p.proargnames[p.pronargs + 1:], ', ') || ')', ', ' order by p.proname)
     from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('link_proposal_group', 'create_species_from_proposal', 'mark_proposal_unidentifiable')),
  'create_species_from_proposal(action_id, plant_count, species_id), '
  'link_proposal_group(action_id, plant_count), mark_proposal_unidentifiable(action_id, plant_count)'
);
set local role authenticated;
select pg_temp.como_admin();
select pruebas.iguales(
  'claves de cada foto',
  (select string_agg(distinct k, ', ' order by k)
     from public.list_proposal_groups() g
     cross join lateral jsonb_array_elements(g.photos) f
     cross join lateral jsonb_object_keys(f) k),
  'photo_path, thumbnail_path'
);
select pruebas.comprobar(
  'ningún dato personal de las plantas en el resultado',
  (select bool_and(t !~ '(Vivero secreto|Balcón|La consentida|2026-11)')
     from (select to_jsonb(g)::text t from public.list_proposal_groups() g) r)
);

-- prueba: listado: grupos por nombre normalizado y género, del más grande al más pequeño, con la forma más frecuente, el tipo más frecuente y hasta seis fotos
set local role authenticated;
select pg_temp.como_admin();
select pruebas.iguales(
  'la cola',
  pg_temp.cola(),
  'Nube blanca [nube blanca] Phalaenopsis hybrid ×5 fotos:5 | '
  'rosa del Monte [rosa del monte] Vanda species ×4 fotos:2 | '
  'Rosa del monte [rosa del monte] Phalaenopsis hybrid ×1 fotos:0'
);
select pruebas.iguales(
  'principales de la planta más reciente a la más antigua',
  (select string_agg(f ->> 'thumbnail_path', ', ' order by o.n)
     from public.list_proposal_groups() g
     cross join lateral jsonb_array_elements(g.photos) with ordinality o (f, n)
     where g.name_key = 'rosa del monte' and g.genus_name = 'Vanda'),
  'user_b/bbbbbbbb-0000-4000-8000-000000000001/thumb-v1.webp, user_a/aaaaaaaa-0000-4000-8000-000000000001/thumb-v1.webp'
);
select pruebas.iguales('total en cada fila', (select string_agg(distinct total_count::text, ',') from public.list_proposal_groups()), '3');
select pruebas.iguales('count_proposal_groups', public.count_proposal_groups(), 3::bigint);

-- prueba: listado: paginación por desplazamiento, tamaño por defecto y tope
set local role authenticated;
select pg_temp.como_admin();
select pruebas.iguales(
  'segunda página de uno',
  (select string_agg(g.proposed_name || '/' || g.genus_name || '/' || g.total_count, ', ') from public.list_proposal_groups(1, 1) g),
  'rosa del Monte/Vanda/3'
);
select pruebas.iguales('más allá del final', (select count(*) from public.list_proposal_groups(20, 3)), 0::bigint);
select pruebas.iguales('tamaño nulo, cero o negativo', (select count(*) from public.list_proposal_groups(null, null)) + (select count(*) from public.list_proposal_groups(0, -5)), 6::bigint);
set local role postgres;
insert into public.plants (user_id, entered_name, genus_id, type)
select 'user_d', 'Ficticia ' || n, pruebas.genero('Vanda'), 'unknown' from generate_series(1, 120) n;
set local role authenticated;
select pg_temp.como_admin();
select pruebas.iguales('tope de 100', (select count(*) from public.list_proposal_groups(500)), 100::bigint);
select pruebas.iguales('20 por defecto', (select count(*) from public.list_proposal_groups()), 20::bigint);

-- prueba: enlazar: todas las plantas del grupo, de usuarios distintos, pasan a la especie con su género y su tipo, sin tocar el nombre ingresado
set local role authenticated;
select pg_temp.como_admin();
select pruebas.iguales(
  'resultado',
  (select r.plant_count::text || ' acción=' || (r.action_id is not null)
     from public.link_proposal_group('rosa del monte', pruebas.genero('Vanda'), pruebas.especie('Vanda Rosa Ficticia')) r),
  '4 acción=true'
);
select pg_temp.fin_de_peticion();
set local role postgres;
select pruebas.iguales(
  'plantas',
  pg_temp.plantas(),
  'user_a/  Rosa   del monte  → Vanda Rosa Ficticia (Vanda, hybrid, validated), '
  'user_b/Mi labiata → Cattleya labiata (Cattleya, species, validated), '
  'user_b/Rosa del monte → - (Phalaenopsis, hybrid, pending), '
  'user_b/Rósa del monte → Vanda Rosa Ficticia (Vanda, hybrid, validated), '
  'user_b/rosa del Monte → Vanda Rosa Ficticia (Vanda, hybrid, validated), '
  'user_c/rosa del Monte → Vanda Rosa Ficticia (Vanda, hybrid, validated)'
);
select pruebas.iguales('la perdida sigue perdida', (select status::text from public.plants where id = 'bbbbbbbb-0000-4000-8000-000000000002'), 'lost');
set local role authenticated;
select pg_temp.como_admin();
select pruebas.iguales(
  'el grupo sale de la cola',
  pg_temp.cola(),
  'Nube blanca [nube blanca] Phalaenopsis hybrid ×5 fotos:5 | Rosa del monte [rosa del monte] Phalaenopsis hybrid ×1 fotos:0'
);
select pruebas.iguales('count_proposal_groups', public.count_proposal_groups(), 2::bigint);
-- El dueño ve su planta con la especie.
select set_config('request.jwt.claims', '{"sub": "user_a", "role": "authenticated"}', true);
select pruebas.iguales(
  'user_a ve su planta validada',
  (select p.validation || ' ' || p.species_id::text from public.plants p where p.id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'validated ' || pruebas.especie('Vanda Rosa Ficticia')
);

-- prueba: enlazar: la clave vale también como se escribió, y el género separa los grupos
set local role authenticated;
select pg_temp.como_admin();
select pruebas.iguales(
  'plantas enlazadas',
  (select r.plant_count from public.link_proposal_group('  ROSA del Mónte ', pruebas.genero('Phalaenopsis'), pruebas.especie('Cattleya labiata')) r),
  1::bigint
);
set local role postgres;
select pruebas.iguales(
  'solo la de Phalaenopsis, que toma el género de la especie',
  (select string_agg(g.name || ':' || p.validation, ', ' order by p.id)
     from public.plants p join public.genera g on g.id = p.genus_id
     where p.entered_name ilike '%del m%nte%'),
  'Vanda:pending, Vanda:pending, Vanda:pending, Cattleya:validated, Vanda:pending'
);

-- prueba: dos administradores: resolver un grupo ya resuelto no falla, no toca sus plantas y no deja auditoría
set local role authenticated;
select pg_temp.como_admin();
select public.link_proposal_group('rosa del monte', pruebas.genero('Vanda'), pruebas.especie('Vanda Rosa Ficticia'));
select pg_temp.fin_de_peticion();
set local role postgres;
select pg_temp.foto() as antes \gset
set local role authenticated;
select pg_temp.como_admin();
select pruebas.iguales(
  'enlazar otra vez a otra especie',
  (select r.plant_count || ' acción=' || coalesce(r.action_id::text, 'ninguna')
     from public.link_proposal_group('rosa del monte', pruebas.genero('Vanda'), pruebas.especie('Vanda coerulea')) r),
  '0 acción=ninguna'
);
select pruebas.iguales(
  'marcar como no identificable',
  (select r.plant_count || ' acción=' || coalesce(r.action_id::text, 'ninguna')
     from public.mark_proposal_unidentifiable('rosa del monte', pruebas.genero('Vanda')) r),
  '0 acción=ninguna'
);
select pruebas.iguales(
  'crear la especie',
  (select r.plant_count || ' acción=' || coalesce(r.action_id::text, 'ninguna') || ' especie=' || coalesce(r.species_id::text, 'ninguna')
     from public.create_species_from_proposal('rosa del monte', pruebas.genero('Vanda'), 'Vanda ficticia', pruebas.genero('Vanda'), 'species') r),
  '0 acción=ninguna especie=ninguna'
);
set local role postgres;
select pruebas.iguales('nada cambió', pg_temp.foto(), :'antes');

-- prueba: rechazos con su motivo: grupo sin clave y especie que no existe, sin cambiar nada
set local role postgres;
select pg_temp.foto() as antes \gset
set local role authenticated;
select pg_temp.como_admin();
select pruebas.iguales(
  'sin clave',
  pruebas.motivo_error($$select * from public.link_proposal_group('  ', pruebas.genero('Vanda'), pruebas.especie('Vanda coerulea'))$$),
  '22023 group_required'
);
select pruebas.iguales(
  'sin género',
  pruebas.motivo_error($$select * from public.mark_proposal_unidentifiable('rosa del monte', null)$$),
  '22023 group_required'
);
select pruebas.iguales(
  'especie que no existe',
  pruebas.motivo_error($$select * from public.link_proposal_group('rosa del monte', pruebas.genero('Vanda'), gen_random_uuid())$$),
  'P0002 species_not_found'
);
select pruebas.iguales(
  'especie nula',
  pruebas.motivo_error($$select * from public.link_proposal_group('rosa del monte', pruebas.genero('Vanda'), null)$$),
  'P0002 species_not_found'
);
set local role postgres;
select pruebas.iguales('nada cambió', pg_temp.foto(), :'antes');

-- prueba: crear: la especie nace validada, con fuente propuesta de usuario y sin referencia, y se enlaza el grupo en la misma transacción
set local role authenticated;
select pg_temp.como_admin();
select r.species_id as creada, r.plant_count as enlazadas
  from public.create_species_from_proposal('rosa del monte', pruebas.genero('Vanda'), '  Vanda   rosa-del-monte ', pruebas.genero('Vanda'), 'hybrid') r \gset
select pg_temp.fin_de_peticion();
select pruebas.iguales('plantas enlazadas', :'enlazadas'::bigint, 4::bigint);
set local role postgres;
select pruebas.iguales(
  'la especie',
  (select s.scientific_name || ' ' || g.name || ' ' || s.type || ' ' || s.status || ' ' || s.source || ' ' || coalesce(s.source_ref, 'sin-ref')
     from public.species s join public.genera g on g.id = s.genus_id where s.id = :'creada'),
  'Vanda rosa-del-monte Vanda hybrid validated user_proposal sin-ref'
);
select pruebas.iguales(
  'las plantas del grupo',
  (select string_agg(p.validation || ':' || p.type, ', ' order by p.id) from public.plants p where p.species_id = :'creada'),
  'validated:hybrid, validated:hybrid, validated:hybrid, validated:hybrid'
);
select pruebas.iguales('se encuentra en la búsqueda', (select s.scientific_name from public.search_species('rosa-del-monte', 1) s), 'Vanda rosa-del-monte');
select pruebas.iguales(
  'historial de la especie: una entrada con su alta',
  (select string_agg(h.action || ' [' || (select string_agg((c ->> 'table_name') || ':' || (c ->> 'action'), ', ') from jsonb_array_elements(h.changes) c) || ']', ' | ')
     from public.species_history(:'creada') h),
  'create_species_from_proposal [species:insert]'
);

-- prueba: crear: los rechazos de create_catalog_species() no crean nada ni enlazan nada
set local role postgres;
select pg_temp.foto() as antes \gset
set local role authenticated;
select pg_temp.como_admin();
select pruebas.iguales(
  'nombre de otra especie',
  pruebas.motivo_error($$select * from public.create_species_from_proposal('rosa del monte', pruebas.genero('Vanda'), 'vanda COERULEA', pruebas.genero('Vanda'), 'species')$$),
  '23505 duplicate_name'
);
select pruebas.iguales(
  'casi igual a otra especie',
  pruebas.motivo_error($$select * from public.create_species_from_proposal('rosa del monte', pruebas.genero('Vanda'), 'Vanda cóerulea', pruebas.genero('Vanda'), 'species')$$),
  '23505 similar_name'
);
select pruebas.iguales(
  'sin nombre',
  pruebas.motivo_error($$select * from public.create_species_from_proposal('rosa del monte', pruebas.genero('Vanda'), '  ', pruebas.genero('Vanda'), 'species')$$),
  '22023 name_required'
);
select pruebas.iguales(
  'sin tipo',
  pruebas.motivo_error($$select * from public.create_species_from_proposal('rosa del monte', pruebas.genero('Vanda'), 'Vanda ficticia', pruebas.genero('Vanda'), null)$$),
  '22023 type_required'
);
select pruebas.iguales(
  'género que no existe',
  pruebas.motivo_error($$select * from public.create_species_from_proposal('rosa del monte', pruebas.genero('Vanda'), 'Vanda ficticia', gen_random_uuid(), 'species')$$),
  '23503 genus_not_found'
);
set local role postgres;
select pruebas.iguales('nada cambió', pg_temp.foto(), :'antes');

-- prueba: no identificable: la planta sale de la cola, sin especie, y sigue en el inventario de su dueño, que puede editarla
set local role authenticated;
select pg_temp.como_admin();
select pruebas.iguales(
  'plantas marcadas',
  (select r.plant_count from public.mark_proposal_unidentifiable('rosa del monte', pruebas.genero('Vanda')) r),
  4::bigint
);
select pruebas.iguales(
  'la cola',
  pg_temp.cola(),
  'Nube blanca [nube blanca] Phalaenopsis hybrid ×5 fotos:5 | Rosa del monte [rosa del monte] Phalaenopsis hybrid ×1 fotos:0'
);
select set_config('request.jwt.claims', '{"sub": "user_b", "role": "authenticated"}', true);
select pruebas.iguales(
  'user_b ve sus plantas',
  (select string_agg(p.entered_name || ':' || p.validation || ':' || coalesce(p.species_id::text, '-') || ':' || p.status, ', ' order by p.id)
     from public.plants p),
  'rosa del Monte:unidentifiable:-:active, Rósa del monte:unidentifiable:-:lost, '
  'Rosa del monte:pending:-:active, Mi labiata:validated:' || pruebas.especie('Cattleya labiata') || ':active'
);
select pruebas.debe_funcionar(
  'user_b edita su planta no identificable',
  $$update public.plants set nickname = 'La rara', location = 'Patio' where id = 'bbbbbbbb-0000-4000-8000-000000000001'$$
);
select pruebas.iguales(
  'sigue no identificable',
  (select validation::text || ' ' || nickname from public.plants where id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  'unidentifiable La rara'
);

-- prueba: auditoría: una acción por resolución con sus datos, sin ids de usuarios ni rutas de fotos
set local role authenticated;
select pg_temp.como_admin();
select public.link_proposal_group('rosa del monte', pruebas.genero('Phalaenopsis'), pruebas.especie('Vanda coerulea'));
select pg_temp.fin_de_peticion();
select public.create_species_from_proposal('nube blanca', pruebas.genero('Phalaenopsis'), 'Phalaenopsis Nube Ficticia', pruebas.genero('Phalaenopsis'), 'hybrid');
select pg_temp.fin_de_peticion();
select public.mark_proposal_unidentifiable('rosa del monte', pruebas.genero('Vanda'));
select pg_temp.fin_de_peticion();
set local role postgres;
select pruebas.iguales(
  'acciones',
  (select string_agg(a.actor || ' ' || a.action || ' ' || coalesce(a.table_name, '-') || ' '
                       || (a.details - 'genus_id' - 'species_id')::text
                       || case when a.details ? 'species_id' then ' especie=' || (a.row_id = (a.details ->> 'species_id')::uuid) else '' end,
                     ' | ' order by a.id)
     from public.catalog_audit_log a
     where a.action not in ('insert', 'update', 'delete')),
  'admin_1 link_proposal_group species {"name_key": "rosa del monte", "genus_name": "Phalaenopsis", "plant_count": 1, "proposed_name": "Rosa del monte", "scientific_name": "Vanda coerulea"} especie=true | '
  'admin_1 create_species_from_proposal species {"name_key": "nube blanca", "genus_name": "Phalaenopsis", "plant_count": 5, "proposed_name": "Nube blanca", "scientific_name": "Phalaenopsis Nube Ficticia"} especie=true | '
  'admin_1 mark_proposal_unidentifiable - {"name_key": "rosa del monte", "genus_name": "Vanda", "plant_count": 4, "proposed_name": "rosa del Monte"}'
);
select pruebas.comprobar(
  'sin ids de usuarios ni rutas',
  (select bool_and(a.details::text !~ '(user_|photo|thumb|/)') from public.catalog_audit_log a where a.details is not null)
);
select pruebas.iguales(
  'enlazar no cambia la especie: solo la acción; crear deja su alta bajo la acción',
  (select string_agg(a.action || ':' || coalesce(a.table_name, '-'), ', ' order by a.id) from public.catalog_audit_log a),
  'link_proposal_group:species, create_species_from_proposal:species, insert:species, mark_proposal_unidentifiable:-'
);
select pruebas.iguales(
  'el alta va con la acción de crear',
  (select count(distinct a.action_id) from public.catalog_audit_log a
     where a.action in ('create_species_from_proposal', 'insert')),
  1::bigint
);

-- prueba: fotos: el administrador lee la foto de una planta por validar y deja de poder leerla al resolverse
set local role authenticated;
select pg_temp.como_admin();
select pruebas.iguales(
  'objetos visibles antes',
  (select string_agg(o.name, ', ' order by o.name) from storage.objects o where o.bucket_id = 'plant-photos'),
  'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-v1.webp, user_a/aaaaaaaa-0000-4000-8000-000000000001/thumb-v1.webp, '
  'user_b/bbbbbbbb-0000-4000-8000-000000000001/photo-v1.webp, user_b/bbbbbbbb-0000-4000-8000-000000000001/thumb-v1.webp'
);
select pruebas.comprobar(
  'las rutas del listado son las que puede leer',
  (select bool_and(exists (select from storage.objects o where o.name = f ->> 'thumbnail_path')
                   and exists (select from storage.objects o where o.name = f ->> 'photo_path'))
     from public.list_proposal_groups() g cross join lateral jsonb_array_elements(g.photos) f
     where g.genus_name = 'Vanda')
);
select public.mark_proposal_unidentifiable('rosa del monte', pruebas.genero('Vanda'));
select pruebas.iguales('objetos visibles después', (select count(*) from storage.objects o where o.bucket_id = 'plant-photos'), 0::bigint);

-- prueba: fotos: el administrador no lee la foto de una planta validada de otro usuario, ni un usuario sin rol las ajenas
set local role authenticated;
select pg_temp.como_admin();
select pruebas.iguales(
  'el administrador busca la foto de la validada',
  (select count(*) from storage.objects o where o.name like 'user_b/bbbbbbbb-0000-4000-8000-000000000009/%'),
  0::bigint
);
select set_config('request.jwt.claims', '{"sub": "user_a", "role": "authenticated"}', true);
select pruebas.iguales(
  'user_a ve solo lo suyo',
  (select string_agg(o.name, ', ' order by o.name) from storage.objects o),
  'user_a/aaaaaaaa-0000-4000-8000-000000000001/photo-v1.webp, user_a/aaaaaaaa-0000-4000-8000-000000000001/thumb-v1.webp'
);

-- prueba: índice: las plantas por validar de un grupo, con la misma expresión que las funciones
select pruebas.iguales(
  'definición',
  pg_get_indexdef('public.plants_pending_group_idx'::regclass),
  'CREATE INDEX plants_pending_group_idx ON public.plants USING btree (genus_id, normalize_search_text(entered_name)) WHERE (validation = ''pending''::plant_validation)'
);
