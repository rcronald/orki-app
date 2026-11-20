-- Catálogo de orquídeas: géneros, abreviaturas de género, especies y nombres alternativos
-- (issue #47, parte del esquema de #4).
--
-- El catálogo es de lectura pública: cualquiera, también sin sesión, puede leerlo, porque lo
-- necesitan la búsqueda (#7) y el registro. La escritura desde la API llega con las
-- políticas de administrador (#6); hasta entonces solo escriben las migraciones, los scripts
-- de importación (#8) con conexión directa o con la clave de servicio, y nadie más.
--
-- Nombres limpios y unicidad sin distinguir mayúsculas:
--   Los nombres del catálogo se guardan ya limpios: sin espacios al principio ni al final y
--   sin espacios repetidos por dentro (lo exige una restricción "check"). Así la unicidad
--   solo tiene que ignorar mayúsculas, con un índice único sobre lower(nombre). Se descarta
--   citext porque no ignora espacios y obliga a otra extensión, y una columna generada con
--   la clave normalizada porque duplica el dato y aparecería en la API sin aportar nada.
--   La búsqueda sin tildes y por trigramas (#7) añadirá sus propios índices de expresión
--   sobre estas mismas columnas de texto.

-- Enumerados ----------------------------------------------------------------------------

-- Tipo de especie del catálogo: especie botánica o híbrido.
create type public.species_type as enum ('species', 'hybrid');

-- Estado de una especie: importada (publicada sin revisar), validada por un administrador u
-- observada (un administrador vio algo que revisar).
create type public.species_status as enum ('imported', 'validated', 'observed');

-- Fuente de la especie: taxonomía de GBIF, lista curada a mano o propuesta de un usuario.
create type public.species_source as enum ('gbif', 'curated', 'user_proposal');

-- Tipo de nombre alternativo: sinónimo taxonómico o nombre común.
create type public.species_name_type as enum ('synonym', 'common');

-- Géneros -------------------------------------------------------------------------------

create table public.genera (
  id uuid primary key default gen_random_uuid(),
  -- Nombre del género, por ejemplo "Phalaenopsis".
  name text not null,
  -- Ruta de la foto característica, usada como fondo del registro (opcional; issue #10).
  photo_path text,
  -- Si aparece como chip de acceso rápido en el registro.
  is_quick_access boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint genera_name_clean check (
    name <> '' and name = regexp_replace(btrim(name), '\s+', ' ', 'g')
  ),
  constraint genera_photo_path_not_blank check (photo_path is null or btrim(photo_path) <> '')
);

comment on table public.genera is 'Géneros de orquídeas del catálogo.';

-- Un género por nombre, sin distinguir mayúsculas.
create unique index genera_name_key on public.genera (lower(name));

-- Abreviaturas de género ----------------------------------------------------------------

create table public.genus_abbreviations (
  id uuid primary key default gen_random_uuid(),
  -- Las abreviaturas pertenecen al género: si se borra el género (posible solo si no tiene
  -- especies), sus abreviaturas se van con él.
  genus_id uuid not null references public.genera (id) on delete cascade,
  -- Abreviatura tal como se escribe, con su punto, por ejemplo "Phal.".
  abbreviation text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint genus_abbreviations_abbreviation_clean check (
    abbreviation <> '' and abbreviation = regexp_replace(btrim(abbreviation), '\s+', ' ', 'g')
  )
);

comment on table public.genus_abbreviations is 'Abreviaturas habituales de cada género (por ejemplo Phal.).';

-- Una abreviatura identifica a un solo género, para que la búsqueda (#7) la resuelva sin
-- ambigüedad. Sin distinguir mayúsculas.
create unique index genus_abbreviations_abbreviation_key
  on public.genus_abbreviations (lower(abbreviation));

-- Abreviaturas de un género (y la clave foránea al borrar el género).
create index genus_abbreviations_genus_id_idx on public.genus_abbreviations (genus_id);

-- Especies ------------------------------------------------------------------------------

create table public.species (
  id uuid primary key default gen_random_uuid(),
  -- Nombre científico aceptado, sin autoría, por ejemplo "Phalaenopsis amabilis".
  scientific_name text not null,
  -- Un género con especies no se puede borrar.
  genus_id uuid not null references public.genera (id) on delete restrict,
  type public.species_type not null,
  status public.species_status not null,
  source public.species_source not null,
  -- Identificador del registro en su fuente (por ejemplo la clave de taxón de GBIF), para que
  -- la importación (#8) actualice sin duplicar. Texto, porque cada fuente tiene su formato.
  source_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint species_scientific_name_clean check (
    scientific_name <> ''
    and scientific_name = regexp_replace(btrim(scientific_name), '\s+', ' ', 'g')
  ),
  constraint species_source_ref_not_blank check (source_ref is null or btrim(source_ref) <> ''),
  -- Lo importado de GBIF siempre trae su clave: sin ella no se podría actualizar sin duplicar.
  constraint species_gbif_has_source_ref check (source <> 'gbif' or source_ref is not null),
  -- Cada registro de una fuente corresponde a una sola especie. Es una restricción (y no un
  -- índice parcial) para que la importación pueda usar "on conflict (source, source_ref)".
  -- Las especies sin referencia (null) no chocan entre sí.
  constraint species_source_ref_key unique (source, source_ref)
);

comment on table public.species is 'Especies e híbridos del catálogo.';

-- Un nombre científico por especie, sin distinguir mayúsculas.
create unique index species_scientific_name_key on public.species (lower(scientific_name));

-- Especies de un género (y la clave foránea al borrar el género).
create index species_genus_id_idx on public.species (genus_id);

-- Nombres alternativos ------------------------------------------------------------------

create table public.species_names (
  id uuid primary key default gen_random_uuid(),
  -- Al borrar una especie se borran sus nombres alternativos.
  species_id uuid not null references public.species (id) on delete cascade,
  name text not null,
  type public.species_name_type not null,
  -- Idioma del nombre (sobre todo de los nombres comunes), como etiqueta de idioma corta:
  -- "es", "en", "spa" o "pt-BR". Opcional.
  language text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint species_names_name_clean check (
    name <> '' and name = regexp_replace(btrim(name), '\s+', ' ', 'g')
  ),
  constraint species_names_language_format check (
    language is null or language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
  )
);

comment on table public.species_names is 'Nombres alternativos de una especie: sinónimos y nombres comunes.';

-- Un mismo nombre una sola vez por especie, sin distinguir mayúsculas ni el tipo de nombre.
-- El índice también sirve para la clave foránea (empieza por species_id).
create unique index species_names_species_id_name_key
  on public.species_names (species_id, lower(name));

-- Row Level Security y privilegios ------------------------------------------------------
--
-- Supabase ya no concede privilegios por defecto a anon, authenticated y service_role sobre
-- las tablas nuevas de "public" (antes concedía todos, incluido truncate, que ignora RLS).
-- Para que el resultado no dependa de la configuración del proyecto, se retiran todos y se
-- conceden solo los necesarios: lectura para todos y escritura para la clave de servicio,
-- que se usa solo en el servidor y en scripts. La escritura de administradores llega en #6.

alter table public.genera enable row level security;
alter table public.genus_abbreviations enable row level security;
alter table public.species enable row level security;
alter table public.species_names enable row level security;

revoke all on table public.genera, public.genus_abbreviations, public.species, public.species_names
  from anon, authenticated, service_role;

grant select on table public.genera, public.genus_abbreviations, public.species, public.species_names
  to anon, authenticated;

grant select, insert, update, delete
  on table public.genera, public.genus_abbreviations, public.species, public.species_names
  to service_role;

create policy genera_select_all on public.genera
  for select to anon, authenticated using (true);

create policy genus_abbreviations_select_all on public.genus_abbreviations
  for select to anon, authenticated using (true);

create policy species_select_all on public.species
  for select to anon, authenticated using (true);

create policy species_names_select_all on public.species_names
  for select to anon, authenticated using (true);

-- Datos de referencia -------------------------------------------------------------------
--
-- Los cinco géneros de acceso rápido del registro y su abreviatura estándar. Las
-- abreviaturas son las de la Royal Horticultural Society, autoridad internacional de registro
-- de híbridos de orquídeas: "Alphabetical list of standard abbreviations for natural and
-- hybrid generic names" (RHS, 2017),
-- https://www.rhs.org.uk/plants/pdfs/plant-registration-forms/orchid-name-abbreviations-list.pdf
--   Phalaenopsis = Phal., Cattleya = C., Dendrobium = Den., Oncidium = Onc., Vanda = V.
--
-- Idempotente: volver a ejecutarlo no duplica nada; si el género ya existía, solo lo marca
-- como de acceso rápido.

insert into public.genera (name, is_quick_access)
values
  ('Phalaenopsis', true),
  ('Cattleya', true),
  ('Dendrobium', true),
  ('Oncidium', true),
  ('Vanda', true)
on conflict ((lower(name))) do update set is_quick_access = true;

insert into public.genus_abbreviations (genus_id, abbreviation)
select g.id, a.abbreviation
from (
  values
    ('Phalaenopsis', 'Phal.'),
    ('Cattleya', 'C.'),
    ('Dendrobium', 'Den.'),
    ('Oncidium', 'Onc.'),
    ('Vanda', 'V.')
) as a (genus_name, abbreviation)
join public.genera g on lower(g.name) = lower(a.genus_name)
on conflict ((lower(abbreviation))) do nothing;
