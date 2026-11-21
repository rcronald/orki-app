-- Listado del catálogo para el backoffice (issue #99, parte de #20): list_catalog_species(),
-- search_catalog_species(), list_catalog_genera(), catalog_summary() y count_species_plants(),
-- de la migración 20261121100000_listado_del_catalogo_para_el_backoffice.sql, con sus índices
-- y sus permisos.
--
-- Las pruebas crean sus propias especies (no usan las de supabase/datos-ejemplo); los géneros y
-- abreviaturas cargados por las migraciones sí se usan. Los nombres inventados para provocar un
-- caso concreto se señalan con "ficticio". Las funciones son solo para administradores: cada
-- prueba se pone el rol authenticated con el claim app_role = catalog_admin antes de llamarlas.

-- Datos de partida: especies de cinco géneros con todos los estados, tipos y fuentes,
-- sinónimos y nombres comunes, 22 Dendrobium para recorrer varias páginas y plantas de dos
-- usuarios.
insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
values
  ('Phalaenopsis amabilis', pruebas.genero('Phalaenopsis'), 'species', 'validated', 'curated', null),
  ('Phalaenopsis aphrodite', pruebas.genero('Phalaenopsis'), 'species', 'imported', 'col', '4FR2K'),
  ('Phalaenopsis × intermedia', pruebas.genero('Phalaenopsis'), 'hybrid', 'imported', 'col', '4FR2L'),
  -- ficticio: se normaliza igual que el híbrido de arriba; el orden lo desempata el id.
  ('Phalaenopsis intermedia', pruebas.genero('Phalaenopsis'), 'species', 'observed', 'user_proposal', null),
  ('Phalaenopsis pulcherrima', pruebas.genero('Phalaenopsis'), 'species', 'observed', 'col', '4FR2M'),
  ('Cattleya labiata', pruebas.genero('Cattleya'), 'species', 'imported', 'col', '3Z4W1'),
  ('Cattleya purpurata', pruebas.genero('Cattleya'), 'species', 'validated', 'col', '3Z4W2'),
  ('Cattleya × elegans', pruebas.genero('Cattleya'), 'hybrid', 'imported', 'user_proposal', null),
  ('Ónc ficticia', pruebas.genero('Oncidium'), 'species', 'imported', 'curated', null),
  ('Oncidium sphacelatum', pruebas.genero('Oncidium'), 'species', 'validated', 'curated', null),
  ('Vanda coerulea', pruebas.genero('Vanda'), 'species', 'observed', 'gbif', '2828427'),
  ('Dendrobium nobile', pruebas.genero('Dendrobium'), 'species', 'imported', 'col', '3J9K0');

insert into public.species (scientific_name, genus_id, type, status, source, source_ref)
select 'Dendrobium ' || e, pruebas.genero('Dendrobium'), 'species', 'imported', 'col', 'D' || o
from unnest(array['aberrans', 'acerosum', 'aciculare', 'aduncum', 'aemulum', 'aggregatum',
                  'albosanguineum', 'amethystoglossum', 'anosmum', 'antennatum', 'aphyllum',
                  'atroviolaceum', 'bellatulum', 'bigibbum', 'bracteosum', 'bullenianum',
                  'chrysotoxum', 'crumenatum', 'cuthbertsonii', 'densiflorum', 'farmeri',
                  'fimbriatum']) with ordinality as x (e, o);

insert into public.species_names (species_id, name, type, language)
values
  (pruebas.especie('Cattleya purpurata'), 'Laelia purpurata', 'synonym', null),
  (pruebas.especie('Cattleya purpurata'), 'Laelia purpurata var. alba', 'synonym', null),
  (pruebas.especie('Cattleya purpurata'), 'flor de la reina', 'common', 'es'),
  (pruebas.especie('Phalaenopsis pulcherrima'), 'Doritis pulcherrima', 'synonym', null),
  (pruebas.especie('Phalaenopsis amabilis'), 'orquídea mariposa', 'common', 'es'),
  (pruebas.especie('Phalaenopsis amabilis'), 'moth orchid', 'common', 'en'),
  (pruebas.especie('Dendrobium nobile'), 'Callista nobilis', 'synonym', null);

-- Plantas: dos de user_a y una de user_b enlazadas a Phalaenopsis amabilis (una perdida), una
-- de user_b enlazada a Vanda coerulea y una sin especie.
insert into public.plants (user_id, entered_name, genus_id, type, species_id, status)
values
  ('user_a', 'Mi mariposa', pruebas.genero('Phalaenopsis'), 'species', pruebas.especie('Phalaenopsis amabilis'), 'active'),
  ('user_a', 'La de la ventana', pruebas.genero('Phalaenopsis'), 'species', pruebas.especie('Phalaenopsis amabilis'), 'lost'),
  ('user_b', 'Regalo', pruebas.genero('Phalaenopsis'), 'species', pruebas.especie('Phalaenopsis amabilis'), 'active'),
  ('user_b', 'Azul', pruebas.genero('Vanda'), 'species', pruebas.especie('Vanda coerulea'), 'active');
insert into public.plants (user_id, entered_name, genus_id, type)
values ('user_b', 'Sin nombre', pruebas.genero('Cattleya'), 'unknown');

-- Orden de referencia del listado: nombre normalizado con intercalación "C" e id. Devuelve los
-- nombres, separados por " | ", de las especies que cumplen los filtros.
create function pg_temp.referencia(
  f_status public.species_status default null,
  f_genus uuid default null,
  f_type public.species_type default null,
  f_source public.species_source default null
) returns text language sql stable as $$
  select coalesce(string_agg(s.scientific_name, ' | '
           order by public.normalize_search_text(s.scientific_name) collate "C", s.id), '')
  from public.species s
  where (f_status is null or s.status = f_status)
    and (f_genus is null or s.genus_id = f_genus)
    and (f_type is null or s.type = f_type)
    and (f_source is null or s.source = f_source)
$$;

-- Recorre el listado hacia delante, página a página (after_id con la última fila de cada
-- página), hasta que has_next es falso. Devuelve los nombres en el orden en que salieron. Falla
-- si una página no trae el total, si los indicadores no cuadran o si da más vueltas de las
-- posibles.
create function pg_temp.hacia_delante(
  tamano integer,
  f_status public.species_status default null,
  f_genus uuid default null,
  f_type public.species_type default null,
  f_source public.species_source default null
) returns text language plpgsql as $$
declare
  nombres text[] := '{}';
  cursor_id uuid;
  pagina integer := 0;
  fila record;
  ultima record;
  filas integer;
  total bigint;
begin
  loop
    pagina := pagina + 1;
    if pagina > 100 then
      raise exception 'demasiadas páginas';
    end if;
    filas := 0;
    for fila in
      select * from public.list_catalog_species(f_status, f_genus, f_type, f_source, tamano, cursor_id)
    loop
      filas := filas + 1;
      nombres := nombres || fila.scientific_name;
      if total is null then
        total := fila.total_count;
      elsif total <> fila.total_count then
        raise exception 'el total cambia entre páginas';
      end if;
      if fila.has_previous <> (pagina > 1) then
        raise exception 'has_previous incorrecto en la página %', pagina;
      end if;
      ultima := fila;
    end loop;
    exit when filas = 0;
    if filas > tamano then
      raise exception 'la página % trae % filas', pagina, filas;
    end if;
    exit when not ultima.has_next;
    if filas <> tamano then
      raise exception 'página incompleta (%) que no es la última', filas;
    end if;
    cursor_id := ultima.id;
  end loop;
  if total is not null and total <> pg_catalog.cardinality(nombres) then
    raise exception 'total % y % filas recorridas', total, pg_catalog.cardinality(nombres);
  end if;
  return array_to_string(nombres, ' | ');
end;
$$;

-- Lo mismo hacia atrás: la última página (last_page) y después before_id con la primera fila
-- de cada página. Devuelve los nombres en orden alfabético y, aparte, el tamaño de cada página
-- (de la primera a la última), para comprobar que se cortan igual que hacia delante.
create function pg_temp.hacia_atras(tamano integer, f_type public.species_type default null)
returns text language plpgsql as $$
declare
  paginas text[] := '{}';
  tamanos integer[] := '{}';
  cursor_id uuid;
  pagina_nombres text[];
  primera uuid;
  vuelta integer := 0;
  fila record;
  hay_anterior boolean;
begin
  loop
    vuelta := vuelta + 1;
    if vuelta > 100 then
      raise exception 'demasiadas páginas';
    end if;
    pagina_nombres := '{}';
    primera := null;
    for fila in
      select * from public.list_catalog_species(
        filter_type => f_type, page_size => tamano, before_id => cursor_id, last_page => cursor_id is null)
    loop
      pagina_nombres := pagina_nombres || fila.scientific_name;
      primera := coalesce(primera, fila.id);
      hay_anterior := fila.has_previous;
      if vuelta = 1 and fila.has_next then
        raise exception 'la última página dice que hay siguiente';
      end if;
    end loop;
    exit when primera is null;
    paginas := array_to_string(pagina_nombres, ' | ') || paginas;
    tamanos := pg_catalog.cardinality(pagina_nombres) || tamanos;
    exit when not hay_anterior;
    cursor_id := primera;
  end loop;
  return array_to_string(paginas, ' | ') || ' / ' || array_to_string(tamanos, ',');
end;
$$;

-- Nombres de una búsqueda, página a página, hasta la última (current_page deja de avanzar).
create function pg_temp.busqueda_completa(
  consulta text,
  tamano integer,
  f_status public.species_status default null,
  f_genus uuid default null,
  f_type public.species_type default null,
  f_source public.species_source default null
) returns text language plpgsql as $$
declare
  nombres text[] := '{}';
  pagina integer := 1;
  fila record;
  filas integer;
  devuelta integer;
  total bigint;
begin
  loop
    filas := 0;
    for fila in
      select * from public.search_catalog_species(consulta, f_status, f_genus, f_type, f_source, tamano, pagina)
    loop
      filas := filas + 1;
      devuelta := fila.current_page;
      total := fila.total_count;
      nombres := nombres || fila.scientific_name;
    end loop;
    exit when filas = 0;
    if devuelta <> pagina then
      raise exception 'se pidió la página % y llegó la %', pagina, devuelta;
    end if;
    exit when pagina * tamano >= total;
    pagina := pagina + 1;
  end loop;
  if total is not null and total <> pg_catalog.cardinality(nombres) then
    raise exception 'total % y % filas recorridas', total, pg_catalog.cardinality(nombres);
  end if;
  return array_to_string(nombres, ' | ');
end;
$$;

-- Primera página de una búsqueda: "nombre [nombre por el que coincidió:tipo]".
create function pg_temp.busqueda(consulta text, tamano integer default 50)
returns text language sql as $$
  select coalesce(string_agg(
    r.scientific_name || case when r.matched_name_type = 'scientific' then '' else ' [' || r.matched_name || ':' || r.matched_name_type || ']' end,
    ' | ' order by r.ordinality), '')
  from public.search_catalog_species(consulta, page_size => tamano) with ordinality as r
$$;

-- prueba: listado: recorre todo el catálogo hacia delante sin saltos ni repeticiones
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales('páginas de 4', pg_temp.hacia_delante(4), pg_temp.referencia());
select pruebas.iguales('páginas de 5', pg_temp.hacia_delante(5), pg_temp.referencia());
select pruebas.iguales('una página con todo', pg_temp.hacia_delante(100), pg_temp.referencia());
select pruebas.iguales('páginas de 1', pg_temp.hacia_delante(1), pg_temp.referencia());
select pruebas.comprobar(
  'el desempate por id deja juntos los dos nombres que se normalizan igual',
  pg_temp.referencia() like '%Phalaenopsis intermedia | Phalaenopsis × intermedia%'
    or pg_temp.referencia() like '%Phalaenopsis × intermedia | Phalaenopsis intermedia%'
);
select pruebas.iguales(
  'el orden no cuenta tildes, mayúsculas ni el signo de híbrido',
  (select string_agg(r.scientific_name, ' | ' order by r.ordinality)
     from public.list_catalog_species(filter_genus_id => pruebas.genero('Cattleya')) with ordinality r),
  'Cattleya × elegans | Cattleya labiata | Cattleya purpurata'
);

-- prueba: listado: hacia atrás desde la última página da las mismas páginas
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
-- 34 especies: con páginas de 4, ocho de 4 y una última de 2.
select pruebas.iguales('especies de partida', (select count(*) from public.species), 34::bigint);
select pruebas.iguales('páginas de 4', pg_temp.hacia_atras(4), pg_temp.referencia() || ' / 4,4,4,4,4,4,4,4,2');
select pruebas.iguales('páginas de 34', pg_temp.hacia_atras(34), pg_temp.referencia() || ' / 34');
select pruebas.iguales('páginas de 7', pg_temp.hacia_atras(7), pg_temp.referencia() || ' / 7,7,7,7,6');
select pruebas.iguales(
  'híbridos, páginas de 2',
  pg_temp.hacia_atras(2, 'hybrid'),
  pg_temp.referencia(f_type => 'hybrid') || ' / 2'
);
-- Antes de la primera especie no hay nada: devuelve la primera página.
select pruebas.iguales(
  'antes de la primera',
  (select string_agg(r.scientific_name, ' | ' order by r.ordinality)
     from public.list_catalog_species(page_size => 2, before_id => pruebas.especie('Cattleya × elegans')) with ordinality r),
  'Cattleya × elegans | Cattleya labiata'
);

-- prueba: listado: primera página, total, indicadores y límites de page_size
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'primera página por defecto: 50 filas como mucho, total e indicadores',
  (select count(*) || ' ' || min(total_count) || ' ' || bool_or(has_previous) || ' ' || bool_and(not has_next)
     from public.list_catalog_species()),
  '34 34 false true'
);
select pruebas.iguales('page_size 0 usa 50', (select count(*) from public.list_catalog_species(page_size => 0)), 34::bigint);
select pruebas.iguales('page_size negativo usa 50', (select count(*) from public.list_catalog_species(page_size => -3)), 34::bigint);
select pruebas.iguales('page_size nulo usa 50', (select count(*) from public.list_catalog_species(page_size => null)), 34::bigint);
set local role postgres;
insert into public.species (scientific_name, genus_id, type, status, source)
select 'Bulbophyllum ficticio' || i, pruebas.genero('Dendrobium'), 'species', 'imported', 'curated'
from generate_series(1, 130) i;
set local role authenticated;
select pruebas.iguales('page_size se queda en 100', (select count(*) from public.list_catalog_species(page_size => 1000)), 100::bigint);
select pruebas.iguales('y 50 por defecto', (select count(*) from public.list_catalog_species()), 50::bigint);
select pruebas.iguales(
  'la página siguiente trae el resto con 100',
  (select count(*) from public.list_catalog_species(
     page_size => 1000,
     after_id => (select x.id from public.list_catalog_species(page_size => 100) with ordinality x order by x.ordinality desc limit 1))),
  64::bigint
);

