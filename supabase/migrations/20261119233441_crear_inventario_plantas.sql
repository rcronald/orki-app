-- Inventario: perfiles de usuario y plantas (ejemplares) (issue #48, parte del esquema de #4).
--
-- El usuario se identifica con el id de Clerk, que es texto (por ejemplo "user_2abc..."), no
-- un UUID: Clerk está conectado a Supabase como proveedor externo y Postgres lee el usuario
-- del claim "sub" del token de sesión con auth.jwt() ->> 'sub'. No se usa Supabase Auth.
--
-- Las dos tablas nacen con Row Level Security activada y sin políticas ni privilegios para
-- anon y authenticated: hasta el issue #6 nadie puede leerlas ni escribirlas desde la API.

-- Enumerados ----------------------------------------------------------------------------

-- Tipo de la planta: como el de la especie, más "no sé" para quien no lo conoce.
create type public.plant_type as enum ('species', 'hybrid', 'unknown');

-- Estado del ejemplar en la colección: activa, perdida o regalada.
create type public.plant_status as enum ('active', 'lost', 'gifted');

-- Validación del nombre: validada (enlazada a una especie del catálogo), pendiente ("nombre
-- por validar", en la cola de propuestas) o no identificable (sale de la cola sin especie).
create type public.plant_validation as enum ('pending', 'validated', 'unidentifiable');

-- Color de flor del ejemplar (no de la especie: varía entre híbridos y clones).
create type public.flower_color as enum ('white', 'pink', 'purple', 'yellow', 'orange', 'bicolor');

-- Perfiles ------------------------------------------------------------------------------

create table public.profiles (
  -- Id de usuario de Clerk. Por defecto, el del token de sesión.
  id text primary key default (auth.jwt() ->> 'sub'),
  -- Idioma preferido, como código ISO 639-1. La lista de idiomas disponibles es cosa de la
  -- interfaz (en v1 solo español); aquí solo se exige el formato.
  preferred_language text not null default 'es',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_id_not_blank check (btrim(id) <> ''),
  constraint profiles_preferred_language_format check (preferred_language ~ '^[a-z]{2}$')
);

comment on table public.profiles is 'Perfil de cada usuario de Clerk. El correo y el rol viven en Clerk.';

-- Plantas -------------------------------------------------------------------------------

create table public.plants (
  id uuid primary key default gen_random_uuid(),
  -- Dueño de la planta: id de usuario de Clerk, por defecto el del token de sesión. Sin
  -- token (clave de servicio o conexión directa) hay que indicarlo explícitamente.
  user_id text not null default (auth.jwt() ->> 'sub'),
  -- Especie del catálogo, opcional. Una especie con plantas enlazadas no se puede borrar
  -- (la fusión de duplicados, #21, mueve antes las plantas).
  species_id uuid references public.species (id) on delete restrict,
  -- Nombre tal como lo ingresó el usuario; se conserva aunque la planta se enlace.
  entered_name text not null,
  -- Género y tipo: los que eligió el usuario mientras no hay especie; al enlazarla, los de
  -- la especie (los sincronizan los disparadores del issue #49).
  genus_id uuid not null references public.genera (id) on delete restrict,
  type public.plant_type not null,
  -- Fecha de adquisición. La app debe mandar la fecha local del usuario: el valor por
  -- defecto usa la zona horaria de la base de datos (UTC en Supabase).
  acquired_on date not null default current_date,
  -- Tienda o vivero de origen (texto libre, con autocompletado por usuario).
  origin text,
  status public.plant_status not null default 'active',
  validation public.plant_validation not null default 'pending',
  -- Dónde está el ejemplar en casa.
  location text,
  -- Apodo o etiqueta.
  nickname text,
  flower_color public.flower_color,
  -- Si la foto es en floración.
  photo_in_bloom boolean not null default false,
  -- Rutas de la foto y de su miniatura en el almacenamiento (issue #10).
  photo_path text,
  thumbnail_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Coherencia: validada si y solo si tiene especie enlazada.
  constraint plants_validated_iff_species check (
    (validation = 'validated') = (species_id is not null)
  ),
  constraint plants_user_id_not_blank check (btrim(user_id) <> ''),
  -- Los textos libres no pueden quedar en blanco (para "sin dato" está null) y tienen un
  -- tope: la app escribe directo a la API, así que la base de datos es la única barrera
  -- contra textos desmesurados.
  constraint plants_entered_name_valid check (
    btrim(entered_name) <> '' and char_length(entered_name) <= 200
  ),
  constraint plants_origin_valid check (
    origin is null or (btrim(origin) <> '' and char_length(origin) <= 120)
  ),
  constraint plants_location_valid check (
    location is null or (btrim(location) <> '' and char_length(location) <= 120)
  ),
  constraint plants_nickname_valid check (
    nickname is null or (btrim(nickname) <> '' and char_length(nickname) <= 120)
  ),
  constraint plants_photo_path_valid check (
    photo_path is null or (btrim(photo_path) <> '' and char_length(photo_path) <= 1024)
  ),
  constraint plants_thumbnail_path_valid check (
    thumbnail_path is null or (btrim(thumbnail_path) <> '' and char_length(thumbnail_path) <= 1024)
  ),
  -- La fecha de adquisición no puede ser futura. Se tolera un día porque current_date va en
  -- UTC y en zonas horarias por delante de UTC la fecha local ya puede ser la de mañana.
  constraint plants_acquired_on_not_future check (acquired_on <= current_date + 1)
);

comment on table public.plants is 'Ejemplares de la colección de cada usuario.';

-- Índices para las consultas previstas. Todos empiezan por user_id, así que cualquiera sirve
-- para "las plantas de un usuario".

-- "¿Ya la tengo?": plantas de un usuario de una especie.
create index plants_user_id_species_id_idx on public.plants (user_id, species_id);

-- Filtro por estado (activa, perdida, regalada).
create index plants_user_id_status_idx on public.plants (user_id, status);

-- Autocompletado y filtro por origen.
create index plants_user_id_origin_idx on public.plants (user_id, origin) where origin is not null;

-- Plantas de una especie, sin importar el usuario: la usan la comprobación de la clave
-- foránea al borrar una especie, la propagación de género y tipo (#49) y la fusión (#21).
create index plants_species_id_idx on public.plants (species_id) where species_id is not null;

-- Row Level Security y privilegios ------------------------------------------------------
--
-- Sin políticas, RLS no deja ver ni escribir ninguna fila. Además, anon y authenticated no
-- reciben ningún privilegio: el issue #6 concederá a authenticated los que necesite junto con
-- sus políticas. La clave de servicio (solo servidor y scripts) sí puede leer y escribir.

alter table public.profiles enable row level security;
alter table public.plants enable row level security;

revoke all on table public.profiles, public.plants from anon, authenticated, service_role;

grant select, insert, update, delete on table public.profiles, public.plants to service_role;
