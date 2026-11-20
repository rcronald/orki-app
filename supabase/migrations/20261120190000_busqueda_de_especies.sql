-- Búsqueda tolerante de especies: normalización, índices de trigramas y función de búsqueda
-- (issue #68, parte de #7).
--
-- Esta migración:
--   1. Crea public.normalize_search_text(), que pasa un texto a minúsculas, le quita las tildes
--      y unifica los espacios. Es la misma función en los índices y en las consultas, para que
--      Postgres pueda usar los índices.
--   2. Crea índices GIN de trigramas (pg_trgm) sobre el texto normalizado del nombre científico,
--      de los nombres alternativos y del nombre del género.
--   3. Crea public.search_species(), la búsqueda de especies que usa el autocompletado del
--      registro. La API la expone en /rest/v1/rpc/search_species y se puede llamar sin sesión.
--
-- Las abreviaturas de género ("Phal. amab") y la búsqueda de géneros llegan con el #69, que
-- reutilizará la normalización y el índice de genera.

-- Normalización -------------------------------------------------------------------------
--
-- Minúsculas, sin tildes y con los espacios unificados: "  Orquídea   MARIPOSA " pasa a ser
-- "orquidea mariposa". Se quitan primero las tildes y después se pasa a minúsculas, y al final
-- se colapsan los espacios repetidos y se recortan los de los extremos.
--
-- Por qué se puede declarar immutable (y por tanto usar en un índice), aunque la extensión
-- declara unaccent() como stable:
--   - unaccent(text) busca el diccionario "unaccent" en el search_path de quien la llama, así
--     que su resultado depende de la sesión. Aquí se usa la forma con el diccionario explícito y
--     calificado (extensions.unaccent('extensions.unaccent', ...)), con el search_path de la
--     función vacío: no depende de nada de la sesión.
--   - Ese diccionario solo cambia si se cambia su archivo de reglas (unaccent.rules), lo que en
--     la práctica solo ocurre al actualizar la extensión. Si pasara, habría que reconstruir los
--     índices que usan esta función (reindex).
--   - lower() y la clase \s de la expresión regular dependen de la configuración regional de la
--     base de datos, que es fija.
--
-- Vive en public y la pueden ejecutar anon, authenticated y service_role porque
-- public.search_species() es security invoker y la llama con los permisos de quien busca
-- (anon no tiene acceso al esquema private). No lee ninguna tabla, así que no da acceso a
-- nada. La API también la expone (/rest/v1/rpc/normalize_search_text), sin ningún riesgo.

create function public.normalize_search_text(value text)
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
      pg_catalog.lower(extensions.unaccent('extensions.unaccent'::regdictionary, value)),
      '\s+', ' ', 'g'
    )
  )
$$;

comment on function public.normalize_search_text(text) is
  'Texto para buscar: minúsculas, sin tildes y con los espacios unificados. La usan los índices de búsqueda y las consultas.';

revoke all on function public.normalize_search_text(text) from public;
grant execute on function public.normalize_search_text(text) to anon, authenticated, service_role;

