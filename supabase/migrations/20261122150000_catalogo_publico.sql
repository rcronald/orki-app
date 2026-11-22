-- Catálogo público: lectura para visitantes sin sesión (issue #231, parte de #187).
--
-- Hasta ahora anon tenía "select" sobre las cuatro tablas del catálogo (genera,
-- genus_abbreviations, species y species_names) con políticas "using (true)", y podía ejecutar
-- search_species() y search_genera(). Con eso un visitante podía:
--   - volcar el catálogo entero con unas pocas peticiones a /rest/v1/species (PostgREST
--     devuelve hasta el máximo de filas configurado por petición) y filtrar u ordenar por
--     cualquier columna, sin índice que lo respalde;
--   - ver todas las filas, también las que no deben ser públicas (especies de propuestas de
--     usuarios que un administrador no ha validado) y el estado de revisión de cada especie.
-- La app no usa ese acceso: todas sus lecturas del catálogo (registro, colección, "¿Ya la
-- tengo?", backoffice) están detrás de RequireAuth y van con el token de Clerk, como
-- authenticated. Así que esta migración lo cierra y lo sustituye por cuatro funciones de solo
-- lectura, con paginación y topes impuestos aquí:
--   1. search_public_species(query, max_results): búsqueda, la misma de search_species().
--   2. list_public_genera(page_size, page_number): géneros con su número de especies públicas.
--   3. list_public_genus_species(target_genus_id, page_size, page_number): especies de un
--      género, paginadas, con el total.
--   4. get_public_species(target_species_id): ficha de una especie con sus sinónimos, nombres
--      comunes y fuente.
-- authenticated no cambia: sigue leyendo las tablas (la app y el backoffice las usan) y puede
-- ejecutar también estas funciones (la pantalla pública del #232 se ve igual con sesión).
--
-- Qué especie es pública ---------------------------------------------------------------------
--
--   source <> 'user_proposal' or status = 'validated'
--
-- Es decir: todo lo que viene del catálogo (Catalogue of Life, "col"; GBIF, "gbif", que hoy no
-- se usa; la lista curada de híbridos y las altas del administrador, "curated"), en cualquier
-- estado, y las especies nacidas de una propuesta de usuario ("user_proposal") solo si están
-- validadas. Por qué:
--   - Decisión del responsable (#187): se muestran las especies e híbridos del catálogo
--     importado y de la lista curada, y las validadas por el administrador; no las propuestas
--     de usuarios sin validar.
--   - "imported" (lo importado sin revisar) es casi todo el catálogo: es público.
--   - "observed" (un administrador vio algo que revisar) entra si la especie es del catálogo:
--     es una nota interna de revisión, no un rechazo, y el registro con sesión ya la ofrece en
--     search_species(). Además el administrador marca "observed" los híbridos de la lista curada
--     que edita, para que la siguiente carga no pise su edición (supabase/README.md, "Editada
--     pasa a validada"): ocultar las observadas escondería precisamente esos híbridos. Una
--     especie de propuesta que pase a "observed" o "imported" deja de ser pública.
--   - Las propuestas que todavía no son especie (plantas con validation = 'pending') no están
--     en species: viven en plants, que anon no puede leer.
--   - El estado no sale en las respuestas públicas: es información interna de revisión.
-- La condición va escrita igual en las cuatro funciones y en los índices parciales de abajo (para
-- que Postgres sepa que el índice sirve, la expresión tiene que ser la misma).
--
-- Seguridad de las funciones -----------------------------------------------------------------
--
-- Son security definer, porque anon ya no lee las tablas, con search_path vacío. No llevan el
-- guardián de administrador (son para todos); en su lugar cumplen el patrón de "lectura pública
-- del catálogo" que comprueba tests/seguridad_general.sql:
--   - language sql con cuerpo estándar (begin atomic ... end): Postgres analiza el cuerpo al
--     crearla y registra en pg_depend cada tabla y función que usa, así que la prueba puede
--     comprobar que solo dependen de las cuatro tablas del catálogo, de normalize_search_text()
--     y de search_species(). Una función así no puede leer plants, profiles ni nada más sin que
--     la prueba falle. Con plpgsql (o con el cuerpo como texto, entre dólares) no hay dependencias
--     registradas.
--   - stable: Postgres no deja que una función stable escriba nada.
--   - Solo las ejecutan anon y authenticated (no service_role, que ya lee las tablas).
--
-- Búsqueda: search_species() no se abre a anon tal cual porque devuelve el estado de cada
-- especie, incluye las filas no públicas y es security invoker (necesitaría el select directo
-- que aquí se cierra). search_public_species() la llama (corre como el dueño, así que ve todo
-- el catálogo), descarta las filas no públicas y quita el estado. No se duplica la lógica de la
-- búsqueda: tildes, signo «×», abreviaturas, errores de tipeo, orden, límites de la consulta y
-- etapas son los de search_species(). Para que una fila no pública no deje un hueco, pide 5
-- resultados más de los que devuelve; por eso el tope público es 15 (15 + 5 = 20, el tope de
-- search_species()): solo saldrían menos si entre los primeros 20 hubiera más de 5 no públicas.
-- Las especies de propuestas nacen validadas (create_species_from_proposal()), así que no
-- debería haber casi ninguna no pública y en la práctica no falta ninguna.
--
-- Paginación y topes (fuera de rango no hay error: se acota, como en el resto del catálogo):
--   - Búsqueda: 10 resultados por defecto, 15 como máximo (nulo, cero o negativo, 10); la
--     consulta, de 2 a 100 caracteres (fuera de eso, vacío), como search_species().
--   - Géneros: 100 por página por defecto y 200 como máximo; especies de un género: 50 y 100
--     (nulo, cero o negativo, el valor por defecto).
--   - Página: desde 1 (nula, cero o negativa, la 1); más allá de la última devuelve la última,
--     como list_catalog_genera(). current_page dice cuál es.
--   - Orden estable: el nombre normalizado (sin tildes, mayúsculas ni signo de híbrido) con
--     intercalación "C" y, a igualdad, el id. Es el orden del backoffice.
--   - Ficha: hasta 100 sinónimos y 100 nombres comunes, con el total de cada uno.
-- Se pagina por número de página y no por clave porque las direcciones de la pantalla
-- (/catalogo/genero/...?pagina=3) se comparten, y con los tamaños de aquí el coste de una página
-- lejana es pequeño: el género más grande del catálogo real (Bulbophyllum, unas 2200 especies)
-- son 23 páginas de 100, y llegar a la última recorre 2200 entradas de un índice. Lo que más
-- pesa de esas entradas es calcular el nombre normalizado de cada una: Postgres lo calcula para
-- ordenar aunque el índice ya da el orden, y normalize_search_text() no se puede expandir en la
-- consulta (fija search_path), así que es una llamada por fila, unos 3 µs. Medido en
-- supabase/README.md.
-- El total se cuenta en una subconsulta del from (con un agregado, Postgres no la copia en cada
-- sitio que la usa, como haría con una subconsulta escalar) y la CTE "paging" va materialized,
-- para contar una sola vez por llamada.
--
-- Rendimiento: dos índices parciales sobre las especies públicas, uno para contar por género y
-- otro para leer en orden las de un género (ver abajo). Los tiempos medidos están en
-- supabase/README.md, "Catálogo público".

-- Cierre del acceso directo de anon ----------------------------------------------------------

revoke all on table public.genera, public.genus_abbreviations, public.species, public.species_names
  from anon;

-- Las políticas de lectura eran para anon y authenticated; sin el permiso de anon no hacían nada
-- para él, pero así queda explícito.
alter policy genera_select_all on public.genera to authenticated;
alter policy genus_abbreviations_select_all on public.genus_abbreviations to authenticated;
alter policy species_select_all on public.species to authenticated;
alter policy species_names_select_all on public.species_names to authenticated;

-- Sin lectura de las tablas, estas dos funciones (security invoker) fallarían para anon con
-- "permission denied"; se le retiran para que no queden en la API como si funcionaran.
-- normalize_search_text() no lee ninguna tabla y la sigue pudiendo ejecutar.
revoke execute on function public.search_species(text, integer) from anon;
revoke execute on function public.search_genera(text, integer) from anon;

-- Índices --------------------------------------------------------------------------------------
--
-- Los dos son parciales sobre las especies públicas (la misma condición que las funciones):
--   - species_public_genus_name_idx, con las columnas de species_genus_id_name_idx (género,
--     nombre normalizado con intercalación "C" e id): list_public_genus_species() cuenta las de
--     un género y lee su página en orden, sin ordenar el género en memoria ni ir a la tabla a
--     comprobar si cada fila es pública (con species_genus_id_name_idx, que no lo sabe, habría
--     que hacerlo por cada especie del género). Como los demás índices de expresión, lo calcula
--     quien escribe en species (ver la migración de búsqueda de especies) y hay que
--     reconstruirlo si cambia normalize_search_text().
--   - species_public_genus_idx, solo con el género: list_public_genera() cuenta las especies
--     públicas de todos los géneros recorriendo solo este índice (index only scan), ya agrupado.
--     Con el anterior, más ancho por el nombre, Postgres prefería leer la tabla entera (medido
--     con el catálogo sintético: 5 ms por llamada).
-- Se crean sin concurrently porque las migraciones van en una transacción; con 32 464 especies
-- tardan menos de un segundo.

create index species_public_genus_name_idx on public.species
  (genus_id, (public.normalize_search_text(scientific_name) collate "C"), id)
  where source <> 'user_proposal' or status = 'validated';

create index species_public_genus_idx on public.species (genus_id)
  where source <> 'user_proposal' or status = 'validated';

-- 1. Búsqueda ----------------------------------------------------------------------------------

create function public.search_public_species(query text, max_results integer default 10)
returns table (
  id uuid,
  scientific_name text,
  genus_id uuid,
  genus_name text,
  type public.species_type,
  matched_name text,
  matched_name_type public.species_match_type
)
language sql
stable
security definer
set search_path = ''
rows 15
begin atomic
  select r.id, r.scientific_name, r.genus_id, r.genus_name, r.type, r.matched_name, r.matched_name_type
  from public.search_species(
    search_public_species.query,
    case
      when search_public_species.max_results is null or search_public_species.max_results <= 0 then 15
      else least(search_public_species.max_results, 15) + 5
    end
  ) with ordinality as r (
    id, scientific_name, genus_id, genus_name, type, status, matched_name, matched_name_type, ord
  )
  join public.species s on s.id = r.id
  where s.source <> 'user_proposal' or s.status = 'validated'
  order by r.ord
  limit case
    when search_public_species.max_results is null or search_public_species.max_results <= 0 then 10
    else least(search_public_species.max_results, 15)
  end;
end;

comment on function public.search_public_species(text, integer) is
  'Catálogo público: busca especies públicas por nombre científico, sinónimo o nombre común, como search_species() (tildes, signo de híbrido, abreviaturas y errores de tipeo), sin el estado. Hasta 15 resultados. La pueden llamar anon y authenticated.';

revoke all on function public.search_public_species(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.search_public_species(text, integer) to anon, authenticated;

-- 2. Géneros con su número de especies ---------------------------------------------------------
--
-- Solo los géneros con al menos una especie pública (un género sin especies, como los que la
-- migración de abreviaturas crea para su abreviatura, no tiene nada que mostrar). Con el
-- catálogo real son unos 755: caben en 4 páginas de 200. Se cuenta en cada llamada (un recorrido
-- de species_public_genus_idx, unos 32 000 apuntes); está medido en supabase/README.md y no compensa
-- guardar los recuentos.

create function public.list_public_genera(page_size integer default 100, page_number integer default 1)
returns table (
  id uuid,
  name text,
  species_count bigint,
  total_count bigint,
  current_page integer
)
language sql
stable
security definer
set search_path = ''
rows 100
begin atomic
  with counts as (
    select s.genus_id, pg_catalog.count(*) as species_count
    from public.species s
    where s.source <> 'user_proposal' or s.status = 'validated'
    group by s.genus_id
  ),
  listed as (
    select g.id, g.name, c.species_count, public.normalize_search_text(g.name) collate "C" as sort_name
    from counts c
    join public.genera g on g.id = c.genus_id
  ),
  paging as materialized (
    select t.total, z.size,
      least(
        greatest(coalesce(list_public_genera.page_number, 1), 1),
        (t.total - 1) / z.size + 1
      )::integer as page
    from (select pg_catalog.count(*) as total from listed) t
    cross join (
      select case
        when list_public_genera.page_size is null or list_public_genera.page_size <= 0 then 100
        else least(list_public_genera.page_size, 200)
      end as size
    ) z
    where t.total > 0
  )
  select l.id, l.name, l.species_count, p.total, p.page
  from paging p
  cross join lateral (
    select x.id, x.name, x.species_count, x.sort_name
    from listed x
    order by x.sort_name, x.id
    offset (p.page - 1) * p.size
    limit p.size
  ) l
  order by l.sort_name, l.id;
end;

comment on function public.list_public_genera(integer, integer) is
  'Catálogo público: los géneros con especies públicas y su número, en orden alfabético, paginados (100 por página, 200 como máximo) y con el total. La pueden llamar anon y authenticated.';

revoke all on function public.list_public_genera(integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_public_genera(integer, integer) to anon, authenticated;

-- 3. Especies de un género ---------------------------------------------------------------------
--
-- Un género que no existe o sin especies públicas no devuelve filas. genus_name va en cada fila
-- para que la pantalla pinte la cabecera sin otra petición. Las páginas se leen del índice
-- species_public_genus_name_idx en orden, con offset.

create function public.list_public_genus_species(
  target_genus_id uuid,
  page_size integer default 50,
  page_number integer default 1
)
returns table (
  id uuid,
  scientific_name text,
  type public.species_type,
  genus_id uuid,
  genus_name text,
  total_count bigint,
  current_page integer
)
language sql
stable
security definer
set search_path = ''
rows 50
begin atomic
  with paging as materialized (
    select t.total, z.size,
      least(
        greatest(coalesce(list_public_genus_species.page_number, 1), 1),
        (t.total - 1) / z.size + 1
      )::integer as page
    from (
      select pg_catalog.count(*) as total
      from public.species s
      where s.genus_id = list_public_genus_species.target_genus_id
        and (s.source <> 'user_proposal' or s.status = 'validated')
    ) t
    cross join (
      select case
        when list_public_genus_species.page_size is null or list_public_genus_species.page_size <= 0 then 50
        else least(list_public_genus_species.page_size, 100)
      end as size
    ) z
    where t.total > 0
  )
  -- La subconsulta lee la página en el orden del índice; fuera se vuelven a ordenar sus filas,
  -- porque el join con genera no garantiza el orden.
  select x.id, x.scientific_name, x.type, g.id, g.name, p.total, p.page
  from paging p
  cross join lateral (
    select s.id, s.scientific_name, s.type
    from public.species s
    where s.genus_id = list_public_genus_species.target_genus_id
      and (s.source <> 'user_proposal' or s.status = 'validated')
    order by public.normalize_search_text(s.scientific_name) collate "C", s.id
    offset (p.page - 1) * p.size
    limit p.size
  ) x
  join public.genera g on g.id = list_public_genus_species.target_genus_id
  order by public.normalize_search_text(x.scientific_name) collate "C", x.id;
end;

comment on function public.list_public_genus_species(uuid, integer, integer) is
  'Catálogo público: las especies públicas de un género, en orden alfabético, paginadas (50 por página, 100 como máximo) y con el total. La pueden llamar anon y authenticated.';

revoke all on function public.list_public_genus_species(uuid, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_public_genus_species(uuid, integer, integer) to anon, authenticated;

-- 4. Ficha de una especie ----------------------------------------------------------------------
--
-- Una fila, o ninguna si la especie no existe o no es pública (sin distinguir los dos casos).
-- source_ref solo se devuelve para las fuentes externas (col, gbif), porque es lo que permite
-- enlazar la ficha de la fuente para la atribución (COL: https://www.catalogueoflife.org/data/
-- taxon/<source_ref>); en la lista curada es un identificador interno de la carga. Los nombres
-- van en el orden de la búsqueda (normalizado, intercalación "C"), hasta 100 de cada tipo, con
-- el total para poder decir "y N más". common_names es un arreglo de {name, language}.

create function public.get_public_species(target_species_id uuid)
returns table (
  id uuid,
  scientific_name text,
  genus_id uuid,
  genus_name text,
  type public.species_type,
  source public.species_source,
  source_ref text,
  synonyms text[],
  synonym_count bigint,
  common_names jsonb,
  common_name_count bigint
)
language sql
stable
security definer
set search_path = ''
rows 1
begin atomic
  select
    s.id,
    s.scientific_name,
    g.id,
    g.name,
    s.type,
    s.source,
    case when s.source in ('col', 'gbif') then s.source_ref end,
    coalesce(
      (select pg_catalog.array_agg(n.name order by n.sort_name, n.name)
         from (
           select sn.name, public.normalize_search_text(sn.name) collate "C" as sort_name
           from public.species_names sn
           where sn.species_id = s.id and sn.type = 'synonym'
           order by 2, 1
           limit 100
         ) n),
      '{}'
    ),
    (select pg_catalog.count(*) from public.species_names sn where sn.species_id = s.id and sn.type = 'synonym'),
    coalesce(
      (select pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object('name', n.name, 'language', n.language)
                order by n.sort_name, n.name)
         from (
           select sn.name, sn.language, public.normalize_search_text(sn.name) collate "C" as sort_name
           from public.species_names sn
           where sn.species_id = s.id and sn.type = 'common'
           order by 3, 1
           limit 100
         ) n),
      '[]'::jsonb
    ),
    (select pg_catalog.count(*) from public.species_names sn where sn.species_id = s.id and sn.type = 'common')
  from public.species s
  join public.genera g on g.id = s.genus_id
  where s.id = get_public_species.target_species_id
    and (s.source <> 'user_proposal' or s.status = 'validated');
end;

comment on function public.get_public_species(uuid) is
  'Catálogo público: ficha de una especie pública (nombre, género, tipo, fuente para la atribución, sinónimos y nombres comunes). Ninguna fila si no existe o no es pública. La pueden llamar anon y authenticated.';

revoke all on function public.get_public_species(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_public_species(uuid) to anon, authenticated;
