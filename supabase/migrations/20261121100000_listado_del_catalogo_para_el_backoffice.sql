-- Listado del catálogo para el backoffice (issue #99, parte de #20).
--
-- La pantalla /administracion/catalogo muestra el catálogo completo (32 464 especies y 60 000
-- sinónimos con COL26.10 XR) en una tabla de solo lectura, con búsqueda, filtros, paginación en
-- el servidor y un resumen. Esta migración añade lo que la API no daba:
--
--   1. public.list_catalog_species(): el catálogo en orden alfabético, con filtros por estado,
--      género, tipo y fuente, paginado por clave (keyset) y con el total exacto.
--   2. public.search_catalog_species(): lo mismo con texto de búsqueda, por relevancia y con la
--      tolerancia de search_species() (errores de tipeo, tildes, abreviaturas, signo "×"),
--      paginado por número de página.
--   3. public.list_catalog_genera(): los géneros con sus abreviaturas, la marca de acceso
--      rápido y su número de especies, paginados.
--   4. public.catalog_summary(): los recuentos del resumen.
--   5. public.count_species_plants(): cuántas plantas de usuarios tienen enlazada una especie
--      (solo el número). Es una función de administrador: se salta RLS.
--   6. Dos índices btree para recorrer el catálogo en orden alfabético sin calcular la
--      normalización de cada fila.
--
-- El detalle de una especie (sus datos y sus nombres alternativos) no necesita función: se lee
-- de las tablas, que son de lectura pública.
--
-- Quién puede llamarlas: solo los administradores del catálogo, como el resto del backoffice.
-- Las cuatro primeras solo leen el catálogo, que es público, así que son security invoker (leen
-- con los permisos de quien llama y no se saltan nada); pero no son la API pública de consulta:
-- recorren y cuentan mucho más que search_species() y solo las usa esta pantalla. Por eso solo
-- las ejecuta authenticated y lo primero que hacen es comprobar public.is_catalog_admin(), con
-- el mismo error 42501 que el guardián private.require_catalog_admin() (que no pueden llamar:
-- private solo lo ejecuta su dueño, y estas funciones corren como quien llama). Una página
-- pública del catálogo sería otro issue, con su propia API. count_species_plants() lee las
-- plantas de todos los usuarios, que RLS oculta al administrador, y sigue el patrón de las
-- funciones de administrador (security definer y el guardián como primera sentencia; ver
-- "Funciones de administrador" en supabase/README.md).
--
-- Todas fijan search_path vacío y califican cada nombre. Los recuentos son exactos: con este
-- tamaño cuestan pocos milisegundos (mediciones en supabase/README.md, "Listado del catálogo").

-- pg_trgm.word_similarity_threshold solo existe con la biblioteca de pg_trgm cargada en la
-- sesión (ver la migración de abreviaturas); search_catalog_species() lo fija.
do $$
begin
  perform extensions.word_similarity('', '');
end;
$$;

-- Índices ---------------------------------------------------------------------------------
--
-- El orden alfabético de la tabla es el del nombre científico normalizado
-- (public.normalize_search_text(), sin tildes, mayúsculas ni signo de híbrido) con
-- intercalación "C", y el id para desempatar (dos nombres pueden normalizarse igual, por
-- ejemplo con y sin el signo de híbrido). Ordenar por esa expresión sin un índice que la tenga
-- entera obliga a calcularla en cada fila: con el índice de prefijo de la búsqueda, que no
-- tenía el id, Postgres leía el nombre de cada fila para desempatar (Incremental Sort) y la
-- última página tardaba 94 ms; con desplazamiento (offset), lo mismo, porque recorre y calcula
-- todas las filas anteriores.
--
-- species_scientific_name_prefix_idx se redefine con el id como segunda columna: sirve igual
-- a search_species() (sus rangos de prefijo ordenan por nombre normalizado e id) y además
-- resuelve una página del listado leyendo solo sus filas, a partir de la clave de la última
-- fila de la página anterior. Se borra y se vuelve a crear con el mismo nombre (las pruebas y
-- npm run db:perf lo reconocen por él). Con 32 464 especies ocupa unos 2 MB y tarda menos de
-- un segundo en crearse, bloqueando la escritura en species mientras tanto.
drop index if exists public.species_scientific_name_prefix_idx;
create index species_scientific_name_prefix_idx on public.species
  ((public.normalize_search_text(scientific_name) collate "C"), id);

-- Filtro por género: las especies de un género, en el mismo orden. Sin él, la página de un
-- género del final del alfabeto recorre el índice anterior desde el principio. Empieza por
-- genus_id, así que también sirve a la clave foránea; species_genus_id_idx se conserva para
-- contar las especies de cada género con un índice pequeño.
create index if not exists species_genus_id_name_idx on public.species
  (genus_id, (public.normalize_search_text(scientific_name) collate "C"), id);

-- Los filtros por estado, tipo y fuente no llevan índice propio: tienen tres o cuatro valores
-- y uno domina (con el catálogo real, todo es "importada" y "Catalogue of Life"). Se aplican
-- sobre las filas que da el índice alfabético; en el peor caso (un valor que casi no aparece)
-- se recorre el índice entero, unos 3 ms. Contar los nombres de cada especie de una página usa
-- species_names_species_id_name_key, que empieza por species_id: no hace falta otro.

-- Comprobación del rol ------------------------------------------------------------------------
--
-- Las funciones invoker no pueden llamar a private.require_catalog_admin(), así que repiten su
-- comprobación con el mismo texto, código y pista. La regla del rol sigue en un solo sitio,
-- public.is_catalog_admin().

-- Listado alfabético ------------------------------------------------------------------------
--
-- public.list_catalog_species(filtros, page_size, after_id, before_id, last_page)
--
-- Sin texto de búsqueda, la tabla lista el catálogo en orden alfabético. Paginación por clave:
-- la página siguiente son las page_size filas que van después de la última de la página actual
-- (after_id), la anterior las que van antes de la primera (before_id), y last_page pide la
-- última. Cada página lee solo sus filas del índice, esté donde esté: la primera y la última
-- cuestan lo mismo. Por desplazamiento, la página n recorre y calcula las n - 1 anteriores.
--
-- La página se identifica por el id de una especie: la función busca su clave (nombre
-- normalizado e id). Si esa especie ya no existe, devuelve la primera página. Las páginas se
-- cortan siempre desde el principio: la última tiene el resto (total mod page_size, o una
-- página entera), así que ir hacia atrás desde ella da las mismas páginas que hacia delante.
--
-- Filtros: cada uno es opcional (null, sin filtro) y se combinan con "y". plan_cache_mode =
-- force_custom_plan hace que cada consulta se planifique con los valores de la llamada: un
-- filtro nulo desaparece de la condición y uno con valor puede usar su índice (con el plan
-- genérico, "filtro is null or columna = filtro" no puede usar ninguno). Planificar cuesta
-- menos de un milisegundo.
--
-- page_size: 50 por defecto y 100 como máximo; si es nulo, cero o negativo se usan 50. La API
-- devuelve como mucho 1000 filas por petición y la tabla nunca pide más de una página.
--
-- Devuelve las filas de la página en orden, cada una con el total de especies que cumplen los
-- filtros y si hay páginas antes y después. Sin coincidencias no devuelve ninguna fila.

create function public.list_catalog_species(
  filter_status public.species_status default null,
  filter_genus_id uuid default null,
  filter_type public.species_type default null,
  filter_source public.species_source default null,
  page_size integer default 50,
  after_id uuid default null,
  before_id uuid default null,
  last_page boolean default false
)
returns table (
  id uuid,
  scientific_name text,
  genus_id uuid,
  genus_name text,
  type public.species_type,
  status public.species_status,
  source public.species_source,
  source_ref text,
  synonym_count bigint,
  common_name_count bigint,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint,
  has_previous boolean,
  has_next boolean
)
language plpgsql
stable
security invoker
set search_path = ''
set plan_cache_mode = force_custom_plan
rows 50
as $$
#variable_conflict use_column
declare
  result_size integer;
  total bigint;
  cursor_id uuid;
  cursor_key text collate "C";
  backwards boolean := false;
  fetch_size integer;
  page_ids uuid[];
  first_key text collate "C";
  last_key text collate "C";
  previous_exists boolean;
  next_exists boolean;
begin
  if not public.is_catalog_admin() then
    raise exception 'Solo un administrador del catálogo puede hacer esto.'
      using errcode = '42501',
            hint = 'El rol se asigna en Clerk (public_metadata.role = catalog_admin) y llega en el claim app_role del token.';
  end if;

  result_size := case
    when page_size is null or page_size <= 0 then 50
    else least(page_size, 100)
  end;

  select pg_catalog.count(*) into total
  from public.species s
  where (filter_status is null or s.status = filter_status)
    and (filter_genus_id is null or s.genus_id = filter_genus_id)
    and (filter_type is null or s.type = filter_type)
    and (filter_source is null or s.source = filter_source);

  if total = 0 then
    return;
  end if;

  -- Punto de partida: después de after_id, antes de before_id, desde el final o desde el
  -- principio. Un id que ya no existe se ignora (primera página).
  fetch_size := result_size;
  if before_id is not null then
    select public.normalize_search_text(s.scientific_name), s.id
      into cursor_key, cursor_id
      from public.species s where s.id = before_id;
    backwards := cursor_id is not null;
  elsif after_id is not null then
    select public.normalize_search_text(s.scientific_name), s.id
      into cursor_key, cursor_id
      from public.species s where s.id = after_id;
  elsif last_page then
    backwards := true;
    fetch_size := (total - 1) % result_size + 1;
  end if;

  if backwards then
    select pg_catalog.array_agg(x.id order by x.sort_key, x.id)
      into page_ids
      from (
        select s.id, public.normalize_search_text(s.scientific_name) collate "C" as sort_key
        from public.species s
        where (filter_status is null or s.status = filter_status)
          and (filter_genus_id is null or s.genus_id = filter_genus_id)
          and (filter_type is null or s.type = filter_type)
          and (filter_source is null or s.source = filter_source)
          and (cursor_id is null
               or (public.normalize_search_text(s.scientific_name) collate "C", s.id) < (cursor_key, cursor_id))
        order by public.normalize_search_text(s.scientific_name) collate "C" desc, s.id desc
        limit fetch_size
      ) x;
  else
    select pg_catalog.array_agg(x.id order by x.sort_key, x.id)
      into page_ids
      from (
        select s.id, public.normalize_search_text(s.scientific_name) collate "C" as sort_key
        from public.species s
        where (filter_status is null or s.status = filter_status)
          and (filter_genus_id is null or s.genus_id = filter_genus_id)
          and (filter_type is null or s.type = filter_type)
          and (filter_source is null or s.source = filter_source)
          and (cursor_id is null
               or (public.normalize_search_text(s.scientific_name) collate "C", s.id) > (cursor_key, cursor_id))
        order by public.normalize_search_text(s.scientific_name) collate "C", s.id
        limit fetch_size
      ) x;
  end if;

  -- Antes de la primera especie (hacia atrás) no queda nada: la primera página.
  if page_ids is null then
    if backwards and cursor_id is not null then
      return query
      select * from public.list_catalog_species(
        filter_status, filter_genus_id, filter_type, filter_source, result_size
      );
    end if;
    return;
  end if;

  -- ¿Hay filas antes de la primera y después de la última de la página? Cada pregunta lee el
  -- índice en orden desde ese punto y para en la primera fila que cumple los filtros. Se
  -- escriben con "order by ... limit 1" y no con exists: con exists, el planificador puede
  -- preferir recorrer la tabla, y entonces calcula la normalización de cada fila hasta
  -- encontrar una (toda la tabla, en la primera página).
  select public.normalize_search_text(s.scientific_name) into first_key
    from public.species s where s.id = page_ids[1];
  select public.normalize_search_text(s.scientific_name) into last_key
    from public.species s where s.id = page_ids[pg_catalog.cardinality(page_ids)];

  perform
    from public.species s
    where (filter_status is null or s.status = filter_status)
      and (filter_genus_id is null or s.genus_id = filter_genus_id)
      and (filter_type is null or s.type = filter_type)
      and (filter_source is null or s.source = filter_source)
      and (public.normalize_search_text(s.scientific_name) collate "C", s.id) < (first_key, page_ids[1])
    order by public.normalize_search_text(s.scientific_name) collate "C" desc, s.id desc
    limit 1;
  previous_exists := found;
  perform
    from public.species s
    where (filter_status is null or s.status = filter_status)
      and (filter_genus_id is null or s.genus_id = filter_genus_id)
      and (filter_type is null or s.type = filter_type)
      and (filter_source is null or s.source = filter_source)
      and (public.normalize_search_text(s.scientific_name) collate "C", s.id)
          > (last_key, page_ids[pg_catalog.cardinality(page_ids)])
    order by public.normalize_search_text(s.scientific_name) collate "C", s.id
    limit 1;
  next_exists := found;

  return query
  select
    s.id, s.scientific_name, g.id, g.name, s.type, s.status, s.source, s.source_ref,
    nc.synonym_count, nc.common_name_count, s.created_at, s.updated_at,
    total, previous_exists, next_exists
  from pg_catalog.unnest(page_ids) with ordinality as p (species_id, ord)
  join public.species s on s.id = p.species_id
  join public.genera g on g.id = s.genus_id
  cross join lateral (
    select
      pg_catalog.count(*) filter (where n.type = 'synonym') as synonym_count,
      pg_catalog.count(*) filter (where n.type = 'common') as common_name_count
    from public.species_names n
    where n.species_id = s.id
  ) nc
  order by p.ord;
end;
$$;

comment on function public.list_catalog_species(
  public.species_status, uuid, public.species_type, public.species_source, integer, uuid, uuid, boolean
) is
  'Backoffice: el catálogo en orden alfabético, con filtros opcionales y paginado por clave (after_id, before_id, last_page), con el total. Solo administradores del catálogo.';

revoke all on function public.list_catalog_species(
  public.species_status, uuid, public.species_type, public.species_source, integer, uuid, uuid, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.list_catalog_species(
  public.species_status, uuid, public.species_type, public.species_source, integer, uuid, uuid, boolean
) to authenticated;

-- Búsqueda en la tabla ------------------------------------------------------------------------
--
-- public.search_catalog_species(query, filtros, page_size, page_number)
--
-- Con texto, la tabla ordena por relevancia, como el autocompletado. La consulta se prepara
-- exactamente igual que en public.search_species() (migración
-- 20261120230000_busqueda_con_catalogo_real.sql): normalizada, con los mismos límites (de 2 a
-- 100 caracteres; fuera de ellos no devuelve nada), con la abreviatura de género de la
-- primera palabra expandida y con el epíteto (segunda palabra de 3 caracteres o más). Lo que
-- cambia es qué se devuelve: search_species() da como mucho 20 especies para una lista
-- desplegable; aquí hacen falta todas las que coinciden, con filtros, el total y páginas.
--
-- Qué coincide, en dos etapas:
--   1. Prefijo por palabras del nombre científico (clase 1) o de un sinónimo o nombre común
--      (clase 2), con la consulta escrita o la expandida, como en search_species(). Con
--      índices de trigramas.
--   2. Solo si la etapa 1 no encuentra nada (dentro de los filtros): similitud
--      (word_similarity de al menos 0,3 con la consulta y con el epíteto), para los errores de
--      tipeo y las palabras de en medio.
-- En el autocompletado la similitud rellena hasta 10 resultados detrás de los prefijos; en
-- una tabla con todas las coincidencias, sumarla siempre añadiría miles de nombres que solo se
-- parecen ("dendrob" traería, detrás de los 1631 Dendrobium, los Epidendrum) y costaría
-- calcularla para todos. Si algo empieza como lo escrito, eso es lo que se busca; si nada
-- empieza así, lo escrito tiene un error y se buscan los parecidos.
--
-- Cada especie sale una vez, con el nombre por el que coincidió (el mejor: clase 1 antes que
-- 2, la forma expandida antes que la escrita y, después, el nombre normalizado), en el orden de
-- search_species(): en la etapa 1, clase, expandida primero, especies antes que híbridos,
-- nombre normalizado con intercalación "C" e id; en la 2, puntuación (la menor de las dos
-- similitudes), similitud con la consulta entera, tipo de nombre (científico, sinónimo,
-- común), especies antes que híbridos, nombre normalizado e id.
--
-- Paginación por número de página (page_number, desde 1; 50 filas por defecto y 100 como
-- máximo). El conjunto ordenado se calcula entero en cada llamada (hace falta para el total y
-- para el orden), así que pedir una página u otra cuesta lo mismo; lo que pesa es el número de
-- candidatos de la consulta. El peor caso medido son los prefijos de dos letras de los géneros
-- más grandes ("ca", "bu"): unos 2000 nombres. Una página más allá de la última devuelve la
-- última; current_page dice cuál se devolvió.

create function public.search_catalog_species(
  query text,
  filter_status public.species_status default null,
  filter_genus_id uuid default null,
  filter_type public.species_type default null,
  filter_source public.species_source default null,
  page_size integer default 50,
  page_number integer default 1
)
returns table (
  id uuid,
  scientific_name text,
  genus_id uuid,
  genus_name text,
  type public.species_type,
  status public.species_status,
  source public.species_source,
  source_ref text,
  synonym_count bigint,
  common_name_count bigint,
  created_at timestamptz,
  updated_at timestamptz,
  matched_name text,
  matched_name_type public.species_match_type,
  total_count bigint,
  current_page integer
)
language plpgsql
stable
security invoker
set search_path = ''
set pg_trgm.word_similarity_threshold = 0.3
set plan_cache_mode = force_custom_plan
rows 50
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
  result_size integer;
  total integer;
  page integer;
  first_row integer;
  found_ids uuid[];
  found_names text[];
  found_types public.species_match_type[];
begin
  if not public.is_catalog_admin() then
    raise exception 'Solo un administrador del catálogo puede hacer esto.'
      using errcode = '42501',
            hint = 'El rol se asigna en Clerk (public_metadata.role = catalog_admin) y llega en el claim app_role del token.';
  end if;

  -- Preparación de la consulta, igual que en public.search_species().
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

  epithet_query := pg_catalog.split_part(normalized_query, ' ', 2);
  if pg_catalog.char_length(epithet_query) < 3 then
    epithet_query := null;
  end if;

  result_size := case
    when page_size is null or page_size <= 0 then 50
    else least(page_size, 100)
  end;

  -- Etapa 1: prefijo del nombre científico (clase 1) o de otro nombre (clase 2). La
  -- normalización de cada candidato se calcula una vez más para ordenar (lateral con offset 0,
  -- para que Postgres no la repita en cada uso); la del where la calcula la comprobación del
  -- índice de trigramas. Un LIKE con patrón nulo (sin abreviatura) no se cumple ni recorre el
  -- índice.
  select
    pg_catalog.array_agg(b.species_id order by b.match_class, b.is_expanded desc, b.is_hybrid, b.sort_text, b.species_id),
    pg_catalog.array_agg(b.name order by b.match_class, b.is_expanded desc, b.is_hybrid, b.sort_text, b.species_id),
    pg_catalog.array_agg(b.name_type order by b.match_class, b.is_expanded desc, b.is_hybrid, b.sort_text, b.species_id)
  into found_ids, found_names, found_types
  from (
    select distinct on (c.species_id)
      c.species_id, c.name, c.name_type, c.match_class,
      coalesce(t.normalized like expanded_pattern, false) as is_expanded,
      s.type = 'hybrid' as is_hybrid,
      t.normalized collate "C" as sort_text
    from (
      select s.id as species_id, s.scientific_name as name,
        'scientific'::public.species_match_type as name_type, 1 as match_class
      from public.species s
      where public.normalize_search_text(s.scientific_name) like prefix_pattern
         or public.normalize_search_text(s.scientific_name) like expanded_pattern
      union all
      select n.species_id, n.name, n.type::text::public.species_match_type, 2
      from public.species_names n
      where public.normalize_search_text(n.name) like prefix_pattern
         or public.normalize_search_text(n.name) like expanded_pattern
    ) c
    cross join lateral (select public.normalize_search_text(c.name) as normalized offset 0) t
    join public.species s on s.id = c.species_id
    where (filter_status is null or s.status = filter_status)
      and (filter_genus_id is null or s.genus_id = filter_genus_id)
      and (filter_type is null or s.type = filter_type)
      and (filter_source is null or s.source = filter_source)
    order by c.species_id, c.match_class, 5 desc, 7
  ) b;

  -- Etapa 2: similitud, solo si la etapa 1 no encontró nada. Las cuatro ramas de la clase 3 de
  -- search_species(), con una sola pasada (umbral 0,3): aquí se quieren todas.
  if found_ids is null and coalesce(similarity_query, expanded_similarity_query) is not null then
    select
      pg_catalog.array_agg(b.species_id order by b.score desc, b.full_score desc, b.name_type, b.is_hybrid, b.sort_text, b.species_id),
      pg_catalog.array_agg(b.name order by b.score desc, b.full_score desc, b.name_type, b.is_hybrid, b.sort_text, b.species_id),
      pg_catalog.array_agg(b.name_type order by b.score desc, b.full_score desc, b.name_type, b.is_hybrid, b.sort_text, b.species_id)
    into found_ids, found_names, found_types
    from (
      select distinct on (c.species_id)
        c.species_id,
        c.name,
        c.name_type,
        least(sc.full_score, coalesce(extensions.word_similarity(epithet_query, t.normalized), sc.full_score)) as score,
        sc.full_score,
        s.type = 'hybrid' as is_hybrid,
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
      join public.species s on s.id = c.species_id
      where (filter_status is null or s.status = filter_status)
        and (filter_genus_id is null or s.genus_id = filter_genus_id)
        and (filter_type is null or s.type = filter_type)
        and (filter_source is null or s.source = filter_source)
      order by c.species_id, 4 desc, 5 desc, c.name_type, 7
    ) b;
  end if;

  total := coalesce(pg_catalog.cardinality(found_ids), 0);
  if total = 0 then
    return;
  end if;

  -- Página pedida, sin pasar de la última.
  page := least(greatest(coalesce(page_number, 1), 1), (total - 1) / result_size + 1);
  first_row := (page - 1) * result_size + 1;

  return query
  select
    s.id, s.scientific_name, g.id, g.name, s.type, s.status, s.source, s.source_ref,
    nc.synonym_count, nc.common_name_count, s.created_at, s.updated_at,
    f.name, f.name_type, total::bigint, page
  from rows from (
    pg_catalog.unnest(found_ids[first_row:first_row + result_size - 1]),
    pg_catalog.unnest(found_names[first_row:first_row + result_size - 1]),
    pg_catalog.unnest(found_types[first_row:first_row + result_size - 1])
  ) with ordinality as f (species_id, name, name_type, ord)
  join public.species s on s.id = f.species_id
  join public.genera g on g.id = s.genus_id
  cross join lateral (
    select
      pg_catalog.count(*) filter (where n.type = 'synonym') as synonym_count,
      pg_catalog.count(*) filter (where n.type = 'common') as common_name_count
    from public.species_names n
    where n.species_id = s.id
  ) nc
  order by f.ord;
end;
$$;

comment on function public.search_catalog_species(
  text, public.species_status, uuid, public.species_type, public.species_source, integer, integer
) is
  'Backoffice: busca en el catálogo con la tolerancia de search_species() (prefijo y, si no hay ninguno, similitud), con filtros opcionales, por relevancia, paginado por número de página y con el total. Solo administradores del catálogo.';

revoke all on function public.search_catalog_species(
  text, public.species_status, uuid, public.species_type, public.species_source, integer, integer
) from public, anon, authenticated, service_role;
grant execute on function public.search_catalog_species(
  text, public.species_status, uuid, public.species_type, public.species_source, integer, integer
) to authenticated;

-- Géneros ---------------------------------------------------------------------------------------
--
-- public.list_catalog_genera(query, quick_access_only, page_size, page_number)
--
-- Los géneros en orden alfabético (nombre normalizado, sin el signo de híbrido, con
-- intercalación "C", e id), con sus abreviaturas (ordenadas), si son de acceso rápido y su
-- número de especies (especies e híbridos). Filtros opcionales: texto (el nombre normalizado lo
-- contiene, o la consulta entera sin el punto final es una de sus abreviaturas, como en
-- search_genera()) y solo los de acceso rápido. Paginado por número de página, como
-- search_catalog_species(): son 755 géneros y recorrerlos todos cuesta alrededor de un
-- milisegundo, así que no hace falta paginar por clave. Mismos límites de page_size; una
-- página más allá de la última devuelve la última.

create function public.list_catalog_genera(
  query text default null,
  quick_access_only boolean default false,
  page_size integer default 50,
  page_number integer default 1
)
returns table (
  id uuid,
  name text,
  is_quick_access boolean,
  abbreviations text[],
  species_count bigint,
  total_count bigint,
  current_page integer
)
language plpgsql
stable
security invoker
set search_path = ''
rows 50
as $$
#variable_conflict use_column
declare
  normalized_query text;
  contains_pattern text;
  result_size integer;
  total bigint;
  page integer;
begin
  if not public.is_catalog_admin() then
    raise exception 'Solo un administrador del catálogo puede hacer esto.'
      using errcode = '42501',
            hint = 'El rol se asigna en Clerk (public_metadata.role = catalog_admin) y llega en el claim app_role del token.';
  end if;

  if query is not null and pg_catalog.char_length(query) <= 100 then
    normalized_query := public.normalize_search_text(query);
    if normalized_query = '' then
      normalized_query := null;
    else
      contains_pattern := '%' || pg_catalog.replace(
        pg_catalog.replace(pg_catalog.replace(normalized_query, '\', '\\'), '%', '\%'),
        '_', '\_'
      ) || '%';
    end if;
  elsif query is not null then
    return;
  end if;

  result_size := case
    when page_size is null or page_size <= 0 then 50
    else least(page_size, 100)
  end;

  select pg_catalog.count(*) into total
  from public.genera g
  where (not coalesce(quick_access_only, false) or g.is_quick_access)
    and (normalized_query is null
         or public.normalize_search_text(g.name) like contains_pattern
         or exists (
           select from public.genus_abbreviations a
           where a.genus_id = g.id
             and public.normalize_search_text(pg_catalog.rtrim(a.abbreviation, '.'))
                 = pg_catalog.rtrim(normalized_query, '.')
         ));

  if total = 0 then
    return;
  end if;

  page := least(greatest(coalesce(page_number, 1), 1), ((total - 1) / result_size + 1)::integer);

  return query
  select
    x.id, x.name, x.is_quick_access,
    coalesce(
      (select pg_catalog.array_agg(a.abbreviation order by pg_catalog.lower(a.abbreviation))
         from public.genus_abbreviations a where a.genus_id = x.id),
      '{}'
    ),
    (select pg_catalog.count(*) from public.species s where s.genus_id = x.id),
    total,
    page
  from (
    select g.id, g.name, g.is_quick_access
    from public.genera g
    where (not coalesce(quick_access_only, false) or g.is_quick_access)
      and (normalized_query is null
           or public.normalize_search_text(g.name) like contains_pattern
           or exists (
             select from public.genus_abbreviations a
             where a.genus_id = g.id
               and public.normalize_search_text(pg_catalog.rtrim(a.abbreviation, '.'))
                   = pg_catalog.rtrim(normalized_query, '.')
           ))
    order by public.normalize_search_text(g.name) collate "C", g.id
    offset (page - 1) * result_size
    limit result_size
  ) x
  order by public.normalize_search_text(x.name) collate "C", x.id;
end;
$$;

comment on function public.list_catalog_genera(text, boolean, integer, integer) is
  'Backoffice: los géneros con sus abreviaturas, la marca de acceso rápido y su número de especies, con filtros opcionales, paginados y con el total. Solo administradores del catálogo.';

revoke all on function public.list_catalog_genera(text, boolean, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_catalog_genera(text, boolean, integer, integer) to authenticated;

-- Resumen ---------------------------------------------------------------------------------------
--
-- public.catalog_summary(): una fila con los recuentos del resumen de la pantalla. Especies e
-- híbridos por separado (type); por estado y por fuente, las dos cosas juntas. Una columna por
-- valor de cada enumerado: si un enumerado gana un valor, hay que añadir su columna aquí. Tres
-- recorridos secuenciales (species, species_names y genera), unos 5 ms en total.

create function public.catalog_summary()
returns table (
  genus_count bigint,
  species_count bigint,
  hybrid_count bigint,
  synonym_count bigint,
  common_name_count bigint,
  imported_count bigint,
  validated_count bigint,
  observed_count bigint,
  col_source_count bigint,
  curated_source_count bigint,
  user_proposal_source_count bigint,
  gbif_source_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
rows 1
as $$
begin
  if not public.is_catalog_admin() then
    raise exception 'Solo un administrador del catálogo puede hacer esto.'
      using errcode = '42501',
            hint = 'El rol se asigna en Clerk (public_metadata.role = catalog_admin) y llega en el claim app_role del token.';
  end if;

  return query
  select
    (select pg_catalog.count(*) from public.genera),
    sp.species_count, sp.hybrid_count,
    nm.synonym_count, nm.common_name_count,
    sp.imported_count, sp.validated_count, sp.observed_count,
    sp.col_source_count, sp.curated_source_count, sp.user_proposal_source_count, sp.gbif_source_count
  from (
    select
      pg_catalog.count(*) filter (where s.type = 'species') as species_count,
      pg_catalog.count(*) filter (where s.type = 'hybrid') as hybrid_count,
      pg_catalog.count(*) filter (where s.status = 'imported') as imported_count,
      pg_catalog.count(*) filter (where s.status = 'validated') as validated_count,
      pg_catalog.count(*) filter (where s.status = 'observed') as observed_count,
      pg_catalog.count(*) filter (where s.source = 'col') as col_source_count,
      pg_catalog.count(*) filter (where s.source = 'curated') as curated_source_count,
      pg_catalog.count(*) filter (where s.source = 'user_proposal') as user_proposal_source_count,
      pg_catalog.count(*) filter (where s.source = 'gbif') as gbif_source_count
    from public.species s
  ) sp
  cross join (
    select
      pg_catalog.count(*) filter (where n.type = 'synonym') as synonym_count,
      pg_catalog.count(*) filter (where n.type = 'common') as common_name_count
    from public.species_names n
  ) nm;
end;
$$;

comment on function public.catalog_summary() is
  'Backoffice: recuentos del catálogo (géneros, especies, híbridos, sinónimos, nombres comunes, y especies por estado y por fuente). Solo administradores del catálogo.';

revoke all on function public.catalog_summary() from public, anon, authenticated, service_role;
grant execute on function public.catalog_summary() to authenticated;

-- Plantas enlazadas a una especie -------------------------------------------------------------
--
-- public.count_species_plants(target_species_id): cuántas plantas de usuarios tienen enlazada
-- esa especie, de cualquier dueño y en cualquier estado (también las perdidas o regaladas:
-- todas impiden borrarla). Solo el número: ningún dato de las plantas ni de sus dueños. Una
-- especie que no existe da 0. Usa el índice parcial plants_species_id_idx.
--
-- Función de administrador (ver supabase/README.md): RLS solo deja a cada usuario ver sus
-- plantas, también al administrador, así que contar las de todos exige security definer, y por
-- eso el guardián va primero.

create function public.count_species_plants(target_species_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  total bigint;
begin
  perform private.require_catalog_admin();

  select pg_catalog.count(*) into total
  from public.plants p
  where p.species_id = target_species_id;
  return total;
end;
$$;

comment on function public.count_species_plants(uuid) is
  'Backoffice: número de plantas de usuarios enlazadas a una especie, sin ningún dato de ellas. Función de administrador.';

revoke all on function public.count_species_plants(uuid) from public, anon, authenticated, service_role;
grant execute on function public.count_species_plants(uuid) to authenticated;
