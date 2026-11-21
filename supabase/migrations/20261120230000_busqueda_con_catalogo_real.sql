-- Búsqueda ajustada con el catálogo real (parte de #7 y #8).
--
-- Con el catálogo de COL ya cargado (752 géneros, 32 464 especies y 60 000 sinónimos) se vieron
-- dos problemas que el catálogo sintético no mostraba:
--   - Rendimiento con los géneros grandes (Bulbophyllum 2234 especies, Epidendrum 1925,
--     Dendrobium 1631): "dendrob" o "den nob" pasaban por miles de candidatos, y cada uno
--     pagaba la normalización y word_similarity. En el plan gratuito de Supabase tardaban unos
--     300 ms dentro de la base.
--   - Orden: el desempate final era el nombre tal como está guardado, con la intercalación del
--     servidor, así que el signo de híbrido ("Phalaenopsis × amphitrite", "× Cattleychea")
--     cambiaba el orden alfabético, y "laelia purpurata" devolvía primero un sinónimo con
--     variedad ("Laelia purpurata var. brysiana") que el nombre exacto.
--
-- Esta migración:
--   1. Crea el índice btree species_scientific_name_prefix_idx sobre el nombre científico
--      normalizado con intercalación "C", para recorrer en orden los nombres que empiezan por
--      una palabra y parar en cuanto hay bastantes.
--   2. Redefine public.search_species(): búsqueda por etapas con corte temprano y una regla de
--      orden nueva (ver su comentario).
--   3. Redefine public.search_genera(): misma idea de clases y desempate, con los géneros de
--      acceso rápido primero a igualdad.
--
-- normalize_search_text() no cambia. Firmas, tipos de retorno, permisos, rows y comentarios de
-- las funciones se conservan; search_species() fija además plan_cache_mode (ver más abajo).
-- Las decisiones que no cambian (normalización, umbral 0,3, límites, abreviaturas, consultas de
-- 2 caracteres, seguridad) están en las migraciones 20261120190000_busqueda_de_especies.sql,
-- 20261120200000_abreviaturas_y_busqueda_de_generos.sql y 20261120210000_ajustes_de_busqueda.sql.

-- Las dos funciones de búsqueda fijan pg_trgm.word_similarity_threshold, que solo existe con
-- la biblioteca de pg_trgm cargada en la sesión (ver la migración de abreviaturas).
do $$
begin
  perform extensions.word_similarity('', '');
end;
$$;

-- Índice de orden por prefijo -------------------------------------------------------------
--
-- Btree sobre public.normalize_search_text(scientific_name) con intercalación "C" (orden por
-- bytes, el mismo en cualquier servidor). Sirve a la etapa de prefijo de una sola palabra de
-- search_species(): "empieza por 'dendrob'" es el rango [dendrob, dendrob || U+10FFFF) de ese
-- orden, así que Postgres lee del índice solo los primeros nombres del rango, ya ordenados, y
-- para al llegar al tope de resultados. Con el índice de trigramas hacía falta leer, normalizar
-- y ordenar todo el género. No hace falta otro para species_names: allí los prefijos son pocos
-- (un género sin especies aceptadas, como Odontoglossum, tiene unos 600 sinónimos) y se ordenan
-- en memoria.
--
-- Ocupa 1,3 MB con el catálogo real (el de trigramas de species, 5,6 MB). Como los demás,
-- lo calcula quien escribe en species, con sus permisos (ejecutar normalize_search_text() y
-- usar el esquema extensions; ver la migración de búsqueda de especies), y depende de lo que
-- devuelve normalize_search_text(): si la normalización vuelve a cambiar, hay que
-- reconstruirlo (reindex) junto con los de trigramas. Se crea sin concurrently porque las
-- migraciones van en una transacción; con 32 464 especies tarda menos de un segundo y bloquea
-- la escritura en species mientras tanto.

create index species_scientific_name_prefix_idx on public.species
  ((public.normalize_search_text(scientific_name) collate "C"));

-- Búsqueda de especies por etapas ---------------------------------------------------------
--
-- Clases de coincidencia, en este orden (una especie sale una sola vez, en la primera clase en
-- la que entra):
--   1. Prefijo del nombre científico: cada palabra de la consulta (expandida o escrita) es, en
--      orden, el comienzo de una palabra del nombre y la primera el del nombre, como antes
--      (LIKE 'phal% amab%').
--   2. Prefijo de un sinónimo o de un nombre común, con la misma regla. Antes estos solo
--      entraban como candidatos y se ordenaban por similitud, mezclados con los demás.
--   3. Similitud (word_similarity de al menos 0,3), para lo que no empieza como lo escrito:
--      errores de tipeo y palabras de en medio. Solo rellena lo que falte hasta el tope.
--
-- Por qué todo prefijo antes que la similitud: en un autocompletado, lo que empieza como lo
-- escrito es lo que se busca; lo aproximado solo rellena. Así "laelia purpurata" y "doritis
-- pulcherrima" devuelven primero la especie de ese sinónimo, y "cattleya lab" la especie antes
-- que los sinónimos que solo se parecen.
--
-- Orden dentro de cada clase:
--   1 y 2: primero lo que coincidió con la consulta expandida (abreviatura), como antes; después
--          las especies antes que los híbridos (type = 'hybrid'), y al final el nombre por el
--          que coincidió, normalizado (sin tildes, mayúsculas ni signo de híbrido) y con
--          intercalación "C", y el id. Al ordenar por el nombre normalizado, el nombre exacto
--          va antes que sus variedades ("laelia purpurata" antes que "laelia purpurata var.
--          brysiana") y el signo de híbrido no cuenta.
--   3:     de mayor a menor puntuación (ver abajo); a igualdad, el nombre científico antes que
--          los sinónimos y estos antes que los nombres comunes; después las especies antes que
--          los híbridos, y al final el nombre normalizado con intercalación "C" y el id.
-- Dentro de cada especie, la mejor coincidencia se elige con el mismo criterio (expandida
-- primero y nombre normalizado en las clases 1 y 2; puntuación, tipo y nombre en la 3).
--
-- Por qué las especies antes que los híbridos naturales: en COL los híbridos naturales
-- (1408 de 32 464) llevan el signo y, ordenados solo por nombre, se cuelan entre las especies
-- ("cattleya lab" daba Cattleya × labendziana antes que Cattleya labiata). Quien escribe el
-- nombre de un híbrido entero lo sigue encontrando primero, porque es el único que coincide.
--
-- Similitud (clase 3):
--   - Con varias palabras, el nombre tiene que parecerse a la consulta entera y además a su
--     segunda palabra (el epíteto, si tiene al menos 3 caracteres), las dos con el umbral.
--     Antes bastaba con la consulta entera, y "dendrobum nobile" o "den nob" (expandida a
--     "dendrobium nob") dejaban pasar todos los nombres del género, porque la palabra del
--     género da casi todos los trigramas; ahora solo los que tienen algo parecido al epíteto.
--     Las dos condiciones usan el índice de trigramas (Postgres cruza los dos recorridos).
--   - Puntuación: la menor de las dos similitudes (consulta entera y epíteto); con una sola
--     palabra, la de la consulta. A igual puntuación, la de la consulta entera. Así un nombre
--     que solo se parece por el género queda detrás del que se parece también por el epíteto.
--   - Dos pasadas: primero con umbral 0,6 y, solo si no se completa el tope, con 0,3. Da
--     exactamente lo mismo que una sola pasada con 0,3, porque la puntuación es la menor de
--     las dos similitudes: las especies con puntuación de al menos 0,6 son exactamente las que
--     encuentra la primera pasada, y en el orden van antes que cualquier otra. Si la primera
--     no llena el tope, la segunda devuelve el resto, sin repetir especies. Con una sola
--     palabra corta y frecuente ("catl", "alba") la primera pasada deja fuera la mayoría de
--     candidatos (de 88 a 21 ms de mediana con "catl").
--
-- Etapas con corte temprano: cada clase (y cada paso dentro de la 1) es una consulta aparte que
-- pide solo lo que falta hasta el tope y deja fuera las especies ya encontradas; en cuanto se
-- llega al tope, no se ejecutan las siguientes. Como cada clase va entera antes que la
-- siguiente, el resultado es el mismo que ordenar todos los candidatos a la vez. La clase 1 se
-- resuelve así:
--   - Consulta de una palabra: cuatro pasos con el índice species_scientific_name_prefix_idx,
--     cada uno un rango del índice leído en orden (expandida y especies, expandida e híbridos,
--     escrita y especies, escrita e híbridos). "dendrob" lee 10 filas en lugar de 1631.
--   - Consulta de varias palabras: una sola consulta con el índice de trigramas
--     ('phal% amab%' encuentra pocas filas) y orden en memoria.
--
-- plan_cache_mode = force_generic_plan: plpgsql guarda el plan de cada consulta, y con planes a
-- medida el planificador ve el patrón LIKE como constante, deduce de él un rango del índice
-- btree nuevo y, con "den% nob%", recorría todo Dendrobium (10 ms) en lugar de usar los
-- trigramas (menos de 1 ms). Con el plan genérico el patrón es un parámetro: el LIKE usa los
-- trigramas y el rango explícito de la clase 1 usa el btree. Además se ahorra planificar en
-- cada llamada. Se comprobó que todas las consultas usan los índices con el plan genérico.
--
-- El umbral de la primera pasada se cambia con set_config(..., true) dentro de la función;
-- como la función fija el parámetro en su definición (set ...), Postgres restaura al salir el
-- valor de la sesión.
--
-- Límites, permisos, propiedades, abreviaturas y consultas de 2 caracteres, como antes. Con 2
-- caracteres normalizados no hay clase 3 (la consulta escrita no busca por similitud; la
-- expandida sí, como antes: "c." busca también por similitud con "cattleya").

create or replace function public.search_species(query text, max_results integer default 10)
returns table (
  id uuid,
  scientific_name text,
  genus_id uuid,
  genus_name text,
  type public.species_type,
  status public.species_status,
  matched_name text,
  matched_name_type public.species_match_type
)
language plpgsql
stable
security invoker
set search_path = ''
set pg_trgm.word_similarity_threshold = 0.3
set plan_cache_mode = force_generic_plan
rows 20
as $$
#variable_conflict use_column
declare
  normalized_query text;
  similarity_query text;
  prefix_pattern text;
  first_word text;
  genus_text text;
  expanded_query text;
  expanded_similarity_query text;
  epithet_query text;
  expanded_pattern text;
  result_limit integer;
  step_low text;
  step_high text;
  step_hybrid boolean;
  -- Lo encontrado hasta ahora, en orden: especie, nombre por el que coincidió y su tipo.
  found_ids uuid[] := '{}';
  found_names text[] := '{}';
  found_types public.species_match_type[] := '{}';
begin
  if query is null or pg_catalog.char_length(query) > 100 then
    return;
  end if;

  normalized_query := public.normalize_search_text(query);
  if pg_catalog.char_length(normalized_query) < 2 or normalized_query !~ '[[:alnum:]]' then
    return;
  end if;

  -- Con menos de 3 caracteres, la consulta escrita no busca por similitud.
  similarity_query := case
    when pg_catalog.char_length(normalized_query) >= 3 then normalized_query
  end;

  -- Patrón de LIKE del prefijo por palabras ("phal amab" pasa a 'phal% amab%'), con los
  -- comodines de la consulta escapados.
  prefix_pattern := pg_catalog.replace(
    pg_catalog.replace(
      pg_catalog.replace(pg_catalog.replace(normalized_query, '\', '\\'), '%', '\%'),
      '_', '\_'
    ),
    ' ', '% '
  ) || '%';

  -- Abreviatura de género en la primera palabra, con el índice genus_abbreviations_search_key.
  first_word := pg_catalog.rtrim(pg_catalog.split_part(normalized_query, ' ', 1), '.');
  if first_word <> '' then
    select public.normalize_search_text(g.name)
      into genus_text
      from public.genus_abbreviations a
      join public.genera g on g.id = a.genus_id
      where public.normalize_search_text(pg_catalog.rtrim(a.abbreviation, '.')) = first_word
      limit 1;
  end if;

  if genus_text is not null then
    expanded_query := genus_text || pg_catalog.substr(
      normalized_query,
      pg_catalog.char_length(pg_catalog.split_part(normalized_query, ' ', 1)) + 1
    );
    expanded_similarity_query := case
      when pg_catalog.char_length(expanded_query) >= 3 then expanded_query
    end;
    expanded_pattern := pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.replace(pg_catalog.replace(expanded_query, '\', '\\'), '%', '\%'),
        '_', '\_'
      ),
      ' ', '% '
    ) || '%';
  end if;

  result_limit := case
    when max_results is null or max_results <= 0 then 10
    else least(max_results, 20)
  end;

  -- Epíteto: la segunda palabra, si tiene al menos 3 caracteres. Es la misma en la forma
  -- escrita y en la expandida, porque la abreviatura solo puede ser la primera palabra.
  epithet_query := pg_catalog.split_part(normalized_query, ' ', 2);
  if pg_catalog.char_length(epithet_query) < 3 then
    epithet_query := null;
  end if;

  -- Clase 1: prefijo del nombre científico.
  if pg_catalog.strpos(normalized_query, ' ') = 0 then
    -- Una palabra: cuatro rangos del índice btree, cada uno leído en orden y solo hasta lo que
    -- falta. 1: expandida, especies; 2: expandida, híbridos; 3: escrita, especies;
    -- 4: escrita, híbridos. La expandida, si la hay, es el nombre normalizado del género.
    -- U+10FFFF (chr(1114111)) es el mayor carácter: todo texto que empieza por step_low es
    -- menor que step_low || U+10FFFF en el orden "C", y ningún nombre lo contiene.
    for step in 1..4 loop
      exit when pg_catalog.cardinality(found_ids) >= result_limit;
      step_low := case when step <= 2 then expanded_query else normalized_query end;
      continue when step_low is null;
      step_high := step_low || pg_catalog.chr(1114111);
      step_hybrid := step in (2, 4);

      select
        found_ids || pg_catalog.array_agg(x.id order by x.sort_text, x.id),
        found_names || pg_catalog.array_agg(x.scientific_name order by x.sort_text, x.id),
        found_types || pg_catalog.array_agg('scientific'::public.species_match_type order by x.sort_text, x.id)
      into found_ids, found_names, found_types
      from (
        select s.id, s.scientific_name, public.normalize_search_text(s.scientific_name) collate "C" as sort_text
        from public.species s
        where public.normalize_search_text(s.scientific_name) collate "C" >= step_low
          and public.normalize_search_text(s.scientific_name) collate "C" < step_high
          and (s.type = 'hybrid') = step_hybrid
          and s.id <> all (found_ids)
        order by public.normalize_search_text(s.scientific_name) collate "C", s.id
        limit result_limit - pg_catalog.cardinality(found_ids)
      ) x;
    end loop;
  else
    -- Varias palabras: el índice de trigramas encuentra los pocos nombres que cumplen el patrón
    -- y se ordenan en memoria con la misma regla.
    select
      found_ids || pg_catalog.array_agg(x.id order by x.is_expanded desc, x.is_hybrid, x.sort_text, x.id),
      found_names || pg_catalog.array_agg(x.scientific_name order by x.is_expanded desc, x.is_hybrid, x.sort_text, x.id),
      found_types || pg_catalog.array_agg('scientific'::public.species_match_type order by x.is_expanded desc, x.is_hybrid, x.sort_text, x.id)
    into found_ids, found_names, found_types
    from (
      select
        s.id,
        s.scientific_name,
        coalesce(public.normalize_search_text(s.scientific_name) like expanded_pattern, false) as is_expanded,
        s.type = 'hybrid' as is_hybrid,
        public.normalize_search_text(s.scientific_name) collate "C" as sort_text
      from public.species s
      where public.normalize_search_text(s.scientific_name) like prefix_pattern
         or public.normalize_search_text(s.scientific_name) like expanded_pattern
      order by 3 desc, 4, 5, 1
      limit result_limit
    ) x;
  end if;

  -- Clase 2: prefijo de un sinónimo o nombre común (escrita o expandida), con el índice de
  -- trigramas. Una fila por especie: su mejor nombre (expandida primero, luego el nombre
  -- normalizado). Un LIKE con patrón nulo (sin abreviatura) no se cumple ni recorre el índice.
  if pg_catalog.cardinality(found_ids) < result_limit then
    select
      found_ids || pg_catalog.array_agg(x.species_id order by x.ord),
      found_names || pg_catalog.array_agg(x.name order by x.ord),
      found_types || pg_catalog.array_agg(x.name_type order by x.ord)
    into found_ids, found_names, found_types
    from (
      select b.species_id, b.name, b.name_type,
        pg_catalog.row_number() over (order by b.is_expanded desc, b.is_hybrid, b.sort_text, b.species_id) as ord
      from (
        -- El tipo de la especie, con su clave primaria: los candidatos son pocos, y con un join
        -- el plan genérico prefería recorrer species entera (1 ms).
        select c.*, (select s.type = 'hybrid' from public.species s where s.id = c.species_id) as is_hybrid
        from (
          select distinct on (n.species_id)
            n.species_id,
            n.name,
            n.type::text::public.species_match_type as name_type,
            coalesce(public.normalize_search_text(n.name) like expanded_pattern, false) as is_expanded,
            public.normalize_search_text(n.name) collate "C" as sort_text
          from public.species_names n
          where (public.normalize_search_text(n.name) like prefix_pattern
                 or public.normalize_search_text(n.name) like expanded_pattern)
            and n.species_id <> all (found_ids)
          order by n.species_id, 4 desc, 5
        ) c
      ) b
      order by b.is_expanded desc, b.is_hybrid, b.sort_text, b.species_id
      limit result_limit - pg_catalog.cardinality(found_ids)
    ) x;
  end if;

  -- Clase 3: similitud, en dos pasadas (umbral 0,6 y después 0,3). Las cuatro ramas son las de
  -- antes (nombre científico y otros nombres, con la forma escrita y la expandida); cada una
  -- exige además parecerse al epíteto (o, sin epíteto, otra vez a la consulta, lo que no cambia
  -- nada). La normalización y la similitud de cada candidato se calculan una sola vez (los
  -- lateral con offset 0 impiden que Postgres repita la expresión en cada uso).
  if coalesce(similarity_query, expanded_similarity_query) is not null then
    for pass in 1..2 loop
      exit when pg_catalog.cardinality(found_ids) >= result_limit;
      perform pg_catalog.set_config(
        'pg_trgm.word_similarity_threshold', case when pass = 1 then '0.6' else '0.3' end, true
      );

      select
        found_ids || pg_catalog.array_agg(x.species_id order by x.ord),
        found_names || pg_catalog.array_agg(x.name order by x.ord),
        found_types || pg_catalog.array_agg(x.name_type order by x.ord)
      into found_ids, found_names, found_types
      from (
        select b.species_id, b.name, b.name_type,
          pg_catalog.row_number() over (
            order by b.score desc, b.full_score desc, b.name_type, s.type = 'hybrid', b.sort_text, b.species_id
          ) as ord
        from (
          select distinct on (c.species_id)
            c.species_id,
            c.name,
            c.name_type,
            least(sc.full_score, coalesce(extensions.word_similarity(epithet_query, t.normalized), sc.full_score)) as score,
            sc.full_score,
            t.normalized collate "C" as sort_text
          from (
            select s.id as species_id, s.scientific_name as name,
              'scientific'::public.species_match_type as name_type, false as is_expanded
            from public.species s
            where public.normalize_search_text(s.scientific_name) operator(extensions.%>) similarity_query
              and public.normalize_search_text(s.scientific_name) operator(extensions.%>) coalesce(epithet_query, similarity_query)
            union all
            select n.species_id, n.name, n.type::text::public.species_match_type, false
            from public.species_names n
            where public.normalize_search_text(n.name) operator(extensions.%>) similarity_query
              and public.normalize_search_text(n.name) operator(extensions.%>) coalesce(epithet_query, similarity_query)
            union all
            select s.id, s.scientific_name, 'scientific'::public.species_match_type, true
            from public.species s
            where public.normalize_search_text(s.scientific_name) operator(extensions.%>) expanded_similarity_query
              and public.normalize_search_text(s.scientific_name) operator(extensions.%>) coalesce(epithet_query, expanded_similarity_query)
            union all
            select n.species_id, n.name, n.type::text::public.species_match_type, true
            from public.species_names n
            where public.normalize_search_text(n.name) operator(extensions.%>) expanded_similarity_query
              and public.normalize_search_text(n.name) operator(extensions.%>) coalesce(epithet_query, expanded_similarity_query)
          ) c
          cross join lateral (select public.normalize_search_text(c.name) as normalized offset 0) t
          cross join lateral (
            select extensions.word_similarity(
              case when c.is_expanded then expanded_query else normalized_query end, t.normalized
            ) as full_score
            offset 0
          ) sc
          where c.species_id <> all (found_ids)
          order by c.species_id, 4 desc, 5 desc, c.name_type, 6
        ) b
        join public.species s on s.id = b.species_id
        order by b.score desc, b.full_score desc, b.name_type, s.type = 'hybrid', b.sort_text, b.species_id
        limit result_limit - pg_catalog.cardinality(found_ids)
      ) x;
    end loop;
  end if;

  -- Resultado, en el orden en que se encontró.
  return query
  select s.id, s.scientific_name, g.id, g.name, s.type, s.status, f.name, f.name_type
  from rows from (pg_catalog.unnest(found_ids), pg_catalog.unnest(found_names), pg_catalog.unnest(found_types))
    with ordinality as f (species_id, name, name_type, ord)
  join public.species s on s.id = f.species_id
  join public.genera g on g.id = s.genus_id
  order by f.ord;
end;
$$;

comment on function public.search_species(text, integer) is
  'Busca especies por nombre científico, sinónimo o nombre común, tolerando errores de tipeo y tildes, y expandiendo una abreviatura de género al principio ("Phal. amab"). Una fila por especie, con el nombre por el que coincidió.';

revoke all on function public.search_species(text, integer) from public;
grant execute on function public.search_species(text, integer) to anon, authenticated, service_role;

-- Búsqueda de géneros ----------------------------------------------------------------------
--
-- Mismas condiciones de coincidencia que antes; cambia el orden. Clases, en este orden:
--   1. Abreviatura: la consulta entera, sin el punto final, es una abreviatura del género
--      ("ang" es Anguloa por Ang., aunque Angraecum vaya antes en el alfabeto).
--   2. Prefijo del nombre del género (por palabras, como en search_species()).
--   3. Similitud (word_similarity de al menos 0,3), de mayor a menor.
-- A igual clase (y en la 3, a igual similitud):
--   - Primero los géneros de acceso rápido (is_quick_access): "catl" y "cat" devuelven Cattleya
--     antes que Catasetum, "ph" Phalaenopsis antes que Phalandopsis.
--   - Después los géneros botánicos antes que los nothogéneros (los guardados con el signo de
--     híbrido delante, "× Cattleychea"). Se elige esto y no el número de especies porque se
--     ve en el propio nombre, sin contar filas de species, y porque es lo que se quiere: un
--     nothogénero tiene casi siempre pocas especies (en COL solo los híbridos naturales) y
--     quien busca uno suele escribir su nombre casi entero.
--   - Al final, el nombre normalizado (sin el signo) con intercalación "C", y el id.
-- Cada género sale una vez, con su mejor coincidencia (la clase más baja; a igualdad, la mayor
-- similitud). Con 752 géneros no hace falta cortar por etapas: tarda menos de 0,5 ms.

create or replace function public.search_genera(query text, max_results integer default 10)
returns table (
  id uuid,
  name text,
  is_quick_access boolean,
  matched_abbreviation text
)
language plpgsql
stable
security invoker
set search_path = ''
set pg_trgm.word_similarity_threshold = 0.3
rows 20
as $$
#variable_conflict use_column
declare
  normalized_query text;
  similarity_query text;
  prefix_pattern text;
  abbreviation_key text;
  result_limit integer;
begin
  if query is null or pg_catalog.char_length(query) > 100 then
    return;
  end if;

  normalized_query := public.normalize_search_text(query);
  if pg_catalog.char_length(normalized_query) < 2 or normalized_query !~ '[[:alnum:]]' then
    return;
  end if;

  similarity_query := case
    when pg_catalog.char_length(normalized_query) >= 3 then normalized_query
  end;

  prefix_pattern := pg_catalog.replace(
    pg_catalog.replace(
      pg_catalog.replace(pg_catalog.replace(normalized_query, '\', '\\'), '%', '\%'),
      '_', '\_'
    ),
    ' ', '% '
  ) || '%';

  abbreviation_key := pg_catalog.rtrim(normalized_query, '.');

  result_limit := case
    when max_results is null or max_results <= 0 then 10
    else least(max_results, 20)
  end;

  return query
  with candidates as (
    -- Nombre del género: prefijo (clase 2) o solo similitud (clase 3).
    select
      g.id as c_genus_id,
      null::text as c_abbreviation,
      case when public.normalize_search_text(g.name) like prefix_pattern then 2 else 3 end as c_class,
      extensions.word_similarity(normalized_query, public.normalize_search_text(g.name)) as c_score
    from public.genera g
    where public.normalize_search_text(g.name) operator(extensions.%>) similarity_query
       or public.normalize_search_text(g.name) like prefix_pattern
    union all
    -- Abreviatura (clase 1): la consulta entera es su clave.
    select a.genus_id, a.abbreviation, 1, 1::real
    from public.genus_abbreviations a
    where public.normalize_search_text(pg_catalog.rtrim(a.abbreviation, '.')) = abbreviation_key
  ),
  best as (
    select distinct on (c.c_genus_id) c.*
    from candidates c
    order by c.c_genus_id, c.c_class, c.c_score desc
  )
  select g.id, g.name, g.is_quick_access, b.c_abbreviation
  from best b
  join public.genera g on g.id = b.c_genus_id
  order by
    b.c_class,
    -- La similitud solo ordena dentro de la clase 3.
    case when b.c_class = 3 then b.c_score else 1 end desc,
    g.is_quick_access desc,
    -- Nothogénero: el nombre guardado empieza por el signo de híbrido.
    pg_catalog.left(g.name, 1) = U&'\00D7',
    public.normalize_search_text(g.name) collate "C",
    g.id
  limit result_limit;
end;
$$;

comment on function public.search_genera(text, integer) is
  'Busca géneros por nombre, tolerando errores de tipeo y tildes, o por su abreviatura (con o sin punto). Para el chip "Otro" del registro.';

revoke all on function public.search_genera(text, integer) from public;
grant execute on function public.search_genera(text, integer) to anon, authenticated, service_role;
