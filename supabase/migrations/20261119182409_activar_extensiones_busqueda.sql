-- Extensiones para la búsqueda de especies y plantas.
--   pg_trgm: búsqueda por similitud de texto (trigramas), tolerante a errores de escritura.
--   unaccent: permite comparar nombres sin distinguir tildes.
--
-- Siguiendo la convención de Supabase, se instalan en el esquema "extensions" y no en
-- "public", para que sus funciones no queden expuestas en la API. "if not exists" hace que
-- la migración no falle si alguna extensión ya estaba activada.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