-- prueba: listado: un cursor que no existe da la primera página; sin coincidencias, ninguna fila
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'after_id desconocido',
  (select string_agg(r.scientific_name, ' | ' order by r.ordinality)
     from public.list_catalog_species(page_size => 2, after_id => gen_random_uuid()) with ordinality r),
  'Cattleya × elegans | Cattleya labiata'
);
select pruebas.iguales(
  'before_id desconocido',
  (select string_agg(r.scientific_name, ' | ' order by r.ordinality)
     from public.list_catalog_species(page_size => 2, before_id => gen_random_uuid()) with ordinality r),
  'Cattleya × elegans | Cattleya labiata'
);
select pruebas.iguales(
  'después de la última',
  (select count(*) from public.list_catalog_species(after_id => pruebas.especie('Vanda coerulea'))),
  0::bigint
);
select pruebas.iguales(
  'género sin especies',
  (select count(*) from public.list_catalog_species(filter_genus_id => pruebas.genero('Zygopetalum'))),
  0::bigint
);

-- prueba: listado: cada filtro solo, con su total y recorriendo todas sus páginas
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales('validadas', pg_temp.hacia_delante(2, f_status => 'validated'),
  'Cattleya purpurata | Oncidium sphacelatum | Phalaenopsis amabilis');
