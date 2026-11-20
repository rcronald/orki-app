# Supabase

Esta carpeta contiene lo que la CLI de Supabase necesita para gestionar la base de datos de Orki:

- `config.toml`: configuración mínima de la CLI. Orki no usa el entorno local de Supabase con Docker, así que aquí no se configuran servicios locales; la configuración de autenticación, almacenamiento y demás servicios vive en cada proyecto remoto.
- `migrations/`: las migraciones SQL, en orden. Cada archivo se aplica una sola vez en cada ambiente y la CLI registra cuáles ya se aplicaron.
- `datos-ejemplo/`: datos de ejemplo del catálogo, solo para el proyecto de desarrollo. Los carga `npm run db:seed:dev` (ver [Datos de ejemplo en desarrollo](../README.md#datos-de-ejemplo-en-desarrollo)); no son migraciones y no llegan a producción.
- `tests/`: las pruebas de base de datos, en SQL, que ejecuta `npm run db:test` (ver [Pruebas de base de datos](#pruebas-de-base-de-datos)).
- `.env.example`: plantilla de las credenciales del proyecto de desarrollo. Se copia a `supabase/.env`, que git ignora.

Hay dos ambientes, cada uno con su proyecto de Supabase: desarrollo y producción. Las migraciones se crean y se prueban en desarrollo desde tu máquina, y llegan a producción a través de un workflow de GitHub Actions al fusionar en `main`.

El flujo completo (crear una migración, aplicarla en desarrollo, qué pasa en producción y qué credenciales hacen falta) está documentado en la sección [Base de datos y migraciones](../README.md#base-de-datos-y-migraciones) del README principal.

## Esquema

Las tablas viven en el esquema `public` y sus identificadores están en inglés:

- Catálogo, de lectura pública (también sin sesión): `genera` (géneros, con la marca de acceso rápido), `genus_abbreviations` (abreviaturas de género, como Phal.), `species` (especies e híbridos, con su estado, su fuente y la referencia externa de la fuente; lo importado del Catalogue of Life va con fuente `col` y su identificador de COL, obligatorio por la restricción `species_col_has_source_ref`, ver [Importación del catálogo](#importación-del-catálogo)) y `species_names` (sinónimos y nombres comunes). La migración del catálogo carga los cinco géneros de acceso rápido y sus abreviaturas estándar de la RHS, y la de abreviaturas (#69) las de otros 38 géneros y nothogéneros comunes en cultivo (ver [Abreviaturas de género](#abreviaturas-de-género)). Desde la API solo lo escriben (insertar, editar y borrar) los administradores del catálogo: `authenticated` tiene el permiso y las políticas RLS exigen `(select public.is_catalog_admin())`.
- Inventario: `profiles` (perfil de cada usuario de Clerk) y `plants` (ejemplares). El usuario es el id de Clerk, de tipo texto, y por defecto se toma del claim `sub` del token de sesión. Con sesión (`authenticated`), cada usuario lee, crea, actualiza y borra solo su perfil y sus plantas: las políticas comparan con `(select public.requesting_user_id())`, no dejan crear una planta a nombre de otro ni cambiar su dueño, y no dan más acceso al administrador de catálogo. `authenticated` puede escribir todas las columnas de `plants` menos `validation`, que solo ajustan el disparador de sincronización, `service_role` y las futuras funciones de administrador; así un usuario no puede marcar sus plantas como "no identificable" ni validarlas sin especie. Una columna nueva de `plants` hay que concedérsela explícitamente a `authenticated`. Sin sesión (`anon`) no hay ningún acceso.
- Identidad: `public.requesting_user_id()` devuelve el id de usuario de Clerk de la petición (`auth.jwt()->>'sub'`), o `null` sin sesión. Es `stable`, `security invoker` y con `search_path` vacío; la pueden ejecutar `anon`, `authenticated` y `service_role` (la API la expone en `/rest/v1/rpc/requesting_user_id`) y no lee ninguna tabla. La usan el panel de diagnóstico de la app y las políticas RLS de perfiles y plantas (#64).
- Rol de administrador: `public.is_catalog_admin()` es verdadera solo si el claim de primer nivel `app_role` del token vale exactamente `catalog_admin` (falsa sin sesión, sin el claim, con otro valor o con el rol en otro claim); nunca devuelve `null`. Mismas propiedades y permisos que `requesting_user_id()`. No hay columna de rol en la base de datos: el rol vive en Clerk (ver [Rol de administrador del catálogo](../README.md#rol-de-administrador-del-catálogo)). El guardián `private.require_catalog_admin()` lanza el error `42501` si la petición no es de un administrador; lo usan las [funciones de administrador](#funciones-de-administrador).
- Búsqueda: `public.search_species(query, max_results)` busca especies por nombre científico, sinónimo o nombre común, tolerando errores de tipeo, tildes, mayúsculas y espacios de más, y expande una abreviatura de género al principio (`Phal. amab`). `public.search_genera(query, max_results)` busca géneros por nombre o abreviatura, para el chip "Otro" del registro. Se pueden llamar sin sesión. Ver [Búsqueda de especies](#búsqueda-de-especies) y [Búsqueda de géneros](#búsqueda-de-géneros).
- Disparadores, con sus funciones en el esquema `private` (no expuesto en la API): al enlazar una planta a una especie, la planta toma el género y el tipo de la especie y queda validada; al desenlazarla vuelve a "por validar"; si cambian el género o el tipo de una especie, se propagan a sus plantas; y `updated_at` se actualiza solo en todas las tablas.

Todas las tablas tienen Row Level Security activada y privilegios explícitos: `anon` solo puede leer el catálogo; `authenticated` lee el catálogo, lo escribe solo si es administrador (lo deciden las políticas) y gestiona su propio perfil y sus plantas; y `service_role` puede leer y escribir todo.

## Reglas para las migraciones

- Una migración ya fusionada en `main` no se edita ni se borra: se aplicó en producción. Para corregirla, crea una migración nueva.
- Escribe migraciones que se puedan aplicar sin intervención manual y, cuando sea razonable, idempotentes (`if not exists`, `create or replace`).
- Las extensiones se instalan en el esquema `extensions`, no en `public`, siguiendo la convención de Supabase.
- No pongas datos personales ni secretos en las migraciones.
- Cada migración llega con sus pruebas en `tests/`, y `npm run db:test` debe pasar antes de abrir el pull request.
- Cada migración llega también con los tipos de TypeScript regenerados: ejecuta `npm run db:types` e incluye `apps/web/src/lib/database.types.ts` en el mismo commit. El CI falla si no coinciden (ver [Tipos de TypeScript](#tipos-de-typescript)).

## Pruebas de base de datos

`npm run db:test` aplica todas las migraciones en una base Postgres desechable, con lo mínimo de Supabase simulado, y ejecuta las pruebas de esta carpeta. Cómo se ejecuta (en local y en el CI), qué simula de Supabase y qué no cubre está en la sección [Pruebas de la base de datos](../README.md#pruebas-de-la-base-de-datos) del README principal.

Las pruebas están organizadas por tema, un archivo por tema:

| Archivo                               | Qué comprueba                                                                                                                                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `esquema.sql`                         | Que las migraciones dejan las tablas, enumerados, extensiones, disparadores y funciones esperados, con su dueño.                                                                                         |
| `datos_referencia.sql`                | Los cinco géneros de acceso rápido con su abreviatura, el número de géneros y abreviaturas cargados, y que las migraciones no cargan perfiles ni plantas.                                                |
| `catalogo_unicidad.sql`               | Unicidad sin distinguir mayúsculas y nombres sin espacios sobrantes en géneros, abreviaturas, especies y nombres; referencia obligatoria y única por fuente (`gbif`, `col`).                             |
| `borrados.sql`                        | Borrados en cascada (abreviaturas, nombres alternativos) y restringidos (géneros y especies en uso).                                                                                                     |
| `plantas_y_perfiles.sql`              | Restricciones de `plants` y `profiles`: validación y especie, textos, fecha, enumerados, idioma y valores por defecto.                                                                                   |
| `sincronizacion.sql`                  | Sincronización de género y tipo al enlazar, desenlazar y cambiar la especie, y `updated_at` y `created_at`.                                                                                              |
| `acceso_por_rol.sql`                  | Qué pueden leer y escribir `anon`, `authenticated` y `service_role`, y el usuario por defecto tomado del token.                                                                                          |
| `identidad.sql`                       | `requesting_user_id()`: null sin sesión, el `sub` con sesión, sus permisos y propiedades, y que no abre perfiles ni plantas a `anon`.                                                                    |
| `politicas_plantas_y_perfiles.sql`    | Políticas y permisos de `profiles` y `plants`: cada usuario solo lo suyo, sin cambiar el dueño ni escribir `validation`; el administrador no ve más; `anon` cerrado.                                     |
| `politicas_catalogo.sql`              | Escritura del catálogo: anónimo, usuario sin rol y administrador; tokens que no dan el rol; `is_catalog_admin()`.                                                                                        |
| `funciones_administrador.sql`         | El guardián `private.require_catalog_admin()` y el patrón de las funciones de administrador, con ejemplos que la regla general acepta y rechaza.                                                         |
| `busqueda_especies.sql`               | Normalización, índices de trigramas y `search_species()`: errores de tipeo, tildes, prefijos, sinónimos, orden, límites, permisos y que el plan usa los índices.                                         |
| `busqueda_generos_y_abreviaturas.sql` | Abreviaturas en `search_species()` (con o sin punto, desconocidas, solas, ambiguas) y `search_genera()`: tipeo, tildes, prefijo, abreviatura, límites, permisos, índices y la lista cargada sin choques. |
| `datos_ejemplo.sql`                   | Que los datos de ejemplo de `datos-ejemplo/` se cargan, que cargarlos dos veces no cambia nada, que no tocan el inventario y que la migración de abreviaturas se aplica sobre ellos.                     |
| `seguridad_general.sql`               | Reglas que valen para cualquier tabla o función futura: RLS en todo `public`, `anon` solo lee, funciones protegidas.                                                                                     |

`seguridad_general.sql` no nombra tablas concretas: recorre el catálogo de Postgres, así que falla sola si una migración nueva crea una tabla sin Row Level Security, concede escritura a `anon`, deja una función de `private` ejecutable desde la API o expone una función `security definer` de `public` sin seguir el patrón de las [funciones de administrador](#funciones-de-administrador).

### Formato de un archivo de pruebas

Cada prueba empieza con una línea `-- prueba: <qué comprueba>` y llega hasta la siguiente. Lo que haya antes de la primera prueba son los datos de partida del archivo, que se ejecutan al comienzo de cada prueba.

Cada prueba corre en su propia sesión, dentro de una transacción que se revierte al terminar, con el rol `postgres` (el dueño de las tablas). Por eso las pruebas son independientes entre sí y no dejan datos, y pueden usar `set local role anon` (o `authenticated`, `service_role`) y `set local request.jwt.claims = '{"sub": "user_a"}'` para actuar como una petición de la API. Una prueba no puede abrir, confirmar ni revertir transacciones (`begin`, `commit`, `rollback`); el comando la rechaza. Puede incluir otro archivo SQL con `\i`, con la ruta relativa a la raíz del repositorio (por ejemplo `\i supabase/datos-ejemplo/catalogo.sql`).

Una prueba falla en cuanto una sentencia da error. Para comprobar resultados se usan las funciones del esquema `pruebas` (`tests/soporte/ayudantes.sql`), que solo existen en la base desechable:

- `pruebas.iguales(descripcion, obtenido, esperado)`: falla mostrando los dos valores si son distintos.
- `pruebas.comprobar(descripcion, condicion)`: falla si la condición no es verdadera.
- `pruebas.debe_fallar(descripcion, sentencia, codigo, restriccion)`: ejecuta la sentencia (texto, normalmente entre `$$`) y falla si no da el error con ese código SQLSTATE (por ejemplo `23505` para un duplicado, `23514` para un `check`, `23503` para una clave foránea o `42501` para un permiso denegado). La restricción es opcional; si se indica, exige que el error venga de esa restricción o índice único.
- `pruebas.debe_funcionar(descripcion, sentencia)`: ejecuta la sentencia y falla mostrando el error si lo da.
- `pruebas.genero(nombre)` y `pruebas.especie(nombre)`: devuelven el id de un género o una especie por su nombre.
- `pruebas.funciones_definer_expuestas()`: las funciones `security definer` de `public` que la API expone sin seguir el patrón de las [funciones de administrador](#funciones-de-administrador), con el motivo, o `ninguna`.

Por ejemplo:

```sql
-- prueba: géneros: no se repite un nombre con otras mayúsculas
select pruebas.debe_fallar(
  'PHALAENOPSIS ya existe como Phalaenopsis',
  $$insert into public.genera (name) values ('PHALAENOPSIS')$$,
  '23505', 'genera_name_key'
);
```

### Añadir pruebas al escribir una migración

1. Escribe la migración con `npm run db:new -- <nombre>`.
2. Añade sus pruebas al archivo del tema que corresponda, o crea uno nuevo en `tests/` (cualquier `.sql` de la carpeta se ejecuta, en orden alfabético). Prueba lo que la migración promete: cada restricción con un caso que la cumple y otro que la incumple (con el nombre de la restricción en `pruebas.debe_fallar`), cada disparador con su efecto, y el acceso por rol de cada tabla nueva.
3. Si la migración crea una tabla, añádela a la lista de `esquema.sql`. Las comprobaciones de `seguridad_general.sql` ya la cubren sin tocarlas.
4. Ejecuta `npm run db:test` (o `npm run db:test -- <tema>` mientras trabajas). Comprueba también que la prueba nueva falla si quitas de la migración lo que prueba: una prueba que nunca falla no protege nada.
5. Ejecuta `npm run db:types` para regenerar los tipos de TypeScript y versiona el archivo que cambie.

## Búsqueda de especies

La búsqueda del autocompletado del registro (#7) es una función de la API, `public.search_species`, definida en la migración `20261120190000_busqueda_de_especies.sql`, donde están explicadas todas las decisiones.

```ts
const { data, error } = await supabase.rpc('search_species', {
  query: 'phal amab',
  max_results: 10,
})
```

Por HTTP es `POST /rest/v1/rpc/search_species` con `{"query": "phal amab", "max_results": 10}`, con o sin sesión. Devuelve una fila por especie, como mucho una vez cada una:

| Columna             | Qué es                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `id`                | Id de la especie.                                                                                    |
| `scientific_name`   | Nombre científico aceptado.                                                                          |
| `genus_id`          | Id del género de la especie (el de la especie aceptada, aunque coincida un sinónimo de otro género). |
| `genus_name`        | Nombre del género.                                                                                   |
| `type`              | `species` o `hybrid`.                                                                                |
| `status`            | `imported`, `validated` u `observed`: se incluyen todos, también las observadas.                     |
| `matched_name`      | El nombre por el que coincidió, tal como está en el catálogo (con sus tildes y mayúsculas).          |
| `matched_name_type` | Tipo de ese nombre (enumerado `species_match_type`): `scientific`, `synonym` o `common`.             |

Cómo busca:

- La consulta y los nombres se comparan normalizados con `public.normalize_search_text()`: minúsculas, sin tildes, con los espacios unificados y sin el signo de híbrido. Es `immutable` y la usan también los índices y la búsqueda de géneros.
- El signo de híbrido no cuenta (migración `20261120210000_ajustes_de_busqueda.sql`): los nothogéneros y los híbridos naturales se guardan como los da la fuente (`× Rhyncholaeliocattleya`, `Phalaenopsis × intermedia`), y la normalización sustituye cada `×` por un espacio y quita la `x` que es una palabra entera seguida de otra palabra (al principio o en medio). Así `rhyncholaeliocattleya`, `×Rhyncholaeliocattleya`, `phalaenopsis x intermedia` y `phal x intermedia` encuentran esos nombres. La `x` dentro de una palabra (`xanthina`) o al final de la consulta (`phal x`, que puede ser el comienzo de un epíteto) no se toca. Una consulta puede quedarse corta al quitarla: `x a` queda en `a` y no busca nada. Si la normalización vuelve a cambiar, hay que reconstruir los índices que la usan (`reindex`), como hace esa migración.
- Un nombre coincide si se parece a la consulta (`word_similarity` de `pg_trgm` de al menos 0,3, fijado en la función) o si la consulta es su prefijo por palabras (`phal amab` es prefijo de `Phalaenopsis amabilis`). Con menos de 3 caracteres normalizados solo cuenta el prefijo: `ph` encuentra los nombres (científicos, sinónimos o comunes) que empiezan por `ph`, pero no los que solo tienen otra palabra que empieza así; con 2 caracteres la similitud coincidía con casi cualquier nombre y era la consulta más lenta (ver "Rendimiento de la búsqueda").
- Abreviaturas (#69, migración `20261120200000_abreviaturas_y_busqueda_de_generos.sql`): si la primera palabra de la consulta, sin el punto y sin importar mayúsculas, es una abreviatura de género conocida, se busca también con el nombre del género en su lugar: `Phal. amab`, `phal amab` y `PHAL. AMAB` encuentran `Phalaenopsis amabilis`, y `phal.` sola devuelve las Phalaenopsis. Se buscan las dos formas, la expandida y la escrita, porque una abreviatura puede ser también el comienzo de otro nombre (`cal bul` encuentra Calypso bulbosa aunque `Cal.` sea Calanthe); a igual clase de coincidencia gana la expandida. Una abreviatura desconocida se busca como texto normal, y solo cuenta la primera palabra separada por un espacio (`Phal.amab` no se expande). `matched_name` sigue siendo el nombre del catálogo.
- Orden: primero las especies cuyo nombre científico empieza por la consulta (expandida o escrita; dentro, primero las de la expandida); después, de mayor a menor similitud; a igualdad, el nombre científico gana a los sinónimos y estos a los nombres comunes; y al final, por nombre científico.
- Los índices GIN de trigramas `species_scientific_name_trgm_idx`, `species_names_name_trgm_idx` y `genera_name_trgm_idx` están sobre `public.normalize_search_text(columna)`. Una consulta nueva los usa solo si escribe esa misma expresión con un operador de `extensions.gin_trgm_ops` (`operator(extensions.%>)`, `like`...).
- Postgres calcula esos índices con los permisos de quien escribe la fila: un rol que inserte o actualice en `species`, `species_names` o `genera` necesita ejecutar `normalize_search_text()` y `usage` sobre el esquema `extensions`. `postgres`, `service_role` y `authenticated` ya los tienen; un rol nuevo que escriba el catálogo tendrá que recibirlos.

Límites, porque es pública (fuera de ellos devuelve vacío, sin error):

- Consulta nula, de más de 100 caracteres (antes de normalizar), o que normalizada tiene menos de 2 caracteres o ninguna letra ni número.
- `max_results`: 10 por defecto y 20 como máximo; si es nulo, cero o negativo se usan 10.

Es `security invoker`, `stable` y con `search_path` vacío: lee el catálogo con los permisos de quien llama, que ya es de lectura pública, y no toca perfiles ni plantas. La pueden ejecutar `anon`, `authenticated` y `service_role`, igual que `normalize_search_text()`, que no lee ninguna tabla.

## Búsqueda de géneros

`public.search_genera(query, max_results)`, de la migración `20261120200000_abreviaturas_y_busqueda_de_generos.sql`, busca géneros para el chip "Otro" del registro:

```ts
const { data, error } = await supabase.rpc('search_genera', {
  query: 'masdevalia',
  max_results: 10,
})
```

Devuelve una fila por género:

| Columna                | Qué es                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| `id`                   | Id del género.                                                                                            |
| `name`                 | Nombre del género.                                                                                        |
| `is_quick_access`      | Si es uno de los géneros de acceso rápido.                                                                |
| `matched_abbreviation` | La abreviatura tal como está guardada (`Phal.`) si coincidió por ella; `null` si coincidió por su nombre. |

- Un género coincide si su nombre se parece a la consulta o empieza por ella (como en `search_species()`, con el índice `genera_name_trgm_idx`), o si la consulta entera, sin el punto final y sin importar mayúsculas, es una de sus abreviaturas (`Mps.`, `mps` o `MPS` encuentran Miltoniopsis).
- Orden: primero los prefijos (una abreviatura cuenta como prefijo con similitud 1, así que `phal` devuelve Phalaenopsis con `Phal.`), después de mayor a menor similitud y al final por nombre.
- Como en `search_species()`, con menos de 3 caracteres normalizados solo cuentan el prefijo y la abreviatura (`ph` devuelve Phalaenopsis y Phragmipedium, no cualquier género que empiece por `p`), y el signo de híbrido no cuenta (`rhyncholaeliocattleya` encuentra `× Rhyncholaeliocattleya`).
- Mismos límites, propiedades y permisos que `search_species()`: mínimo 2 caracteres normalizados, como mucho 100 caracteres, 10 resultados por defecto y 20 como máximo; `security invoker`, `stable`, `search_path` vacío; la pueden ejecutar `anon`, `authenticated` y `service_role`.

## Abreviaturas de género

`genus_abbreviations` guarda cada abreviatura con su punto (`Phal.`) y cada una pertenece a un solo género. Dos índices únicos lo garantizan: `genus_abbreviations_abbreviation_key`, sin distinguir mayúsculas, y `genus_abbreviations_search_key`, sobre la clave de búsqueda (`normalize_search_text(rtrim(abbreviation, '.'))`), que impide además guardar `Phal` o `Phál.` junto a `Phal.` y que usan las dos búsquedas para resolver la abreviatura.

Las migraciones cargan las abreviaturas estándar de la RHS (las de las etiquetas de vivero) de 43 géneros: los cinco de acceso rápido y 38 géneros y nothogéneros comunes en cultivo, algunos ya fusionados en otros pero todavía presentes en etiquetas (Blc., Slc., Dtps., Ascda., Soph.). La carga crea el género si no existe, sin marcarlo de acceso rápido, y no duplica ni falla si el género o la abreviatura ya existen (por ejemplo, con los datos de ejemplo). El criterio para los choques y las abreviaturas que conviene revisar contra la lista de la RHS están anotados en la migración. Una abreviatura nueva o corregida va en una migración nueva.

## Importación del catálogo

El catálogo de especies se carga desde el Catalogue of Life eXtended Release (COL XR) con `orki-catalogo cargar` (`scripts/catalog-import/`, issue #8; sus reglas están en [su README](../scripts/catalog-import/README.md), y cómo se ejecuta en local, en desarrollo y en producción, con el workflow manual `importar-catalogo.yml`, en [Ejecución por ambiente](../scripts/catalog-import/README.md#ejecución-por-ambiente)). Requiere las migraciones aplicadas en el ambiente. Lo que el esquema aporta:

- `species_source` tiene el valor `col` (migración `20261120220000_fuente_col_en_especies.sql`). `gbif` se conserva aunque no se use. El valor va solo en su migración porque Postgres no deja usar un valor de enumerado en la misma transacción que lo añade, y cada migración se aplica en su propia transacción (lo hacen así la CLI de Supabase y `npm run db:test`).
- `species_col_has_source_ref` (migración `20261120220100_col_exige_referencia.sql`) exige `source_ref` a lo importado de COL, igual que `species_gbif_has_source_ref` con `gbif`. La carga encuentra cada especie por la restricción única `(source, source_ref)`.
- La carga escribe con conexión directa como `postgres` (dueño de las tablas): los disparadores `set_updated_at` y `propagate_species_to_plants` se aplican igual que desde la API, así que un cambio de género o de tipo de una especie importada llega a las plantas enlazadas. Solo escribe las filas que cambian, para no mover `updated_at` al repetirla.
- Con COL26.10 XR (752 géneros, 32 464 especies y 60 000 sinónimos) el catálogo ocupa unos 34 MB y la base completa unos 42 MB tras `vacuum` (medido el 20 de noviembre de 2026 en Postgres 17 local; el detalle, en el README de la importación).

## Funciones de administrador

Casi todo lo que hace un administrador del catálogo pasa por las tablas, con las políticas RLS de escritura. Algunas operaciones necesitan además leer o cambiar filas que RLS le oculta, como las plantas de todos los usuarios (la fusión de especies, #21; la cola de validación, #22; la auditoría, #23). Esas se exponen como funciones de la API con este patrón:

- Viven en `public`, para que la API las exponga en `/rest/v1/rpc/<nombre>`.
- Son `security definer` (se ejecutan como su dueño, `postgres`, que no está sujeto a RLS) con `set search_path = ''` y todos los nombres calificados.
- Se escriben en `plpgsql` (o en `sql`) y su **primera sentencia** es la llamada al guardián `private.require_catalog_admin()`, que lanza el error `42501` (permiso denegado) si quien llama no es administrador. En `plpgsql`, la sección `declare` no puede dar valores iniciales, porque se calculan antes del `begin` y, por tanto, antes del guardián.
- Se retira el permiso de ejecución a `public`, `anon`, `authenticated` y `service_role` (Supabase lo concede por defecto a toda función nueva de `public`) y se concede solo a `authenticated`.
- Llegan con sus pruebas: que funcionan para un administrador y que dan `42501` para un usuario sin rol y para `anon`.

```sql
create function public.merge_species(source_id uuid, target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_catalog_admin();

  update public.plants set species_id = target_id where species_id = source_id;
  delete from public.species where id = source_id;
end;
$$;

revoke all on function public.merge_species(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.merge_species(uuid, uuid) to authenticated;
```

(Es un ejemplo, no la fusión real del #21.)

Por qué así:

- El rol se comprueba dentro de la función, con el mismo `public.is_catalog_admin()` que las políticas, porque `security definer` se salta RLS: sin el guardián, cualquier usuario con sesión podría llamarla.
- El guardián es la primera sentencia para que nada se ejecute antes de comprobar el rol, y vive en `private` (sin `security definer` y sin permiso para nadie más que su dueño) para que la API no lo exponga: solo lo llaman funciones que ya corren como `postgres`.
- No se concede a `service_role`: los scripts con la clave de servicio ya pueden escribir todas las tablas, y su token no trae `app_role`, así que el guardián los rechazaría igualmente.

La regla general de `tests/seguridad_general.sql` lo vigila con `pruebas.funciones_definer_expuestas()`: falla si `anon` puede ejecutar alguna función `security definer` de `public`, o si `authenticated` puede ejecutar una que no fija `search_path` vacío o que no llama primero al guardián (lo comprueba en el texto de la función, `pg_proc.prosrc`, sin contar los comentarios). Es una red para olvidos, no una barrera contra quien la quiera esquivar a propósito; la revisión del pull request sigue haciendo falta. Las funciones `security definer` que solo ejecuta `service_role` no están sujetas al patrón. `tests/funciones_administrador.sql` tiene ejemplos que la regla acepta y rechaza.

## Tipos de TypeScript

La app usa tipos generados a partir de estas migraciones (`apps/web/src/lib/database.types.ts`), con los que el cliente de Supabase comprueba al compilar tablas, columnas y enumerados. Cuándo regenerarlos:

- Después de crear o cambiar una migración (antes de hacer commit).
- Después de actualizar la CLI de Supabase o Prettier, si `npm run db:types:check` dice que no coinciden.

`npm run db:types` los genera sin Docker ni credenciales, sobre la misma base desechable que las pruebas, y solo con el esquema `public`. `npm run db:types:check` hace lo mismo sin escribir y falla si el archivo versionado es distinto; es lo que ejecuta el CI. Si la migración añade una tabla o un enumerado, añade también su alias en `apps/web/src/lib/database.ts`. El detalle está en la sección [Tipos de TypeScript del esquema](../README.md#tipos-de-typescript-del-esquema) del README principal.

## Rendimiento de la búsqueda

`npm run db:perf` mide `public.search_species()` con un catálogo sintético del tamaño del real (#70). No corre en el CI: es una orden aparte, para repetirla cuando cambie la búsqueda, sus índices o el tamaño previsto del catálogo.

Qué hace, siempre sobre la base desechable de las pruebas (nunca sobre los proyectos de Supabase):

1. Aplica todas las migraciones y carga el catálogo sintético de `scripts/db-perf/catalogo-sintetico.sql`, y después hace `vacuum analyze`.
2. Ejecuta como `anon` catorce consultas típicas del autocompletado (prefijos de 2 y 3 letras, prefijo de género, género e inicio de epíteto, abreviatura de género, híbrido natural escrito con «x», nombre con errores, sin tildes, sinónimo, nombre común, sin resultados, epítetos muy frecuentes y una consulta larga), cada una 3 veces para calentar y 30 veces medidas, con el tope de resultados por defecto (10).
3. Reporta por consulta la mediana, el p95 y el máximo del tiempo dentro de la base de datos (con `clock_timestamp()` alrededor de la llamada, sin la red ni PostgREST), las filas devueltas y cuántas veces por llamada se recorrieron los índices de trigramas y, de forma secuencial, `species` y `species_names` (diferencia de `pg_stat_user_indexes` y `pg_stat_user_tables`; hace falta PostgreSQL 15 o posterior).
4. Imprime el tamaño de las tablas e índices del catálogo y de la base completa.

Termina con código 1 si el p95 de alguna consulta supera el objetivo o si alguna no recorre los dos índices de trigramas.

```sh
npm run db:perf
npm run db:perf -- --especies 60000 --sinonimos 160000 --planes
```

| Opción             | Por defecto | Qué es                                                                                                            |
| ------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------- |
| `--generos N`      | 900         | Géneros del catálogo sintético.                                                                                   |
| `--especies N`     | 30000       | Especies e híbridos aceptados.                                                                                    |
| `--sinonimos N`    | 80000       | Sinónimos.                                                                                                        |
| `--comunes N`      | 3000        | Nombres comunes.                                                                                                  |
| `--semilla TEXTO`  | `orki`      | Semilla del generador: la misma semilla con las mismas cifras da exactamente el mismo catálogo.                   |
| `--repeticiones N` | 30          | Ejecuciones medidas de cada consulta, después de 3 de calentamiento.                                              |
| `--umbral-ms N`    | 300         | Objetivo por consulta, comparado con el p95.                                                                      |
| `--planes`         | no          | Muestra además el plan (`explain analyze, buffers`) de la consulta interna de `search_species`, con auto_explain. |

Las cifras por defecto son una estimación del catálogo de orquídeas; se ajustarán cuando la importación del #8 dé las reales. El generador imita los nombres reales en longitud y trigramas, porque de eso depende el rendimiento: unos cincuenta géneros reales y el resto compuestos con sílabas y terminaciones botánicas, epítetos latinizados con muchos repetidos entre géneros (`alba`, `grandiflora`, `speciosa`...), un reparto de especies por género muy desigual (como Bulbophyllum o Dendrobium frente a géneros de una especie), un 10 % de híbridos con nombre de grex, un 2 % de híbridos naturales y un 3 % de los géneros compuestos escritos con el signo de híbrido (`Phalaenopsis × intermedia`, `× Rhyncholaeliocattleya`), sinónimos que repiten el epíteto en otro género y nombres comunes en español e inglés. Incluye unas especies reales fijas (Phalaenopsis amabilis, Cattleya labiata, Phalaenopsis × intermedia, Doritis pulcherrima...) para que las consultas tengan una respuesta conocida. Cumple todas las restricciones del esquema.

Mide con la versión de PostgreSQL del servidor. Por defecto es el clúster temporal con los binarios locales (en macOS suele ser otra versión, y con una anterior a la 15 no se cuentan los recorridos de los índices); para medir con la 17, como Supabase, levanta un contenedor desechable y pásalo en `ORKI_TEST_DB_URL`:

```sh
docker run -d --rm --name orki-perf -e POSTGRES_USER=supabase_admin -e POSTGRES_PASSWORD=desechable -p 127.0.0.1:55417:5432 postgres:17
ORKI_TEST_DB_URL=postgresql://supabase_admin:desechable@127.0.0.1:55417/postgres npm run db:perf
docker stop orki-perf
```

### Resultados

20 de noviembre de 2026, con las cifras por defecto (900 géneros, 30 000 especies, de ellas 3768 híbridos, 80 000 sinónimos y 3000 nombres comunes) y la semilla `orki`. PostgreSQL 17.12 en un contenedor `postgres:17` (Podman, máquina virtual de 4 CPU y 3,7 GB) sobre un Apple M4 Pro. La carga del catálogo tarda unos 6 s.

"Antes" es la búsqueda sin la migración `20261120210000_ajustes_de_busqueda.sql`, medida el mismo día con el mismo catálogo y las mismas consultas; "después", con ella: las consultas de menos de 3 caracteres buscan solo por prefijo y la normalización ignora el signo de híbrido.

| Consulta                   | Texto                                                        | Antes: mediana (ms) | Antes: p95 (ms) | Mediana (ms) | p95 (ms) | Filas | Índices de trigramas |
| -------------------------- | ------------------------------------------------------------ | ------------------: | --------------: | -----------: | -------: | ----: | -------------------- |
| Prefijo de 2 letras        | `ph`                                                         |               137,3 |           143,1 |         19,1 |     19,7 |    10 | sí                   |
| Prefijo de 3 letras        | `cat`                                                        |                33,9 |            36,0 |         43,4 |     45,5 |    10 | sí                   |
| Prefijo de género          | `dendrob`                                                    |                43,2 |            45,2 |         51,3 |     56,6 |    10 | sí                   |
| Género + inicio de epíteto | `phal amab`                                                  |                21,1 |            24,2 |         23,0 |     28,1 |    10 | sí                   |
| Abreviatura de género      | `den nob`                                                    |                29,7 |            30,9 |         34,1 |     39,1 |    10 | sí                   |
| Híbrido natural con «x»    | `phal x interm`                                              |                 8,3 |             8,9 |         18,8 |     21,4 |    10 | sí                   |
| Nombre completo con error  | `catleya labiatta`                                           |                 8,0 |             8,8 |          9,5 |      9,9 |    10 | sí                   |
| Sin tildes (nombre común)  | `orquidea mariposa`                                          |                19,3 |            20,7 |         22,2 |     22,8 |    10 | sí                   |
| Sinónimo                   | `doritis pulch`                                              |                14,8 |            16,2 |         17,3 |     18,3 |    10 | sí                   |
| Nombre común               | `dancing lady`                                               |                 2,8 |             3,3 |          3,1 |      3,3 |    10 | sí                   |
| Sin resultados             | `xqzvkjw`                                                    |                 0,2 |             0,2 |          0,2 |      0,3 |     0 | sí                   |
| Epíteto muy frecuente      | `grandiflora`                                                |                39,2 |            41,0 |         47,3 |     49,9 |    10 | sí                   |
| Epíteto frecuente y corto  | `alba`                                                       |                10,4 |            10,9 |         12,2 |     13,2 |    10 | sí                   |
| Consulta larga             | `phalaenopsis amabilis subsp. rosenstromii var. grandiflora` |                11,5 |            12,0 |         12,2 |     13,0 |    10 | sí                   |

Todas cumplen el objetivo de 300 ms. Cada llamada recorre los dos índices de trigramas: dos veces cada uno (una por cada rama del `or`: similitud y prefijo), una sola con `ph` (con 2 caracteres no hay rama de similitud) y cuatro con una abreviatura (`den nob`, `phal amab`, `phal x interm`), que busca también la forma expandida. Ninguna recorre `species_names` de forma secuencial. `species` sí se recorre entera una vez por llamada: el planificador prefiere un hash join para añadir los datos de la especie a los candidatos (30 000 filas, alrededor de 1 ms).

Con el doble de catálogo (60 000 especies y 160 000 sinónimos), después de los ajustes, `ph` se queda en 39,7 ms de mediana y 41,6 ms de p95 (antes, 302 ms de p95), y la más lenta es `dendrob`, con 149,1 ms de p95.

Tamaño: el catálogo ocupa 40,5 MB (`species` 13,1 MB y `species_names` 26,7 MB, de los que 14,1 MB son los dos índices de trigramas) y la base completa 48,5 MB, menos de una décima parte de los 500 MB del plan gratuito de Supabase.

Cuidado al leer estas cifras:

- Son de una máquina local rápida y sin carga, no del plan gratuito de Supabase, que usa CPU compartida: allí los tiempos pueden ser bastante mayores. El objetivo se debe comprobar también en el proyecto real cuando esté el catálogo importado (#8).
- El tiempo crece con el número de candidatos (nombres que pasan el filtro de similitud o de prefijo antes de quedarse con la mejor coincidencia de cada especie), no con el de resultados. Antes de los ajustes la consulta más cara era la de 2 letras: `ph` dejaba pasar unos 21 000 nombres, porque `word_similarity` con una consulta tan corta coincide con cualquier nombre que tenga una palabra que empiece por esas letras. Por eso, con menos de 3 caracteres la búsqueda ya no usa la similitud, solo el prefijo.
- El resto de consultas tarda entre un 10 % y un 25 % más después de los ajustes: la normalización hace ahora una sustitución y una expresión regular más (para el signo de híbrido), y se calcula para cada candidato. `phal x interm` no es comparable: antes se buscaba tal cual (con la «x») y ahora como `phal interm`, que encuentra `Phalaenopsis × intermedia` y tiene más candidatos.
