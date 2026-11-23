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

-- Ejecuta la sentencia y devuelve el motivo de su error: el campo "reason" del detalle JSON
-- que ponen las funciones de escritura del backoffice (private.raise_catalog_error), precedido
-- del código SQLSTATE ("23505 duplicate_name"). Falla si la sentencia no da error o si el
-- detalle no es JSON con motivo. Con "dato", devuelve además ese campo del detalle
-- ("23505 duplicate_name Phalaenopsis amabilis").
create function pruebas.motivo_error(sentencia text, dato text default null)
returns text
language plpgsql
as $$
declare
  codigo text;
  mensaje text;
  detalle text;
  motivo jsonb;
begin
  begin
    execute sentencia;
  exception when others then
    get stacked diagnostics
      codigo = returned_sqlstate,
      mensaje = message_text,
      detalle = pg_exception_detail;
  end;
  if codigo is null then
    raise exception 'FALLO: la sentencia no dio error y se esperaba un error del catálogo: %', sentencia;
  end if;
  begin
    motivo := detalle::jsonb;
  exception when others then
    motivo := null;
  end;
  if motivo is null or motivo ->> 'reason' is null then
    raise exception 'FALLO: el error % «%» no trae un motivo en el detalle («%»)',
      pruebas.nombre_error(codigo), mensaje, coalesce(detalle, '');
  end if;
  return codigo || ' ' || (motivo ->> 'reason')
    || coalesce(' ' || (motivo ->> dato), '');
end;
$$;

-- Atajos para los datos de partida -------------------------------------------------------