select pruebas.iguales('observadas', pg_temp.hacia_delante(2, f_status => 'observed'), pg_temp.referencia(f_status => 'observed'));
select pruebas.iguales('importadas', pg_temp.hacia_delante(3, f_status => 'imported'), pg_temp.referencia(f_status => 'imported'));
select pruebas.iguales('Phalaenopsis', pg_temp.hacia_delante(2, f_genus => pruebas.genero('Phalaenopsis')),
  pg_temp.referencia(f_genus => pruebas.genero('Phalaenopsis')));
select pruebas.iguales('Dendrobium', pg_temp.hacia_delante(5, f_genus => pruebas.genero('Dendrobium')),
  pg_temp.referencia(f_genus => pruebas.genero('Dendrobium')));
select pruebas.iguales('híbridos', pg_temp.hacia_delante(1, f_type => 'hybrid'), 'Cattleya × elegans | Phalaenopsis × intermedia');
select pruebas.iguales('especies', pg_temp.hacia_delante(6, f_type => 'species'), pg_temp.referencia(f_type => 'species'));
select pruebas.iguales('lista curada', pg_temp.hacia_delante(2, f_source => 'curated'),
  'Ónc ficticia | Oncidium sphacelatum | Phalaenopsis amabilis');
select pruebas.iguales('propuestas de usuario', pg_temp.hacia_delante(2, f_source => 'user_proposal'),
  'Cattleya × elegans | Phalaenopsis intermedia');
