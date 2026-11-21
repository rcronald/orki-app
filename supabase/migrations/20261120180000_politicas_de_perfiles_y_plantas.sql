-- Permisos y políticas RLS de perfiles y plantas (issue #64, parte de #6).
--
-- Con sesión de Clerk (rol authenticated), cada usuario lee, crea, actualiza y borra solo su
-- perfil y sus plantas. El usuario de la petición se lee siempre con
-- (select public.requesting_user_id()) (issue #58): el "select" hace que Postgres la evalúe
-- una vez por consulta y no una por fila. Sin sesión, la función devuelve null y ninguna
-- política deja pasar nada.
--
-- Lo que no cambia:
--   - anon sigue sin ningún privilegio sobre profiles ni plants: una petición a datos
--     privados hecha sin sesión falla con un error de permiso en lugar de devolver vacío.
--   - Las políticas no miran el claim app_role: un administrador de catálogo solo ve y toca
--     su propio inventario. La cola de propuestas (#22) expondrá lo que necesite mediante
--     funciones, no con lectura general de plants.
--   - authenticated no recibe TRUNCATE (ignora RLS).
--   - service_role conserva todos sus privilegios y no está sujeto a RLS.
--
-- Estado de validación
-- --------------------
-- Un usuario no puede dejar sus plantas en "no identificable" ni marcarlas como validadas
-- sin especie. Lo segundo ya lo impide el esquema: la restricción plants_validated_iff_species
-- exige "validated" si y solo si hay especie, y el disparador sync_with_species pone
-- "validated" al enlazar una especie y vuelve a "pending" al desenlazarla.
--
-- Para lo primero se usan permisos de columna: authenticated puede insertar y actualizar
-- todas las columnas de plants menos validation. Se eligió así porque:
--   - Es lo más simple de probar: cualquier intento de escribir validation desde la API da
--     un error de permiso (42501), con o sin especie, al crear y al editar.
--   - No rompe la sincronización: los privilegios de columna se comprueban sobre las columnas
--     que nombra la sentencia, no sobre lo que el disparador cambia en la fila, así que
--     enlazar o desenlazar una especie sigue ajustando validation.
--   - A diferencia de una condición en la política (with check validation <> 'unidentifiable'),
--     no impide al usuario editar el apodo, la foto o el estado de una planta que un
--     administrador ya dejó en "no identificable".
--   - service_role (privilegios completos) y las futuras funciones de administrador
--     (security definer, que se ejecutan como el dueño de las tablas) sí pueden poner esos
--     estados.
-- El usuario nunca necesita escribir validation: al crear una planta toma "pending" por
-- defecto (o "validated" si lleva especie), y el disparador la ajusta al editar.
-- Contrapartida: una columna nueva de plants no será escribible por authenticated hasta que
-- una migración la añada a estas listas.

-- Perfiles ------------------------------------------------------------------------------

grant select, insert, update, delete on table public.profiles to authenticated;

create policy "Cada usuario lee su perfil"
  on public.profiles
  for select
  to authenticated
  using (id = (select public.requesting_user_id()));

create policy "Cada usuario crea su perfil"
  on public.profiles
  for insert
  to authenticated
  with check (id = (select public.requesting_user_id()));

create policy "Cada usuario actualiza su perfil"
  on public.profiles
  for update
  to authenticated
  using (id = (select public.requesting_user_id()))
  with check (id = (select public.requesting_user_id()));

-- El borrado del propio perfil lo usa la eliminación de cuenta (#26), que se hace desde la
-- app sin backend.
create policy "Cada usuario borra su perfil"
  on public.profiles
  for delete
  to authenticated
  using (id = (select public.requesting_user_id()));

-- Plantas -------------------------------------------------------------------------------

grant select, delete on table public.plants to authenticated;

-- Todas las columnas menos validation (ver "Estado de validación" arriba).
grant insert (
  id, user_id, species_id, entered_name, genus_id, type, acquired_on, origin, status,
  location, nickname, flower_color, photo_in_bloom, photo_path, thumbnail_path,
  created_at, updated_at
) on table public.plants to authenticated;

grant update (
  id, user_id, species_id, entered_name, genus_id, type, acquired_on, origin, status,
  location, nickname, flower_color, photo_in_bloom, photo_path, thumbnail_path,
  created_at, updated_at
) on table public.plants to authenticated;

create policy "Cada usuario lee sus plantas"
  on public.plants
  for select
  to authenticated
  using (user_id = (select public.requesting_user_id()));

-- with check: nadie crea una planta con el user_id de otro.
create policy "Cada usuario crea sus plantas"
  on public.plants
  for insert
  to authenticated
  with check (user_id = (select public.requesting_user_id()));

-- using limita las filas que puede editar; with check impide pasarle la planta a otro.
create policy "Cada usuario edita sus plantas"
  on public.plants
  for update
  to authenticated
  using (user_id = (select public.requesting_user_id()))
  with check (user_id = (select public.requesting_user_id()));

create policy "Cada usuario borra sus plantas"
  on public.plants
  for delete
  to authenticated
  using (user_id = (select public.requesting_user_id()));