-- Índices de trigramas ------------------------------------------------------------------
--
-- Índices de expresión sobre el texto normalizado, con la clase de operadores de pg_trgm
-- calificada (vive en el esquema extensions). Sirven a los operadores de similitud (%, <%, %>)
-- y a LIKE, también para la búsqueda por prefijo. Una consulta los usa solo si escribe la
-- misma expresión: public.normalize_search_text(columna).
--
-- Consecuencia: Postgres calcula la expresión del índice con los permisos de quien inserta o
-- actualiza la fila, así que un rol que escriba en species, species_names o genera necesita
-- ejecutar public.normalize_search_text() y usar el esquema extensions (por unaccent). Los
-- que escriben el catálogo ya los tienen: postgres (dueño), service_role y authenticated (los
-- administradores, con las políticas del #65). Un rol nuevo que escriba el catálogo tendrá que
-- recibir los dos permisos.

create index species_scientific_name_trgm_idx on public.species
  using gin (public.normalize_search_text(scientific_name) extensions.gin_trgm_ops);

create index species_names_name_trgm_idx on public.species_names
  using gin (public.normalize_search_text(name) extensions.gin_trgm_ops);

-- Lo usará la búsqueda de géneros del #69.
create index genera_name_trgm_idx on public.genera
  using gin (public.normalize_search_text(name) extensions.gin_trgm_ops);

-- Tipo de coincidencia ------------------------------------------------------------------

-- Por qué nombre coincidió una especie en la búsqueda: su nombre científico, un sinónimo o un
-- nombre común. Los dos últimos son los valores de species_name_type.
create type public.species_match_type as enum ('scientific', 'synonym', 'common');

-- Búsqueda de especies ------------------------------------------------------------------
--
-- public.search_species(query, max_results) devuelve las especies cuyo nombre científico, o
-- alguno de sus sinónimos o nombres comunes, se parece a la consulta, con el nombre por el que
-- coincidió. Cada especie aparece una sola vez, con su mejor coincidencia.
--
-- Un nombre es candidato si cumple una de estas dos condiciones (las dos usan los índices):
--
--   - Similitud: word_similarity de pg_trgm (operador %>) de al menos 0,3. Compara los
--     trigramas de la consulta con los del trozo del nombre que más se le parece, no con el
--     nombre entero, así que una consulta corta no sale perjudicada por un nombre largo:
--     "catleya" frente a "cattleya labiata" da 0,70 con word_similarity y 0,39 con
--     similarity. Se descarta strict_word_similarity porque exige palabras completas y
--     penaliza las consultas a medias. Con un error de tipeo, un nombre completo de género y
--     epíteto queda entre 0,7 y 0,9 ("catleya labiata" 0,83, "dendrobim nobile" 0,74); el
--     umbral 0,3 deja pasar también una palabra corta mal escrita ("vamda" frente a
--     "vanda coerulea" da 0,33). Lo que entra de más lo ordena la similitud y lo corta el
--     tope de resultados.
--   - Prefijo por palabras: cada palabra de la consulta es, en orden, el comienzo de una
--     palabra del nombre, y la primera es el comienzo del nombre (LIKE 'phal% amab%'). Cubre
--     las consultas a medias de varias palabras, que con trigramas puntúan bajo: "phal amab"
--     frente a "phalaenopsis amabilis" da solo 0,42, porque cada palabra a medias aporta
--     trigramas que el nombre no tiene. Con una sola palabra es el prefijo de siempre
--     ("dendro" es prefijo de "dendrobium nobile"). Puede haber palabras en medio: "phal yuki"
--     es prefijo de "phalaenopsis sogo yukidian". Los comodines de LIKE (% y _) que escriba el
--     usuario se escapan.
--
-- El umbral de pg_trgm es un parámetro de sesión; la función lo fija en su definición
-- (set ...) para comportarse igual lo tenga como lo tenga quien llama, y Postgres restaura el
-- de la sesión al terminar.
--
-- Orden:
--   1. Primero las especies cuyo nombre científico empieza por la consulta (prefijo por
--      palabras). El prefijo de un sinónimo o de un nombre común no cuenta aquí.
--   2. Después, de mayor a menor similitud (word_similarity).
--   3. A igualdad, el nombre científico gana a los sinónimos, y estos a los nombres comunes.
--   4. Desempate final estable: el nombre científico (y el id, por si acaso).
-- La mejor coincidencia de cada especie se elige con el mismo criterio.
--
-- Estados: incluye las especies con cualquier estado del catálogo, también "observed" (un
-- administrador vio algo que revisar), porque lo importado se publica de inmediato y el
-- usuario debe poder encontrarlo. Para dejar fuera las observadas bastaría con añadir
-- "and s.status <> 'observed'" en las dos ramas de candidatos.
--
-- Límites, porque la función es pública:
--   - Si la consulta es nula, tiene más de 100 caracteres (antes de normalizar, para no
--     procesar textos enormes), o normalizada tiene menos de 2 caracteres o ninguna letra ni
--     número, devuelve vacío sin error.
--   - max_results se limita a 20; si es nulo, cero o negativo se usa el valor por defecto, 10.
--
-- Seguridad:
--   - security invoker: lee el catálogo con los permisos de quien llama, que ya es de lectura
--     pública. No toca perfiles ni plantas.
--   - stable: no escribe nada. search_path vacío y todos los nombres calificados, también los
--     operadores de pg_trgm (operator(extensions.%>)).
--   - Ejecutable por anon, authenticated y service_role; se retira el permiso a PUBLIC.
--
-- Es plpgsql (y no sql) para cortar pronto las consultas fuera de límites y para que la consulta
-- y el patrón lleguen a la sentencia como parámetros, que es lo que permite usar los índices.

create function public.search_species(query text, max_results integer default 10)
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
  prefix_pattern text;
  result_limit integer;
begin
  if query is null or pg_catalog.char_length(query) > 100 then
    return;
  end if;

  normalized_query := public.normalize_search_text(query);
  if pg_catalog.char_length(normalized_query) < 2 or normalized_query !~ '[[:alnum:]]' then
    return;
  end if;

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

  result_limit := case
    when max_results is null or max_results <= 0 then 10
    else least(max_results, 20)
  end;

  return query
  with candidates as (
    -- Nombre científico: por similitud o por prefijo.
    select
      s.id as c_species_id,
      s.scientific_name as c_name,
      'scientific'::public.species_match_type as c_type,
      public.normalize_search_text(s.scientific_name) like prefix_pattern
        as c_is_prefix,
      extensions.word_similarity(normalized_query, public.normalize_search_text(s.scientific_name))
        as c_score
    from public.species s
    where public.normalize_search_text(s.scientific_name) operator(extensions.%>) normalized_query
       or public.normalize_search_text(s.scientific_name) like prefix_pattern
    union all
    -- Sinónimos y nombres comunes: por similitud o por prefijo, que aquí solo sirve para que
    -- entren ("doritis pulch"); el orden lo da la similitud.
    select
      n.species_id,
      n.name,
      n.type::text::public.species_match_type,
      false,
      extensions.word_similarity(normalized_query, public.normalize_search_text(n.name))
    from public.species_names n
    where public.normalize_search_text(n.name) operator(extensions.%>) normalized_query
       or public.normalize_search_text(n.name) like prefix_pattern
  ),
  best as (
    -- La mejor coincidencia de cada especie (el enumerado ordena scientific, synonym, common).
    select distinct on (c.c_species_id) c.*
    from candidates c
    order by c.c_species_id, c.c_is_prefix desc, c.c_score desc, c.c_type, c.c_name
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
  order by b.c_is_prefix desc, b.c_score desc, b.c_type, s.scientific_name, s.id
  limit result_limit;
end;
$$;

comment on function public.search_species(text, integer) is
  'Busca especies por nombre científico, sinónimo o nombre común, tolerando errores de tipeo y tildes. Una fila por especie, con el nombre por el que coincidió.';

revoke all on function public.search_species(text, integer) from public;
grant execute on function public.search_species(text, integer) to anon, authenticated, service_role;