select pruebas.iguales('GBIF', pg_temp.hacia_delante(2, f_source => 'gbif'), 'Vanda coerulea');
select pruebas.iguales('COL', pg_temp.hacia_delante(4, f_source => 'col'), pg_temp.referencia(f_source => 'col'));
select pruebas.iguales(
  'total de COL',
  (select min(total_count) from public.list_catalog_species(filter_source => 'col')),
  (select count(*) from public.species where source = 'col')
);

-- prueba: listado: filtros combinados
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'Phalaenopsis observadas',
  pg_temp.hacia_delante(1, f_status => 'observed', f_genus => pruebas.genero('Phalaenopsis')),
  'Phalaenopsis intermedia | Phalaenopsis pulcherrima'
);
select pruebas.iguales(
  'Phalaenopsis observadas de COL',
  pg_temp.hacia_delante(1, f_status => 'observed', f_genus => pruebas.genero('Phalaenopsis'), f_source => 'col'),
  'Phalaenopsis pulcherrima'
);
select pruebas.iguales(
  'híbridos importados de COL',
  pg_temp.hacia_delante(3, f_status => 'imported', f_type => 'hybrid', f_source => 'col'),
  'Phalaenopsis × intermedia'
);
select pruebas.iguales(
  'Dendrobium importadas de COL, especies',
  pg_temp.hacia_delante(7, 'imported', pruebas.genero('Dendrobium'), 'species', 'col'),
  pg_temp.referencia('imported', pruebas.genero('Dendrobium'), 'species', 'col')
);
select pruebas.iguales(
  'combinación sin coincidencias',
  (select count(*) from public.list_catalog_species(filter_status => 'validated', filter_type => 'hybrid')),
  0::bigint
);

-- prueba: listado: columnas de cada fila (género, fuente, referencia, recuentos de nombres, fechas)
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'Cattleya purpurata',
  (select r.genus_name || ' ' || r.type || ' ' || r.status || ' ' || r.source || ' ' || r.source_ref || ' '
          || r.synonym_count || ' ' || r.common_name_count || ' ' || (r.genus_id = pruebas.genero('Cattleya'))
          || ' ' || (r.created_at is not null and r.updated_at >= r.created_at)
     from public.list_catalog_species(filter_genus_id => pruebas.genero('Cattleya')) r
     where r.scientific_name = 'Cattleya purpurata'),
  'Cattleya species validated col 3Z4W2 2 1 true true'
);
select pruebas.iguales(
  'sin referencia ni nombres',
  (select coalesce(r.source_ref, 'null') || ' ' || r.synonym_count || ' ' || r.common_name_count
     from public.list_catalog_species(filter_genus_id => pruebas.genero('Cattleya')) r
     where r.scientific_name = 'Cattleya × elegans'),
  'null 0 0'
);

