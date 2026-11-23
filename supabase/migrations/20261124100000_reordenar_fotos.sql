-- Reordenar las fotos de una planta (issue #183, parte de #181).
--
-- Elegir la foto principal o mover una foto es cambiar varias posiciones a la vez. Desde la
-- API no se puede hacer de forma atómica: un PATCH pone el mismo valor en todas las filas que
-- toca, y hacerlo en varias peticiones necesita una posición libre (con 6 fotos no hay) y
-- puede dejar el orden a medias. Esta función recibe los ids de todas las fotos de la planta
-- en el orden nuevo y las recoloca con un solo UPDATE: la unicidad de (plant_id, position) es
-- diferible, así que se comprueba al terminar la sentencia y no fila a fila.
--
-- Es security invoker: se ejecuta con el rol de quien llama, de modo que siguen valiendo la RLS
-- de plant_photos (cada persona solo sus fotos) y los privilegios por columna (position es una
-- de las que el dueño puede cambiar). El disparador sync_plant copia la nueva principal a
-- plants, como con cualquier otro cambio de posición.

create function public.reorder_plant_photos(target_plant_id uuid, photo_ids uuid[])
returns setof public.plant_photos
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if target_plant_id is null or photo_ids is null then
    raise exception 'faltan la planta o las fotos' using errcode = '22023';
  end if;

  -- Bloquea la planta, como hace check_plant al escribir una foto: dos reordenamientos a la
  -- vez no se cruzan. Con RLS, quien no es el dueño no ve la fila y tampoco verá las fotos.
  perform from public.plants p where p.id = target_plant_id for no key update;

  -- La lista tiene que ser exactamente las fotos de la planta, sin repetir ninguna. Una lista
  -- de otra planta, incompleta o de fotos ajenas (que la RLS oculta) no cumple.
  if pg_catalog.cardinality(photo_ids)
       <> (select pg_catalog.count(*) from public.plant_photos f where f.plant_id = target_plant_id)
     or pg_catalog.cardinality(photo_ids)
       <> (select pg_catalog.count(distinct x.id) from pg_catalog.unnest(photo_ids) as x(id))
     or exists (
       select from public.plant_photos f
        where f.plant_id = target_plant_id and not (f.id = any (photo_ids))
     ) then
    raise exception 'las fotos no son las de la planta' using errcode = '22023';
  end if;

  return query
    update public.plant_photos f
       set position = (o.ord - 1)::integer
      from pg_catalog.unnest(photo_ids) with ordinality as o(id, ord)
     where f.id = o.id and f.plant_id = target_plant_id
    returning f.*;
end;
$$;

comment on function public.reorder_plant_photos(uuid, uuid[]) is
  'Recoloca todas las fotos de una planta en el orden dado (la primera pasa a ser la principal), en una sola sentencia.';

revoke all on function public.reorder_plant_photos(uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.reorder_plant_photos(uuid, uuid[]) to authenticated, service_role;