-- Id de un género por nombre (sin distinguir mayúsculas); falla si no existe. Las dos son
-- security definer (como el dueño de las tablas) para poder usarlas también con "set local role
-- anon", que desde #231 no lee las tablas del catálogo.
create function pruebas.genero(nombre text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
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
security definer
set search_path = ''
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

-- Patrón de las funciones de administrador ------------------------------------------------
--
-- Una función security definer de public que authenticated puede ejecutar tiene que empezar
-- llamando al guardián private.require_catalog_admin() (ver "Funciones de administrador" en
-- supabase/README.md). Es una comprobación sobre el texto de la función (pg_proc.prosrc): sirve
-- para que nadie olvide el guardián, no para detener a quien quiera esquivarla a propósito.

-- Si el cuerpo de una función, en plpgsql o sql, empieza llamando al guardián. Se ignoran los
-- comentarios y las mayúsculas. En plpgsql, la llamada tiene que ser la primera sentencia
-- tras el primer "begin", y la sección "declare" no puede dar valores iniciales (se calculan
-- antes del "begin"). En sql, tiene que ser la primera sentencia. Cualquier otra forma (por
-- ejemplo un cuerpo "begin atomic", que deja prosrc vacío) se da por no conforme.
create function pruebas.llama_primero_al_guardian(lenguaje text, fuente text)
returns boolean
language plpgsql
immutable
as $$
declare
  cuerpo text;
  antes text;
begin
  cuerpo := lower(coalesce(fuente, ''));
  cuerpo := regexp_replace(cuerpo, '/\*.*?\*/', ' ', 'g');
  cuerpo := regexp_replace(cuerpo, '--[^\n]*', ' ', 'g');

  if lenguaje = 'sql' then
    return cuerpo ~ '^\s*select\s+private\.require_catalog_admin\s*\(\s*\)\s*;';
  end if;
  if lenguaje <> 'plpgsql' then
    return false;
  end if;

  -- Lo que hay antes del primer "begin": nada o una sección "declare" sin valores iniciales.
  antes := substring(cuerpo from '^(.*?)\mbegin\M');
  if antes is null then
    return false;
  end if;
  if antes !~ '^\s*$' and (antes !~ '^\s*declare\M' or antes ~ '=|\mdefault\M') then
    return false;
  end if;
  return substr(cuerpo, length(antes) + 1)
    ~ '^begin\s+perform\s+private\.require_catalog_admin\s*\(\s*\)\s*;';
end;
$$;

-- Patrón de lectura pública del catálogo (#231, ver "Catálogo público" en supabase/README.md):
-- una función security definer que pueden ejecutar anon y authenticated sin guardián, porque
-- solo lee el catálogo. Por qué no la incumple, o null si la cumple:
--   - language sql con cuerpo estándar (begin atomic): Postgres registra en pg_depend las
--     tablas y funciones que usa (con un cuerpo entre $$, prosqlbody es null y no registra nada);
--   - no volatile: Postgres no deja escribir a una función stable o immutable;
--   - search_path vacío;
--   - solo depende de las cuatro tablas del catálogo, de species_photos (las fotos de referencia,
--     #234: imágenes con licencia abierta y su atribución, sin datos de usuarios; las funciones
--     solo las sacan unidas a una especie pública) y de normalize_search_text() y
--     search_species(), que leen solo el catálogo. Cualquier otra tabla, vista o función en
--     pg_depend la incumple. species_photo_rejections no está en la lista: es información
--     interna del backoffice.
-- A diferencia de la del guardián, esta comprobación no mira el texto: lo que usa la función lo
-- dice Postgres. Pero no ve dentro de search_species() (plpgsql): si un día leyera otra cosa,
-- habría que quitarla de la lista.
create function pruebas.incumple_lectura_publica(funcion oid)
returns text
language sql
stable
as $$
  select case
    when l.lanname <> 'sql' or p.prosqlbody is null then 'no es sql con cuerpo estándar (begin atomic)'
    when p.provolatile = 'v' then 'es volatile'
    when not coalesce('search_path=""' = any (p.proconfig), false) then 'sin search_path vacío'
    else (
      select 'depende de ' || string_agg(distinct d.objeto, ', ' order by d.objeto)
      from (
        select pg_describe_object(dep.refclassid, dep.refobjid, 0) as objeto
        from pg_depend dep
        where dep.classid = 'pg_proc'::regclass
          and dep.objid = p.oid
          and (
            (dep.refclassid = 'pg_class'::regclass
             and dep.refobjid not in ('public.genera'::regclass, 'public.genus_abbreviations'::regclass,
                                      'public.species'::regclass, 'public.species_names'::regclass,
                                      'public.species_photos'::regclass))
            or (dep.refclassid = 'pg_proc'::regclass
                and dep.refobjid not in ('public.normalize_search_text(text)'::regprocedure,
                                         'public.search_species(text, integer)'::regprocedure))
          )
      ) d
    )
  end
  from pg_proc p
  join pg_language l on l.oid = p.prolang
  where p.oid = funcion
$$;

-- Funciones security definer de public que la API expone sin seguir el patrón, con el motivo,
-- o "ninguna". anon solo puede ejecutar las de lectura pública del catálogo; authenticated, esas
-- y las que fijan un search_path vacío y llaman primero al guardián. Si una función con cuerpo
-- estándar que anon puede ejecutar incumple el patrón de lectura pública, el motivo lo dice.
create function pruebas.funciones_definer_expuestas()
returns text
language sql
stable
as $$
  select coalesce(string_agg(f.funcion || ': ' || f.motivo, '; ' order by f.funcion, f.motivo), 'ninguna')
  from (
    select p.oid::regprocedure::text as funcion, m.motivo
    from pg_proc p
    join pg_language l on l.oid = p.prolang
    cross join lateral (select pruebas.incumple_lectura_publica(p.oid) as incumple) lp
    cross join lateral (
      select 'la puede ejecutar anon'
          || case when p.prosqlbody is not null then ' (' || lp.incumple || ')' else '' end as motivo
      where has_function_privilege('anon', p.oid, 'execute')
        and lp.incumple is not null
      union all
      select 'la puede ejecutar authenticated sin search_path vacío'
      where has_function_privilege('authenticated', p.oid, 'execute')
        and not coalesce('search_path=""' = any (p.proconfig), false)
      union all
      select 'la puede ejecutar authenticated sin llamar primero a private.require_catalog_admin()'
      where has_function_privilege('authenticated', p.oid, 'execute')
        and not pruebas.llama_primero_al_guardian(l.lanname, p.prosrc)
        and lp.incumple is not null
    ) m
    where p.pronamespace = 'public'::regnamespace
      and p.prosecdef
  ) f
$$;

-- Listas blancas de privilegios (#283) -------------------------------------------------------
--
-- Lo que anon, authenticated y PUBLIC pueden hacer en public, leído del catálogo de Postgres en
-- un texto ordenado y estable para compararlo con la lista de supabase/tests/listas_blancas.sql.
-- PUBLIC cuenta como un rol más («PUBLIC»): lo que tiene lo tienen anon y authenticated.

-- Privilegios de tabla sobre las tablas, vistas, vistas materializadas, tablas externas y
-- secuencias de public: «relación rol PRIV,PRIV» separados por «; », o «ninguno».
create function pruebas.privilegios_de_relaciones()
returns text
language sql
stable
as $$
  select coalesce(string_agg(t.linea, '; ' order by t.linea collate "C"), 'ninguno')
  from (
    select c.relname || ' ' || coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') || ' '
           || string_agg(a.privilege_type, ',' order by a.privilege_type collate "C") as linea
    from pg_class c
    cross join lateral aclexplode(coalesce(
      c.relacl, acldefault((case when c.relkind = 'S' then 's' else 'r' end)::"char", c.relowner))) a
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
      and (a.grantee = 0 or a.grantee in (select r.oid from pg_roles r where r.rolname in ('anon', 'authenticated')))
    group by c.relname, a.grantee
  ) t
$$;

-- Privilegios por columna sobre las relaciones de public: «relación rol PRIV(col, col)»
-- separados por «; », o «ninguno».
create function pruebas.privilegios_de_columnas()
returns text
language sql
stable
as $$
  select coalesce(string_agg(t.linea, '; ' order by t.linea collate "C"), 'ninguno')
  from (
    select c.relname || ' ' || coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') || ' '
           || a.privilege_type || '(' || string_agg(att.attname::text, ', ' order by att.attname::text collate "C") || ')' as linea
    from pg_attribute att
    join pg_class c on c.oid = att.attrelid
    cross join lateral aclexplode(att.attacl) a
    where c.relnamespace = 'public'::regnamespace
      and att.attnum > 0
      and not att.attisdropped
      and (a.grantee = 0 or a.grantee in (select r.oid from pg_roles r where r.rolname in ('anon', 'authenticated')))
    group by c.relname, a.grantee, a.privilege_type
  ) t
$$;

-- Funciones y procedimientos de public que el rol puede ejecutar (por concesión directa, por
-- PUBLIC o por herencia), separados por «, », o «ninguna».
create function pruebas.funciones_ejecutables(rol text)
returns text
language sql
stable
as $$
  select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text collate "C"), 'ninguna')
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and has_function_privilege(rol, p.oid, 'execute')
$$;

-- Vistas de public sin security_invoker = true, separadas por «, », o «ninguna». Una vista sin
-- esa opción lee las tablas con los permisos de su dueño (postgres), sin RLS: quien pueda leer
-- la vista lee las filas de todos. Las vistas materializadas no admiten la opción y tampoco
-- aplican RLS, así que cuentan siempre.
create function pruebas.vistas_sin_security_invoker()
returns text
language sql
stable
as $$
  select coalesce(string_agg(c.relname::text, ', ' order by c.relname::text collate "C"), 'ninguna')
  from pg_class c
  where c.relnamespace = 'public'::regnamespace
    and c.relkind in ('v', 'm')
    and not exists (
      select from unnest(c.reloptions) o
      where lower(o) in ('security_invoker=true', 'security_invoker=on', 'security_invoker=yes', 'security_invoker=1')
    )
$$;

grant execute on all functions in schema pruebas to public;