-- prueba: búsqueda: por nombre, prefijo, sinónimo, nombre común, error de tipeo, tildes, abreviatura y signo de híbrido
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales('nombre completo', pg_temp.busqueda('Cattleya labiata'), 'Cattleya labiata');
select pruebas.iguales('prefijo por palabras', pg_temp.busqueda('phal amab'), 'Phalaenopsis amabilis');
select pruebas.iguales(
  'sinónimo, con el nombre por el que coincidió',
  pg_temp.busqueda('laelia purp'),
  'Cattleya purpurata [Laelia purpurata:synonym]'
);
select pruebas.iguales('nombre común sin tildes', pg_temp.busqueda('orquidea mari'),
  'Phalaenopsis amabilis [orquídea mariposa:common]');
select pruebas.iguales('error de tipeo', pg_temp.busqueda('catleya labiatta'), 'Cattleya labiata');
select pruebas.iguales('abreviatura de género', pg_temp.busqueda('Phal. aphro'), 'Phalaenopsis aphrodite');
select pruebas.iguales('abreviatura sin punto', pg_temp.busqueda('den nob'), 'Dendrobium nobile');
select pruebas.iguales(
  'con x y sin el signo: especies antes que híbridos, y el id desempata',
  pg_temp.busqueda('phalaenopsis x intermedia'),
  'Phalaenopsis intermedia | Phalaenopsis × intermedia'
);
select pruebas.iguales('consulta demasiado corta', pg_temp.busqueda('p'), '');
select pruebas.iguales('consulta sin letras', pg_temp.busqueda('..'), '');
select pruebas.iguales('consulta demasiado larga', pg_temp.busqueda(repeat('a', 101)), '');
select pruebas.iguales('consulta nula', (select count(*) from public.search_catalog_species(null)), 0::bigint);
select pruebas.iguales('sin coincidencias', pg_temp.busqueda('xqzvkjw'), '');

-- prueba: búsqueda: si algo empieza como lo escrito no se suman los parecidos; si nada, sí
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
-- "phalaenopsis pulch" empieza como un nombre: no trae Doritis pulcherrima por parecido (es la
-- misma especie) ni otras Phalaenopsis.
select pruebas.iguales('prefijo', pg_temp.busqueda('phalaenopsis pulch'), 'Phalaenopsis pulcherrima');
-- "pulcherrima" no empieza como ningún nombre: se busca por similitud.
select pruebas.iguales('similitud', pg_temp.busqueda('pulcherrima'), 'Phalaenopsis pulcherrima');
select pruebas.iguales('solo por un sinónimo', pg_temp.busqueda('callista'), 'Dendrobium nobile [Callista nobilis:synonym]');
-- Clase 1 (nombre científico) antes que clase 2 (otros nombres), aunque el sinónimo vaya antes
-- en el alfabeto.
set local role postgres;
insert into public.species (scientific_name, genus_id, type, status, source)
values ('Callista thyrsiflora', pruebas.genero('Dendrobium'), 'species', 'imported', 'curated'); -- ficticio
set local role authenticated;
select pruebas.iguales(
  'clase 1 antes que la 2',
  pg_temp.busqueda('callista'),
  'Callista thyrsiflora | Dendrobium nobile [Callista nobilis:synonym]'
);

-- prueba: búsqueda: mismo orden que search_species() cuando los prefijos llenan su tope
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'dendrob',
  (select string_agg(r.id::text, ',' order by r.ordinality) from public.search_catalog_species('dendrob', page_size => 20) with ordinality r),
  (select string_agg(r.id::text, ',' order by r.ordinality) from public.search_species('dendrob', 20) with ordinality r)
);
select pruebas.iguales(
  'phal (abreviatura): especies antes que híbridos y el signo no cuenta',
  pg_temp.busqueda('phal'),
  'Phalaenopsis amabilis | Phalaenopsis aphrodite | Phalaenopsis intermedia | Phalaenopsis pulcherrima | Phalaenopsis × intermedia'
);
select pruebas.iguales(
  'phal, igual que search_species()',
  (select string_agg(r.id::text, ',' order by r.ordinality) from public.search_catalog_species('phal') with ordinality r),
  (select string_agg(r.id::text, ',' order by r.ordinality) from public.search_species('phal', 5) with ordinality r)
);

-- prueba: búsqueda: paginación por número de página, total y página fuera de rango
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'dendrob en páginas de 4 es lo mismo que en una sola',
  pg_temp.busqueda_completa('dendrob', 4),
  pg_temp.busqueda_completa('dendrob', 100)
);
select pruebas.iguales(
  'sin repeticiones',
  (select count(distinct n) from unnest(string_to_array(pg_temp.busqueda_completa('dendrob', 3), ' | ')) n),
  23::bigint
);
select pruebas.iguales(
  'total y página',
  (select min(total_count) || ' ' || min(current_page) || ' ' || count(*)
     from public.search_catalog_species('dendrob', page_size => 10, page_number => 2)),
  '23 2 10'
);
select pruebas.iguales(
  'una página más allá de la última devuelve la última',
  (select min(current_page) || ' ' || count(*)
     from public.search_catalog_species('dendrob', page_size => 10, page_number => 99)),
  '3 3'
);
select pruebas.iguales(
  'página cero o negativa: la primera',
  (select min(current_page) || ' ' || count(*)
     from public.search_catalog_species('dendrob', page_size => 10, page_number => -1)),
  '1 10'
);
select pruebas.iguales(
  'page_size se queda en 100',
  (select count(*) from public.search_catalog_species('dendrob', page_size => 1000)),
  23::bigint
);

