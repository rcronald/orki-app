-- Fotos de referencia de las especies (issue #234, parte de #180): esquema, bucket, lectura,
-- retirada y fusiones. La carga que las obtiene de iNaturalist es otro encargo; aquí se fija el
-- contrato que debe cumplir (ver supabase/README.md, «Fotos de referencia»).
--
-- Esta migración:
--   1. Crea el enumerado public.species_photo_source (hoy solo 'inaturalist').
--   2. Crea public.species_photos: una foto de referencia por especie, copiada a nuestro
--      almacenamiento en dos tamaños WebP, con su origen, licencia y atribución.
--   3. Crea public.species_photo_rejections: la memoria de las fotos que un administrador
--      retiró de una especie, para que la carga no las vuelva a poner.
--   4. Crea el bucket público species-photos de Storage.
--   5. Amplía tres funciones del catálogo público (search_public_species,
--      list_public_genus_species y get_public_species) con la foto, en una columna nueva al
--      final.
--   6. Crea la función de administrador public.retire_species_photo().
--   7. Cambia public.merge_species() para que la foto no se pierda en una fusión.
--
-- Decisiones del responsable (#180, comentario del 23 de noviembre de 2026)
-- -------------------------------------------------------------------------
--   - Licencias aceptadas: CC0, dominio público, CC BY y CC BY-SA, con los códigos de
--     iNaturalist (license_code de la API: 'cc0', 'cc-by', 'cc-by-sa'; 'pd' para dominio
--     público, ver docs/inaturalist.md). Ninguna otra puede guardarse: lo impide la restricción
--     species_photos_license_accepted, no solo la carga.
--   - Las imágenes se copian (no se enlazan): una versión media (unos 500 px) y una miniatura
--     (unos 160 px), en WebP. La reducción es una modificación: is_modified lo dice para que la
--     atribución lo indique («adaptada»).
--   - Una foto de referencia por especie, por ahora; siempre se muestra como «foto de
--     referencia», con su autor y su licencia.
--   - El administrador del catálogo puede retirar la foto de una especie, y esa especie no debe
--     volver a recibir la misma foto.
--
-- Modelo
-- ------
-- species_photos tiene su propio id y una restricción única sobre species_id (una por especie).
-- Se descartó usar species_id como clave primaria: el día que haya varias fotos por especie
-- basta con cambiar la restricción única por una posición, como en plant_photos, sin cambiar la
-- clave. Con la restricción única, PostgREST ve la relación como uno a uno y un embebido
-- (species(..., species_photos(...))) devuelve un objeto, no un arreglo.
--
-- Licencia como texto con check y no como enumerado: un valor de enumerado no se puede quitar
-- (si un día se deja de aceptar CC BY-SA, habría que recrear el tipo), y la restricción da un
-- error con nombre (23514, species_photos_license_accepted) en lugar de un error de sintaxis
-- del valor. Los tipos de TypeScript lo precisan en apps/web/src/lib/database.ts.
--
-- La fuente sí es enumerado (species_photo_source), como species_source: es una lista que solo
-- crece, y el día que haya otra fuente sus identificadores tendrán otro formato (las
-- restricciones de formato van por fuente).
--
-- Atribución: author_name es el autor tal como hay que nombrarlo («Ana Pérez»: attribution_name
-- de iNaturalist o, en las fotos de observaciones, el nombre o el usuario del observador);
-- attribution es el texto completo que da la fuente o construye la carga («© Ana Pérez, some
-- rights reserved (CC BY)»). Los dos son obligatorios y no pueden estar en blanco, también con
-- CC0 y dominio público (que no exigen atribución, pero el conjunto abierto de iNaturalist pide
-- darla igual): así no puede existir una foto sin atribución.
--
-- Origen: source_photo_id (id de la foto en iNaturalist), source_observation_id (si salió de
-- una observación), source_taxon_id (el taxón de iNaturalist emparejado), source_selection
-- (cómo la eligió la carga: la foto por defecto del taxón, otra foto del taxón o una de
-- observación; las de observación conviene revisarlas, ver docs/inaturalist.md) y source_url,
-- la página de la foto (https://www.inaturalist.org/photos/<id>, comprobado por la restricción).
-- obtained_at es cuándo la obtuvo la carga (la licencia puede cambiar después en el origen:
-- una licencia CC no se revoca para lo ya obtenido, pero conviene saber la fecha).
--
-- Rutas en el bucket species-photos (sin el nombre del bucket):
--   <id de la especie>/medium-<id de la foto en la fuente>.webp
--   <id de la especie>/thumb-<id de la foto en la fuente>.webp
-- La restricción exige un uuid como carpeta, un nombre de archivo sin subcarpetas terminado en
-- .webp, la misma carpeta para los dos y dos rutas distintas. No exige que la carpeta sea el id
-- de la especie de la fila: tras una fusión, la foto de la absorbida puede pasar a la conservada
-- con sus rutas (ver «Fusiones»). El nombre lleva el id de la foto para que una foto nueva tenga
-- otra URL y ninguna caché sirva la anterior. Ningún dato personal: solo ids del catálogo y de la
-- fuente.
--
-- Fotos retiradas: tabla aparte y no una marca
-- --------------------------------------------
-- public.species_photo_rejections guarda una fila por (especie, fuente, id de la foto) retirada,
-- con el motivo, quién y cuándo, y la acción de la auditoría. Retirar es borrar la fila de
-- species_photos y anotar la retirada, en una transacción (retire_species_photo()).
--   - Se descartó una marca «retirada» en species_photos: la fila seguiría ocupando el único
--     sitio de la especie (la carga no podría proponer otra foto sin borrarla, perdiendo la
--     memoria), todas las lecturas tendrían que filtrarla y una especie solo recordaría una
--     retirada. Con la tabla aparte se recuerdan todas las retiradas de cada especie y la foto
--     actual es simplemente la que hay.
--   - La base lo garantiza: el disparador check_not_rejected de species_photos rechaza con
--     23514 (species_photos_not_rejected) insertar o cambiar una fila con una foto retirada de
--     esa especie, también a la carga, que escribe como postgres. Una foto distinta sí se
--     acepta: es como se propone otra.
--   - Por especie y no global: una foto mal identificada puede ser buena para otra especie. Si
--     el autor pide que no se use una foto suya («author_request»), la carga debe dejar de
--     usarla en todas: es una regla de la carga (no la impone la base), documentada.
--   - Si se borra la especie, su memoria se va con ella (cascada), como la de las fusiones.
--
-- Bucket species-photos
-- ---------------------
-- Público (public = true): son imágenes con licencia abierta que se muestran a visitantes sin
-- sesión, y un bucket público las sirve por /storage/v1/object/public/species-photos/<ruta> sin
-- firmar URL ni pasar por las políticas, con la caché del CDN. Lo que expone: cualquiera que
-- conozca una ruta descarga ese archivo, también el de una especie no pública; las rutas llevan
-- uuids que solo dan las funciones públicas, y las imágenes son públicas en origen. No se crea
-- ninguna política de storage.objects para este bucket: sin política de select nadie puede
-- listarlo por la API (ni anon ni authenticated), y sin políticas de escritura solo escribe la
-- clave de servicio (service_role se salta RLS), que es lo que usa la carga. Tope de 256 KiB
-- por archivo (el medio en WebP ronda los 60 KB, la miniatura los 10 KB) y solo image/webp.
--
-- Lectura
-- -------
--   - Sin sesión (y con sesión): las funciones del catálogo público devuelven la foto de las
--     especies públicas en una columna nueva al final, nula si no hay foto: reference_photo en la
--     ficha (get_public_species: los dos tamaños, medidas, autor, atribución, licencia, fuente,
--     enlace, observación y si está adaptada) y reference_thumbnail en la búsqueda y en las
--     especies de un género (solo la miniatura con autor, licencia y enlace, para que una página
--     de 50 no lleve 50 objetos completos). Van como jsonb para añadir una sola columna por
--     función: el código que ya las usa ignora un campo más. Una especie no pública no sale en
--     ninguna, así que tampoco su foto. Las tres hay que borrarlas y crearlas otra vez (cambia su
--     tipo de resultado); PostgREST recarga su caché de esquema al terminar la migración y el
--     JSON de respuesta solo gana un campo.
--   - Con sesión: authenticated lee species_photos entera (como el resto del catálogo, que ya lee
--     también las especies no públicas). Así la app pide la foto de la especie que se eligió en el
--     registro con una consulta por clave, o la embebe en la consulta que ya hace (el detalle de
--     una planta: species(..., species_photos(...))) sin añadir ninguna. No se amplió
--     search_species(): es la función más delicada del catálogo (etapas, plan genérico, pruebas
--     contra una referencia), search_public_species() depende de ella y habría que recrear las
--     dos; y el registro solo muestra la foto al elegir la especie (decisión del #180), no en cada
--     sugerencia. Si un día se quieren miniaturas en las sugerencias, es una consulta por lote
--     (species_id=in.(...)) por respuesta, medida en supabase/README.md.
--   - Escritura: nadie por la API, salvo el administrador para retirar (retire_species_photo()).
--     La carga escribe con conexión directa como postgres (como la del catálogo) o con la clave
--     de servicio; service_role puede leer y escribir species_photos y solo leer las retiradas.
--
-- Auditoría
-- ---------
-- species_photos no lleva el disparador audit_change: nadie de la API la escribe, y la carga no
-- trae token (el disparador no registraría nada). Cada carga deja una fila catalog_import de
-- resumen (contrato en supabase/README.md). La retirada sí se audita: retire_species_photo()
-- registra la acción retire_species_photo con la especie como objetivo (sale en su historial).
-- La fusión anota en sus detalles qué pasó con las fotos (reference_photo).
--
-- Fusiones (merge_species)
-- ------------------------
--   - La foto de la conservada nunca se toca.
--   - Si la conservada no tiene foto y la absorbida sí, la de la absorbida pasa a la conservada
--     (se mueve la fila, con sus rutas: los archivos no se mueven), salvo que esa foto esté
--     retirada para la conservada. Es una foto de la misma especie (eso es lo que dice la
--     fusión) y ahorra volver a obtenerla.
--   - Si las dos tienen foto, la de la absorbida se borra con ella (cascada) y sus archivos
--     quedan huérfanos en el bucket hasta que la carga o un script los limpie.
--   - Las retiradas de la absorbida pasan a la conservada (sin repetir las que ya tenía): una
--     foto inapropiada o mal identificada para la absorbida también lo es para la conservada.
--   - Los detalles de la acción merge_species llevan reference_photo con outcome (moved,
--     discarded o null si la absorbida no tenía foto), las dos fotos (merged_source_photo_id,
--     kept_source_photo_id) y moved_rejection_count. El resultado y la vista previa no cambian de
--     forma.
--
-- Concurrencia
-- ------------
-- retire_species_photo() bloquea la especie «for update» y después la foto. El disparador de
-- species_photos bloquea la especie «for key share» antes de mirar las retiradas: una retirada
-- y una carga que escribe la foto de esa especie se hacen una detrás de otra, y la carga ve la
-- retirada confirmada (y la rechaza) o la retirada ve la foto nueva (y, si no es la que el
-- administrador quería retirar, avisa con species_photo_not_found). «for key share» no frena
-- las ediciones de la especie (no cambian su clave), sí su fusión y su baja mientras dura la
-- transacción de la carga.

-- 1. Fuente ------------------------------------------------------------------------------------

create type public.species_photo_source as enum ('inaturalist');

-- 2. Fotos de referencia -----------------------------------------------------------------------

create table public.species_photos (
  id uuid primary key default gen_random_uuid(),
  -- La especie; al borrarla se borra su foto (los archivos quedan para la limpieza).
  species_id uuid not null references public.species (id) on delete cascade,
  -- Las dos versiones en el bucket species-photos, sin el nombre del bucket, y sus medidas en
  -- píxeles.
  medium_path text not null,
  medium_width integer not null,
  medium_height integer not null,
  thumbnail_path text not null,
  thumbnail_width integer not null,
  thumbnail_height integer not null,
  -- De dónde viene.
  source public.species_photo_source not null,
  source_photo_id text not null,
  source_observation_id text,
  source_taxon_id text,
  source_selection text,
  -- La página de la foto en la fuente: el enlace de la atribución.
  source_url text not null,
  -- Licencia (lista cerrada) y atribución tal como hay que mostrarla.
  license text not null,
  author_name text not null,
  attribution text not null,
  -- Si la imagen guardada es una adaptación (reducida y convertida a WebP): siempre, hoy.
  is_modified boolean not null default true,
  -- Cuándo la obtuvo la carga de la fuente.
  obtained_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint species_photos_species_id_key unique (species_id),
  constraint species_photos_license_accepted check (license in ('cc0', 'pd', 'cc-by', 'cc-by-sa')),
  constraint species_photos_author_name_valid check (
    pg_catalog.btrim(author_name) <> '' and pg_catalog.char_length(author_name) <= 200
  ),
  constraint species_photos_attribution_valid check (
    pg_catalog.btrim(attribution) <> '' and pg_catalog.char_length(attribution) <= 500
  ),
  -- Identificadores de iNaturalist: enteros positivos, como texto.
  constraint species_photos_source_ids_valid check (
    case source
      when 'inaturalist' then
        source_photo_id ~ '^[1-9][0-9]{0,18}$'
        and (source_observation_id is null or source_observation_id ~ '^[1-9][0-9]{0,18}$')
        and (source_taxon_id is null or source_taxon_id ~ '^[1-9][0-9]{0,18}$')
      else false
    end
  ),
  constraint species_photos_source_url_valid check (
    case source
      when 'inaturalist' then source_url = 'https://www.inaturalist.org/photos/' || source_photo_id
      else false
    end
  ),
  constraint species_photos_source_selection_valid check (
    source_selection is null
    or (source_selection in ('taxon_default', 'taxon_photo', 'observation')
        and (source_selection <> 'observation' or source_observation_id is not null))
  ),
  constraint species_photos_medium_path_valid check (
    pg_catalog.char_length(medium_path) <= 300
    and medium_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]*\.webp$'
  ),
  constraint species_photos_thumbnail_path_valid check (
    pg_catalog.char_length(thumbnail_path) <= 300
    and thumbnail_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]*\.webp$'
  ),
  constraint species_photos_paths_same_folder check (
    pg_catalog.split_part(medium_path, '/', 1) = pg_catalog.split_part(thumbnail_path, '/', 1)
    and medium_path <> thumbnail_path
  ),
  -- Unos 500 px el medio y unos 160 la miniatura: los topes dejan margen sin admitir un
  -- original sin reducir.
  constraint species_photos_medium_size_valid check (
    medium_width between 1 and 1024 and medium_height between 1 and 1024
  ),
  constraint species_photos_thumbnail_size_valid check (
    thumbnail_width between 1 and 320 and thumbnail_height between 1 and 320
  )
);

comment on table public.species_photos is
  'Fotos de referencia de las especies (una por especie), copiadas de la fuente en dos tamaños WebP, con su licencia y atribución. Las escribe la carga; el administrador solo las retira.';

alter table public.species_photos enable row level security;

revoke all on table public.species_photos from public, anon, authenticated, service_role;
grant select on table public.species_photos to authenticated;
grant select, insert, update, delete on table public.species_photos to service_role;

create policy species_photos_select_all on public.species_photos
  for select to authenticated
  using (true);

create trigger set_updated_at before update on public.species_photos
  for each row execute function private.set_updated_at();

-- 3. Fotos retiradas ---------------------------------------------------------------------------

create table public.species_photo_rejections (
  -- La especie de la que se retiró. Si se borra, la memoria se va con ella.
  species_id uuid not null references public.species (id) on delete cascade,
  -- La foto retirada, por su identificador en la fuente.
  source public.species_photo_source not null,
  source_photo_id text not null,
  -- Para leer la memoria sin la auditoría: la página de la foto y su autor.
  source_url text not null,
  author_name text not null,
  -- Por qué: mal identificada, inapropiada, a petición del autor u otro motivo.
  reason text not null,
  -- Quién (id de Clerk) y cuándo, y la acción retire_species_photo de la auditoría.
  rejected_by text not null,
  rejected_at timestamptz not null default now(),
  action_id uuid not null,
  primary key (species_id, source, source_photo_id),
  constraint species_photo_rejections_reason_valid check (
    reason in ('misidentified', 'inappropriate', 'author_request', 'other')
  ),
  constraint species_photo_rejections_rejected_by_not_blank check (pg_catalog.btrim(rejected_by) <> '')
);

comment on table public.species_photo_rejections is
  'Memoria de las fotos de referencia retiradas por un administrador, por especie, para que la carga no las vuelva a poner. Solo la leen los administradores; la escribe retire_species_photo().';

alter table public.species_photo_rejections enable row level security;

revoke all on table public.species_photo_rejections from public, anon, authenticated, service_role;
grant select on table public.species_photo_rejections to authenticated, service_role;

create policy species_photo_rejections_select_catalog_admin on public.species_photo_rejections
  for select to authenticated
  using ((select public.is_catalog_admin()));

-- Disparador: una foto retirada no vuelve ----------------------------------------------------
--
-- before insert or update en species_photos. Bloquea la especie «for key share» (ver
-- «Concurrencia») y rechaza la fila si su foto está retirada para esa especie. Lo ejecutan quien
-- escribe species_photos (postgres, service_role y merge_species(), que corre como postgres),
-- que pueden leer las retiradas; por eso no necesita security definer.

create function private.check_species_photo_not_rejected()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform from public.species s where s.id = new.species_id for key share;

  if exists (
    select
    from public.species_photo_rejections r
    where r.species_id = new.species_id
      and r.source = new.source
      and r.source_photo_id = new.source_photo_id
  ) then
    raise exception 'Esta foto se retiró de la especie y no puede volver a ponerse.'
      using errcode = '23514',
            constraint = 'species_photos_not_rejected',
            detail = pg_catalog.jsonb_build_object(
              'reason', 'species_photo_rejected',
              'species_id', new.species_id,
              'source', new.source,
              'source_photo_id', new.source_photo_id
            )::text;
  end if;
  return new;
end;
$$;

comment on function private.check_species_photo_not_rejected() is
  'Fotos de referencia: rechaza una foto que un administrador retiró de esa especie.';

revoke all on function private.check_species_photo_not_rejected() from public;

create trigger check_not_rejected before insert or update on public.species_photos
  for each row execute function private.check_species_photo_not_rejected();

-- 4. Bucket ------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('species-photos', 'species-photos', true, 262144, array['image/webp'])
on conflict (id) do update
  set name = excluded.name,
      public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 5. Catálogo público con la foto ---------------------------------------------------------------
--
-- Las mismas funciones de la migración 20261122150000_catalogo_publico.sql, con una columna más
-- al final; el resto del cuerpo no cambia. Siguen el patrón de lectura pública del catálogo
-- (tests/soporte/ayudantes.sql admite ahora species_photos entre sus dependencias).

drop function public.search_public_species(text, integer);

create function public.search_public_species(query text, max_results integer default 10)
returns table (
  id uuid,
  scientific_name text,
  genus_id uuid,
  genus_name text,
  type public.species_type,
  matched_name text,
  matched_name_type public.species_match_type,
  reference_thumbnail jsonb
)
language sql
stable
security definer
set search_path = ''
rows 15
begin atomic
  select r.id, r.scientific_name, r.genus_id, r.genus_name, r.type, r.matched_name, r.matched_name_type,
    case when p.id is not null then
      pg_catalog.jsonb_build_object(
        'thumbnail_path', p.thumbnail_path,
        'thumbnail_width', p.thumbnail_width,
        'thumbnail_height', p.thumbnail_height,
        'author_name', p.author_name,
        'license', p.license,
        'source', p.source,
        'source_url', p.source_url,
        'is_modified', p.is_modified
      )
    end
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
  left join public.species_photos p on p.species_id = r.id
  where s.source <> 'user_proposal' or s.status = 'validated'
  order by r.ord
  limit case
    when search_public_species.max_results is null or search_public_species.max_results <= 0 then 10
    else least(search_public_species.max_results, 15)
  end;
end;

comment on function public.search_public_species(text, integer) is
  'Catálogo público: busca especies públicas por nombre científico, sinónimo o nombre común, como search_species() (tildes, signo de híbrido, abreviaturas y errores de tipeo), sin el estado, con la miniatura de referencia si la hay. Hasta 15 resultados. La pueden llamar anon y authenticated.';

revoke all on function public.search_public_species(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.search_public_species(text, integer) to anon, authenticated;

drop function public.list_public_genus_species(uuid, integer, integer);

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
  current_page integer,
  reference_thumbnail jsonb
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
  -- porque los joins no garantizan el orden. La foto se busca solo para las filas de la página.
  select x.id, x.scientific_name, x.type, g.id, g.name, p.total, p.page,
    case when f.id is not null then
      pg_catalog.jsonb_build_object(
        'thumbnail_path', f.thumbnail_path,
        'thumbnail_width', f.thumbnail_width,
        'thumbnail_height', f.thumbnail_height,
        'author_name', f.author_name,
        'license', f.license,
        'source', f.source,
        'source_url', f.source_url,
        'is_modified', f.is_modified
      )
    end
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
  left join public.species_photos f on f.species_id = x.id
  order by public.normalize_search_text(x.scientific_name) collate "C", x.id;
end;

comment on function public.list_public_genus_species(uuid, integer, integer) is
  'Catálogo público: las especies públicas de un género, en orden alfabético, paginadas (50 por página, 100 como máximo), con el total y la miniatura de referencia si la hay. La pueden llamar anon y authenticated.';

revoke all on function public.list_public_genus_species(uuid, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_public_genus_species(uuid, integer, integer) to anon, authenticated;

drop function public.get_public_species(uuid);

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
  common_name_count bigint,
  reference_photo jsonb
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
    (select pg_catalog.count(*) from public.species_names sn where sn.species_id = s.id and sn.type = 'common'),
    (select pg_catalog.jsonb_build_object(
              'medium_path', f.medium_path,
              'medium_width', f.medium_width,
              'medium_height', f.medium_height,
              'thumbnail_path', f.thumbnail_path,
              'thumbnail_width', f.thumbnail_width,
              'thumbnail_height', f.thumbnail_height,
              'author_name', f.author_name,
              'attribution', f.attribution,
              'license', f.license,
              'source', f.source,
              'source_url', f.source_url,
              'source_observation_id', f.source_observation_id,
              'is_modified', f.is_modified,
              'obtained_at', f.obtained_at
            )
       from public.species_photos f
       where f.species_id = s.id)
  from public.species s
  join public.genera g on g.id = s.genus_id
  where s.id = get_public_species.target_species_id
    and (s.source <> 'user_proposal' or s.status = 'validated');
end;

comment on function public.get_public_species(uuid) is
  'Catálogo público: ficha de una especie pública (nombre, género, tipo, fuente para la atribución, sinónimos, nombres comunes y foto de referencia con su autor y licencia). Ninguna fila si no existe o no es pública. La pueden llamar anon y authenticated.';

revoke all on function public.get_public_species(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_public_species(uuid) to anon, authenticated;

-- 6. Retirada ----------------------------------------------------------------------------------
--
-- public.retire_species_photo(target_species_id, target_source_photo_id, retire_reason)
--
-- Función de administrador. Retira la foto de referencia de una especie: registra la acción
-- retire_species_photo en la auditoría (con la especie como objetivo, así que sale en su
-- historial), borra la fila de species_photos y anota la retirada en species_photo_rejections,
-- en una transacción. target_source_photo_id es el id en la fuente de la foto que vio el
-- administrador: si la especie ya no tiene foto o tiene otra (la carga la sustituyó, otro
-- administrador la retiró), no se toca nada y se avisa. Devuelve action_id y las rutas de los
-- dos archivos, que siguen en el bucket: los borra la carga o un script con la clave de servicio
-- (el administrador no puede escribir en el bucket).
--
-- retire_reason: misidentified (mal identificada), inappropriate (inapropiada), author_request
-- (a petición del autor) u other.
--
-- Errores (private.raise_catalog_error, como el resto del backoffice):
--   22023 reason_required          El motivo es nulo o no es uno de los cuatro.
--   P0002 species_photo_not_found  La especie no existe, no tiene foto o su foto no es
--                                  target_source_photo_id: species_id, source_photo_id y
--                                  current_source_photo_id (la que tiene ahora, o null).
--   42501                          Sin el rol de administrador (el guardián).

create function public.retire_species_photo(
  target_species_id uuid,
  target_source_photo_id text,
  retire_reason text
)
returns table (
  action_id uuid,
  medium_path text,
  thumbnail_path text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  photo public.species_photos;
  species_name text;
  new_action_id uuid;
begin
  perform private.require_catalog_admin();

  if retire_reason is null
     or retire_reason not in ('misidentified', 'inappropriate', 'author_request', 'other') then
    perform private.raise_catalog_error('22023', 'reason_required',
      'Elige por qué se retira la foto: mal identificada, inapropiada, a petición del autor u otro motivo.');
  end if;

  -- La especie primero (ver «Concurrencia»): una carga que escriba su foto espera o hace esperar.
  select s.scientific_name into species_name
    from public.species s
    where s.id = retire_species_photo.target_species_id
    for update;

  select p.* into photo
    from public.species_photos p
    where p.species_id = retire_species_photo.target_species_id
    for update;

  if species_name is null or photo.id is null
     or photo.source_photo_id is distinct from retire_species_photo.target_source_photo_id then
    perform private.raise_catalog_error('P0002', 'species_photo_not_found',
      'La foto de referencia de esta especie ya no es la que se quería retirar.',
      pg_catalog.jsonb_build_object(
        'species_id', retire_species_photo.target_species_id,
        'source_photo_id', retire_species_photo.target_source_photo_id,
        'current_source_photo_id', photo.source_photo_id
      ));
  end if;

  new_action_id := private.log_catalog_action(
    'retire_species_photo',
    pg_catalog.jsonb_build_object(
      'species_id', photo.species_id,
      'scientific_name', species_name,
      'reason', retire_reason,
      'source', photo.source,
      'source_photo_id', photo.source_photo_id,
      'source_url', photo.source_url,
      'license', photo.license,
      'author_name', photo.author_name,
      'medium_path', photo.medium_path,
      'thumbnail_path', photo.thumbnail_path
    ),
    'species',
    photo.species_id
  );

  delete from public.species_photos p where p.id = photo.id;

  insert into public.species_photo_rejections
    (species_id, source, source_photo_id, source_url, author_name, reason, rejected_by, action_id)
  values
    (photo.species_id, photo.source, photo.source_photo_id, photo.source_url, photo.author_name,
     retire_reason, public.requesting_user_id(), new_action_id)
  on conflict on constraint species_photo_rejections_pkey do nothing;

  return query select new_action_id, photo.medium_path, photo.thumbnail_path;
end;
$$;

comment on function public.retire_species_photo(uuid, text, text) is
  'Backoffice: retira la foto de referencia de una especie y recuerda que no debe volver; deja la acción en la auditoría. Función de administrador.';

revoke all on function public.retire_species_photo(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.retire_species_photo(uuid, text, text) to authenticated;

-- 7. Fusión con fotos --------------------------------------------------------------------------
--
-- public.merge_species() de la migración 20261121160000_fusion_de_especies.sql, igual salvo por
-- las fotos de referencia (ver «Fusiones» arriba): se calcula qué pasa con ellas antes de
-- escribir, va en los detalles de la acción (reference_photo) y se aplica antes de borrar la
-- absorbida. La firma y el resultado no cambian.

create or replace function public.merge_species(merged_species_id uuid, kept_species_id uuid)
returns table (
  action_id uuid,
  plant_count bigint,
  moved_name_count integer,
  skipped_name_count integer,
  kept_validated boolean,
  remembered_keys jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  merged_id uuid;
  kept_id uuid;
  merged public.species;
  kept public.species;
  plan jsonb;
  keys jsonb;
  moving_plants bigint;
  new_action_id uuid;
  who text;
  merged_photo public.species_photos;
  kept_photo public.species_photos;
  photo_outcome text;
  moving_rejections integer;
begin
  perform private.require_catalog_admin();

  merged_id := merge_species.merged_species_id;
  kept_id := merge_species.kept_species_id;
  if merged_id = kept_id then
    perform private.raise_catalog_error('22023', 'same_species',
      'Elige dos especies distintas: una especie no se puede fusionar consigo misma.');
  end if;

  -- Las dos a la vez y en orden de id: dos fusiones que comparten una especie no se
  -- interbloquean (ver "Concurrencia" en la migración de la fusión).
  perform from public.species s
    where s.id in (merged_id, kept_id)
    order by s.id
    for update;

  select s.* into merged from public.species s where s.id = merged_id;
  if not found then
    perform private.raise_catalog_error('P0002', 'species_not_found',
      'La especie que se absorbe ya no está en el catálogo.',
      pg_catalog.jsonb_build_object('species_id', merged_id, 'species_role', 'merged'));
  end if;
  select s.* into kept from public.species s where s.id = kept_id;
  if not found then
    perform private.raise_catalog_error('P0002', 'species_not_found',
      'La especie que se conserva ya no está en el catálogo.',
      pg_catalog.jsonb_build_object('species_id', kept_id, 'species_role', 'kept'));
  end if;

  -- Lo que se va a hacer, calculado antes de escribir nada.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p)), '[]'::jsonb) into plan
    from private.species_merge_plan(merged_id, kept_id) p;

  select coalesce(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object('source', r.source, 'source_ref', r.source_ref, 'inherited', r.inherited)
           order by r.inherited, r.source, r.source_ref collate "C"), '[]'::jsonb)
    into keys
    from (
      select merged.source, merged.source_ref, false as inherited
        where merged.source_ref is not null
      union all
      select k.source, k.source_ref, true
        from public.species_merge_keys k
        where k.species_id = merged_id
    ) r;

  -- Las plantas que se mueven, bloqueadas: nadie las desenlaza entre la cuenta y el cambio, y
  -- nadie puede enlazar otra a la absorbida mientras está bloqueada.
  select pg_catalog.count(*) into moving_plants
    from (select from public.plants p where p.species_id = merged_id for update) locked;

  -- Fotos de referencia: las dos filas bloqueadas, y qué pasará con la de la absorbida.
  select p.* into merged_photo from public.species_photos p where p.species_id = merged_id for update;
  select p.* into kept_photo from public.species_photos p where p.species_id = kept_id for update;
  photo_outcome := case
    when merged_photo.id is null then null
    when kept_photo.id is null
         and not exists (
           select from public.species_photo_rejections r
           where r.species_id = kept_id
             and r.source = merged_photo.source
             and r.source_photo_id = merged_photo.source_photo_id
         ) then 'moved'
    else 'discarded'
  end;
  select pg_catalog.count(*)::integer into moving_rejections
    from public.species_photo_rejections r
    where r.species_id = merged_id
      and not exists (
        select from public.species_photo_rejections k
        where k.species_id = kept_id and k.source = r.source and k.source_photo_id = r.source_photo_id
      );

  -- 1. La acción, antes de escribir: lo que sigue queda bajo ella.
  new_action_id := private.log_catalog_action(
    'merge_species',
    pg_catalog.jsonb_build_object(
      'merged_species_id', merged.id,
      'merged_scientific_name', merged.scientific_name,
      'merged_source', merged.source,
      'merged_source_ref', merged.source_ref,
      'kept_species_id', kept.id,
      'kept_scientific_name', kept.scientific_name,
      'plant_count', moving_plants,
      'moved_names', (select coalesce(pg_catalog.jsonb_agg(e -> 'name'), '[]'::jsonb)
                        from pg_catalog.jsonb_array_elements(plan) e
                        where (e ->> 'moves')::boolean),
      'skipped_names', (select coalesce(pg_catalog.jsonb_agg(e -> 'name'), '[]'::jsonb)
                          from pg_catalog.jsonb_array_elements(plan) e
                          where not (e ->> 'moves')::boolean),
      'kept_validated', kept.status = 'imported',
      'remembered_keys', keys,
      'reference_photo', pg_catalog.jsonb_build_object(
        'outcome', photo_outcome,
        'merged_source_photo_id', merged_photo.source_photo_id,
        'kept_source_photo_id', kept_photo.source_photo_id,
        'moved_rejection_count', moving_rejections
      )
    ),
    'species',
    kept.id
  );
  who := public.requesting_user_id();

  -- 2. Las plantas de todos los usuarios. sync_with_species les pone el género y el tipo de la
  --    conservada; entered_name no cambia.
  update public.plants p
    set species_id = kept_id
    where p.species_id = merged_id;

  -- 3. Los nombres que pasan: se mueve la fila (conserva id, tipo e idioma)...
  update public.species_names n
    set species_id = kept_id
    where n.species_id = merged_id
      and n.id in (
        select (e ->> 'name_id')::uuid
          from pg_catalog.jsonb_array_elements(plan) e
          where (e ->> 'moves')::boolean and e ->> 'name_id' is not null
      );

  -- ...y el nombre científico de la absorbida, como sinónimo, si no existía.
  insert into public.species_names (species_id, name, type, language)
  select kept_id, e ->> 'name', 'synonym', null
    from pg_catalog.jsonb_array_elements(plan) e
    where (e ->> 'moves')::boolean and e ->> 'origin' = 'scientific_name';

  -- 4. La conservada queda validada si era importada.
  update public.species s
    set status = 'validated'
    where s.id = kept_id and s.status = 'imported';

  -- 5. Memoria: las claves heredadas pasan a la conservada (antes de borrar la absorbida, que
  --    se las llevaría en cascada) y se guarda la clave propia de la absorbida.
  update public.species_merge_keys k
    set species_id = kept_id
    where k.species_id = merged_id;

  if merged.source_ref is not null then
    insert into public.species_merge_keys
      (source, source_ref, species_id, merged_species_id, merged_scientific_name, merged_by, action_id)
    values
      (merged.source, merged.source_ref, kept_id, merged.id, merged.scientific_name, who, new_action_id)
    on conflict (source, source_ref) do update
      set species_id = excluded.species_id,
          merged_species_id = excluded.merged_species_id,
          merged_scientific_name = excluded.merged_scientific_name,
          merged_by = excluded.merged_by,
          merged_at = excluded.merged_at,
          action_id = excluded.action_id;
  end if;

  -- 6. Fotos de referencia: las retiradas de la absorbida pasan a la conservada (las que ya
  --    tenía se quedan y las repetidas se van en cascada con la absorbida) y, si toca, su foto.
  update public.species_photo_rejections r
    set species_id = kept_id
    where r.species_id = merged_id
      and not exists (
        select from public.species_photo_rejections k
        where k.species_id = kept_id and k.source = r.source and k.source_photo_id = r.source_photo_id
      );

  if photo_outcome = 'moved' then
    update public.species_photos p
      set species_id = kept_id
      where p.id = merged_photo.id;
  end if;

  -- 7. La absorbida, con los nombres que no pasaron (y su foto, si no pasó).
  delete from public.species s where s.id = merged_id;

  return query
  select
    new_action_id,
    moving_plants,
    (select pg_catalog.count(*)::integer from pg_catalog.jsonb_array_elements(plan) e
       where (e ->> 'moves')::boolean),
    (select pg_catalog.count(*)::integer from pg_catalog.jsonb_array_elements(plan) e
       where not (e ->> 'moves')::boolean),
    kept.status = 'imported',
    keys;
end;
$$;

comment on function public.merge_species(uuid, uuid) is
  'Backoffice: fusiona una especie en otra (plantas, nombres, memoria de su clave, foto de referencia y fotos retiradas) y borra la absorbida, en una transacción. Función de administrador.';

revoke all on function public.merge_species(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.merge_species(uuid, uuid) to authenticated;
