-- Ajustes de la búsqueda: consultas cortas y signo de híbrido (parte de #7).
--
-- Esta migración:
--   1. Redefine public.normalize_search_text() para que ignore el signo de híbrido: el signo
--      de multiplicación "×" (U+00D7) y la "x" suelta que se escribe en su lugar.
--   2. Reconstruye los índices que usan esa función (los tres de trigramas y la clave de
--      búsqueda de las abreviaturas), porque su contenido depende de lo que devuelve.
--   3. Redefine public.search_species() y public.search_genera() para que una consulta de
--      menos de 3 caracteres busque solo por prefijo, sin similitud.
--
-- Firmas, permisos, propiedades y comentarios de las tres funciones se conservan; las
-- decisiones que no cambian están explicadas en las migraciones
-- 20261120190000_busqueda_de_especies.sql y 20261120200000_abreviaturas_y_busqueda_de_generos.sql.

-- Las dos funciones de búsqueda fijan pg_trgm.word_similarity_threshold, que solo existe con
-- la biblioteca de pg_trgm cargada en la sesión (ver la migración de abreviaturas).
do $$
begin
  perform extensions.word_similarity('', '');
end;
$$;

-- Normalización: el signo de híbrido no cuenta ---------------------------------------------
--
-- Los géneros híbridos (nothogéneros) y los híbridos naturales se guardan como los escribe la
-- fuente (Catalogue of Life), con el signo de multiplicación: "× Rhyncholaeliocattleya" y
-- "Phalaenopsis × intermedia". Quien busca no lo escribe, o escribe una "x" en su lugar. La
-- normalización quita el signo de los dos lados, así que "rhyncholaeliocattleya",
-- "phalaenopsis intermedia", "phalaenopsis x intermedia" y "phal x intermedia" (con la
-- abreviatura) encuentran esos nombres.
--
-- Regla, en este orden:
--   1. Cada "×" (U+00D7) se sustituye por un espacio, antes de quitar las tildes (unaccent lo
--      convertiría en "*"). Pegado o separado da lo mismo: "×Rhyncholaeliocattleya" y
--      "× Rhyncholaeliocattleya" quedan en "rhyncholaeliocattleya", y "Phalaenopsis×intermedia"
--      en "phalaenopsis intermedia".
--   2. Se quitan las tildes, se pasa a minúsculas, se unifican los espacios y se recortan los
--      de los extremos, como antes.
--   3. Se quita la "x" que es una palabra entera seguida de otra palabra: al principio
--      ("x intermedia" pasa a "intermedia") o entre dos palabras ("phal x intermedia" pasa a
--      "phal intermedia"). Varias seguidas se quitan todas ("x x a" pasa a "a"). Como los
--      extremos ya están recortados, un espacio final no cuenta como otra palabra.
--   4. Se vuelven a recortar los extremos (al quitar una "x" inicial queda un espacio delante).
--
-- Casos límite:
--   - La "x" dentro de una palabra no se toca: "xanthina", "Maxillaria", "x-ray" o "xx a".
--   - La "x" al final no se quita: "phal x" se queda igual, porque mientras se escribe puede
--     ser el comienzo de un epíteto ("phal x" puede acabar en "phal xanthina"). Un nombre que
--     sea solo "x" sigue siendo "x".
--   - Un texto que es solo el signo ("×") o el signo y espacios queda vacío.
--   - Una consulta puede quedarse corta al quitar la "x": "x a" (3 caracteres) queda en "a" y
--     no busca nada, y "x ph" queda en "ph" y busca solo por prefijo (ver más abajo).
--   - Se aplica igual a lo guardado y a lo buscado, así que da lo mismo cuál de las dos formas
--     se use en el catálogo.
--
-- Sigue siendo immutable por las razones de la primera migración: el signo se escribe como
-- U&'\00D7', sin depender de la codificación del cliente, y la expresión regular de la "x" no
-- depende de la configuración regional.

create or replace function public.normalize_search_text(value text)
returns text
language sql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $$
  select pg_catalog.btrim(
    pg_catalog.regexp_replace(
      pg_catalog.btrim(
        pg_catalog.regexp_replace(
          pg_catalog.lower(
            extensions.unaccent('extensions.unaccent'::regdictionary, pg_catalog.replace(value, U&'\00D7', ' '))
          ),
          '\s+', ' ', 'g'
        )
      ),
      '(^| )x(?= )', '', 'g'
    )
  )
$$;

comment on function public.normalize_search_text(text) is
  'Texto para buscar: minúsculas, sin tildes, con los espacios unificados y sin el signo de híbrido (× o una x suelta seguida de otra palabra). La usan los índices de búsqueda y las consultas.';

revoke all on function public.normalize_search_text(text) from public;
grant execute on function public.normalize_search_text(text) to anon, authenticated, service_role;

-- Reconstrucción de los índices ----------------------------------------------------------
--
-- Los índices de expresión guardan el resultado de normalize_search_text() de cada fila
-- calculado con la versión anterior de la función. Postgres no los recalcula al cambiarla
-- (confía en que una función immutable no cambia), así que, sin reconstruirlos, una fila con
-- "×" seguiría indexada como "* rhyncholaeliocattleya" y las búsquedas que usan el índice no
-- la encontrarían, aunque las que no lo usan sí. reindex los vuelve a calcular con la función
-- nueva. Bloquea la escritura en estas tablas mientras dura, que con el catálogo actual es un
-- momento.
--
-- El índice único genus_abbreviations_search_key no se puede romper con los datos de las
-- migraciones: todas las abreviaturas cargadas son una sola palabra con punto final y sin "×"
-- (lo comprueba busqueda_generos_y_abreviaturas.sql), así que su clave no cambia. Solo
-- chocarían dos abreviaturas que se diferencien únicamente por el signo de híbrido ("× Abc."
-- y "Abc."); si existieran, el reindex fallaría con un error de valor duplicado y la
-- migración no se aplicaría, sin dejar nada a medias.

reindex index public.species_scientific_name_trgm_idx;
reindex index public.species_names_name_trgm_idx;
reindex index public.genera_name_trgm_idx;
reindex index public.genus_abbreviations_search_key;

-- Búsqueda de especies: consultas cortas solo por prefijo --------------------------------
--
-- Igual que la de la migración 20261120200000_abreviaturas_y_busqueda_de_generos.sql, salvo
-- en esto: la condición de similitud (operador %>) solo se usa si la forma de la consulta con
-- la que se busca tiene al menos 3 caracteres normalizada. Con 2 caracteres solo cuenta el
-- prefijo por palabras: "ph" encuentra los nombres que empiezan por "ph" (científicos,
-- sinónimos y nombres comunes), pero ya no los que solo tienen una palabra que empieza así.
--
-- Por qué: con 2 caracteres la consulta tiene tan pocos trigramas que word_similarity supera
-- el umbral con cualquier nombre que tenga una palabra que empiece por esas letras ("ph"
-- frente a cualquier nombre con una palabra en "p"). Con 30 000 especies y 80 000 sinónimos,
-- "ph" dejaba pasar unos 21 000 candidatos y tardaba 141 ms de mediana (más de 300 ms con el
-- doble de catálogo); solo con el prefijo, unos 15 ms. Esos candidatos de más ordenaban por
-- detrás de los prefijos y casi nunca llegaban a los 10 primeros.
--
-- Cómo: similarity_query es la consulta normalizada si tiene al menos 3 caracteres y nulo si
-- no. El operador %> es estricto, así que con nulo esa condición no se cumple para ninguna
-- fila y Postgres no recorre el índice para ella; queda solo el LIKE del prefijo. La
-- puntuación (word_similarity) se sigue calculando con la consulta normalizada, para ordenar.
--
-- Con abreviatura, cada forma decide por su propia longitud: "c." (2 caracteres) busca solo
-- por prefijo con la forma escrita, pero la expandida ("cattleya") sí usa la similitud, como
-- antes. La longitud es la de la consulta ya normalizada, sin el signo de híbrido: "x ph"
-- cuenta como "ph".

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
  expanded_pattern text;
  result_limit integer;
begin
  if query is null or pg_catalog.char_length(query) > 100 then
    return;
  end if;

  normalized_query := public.normalize_search_text(query);
  if pg_catalog.char_length(normalized_query) < 2 or normalized_query !~ '[[:alnum:]]' then
    return;
  end if;

  -- Con menos de 3 caracteres, solo prefijo: la condición de similitud recibe nulo.
  similarity_query := case
    when pg_catalog.char_length(normalized_query) >= 3 then normalized_query
  end;

  -- Patrón de LIKE del prefijo por palabras ("phal amab" pasa a 'phal% amab%'), con los
  -- comodines de la consulta escapados. La consulta normalizada separa las palabras con un
  -- solo espacio.
  prefix_pattern := pg_catalog.replace(
    pg_catalog.replace(
      pg_catalog.replace(pg_catalog.replace(normalized_query, '\', '\\'), '%', '\%'),
      '_', '\_'
    ),
    ' ', '% '
  ) || '%';

  -- Abreviatura de género en la primera palabra: se resuelve con el índice
  -- genus_abbreviations_search_key (la misma expresión).
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

  return query
  with candidates as (
    -- Nombre científico, con la consulta escrita: por similitud (si tiene al menos 3
    -- caracteres) o por prefijo.
    select
      s.id as c_species_id,
      s.scientific_name as c_name,
      'scientific'::public.species_match_type as c_type,
      public.normalize_search_text(s.scientific_name) like prefix_pattern
        as c_is_prefix,
      false as c_is_expanded,
      extensions.word_similarity(normalized_query, public.normalize_search_text(s.scientific_name))
        as c_score
    from public.species s
    where public.normalize_search_text(s.scientific_name) operator(extensions.%>) similarity_query
       or public.normalize_search_text(s.scientific_name) like prefix_pattern
    union all
    -- Sinónimos y nombres comunes, con la consulta escrita: por similitud (si tiene al menos 3
    -- caracteres) o por prefijo, que aquí solo sirve para que entren ("doritis pulch"); el
    -- orden lo da la similitud.
    select
      n.species_id,
      n.name,
      n.type::text::public.species_match_type,
      false,
      false,
      extensions.word_similarity(normalized_query, public.normalize_search_text(n.name))
    from public.species_names n
    where public.normalize_search_text(n.name) operator(extensions.%>) similarity_query
       or public.normalize_search_text(n.name) like prefix_pattern
    union all
    -- Nombre científico, con la consulta expandida (solo si hubo abreviatura).
    select
      s.id,
      s.scientific_name,
      'scientific'::public.species_match_type,
      public.normalize_search_text(s.scientific_name) like expanded_pattern,
      true,
      extensions.word_similarity(expanded_query, public.normalize_search_text(s.scientific_name))
    from public.species s
    where expanded_query is not null
      and (public.normalize_search_text(s.scientific_name) operator(extensions.%>) expanded_similarity_query
           or public.normalize_search_text(s.scientific_name) like expanded_pattern)
    union all
    -- Sinónimos y nombres comunes, con la consulta expandida (solo si hubo abreviatura).
    select
      n.species_id,
      n.name,
      n.type::text::public.species_match_type,
      false,
      true,
      extensions.word_similarity(expanded_query, public.normalize_search_text(n.name))
    from public.species_names n
    where expanded_query is not null
      and (public.normalize_search_text(n.name) operator(extensions.%>) expanded_similarity_query
           or public.normalize_search_text(n.name) like expanded_pattern)
  ),
  best as (
    -- La mejor coincidencia de cada especie (el enumerado ordena scientific, synonym, common).
    select distinct on (c.c_species_id) c.*
    from candidates c
    order by c.c_species_id, c.c_is_prefix desc, c.c_is_expanded desc, c.c_score desc, c.c_type, c.c_name
  )
  select
    s.id,
    s.scientific_name,
    g.id,
    g.name,
    s.type,
    s.status,
    b.c_name,
    b.c_type
  from best b
  join public.species s on s.id = b.c_species_id
  join public.genera g on g.id = s.genus_id
  order by b.c_is_prefix desc, b.c_is_expanded desc, b.c_score desc, b.c_type, s.scientific_name, s.id
  limit result_limit;
end;
$$;

comment on function public.search_species(text, integer) is
  'Busca especies por nombre científico, sinónimo o nombre común, tolerando errores de tipeo y tildes, y expandiendo una abreviatura de género al principio ("Phal. amab"). Una fila por especie, con el nombre por el que coincidió.';

revoke all on function public.search_species(text, integer) from public;
grant execute on function public.search_species(text, integer) to anon, authenticated, service_role;

-- Búsqueda de géneros: consultas cortas solo por prefijo ---------------------------------
--
-- El mismo cambio que en search_species(), por coherencia y no por rendimiento: con unos
-- pocos cientos de géneros la similitud de 2 caracteres es barata, pero añade el mismo ruido
-- ("ph" coincidía por similitud con cualquier género que empieza por "p", como Pleurothallis).
-- Con menos de 3 caracteres solo cuentan el prefijo del nombre y la abreviatura ("c." sigue
-- encontrando Cattleya por su abreviatura). Lo demás no cambia.

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

  -- Con menos de 3 caracteres, solo prefijo y abreviatura: la condición de similitud recibe nulo.
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
    -- Nombre del género: por similitud (si la consulta tiene al menos 3 caracteres) o por
    -- prefijo.
    select
      g.id as c_genus_id,
      null::text as c_abbreviation,
      public.normalize_search_text(g.name) like prefix_pattern as c_is_prefix,
      extensions.word_similarity(normalized_query, public.normalize_search_text(g.name)) as c_score
    from public.genera g
    where public.normalize_search_text(g.name) operator(extensions.%>) similarity_query
       or public.normalize_search_text(g.name) like prefix_pattern
    union all
    -- Abreviatura: la consulta entera es su clave.
    select
      a.genus_id,
      a.abbreviation,
      true,
      1::real
    from public.genus_abbreviations a
    where public.normalize_search_text(pg_catalog.rtrim(a.abbreviation, '.')) = abbreviation_key
  ),
  best as (
    select distinct on (c.c_genus_id) c.*
    from candidates c
    order by c.c_genus_id, c.c_is_prefix desc, c.c_score desc, c.c_abbreviation nulls first
  )
  select
    g.id,
    g.name,
    g.is_quick_access,
    b.c_abbreviation
  from best b
  join public.genera g on g.id = b.c_genus_id
  order by b.c_is_prefix desc, b.c_score desc, g.name, g.id
  limit result_limit;
end;
$$;

comment on function public.search_genera(text, integer) is
  'Busca géneros por nombre, tolerando errores de tipeo y tildes, o por su abreviatura (con o sin punto). Para el chip "Otro" del registro.';

revoke all on function public.search_genera(text, integer) from public;
grant execute on function public.search_genera(text, integer) to anon, authenticated, service_role;
