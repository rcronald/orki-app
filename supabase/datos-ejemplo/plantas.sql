-- Plantas de ejemplo para un usuario, solo para desarrollo.
--
-- Las carga "npm run db:seed:plants -- <id de usuario> [cantidad]" (scripts/supabase-db.mjs),
-- que sustituye :'usuario' y :cantidad después de validarlos. Sirven para probar el inventario
-- con una colección grande (issue #96). Nunca se cargan en producción.
--
-- Qué crea, de forma determinista para una cantidad dada:
--   - Un 85 % de plantas enlazadas a especies del catálogo, repartidas por turnos entre los
--     géneros más comunes en cultivo que existan en el catálogo. El género, el tipo y la
--     validación los pone el disparador de sincronización, como en un registro real.
--   - Un 15 % de plantas con nombre libre, sin especie, que quedan "por validar".
--   - Fechas de adquisición repartidas en los últimos años, cinco orígenes, cuatro ubicaciones,
--     algunos apodos y colores, y unas pocas dadas de baja (perdidas o regaladas).
--
-- Todas llevan un origen terminado en " (prueba)": así se reconocen en la app y se pueden
-- borrar con "npm run db:seed:plants -- <id de usuario> --borrar" sin tocar las plantas reales
-- del usuario.
--
-- Es una sola sentencia porque la CLI de Supabase solo admite una por consulta. Cada ejecución
-- añade plantas nuevas: no sustituye las de ejecuciones anteriores.

with parametros as (
  select
    :'usuario'::text as usuario,
    greatest(:cantidad::int - (:cantidad::int * 15 / 100), 0) as con_especie,
    :cantidad::int * 15 / 100 as sin_especie,
    array[
      'Vivero Los Andes (prueba)', 'Feria de orquídeas (prueba)', 'Intercambio (prueba)',
      'Mercado de flores (prueba)', 'Regalo (prueba)'
    ] as origenes,
    array['Ventana de la sala', 'Terraza', 'Invernadero', 'Baño'] as ubicaciones,
    array['white', 'pink', 'purple', 'yellow', 'orange', 'bicolor']::public.flower_color[] as colores
),
candidatas as (
  select
    s.id,
    s.scientific_name,
    s.genus_id,
    s.type,
    row_number() over (partition by s.genus_id order by md5(s.id::text)) as turno,
    g.name as genero
  from public.species s
  join public.genera g on g.id = s.genus_id
  where g.name in (
    'Phalaenopsis', 'Cattleya', 'Dendrobium', 'Oncidium', 'Vanda', 'Masdevallia',
    'Paphiopedilum', 'Epidendrum', 'Maxillaria', 'Cymbidium', 'Miltoniopsis', 'Lycaste'
  )
),
elegidas as (
  select c.*, row_number() over (order by c.turno, c.genero, c.id) as n
  from candidatas c
),
libres as (
  select
    i as n,
    (array[
      'la morada del mercado', 'orquídea de la abuela', 'la blanca grande', 'híbrido sin etiqueta',
      'la amarilla de la feria', 'mini de regalo'
    ])[1 + i % 6] || ' ' || i as nombre,
    (
      select g.id
      from public.genera g
      where g.name = (array['Cattleya', 'Phalaenopsis', 'Dendrobium', 'Oncidium', 'Vanda'])[1 + i % 5]
    ) as genus_id
  from parametros p, generate_series(1, p.sin_especie) as i
),
filas as (
  select e.n, e.id as species_id, e.scientific_name as entered_name, e.genus_id,
         e.type::text::public.plant_type as type
  from elegidas e, parametros p
  where e.n <= p.con_especie
  union all
  select 100000 + l.n, null, l.nombre, l.genus_id, 'unknown'::public.plant_type
  from libres l
  where l.genus_id is not null
)
insert into public.plants (
  user_id, species_id, entered_name, genus_id, type, acquired_on, origin, location, nickname,
  flower_color, status
)
select
  p.usuario,
  f.species_id,
  f.entered_name,
  f.genus_id,
  f.type,
  current_date - ((f.n * 37) % 1400)::int,
  p.origenes[1 + f.n % 5],
  case when f.n % 5 = 0 then null else p.ubicaciones[1 + f.n % 4] end,
  case when f.n % 7 = 0 then 'Ejemplar ' || f.n end,
  case when f.n % 4 = 0 then null else p.colores[1 + f.n % 6] end,
  case
    when f.n % 23 = 0 then 'lost'::public.plant_status
    when f.n % 31 = 0 then 'gifted'::public.plant_status
    else 'active'::public.plant_status
  end
from filas f, parametros p
returning id;