-- prueba: búsqueda: con filtros, solos y combinados
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales('phal observadas', pg_temp.busqueda_completa('phal', 1, f_status => 'observed'),
  'Phalaenopsis intermedia | Phalaenopsis pulcherrima');
select pruebas.iguales('phal híbridos', pg_temp.busqueda_completa('phal', 1, f_type => 'hybrid'),
  'Phalaenopsis × intermedia');
select pruebas.iguales('phal de COL', pg_temp.busqueda_completa('phal', 2, f_source => 'col'),
  'Phalaenopsis aphrodite | Phalaenopsis pulcherrima | Phalaenopsis × intermedia');
select pruebas.iguales('laelia en Cattleya', pg_temp.busqueda_completa('laelia', 5, f_genus => pruebas.genero('Cattleya')),
  'Cattleya purpurata');
select pruebas.iguales('laelia en Phalaenopsis', pg_temp.busqueda_completa('laelia', 5, f_genus => pruebas.genero('Phalaenopsis')), '');
select pruebas.iguales(
  'phal observadas de COL, especies',
  pg_temp.busqueda_completa('phal', 5, 'observed', pruebas.genero('Phalaenopsis'), 'species', 'col'),
  'Phalaenopsis pulcherrima'
);
select pruebas.iguales(
  'error de tipeo con filtro',
  pg_temp.busqueda_completa('catleya purpurata', 5, f_status => 'validated'),
  'Cattleya purpurata'
);
select pruebas.iguales(
  'total con filtro',
  (select min(total_count) from public.search_catalog_species('dendrob', filter_source => 'col')),
  23::bigint
);

-- prueba: detalle: nombres de la especie desde las tablas y número de plantas enlazadas
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'nombres de Cattleya purpurata',
  (select string_agg(n.name || ':' || n.type, ', ' order by n.type, n.name)
     from public.species_names n where n.species_id = pruebas.especie('Cattleya purpurata')),
  'Laelia purpurata:synonym, Laelia purpurata var. alba:synonym, flor de la reina:common'
);
select pruebas.iguales('plantas de todos los usuarios, también las perdidas',
  public.count_species_plants(pruebas.especie('Phalaenopsis amabilis')), 3::bigint);
select pruebas.iguales('una planta', public.count_species_plants(pruebas.especie('Vanda coerulea')), 1::bigint);
select pruebas.iguales('ninguna', public.count_species_plants(pruebas.especie('Cattleya labiata')), 0::bigint);
select pruebas.iguales('especie que no existe', public.count_species_plants(gen_random_uuid()), 0::bigint);
select pruebas.iguales('id nulo', public.count_species_plants(null), 0::bigint);
-- El administrador sigue sin ver las plantas de otros: solo el número sale de la función.
select pruebas.iguales('plantas visibles para el administrador', (select count(*) from public.plants), 0::bigint);
set local role postgres;
select pruebas.iguales(
  'devuelve solo un número',
  (select pg_catalog.format_type(p.prorettype, null) || ' ' || p.proretset
     from pg_proc p where p.oid = 'public.count_species_plants(uuid)'::regprocedure),
  'bigint false'
);

-- prueba: resumen: coincide con los recuentos de las tablas
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'recuentos',
  (select concat_ws(' ', genus_count = (select count(*) from public.genera), species_count, hybrid_count,
                    synonym_count, common_name_count, imported_count, validated_count, observed_count,
                    col_source_count, curated_source_count, user_proposal_source_count, gbif_source_count)
     from public.catalog_summary()),
  't 32 2 4 3 28 3 3 28 3 2 1'
);
select pruebas.iguales('una sola fila', (select count(*) from public.catalog_summary()), 1::bigint);

-- prueba: géneros: abreviaturas, acceso rápido, número de especies, orden y total
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'Phalaenopsis',
  (select array_to_string(g.abbreviations, ',') || ' ' || g.is_quick_access || ' ' || g.species_count
     from public.list_catalog_genera(page_size => 100) g where g.name = 'Phalaenopsis'),
  'Phal. true 5'
);
select pruebas.iguales(
  'Dendrobium',
  (select g.species_count from public.list_catalog_genera(page_size => 100) g where g.name = 'Dendrobium'),
  23::bigint
);
set local role postgres;
insert into public.genera (name) values ('Andinia'), ('× Cattleychea');
set local role authenticated;
select pruebas.iguales(
  'sin abreviaturas: lista vacía',
  (select '[' || array_to_string(g.abbreviations, ',') || ']|' || g.species_count from public.list_catalog_genera('andinia') g),
  '[]|0'
);
select pruebas.iguales(
  'total y orden sin el signo de híbrido',
  (select count(*) = min(g.total_count) and min(g.total_count) = (select count(*) from public.genera)
     from public.list_catalog_genera(page_size => 100) g),
  true
);
select pruebas.iguales(
  'el signo de híbrido no cuenta en el orden',
  (select string_agg(g.name, ', ' order by g.ordinality)
     from public.list_catalog_genera('catt') with ordinality g),
  'Brassocattleya, Brassolaeliocattleya, Cattleya, × Cattleychea, Cattlianthe, Laeliocattleya, Rhyncholaeliocattleya, Sophrolaeliocattleya'
);

