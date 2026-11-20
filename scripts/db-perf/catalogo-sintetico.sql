-- Catálogo sintético para medir el rendimiento de la búsqueda (issue #70, parte de #7).
--
-- Lo ejecuta scripts/db-perf.mjs (npm run db:perf) con psql, como superusuario, sobre la base
-- desechable con todas las migraciones aplicadas. Nunca se carga en Supabase. Recibe estas
-- variables de psql (-v nombre=valor):
--
--   semilla     texto que fija los datos: con la misma semilla y las mismas cifras sale
--               exactamente el mismo catálogo.
--   generos     número de géneros (incluidos los cinco de acceso rápido de la migración).
--   especies    número de especies e híbridos aceptados.
--   sinonimos   número de sinónimos (species_names de tipo synonym).
--   comunes     número de nombres comunes (species_names de tipo common).
--
-- Determinista: no usa random(). Cada decisión sale de un número entre 0 y 1 calculado con
-- md5(semilla:etiqueta:n), así que no depende del orden en que Postgres evalúe las filas.
--
-- Los nombres imitan a los reales en longitud y en trigramas, porque de eso depende el
-- rendimiento de los índices de trigramas:
--   - Géneros: unos cincuenta reales (los más grandes y los de acceso rápido) y el resto
--     compuestos con sílabas y terminaciones de géneros de orquídeas (-bium, -thallis,
--     -glossum, -anthe...).
--   - Especies: género + epíteto. Algo menos de la mitad de los epítetos sale de una lista de
--     epítetos reales que se repiten mucho entre géneros (alba, grandiflora, speciosa...),
--     con unos pocos mucho más frecuentes que el resto; los demás se componen con sílabas y
--     terminaciones latinas (-ensis, -iana, -ii, -ifolia, -oides...). Un 10 % son híbridos con
--     nombre de grex ("Phalaenopsis Sogo Yukidian") y un 3 % lleva variedad o subespecie.
--   - El reparto de especies por género es muy desigual, como en la realidad (Bulbophyllum y
--     Dendrobium tienen miles; muchos géneros, una o ninguna).
--   - Sinónimos: sobre todo el mismo epíteto en otro género (a veces con otra terminación),
--     como "Doritis pulcherrima" para Phalaenopsis pulcherrima; también otro epíteto en el
--     mismo género.
--   - Nombres comunes en español (con tildes) e inglés, muy repetidos entre especies y
--     concentrados en las especies más populares.
--   - Unas especies fijas con nombres reales (Phalaenopsis amabilis, Cattleya labiata,
--     Doritis pulcherrima, "orquídea mariposa"...), para que las consultas de la medición
--     tengan una respuesta conocida.
--
-- Cumple las restricciones del esquema: nombres sin espacios sobrantes, unicidad sin
-- distinguir mayúsculas (se descartan los repetidos antes de insertar), un nombre alternativo
-- una sola vez por especie, enumerados válidos y referencia de la fuente única en GBIF.

-- Parámetros y ayudantes -----------------------------------------------------------------

create temp table parametros as
select
  :'semilla'::text as semilla,
  :generos::integer as generos,
  :especies::integer as especies,
  :sinonimos::integer as sinonimos,
  :comunes::integer as comunes;

-- Número entre 0 y 1 (sin llegar a 1) que depende solo de la semilla, la etiqueta y n.
create function pg_temp.azar(semilla text, etiqueta text, n bigint)
returns double precision
language sql
immutable
as $$
  select ('x' || substr(md5(semilla || ':' || etiqueta || ':' || n), 1, 12))::bit(48)::bigint
    / 281474976710656.0
$$;

-- Un elemento de la lista, elegido con u (entre 0 y 1).
create function pg_temp.elegir(lista text[], u double precision)
returns text
language sql
immutable
as $$
  select lista[1 + floor(u * cardinality(lista))::integer]
$$;

create temp table listas as
select
  -- Géneros reales: los más grandes y los más cultivados. Van primero, así que reciben más
  -- especies (el reparto favorece a los primeros).
  array[
    'Bulbophyllum', 'Dendrobium', 'Epidendrum', 'Pleurothallis', 'Stelis', 'Lepanthes',
    'Masdevallia', 'Habenaria', 'Maxillaria', 'Specklinia', 'Oncidium', 'Liparis', 'Eria',
    'Coelogyne', 'Cymbidium', 'Malaxis', 'Phalaenopsis', 'Cattleya', 'Vanda',
    'Paphiopedilum', 'Prosthechea', 'Sobralia', 'Dracula', 'Gongora', 'Stanhopea', 'Lycaste',
    'Miltonia', 'Brassia', 'Encyclia', 'Laelia', 'Zygopetalum', 'Aerides', 'Angraecum',
    'Calanthe', 'Disa', 'Ophrys', 'Orchis', 'Cypripedium', 'Platanthera', 'Spiranthes',
    'Vanilla', 'Trichocentrum', 'Polystachya', 'Porroglossum', 'Restrepia', 'Telipogon',
    'Sarcochilus', 'Pterostylis', 'Caladenia', 'Guarianthe', 'Rhynchostylis', 'Dendrochilum',
    'Trichosalpinx', 'Acianthera', 'Octomeria', 'Scaphosepalum'
  ] as generos_reales,
  -- Géneros que hoy son sinónimos: solo aparecen en los sinónimos.
  array[
    'Doritis', 'Kingidium', 'Sophronitis', 'Euanthe', 'Ascocentrum', 'Odontoglossum',
    'Neofinetia', 'Cochlioda', 'Hexisea', 'Physosiphon', 'Kefersteinia', 'Cirrhopetalum',
    'Schomburgkia', 'Epidanthus', 'Pseudocentrum'
  ] as generos_antiguos,
  array[
    'a', 'ac', 'ae', 'an', 'as', 'bra', 'bul', 'ca', 'chy', 'cir', 'coe', 'cy', 'cym', 'den',
    'di', 'dra', 'e', 'epi', 'ge', 'gla', 'go', 'gon', 'hab', 'i', 'ly', 'lep', 'lip', 'ma',
    'max', 'mi', 'ne', 'o', 'on', 'or', 'pa', 'phal', 'pleu', 'po', 'pro', 'psy', 're', 'sa',
    'sar', 'so', 'spe', 'ste', 'ta', 'te', 'tho', 'tri', 'xy', 'zy'
  ] as inicios_genero,
  array[
    'lo', 'ro', 'to', 'do', 'no', 'li', 'ra', 'ca', 'cho', 'glo', 'phy', 'the', 'sto', 'ri',
    'ga', 'na', 'cen', 'pe', 'ty', 'chi'
  ] as medios_genero,
  array[
    'bium', 'phyllum', 'dendrum', 'thallis', 'vallia', 'lis', 'thes', 'cidium', 'laria',
    'aria', 'opsis', 'anthe', 'chilum', 'glossum', 'pedilum', 'gyne', 'ella', 'ia', 'stele',
    'chilus', 'idium', 'anthes', 'orchis', 'stylis', 'cleisia', 'rhynchus', 'petalum', 'ea',
    'ochilus', 'sepalum'
  ] as finales_genero,
  -- Epítetos reales frecuentes. Los primeros son los más repetidos.
  array[
    'alba', 'grandiflora', 'speciosa', 'elegans', 'gracilis', 'minor', 'major', 'purpurea',
    'rosea', 'lutea', 'aurea', 'nana', 'pumila', 'longifolia', 'latifolia', 'angustifolia',
    'parviflora', 'multiflora', 'pauciflora', 'densiflora', 'macrantha', 'micrantha', 'tenuis',
    'robusta', 'crassifolia', 'pulchra', 'pulchella', 'bicolor', 'tricolor', 'variegata',
    'maculata', 'punctata', 'striata', 'ciliata', 'fimbriata', 'lobata', 'acuminata',
    'obtusa', 'cordata', 'ovata', 'lanceolata', 'linearis', 'filiformis', 'pendula', 'erecta',
    'scandens', 'repens', 'epiphytica', 'terrestris', 'montana', 'sylvatica', 'palustris',
    'borealis', 'australis', 'orientalis', 'occidentalis', 'tropicalis', 'sinensis',
    'japonica', 'indica', 'javanica', 'philippinensis', 'brasiliensis', 'peruviana',
    'colombiana', 'mexicana', 'ecuadorensis', 'boliviana', 'venezuelana', 'costaricensis',
    'panamensis', 'guatemalensis', 'cubensis', 'africana', 'madagascariensis', 'nobile',
    'amabilis', 'labiata', 'coerulea', 'odorata', 'fragrans', 'nivea', 'candida', 'sanguinea',
    'coccinea', 'aurantiaca', 'viridis', 'violacea', 'schilleriana', 'stuartiana', 'lindenii',
    'hookeriana', 'lindleyana', 'reichenbachiana', 'wallichii', 'roxburghii', 'griffithii',
    'falcata', 'sanderiana', 'insignis', 'crispum', 'pulcherrima', 'mossiae', 'trianae',
    'walkeriana', 'skinneri', 'purpurata', 'sphacelatum', 'cucullata', 'barbata', 'hirsuta',
    'pubescens', 'glabra', 'vestita', 'cristata', 'tigrina', 'leucantha', 'xanthina'
  ] as epitetos_reales,
  array[
    'ma', 'ri', 'lo', 'ven', 'gar', 'del', 'bur', 'schi', 'kra', 'ne', 'mi', 'tor', 'pa',
    'fal', 'cri', 'sti', 'cor', 'bel', 'lin', 'sil', 'ru', 'cam', 'pe', 'go', 'nor', 'wal',
    'ken', 'hoo', 'lu', 'zo', 'ber', 'dun', 'har', 'mon', 'qui', 'te', 'vi', 'ar', 'el', 'or'
  ] as silabas,
  array[
    'ensis', 'iana', 'ianum', 'ii', 'ae', 'ata', 'atum', 'osa', 'osum', 'ifolia', 'iflora',
    'oides', 'ina', 'ella', 'ula', 'ica', 'icum', 'alis', 'ense', 'ophylla', 'ensis', 'iana',
    'ii', 'ata'
  ] as finales_epiteto,
  array[
    'mariposa', 'araña', 'luna', 'tigre', 'cisne', 'paloma', 'danzarina', 'zapatito', 'monja',
    'estrella', 'abeja', 'mosca', 'pájaro', 'dama', 'reina', 'cola de zorro',
    'boca de dragón', 'lluvia de oro', 'flor de mayo', 'del Espíritu Santo', 'cáscara de huevo'
  ] as comunes_es,
  array[
    'blanca', 'rosada', 'amarilla', 'del bosque', 'de montaña', 'enana', 'gigante',
    'perfumada', 'morada', 'de invierno', 'nocturna', 'andina', 'tropical', 'pintada'
  ] as adjetivos_es,
  array[
    'moth', 'spider', 'slipper', 'dancing lady', 'swan', 'butterfly', 'tiger', 'bee',
    'foxtail', 'star', 'lady''s tresses', 'jewel', 'bamboo', 'pansy', 'cockleshell', 'helmet'
  ] as comunes_en,
  array[
    'white', 'pink', 'yellow', 'dwarf', 'giant', 'fragrant', 'mountain', 'winter', 'spotted',
    'purple', 'golden', 'bearded', 'night'
  ] as adjetivos_en;

-- Géneros --------------------------------------------------------------------------------

-- Candidatos: los reales y el doble de compuestos de los que hacen falta; se descartan los
-- repetidos (sin distinguir mayúsculas) y los que coinciden con un género antiguo, y se
-- quedan los primeros.
create temp table sint_generos as
with candidatos as (
  select 0 as prioridad, r.n::bigint as n, r.name
  from listas l, unnest(l.generos_reales) with ordinality as r(name, n)
  union all
  select
    1,
    n,
    initcap(
      pg_temp.elegir(l.inicios_genero, pg_temp.azar(p.semilla, 'genero-inicio', n))
      || case when pg_temp.azar(p.semilla, 'genero-medio', n) < 0.7
           then pg_temp.elegir(l.medios_genero, pg_temp.azar(p.semilla, 'genero-medio-1', n))
           else '' end
      || case when pg_temp.azar(p.semilla, 'genero-medio-2', n) < 0.25
           then pg_temp.elegir(l.medios_genero, pg_temp.azar(p.semilla, 'genero-medio-2b', n))
           else '' end
      || pg_temp.elegir(l.finales_genero, pg_temp.azar(p.semilla, 'genero-final', n))
    )
  from parametros p, listas l, generate_series(1, p.generos * 2) as n
),
unicos as (
  select distinct on (lower(c.name)) c.*
  from candidatos c, listas l
  where lower(c.name) <> all (select lower(x) from unnest(l.generos_antiguos) as x)
  order by lower(c.name), c.prioridad, c.n
),
ordenados as (
  select row_number() over (order by prioridad, n)::integer as orden, name
  from unicos
)
select o.orden, o.name
from ordenados o, parametros p
where o.orden <= p.generos;

-- Los cinco de acceso rápido ya existen (los carga la migración del catálogo).
insert into public.genera (name)
select name from sint_generos order by orden
on conflict ((lower(name))) do nothing;

alter table sint_generos add column id uuid;
update sint_generos s set id = g.id from public.genera g where lower(g.name) = lower(s.name);
create unique index on sint_generos (orden);
analyze sint_generos;

-- Especies -------------------------------------------------------------------------------

-- Especies fijas con nombres reales, que usan las consultas de la medición.
create temp table fijas_especies (genus text, epithet text, type public.species_type);
insert into fijas_especies values
  ('Phalaenopsis', 'amabilis', 'species'),
  ('Phalaenopsis', 'pulcherrima', 'species'),
  ('Phalaenopsis', 'schilleriana', 'species'),
  ('Phalaenopsis', 'Sogo Yukidian', 'hybrid'),
  ('Cattleya', 'labiata', 'species'),
  ('Cattleya', 'trianae', 'species'),
  ('Dendrobium', 'nobile', 'species'),
  ('Oncidium', 'sphacelatum', 'species'),
  ('Vanda', 'coerulea', 'species'),
  ('Vanda', 'falcata', 'species');

create temp table sint_especies as
with candidatos as (
  select
    0 as prioridad,
    row_number() over ()::bigint as n,
    g.orden as genero,
    f.epithet,
    f.type
  from fijas_especies f
  join sint_generos g on g.name = f.genus
  union all
  select
    1,
    c.n,
    c.genero,
    case
      when c.hibrido then
        initcap(
          pg_temp.elegir(l.silabas, pg_temp.azar(p.semilla, 'grex-1', c.n))
          || pg_temp.elegir(l.silabas, pg_temp.azar(p.semilla, 'grex-2', c.n))
          || case when pg_temp.azar(p.semilla, 'grex-3', c.n) < 0.5
               then pg_temp.elegir(l.silabas, pg_temp.azar(p.semilla, 'grex-3b', c.n))
               else '' end
        )
        || case when pg_temp.azar(p.semilla, 'grex-palabra', c.n) < 0.6
             then ' ' || initcap(
               pg_temp.elegir(l.silabas, pg_temp.azar(p.semilla, 'grex-4', c.n))
               || pg_temp.elegir(l.silabas, pg_temp.azar(p.semilla, 'grex-5', c.n))
             )
             else '' end
      else
        c.epiteto
        || case when pg_temp.azar(p.semilla, 'infra', c.n) < 0.03
             then case when pg_temp.azar(p.semilla, 'infra-rango', c.n) < 0.5
                    then ' var. ' else ' subsp. ' end
               || pg_temp.elegir(l.epitetos_reales, pg_temp.azar(p.semilla, 'infra-epiteto', c.n))
             else '' end
    end,
    case when c.hibrido then 'hybrid' else 'species' end::public.species_type
  from parametros p, listas l,
  lateral (
    select
      n,
      -- Reparto desigual: los primeros géneros reciben muchas más especies.
      1 + floor(p.generos * power(pg_temp.azar(p.semilla, 'especie-genero', n), 2.5))::integer
        as genero,
      pg_temp.azar(p.semilla, 'hibrido', n) < 0.10 as hibrido,
      case
        when pg_temp.azar(p.semilla, 'epiteto-real', n) < 0.45 then
          -- Unos pocos epítetos reales se repiten mucho más que el resto.
          pg_temp.elegir(l.epitetos_reales, power(pg_temp.azar(p.semilla, 'epiteto-real-cual', n), 1.7))
        else
          pg_temp.elegir(l.silabas, pg_temp.azar(p.semilla, 'epiteto-1', n))
          || pg_temp.elegir(l.silabas, pg_temp.azar(p.semilla, 'epiteto-2', n))
          || case when pg_temp.azar(p.semilla, 'epiteto-3', n) < 0.4
               then pg_temp.elegir(l.silabas, pg_temp.azar(p.semilla, 'epiteto-3b', n))
               else '' end
          || pg_temp.elegir(l.finales_epiteto, pg_temp.azar(p.semilla, 'epiteto-final', n))
      end as epiteto
    from generate_series(1, (p.especies * 1.3)::integer) as n
  ) as c
),
con_nombre as (
  select c.*, g.name as genus_name, g.id as genus_id, g.name || ' ' || c.epithet as scientific_name
  from candidatos c
  join sint_generos g on g.orden = c.genero
),
unicos as (
  select distinct on (lower(scientific_name)) *
  from con_nombre
  order by lower(scientific_name), prioridad, n
),
ordenados as (
  select row_number() over (order by prioridad, n)::integer as orden, *
  from unicos
)
select
  o.orden,
  o.genero,
  o.genus_id,
  o.genus_name,
  o.epithet,
  o.scientific_name,
  o.type,
  case
    when pg_temp.azar(p.semilla, 'estado', o.orden) < 0.85 then 'imported'
    when pg_temp.azar(p.semilla, 'estado', o.orden) < 0.98 then 'validated'
    else 'observed'
  end::public.species_status as status,
  case when pg_temp.azar(p.semilla, 'fuente', o.orden) < 0.95 then 'gbif' else 'curated' end
    ::public.species_source as source
from ordenados o, parametros p
where o.orden <= p.especies;

do $$
declare
  faltan integer;
begin
  select p.especies - (select count(*) from sint_especies) into faltan from parametros p;
  if faltan > 0 then
    raise exception 'el generador solo encontró nombres únicos para % especies menos de las pedidas; prueba con otra semilla o más géneros', faltan;
  end if;
end;
$$;

insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
select
  scientific_name,
  genus_id,
  type,
  status,
  source,
  case when source = 'gbif' then (2000000 + orden)::text end
from sint_especies
order by orden;

alter table sint_especies add column id uuid;
update sint_especies e
set id = s.id
from public.species s
where lower(s.scientific_name) = lower(e.scientific_name);
create unique index on sint_especies (orden);
analyze sint_especies;

-- Sinónimos ------------------------------------------------------------------------------

create temp table fijos_nombres (species text, name text, type public.species_name_type, language text);
insert into fijos_nombres values
  ('Phalaenopsis pulcherrima', 'Doritis pulcherrima', 'synonym', null),
  ('Vanda falcata', 'Neofinetia falcata', 'synonym', null),
  ('Phalaenopsis amabilis', 'orquídea mariposa', 'common', 'es'),
  ('Phalaenopsis amabilis', 'moth orchid', 'common', 'en'),
  ('Cattleya trianae', 'flor de mayo', 'common', 'es'),
  ('Oncidium sphacelatum', 'dancing lady', 'common', 'en'),
  ('Oncidium sphacelatum', 'lluvia de oro', 'common', 'es');

create temp table sint_nombres as
with especies as (
  select count(*)::integer as total from sint_especies
),
candidatos_sinonimos as (
  select
    1 as prioridad,
    c.n,
    c.especie,
    case
      -- El mismo epíteto en otro género (a veces con otra terminación).
      when c.r < 0.55 then
        case when pg_temp.azar(p.semilla, 'sinonimo-antiguo', c.n) < 0.15
          then pg_temp.elegir(l.generos_antiguos, pg_temp.azar(p.semilla, 'sinonimo-antiguo-cual', c.n))
          else og.name
        end
        || ' ' || case when pg_temp.azar(p.semilla, 'sinonimo-terminacion', c.n) < 0.3
             then regexp_replace(regexp_replace(e.epithet, 'a$', 'um'), 'ii$', 'ianum')
             else e.epithet end
      -- Otro epíteto en el mismo género.
      when c.r < 0.85 then e.genus_name || ' ' || c.otro_epiteto
      -- Otro epíteto en otro género.
      else og.name || ' ' || c.otro_epiteto
    end as name,
    'synonym'::public.species_name_type as type,
    null::text as language
  from parametros p, listas l, especies t,
  lateral (
    select
      n,
      1 + floor(t.total * power(pg_temp.azar(p.semilla, 'sinonimo-especie', n), 1.3))::integer
        as especie,
      pg_temp.azar(p.semilla, 'sinonimo-tipo', n) as r,
      1 + floor(p.generos * power(pg_temp.azar(p.semilla, 'sinonimo-genero', n), 2))::integer
        as otro_genero,
      case
        when pg_temp.azar(p.semilla, 'sinonimo-epiteto-real', n) < 0.5 then
          pg_temp.elegir(l.epitetos_reales, pg_temp.azar(p.semilla, 'sinonimo-epiteto-cual', n))
        else
          pg_temp.elegir(l.silabas, pg_temp.azar(p.semilla, 'sinonimo-epiteto-1', n))
          || pg_temp.elegir(l.silabas, pg_temp.azar(p.semilla, 'sinonimo-epiteto-2', n))
          || pg_temp.elegir(l.finales_epiteto, pg_temp.azar(p.semilla, 'sinonimo-epiteto-final', n))
      end as otro_epiteto
    from generate_series(1, (p.sinonimos * 1.2)::integer) as n
  ) as c
  join sint_especies e on e.orden = c.especie
  join sint_generos og on og.orden = c.otro_genero
),
candidatos_comunes as (
  select
    1 as prioridad,
    c.n,
    c.especie,
    case
      when c.espanol then
        'orquídea ' || pg_temp.elegir(l.comunes_es, pg_temp.azar(p.semilla, 'comun-es', c.n))
        || case when pg_temp.azar(p.semilla, 'comun-es-adjetivo', c.n) < 0.6
             then ' ' || pg_temp.elegir(l.adjetivos_es, pg_temp.azar(p.semilla, 'comun-es-adjetivo-cual', c.n))
             else '' end
      else
        case when pg_temp.azar(p.semilla, 'comun-en-adjetivo', c.n) < 0.6
          then pg_temp.elegir(l.adjetivos_en, pg_temp.azar(p.semilla, 'comun-en-adjetivo-cual', c.n)) || ' '
          else '' end
        || pg_temp.elegir(l.comunes_en, pg_temp.azar(p.semilla, 'comun-en', c.n)) || ' orchid'
    end,
    'common'::public.species_name_type,
    case when c.espanol then 'es' else 'en' end
  from parametros p, listas l, especies t,
  lateral (
    select
      n,
      -- Los nombres comunes se concentran en las especies más populares (las primeras).
      1 + floor(t.total * power(pg_temp.azar(p.semilla, 'comun-especie', n), 3))::integer
        as especie,
      pg_temp.azar(p.semilla, 'comun-idioma', n) < 0.6 as espanol
    from generate_series(1, (p.comunes * 1.5)::integer) as n
  ) as c
),
fijos as (
  select 0 as prioridad, row_number() over ()::bigint as n, e.orden as especie, f.name, f.type, f.language
  from fijos_nombres f
  join sint_especies e on e.scientific_name = f.species
),
todos as (
  select * from fijos
  union all
  select * from candidatos_sinonimos
  union all
  select * from candidatos_comunes
),
unicos as (
  -- Un nombre una sola vez por especie, y nunca su propio nombre científico.
  select distinct on (t.especie, lower(t.name)) t.*, e.id as species_id
  from todos t
  join sint_especies e on e.orden = t.especie
  where lower(t.name) <> lower(e.scientific_name)
  order by t.especie, lower(t.name), t.prioridad, t.type, t.n
),
ordenados as (
  select row_number() over (partition by type order by prioridad, n)::integer as orden, *
  from unicos
)
select o.*
from ordenados o, parametros p
where o.orden <= case o.type when 'synonym' then p.sinonimos else p.comunes end;

do $$
declare
  faltan_sinonimos integer;
  faltan_comunes integer;
begin
  select
    p.sinonimos - (select count(*) from sint_nombres where type = 'synonym'),
    p.comunes - (select count(*) from sint_nombres where type = 'common')
  into faltan_sinonimos, faltan_comunes
  from parametros p;
  if faltan_sinonimos > 0 or faltan_comunes > 0 then
    raise exception 'el generador se quedó corto: faltan % sinónimos y % nombres comunes', faltan_sinonimos, faltan_comunes;
  end if;
end;
$$;

insert into public.species_names (species_id, name, type, language)
select species_id, name, type, language
from sint_nombres
order by type, orden;
