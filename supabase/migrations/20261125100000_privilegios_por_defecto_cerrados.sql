-- Privilegios por defecto cerrados y lectura de plant_photos solo para el dueño (issue #283,
-- parte de #277).
--
-- Qué cambia:
--   1. Lo que el rol postgres cree en adelante en el esquema public nace sin privilegios para
--      anon ni authenticated (tablas, vistas, secuencias y funciones), y ninguna función que
--      cree postgres, en ningún esquema, nace ejecutable por PUBLIC. Hasta ahora Supabase
--      concedía por defecto todo a anon y authenticated sobre lo nuevo de public, y Postgres
--      concede EXECUTE a PUBLIC sobre toda función nueva: una vista o una función nueva sin su
--      "revoke" quedaba abierta en la API (una vista sobre plants, legible por anon, devolvía
--      las plantas de todos). Desde aquí, cada privilegio para anon o authenticated se concede
--      a propósito en su migración y se añade a la lista blanca de
--      supabase/tests/listas_blancas.sql.
--   2. La política de lectura de plant_photos pierde la rama del administrador del catálogo:
--      cada usuario lee solo sus fotos. El administrador podía leer las filas enteras de las
--      fotos de otros usuarios en plantas por validar, incluida la nota libre y la fecha, que
--      la cola no necesita: list_proposal_groups() le da las rutas, y Storage le deja descargar
--      esas fotos por is_pending_plant_photo(). La política de privacidad dice que el
--      administrador no recibe las notas de las fotos.
--   3. Se borra public.is_pending_plant(uuid), que solo usaba esa rama.
--
-- No cambia ningún privilegio de los objetos que ya existen: solo afecta a lo que se cree a
-- partir de ahora. Los privilegios actuales de anon y authenticated se revisaron uno por uno
-- (ver la lista blanca); el único acceso de más era el del punto 2.
--
-- Roles cubiertos. Los privilegios por defecto son por rol creador: solo se aplican a lo que
-- crea ese rol. Las migraciones se aplican con postgres (la CLI de Supabase se conecta con él)
-- y el editor SQL del panel también trabaja con postgres, así que se cambian los de postgres.
-- Los de supabase_admin (el superusuario interno de Supabase, que según el arranque de
-- supabase/postgres tiene sus propios privilegios por defecto sobre public; no se ha podido
-- comprobar en los proyectos) no se pueden cambiar desde aquí: postgres no es miembro
-- de supabase_admin y "for role supabase_admin" fallaría con "permission denied", así que la
-- migración no los toca. Ninguna migración de orqui.app crea objetos con supabase_admin; si
-- algún día Supabase creara algo en public con ese rol, las listas blancas de
-- supabase/tests/listas_blancas.sql lo detectarían en las pruebas solo si llega por una
-- migración, no si se crea directamente en el proyecto.
--
-- Por qué hay dos formas de "alter default privileges":
--   - Los privilegios de anon y authenticated vienen de una entrada por esquema ("in schema
--     public") que crea Supabase, así que se retiran por esquema.
--   - El EXECUTE de PUBLIC sobre las funciones no es una entrada de Supabase sino el valor por
--     defecto de Postgres, que vale para todos los esquemas. Una entrada por esquema solo puede
--     añadir privilegios a ese valor, no quitarlos, así que se retira de forma global (sin "in
--     schema") para las funciones que cree postgres. Afecta también a las funciones nuevas de
--     private, lo que es más seguro (ya se les retira a mano) y no cambia los disparadores, que
--     no comprueban EXECUTE al dispararse. No afecta a las extensiones: sus funciones no las
--     crea postgres (las de confianza las crea el superusuario de arranque y las demás,
--     Supabase con supabase_admin).
--   - Por si en algún proyecto los privilegios de anon y authenticated vinieran también de una
--     entrada global, se retiran igualmente de forma global. Si no la hay, no hace nada.
--
-- service_role conserva sus privilegios por defecto: la clave de servicio ya lo puede todo
-- (ignora RLS) y las migraciones le conceden lo suyo de forma explícita.
--
-- Segura para la app ya desplegada (también para PWA abiertas con código de hace días):
--   - Ningún objeto existente cambia de privilegios, salvo la política de plant_photos.
--   - La app solo lee plant_photos para las fotos propias (photo-rows.ts filtra por
--     plant_id y user_id del usuario), también cuando quien la usa es un administrador. El
--     backoffice no lee plant_photos: la cola usa list_proposal_groups() y las URL firmadas de
--     Storage, que no pasan por esta política (las dos funciones son security definer).
--   - Ninguna versión de la app llama a is_pending_plant(): solo la usaba la política.
--   - Si falla algo, falla al aplicar: postgres siempre puede cambiar sus propios privilegios
--     por defecto, y revocar un privilegio por defecto que no existe no da error.

-- 1. Privilegios por defecto ----------------------------------------------------------------

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;

alter default privileges for role postgres
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres
  revoke all on functions from public, anon, authenticated;

-- 2. Lectura de plant_photos solo para el dueño ------------------------------------------------

drop policy "Cada usuario lee sus fotos y el administrador las de plantas por validar"
  on public.plant_photos;

create policy "Cada usuario lee sus fotos"
  on public.plant_photos
  for select
  to authenticated
  using (user_id = (select public.requesting_user_id()));

-- 3. is_pending_plant() ya no la usa nadie --------------------------------------------------

drop function public.is_pending_plant(uuid);