-- prueba: géneros: filtros por texto y acceso rápido, y paginación
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales('contiene, sin tildes ni mayúsculas', (select string_agg(g.name, ', ') from public.list_catalog_genera('ENDRÓB') g), 'Dendrobium');
select pruebas.iguales('abreviatura con punto', (select string_agg(g.name, ', ') from public.list_catalog_genera('Phal.') g), 'Phalaenopsis');
select pruebas.iguales('abreviatura sin punto', (select string_agg(g.name, ', ') from public.list_catalog_genera('masd') g), 'Masdevallia');
select pruebas.iguales(
  'acceso rápido',
  (select string_agg(g.name, ', ' order by g.ordinality) from public.list_catalog_genera(quick_access_only => true) with ordinality g),
  'Cattleya, Dendrobium, Oncidium, Phalaenopsis, Vanda'
);
select pruebas.iguales('acceso rápido con texto', (select string_agg(g.name, ', ') from public.list_catalog_genera('onc', true) g), 'Oncidium');
select pruebas.iguales('sin coincidencias', (select count(*) from public.list_catalog_genera('xqzvkjw')), 0::bigint);
select pruebas.iguales('texto vacío: todos', (select min(total_count) from public.list_catalog_genera('  ')), (select count(*) from public.genera));
select pruebas.iguales('texto demasiado largo', (select count(*) from public.list_catalog_genera(repeat('a', 101))), 0::bigint);
select pruebas.iguales(
  'páginas de 2 del acceso rápido',
  (select string_agg(g.name || '@' || g.current_page, ', ' order by p, g.ordinality)
     from generate_series(1, 4) p
     cross join lateral public.list_catalog_genera(quick_access_only => true, page_size => 2, page_number => p) with ordinality g),
  'Cattleya@1, Dendrobium@1, Oncidium@2, Phalaenopsis@2, Vanda@3, Vanda@3'
);

-- prueba: permisos: anon y un usuario sin rol reciben 42501; el administrador, los resultados
set local role anon;
set local request.jwt.claims = '{"role": "anon", "app_role": "catalog_admin"}';
select pruebas.debe_fallar('anon: listado', $$select * from public.list_catalog_species()$$, '42501');
select pruebas.debe_fallar('anon: búsqueda', $$select * from public.search_catalog_species('phal')$$, '42501');
select pruebas.debe_fallar('anon: géneros', $$select * from public.list_catalog_genera()$$, '42501');
select pruebas.debe_fallar('anon: resumen', $$select * from public.catalog_summary()$$, '42501');
select pruebas.debe_fallar('anon: plantas', $$select public.count_species_plants(gen_random_uuid())$$, '42501');
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.debe_fallar('sin rol: listado', $$select * from public.list_catalog_species()$$, '42501');
select pruebas.debe_fallar('sin rol: búsqueda', $$select * from public.search_catalog_species('phal')$$, '42501');
select pruebas.debe_fallar('sin rol: géneros', $$select * from public.list_catalog_genera()$$, '42501');
select pruebas.debe_fallar('sin rol: resumen', $$select * from public.catalog_summary()$$, '42501');
select pruebas.debe_fallar('sin rol: plantas', $$select public.count_species_plants(gen_random_uuid())$$, '42501');
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated", "app_role": "admin"}';
select pruebas.debe_fallar('otro rol: listado', $$select * from public.list_catalog_species()$$, '42501');
select pruebas.debe_fallar('otro rol: plantas', $$select public.count_species_plants(gen_random_uuid())$$, '42501');
-- Una búsqueda vacía o demasiado corta también exige el rol (no devuelve vacío sin más).
set local request.jwt.claims = '{"sub": "user_a", "role": "authenticated"}';
select pruebas.debe_fallar('sin rol: búsqueda corta', $$select * from public.search_catalog_species('p')$$, '42501');
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.debe_funcionar('administrador: listado', $$select * from public.list_catalog_species()$$);
select pruebas.debe_funcionar('administrador: búsqueda', $$select * from public.search_catalog_species('phal')$$);
select pruebas.debe_funcionar('administrador: géneros', $$select * from public.list_catalog_genera()$$);
select pruebas.debe_funcionar('administrador: resumen', $$select * from public.catalog_summary()$$);
select pruebas.debe_funcionar('administrador: plantas', $$select public.count_species_plants(gen_random_uuid())$$);
set local role service_role;
set local request.jwt.claims = '{"role": "service_role"}';
select pruebas.debe_fallar('clave de servicio: listado', $$select * from public.list_catalog_species()$$, '42501');
select pruebas.debe_fallar('clave de servicio: plantas', $$select public.count_species_plants(gen_random_uuid())$$, '42501');

