-- Abreviaturas de género en la búsqueda y búsqueda de géneros (issue #69, parte de #7).
--
-- Esta migración:
--   1. Crea un índice único sobre la clave de búsqueda de cada abreviatura (normalizada y sin
--      el punto final), que usan las dos funciones de búsqueda para resolverla y que impide que
--      dos abreviaturas choquen al buscar ("Phal." y "phal" son la misma clave).
--   2. Redefine public.search_species() para expandir una abreviatura de género al principio de
--      la consulta ("Phal. amab" y "phal amab" buscan también "phalaenopsis amab").
--   3. Crea public.search_genera(), la búsqueda de géneros del chip "Otro" del registro.
--   4. Carga las abreviaturas estándar de la RHS de los géneros más comunes en cultivo, además
--      de las cinco de los géneros de acceso rápido que cargó la migración del catálogo.
--
-- Se puede volver a ejecutar entera sin error ni duplicados (create or replace, if not exists,
-- on conflict do nothing). La prueba datos_ejemplo.sql lo aprovecha para aplicarla sobre los
-- datos de ejemplo de desarrollo.

-- Clave de búsqueda de las abreviaturas -------------------------------------------------
--
-- La clave es public.normalize_search_text(rtrim(abbreviation, '.')): "Phal." pasa a "phal".
-- La consulta se compara con esa misma expresión, así que la búsqueda resuelve la abreviatura
-- con este índice, sin recorrer la tabla.
--
-- Es única: genus_abbreviations_abbreviation_key ya impide "Phal." y "PHAL.", y esta clave
-- impide además "Phal" (sin punto) o "Phál." junto a "Phal.", que la búsqueda no podría
-- distinguir. Como las demás expresiones con normalize_search_text(), quien escribe en
-- genus_abbreviations necesita ejecutar esa función y usar el esquema extensions (ver la
-- migración de búsqueda de especies); los roles que escriben el catálogo ya lo tienen.
--
-- Si algún día una abreviatura tiene espacios dentro, la búsqueda de especies no la expande
-- (solo mira la primera palabra), pero la búsqueda de géneros sí la encuentra.

create unique index if not exists genus_abbreviations_search_key on public.genus_abbreviations
  (public.normalize_search_text(pg_catalog.rtrim(abbreviation, '.')));

-- Las dos funciones fijan pg_trgm.word_similarity_threshold. Ese parámetro solo existe cuando
-- la biblioteca de pg_trgm está cargada en la sesión; si no, Postgres lo trata como un
-- parámetro desconocido y un rol que no es superusuario (postgres en Supabase) no puede
-- fijarlo en una función ("permission denied to set parameter"). La migración anterior la
-- cargaba al crear los índices; aquí se carga llamando a una de sus funciones.
do $$
begin
  perform extensions.word_similarity('', '');
end;
$$;

-- Búsqueda de especies con abreviaturas -------------------------------------------------
--
-- Igual que la de la migración 20261120190000_busqueda_de_especies.sql (misma firma, mismos
-- permisos, propiedades, límites y orden; las decisiones están explicadas allí), más la
-- expansión de abreviaturas:
--
--   - Si la primera palabra de la consulta normalizada, sin sus puntos finales, es la clave de
--     una abreviatura conocida, se sustituye por el nombre normalizado de su género: "Phal.
--     amab", "phal amab" y "PHAL. amab" dan "phalaenopsis amab". Da igual el punto y las
--     mayúsculas. Solo cuenta si la abreviatura es una palabra entera, separada por un espacio:
--     "Phal.amab" no se expande.
--   - Una abreviatura desconocida no se expande: la consulta se busca tal cual.
--   - La consulta que es solo la abreviatura ("phal" o "phal.") busca el género entero
--     ("phalaenopsis"): devuelve sus especies, por prefijo.
--   - Los límites (nula, más de 100 caracteres, menos de 2 caracteres o sin letras ni números)
--     se comprueban sobre la consulta escrita, antes de expandir. Por eso "c." (dos
--     caracteres) busca Cattleya y "c" no busca nada.
--
-- Casos ambiguos: una abreviatura puede ser también el comienzo real de otros nombres ("cal"
-- es Calanthe, pero también el comienzo de Calypso; "den" el de Dendrochilum). Por eso se
-- buscan las dos formas, la expandida y la escrita, y cada especie sale una vez con su mejor
-- coincidencia:
--   - "cal bul" encuentra Calypso bulbosa (por la forma escrita) aunque "cal" se expanda a
--     Calanthe.
--   - Con la misma clase de coincidencia (prefijo o no), gana la de la forma expandida: tras
--     "den" salen primero las especies de Dendrobium y después las de Dendrochilum.
--   - Lo que encontraba la forma escrita lo sigue encontrando, aunque puede bajar de puesto
--     (y quedar fuera del tope de resultados) por detrás de lo que encuentra la expandida.
--     Las búsquedas que no empiezan por una abreviatura no cambian en nada.
-- El coste es buscar dos veces cuando hay abreviatura; las dos búsquedas usan los índices.
--
-- Orden:
--   1. Primero las especies cuyo nombre científico empieza por la consulta (expandida o
--      escrita), por palabras.
--   2. Dentro de cada grupo (prefijo o no), primero las que coincidieron con la consulta
--      expandida.
--   3. Después, de mayor a menor similitud (word_similarity con la forma con que coincidió).
--   4. A igualdad, el nombre científico gana a los sinónimos, y estos a los nombres comunes.
--   5. Desempate final estable: el nombre científico (y el id, por si acaso).
-- La mejor coincidencia de cada especie se elige con el mismo criterio. matched_name sigue
-- siendo el nombre del catálogo por el que coincidió ("Phalaenopsis amabilis"), no la
-- abreviatura.

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
  prefix_pattern text;
  first_word text;
  genus_text text;
  expanded_query text;
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
    -- Nombre científico, con la consulta escrita: por similitud o por prefijo.
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
    where public.normalize_search_text(s.scientific_name) operator(extensions.%>) normalized_query
       or public.normalize_search_text(s.scientific_name) like prefix_pattern
    union all
    -- Sinónimos y nombres comunes, con la consulta escrita: por similitud o por prefijo, que
    -- aquí solo sirve para que entren ("doritis pulch"); el orden lo da la similitud.
    select
      n.species_id,
      n.name,
      n.type::text::public.species_match_type,
      false,
      false,
      extensions.word_similarity(normalized_query, public.normalize_search_text(n.name))
    from public.species_names n
    where public.normalize_search_text(n.name) operator(extensions.%>) normalized_query
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
      and (public.normalize_search_text(s.scientific_name) operator(extensions.%>) expanded_query
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
      and (public.normalize_search_text(n.name) operator(extensions.%>) expanded_query
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

-- Búsqueda de géneros -------------------------------------------------------------------
--
-- public.search_genera(query, max_results) devuelve los géneros cuyo nombre se parece a la
-- consulta o cuya abreviatura es la consulta. La usa el chip "Otro" del registro.
--
-- Un género es candidato si:
--   - Su nombre se parece a la consulta (word_similarity de al menos 0,3, operador %>) o la
--     consulta es su prefijo por palabras (LIKE 'phal%'), como en search_species(). Las dos
--     condiciones usan el índice genera_name_trgm_idx.
--   - O la consulta entera, sin sus puntos finales, es la clave de una de sus abreviaturas
--     ("phal", "Phal." o "PHAL" encuentran Phalaenopsis). Usa el índice
--     genus_abbreviations_search_key.
--
-- Devuelve id, nombre, si es de acceso rápido y matched_abbreviation: la abreviatura tal como
-- está guardada ("Phal.") si el género coincidió por ella, o null si coincidió solo por su
-- nombre. Una coincidencia por abreviatura cuenta como prefijo con similitud 1, así que gana
-- a la del nombre: "phal" devuelve Phalaenopsis con matched_abbreviation "Phal.".
--
-- Orden: primero los prefijos (también la abreviatura), luego de mayor a menor similitud y al
-- final por nombre (y id). Cada género sale una vez, con su mejor coincidencia por el mismo
-- criterio; a igualdad, la del nombre gana a la de la abreviatura.
--
-- Límites, propiedades y permisos, los de search_species(): consulta nula, de más de 100
-- caracteres, o que normalizada tiene menos de 2 caracteres o ninguna letra ni número, da
-- vacío sin error; max_results es 10 por defecto, 20 como máximo, y 10 si es nulo, cero o
-- negativo. security invoker, stable, search_path vacío, umbral de similitud fijado en la
-- función; ejecutable por anon, authenticated y service_role, no por PUBLIC.

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
    -- Nombre del género: por similitud o por prefijo.
    select
      g.id as c_genus_id,
      null::text as c_abbreviation,
      public.normalize_search_text(g.name) like prefix_pattern as c_is_prefix,
      extensions.word_similarity(normalized_query, public.normalize_search_text(g.name)) as c_score
    from public.genera g
    where public.normalize_search_text(g.name) operator(extensions.%>) normalized_query
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

-- Abreviaturas habituales ---------------------------------------------------------------
--
-- Abreviaturas estándar de la Royal Horticultural Society (RHS), autoridad internacional de
-- registro de híbridos de orquídeas y fuente de las que se imprimen en las etiquetas de
-- vivero: "Alphabetical list of standard abbreviations for natural and hybrid generic names"
-- (la misma lista que cita la migración del catálogo),
-- https://www.rhs.org.uk/plants/pdfs/plant-registration-forms/orchid-name-abbreviations-list.pdf
--
-- Se cargan las de los géneros (y nothogéneros híbridos) más comunes en cultivo, además de las
-- cinco de acceso rápido (Phal., C., Den., Onc., V.). Incluye algunos nombres que la RHS ya
-- no usa para registrar porque sus géneros se fusionaron con otros, marcados como
-- "histórico", porque siguen en muchas etiquetas: Brassolaeliocattleya (hoy casi todo
-- Rhyncholaeliocattleya), Sophrolaeliocattleya y Sophronitis (hoy Cattleya), Doritaenopsis
-- (hoy Phalaenopsis) y Ascocenda (hoy Vanda). Una etiqueta "Blc." debe seguir llevando a
-- Brassolaeliocattleya.
--
-- Criterio para los choques, porque una abreviatura solo puede ser de un género:
--   - Manda la lista de la RHS, que ya asigna cada abreviatura a un solo nombre. Las letras
--     sueltas son solo las suyas: C. es Cattleya, B. Brassavola, E. Encyclia, L. Laelia,
--     V. Vanda y Z. Zygopetalum. Por eso no se carga ninguna forma informal que choque con
--     ellas (por ejemplo "C." para Cymbidium o Cypripedium, que en la RHS son Cym. y Cyp.).
--   - Ninguna forma informal ni variante sin punto: "Paph" o "phal" ya los encuentra la
--     búsqueda sin el punto, y el índice genus_abbreviations_search_key impide guardar a la
--     vez "Phal." y "Phal".
--   - Una abreviatura que coincide con el comienzo de otro género (Cal. es Calanthe, pero
--     "cal" también es el comienzo de Calypso; Den. y Dendrochilum, cuya abreviatura es otra)
--     se asigna igualmente al género de la RHS: la búsqueda de especies busca la forma
--     expandida y la escrita, y la de géneros encuentra los dos por prefijo.
--   - Ninguna clave de abreviatura es el nombre entero de un género del catálogo (lo
--     comprueba busqueda_generos_y_abreviaturas.sql).
--
-- Revisión: estas abreviaturas se escribieron sin poder consultar la lista de la RHS en el
-- momento. El 20 nov 2026 el responsable del producto revisó y confirmó las doce que estaban
-- en duda: Aer., Angcm., Ang., Ble., Ctt., Drac., Lyc., Max., Pln., Rhy., Stan. y Tolu. Si más
-- adelante alguna resulta estar mal, se corrige con una migración nueva (update de la
-- abreviatura).
--
-- Idempotente y sin depender de mayúsculas:
--   - Crea el género si no existe (sin marcarlo de acceso rápido); si ya existe, con
--     cualquier mayúscula, no lo toca. Los datos de ejemplo de desarrollo crean Brassia,
--     Guarianthe y Paphiopedilum con estas mismas abreviaturas.
--   - Si la abreviatura ya existe (con cualquier mayúscula, con o sin punto), en este género o
--     en otro, no la toca ni falla.

with abbreviations (genus_name, abbreviation) as (
  values
    -- Géneros botánicos.
    ('Aerides', 'Aer.'),
    ('Angraecum', 'Angcm.'),
    ('Anguloa', 'Ang.'),
    ('Bletilla', 'Ble.'),
    ('Brassavola', 'B.'),
    ('Brassia', 'Brs.'),
    ('Bulbophyllum', 'Bulb.'),
    ('Calanthe', 'Cal.'),
    ('Coelogyne', 'Coel.'),
    ('Cymbidium', 'Cym.'),
    ('Cypripedium', 'Cyp.'),
    ('Dracula', 'Drac.'),
    ('Encyclia', 'E.'),
    ('Epidendrum', 'Epi.'),
    ('Guarianthe', 'Gur.'),
    ('Laelia', 'L.'),
    ('Lycaste', 'Lyc.'),
    ('Masdevallia', 'Masd.'),
    ('Maxillaria', 'Max.'),
    ('Miltonia', 'Milt.'),
    ('Miltoniopsis', 'Mps.'),
    ('Odontoglossum', 'Odm.'),
    ('Paphiopedilum', 'Paph.'),
    ('Phragmipedium', 'Phrag.'),
    ('Pleione', 'Pln.'),
    ('Rhynchostylis', 'Rhy.'),
    ('Sophronitis', 'Soph.'), -- histórico
    ('Stanhopea', 'Stan.'),
    ('Tolumnia', 'Tolu.'),
    ('Zygopetalum', 'Z.'),
    -- Nothogéneros (géneros híbridos).
    ('Ascocenda', 'Ascda.'), -- histórico
    ('Brassocattleya', 'Bc.'),
    ('Brassolaeliocattleya', 'Blc.'), -- histórico
    ('Cattlianthe', 'Ctt.'),
    ('Doritaenopsis', 'Dtps.'), -- histórico
    ('Laeliocattleya', 'Lc.'),
    ('Rhyncholaeliocattleya', 'Rlc.'),
    ('Sophrolaeliocattleya', 'Slc.') -- histórico
),
new_genera as (
  insert into public.genera (name)
  select a.genus_name from abbreviations a
  on conflict do nothing
  returning id, name
),
all_genera as (
  -- Los recién creados (la sentencia no ve sus propias inserciones) y los que ya existían.
  select n.id, n.name from new_genera n
  union all
  select g.id, g.name
  from public.genera g
  join abbreviations a on lower(g.name) = lower(a.genus_name)
)
insert into public.genus_abbreviations (genus_id, abbreviation)
select g.id, a.abbreviation
from abbreviations a
join all_genera g on lower(g.name) = lower(a.genus_name)
on conflict do nothing;
