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
- Backoffice: `public.list_catalog_species()`, `public.search_catalog_species()`, `public.list_catalog_genera()`, `public.catalog_summary()` y `public.count_species_plants()`, solo para administradores del catálogo, para la pantalla `/administracion/catalogo` (#99). Ver [Listado del catálogo para el backoffice](#listado-del-catálogo-para-el-backoffice). La pantalla escribe con funciones de administrador (especies: `create_catalog_species()`, `update_catalog_species()`, `set_catalog_species_status()` y `delete_catalog_species()`, #106; nombres, géneros y abreviaturas: `add_species_name()`, `update_species_name()`, `delete_species_name()`, `create_catalog_genus()`, `update_catalog_genus()`, `delete_catalog_genus()`, `add_genus_abbreviation()`, `update_genus_abbreviation()` y `delete_genus_abbreviation()`, #107) y el disparador `validate_edited_imported` deja validada una especie importada que edita un administrador. Ver [Escritura del catálogo desde el backoffice](#escritura-del-catálogo-desde-el-backoffice).
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

| Archivo                               | Qué comprueba                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `esquema.sql`                         | Que las migraciones dejan las tablas, enumerados, extensiones, disparadores y funciones esperados, con su dueño.                                                                                                                                                                                                                                                   |
| `datos_referencia.sql`                | Los cinco géneros de acceso rápido con su abreviatura, el número de géneros y abreviaturas cargados, y que las migraciones no cargan perfiles ni plantas.                                                                                                                                                                                                          |
| `catalogo_unicidad.sql`               | Unicidad sin distinguir mayúsculas y nombres sin espacios sobrantes en géneros, abreviaturas, especies y nombres; referencia obligatoria y única por fuente (`gbif`, `col`).                                                                                                                                                                                       |
| `borrados.sql`                        | Borrados en cascada (abreviaturas, nombres alternativos) y restringidos (géneros y especies en uso).                                                                                                                                                                                                                                                               |
| `plantas_y_perfiles.sql`              | Restricciones de `plants` y `profiles`: validación y especie, textos, fecha, enumerados, idioma y valores por defecto.                                                                                                                                                                                                                                             |
| `sincronizacion.sql`                  | Sincronización de género y tipo al enlazar, desenlazar y cambiar la especie, y `updated_at` y `created_at`.                                                                                                                                                                                                                                                        |
| `acceso_por_rol.sql`                  | Qué pueden leer y escribir `anon`, `authenticated` y `service_role`, y el usuario por defecto tomado del token.                                                                                                                                                                                                                                                    |
| `identidad.sql`                       | `requesting_user_id()`: null sin sesión, el `sub` con sesión, sus permisos y propiedades, y que no abre perfiles ni plantas a `anon`.                                                                                                                                                                                                                              |
| `politicas_plantas_y_perfiles.sql`    | Políticas y permisos de `profiles` y `plants`: cada usuario solo lo suyo, sin cambiar el dueño ni escribir `validation`; el administrador no ve más; `anon` cerrado.                                                                                                                                                                                               |
| `politicas_catalogo.sql`              | Escritura del catálogo: anónimo, usuario sin rol y administrador; tokens que no dan el rol; `is_catalog_admin()`.                                                                                                                                                                                                                                                  |
| `funciones_administrador.sql`         | El guardián `private.require_catalog_admin()` y el patrón de las funciones de administrador, con ejemplos que la regla general acepta y rechaza.                                                                                                                                                                                                                   |
| `busqueda_especies.sql`               | Normalización, índices de trigramas y `search_species()`: errores de tipeo, tildes, prefijos, sinónimos, orden, límites, permisos y que el plan usa los índices.                                                                                                                                                                                                   |
| `busqueda_generos_y_abreviaturas.sql` | Abreviaturas en `search_species()` (con o sin punto, desconocidas, solas, ambiguas) y `search_genera()`: tipeo, tildes, prefijo, abreviatura, límites, permisos, índices y la lista cargada sin choques.                                                                                                                                                           |
| `datos_ejemplo.sql`                   | Que los datos de ejemplo de `datos-ejemplo/` se cargan, que cargarlos dos veces no cambia nada, que no tocan el inventario y que la migración de abreviaturas se aplica sobre ellos.                                                                                                                                                                               |
| `backoffice_catalogo.sql`             | Funciones del backoffice: paginación por clave completa hacia delante y hacia atrás, sin saltos ni repeticiones; filtros solos y combinados con su total; búsqueda (nombre, sinónimo, tipeo, abreviatura, signo, filtros, páginas); géneros; resumen; plantas enlazadas sin exponer datos; permisos e índices.                                                     |
| `backoffice_escritura_especies.sql`   | Escritura de especies desde el backoffice: alta (fuente, espacios, búsqueda inmediata), edición y "editada pasa a validada" (también por escritura directa y no en la importación), propagación a las plantas, lote (todas o ninguna, tope), baja con y sin plantas, cada motivo de error y los permisos.                                                          |
| `backoffice_nombres_y_generos.sql`    | Sinónimos, nombres comunes, géneros y abreviaturas desde el backoffice: idioma solo en los comunes, duplicados y casi iguales por especie, signo «×» de los nothogéneros, acceso rápido, baja de géneros con especies o plantas, abreviaturas con punto y su choque con el género que la tiene, búsqueda inmediata (`search_species`, `search_genera`) y permisos. |
| `fotos_storage.sql`                   | Bucket `plant-photos` (privado, límite y tipos) y políticas de `storage.objects`: anónimo, dos usuarios y un administrador que solo lee las fotos de plantas por validar; otros buckets sin afectar.                                                                                                                                                               |
| `seguridad_general.sql`               | Reglas que valen para cualquier tabla o función futura: RLS en todo `public`, `anon` solo lee, funciones protegidas, ningún bucket público y políticas de Storage solo para `authenticated`.                                                                                                                                                                       |

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
- Orden (migración `20261120230000_busqueda_con_catalogo_real.sql`, que explica cada decisión). Cada especie sale una vez, en la primera de estas clases en la que entra:
  1. Su nombre científico empieza por la consulta, por palabras (`phal amab` → `Phalaenopsis amabilis`).
  2. Uno de sus sinónimos o nombres comunes empieza por la consulta (`laelia purpurata` → Cattleya purpurata, por su sinónimo).
  3. Solo se parece (errores de tipeo, palabras de en medio). Solo rellena lo que falte hasta el tope.

  En las clases 1 y 2, primero lo que coincidió con la consulta expandida (abreviatura), después las especies antes que los híbridos (`type = 'hybrid'`), y al final el nombre por el que coincidió normalizado (sin tildes, mayúsculas ni signo de híbrido) con intercalación `C`: el nombre exacto va antes que sus variedades y el `×` no cambia el orden (`ph` devuelve Phalaenopsis amabilis, amboinensis, aphrodite..., y los híbridos naturales detrás). En la clase 3, de mayor a menor puntuación; a igualdad, el nombre científico antes que los sinónimos y estos antes que los nombres comunes, y después las especies antes que los híbridos y el nombre normalizado. El desempate final es el id.

- Similitud con varias palabras: el nombre tiene que parecerse (con el umbral 0,3) a la consulta entera y también a su segunda palabra, el epíteto, si tiene al menos 3 caracteres. La puntuación es la menor de las dos similitudes (con una sola palabra, la de la consulta), y a igualdad decide la de la consulta entera. Así `dendrobum nobile` ya no deja pasar todos los Dendrobium por compartir la palabra del género.
- Por etapas: cada clase es una consulta aparte que pide solo lo que falta hasta el tope, y las siguientes no se ejecutan si ya está lleno. La similitud va en dos pasadas, con umbral 0,6 y, si no llena el tope, con 0,3; como la puntuación es la menor de las dos similitudes, da exactamente lo mismo que una sola pasada (lo comprueba `tests/busqueda_orden_y_etapas.sql` contra una referencia sin etapas).
- Los índices GIN de trigramas `species_scientific_name_trgm_idx`, `species_names_name_trgm_idx` y `genera_name_trgm_idx` están sobre `public.normalize_search_text(columna)`. Una consulta nueva los usa solo si escribe esa misma expresión con un operador de `extensions.gin_trgm_ops` (`operator(extensions.%>)`, `like`...).
- El índice btree `species_scientific_name_prefix_idx`, sobre `public.normalize_search_text(scientific_name)` con intercalación `C` y el `id` (este, desde la migración del backoffice), resuelve la clase 1 de una sola palabra: lee en orden el rango de los nombres que empiezan por la consulta (`>= 'dendrob'` y `< 'dendrob' || U+10FFFF`) y para en el tope, sin normalizar ni ordenar todo el género. Ocupa 1,9 MB. Lo usa también el listado alfabético del backoffice.
- `search_species()` fija `plan_cache_mode = force_generic_plan`: con planes a medida, Postgres deducía del patrón `LIKE` constante un rango del btree y recorría el género entero en las consultas de varias palabras (`den nob`, 10 ms en lugar de menos de 1).
- Si la normalización vuelve a cambiar, hay que reconstruir (`reindex`) todos los índices que la usan: los tres de trigramas, `genus_abbreviations_search_key`, `species_scientific_name_prefix_idx` y `species_genus_id_name_idx`.
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
- Orden (migración `20261120230000_busqueda_con_catalogo_real.sql`): primero los que coinciden por abreviatura (`ang` devuelve Anguloa, por `Ang.`, antes que Angraecum; `phal` devuelve Phalaenopsis con `Phal.`), después los que empiezan por la consulta y al final los que solo se parecen, de mayor a menor similitud. A igualdad, primero los de acceso rápido (`catl` y `cat` devuelven Cattleya antes que Catasetum), después los géneros botánicos antes que los nothogéneros (los guardados con `×` delante), y al final el nombre normalizado, sin el signo, con intercalación `C`. Se prefirió «no nothogénero» a «más especies» porque se ve en el propio nombre, sin contar filas, y en la práctica coincide: los nothogéneros de COL tienen pocas especies.
- Como en `search_species()`, con menos de 3 caracteres normalizados solo cuentan el prefijo y la abreviatura (`ph` devuelve Phalaenopsis y Phragmipedium, no cualquier género que empiece por `p`), y el signo de híbrido no cuenta (`rhyncholaeliocattleya` encuentra `× Rhyncholaeliocattleya`).
- Mismos límites, propiedades y permisos que `search_species()`: mínimo 2 caracteres normalizados, como mucho 100 caracteres, 10 resultados por defecto y 20 como máximo; `security invoker`, `stable`, `search_path` vacío; la pueden ejecutar `anon`, `authenticated` y `service_role`.

## Listado del catálogo para el backoffice

La pantalla `/administracion/catalogo` (#99) lee el catálogo con cinco funciones de la API, de la migración `20261121100000_listado_del_catalogo_para_el_backoffice.sql`, donde están explicadas las decisiones. El detalle de una especie (sus datos y sus nombres alternativos) se lee de las tablas, que son de lectura pública.

| Función                                                                                                                       | Qué devuelve                                                                                                                                          | Seguridad                                                      |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `list_catalog_species(filter_status, filter_genus_id, filter_type, filter_source, page_size, after_id, before_id, last_page)` | Una página del catálogo en orden alfabético, con filtros opcionales, paginada por clave, con `total_count`, `has_previous` y `has_next` en cada fila. | `security invoker`, exige el rol.                              |
| `search_catalog_species(query, filter_status, filter_genus_id, filter_type, filter_source, page_size, page_number)`           | Una página de la búsqueda por relevancia, con `matched_name`, `matched_name_type`, `total_count` y `current_page`.                                    | `security invoker`, exige el rol.                              |
| `list_catalog_genera(query, quick_access_only, page_size, page_number)`                                                       | Una página de géneros con `abbreviations`, `is_quick_access`, `species_count`, `total_count` y `current_page`.                                        | `security invoker`, exige el rol.                              |
| `catalog_summary()`                                                                                                           | Una fila con géneros, especies, híbridos, sinónimos, nombres comunes y especies por estado y por fuente.                                              | `security invoker`, exige el rol.                              |
| `count_species_plants(target_species_id)`                                                                                     | Cuántas plantas de usuarios (de cualquier dueño y estado) tienen enlazada la especie. Solo el número.                                                 | Función de administrador (`security definer` con el guardián). |

Las filas de especies traen `id`, `scientific_name`, `genus_id`, `genus_name`, `type`, `status`, `source`, `source_ref`, `synonym_count`, `common_name_count`, `created_at` y `updated_at`. Sin coincidencias no devuelven ninguna fila. `page_size` es 50 por defecto y 100 como máximo (nulo, cero o negativo, 50).

Quién puede llamarlas: solo los administradores del catálogo, como el resto del backoffice. Las cuatro que leen el catálogo son `security invoker` (el catálogo es de lectura pública y no hace falta saltarse nada), pero no son una API pública: recorren y cuentan mucho más que `search_species()` y solo las usa esta pantalla. Por eso solo las ejecuta `authenticated` y lo primero que hacen es comprobar `public.is_catalog_admin()`, con el mismo error `42501` que el guardián (que no pueden llamar, porque corren como quien llama y `private` solo lo ejecuta su dueño). `count_species_plants()` lee las plantas de todos los usuarios, que RLS oculta también al administrador, así que es una [función de administrador](#funciones-de-administrador). Ninguna se concede a `anon` ni a `service_role`.

Paginación:

- **Sin texto, por clave.** El orden es el nombre normalizado (sin tildes, mayúsculas ni signo de híbrido) con intercalación `C` y el `id`. La página siguiente son las filas después de la última de la actual (`after_id`), la anterior las de antes de la primera (`before_id`) y `last_page` pide la última, cortada para que coincida con las páginas hacia delante (tiene el resto). Cada página lee solo sus filas del índice: la última cuesta lo mismo que la primera. Por desplazamiento (`offset`) la página n recorre y normaliza las anteriores: la última tardaba 94 ms. Un `id` que ya no existe da la primera página. La app guarda en la URL la clave de la página y su número.
- **Con texto, por número de página.** La consulta se prepara igual que en `search_species()` (mismos límites y abreviaturas). Coincide lo que empieza como lo escrito (nombre científico, y después sinónimos y nombres comunes); solo si nada empieza así (dentro de los filtros), lo que se parece (similitud de al menos 0,3 con la consulta y con el epíteto). En el autocompletado la similitud rellena detrás de los prefijos; en una tabla con todas las coincidencias, sumarla siempre añadiría miles de nombres que solo se parecen y costaría calcularla para todos. El orden es el de `search_species()`. El conjunto se calcula entero en cada llamada (hace falta para el total y el orden), así que todas las páginas cuestan lo mismo; lo que pesa es el número de candidatos: el peor caso medido son los prefijos de dos letras de géneros grandes (`ca`, unos 2000 nombres). Una página más allá de la última devuelve la última.
- Los recuentos son exactos.

Índices:

- `species_scientific_name_prefix_idx` se redefine como (`normalize_search_text(scientific_name) collate "C"`, `id`): el orden completo del listado, para leer una página desde una clave sin normalizar ninguna otra fila. Sigue sirviendo a `search_species()` (sus rangos ordenan por nombre e id).
- `species_genus_id_name_idx` (`genus_id`, nombre normalizado, `id`): las páginas de un género sin recorrer las del resto. 2,5 MB.
- No llevan índice los filtros por estado, tipo y fuente (pocos valores y uno domina: con el catálogo real todo es importado de COL): se aplican sobre las filas que da el índice alfabético; en el peor caso, un valor que casi no aparece, se recorre el índice entero, unos 3 ms. Contar los nombres de cada especie de la página usa `species_names_species_id_name_key`, que empieza por `species_id`; los totales sin filtros, `species_genus_id_idx` (recorrido solo del índice). Las funciones fijan `plan_cache_mode = force_custom_plan` para que cada consulta se planifique con los valores de la llamada (un filtro nulo desaparece y uno con valor usa su índice).

### Rendimiento con el catálogo real

21 de noviembre de 2026, COL26.10 XR cargado con `orki-catalogo cargar` (755 géneros, 32 464 especies, 60 000 sinónimos), PostgreSQL 17.12 en un contenedor `postgres:17` (Podman, 4 CPU y 3,7 GB) sobre un Apple M4 Pro, como `authenticated` con el rol de administrador, 20 ejecuciones medidas tras 3 de calentamiento, tiempo dentro de la base (incluye una búsqueda del id de prueba por nombre, sin índice, de alrededor de 1 ms):

| Llamada                                                       |       Mediana (ms) |           p95 (ms) |       Filas |
| ------------------------------------------------------------- | -----------------: | -----------------: | ----------: |
| Listado: primera página                                       |                1,3 |                1,6 |          50 |
| Listado: última página                                        |                1,1 |                1,1 |          14 |
| Listado: página tras Phalaenopsis amabilis                    |                2,1 |                4,9 |          50 |
| Listado: página antes de Phalaenopsis amabilis                |                2,0 |                2,1 |          50 |
| Listado: género Zygopetalum                                   |                0,3 |                0,3 |           7 |
| Listado: Bulbophyllum, última página                          |                0,4 |                0,5 |          34 |
| Listado: híbridos / su última página                          |          1,3 / 1,1 |          1,6 / 1,4 |      50 / 8 |
| Listado: validadas (ninguna)                                  |                0,9 |                1,1 |           0 |
| Listado: importadas, COL y especies                           |                1,8 |                1,9 |          50 |
| Listado: 100 filas                                            |                1,6 |                1,6 |         100 |
| Búsqueda: `ph` / `ca` / `bu`                                  | 13,2 / 28,9 / 21,0 | 13,4 / 29,3 / 22,1 |          50 |
| Búsqueda: `dendrob`                                           |               18,4 |               18,8 |          50 |
| Búsqueda: `bulb`, página 40                                   |               26,1 |               27,7 |          50 |
| Búsqueda: `phal amab` / `den nob` / `laelia purpurata`        |    1,1 / 7,3 / 0,5 |    1,1 / 7,6 / 0,6 |   4 / 2 / 2 |
| Búsqueda: `catleya labiatta` / `dendrobum nobile` (similitud) |          3,9 / 2,6 |          3,9 / 2,9 |     24 / 28 |
| Búsqueda: `masdevalia` / `alba` / `grandiflora` (similitud)   | 18,9 / 29,3 / 33,1 | 19,8 / 32,4 / 34,5 |          50 |
| Búsqueda: `dendrob` solo híbridos                             |                8,7 |                9,0 |          21 |
| Géneros: primera / última página / texto `den`                |    1,6 / 1,4 / 2,8 |    1,6 / 1,5 / 2,9 | 50 / 5 / 21 |
| Resumen                                                       |                3,8 |                4,1 |           1 |
| Plantas de una especie                                        |                0,8 |                0,8 |           1 |

Todas quedan por debajo de 35 ms; con el factor de unas 7 veces del plan gratuito (ver "Resultados con el catálogo real"), unos 250 ms en el peor caso. Los planes (con `auto_explain`) recorren los índices descritos; la búsqueda añade los datos de la especie a los candidatos con un hash join que lee `species` entera (unos 32 000 filas, 1 ms), como `search_species()`. Con la migración, `npm run db:perf -- --catalogo-real` da para `search_species()` los mismos tiempos que antes. Los dos índices suman 3,1 MB al catálogo. Falta medirlo en el proyecto de desarrollo.

## Escritura del catálogo desde el backoffice

La pantalla `/administracion/catalogo` escribe el catálogo con funciones de administrador de las migraciones `20261121120000_escritura_de_especies_del_backoffice.sql` (especies, #106) y `20261121130000_nombres_generos_y_abreviaturas_del_backoffice.sql` (sinónimos, nombres comunes, géneros y abreviaturas, #107), donde están explicadas las decisiones. Las políticas RLS de escritura (#65) no cambian: un administrador puede seguir escribiendo directamente en las tablas, y lo que no puede depender de la interfaz (que una especie editada quede validada) lo hace un disparador.

| Función                                                                                              | Qué hace                                                                                                                                                                        | Devuelve                       |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `create_catalog_species(new_scientific_name, new_genus_id, new_type, new_status = 'validated')`      | Da de alta una especie o un híbrido con fuente `curated` y sin `source_ref`. Estado `validated` u `observed` (no `imported`).                                                   | La especie (`public.species`). |
| `update_catalog_species(target_species_id, new_scientific_name, new_genus_id, new_type, new_status)` | Cambia el nombre, el género, el tipo y el estado en una sola sentencia; la fuente y su referencia no se tocan. El nombre solo se compara con los demás si cambia.               | La especie como queda.         |
| `set_catalog_species_status(target_species_ids, new_status)`                                         | Pone un estado a un lote de 1 a 100 especies (los repetidos cuentan una vez), todas o ninguna: si falta alguna, no cambia nada. Solo escribe las que tienen otro estado.        | Cuántas cambiaron.             |
| `delete_catalog_species(target_species_id)`                                                          | Borra una especie sin plantas enlazadas (de ningún dueño ni estado), con sus nombres. Bloquea la especie antes de contar, así que nadie la enlaza entre la cuenta y el borrado. | Nada.                          |

- Todas son `security definer` con el guardián como primera sentencia, `search_path` vacío y solo ejecutables por `authenticated` (ver [Funciones de administrador](#funciones-de-administrador)): cuentan las plantas de todos los usuarios, que RLS oculta al administrador, y usan funciones auxiliares de `private`. Un usuario sin rol, `anon` y la clave de servicio reciben `42501`.
- Por qué funciones y no escrituras directas: cada operación es una transacción (datos y estado a la vez; el lote entero o nada), los rechazos llevan un motivo estable y los datos para explicarlos (qué especie tiene ya el nombre, cuántas plantas impiden borrar), pueden rechazar lo que no es una restricción del esquema (un nombre que solo se diferencia de otro en tildes o en el signo «×»: el catálogo real ya trae pares así, así que no puede ser un índice único) y son el punto único por el que el backoffice escribe, donde la auditoría (#23) podrá registrar la acción con su sentido además de los cambios de fila.
- Los nombres se guardan sin espacios sobrantes (`private.clean_catalog_text()`, la misma regla que las restricciones `_clean`); vacío es un error.
- Cambiar el género o el tipo se propaga a las plantas enlazadas con el disparador `propagate_to_plants`; la pantalla pide antes el número con `count_species_plants()` y lo muestra en la confirmación.
- Una especie nueva o renombrada se encuentra al momento en `search_species()` y en `search_catalog_species()`: los índices se actualizan con la fila. Lo mismo un sinónimo o un nombre común (`search_species()`) y una abreviatura nueva, en las dos búsquedas (`Rst. gutt`, `rst`).

### Nombres, géneros y abreviaturas

| Función                                                                        | Qué hace                                                                                                                         |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `add_species_name(target_species_id, new_name, new_type, new_language = null)` | Añade un sinónimo o un nombre común. Devuelve la fila de `species_names`.                                                        |
| `update_species_name(target_name_id, new_name, new_type, new_language = null)` | Cambia el texto, el tipo (se puede pasar de sinónimo a nombre común) y el idioma.                                                |
| `delete_species_name(target_name_id)`                                          | Quita un nombre.                                                                                                                 |
| `create_catalog_genus(new_name, new_is_quick_access = false)`                  | Crea un género. Devuelve la fila de `genera`.                                                                                    |
| `update_catalog_genus(target_genus_id, new_name, new_is_quick_access)`         | Renombra (también poner o quitar el signo «×») y marca o quita el acceso rápido. No cambia el nombre científico de sus especies. |
| `delete_catalog_genus(target_genus_id)`                                        | Borra un género sin especies ni plantas de usuarios registradas con él sin especie (`plants.genus_id`), con sus abreviaturas.    |
| `add_genus_abbreviation(target_genus_id, new_abbreviation)`                    | Añade una abreviatura. Devuelve la fila de `genus_abbreviations`.                                                                |
| `update_genus_abbreviation(target_abbreviation_id, new_abbreviation)`          | Cambia una abreviatura.                                                                                                          |
| `delete_genus_abbreviation(target_abbreviation_id)`                            | Quita una abreviatura.                                                                                                           |

- Mismo patrón que las de especies (definer, guardián primero, solo `authenticated`) y los mismos errores con motivo.
- **Nombres:** únicos por especie sin distinguir mayúsculas ni el tipo (`species_names_species_id_name_key`), y además no pueden repetir el nombre científico de la propia especie ni otro de sus nombres que solo cambie en tildes o en el signo «×». El mismo nombre en otra especie sí vale. El idioma, según el esquema, es opcional y solo tiene sentido en los nombres comunes: la función lo guarda solo en ellos (los sinónimos son nombres científicos), con la subetiqueta principal en minúsculas (`ES` → `es`, `pt-BR`), y rechaza lo que no cumple `species_names_language_format`. Un nombre añadido a mano no lo toca la importación (ver [su README](../scripts/catalog-import/README.md)).
- **Géneros:** una sola palabra; un nothogénero lleva «× » delante, como lo escribe la fuente (se acepta pegado, `×Mokara`, y se guarda `× Mokara`). Dos géneros no pueden llamarse igual sin distinguir mayúsculas (`genera_name_key`) ni igual tras normalizar (sin tildes ni signo: `Mokara` y `× Mokara`). La marca de acceso rápido decide los chips del formulario de registro de todos los usuarios.
- **Abreviaturas:** se guardan con su punto final (si llega sin él, se añade) y son una sola palabra. Una abreviatura pertenece a un solo género, sin distinguir mayúsculas, tildes ni el punto: la clave es la de `genus_abbreviations_search_key`, la misma con la que la búsqueda la resuelve, y el error dice qué género la tiene.

### Errores

Cada rechazo lleva un código SQLSTATE estándar (que PostgREST traduce a un estado HTTP), un mensaje en español y, en `detail` (`details` en la respuesta de la API), un objeto JSON con el motivo (`reason`) y sus datos. Los lanza `private.raise_catalog_error()`; la app los traduce en `apps/web/src/lib/catalogWrites.ts` y, si una fila la rechaza directamente una restricción (por ejemplo, dos altas a la vez con el mismo nombre: la segunda la detiene el índice único), traduce el nombre de la restricción.

| Código  | Motivo                       | Cuándo                                                                                               | Datos                                             |
| ------- | ---------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `22023` | `name_required`              | El nombre queda vacío.                                                                               |                                                   |
| `22023` | `type_required`              | Falta el tipo.                                                                                       |                                                   |
| `22023` | `status_required`            | Falta el estado.                                                                                     |                                                   |
| `22023` | `invalid_status`             | Un alta como `imported`.                                                                             |                                                   |
| `22023` | `no_species`                 | El lote está vacío.                                                                                  |                                                   |
| `22023` | `too_many_species`           | El lote tiene más de 100 especies.                                                                   | `max`                                             |
| `23505` | `duplicate_name`             | Otra especie tiene el nombre sin distinguir mayúsculas.                                              | `existing_id`, `existing_name`                    |
| `23505` | `similar_name`               | Otra especie tiene el mismo nombre normalizado (`normalize_search_text()`: sin tildes ni signo «×»). | `existing_id`, `existing_name`                    |
| `23503` | `genus_not_found`            | El género no existe.                                                                                 |                                                   |
| `23503` | `species_has_plants`         | Borrar una especie con plantas enlazadas.                                                            | `plant_count`                                     |
| `P0002` | `species_not_found`          | La especie no existe (en un lote, cuántas faltan).                                                   | `missing_count`                                   |
| `22023` | `name_type_required`         | Falta el tipo de nombre.                                                                             |                                                   |
| `22023` | `invalid_language`           | El idioma no es una etiqueta corta (`es`, `en`, `pt-BR`).                                            |                                                   |
| `23505` | `duplicate_alternative_name` | La especie ya tiene el nombre sin distinguir mayúsculas.                                             | `existing_name`, `existing_type`                  |
| `23505` | `similar_alternative_name`   | La especie ya tiene uno que solo cambia en tildes o en el signo «×».                                 | `existing_name`, `existing_type`                  |
| `23505` | `name_is_scientific_name`    | Es el nombre científico de la propia especie.                                                        |                                                   |
| `P0002` | `name_not_found`             | El nombre ya no existe.                                                                              |                                                   |
| `22023` | `invalid_genus_name`         | El nombre de género no es una palabra (con «× » delante si es un nothogénero).                       |                                                   |
| `22023` | `quick_access_required`      | Falta la marca de acceso rápido.                                                                     |                                                   |
| `23505` | `duplicate_genus`            | Otro género tiene el nombre sin distinguir mayúsculas.                                               | `existing_name`                                   |
| `23505` | `similar_genus`              | Otro género tiene el mismo nombre normalizado (sin tildes ni signo «×»).                             | `existing_name`                                   |
| `23503` | `genus_has_species`          | Borrar un género con especies.                                                                       | `species_count`                                   |
| `23503` | `genus_has_plants`           | Borrar un género con plantas de usuarios registradas con él.                                         | `plant_count`                                     |
| `P0002` | `genus_not_found`            | El género no existe (al editarlo o borrarlo; al elegirlo para una especie, `23503`).                 |                                                   |
| `22023` | `invalid_abbreviation`       | La abreviatura no es una palabra con su punto final.                                                 |                                                   |
| `23505` | `abbreviation_taken`         | Otra abreviatura con la misma clave ya es de un género.                                              | `genus_id`, `genus_name`, `existing_abbreviation` |
| `P0002` | `abbreviation_not_found`     | La abreviatura no existe.                                                                            |                                                   |

`tests/soporte/ayudantes.sql` tiene `pruebas.motivo_error(sentencia, dato)`, que devuelve el código y el motivo del error de una sentencia (`23505 duplicate_name`), y opcionalmente uno de sus datos.

### Editada pasa a validada

El disparador `validate_edited_imported` (`before update of scientific_name, genus_id, type` en `species`, función `private.validate_edited_imported_species()`) cambia el estado a `validated` cuando la especie era `imported`, sigue `imported` en la actualización, le cambia el nombre, el género o el tipo, y la petición es de un administrador del catálogo (`public.is_catalog_admin()`). Así la importación de COL, que solo actualiza las especies que siguen importadas, no pisa la edición.

- Vale para `update_catalog_species()` y para una escritura directa en la tabla por la API, sin depender de la interfaz.
- No actúa en la importación ni en la carga de híbridos: escriben con conexión directa, sin token.
- Si en la misma edición el administrador elige `observed`, se respeta. Cambiar solo el estado (también volver a `imported`) no lo activa.
- **Lista curada de híbridos:** sus entradas ya entran como `validated`, así que una edición no cambia su estado y la siguiente carga de la lista la revierte mientras siga validada (ver [el README de la importación](../scripts/catalog-import/README.md)). La pantalla lo avisa; para protegerla, el administrador la marca como `observed`.
- La prueba de que una importación posterior no la pisa está en las de la importación (`scripts/catalog-import/tests/`, especie validada u observada que no cambia); aquí se prueba que la edición la deja validada.

## Abreviaturas de género

`genus_abbreviations` guarda cada abreviatura con su punto (`Phal.`) y cada una pertenece a un solo género. Dos índices únicos lo garantizan: `genus_abbreviations_abbreviation_key`, sin distinguir mayúsculas, y `genus_abbreviations_search_key`, sobre la clave de búsqueda (`normalize_search_text(rtrim(abbreviation, '.'))`), que impide además guardar `Phal` o `Phál.` junto a `Phal.` y que usan las dos búsquedas para resolver la abreviatura.

Las migraciones cargan las abreviaturas estándar de la RHS (las de las etiquetas de vivero) de 43 géneros: los cinco de acceso rápido y 38 géneros y nothogéneros comunes en cultivo, algunos ya fusionados en otros pero todavía presentes en etiquetas (Blc., Slc., Dtps., Ascda., Soph.). La carga crea el género si no existe, sin marcarlo de acceso rápido, y no duplica ni falla si el género o la abreviatura ya existen (por ejemplo, con los datos de ejemplo). El criterio para los choques y las abreviaturas que conviene revisar contra la lista de la RHS están anotados en la migración. Una abreviatura nueva o corregida va en una migración nueva.

## Importación del catálogo

El catálogo de especies se carga desde el Catalogue of Life eXtended Release (COL XR) con `orki-catalogo cargar` (`scripts/catalog-import/`, issue #8; sus reglas están en [su README](../scripts/catalog-import/README.md), y cómo se ejecuta en local, en desarrollo y en producción, con el workflow manual `importar-catalogo.yml`, en [Ejecución por ambiente](../scripts/catalog-import/README.md#ejecución-por-ambiente)). Requiere las migraciones aplicadas en el ambiente. Lo que el esquema aporta:

- `species_source` tiene el valor `col` (migración `20261120220000_fuente_col_en_especies.sql`). `gbif` se conserva aunque no se use. El valor va solo en su migración porque Postgres no deja usar un valor de enumerado en la misma transacción que lo añade, y cada migración se aplica en su propia transacción (lo hacen así la CLI de Supabase y `npm run db:test`).
- `species_col_has_source_ref` (migración `20261120220100_col_exige_referencia.sql`) exige `source_ref` a lo importado de COL, igual que `species_gbif_has_source_ref` con `gbif`. La carga encuentra cada especie por la restricción única `(source, source_ref)`.
- La carga escribe con conexión directa como `postgres` (dueño de las tablas): los disparadores `set_updated_at` y `propagate_species_to_plants` se aplican igual que desde la API, así que un cambio de género o de tipo de una especie importada llega a las plantas enlazadas. Solo escribe las filas que cambian, para no mover `updated_at` al repetirla.
- La lista curada de híbridos (`scripts/catalog-import/data/hibridos.csv`, issue #9) se carga con `orki-catalogo cargar-hibridos` por el mismo flujo: fuente `curated`, `source_ref` igual al identificador de la fila, tipo `hybrid` y estado `validated`. No necesita migraciones propias.
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

## Fotos de plantas (Storage)

Las fotos de las plantas (#10) viven en el bucket privado `plant-photos` de Supabase Storage, creado por la migración `20261121090000_bucket_de_fotos_de_plantas.sql` (#80), donde están explicadas las decisiones y las fuentes consultadas.

Bucket:

- Privado (`public = false`): nada se sirve sin token; la app lee con descarga autenticada o con URL firmadas.
- Tope de 1 MiB por archivo (`file_size_limit = 1048576`, en bytes) y solo `image/webp` e `image/jpeg` (`allowed_mime_types`). La app comprime en el navegador (objetivo: menos de 300 KB la foto y 30 KB la miniatura); el tope deja margen y rechaza una foto sin comprimir. JPEG queda como alternativa para los navegadores que no generan WebP.

Convención de rutas, dentro del bucket:

```text
<id de usuario de Clerk>/<id de la planta>/photo-<versión>.<webp|jpg>
<id de usuario de Clerk>/<id de la planta>/thumb-<versión>.<webp|jpg>
```

- El primer segmento es el dueño (el claim `sub`, `public.requesting_user_id()`); es lo único que miran las políticas del dueño.
- El segundo es `plants.id`, en minúsculas.
- `<versión>` es nueva en cada subida y la misma para la foto y su miniatura. Reemplazar una foto es subir dos objetos nuevos, guardar sus rutas en `plants.photo_path` y `plants.thumbnail_path` y borrar los anteriores, así ninguna caché sirve la foto vieja.
- `photo_path` y `thumbnail_path` guardan la ruta sin el nombre del bucket.

Quién puede qué (políticas de `storage.objects`, todas para `authenticated` y limitadas a `bucket_id = 'plant-photos'`):

| Política                                       | Orden    | Qué deja hacer                                                                                                           |
| ---------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `plant_photos_select_own_or_pending_for_admin` | `select` | Al dueño, leer su carpeta; al administrador del catálogo, además la foto y la miniatura actuales de plantas por validar. |
| `plant_photos_insert_own`                      | `insert` | Subir a su carpeta.                                                                                                      |
| `plant_photos_update_own`                      | `update` | Reemplazar (upsert) sus objetos, sin moverlos a otra carpeta ni a otro bucket.                                           |
| `plant_photos_delete_own`                      | `delete` | Borrar sus objetos.                                                                                                      |

- Lo que exige cada operación del cliente de Storage: subir, `insert`; subir con `upsert`, `select`, `insert` y `update`; descargar, listar y `createSignedUrl(s)`, `select`; borrar (`remove`), `select` y `delete`.
- Sin sesión (`anon`) no hay ninguna política: no se lee ni se sube nada. Un token sin `sub` tampoco ve nada.
- El administrador no escribe ni borra fotos ajenas. Su lectura pasa por `public.is_pending_plant_photo(object_name)`, una [función de administrador](#funciones-de-administrador) (`security definer`, con el guardián) que solo responde verdadero o falso: la planta del segundo segmento existe, es del usuario del primero, está por validar y la ruta es exactamente su `photo_path` o su `thumbnail_path`. La política la llama dentro de un `case when (select public.is_catalog_admin())`, para que los usuarios sin rol nunca lleguen al guardián. Busca la planta por su clave primaria. La API la expone en `/rest/v1/rpc/is_pending_plant_photo`, solo para administradores.
- `tests/seguridad_general.sql` falla si aparece un bucket público no declarado en la prueba o una política de Storage para `anon`, para `PUBLIC` o `for all`.

Limitación de las pruebas: la base desechable no tiene Supabase Storage. `scripts/db-desechable/supabase-minimo.sql` simula lo mínimo del esquema `storage` (las tablas `buckets` y `objects`, `storage.foldername()`, el bloqueo de borrados directos y los permisos de los roles) a partir de las migraciones de [supabase/storage](https://github.com/supabase/storage), así que `tests/fotos_storage.sql` comprueba las políticas tal como las evalúa Postgres, con la orden SQL que corresponde a cada operación, pero no la API de Storage: ni los límites de tamaño y de tipo, ni las URL firmadas, ni cómo pasa el token de Clerk. Eso se comprueba al aplicar la migración en desarrollo. En Supabase, `postgres` crea las políticas de `storage.objects` sin ser su dueño gracias a `supautils.policy_grants`; aquí es miembro de `supabase_storage_admin`, que es más permisivo: una migración no debe alterar tablas de `storage`, porque aquí pasaría y en Supabase fallaría.

### Limpieza de fotos huérfanas

`scripts/fotos-huerfanas.mjs` (`npm run fotos:huerfanas`, #83) compara los objetos del bucket `plant-photos` con `photo_path` y `thumbnail_path` de todas las plantas. La app borra los archivos al reemplazar, quitar o eliminar (ver el README principal), pero un fallo de red a mitad puede dejar restos.

```sh
npm run fotos:huerfanas -- --ambiente desarrollo                    # solo lista
npm run fotos:huerfanas -- --ambiente desarrollo --borrar           # borra
npm run fotos:huerfanas -- --ambiente produccion --borrar --confirmar-produccion
```

- Recorre el bucket (`<usuario>/<planta>/`) y lee las plantas de 1 000 en 1 000.
- Informa de los objetos que no son la foto ni la miniatura de ninguna planta (`sin-planta`, o `fuera-de-convencion` si la ruta no sigue la convención), de los recientes que no toca y de las plantas que apuntan a un archivo que no existe. Esto último solo se informa: el script nunca cambia una planta.
- Por defecto es un modo de prueba: lista y no borra nada. Con `--borrar`, borra en lotes de 100 solo los huérfanos con la antigüedad mínima (`--antiguedad-minima-horas`, 24 por defecto), para no llevarse una subida en curso cuya planta aún no apunta a ella. Un objeto sin fecha nunca se borra.
- Protección de ambiente: `--ambiente desarrollo|produccion` es obligatorio y `SUPABASE_PROJECT_REF` tiene que ser el ref de ese ambiente (los mismos que `scripts/supabase-db.mjs`); si no coincide, no se ejecuta nada. Para borrar en producción hace falta además `--confirmar-produccion`.
- Credencial: `SUPABASE_SECRET_KEY`, la clave secreta del proyecto (`sb_secret_...`, en Project Settings > API Keys; o la `service_role` heredada), y `SUPABASE_PROJECT_REF`. Se leen del entorno o de `supabase/.env` y nunca se imprimen. Hace falta esa clave porque el script tiene que ver los objetos y las plantas de todos los usuarios y las políticas solo dejan a cada uno ver lo suyo. Leer `storage.objects` con una conexión directa a Postgres serviría para listar, pero no para borrar: Supabase no deja borrar objetos con SQL, solo con la API de Storage.
- **Riesgo:** la clave secreta se salta RLS y puede leer y borrar todo el proyecto. No está en GitHub ni en ningún workflow; tenla en tu máquina solo mientras haces la limpieza, empieza siempre por el modo de prueba y revisa la lista antes de `--borrar`.
- La comparación es lógica pura en `apps/web/src/photos/orphans.ts`, probada con Vitest (`orphans.test.ts`, que comprueba también que el modo de prueba no borra). Node la carga quitando los tipos de TypeScript (Node 24). El script no se ha ejecutado contra ningún proyecto real.

## Tipos de TypeScript

La app usa tipos generados a partir de estas migraciones (`apps/web/src/lib/database.types.ts`), con los que el cliente de Supabase comprueba al compilar tablas, columnas y enumerados. Cuándo regenerarlos:

- Después de crear o cambiar una migración (antes de hacer commit).
- Después de actualizar la CLI de Supabase o Prettier, si `npm run db:types:check` dice que no coinciden.

`npm run db:types` los genera sin Docker ni credenciales, sobre la misma base desechable que las pruebas, y solo con el esquema `public`. `npm run db:types:check` hace lo mismo sin escribir y falla si el archivo versionado es distinto; es lo que ejecuta el CI. Si la migración añade una tabla o un enumerado, añade también su alias en `apps/web/src/lib/database.ts`. El detalle está en la sección [Tipos de TypeScript del esquema](../README.md#tipos-de-typescript-del-esquema) del README principal.

## Rendimiento de la búsqueda

`npm run db:perf` mide `public.search_species()` con un catálogo sintético del tamaño del real (#70) o, con `--catalogo-real`, con la exportación real de COL. No corre en el CI: es una orden aparte, para repetirla cuando cambie la búsqueda, sus índices o el catálogo.

Qué hace, siempre sobre la base desechable de las pruebas (nunca sobre los proyectos de Supabase):

1. Aplica todas las migraciones y carga el catálogo sintético de `scripts/db-perf/catalogo-sintetico.sql` (o, con `--catalogo-real RUTA`, la exportación de COL con `orki-catalogo cargar --ambiente local --escribir`; ver [su README](../scripts/catalog-import/README.md)), y después hace `vacuum analyze`.
2. Ejecuta como `anon` 31 consultas típicas del autocompletado (prefijos de 2 y 3 letras, prefijo de género, abreviaturas solas y con epíteto, género e inicio de epíteto, híbrido natural con y sin «x», nombres con errores, sin tildes, sinónimos, nombre común, sin resultados, epítetos muy frecuentes y una consulta larga), cada una 3 veces para calentar y 30 veces medidas, con el tope de resultados por defecto (10).
3. Reporta por consulta la mediana, el p95 y el máximo del tiempo dentro de la base de datos (con `clock_timestamp()` alrededor de la llamada, sin la red ni PostgREST), las filas devueltas y cuántas veces por llamada se recorrieron los índices de búsqueda (el btree de prefijo y los dos de trigramas) y, de forma secuencial, `species` y `species_names` (diferencia de `pg_stat_user_indexes` y `pg_stat_user_tables`; hace falta PostgreSQL 15 o posterior).
4. Imprime el tamaño de las tablas e índices del catálogo y de la base completa.

Termina con código 1 si el p95 de alguna consulta supera el objetivo, si alguna no recorre ningún índice de búsqueda o si recorre `species_names` de forma secuencial. Desde la búsqueda por etapas, una consulta que se resuelve por prefijo de una palabra (`dendrob`) solo recorre el btree de prefijo.

```sh
npm run db:perf
npm run db:perf -- --especies 60000 --sinonimos 160000 --planes
npm run db:perf -- --catalogo-real /ruta/a/export.zip   # necesita uv
```

| Opción                 | Por defecto | Qué es                                                                                                                                                     |
| ---------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--generos N`          | 900         | Géneros del catálogo sintético.                                                                                                                            |
| `--especies N`         | 30000       | Especies e híbridos aceptados.                                                                                                                             |
| `--sinonimos N`        | 80000       | Sinónimos.                                                                                                                                                 |
| `--comunes N`          | 3000        | Nombres comunes.                                                                                                                                           |
| `--semilla TEXTO`      | `orki`      | Semilla del generador: la misma semilla con las mismas cifras da exactamente el mismo catálogo.                                                            |
| `--repeticiones N`     | 30          | Ejecuciones medidas de cada consulta, después de 3 de calentamiento.                                                                                       |
| `--umbral-ms N`        | 300         | Objetivo por consulta, comparado con el p95.                                                                                                               |
| `--planes`             | no          | Muestra además el plan (`explain analyze, buffers`) de las consultas internas de `search_species` que tardan 1 ms o más (una por etapa), con auto_explain. |
| `--catalogo-real RUTA` | no          | Carga la exportación de COL indicada (`export.zip`) en lugar del catálogo sintético; las cinco opciones del generador no se usan.                          |

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

### Resultados con el catálogo real

20 de noviembre de 2026, con COL26.10 XR cargado con `orki-catalogo cargar` (752 géneros de la fuente más 3 de las migraciones, 32 464 especies, de ellas 1408 híbridos naturales, 60 000 sinónimos y ningún nombre común). PostgreSQL 17.12 en un contenedor `postgres:17` (Podman, máquina virtual de 4 CPU y 3,7 GB) sobre un Apple M4 Pro, como `anon`, 30 ejecuciones medidas por consulta tras 3 de calentamiento:

```sh
podman run -d --rm --name orki-perf -e POSTGRES_USER=supabase_admin -e POSTGRES_PASSWORD=desechable -p 127.0.0.1:55417:5432 postgres:17
ORKI_TEST_DB_URL=postgresql://supabase_admin:desechable@127.0.0.1:55417/postgres npm run db:perf -- --catalogo-real /ruta/a/export.zip
podman stop orki-perf
```

"Antes" es la búsqueda sin la migración `20261120230000_busqueda_con_catalogo_real.sql` (el mismo día, con la misma orden y el archivo de la migración apartado); "después", con ella. "Desarrollo" es la latencia de la base en el proyecto de desarrollo (plan gratuito de Supabase, CPU compartida) antes de la migración, medida a través de la API restando el viaje de red, mediana de 9. El catálogo no tiene nombres comunes, así que `orquidea mariposa` y `dancing lady` solo prueban la búsqueda sin coincidencias exactas. La última columna son los recorridos por llamada del btree de prefijo, del índice de trigramas de `species` y del de `species_names`, después de la migración.

| Texto                                                        | Desarrollo, antes (ms) | Antes: mediana (ms) | Antes: p95 (ms) | Mediana (ms) | p95 (ms) | Filas | Índices (prefijo / trigramas sp / nombres) |
| ------------------------------------------------------------ | ---------------------: | ------------------: | --------------: | -----------: | -------: | ----: | ------------------------------------------ |
| `ph`                                                         |                     74 |                16,3 |            17,0 |          0,1 |      0,1 |    10 | 1 / 0 / 0                                  |
| `cat`                                                        |                        |                42,8 |            46,1 |          0,1 |      0,1 |    10 | 1 / 0 / 0                                  |
| `dendrob`                                                    |                    296 |                41,0 |            42,9 |          0,1 |      0,1 |    10 | 1 / 0 / 0                                  |
| `phal`                                                       |                        |                36,2 |            40,1 |          0,1 |      0,1 |    10 | 1 / 0 / 0                                  |
| `onc`                                                        |                        |                43,8 |            46,1 |          0,1 |      0,1 |    10 | 1 / 0 / 0                                  |
| `paph`                                                       |                        |                35,2 |            38,3 |          0,1 |      0,1 |    10 | 1 / 0 / 0                                  |
| `bulb`                                                       |                        |                46,9 |            48,7 |          0,1 |      0,1 |    10 | 1 / 0 / 0                                  |
| `phal amab`                                                  |                     79 |                16,5 |            19,0 |          8,5 |      9,2 |    10 | 0 / 6 / 6                                  |
| `Phal. amab`                                                 |                        |                16,2 |            17,5 |          8,5 |      8,7 |    10 | 0 / 6 / 6                                  |
| `den nob`                                                    |                    338 |                40,5 |            41,9 |          3,8 |      4,0 |    10 | 0 / 6 / 6                                  |
| `epi rad`                                                    |                        |                46,9 |            47,8 |          5,3 |      6,1 |    10 | 0 / 6 / 6                                  |
| `cattleya lab`                                               |                        |                14,6 |            15,4 |          0,6 |      0,6 |    10 | 0 / 2 / 2                                  |
| `oncidium sph`                                               |                        |                44,0 |            46,3 |          4,4 |      4,6 |    10 | 0 / 6 / 6                                  |
| `vanda coer`                                                 |                        |                15,0 |            16,9 |          8,9 |      9,3 |    10 | 0 / 6 / 6                                  |
| `phal x interm`                                              |                        |                12,3 |            13,2 |         11,0 |     11,5 |    10 | 0 / 6 / 6                                  |
| `phalaenopsis intermedia`                                    |                        |                11,6 |            12,7 |          6,7 |      7,8 |    10 | 0 / 6 / 6                                  |
| `catleya labiata`                                            |                     45 |                17,2 |            17,7 |          1,8 |      2,0 |    10 | 0 / 4 / 4                                  |
| `catleya labiatta`                                           |                        |                13,0 |            14,6 |          1,7 |      2,0 |    10 | 0 / 4 / 4                                  |
| `dendrobum nobile`                                           |                        |                30,0 |            31,7 |          3,0 |      3,5 |    10 | 0 / 6 / 6                                  |
| `masdevalia`                                                 |                        |                16,7 |            17,8 |         15,3 |     15,7 |    10 | 2 / 2 / 4                                  |
| `catl`                                                       |                        |                59,1 |            63,8 |         19,7 |     20,0 |    10 | 2 / 2 / 4                                  |
| `grandiflora`                                                |                     77 |                24,1 |            26,1 |          7,7 |      7,9 |    10 | 2 / 2 / 4                                  |
| `alba`                                                       |                        |                20,7 |            22,4 |         16,7 |     17,4 |    10 | 2 / 2 / 4                                  |
| `doritis pulch`                                              |                        |                 5,3 |             5,5 |          6,4 |      6,6 |    10 | 0 / 6 / 6                                  |
| `doritis pulcherrima`                                        |                        |                 6,8 |             7,1 |          1,6 |      1,8 |    10 | 0 / 4 / 4                                  |
| `laelia purpurata`                                           |                        |                18,7 |            19,1 |         13,8 |     14,5 |    10 | 0 / 6 / 6                                  |
| `sophronitis coccinea`                                       |                        |                 6,0 |             6,4 |          4,7 |      5,0 |    10 | 0 / 6 / 6                                  |
| `orquidea mariposa`                                          |                        |                 3,2 |             3,4 |          2,3 |      2,6 |     2 | 0 / 6 / 6                                  |
| `dancing lady`                                               |                        |                 2,2 |             2,3 |          1,9 |      2,2 |     0 | 0 / 6 / 6                                  |
| `xqzvkjw`                                                    |                        |                 0,2 |             0,2 |          0,1 |      0,1 |     0 | 2 / 4 / 6                                  |
| `phalaenopsis amabilis subsp. rosenstromii var. grandiflora` |                        |                16,6 |            19,8 |         16,6 |     17,1 |     6 | 0 / 6 / 6                                  |

Lectura:

- Todas quedan en un p95 de 20 ms o menos en esta máquina. Las que más bajan son las que pasaban por un género grande: los prefijos de una palabra (`dendrob`, `bulb`, `onc`, de 40-50 ms a 0,1 ms) leen solo 10 filas del btree, y `den nob`, `epi rad`, `oncidium sph` o `dendrobum nobile` ya no recorren el género entero gracias al epíteto. Las más lentas ahora son las de una sola palabra que solo coinciden por similitud con muchos nombres (`catl`, `alba`, `masdevalia`): cada candidato paga la normalización y la similitud.
- Factor del plan gratuito: en las consultas pesadas, desarrollo tardaba unas 7 u 8 veces lo de esta máquina (`dendrob` 296 frente a 41 ms, `den nob` 338 frente a 40,5 ms); en las ligeras, de 3 a 5 veces. Con un factor 7, el peor p95 de aquí (20 ms) serían unos 140 ms en desarrollo, por debajo del objetivo de 300 ms. Hay que confirmarlo midiendo en el proyecto cuando se aplique la migración.
- Ninguna recorre `species` ni `species_names` de forma secuencial. No se cuentan los candidatos por consulta: los recorridos de los índices y el tiempo bastan para ver lo que cambia.
- Tamaño: el índice nuevo ocupa 1,3 MB; el catálogo pasa de 33,4 a 34,7 MB y la base completa de 41,4 a 42,7 MB.
- La tabla de "Resultados" de arriba es del catálogo sintético y de la búsqueda anterior a esta migración, con las 14 consultas que había entonces; `npm run db:perf` mide ahora también las de esta tabla.