-- prueba: permisos y propiedades de las funciones nuevas
select pruebas.iguales(
  'quién puede ejecutarlas',
  (select string_agg(f.nombre || ':' || r.rol || '=' || has_function_privilege(r.rol, f.firma, 'execute'), ', '
                     order by f.nombre, r.rol)
     from (values
       ('catalog_summary', 'public.catalog_summary()'),
       ('count_species_plants', 'public.count_species_plants(uuid)'),
       ('list_catalog_genera', 'public.list_catalog_genera(text, boolean, integer, integer)'),
       ('list_catalog_species', 'public.list_catalog_species(public.species_status, uuid, public.species_type, public.species_source, integer, uuid, uuid, boolean)'),
       ('search_catalog_species', 'public.search_catalog_species(text, public.species_status, uuid, public.species_type, public.species_source, integer, integer)')
     ) f (nombre, firma)
     cross join (values ('anon'), ('authenticated'), ('service_role')) r (rol)),
  'catalog_summary:anon=false, catalog_summary:authenticated=true, catalog_summary:service_role=false, '
  'count_species_plants:anon=false, count_species_plants:authenticated=true, count_species_plants:service_role=false, '
  'list_catalog_genera:anon=false, list_catalog_genera:authenticated=true, list_catalog_genera:service_role=false, '
  'list_catalog_species:anon=false, list_catalog_species:authenticated=true, list_catalog_species:service_role=false, '
  'search_catalog_species:anon=false, search_catalog_species:authenticated=true, search_catalog_species:service_role=false'
);
select pruebas.iguales(
  'security definer, volatilidad y search_path',
  (select string_agg(p.proname || ' definer=' || p.prosecdef || ' ' || p.provolatile::text || ' ' || array_to_string(p.proconfig, ','), '; ' order by p.proname)
     from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('catalog_summary', 'count_species_plants', 'list_catalog_genera', 'list_catalog_species', 'search_catalog_species')),
  'catalog_summary definer=false s search_path=""; '
  'count_species_plants definer=true v search_path=""; '
  'list_catalog_genera definer=false s search_path=""; '
  'list_catalog_species definer=false s search_path="",plan_cache_mode=force_custom_plan; '
  'search_catalog_species definer=false s search_path="",pg_trgm.word_similarity_threshold=0.3,plan_cache_mode=force_custom_plan'
);
select pruebas.comprobar(
  'count_species_plants llama primero al guardián',
  pruebas.llama_primero_al_guardian('plpgsql',
    (select p.prosrc from pg_proc p where p.oid = 'public.count_species_plants(uuid)'::regprocedure))
);

-- prueba: índices: definición y uso al paginar por clave
select pruebas.iguales(
  'índice alfabético',
  pg_get_indexdef('public.species_scientific_name_prefix_idx'::regclass),
  'CREATE INDEX species_scientific_name_prefix_idx ON public.species USING btree (normalize_search_text(scientific_name) COLLATE "C", id)'
);
select pruebas.iguales(
  'índice por género',
  pg_get_indexdef('public.species_genus_id_name_idx'::regclass),
  'CREATE INDEX species_genus_id_name_idx ON public.species USING btree (genus_id, normalize_search_text(scientific_name) COLLATE "C", id)'
);
-- Con tan pocas filas el planificador preferiría recorrer la tabla; sin esa opción, una página
-- por clave lee el índice alfabético (o el del género) desde el cursor.
create temp table recorridos_antes as
  select c.relname::text as indice, pg_stat_get_xact_numscans(c.oid) as recorridos
  from pg_class c
  where c.relname in ('species_scientific_name_prefix_idx', 'species_genus_id_name_idx');
set local enable_seqscan = off;
set local enable_bitmapscan = off;
set local role authenticated;
set local request.jwt.claims = '{"sub": "user_admin", "role": "authenticated", "app_role": "catalog_admin"}';
select pruebas.iguales(
  'página después de Dendrobium nobile',
  (select string_agg(r.scientific_name, ' | ' order by r.ordinality)
     from public.list_catalog_species(page_size => 2, after_id => pruebas.especie('Dendrobium nobile')) with ordinality r),
  'Ónc ficticia | Oncidium sphacelatum'
);
set local role postgres;
select pruebas.comprobar(
  'recorre species_scientific_name_prefix_idx',
  (select pg_stat_get_xact_numscans(c.oid) > a.recorridos
     from recorridos_antes a join pg_class c on c.relname = a.indice
     where a.indice = 'species_scientific_name_prefix_idx')
);
set local role authenticated;
select pruebas.iguales(
  'página de un género',
  (select string_agg(r.scientific_name, ' | ' order by r.ordinality)
     from public.list_catalog_species(filter_genus_id => pruebas.genero('Phalaenopsis'), page_size => 2,
                                      after_id => pruebas.especie('Phalaenopsis aphrodite')) with ordinality r),
  (select string_agg(n, ' | ') from unnest(
     (string_to_array(pg_temp.referencia(f_genus => pruebas.genero('Phalaenopsis')), ' | '))[3:4]) n)
);
set local role postgres;
select pruebas.comprobar(
  'recorre species_genus_id_name_idx',
  (select pg_stat_get_xact_numscans(c.oid) > a.recorridos
     from recorridos_antes a join pg_class c on c.relname = a.indice
     where a.indice = 'species_genus_id_name_idx')
);
