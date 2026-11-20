-- Funciones de aserción para las pruebas de base de datos.
--
-- npm run db:test las crea en el esquema "pruebas" de la base desechable, después de aplicar
-- las migraciones. No forman parte del esquema de Orki ni llegan a ningún proyecto.
--
-- Cada función no hace nada si la comprobación se cumple y lanza un error con un mensaje
-- legible si no. El error detiene la prueba y es lo que muestra npm run db:test.

create schema pruebas;
grant usage on schema pruebas to public;

-- Nombre legible de los códigos de error (SQLSTATE) que más se comprueban.
create function pruebas.nombre_error(codigo text)
returns text
language sql
immutable
as $$
  select codigo || coalesce(' (' || case codigo
    when '23502' then 'valor nulo no permitido'
    when '23503' then 'violación de clave foránea'
    when '23505' then 'valor duplicado'
    when '23514' then 'violación de restricción check'
    when '42501' then 'permiso denegado'
    when '22P02' then 'valor no válido para el tipo'
  end || ')', '')
$$;

-- Falla si la condición no es verdadera (también si es nula).
create function pruebas.comprobar(descripcion text, condicion boolean)
returns void
language plpgsql
as $$
begin
  if condicion is not true then
    raise exception 'FALLO: %', descripcion;
  end if;
end;
$$;

-- Falla si los dos valores son distintos, mostrando ambos.
create function pruebas.iguales(descripcion text, obtenido anycompatible, esperado anycompatible)
returns void
language plpgsql
as $$
begin
  if obtenido is distinct from esperado then
    raise exception 'FALLO: %: se esperaba «%» y se obtuvo «%»',
      descripcion, coalesce(esperado::text, 'null'), coalesce(obtenido::text, 'null');
  end if;
end;
$$;

-- Ejecuta la sentencia y falla si no da error, o si el error no es el esperado. Con
-- "restriccion" se exige además que la rechace esa restricción (o índice único) en concreto.
-- La sentencia se ejecuta en una subtransacción, así que su error no aborta la prueba.
create function pruebas.debe_fallar(
  descripcion text,
  sentencia text,
  codigo_esperado text,
  restriccion text default null
)
returns void
language plpgsql
as $$
declare
  codigo text;
  mensaje text;
  restriccion_obtenida text;
begin
  begin
    execute sentencia;
  exception when others then
    get stacked diagnostics
      codigo = returned_sqlstate,
      mensaje = message_text,
      restriccion_obtenida = constraint_name;
  end;

  if codigo is null then
    raise exception 'FALLO: %: la sentencia no dio error y se esperaba el error %',
      descripcion, pruebas.nombre_error(codigo_esperado);
  end if;
  if codigo <> codigo_esperado then
    raise exception 'FALLO: %: se esperaba el error % y se obtuvo % «%»',
      descripcion, pruebas.nombre_error(codigo_esperado), pruebas.nombre_error(codigo), mensaje;
  end if;
  if restriccion is not null and restriccion_obtenida is distinct from restriccion then
    raise exception 'FALLO: %: se esperaba que la rechazara «%» y la rechazó «%» («%»)',
      descripcion, restriccion, coalesce(nullif(restriccion_obtenida, ''), 'ninguna restricción'), mensaje;
  end if;
end;
$$;

-- Ejecuta la sentencia y falla si da error, mostrando cuál.
create function pruebas.debe_funcionar(descripcion text, sentencia text)
returns void
language plpgsql
as $$
declare
  codigo text;
  mensaje text;
begin
  execute sentencia;
exception when others then
  get stacked diagnostics codigo = returned_sqlstate, mensaje = message_text;
  raise exception 'FALLO: %: dio el error % «%»', descripcion, pruebas.nombre_error(codigo), mensaje;
end;
$$;

-- Atajos para los datos de partida -------------------------------------------------------

-- Id de un género por nombre (sin distinguir mayúsculas); falla si no existe.
create function pruebas.genero(nombre text)
returns uuid
language plpgsql
stable
as $$
declare
  resultado uuid;
begin
  select g.id into resultado from public.genera g where lower(g.name) = lower(nombre);
  if resultado is null then
    raise exception 'FALLO: no existe el género «%» en los datos de la prueba', nombre;
  end if;
  return resultado;
end;
$$;

-- Id de una especie por nombre científico; falla si no existe.
create function pruebas.especie(nombre text)
returns uuid
language plpgsql
stable
as $$
declare
  resultado uuid;
begin
  select s.id into resultado from public.species s where lower(s.scientific_name) = lower(nombre);
  if resultado is null then
    raise exception 'FALLO: no existe la especie «%» en los datos de la prueba', nombre;
  end if;
  return resultado;
end;
$$;

-- Recuento de filas de cada tabla de public. npm run db:test lo compara antes y después de
-- las pruebas para detectar una prueba que deje datos.
create function pruebas.filas_por_tabla()
returns table (tabla text, filas bigint)
language plpgsql
as $$
declare
  nombre text;
begin
  for nombre in
    select c.relname from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
    order by c.relname
  loop
    tabla := nombre;
    execute format('select count(*) from public.%I', nombre) into filas;
    return next;
  end loop;
end;
$$;

grant execute on all functions in schema pruebas to public;
