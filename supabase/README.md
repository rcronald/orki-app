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

- Catálogo: `genera` (géneros, con la marca de acceso rápido), `genus_abbreviations` (abreviaturas de género, como Phal.), `species` (especies e híbridos, con su estado, su fuente y la referencia externa de la fuente; lo importado del Catalogue of Life va con fuente `col` y su identificador de COL, obligatorio por la restricción `species_col_has_source_ref`, ver [Importación del catálogo](#importación-del-catálogo)) y `species_names` (sinónimos y nombres comunes). La migración del catálogo carga los cinco géneros de acceso rápido y sus abreviaturas estándar de la RHS, y la de abreviaturas (#69) las de otros 38 géneros y nothogéneros comunes en cultivo (ver [Abreviaturas de género](#abreviaturas-de-género)). Con sesión (`authenticated`) se leen las tablas enteras; sin sesión (`anon`), desde el #231, no se lee ninguna tabla: solo las cuatro funciones del [catálogo público](#catálogo-público). Desde la API solo lo escriben (insertar, editar y borrar) los administradores del catálogo: `authenticated` tiene el permiso y las políticas RLS exigen `(select public.is_catalog_admin())`.
- Catálogo público (#231): `search_public_species()`, `list_public_genera()`, `list_public_genus_species()` y `get_public_species()`, funciones de solo lectura para visitantes sin sesión (y con sesión), con paginación y topes, que solo devuelven las especies públicas. Ver [Catálogo público](#catálogo-público).
- Inventario: `profiles` (perfil de cada usuario de Clerk) y `plants` (ejemplares). El usuario es el id de Clerk, de tipo texto, y por defecto se toma del claim `sub` del token de sesión. Con sesión (`authenticated`), cada usuario lee, crea, actualiza y borra solo su perfil y sus plantas: las políticas comparan con `(select public.requesting_user_id())`, no dejan crear una planta a nombre de otro ni cambiar su dueño, y no dan más acceso al administrador de catálogo. `authenticated` puede escribir todas las columnas de `plants` menos `validation`, que solo ajustan el disparador de sincronización, `service_role` y las futuras funciones de administrador; así un usuario no puede marcar sus plantas como "no identificable" ni validarlas sin especie. Una columna nueva de `plants` hay que concedérsela explícitamente a `authenticated`. Sin sesión (`anon`) no hay ningún acceso.
- Fotos de referencia de las especies (#234): `species_photos`, una por especie, copiada de iNaturalist en dos tamaños WebP al bucket público `species-photos`, con su licencia (solo CC0, dominio público, CC BY y CC BY-SA) y su atribución, y `species_photo_rejections`, la memoria de las fotos que un administrador retiró para que la carga no las reponga. Con sesión se lee la tabla; sin sesión, la foto llega por las funciones del catálogo público. Solo escribe la carga; el administrador retira con `retire_species_photo()`. Ver [Fotos de referencia](#fotos-de-referencia).
- Fotos de las plantas: `plant_photos`, de 0 a 6 fotos por planta con fecha y nota opcionales (#182). La principal se copia a `plants.photo_path`, `thumbnail_path` y `photo_in_bloom`, que se mantienen sincronizadas en los dos sentidos para las versiones instaladas de la app. Cada usuario gestiona solo las suyas y el administrador del catálogo lee las de plantas por validar. Ver [Varias fotos por planta](#varias-fotos-por-planta).
- Identidad: `public.requesting_user_id()` devuelve el id de usuario de Clerk de la petición (`auth.jwt()->>'sub'`), o `null` sin sesión. Es `stable`, `security invoker` y con `search_path` vacío; la pueden ejecutar `anon`, `authenticated` y `service_role` (la API la expone en `/rest/v1/rpc/requesting_user_id`) y no lee ninguna tabla. La usan el panel de diagnóstico de la app y las políticas RLS de perfiles y plantas (#64).
- Rol de administrador: `public.is_catalog_admin()` es verdadera solo si el claim de primer nivel `app_role` del token vale exactamente `catalog_admin` (falsa sin sesión, sin el claim, con otro valor o con el rol en otro claim); nunca devuelve `null`. Mismas propiedades y permisos que `requesting_user_id()`. No hay columna de rol en la base de datos: el rol vive en Clerk (ver [Rol de administrador del catálogo](../README.md#rol-de-administrador-del-catálogo)). El guardián `private.require_catalog_admin()` lanza el error `42501` si la petición no es de un administrador; lo usan las [funciones de administrador](#funciones-de-administrador).
- Búsqueda: `public.search_species(query, max_results)` busca especies por nombre científico, sinónimo o nombre común, tolerando errores de tipeo, tildes, mayúsculas y espacios de más, y expande una abreviatura de género al principio (`Phal. amab`). `public.search_genera(query, max_results)` busca géneros por nombre o abreviatura, para el chip "Otro" del registro. Solo con sesión (desde el #231; sin sesión, `search_public_species()`). Ver [Búsqueda de especies](#búsqueda-de-especies) y [Búsqueda de géneros](#búsqueda-de-géneros).
- Backoffice: `public.list_catalog_species()`, `public.search_catalog_species()`, `public.list_catalog_genera()`, `public.catalog_summary()` y `public.count_species_plants()`, solo para administradores del catálogo, para la pantalla `/administracion/catalogo` (#99). Ver [Listado del catálogo para el backoffice](#listado-del-catálogo-para-el-backoffice). La pantalla escribe con funciones de administrador (especies: `create_catalog_species()`, `update_catalog_species()`, `set_catalog_species_status()` y `delete_catalog_species()`, #106; nombres, géneros y abreviaturas: `add_species_name()`, `update_species_name()`, `delete_species_name()`, `create_catalog_genus()`, `update_catalog_genus()`, `delete_catalog_genus()`, `add_genus_abbreviation()`, `update_genus_abbreviation()` y `delete_genus_abbreviation()`, #107) y el disparador `validate_edited_imported` deja validada una especie importada que edita un administrador. Ver [Escritura del catálogo desde el backoffice](#escritura-del-catálogo-desde-el-backoffice).
- Auditoría: `catalog_audit_log` registra cada alta, edición y baja del catálogo hecha con un token de usuario (disparador `audit_change`) y las acciones con sentido propio (`private.log_catalog_action()`, para la fusión y la cola). Es de solo anexar: la leen solo los administradores del catálogo y nadie la escribe por la API. `species_history()` devuelve el historial de una especie para su detalle en el backoffice (#133). Ver [Auditoría del catálogo](#auditoría-del-catálogo).
- Fusión de especies: `preview_species_merge()` y `merge_species()`, funciones de administrador que muestran y hacen la fusión de una especie duplicada en otra (#135, parte de #21; desde el #234 conserva también la foto de referencia), y `species_merge_keys`, la memoria de a qué especie fue a parar la clave de fuente de cada especie absorbida, para que la importación no la vuelva a crear. Solo la leen los administradores del catálogo; nadie la escribe por la API. Ver [Fusión de especies](#fusión-de-especies).
- Cola de propuestas: `list_proposal_groups()`, `count_proposal_groups()`, `link_proposal_group()`, `create_species_from_proposal()` y `mark_proposal_unidentifiable()`, funciones de administrador que listan las plantas con nombre por validar agrupadas por nombre normalizado y género, sin datos del usuario, y resuelven un grupo entero (#139, parte de #22). Ver [Cola de propuestas](#cola-de-propuestas).
- Eventos de producto: `product_events`, de solo inserción, con los eventos "registro completado" y "búsqueda ¿Ya la tengo?" para medir los objetivos de 1 minuto y 5 segundos (#145). La app los envía con `public.record_product_events(events)`; nadie los lee por la API. Ver [Eventos de producto](#eventos-de-producto).
- Disparadores, con sus funciones en el esquema `private` (no expuesto en la API): al enlazar una planta a una especie, la planta toma el género y el tipo de la especie y queda validada; al desenlazarla vuelve a "por validar"; si cambian el género o el tipo de una especie, se propagan a sus plantas; al borrar un perfil se borran los eventos de producto de ese usuario; y `updated_at` se actualiza solo en todas las tablas.

Todas las tablas tienen Row Level Security activada y privilegios explícitos: `anon` no lee ninguna tabla y solo ejecuta las funciones del [catálogo público](#catálogo-público) (además de `requesting_user_id()`, `is_catalog_admin()` y `normalize_search_text()`, que no leen tablas); `authenticated` lee el catálogo, lo escribe solo si es administrador (lo deciden las políticas) gestiona su propio perfil y sus plantas y registra sus eventos de producto sin poder leerlos; y `service_role` puede leer y escribir todo, salvo la auditoría, la memoria de las fusiones y la de las fotos retiradas, que solo lee, y los eventos de producto, que solo lee y borra.

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

| Archivo                               | Qué comprueba                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `esquema.sql`                         | Que las migraciones dejan las tablas, enumerados, extensiones, disparadores y funciones esperados, con su dueño.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `datos_referencia.sql`                | Los cinco géneros de acceso rápido con su abreviatura, el número de géneros y abreviaturas cargados, y que las migraciones no cargan perfiles ni plantas.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `catalogo_unicidad.sql`               | Unicidad sin distinguir mayúsculas y nombres sin espacios sobrantes en géneros, abreviaturas, especies y nombres; referencia obligatoria y única por fuente (`gbif`, `col`).                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `borrados.sql`                        | Borrados en cascada (abreviaturas, nombres alternativos) y restringidos (géneros y especies en uso).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `plantas_y_perfiles.sql`              | Restricciones de `plants` y `profiles`: validación y especie, textos, fecha, enumerados, idioma y valores por defecto.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `sincronizacion.sql`                  | Sincronización de género y tipo al enlazar, desenlazar y cambiar la especie, y `updated_at` y `created_at`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `acceso_por_rol.sql`                  | Qué pueden leer y escribir `anon`, `authenticated` y `service_role`, y el usuario por defecto tomado del token.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `identidad.sql`                       | `requesting_user_id()`: null sin sesión, el `sub` con sesión, sus permisos y propiedades, y que no abre perfiles ni plantas a `anon`.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `politicas_plantas_y_perfiles.sql`    | Políticas y permisos de `profiles` y `plants`: cada usuario solo lo suyo, sin cambiar el dueño ni escribir `validation`; el administrador no ve más; `anon` cerrado.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `politicas_catalogo.sql`              | Escritura del catálogo: anónimo, usuario sin rol y administrador; tokens que no dan el rol; `is_catalog_admin()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `funciones_administrador.sql`         | El guardián `private.require_catalog_admin()` y el patrón de las funciones de administrador, con ejemplos que la regla general acepta y rechaza; lo mismo con el patrón de lectura pública del catálogo (#231).                                                                                                                                                                                                                                                                                                                                                                                 |
| `busqueda_especies.sql`               | Normalización, índices de trigramas y `search_species()`: errores de tipeo, tildes, prefijos, sinónimos, orden, límites, permisos y que el plan usa los índices.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `busqueda_generos_y_abreviaturas.sql` | Abreviaturas en `search_species()` (con o sin punto, desconocidas, solas, ambiguas) y `search_genera()`: tipeo, tildes, prefijo, abreviatura, límites, permisos, índices y la lista cargada sin choques.                                                                                                                                                                                                                                                                                                                                                                                        |
| `datos_ejemplo.sql`                   | Que los datos de ejemplo de `datos-ejemplo/` se cargan, que cargarlos dos veces no cambia nada, que no tocan el inventario y que la migración de abreviaturas se aplica sobre ellos.                                                                                                                                                                                                                                                                                                                                                                                                            |
| `backoffice_catalogo.sql`             | Funciones del backoffice: paginación por clave completa hacia delante y hacia atrás, sin saltos ni repeticiones; filtros solos y combinados con su total; búsqueda (nombre, sinónimo, tipeo, abreviatura, signo, filtros, páginas); géneros; resumen; plantas enlazadas sin exponer datos; permisos e índices.                                                                                                                                                                                                                                                                                  |
| `backoffice_escritura_especies.sql`   | Escritura de especies desde el backoffice: alta (fuente, espacios, búsqueda inmediata), edición y "editada pasa a validada" (también por escritura directa y no en la importación), propagación a las plantas, lote (todas o ninguna, tope), baja con y sin plantas, cada motivo de error y los permisos.                                                                                                                                                                                                                                                                                       |
| `backoffice_nombres_y_generos.sql`    | Sinónimos, nombres comunes, géneros y abreviaturas desde el backoffice: idioma solo en los comunes, duplicados y casi iguales por especie, signo «×» de los nothogéneros, acceso rápido, baja de géneros con especies o plantas, abreviaturas con punto y su choque con el género que la tiene, búsqueda inmediata (`search_species`, `search_genera`) y permisos.                                                                                                                                                                                                                              |
| `auditoria.sql`                       | Auditoría del catálogo: permisos (solo leen los administradores, nadie escribe por la API), registro de cada función del backoffice y de las escrituras directas con usuario, fecha y solo las columnas que cambian, nada si no cambia ningún valor, id de acción por transacción y con `log_catalog_action()`, y que una carga de miles de filas sin token no audita fila a fila.                                                                                                                                                                                                              |
| `historial_especie.sql`               | Historial de una especie: `species_id` de cada registro (también en la edición de un nombre, y de un nombre editado y después borrado sin token), orden del más reciente al más antiguo, una entrada por acción (una baja con sus nombres, una fusión vista desde las dos especies), cambios de otras filas solo contados, nombres de los géneros, paginación por clave, tamaño de página, permisos e índice.                                                                                                                                                                                   |
| `fusion_especies.sql`                 | Fusión de especies: permisos de las funciones y de la memoria (solo leen los administradores, nadie escribe por la API), vista previa sin cambios (plantas, nombres que pasan y que ya existían, género, tipo, validación y claves), rechazos, plantas de dos usuarios con el género y el tipo de la conservada, nombres sin duplicar, `search_species()` con el nombre absorbido, memoria (A en B y B en C, clave repetida, sin referencia, híbridos curados, baja de la conservada), atomicidad ante un fallo forzado y una sola entrada en el historial.                                     |
| `cola_de_propuestas.sql`              | Cola de propuestas: permisos y propiedades, columnas del resultado sin datos del usuario, grupos por nombre normalizado y género (forma y tipo más frecuentes, fotos, paginación), enlazar, crear la especie (validada, propuesta de usuario) y marcar no identificable de una vez para varios usuarios, resolver otra vez sin fallar ni tocar nada, rechazos, auditoría sin ids de usuarios y acceso a las fotos antes y después de resolver.                                                                                                                                                  |
| `cola_de_propuestas_dos_cuentas.sql`  | El guion de la comprobación con dos cuentas del #142: un usuario registra dos plantas con el mismo nombre (una con foto) y otra distinta; el administrador ve la cola sin datos del usuario, enlaza un grupo y marca el otro como no identificable; el usuario ve el estado nuevo y las resoluciones están en la auditoría.                                                                                                                                                                                                                                                                     |
| `fotos_storage.sql`                   | Bucket `plant-photos` (privado, límite y tipos) y políticas de `storage.objects`: anónimo, dos usuarios y un administrador que solo lee las fotos de plantas por validar; otros buckets sin afectar.                                                                                                                                                                                                                                                                                                                                                                                            |
| `fotos_de_plantas.sql`                | `plant_photos`: posición, rutas, nota y fecha; dueño igual al de la planta; máximo de 6; sincronización con `plants` en los dos sentidos (app nueva y app antigua: poner, sustituir, marcar en floración y quitar la foto, con promoción de la siguiente), reordenar, cascada, RLS con dos cuentas, sin sesión y con el administrador, y la copia de las fotos existentes.                                                                                                                                                                                                                      |
| `varias_fotos_cola.sql`               | Varias fotos (#184): el administrador descarga todas las fotos de plantas por validar (también las secundarias y la de una planta antigua sin filas) y ninguna de validadas, no identificables o sueltas, ni tras resolver; un usuario solo lo suyo y `anon` nada; la cola reparte hasta seis fotos por turnos sin fechas ni notas; plan de `is_pending_plant_photo` por `plants_pkey` y `plant_photos_plant_id_position_key`; `photo_count` con RLS, permisos y propiedades.                                                                                                                   |
| `eventos_de_producto.sql`             | `product_events` y `record_product_events()`: solo inserción de eventos propios, nada para `anon`, reenvíos sin duplicar, listas cerradas y topes, borrado con el perfil y las consultas de `docs/indicadores-de-eventos.sql` sobre datos de prueba.                                                                                                                                                                                                                                                                                                                                            |
| `fotos_de_referencia.sql`             | Fotos de referencia (#234): licencias aceptadas y rechazadas, atribución obligatoria, una por especie, identificadores, enlace, rutas y medidas; cascada; RLS y privilegios con dos cuentas, el administrador, `anon` y la clave de servicio; la foto en la ficha, la búsqueda y las especies de un género, y nunca la de una especie no pública; retirada (permisos, efecto, auditoría, historial y rechazos); memoria de retiradas frente a la carga; fusión (foto que pasa, que se descarta, retiradas que pasan); bucket `species-photos` y los planes por `species_photos_species_id_key`. |
| `catalogo_publico.sql`                | Catálogo público: permisos y propiedades de las cuatro funciones, que `anon` no lee ninguna tabla ni ejecuta funciones de administración, búsqueda (tildes, «×», abreviaturas, tipeo, sinónimos y nombres comunes; igual que `search_species()` sin las no públicas; sin huecos), géneros y especies de un género (totales, páginas fuera de rango, topes, orden estable sin repeticiones), ficha (fuente, nombres, topes, no pública igual que inexistente), parámetros maliciosos e índices.                                                                                                  |
| `seguridad_general.sql`               | Reglas que valen para cualquier tabla o función futura: RLS en todo `public`, `anon` solo lee, funciones protegidas, ningún bucket público salvo los declarados (`species-photos`) y políticas de Storage solo para `authenticated`.                                                                                                                                                                                                                                                                                                                                                            |

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
- `pruebas.funciones_definer_expuestas()`: las funciones `security definer` de `public` que la API expone sin seguir el patrón de las [funciones de administrador](#funciones-de-administrador) ni el de [lectura pública del catálogo](#seguridad-de-las-funciones-públicas), con el motivo, o `ninguna`.
- `pruebas.incumple_lectura_publica(funcion)`: por qué una función no cumple el patrón de lectura pública del catálogo, o `null` si lo cumple.
- `pruebas.genero(nombre)` y `pruebas.especie(nombre)` son `security definer`, así que sirven también con `set local role anon`, que no lee el catálogo.

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

Por HTTP es `POST /rest/v1/rpc/search_species` con `{"query": "phal amab", "max_results": 10}`, con sesión (sin sesión, la búsqueda es `search_public_species()`, del [catálogo público](#catálogo-público)). Devuelve una fila por especie, como mucho una vez cada una:

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

Es `security invoker`, `stable` y con `search_path` vacío: lee el catálogo con los permisos de quien llama y no toca perfiles ni plantas. La pueden ejecutar `authenticated` y `service_role`; `anon`, desde el #231, no (no lee las tablas: busca con `search_public_species()`, que llama a esta). `normalize_search_text()`, que no lee ninguna tabla, la pueden ejecutar los tres.

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
- Mismos límites, propiedades y permisos que `search_species()`: mínimo 2 caracteres normalizados, como mucho 100 caracteres, 10 resultados por defecto y 20 como máximo; `security invoker`, `stable`, `search_path` vacío; la pueden ejecutar `authenticated` y `service_role` (`anon` no, desde el #231).

## Catálogo público

Los visitantes sin sesión (`anon`) consultan el catálogo con cuatro funciones de solo lectura de la migración `20261122150000_catalogo_publico.sql` (#231, parte de #187), donde están explicadas las decisiones. La pantalla es el #232. Las puede llamar también un usuario con sesión, con el mismo resultado: no miran quién llama.

### Qué es público

Una especie es pública si `source <> 'user_proposal' or status = 'validated'`:

| Fuente                                               | `imported` | `validated` | `observed` |
| ---------------------------------------------------- | ---------- | ----------- | ---------- |
| `col` (Catalogue of Life)                            | sí         | sí          | sí         |
| `gbif` (sin uso hoy)                                 | sí         | sí          | sí         |
| `curated` (lista curada y altas del backoffice)      | sí         | sí          | sí         |
| `user_proposal` (especie creada desde una propuesta) | no         | sí          | no         |

- Es la decisión del responsable (#187): se muestran las especies e híbridos del catálogo importado y de la lista curada, y las validadas por el administrador; no las propuestas de usuarios sin validar.
- `observed` (un administrador vio algo que revisar) entra si la especie viene del catálogo: es una nota interna de revisión, no un rechazo, y el registro con sesión ya la ofrece. Además el administrador marca `observed` los híbridos curados que edita para que la siguiente carga no pise su edición ([Editada pasa a validada](#editada-pasa-a-validada)): ocultarlas escondería justo esos híbridos.
- Una especie que viene de una propuesta solo es pública mientras está validada (si un administrador la pasa a `observed` o `imported`, deja de serlo). Las propuestas que todavía no son especie son plantas por validar (`plants`), que `anon` no puede leer.
- Ninguna respuesta pública trae el estado (`status`), ni nada de las plantas, sus dueños o sus fotos. Sí la foto de referencia de la especie (#234), que viene de iNaturalist, no de un usuario. Un género sin especies públicas no sale en la lista de géneros.
- La condición va escrita igual en las cuatro funciones y en los dos índices parciales; si cambia, hay que cambiarla en todos (las pruebas de `catalogo_publico.sql` comprueban que coinciden).

### Funciones

| Función                                                                       | Devuelve                                                                                                                                                                                                                          | Topes                                                                      |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `search_public_species(query, max_results = 10)`                              | Lo mismo que `search_species()` sin `status`: `id`, `scientific_name`, `genus_id`, `genus_name`, `type`, `matched_name`, `matched_name_type`, en el orden de `search_species()`, y `reference_thumbnail` (#234).                  | 10 resultados por defecto, 15 como máximo; consulta de 2 a 100 caracteres. |
| `list_public_genera(page_size = 100, page_number = 1)`                        | Una página de géneros con especies públicas: `id`, `name`, `species_count` (sus especies públicas), `total_count` (géneros en total) y `current_page`.                                                                            | 100 por página por defecto, 200 como máximo.                               |
| `list_public_genus_species(target_genus_id, page_size = 50, page_number = 1)` | Una página de las especies públicas de un género: `id`, `scientific_name`, `type`, `genus_id`, `genus_name`, `total_count` (especies públicas del género), `current_page` y `reference_thumbnail` (#234).                         | 50 por página por defecto, 100 como máximo.                                |
| `get_public_species(target_species_id)`                                       | Una fila: `id`, `scientific_name`, `genus_id`, `genus_name`, `type`, `source`, `source_ref`, `synonyms` (texto), `synonym_count`, `common_names` (arreglo de `{name, language}`), `common_name_count` y `reference_photo` (#234). | Hasta 100 sinónimos y 100 nombres comunes, con el total de cada uno.       |

```ts
const { data: results } = await supabase.rpc('search_public_species', {
  query: 'catleya labiatta',
  max_results: 10,
})

const { data: genera } = await supabase.rpc('list_public_genera', {
  page_size: 100,
  page_number: 1,
})
// genera[0].total_count: géneros en total; current_page: la página devuelta.

const { data: species } = await supabase.rpc('list_public_genus_species', {
  target_genus_id: genusId,
  page_size: 50,
  page_number: 3,
})

const { data: detail } = await supabase.rpc('get_public_species', {
  target_species_id: speciesId,
})
// detail[0] o, si no existe o no es pública, un arreglo vacío.
```

Por HTTP, `POST /rest/v1/rpc/<función>` con los parámetros en JSON y solo la clave publicable. Los tipos están en `apps/web/src/lib/database.ts`: `PublicSpeciesSearchRow`, `PublicGenusRow`, `PublicGenusSpeciesRow` y `PublicSpeciesDetail` (con `source_ref` nulo y `common_names` como `PublicCommonName[]`, que los tipos generados no saben). La foto de referencia (#234) va al final, como `reference_photo` (`ReferencePhoto`) en la ficha y `reference_thumbnail` (`ReferenceThumbnail`) en la búsqueda y las especies de un género, nula si la especie no tiene foto; en los alias es opcional, para que el código escrito antes siga compilando. Ver [Fotos de referencia](#fotos-de-referencia).

- **Búsqueda:** no se duplica la lógica de `search_species()` (tildes, «×», abreviaturas, errores de tipeo, sinónimos, nombres comunes, orden y etapas): `search_public_species()` la llama, descarta las no públicas y quita el estado. Para que una no pública no deje un hueco le pide 5 resultados más de los que devuelve; por eso el tope es 15 (15 + 5 es el tope de 20 de `search_species()`). Solo saldrían menos si entre los 20 primeros hubiera más de 5 no públicas; las especies de propuestas nacen validadas, así que no debería haber casi ninguna.
- **Orden de las listas:** el nombre normalizado (sin tildes, mayúsculas ni signo de híbrido) con intercalación `C` y, a igualdad, el id, como el backoffice: estable entre páginas, sin repeticiones ni saltos.
- **Páginas:** por número, porque la pantalla pone la página en una dirección que se comparte (`?pagina=3`). Desde 1; nula, cero o negativa es la 1; más allá de la última devuelve la última, y `current_page` dice cuál es. Un género que no existe, sin especies públicas o nulo no devuelve filas.
- **Ficha:** un id que no existe, que no es público o nulo devuelve un arreglo vacío, sin distinguir los casos (y, por tanto, tampoco su foto de referencia). `source_ref` solo se devuelve en las fuentes externas (`col`, `gbif`): con COL, la atribución enlaza a `https://www.catalogueoflife.org/data/taxon/<source_ref>` (Catalogue of Life, CC BY 4.0); en la lista curada es un identificador interno de la carga. Los nombres van en el orden de la búsqueda.
- **Parámetros fuera de rango:** no dan error, se acotan (tamaños nulos, cero, negativos o enormes; páginas negativas o enormes; consultas nulas, de un carácter, de más de 100 o con comodines `%` y `_`, que se buscan como texto). Así una petición mal formada nunca cuesta más que una válida.
- `search_species()` y `search_genera()` ya no son para `anon`: no se abrió `search_species()` tal cual porque devuelve el estado y las no públicas y necesita leer las tablas (es `security invoker`). La búsqueda de géneros del registro no tiene versión pública: el catálogo público no la necesita.

### Seguridad de las funciones públicas

Antes del #231, `anon` tenía `select` sobre las cuatro tablas del catálogo (políticas `using (true)`) y ejecutaba `search_species()` y `search_genera()`: podía volcar el catálogo entero en unas pocas peticiones a `/rest/v1/species` (hasta el máximo de filas por petición de PostgREST), filtrar y ordenar por cualquier columna sin índice, y ver las filas no públicas y el estado de cada especie. Ahora no lee ninguna tabla de `public` (lo comprueba `catalogo_publico.sql` recorriendo todas) y solo ejecuta estas cuatro funciones, `requesting_user_id()`, `is_catalog_admin()` y `normalize_search_text()`. La app no usaba ese acceso: todas sus lecturas del catálogo están detrás de `RequireAuth` y van con el token, como `authenticated`, que no cambia.

Las cuatro son `security definer` (porque `anon` ya no lee las tablas), con `search_path` vacío, sin guardián (son para todos) y con un patrón propio, el de **lectura pública del catálogo**, que vigila `pruebas.funciones_definer_expuestas()` en `seguridad_general.sql`:

- `language sql` con cuerpo estándar (`begin atomic ... end`): Postgres analiza el cuerpo al crearla y registra en `pg_depend` cada tabla y función que usa. La prueba exige que solo dependa de `genera`, `genus_abbreviations`, `species`, `species_names`, `species_photos` (desde el #234: imágenes con licencia abierta y su atribución, sin datos de usuarios, que las funciones solo sacan unidas a una especie pública; `species_photo_rejections`, interna del backoffice, no está), `normalize_search_text()` y `search_species()`; si una función así leyera `plants`, `profiles` o llamara a otra función, falla con el nombre de lo que usa. Con `plpgsql` o con el cuerpo como texto no hay dependencias registradas, así que la regla las rechaza.
- `stable` (o `immutable`): Postgres no deja escribir a una función que no es `volatile`.
- `search_path` vacío.
- Solo la ejecutan `anon` y `authenticated` (ni `service_role`, que ya lee las tablas, ni `PUBLIC`).

La regla no ve dentro de `search_species()` (es `plpgsql`): si un día leyera algo más que el catálogo, habría que quitarla de la lista de `pruebas.incumple_lectura_publica()`. `tests/funciones_administrador.sql` tiene ejemplos que la regla acepta y rechaza. En los archivos de pruebas, el `end;` de un cuerpo `begin atomic` va en la misma línea que la última sentencia: el ejecutor rechaza una línea que solo dice `end;`.

### Índices y rendimiento

- `species_public_genus_idx` (`genus_id`), parcial sobre las especies públicas: `list_public_genera()` cuenta las de todos los géneros recorriendo solo el índice (_index only scan_), ya agrupado. Con el de abajo, más ancho, Postgres prefería leer `species` entera (5 ms).
- `species_public_genus_name_idx` (`genus_id`, nombre normalizado con intercalación `C`, `id`), parcial: `list_public_genus_species()` cuenta las de un género y lee su página en orden sin ordenar el género ni ir a la tabla a comprobar si cada fila es pública. Como los demás índices de expresión, hay que reconstruirlo si cambia `normalize_search_text()`.
- La búsqueda usa los índices de `search_species()` y la clave de `species` para descartar las no públicas; la ficha, `species_pkey`, `genera_pkey` y `species_names_species_id_name_key`. Las tres que traen la foto la buscan por `species_photos_species_id_key`, una vez por fila devuelta (ver [Fotos de referencia](#fotos-de-referencia)).

22 de noviembre de 2026, `npm run db:perf` con el catálogo sintético por defecto (917 géneros, 30 000 especies, 80 000 sinónimos y 3000 nombres comunes; el género más grande, 1334 especies), PostgreSQL 17.12 en un contenedor `postgres:17` (Podman, 4 CPU y 3,7 GB) sobre un Apple M4 Pro, como `anon`, 30 ejecuciones medidas tras 3 de calentamiento:

| Llamada                                                                                | Mediana (ms) |  p95 (ms) | Filas | Índices (recorridos por llamada)                        |
| -------------------------------------------------------------------------------------- | -----------: | --------: | ----: | ------------------------------------------------------- |
| Búsqueda `ph` / `dendrob`                                                              |    0,1 / 0,1 | 0,2 / 0,2 |    10 | prefijo 1                                               |
| Búsqueda `phal amab`                                                                   |          9,6 |      10,2 |    10 | trigramas 6 / 6                                         |
| Búsqueda `catleya labiatta`                                                            |          6,1 |       6,4 |    10 | trigramas 6 / 6                                         |
| Búsqueda `alba`                                                                        |         16,2 |      17,3 |    10 | prefijo 2, trigramas 2 / 4                              |
| Búsqueda `laelia purpurata`                                                            |          2,5 |       2,8 |    10 | trigramas 4 / 4                                         |
| Búsqueda `dendrob`, 15 resultados                                                      |          0,2 |       0,2 |    15 | prefijo 1                                               |
| Géneros, primera página (100) / última (200)                                           |    3,1 / 3,0 | 3,5 / 3,4 |   100 | `species_public_genus_idx` 1                            |
| Especies del género más grande, página 1 (50)                                          |          0,5 |       0,9 |    50 | `species_public_genus_name_idx` 1                       |
| Especies del género más grande, última página (100)                                    |          3,5 |       3,9 |    34 | `species_public_genus_name_idx` 1                       |
| Especies de un género pequeño                                                          |          0,2 |       0,2 |     5 | `species_public_genus_name_idx` 1                       |
| Ficha de la especie con más nombres (25 sinónimos, 79 comunes) / Phalaenopsis amabilis |    0,6 / 0,6 | 0,6 / 0,7 |     1 | `species_pkey` 1, `species_names_species_id_name_key` 4 |

Ninguna recorre `species_names` de forma secuencial, ni las listas y la ficha `species`. La búsqueda cuesta lo mismo que `search_species()` (la misma tabla de `db:perf` como `authenticated`) más diez búsquedas por clave en `species` para filtrar. Los dos índices ocupan 0,3 y 2,9 MB con este catálogo.

Planes (con `npm run db:perf -- --planes`):

- **Géneros:** `Index Only Scan using species_public_genus_idx` (30 000 entradas, sin ir a la tabla) → `GroupAggregate` → `Hash Join` con `genera` (917 filas, recorrido secuencial de una tabla de 9 páginas) → orden de los 900 nombres normalizados. Lo que más cuesta es normalizar los 900 nombres para ordenarlos: `normalize_search_text()` fija `search_path`, así que Postgres no la expande en la consulta y es una llamada por fila, de unos 3 µs. Se cuenta en cada llamada; con 3 ms no compensa guardar los recuentos.
- **Especies de un género:** el total con `Index Only Scan using species_public_genus_idx` y la página con `Index Scan using species_public_genus_name_idx` en orden, con `offset`; `genera_pkey` para el nombre del género. La última página de un género grande es la más cara porque Postgres calcula el nombre normalizado de cada fila que salta el `offset` (1334 en este catálogo, unos 3,5 ms; Bulbophyllum, en el catálogo real, unas 2200).
- **Ficha:** `Index Scan using species_pkey` (con el filtro de especie pública), `genera_pkey` y cuatro `Bitmap Index Scan on species_names_species_id_name_key` (sinónimos, comunes y sus totales).
- **Búsqueda:** los planes de `search_species()` y un `Nested Loop` con `Index Scan using species_pkey` por resultado.

Falta medirlo con el catálogo real (`npm run db:perf -- --catalogo-real`) y en el proyecto de desarrollo. Con el factor de unas 7 veces del plan gratuito (ver [Resultados con el catálogo real](#resultados-con-el-catálogo-real)), la búsqueda más cara quedaría en unos 120 ms y las listas en unos 30 ms.

### Abuso

La base no tiene limitador de ritmo. Lo que protege hoy:

- **Coste acotado por llamada:** cada función tiene un tope de filas y de texto impuesto por la base (no por la app), parámetros que se acotan en lugar de fallar y planes por índice; la llamada más cara medida es una búsqueda por similitud (unos 17 ms aquí) y ninguna lista recorre una tabla entera.
- **Nada privado:** `anon` no lee ninguna tabla, así que aunque se abuse no sale nada de usuarios ni filas no públicas.
- **Volcado:** el catálogo público se puede recorrer entero con las listas (unas 4 páginas de géneros y unas 650 de especies a 50 por página): es información pública de Catalogue of Life (CC BY 4.0) y no se intenta impedir, pero cuesta cientos de peticiones en lugar de unas pocas, y ninguna puede pedir más de 200 filas.

Lo que queda para la plataforma, sin implementar aquí:

- **Supabase:** el límite de filas por respuesta de PostgREST (`max_rows`, en la configuración de la API del proyecto), el `statement_timeout` del rol `anon` (Supabase fija uno corto por defecto; conviene comprobar su valor en el proyecto y, si se quiere otro, cambiarlo con una migración aparte, `alter role anon set statement_timeout = ...`) y vigilar el uso en los informes del proyecto. No consta un limitador de ritmo por IP para la API de datos que se pueda configurar desde el proyecto; está por comprobar en la documentación de Supabase.
- **Vercel o un proxy delante:** limitar el ritmo por IP (Vercel WAF o un _middleware_), si el catálogo público recibe tráfico abusivo. La app llama a Supabase directamente desde el navegador, así que un limitador en Vercel solo cubriría peticiones que pasen por él.

## Listado del catálogo para el backoffice

La pantalla `/administracion/catalogo` (#99) lee el catálogo con cinco funciones de la API, de la migración `20261121100000_listado_del_catalogo_para_el_backoffice.sql`, donde están explicadas las decisiones. El detalle de una especie (sus datos y sus nombres alternativos) se lee de las tablas, que `authenticated` puede leer.

| Función                                                                                                                       | Qué devuelve                                                                                                                                          | Seguridad                                                      |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `list_catalog_species(filter_status, filter_genus_id, filter_type, filter_source, page_size, after_id, before_id, last_page)` | Una página del catálogo en orden alfabético, con filtros opcionales, paginada por clave, con `total_count`, `has_previous` y `has_next` en cada fila. | `security invoker`, exige el rol.                              |
| `search_catalog_species(query, filter_status, filter_genus_id, filter_type, filter_source, page_size, page_number)`           | Una página de la búsqueda por relevancia, con `matched_name`, `matched_name_type`, `total_count` y `current_page`.                                    | `security invoker`, exige el rol.                              |
| `list_catalog_genera(query, quick_access_only, page_size, page_number)`                                                       | Una página de géneros con `abbreviations`, `is_quick_access`, `species_count`, `total_count` y `current_page`.                                        | `security invoker`, exige el rol.                              |
| `catalog_summary()`                                                                                                           | Una fila con géneros, especies, híbridos, sinónimos, nombres comunes y especies por estado y por fuente.                                              | `security invoker`, exige el rol.                              |
| `count_species_plants(target_species_id)`                                                                                     | Cuántas plantas de usuarios (de cualquier dueño y estado) tienen enlazada la especie. Solo el número.                                                 | Función de administrador (`security definer` con el guardián). |

Las filas de especies traen `id`, `scientific_name`, `genus_id`, `genus_name`, `type`, `status`, `source`, `source_ref`, `synonym_count`, `common_name_count`, `created_at` y `updated_at`. Sin coincidencias no devuelven ninguna fila. `page_size` es 50 por defecto y 100 como máximo (nulo, cero o negativo, 50).

Quién puede llamarlas: solo los administradores del catálogo, como el resto del backoffice. Las cuatro que leen el catálogo son `security invoker` (`authenticated` ya lee el catálogo y no hace falta saltarse nada), pero no son una API pública: recorren y cuentan mucho más que `search_species()` y solo las usa esta pantalla. Por eso solo las ejecuta `authenticated` y lo primero que hacen es comprobar `public.is_catalog_admin()`, con el mismo error `42501` que el guardián (que no pueden llamar, porque corren como quien llama y `private` solo lo ejecuta su dueño). `count_species_plants()` lee las plantas de todos los usuarios, que RLS oculta también al administrador, así que es una [función de administrador](#funciones-de-administrador). Ninguna se concede a `anon` ni a `service_role`.

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

## Auditoría del catálogo

La migración `20261121140000_auditoria_del_catalogo.sql` (#131, parte de #23) crea la tabla `public.catalog_audit_log`, donde están explicadas las decisiones. Cada fila es un cambio de una fila del catálogo o una acción con sentido propio:

| Columna                    | Qué guarda                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | Orden de llegada (`bigint` de identidad).                                                                                                         |
| `action_id`                | Agrupa los cambios que van juntos (ver abajo).                                                                                                    |
| `actor`                    | Id de usuario de Clerk (`requesting_user_id()`) o, en una acción sin token, el identificador de la carga.                                         |
| `action`                   | `insert`, `update` o `delete` en un cambio de fila; otro nombre (`merge_species`, `validate_plant`...) en una acción.                             |
| `table_name`, `row_id`     | Tabla e id de la fila; obligatorios en un cambio de fila.                                                                                         |
| `old_values`, `new_values` | Alta: la fila entera en `new_values`. Edición: solo las columnas que cambian, sin `updated_at`, en las dos. Baja: la fila entera en `old_values`. |
| `details`                  | Datos de una acción (por ejemplo, de qué especie a cuál se fusiona).                                                                              |
| `created_at`               | Cuándo (la hora de la transacción).                                                                                                               |

- **Disparador `audit_change`** (`after insert or update or delete`, por fila) en `genera`, `genus_abbreviations`, `species` y `species_names`, con la función `private.audit_catalog_change()` (`security definer`, porque inserta en una tabla que nadie de la API escribe). Vale para las funciones del backoffice y para una escritura directa de un administrador por la API. Una edición que no cambia ningún valor (aparte de `updated_at`) no deja registro. Los borrados en cascada dejan su propio registro. Las plantas no se auditan.
- **Sin token de usuario no hay registro por fila:** si `requesting_user_id()` es `null` (conexión directa como `postgres`, o la clave de servicio, cuyo token no trae `sub`), el disparador no hace nada más que leer el token. Así una importación de COL, con decenas de miles de filas, no llena la base; cada carga dejará una fila de resumen con su identificador (#132).
- **Id de acción:** vive en el ajuste local de la transacción `orki.catalog_action_id`. Si nadie registró una acción, el primer cambio auditado de la transacción crea un id y los demás lo reutilizan: todo lo que hace una llamada a la API (un lote de `set_catalog_species_status()`, una especie borrada con sus nombres) queda agrupado. El ajuste desaparece al terminar la transacción.
- **`private.log_catalog_action(action_name, details, target_table, target_row_id, load_actor)`** registra una acción con sentido propio, crea un id de acción nuevo y lo deja en el ajuste, así que los cambios de fila que siguen en la transacción quedan bajo ella. Devuelve el id. La llaman las funciones de administrador (que corren como `postgres`) antes de escribir, y los scripts con conexión directa; nadie más puede ejecutarla. Sin token exige `load_actor` (error `22023` si falta) y los cambios de fila siguen sin auditarse. El uso está en el comentario de la función.
- **Permisos:** RLS activada; `authenticated` solo tiene `select` y la política `catalog_audit_log_select_catalog_admin` exige `(select public.is_catalog_admin())`, así que un usuario sin rol no ve nada; `anon` no tiene ningún permiso; `service_role` solo lee. Nadie de la API inserta, edita, borra ni vacía la tabla, ni usa su secuencia.
- **Índices:** `(table_name, row_id, id)` para el historial de una fila, `(created_at)` para consultar por fecha y `(action_id)` para ver todos los cambios de una acción.
- Nada de datos personales: solo ids de Clerk y datos del catálogo. En la Fase 1 no se borra ningún registro (la conservación se decide en #134).

### Historial de una especie

La migración `20261121150000_historial_de_especie.sql` (#133) añade lo que necesita el historial del detalle de una especie en el backoffice:

- **Columna `species_id`:** la especie a la que se refiere cada registro. La rellena el disparador `fill_species_id` (`before insert` en `catalog_audit_log`, función `private.set_audit_species_id()`): en `species`, la propia fila; en `species_names`, el `species_id` de los valores nuevos, si no el de los anteriores y, si no, el de la fila de `species_names` (una edición de un nombre solo guarda lo que cambia, sin `species_id`, pero la fila existe todavía cuando se audita); en una acción con `target_table = 'species'`, su objetivo; en lo demás, `null`. Se guarda al escribir y no se busca al leer porque un nombre editado y después borrado sin token (una carga) ya no está en la tabla y ningún registro lo une a su especie. Un nombre que pasa a otra especie queda en el historial de la de destino.
- **Índice** `catalog_audit_log_species_idx` (`species_id`, `id`).
- **`species_history(target_species_id, page_size = 20, before_entry_id = null)`**, función de administrador (`security definer`, guardián primero, solo `authenticated`). Devuelve una fila por acción (`action_id`) con registros de la especie o de sus nombres, de la más reciente a la más antigua: `entry_id` (clave para la página siguiente: el id más alto de la entrada), `action_id`, `actor`, `action` (la acción con sentido propio, como `merge_species`, o `null` si son solo cambios de fila), `details`, `created_at`, `changes` (array con `table_name`, `row_id`, `action`, `old_values` y `new_values` de cada cambio de la especie y de sus nombres, en orden), `other_change_count` (cambios de la misma acción en otras filas, que no se devuelven), `genus_names` (`{id: nombre}` de los géneros que aparecen en los cambios) y `has_more`. La página siguiente se pide con `before_entry_id` igual al `entry_id` de la última fila. `page_size`: 20 por defecto y 100 como máximo (nulo, cero o negativo, 20). Sin registros no devuelve filas.

## Fusión de especies

La migración `20261121160000_fusion_de_especies.sql` (#135, parte de #21), donde están explicadas las decisiones, añade la fusión de una especie duplicada (la absorbida, `merged`) en otra (la conservada, `kept`). La pantalla es el #136 y el ajuste de la importación, el #137.

| Función                                                     | Qué hace                                                | Devuelve                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preview_species_merge(merged_species_id, kept_species_id)` | Vista previa, solo lectura (`stable`, no bloquea nada). | Una fila: los datos de las dos especies (`merged_*`, `kept_*`, con el nombre del género), `plant_count` (plantas que se mueven, de cualquier dueño y estado), `moved_names` y `existing_names` (arrays de `{name, type, language, origin}`; los segundos con `reason`, `existing_name` y `existing_type`), `genus_differs`, `type_differs`, `kept_becomes_validated` y `remembered_keys` (array de `{source, source_ref, inherited}`). |
| `merge_species(merged_species_id, kept_species_id)`         | La fusión, en una transacción: todo o nada.             | Una fila: `action_id` (la acción de la auditoría), `plant_count`, `moved_name_count`, `skipped_name_count`, `kept_validated` y `remembered_keys`.                                                                                                                                                                                                                                                                                      |

- Son [funciones de administrador](#funciones-de-administrador): `security definer` (mueven plantas de todos los usuarios, que RLS oculta al administrador), el guardián como primera sentencia, `search_path` vacío y solo ejecutables por `authenticated`. Un usuario sin rol, `anon` y la clave de servicio reciben `42501`.
- **Qué hace la fusión**, en orden: bloquea las dos especies `for update` en orden de id; registra la acción `merge_species` en la auditoría antes de escribir (en `details`: los ids, los nombres, la clave de la absorbida, el número de plantas, los nombres que pasan y los que no, y las claves que recuerda); mueve las plantas (el disparador `sync_with_species` les pone el género y el tipo de la conservada; `entered_name` no cambia); pasa los sinónimos y nombres comunes de la absorbida (mueve la fila, con su id, tipo e idioma) y añade su nombre científico como sinónimo; deja la conservada `validated` si era `imported`, para que la importación no la pise; guarda la memoria; y borra la absorbida, con los nombres que no pasaron.
- **Nombres:** se comparan con `normalize_search_text()`. No pasa un nombre si la conservada ya tiene uno igual tras normalizar (su nombre científico, un sinónimo o un nombre común: `already_in_kept`), ni si ya pasa otro de la absorbida igual tras normalizar (`repeated_in_merged`; gana el científico, después los sinónimos, después los comunes y, a igualdad, el primero en orden alfabético con intercalación `C`). Así la conservada no queda con nombres que la búsqueda confundiría y no choca con `species_names_species_id_name_key`. `search_species()` encuentra la conservada por el nombre absorbido al momento.
- **Géneros o tipos distintos:** se permite (propuesta del #21, por confirmar); la vista previa lo señala con `genus_differs` y `type_differs`.
- **Auditoría:** la fusión es una sola entrada en `species_history()` de la conservada (objetivo de la acción, con sus nombres nuevos o movidos y su cambio de estado) y de la absorbida (su baja y la de los nombres que no pasaron).
- **Fotos de referencia** (#234, migración `20261124110000_fotos_de_referencia.sql`): la de la conservada no se toca; si no tiene, recibe la de la absorbida (salvo que esté retirada para ella); las retiradas de la absorbida pasan a la conservada. Ver [Fotos de referencia](#fotos-de-referencia).
- **Concurrencia:** dos fusiones que comparten una especie esperan una a la otra sin interbloquearse (orden de id), y la segunda recibe `species_not_found`. Mientras dura, nadie enlaza una planta a ninguna de las dos (`sync_with_species` las bloquea `for share`) ni cambia sus nombres desde el backoffice.

Errores, con `private.raise_catalog_error()` como el resto del backoffice:

| Código  | Motivo              | Cuándo                                      | Datos                                            |
| ------- | ------------------- | ------------------------------------------- | ------------------------------------------------ |
| `22023` | `same_species`      | Las dos especies son la misma.              |                                                  |
| `P0002` | `species_not_found` | Una de las dos no existe (o el id es nulo). | `species_id`, `species_role` (`merged` o `kept`) |

### Memoria de las fusiones

`public.species_merge_keys` guarda una fila por clave de fuente absorbida: `source` y `source_ref` (clave primaria), `species_id` (la especie que la conserva hoy), `merged_species_id` y `merged_scientific_name` (la absorbida, que ya no existe), `merged_by` (id de Clerk), `merged_at` y `action_id` (la acción de la auditoría).

- Solo se guardan las especies absorbidas con `source_ref` (importadas de COL, lista curada de híbridos); una dada de alta a mano no tiene clave que la importación pueda recrear.
- **Cadena:** si la conservada se fusiona después en otra, las claves que heredó pasan a la nueva (A en B y B en C dejan las claves de A y de B en C); `merged_by`, `merged_at` y `action_id` siguen siendo los de la fusión que absorbió cada clave. `species_id` siempre es una especie que existe: no hay que seguir cadenas.
- Si la clave ya estaba (la especie se volvió a crear y se vuelve a fusionar), se sobrescribe con la fusión nueva.
- **Si se borra la conservada** (solo posible sin plantas), su memoria se va con ella (`on delete cascade`): la importación volvería a crear esas especies, igual que la propia conservada si viene de la fuente. Lo que pasó queda en la auditoría.
- **Permisos:** RLS activada; `authenticated` solo tiene `select` y la política `species_merge_keys_select_catalog_admin` exige `(select public.is_catalog_admin())`; `anon`, nada; `service_role` solo lee. Solo escribe `merge_species()`.
- **Cómo la lee la importación** (#137, con conexión directa como `postgres`): `select species_id from public.species_merge_keys where source = 'col' and source_ref = $1` (si hay fila, la especie no se crea: su clave vive en `species_id`), o todas las de una fuente de una vez para una carga por conjuntos. Las resuelve la clave primaria.

## Cola de propuestas

La migración `20261121180000_cola_de_propuestas.sql` (#139, parte de #22), donde están explicadas las decisiones, añade las funciones de la cola de propuestas del backoffice. La cola no es una tabla: son las plantas con `validation = 'pending'`. Un **grupo** es el conjunto de plantas por validar con el mismo nombre normalizado (`normalize_search_text(entered_name)`: sin tildes, mayúsculas, espacios sobrantes ni signo de híbrido) y el mismo género, de cualquier dueño y estado.

| Función                                                                                                     | Qué hace                                                                                                                                                                        | Devuelve                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_proposal_groups(page_size = 20, page_offset = 0)`                                                     | Los grupos, del que tiene más plantas al que tiene menos. `page_size` hasta 100 (nulo o no positivo, 20).                                                                       | `name_key`, `proposed_name` (la forma más frecuente tal como se escribió), `genus_id`, `genus_name`, `type` (el más frecuente), `plant_count`, `photos` (hasta seis `{photo_path, thumbnail_path}`, ver «Fotos» abajo) y `total_count`. |
| `count_proposal_groups()`                                                                                   | Cuántos grupos hay, para el número de la pestaña.                                                                                                                               | Un número.                                                                                                                                                                                                                              |
| `link_proposal_group(group_name_key, group_genus_id, target_species_id)`                                    | Enlaza todas las plantas del grupo a una especie: `sync_with_species` las valida y les pone su género y su tipo; `entered_name` no cambia.                                      | `action_id`, `plant_count`.                                                                                                                                                                                                             |
| `create_species_from_proposal(group_name_key, group_genus_id, new_scientific_name, new_genus_id, new_type)` | Crea la especie (fuente `user_proposal`, estado `validated`, sin `source_ref`; las comprobaciones de `create_catalog_species()`) y le enlaza el grupo, en la misma transacción. | `action_id`, `plant_count`, `species_id`.                                                                                                                                                                                               |
| `mark_proposal_unidentifiable(group_name_key, group_genus_id)`                                              | Marca el grupo como no identificable: sale de la cola y sigue en el inventario de su dueño, sin especie.                                                                        | `action_id`, `plant_count`.                                                                                                                                                                                                             |

- Son [funciones de administrador](#funciones-de-administrador) (`security definer`, guardián primero, `search_path` vacío, solo `authenticated`). Los administradores siguen sin lectura de `plants`.
- **Datos:** ninguna devuelve el usuario, el origen, la ubicación, el apodo, las fechas ni el id de las plantas. Las fotos van como rutas del bucket, que la app necesita para pedir la URL firmada; contienen el id del usuario, así que la interfaz no las muestra ni las registra.
- **Fotos** (#184, migración `20261124090000_varias_fotos_cola_y_recuento.sql`): salen de `plant_photos` de las plantas del grupo, **hasta seis** por grupo (el máximo de una planta: un grupo de una sola planta las muestra todas). Van **por turnos**: primero la principal de cada planta, de la planta más reciente a la más antigua (a igualdad, por id); después la segunda foto de cada planta, en el mismo orden, y así hasta seis. Un grupo de varias plantas enseña una foto de cada una antes que varias de la misma. Una planta antigua sin filas en `plant_photos` pero con las dos rutas en `plants` aporta esa como principal. Cada foto lleva solo `photo_path` y `thumbnail_path`: ni la fecha ni la nota de la foto, ni `in_bloom`, ni ids. La política `plant_photos_select_own_or_pending_for_admin` deja al administrador descargar todas esas fotos (`is_pending_plant_photo()`, ver [Fotos de plantas](#fotos-de-plantas-storage)); al resolverse el grupo deja de poder leerlas.
- **Clave del grupo:** `name_key` y `genus_id`, como los devuelve el listado. `group_name_key` se vuelve a normalizar al recibirlo.
- **Dos administradores a la vez:** cada resolución bloquea las plantas pendientes del grupo (en orden de id) y cambia solo las que siguen pendientes. Si el grupo ya estaba resuelto, devuelve `plant_count = 0` y `action_id` nulo, sin error, sin tocar nada y sin auditoría; `create_species_from_proposal()` tampoco crea la especie. La pantalla lo usa para avisar de que otro administrador lo resolvió.
- **Auditoría:** cada resolución con plantas registra una acción (`link_proposal_group` y `create_species_from_proposal`, con la especie como objetivo, así que salen en su historial; `mark_proposal_unidentifiable`, sin objetivo) con `name_key`, `proposed_name`, `genus_id`, `genus_name`, `plant_count` y, si hay especie, `species_id` y `scientific_name`. Sin ids de usuarios ni rutas.
- **Índice** `plants_pending_group_idx` (`genus_id`, `normalize_search_text(entered_name)`), parcial sobre las plantas pendientes.
- No se avisa al usuario (decisión del #22): ve el cambio cuando su inventario se actualiza.

Errores, con `private.raise_catalog_error()`: `22023 group_required` (falta el nombre o el género del grupo), `P0002 species_not_found` (la especie elegida ya no existe, con `species_id`) y, al crear, los de `create_catalog_species()` (`name_required`, `type_required`, `genus_not_found`, `duplicate_name`, `similar_name`).

### Comprobación en desarrollo (#142)

`tests/cola_de_propuestas_dos_cuentas.sql` repite en la base desechable el guion de la comprobación, pero la base desechable no tiene Clerk, ni la API de Storage, ni PostgREST. En el proyecto de desarrollo, con la migración aplicada, hay que comprobar a mano (lo hace una persona, no un agente):

1. Con la segunda cuenta (sin rol), registrar en la app dos plantas con el mismo nombre que no esté en el catálogo, una con foto, y otra con un nombre distinto.
2. Con la cuenta de administrador, abrir `/administracion/catalogo?pestana=por-validar`: dos grupos, con la foto en el primero.
3. En las herramientas del navegador (pestaña Red), revisar las respuestas de `rpc/list_proposal_groups` y `rpc/count_proposal_groups`: solo `name_key`, `proposed_name`, `genus_id`, `genus_name`, `type`, `plant_count`, `photos` (rutas) y `total_count`; ningún origen, ubicación, apodo, fecha ni id de planta. Las imágenes llegan por `storage/v1/object/plant-photos/...` (descarga con el token de la sesión) y la ruta no aparece en el DOM (Elementos).
4. Enlazar el primer grupo a una especie y marcar el segundo como no identificable.
5. Con la segunda cuenta, volver a la app (tras 2 minutos en segundo plano, o recargando): las dos primeras plantas, validadas con el nombre de la especie (el ingresado, en el detalle); la tercera, "No identificable".
6. Con el administrador, en el detalle de la especie, el historial muestra la resolución; en el editor SQL, `select action, details from catalog_audit_log where action in ('link_proposal_group', 'create_species_from_proposal', 'mark_proposal_unidentifiable') order by id desc;` da las dos, sin el id de la segunda cuenta.
7. Confirmar las dos decisiones: la especie creada desde una propuesta nace "validada" y no se avisa al usuario.
8. Borrar los datos de prueba: las plantas desde la app con la segunda cuenta (borra también sus fotos) y, si se creó una especie de prueba, desde el backoffice. La auditoría no se borra (decisión del #22): sus filas de prueba se quedan.

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

(Es un ejemplo simplificado; la fusión real, con otra firma, está en [Fusión de especies](#fusión-de-especies).)

Por qué así:

- El rol se comprueba dentro de la función, con el mismo `public.is_catalog_admin()` que las políticas, porque `security definer` se salta RLS: sin el guardián, cualquier usuario con sesión podría llamarla.
- El guardián es la primera sentencia para que nada se ejecute antes de comprobar el rol, y vive en `private` (sin `security definer` y sin permiso para nadie más que su dueño) para que la API no lo exponga: solo lo llaman funciones que ya corren como `postgres`.
- No se concede a `service_role`: los scripts con la clave de servicio ya pueden escribir todas las tablas, y su token no trae `app_role`, así que el guardián los rechazaría igualmente.

La regla general de `tests/seguridad_general.sql` lo vigila con `pruebas.funciones_definer_expuestas()`: falla si `anon` puede ejecutar alguna función `security definer` de `public` que no sea de [lectura pública del catálogo](#seguridad-de-las-funciones-públicas), o si `authenticated` puede ejecutar una que no fija `search_path` vacío o que no llama primero al guardián (salvo las de lectura pública) (lo comprueba en el texto de la función, `pg_proc.prosrc`, sin contar los comentarios). Es una red para olvidos, no una barrera contra quien la quiera esquivar a propósito; la revisión del pull request sigue haciendo falta. Las funciones `security definer` que solo ejecuta `service_role` no están sujetas al patrón. `tests/funciones_administrador.sql` tiene ejemplos que la regla acepta y rechaza.

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

| Política                                       | Orden    | Qué deja hacer                                                                                                  |
| ---------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `plant_photos_select_own_or_pending_for_admin` | `select` | Al dueño, leer su carpeta; al administrador del catálogo, además las fotos y miniaturas de plantas por validar. |
| `plant_photos_insert_own`                      | `insert` | Subir a su carpeta.                                                                                             |
| `plant_photos_update_own`                      | `update` | Reemplazar (upsert) sus objetos, sin moverlos a otra carpeta ni a otro bucket.                                  |
| `plant_photos_delete_own`                      | `delete` | Borrar sus objetos.                                                                                             |

- Lo que exige cada operación del cliente de Storage: subir, `insert`; subir con `upsert`, `select`, `insert` y `update`; descargar, listar y `createSignedUrl(s)`, `select`; borrar (`remove`), `select` y `delete`.
- Sin sesión (`anon`) no hay ninguna política: no se lee ni se sube nada. Un token sin `sub` tampoco ve nada.
- El administrador no escribe ni borra fotos ajenas. Su lectura pasa por `public.is_pending_plant_photo(object_name)`, una [función de administrador](#funciones-de-administrador) (`security definer`, con el guardián) que solo responde verdadero o falso: la planta del segundo segmento existe, es del usuario del primero, está por validar y la ruta es exactamente la `photo_path` o la `thumbnail_path` de una de sus filas de `plant_photos` (#184) o de las columnas de `plants` (la principal; se conserva para una planta antigua sin filas). Los archivos sueltos de la carpeta (fotos reemplazadas o huérfanas) y los de plantas validadas o no identificables siguen cerrados. La política la llama dentro de un `case when (select public.is_catalog_admin())`, para que los usuarios sin rol nunca lleguen al guardián. **Coste:** se evalúa por archivo; son como mucho dos consultas por clave: la planta por `plants_pkey` y, si la ruta no es la principal, sus fotos (seis como mucho) por el índice único `plant_photos_plant_id_position_key` (`plant_id`, `position`). No hace falta ningún índice nuevo; `tests/fotos_storage.sql` y `tests/varias_fotos_cola.sql` comprueban los dos planes. La API la expone en `/rest/v1/rpc/is_pending_plant_photo`, solo para administradores.
- `tests/seguridad_general.sql` falla si aparece un bucket público no declarado en la prueba o una política de Storage para `anon`, para `PUBLIC` o `for all`.

Limitación de las pruebas: la base desechable no tiene Supabase Storage. `scripts/db-desechable/supabase-minimo.sql` simula lo mínimo del esquema `storage` (las tablas `buckets` y `objects`, `storage.foldername()`, el bloqueo de borrados directos y los permisos de los roles) a partir de las migraciones de [supabase/storage](https://github.com/supabase/storage), así que `tests/fotos_storage.sql` comprueba las políticas tal como las evalúa Postgres, con la orden SQL que corresponde a cada operación, pero no la API de Storage: ni los límites de tamaño y de tipo, ni las URL firmadas, ni cómo pasa el token de Clerk. Eso se comprueba al aplicar la migración en desarrollo. En Supabase, `postgres` crea las políticas de `storage.objects` sin ser su dueño gracias a `supautils.policy_grants`; aquí es miembro de `supabase_storage_admin`, que es más permisivo: una migración no debe alterar tablas de `storage`, porque aquí pasaría y en Supabase fallaría.

### Limpieza de fotos huérfanas

`scripts/fotos-huerfanas.mjs` (`npm run fotos:huerfanas`, #83) compara los objetos del bucket `plant-photos` con `photo_path` y `thumbnail_path` de todas las plantas y de todas las filas de `plant_photos` (#219): un archivo está en uso si lo cita cualquiera de las dos. La app borra los archivos al reemplazar, quitar o eliminar (ver el README principal), pero un fallo de red a mitad puede dejar restos.

```sh
npm run fotos:huerfanas -- --ambiente desarrollo                    # solo lista
npm run fotos:huerfanas -- --ambiente desarrollo --borrar           # borra
npm run fotos:huerfanas -- --ambiente produccion --borrar --confirmar-produccion
```

- Recorre el bucket (`<usuario>/<planta>/`) y lee las plantas y las filas de `plant_photos` de 1 000 en 1 000. Si el proyecto aún no tiene `plant_photos` (la migración sin aplicar: PostgREST responde `PGRST205`), lo avisa y compara solo con `plants`, que entonces es todo lo que hay.
- Informa de los objetos que no cita ninguna planta ni ninguna foto (`sin-planta`, o `fuera-de-convencion` si la ruta no sigue la convención), de los recientes que no toca y de las plantas o fotos que apuntan a un archivo que no existe (una vez por ruta, con el id de la foto si sale de `plant_photos`). Esto último solo se informa: el script nunca cambia una fila.
- Por defecto es un modo de prueba: lista y no borra nada. Con `--borrar`, borra en lotes de 100 solo los huérfanos con la antigüedad mínima (`--antiguedad-minima-horas`, 24 por defecto), para no llevarse una subida en curso cuya planta aún no apunta a ella. Un objeto sin fecha nunca se borra.
- Protección de ambiente: `--ambiente desarrollo|produccion` es obligatorio y `SUPABASE_PROJECT_REF` tiene que ser el ref de ese ambiente (los mismos que `scripts/supabase-db.mjs`); si no coincide, no se ejecuta nada. Para borrar en producción hace falta además `--confirmar-produccion`.
- Credencial: `SUPABASE_SECRET_KEY`, la clave secreta del proyecto (`sb_secret_...`, en Project Settings > API Keys; o la `service_role` heredada), y `SUPABASE_PROJECT_REF`. Se leen del entorno o de `supabase/.env` y nunca se imprimen. Hace falta esa clave porque el script tiene que ver los objetos y las plantas de todos los usuarios y las políticas solo dejan a cada uno ver lo suyo. Leer `storage.objects` con una conexión directa a Postgres serviría para listar, pero no para borrar: Supabase no deja borrar objetos con SQL, solo con la API de Storage.
- **Varias fotos por planta (#182, #219):** las fotos secundarias solo están en `plant_photos` y el script las cuenta como en uso, así que `--borrar` ya no se las lleva. Una subida de la galería sube los archivos antes de crear su fila; mientras tanto son huérfanos recientes, y la antigüedad mínima los protege.
- **Riesgo:** la clave secreta se salta RLS y puede leer y borrar todo el proyecto. No está en GitHub ni en ningún workflow; tenla en tu máquina solo mientras haces la limpieza, empieza siempre por el modo de prueba y revisa la lista antes de `--borrar`.
- La comparación es lógica pura en `apps/web/src/photos/orphans.ts`, probada con Vitest (`orphans.test.ts`, que comprueba también que el modo de prueba no borra). Node la carga quitando los tipos de TypeScript (Node 24). El script no se ha ejecutado contra ningún proyecto real.

### Datos sin dueño

`scripts/datos-sin-dueno/` (`npm run datos:sin-dueno`, #112, parte de #26) detecta perfiles, plantas, eventos de producto y fotos de usuarios que ya no existen en Clerk: una cuenta eliminada desde el panel de Clerk o una eliminación desde la app que falló a mitad. Por defecto solo lista; con `--borrar` borra, con la misma protección de ambiente que la limpieza de fotos y además la comprobación de que la clave de Clerk es de la instancia del ambiente. Necesita `SUPABASE_SECRET_KEY` y `CLERK_SECRET_KEY`. Uso, credenciales y riesgos en [su README](../scripts/datos-sin-dueno/README.md).

## Varias fotos por planta

Desde el #182 (parte del #181) cada planta tiene de 0 a 6 fotos en `public.plant_photos`, de la migración `20261122090000_varias_fotos_por_planta.sql`, donde están explicadas las decisiones. La capa de datos de la app (subir, leer y quitar varias fotos, el borrador con varias fotos y los scripts de limpieza) llegó con el #219; ver «Varias fotos por planta: API de datos» en el README principal. El formulario con galería es el #221.

| Columna                        | Qué es                                                                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                           | uuid, por defecto aleatorio.                                                                                                                       |
| `plant_id`                     | La planta; al borrarla se borran sus fotos (cascada).                                                                                              |
| `user_id`                      | Id de Clerk, por defecto el del token. Siempre el dueño de la planta: el disparador `check_plant` lo exige (o lo toma de la planta si viene nulo). |
| `photo_path`, `thumbnail_path` | Rutas en el bucket, obligatorias y dentro de `<user_id>/<plant_id>/` (con un nombre de archivo, sin subcarpetas y de 1024 caracteres como mucho).  |
| `in_bloom`                     | Si la foto es en floración.                                                                                                                        |
| `taken_at`, `note`             | Fecha de la foto (no futura, con un día de margen) y nota (no en blanco, hasta 500 caracteres). Opcionales.                                        |
| `position`                     | Orden, de 0 a 5 y único por planta. La foto principal es la de `position` más baja.                                                                |
| `created_at`                   | Cuándo se añadió.                                                                                                                                  |

- **Máximo de 6:** `position` va de 0 a 5 y es única por planta, así que no cabe una séptima foto. Lo comprueba el índice único, también con inserciones concurrentes y en cualquier nivel de aislamiento (la segunda falla con `23505`). La unicidad se comprueba al final de cada sentencia (`deferrable initially immediate`), para reordenar con un solo `update`.
- **Índices:** `(plant_id, position)` (el único) para las fotos de una planta en orden y la principal, y `(user_id)` para las de un usuario.
- **Permisos:** `authenticated` lee, inserta (todas las columnas menos `created_at`), cambia solo `photo_path`, `thumbnail_path`, `in_bloom`, `taken_at`, `note` y `position`, y borra, siempre solo las suyas. Una foto no cambia de planta ni de dueño. El administrador del catálogo además lee las fotos de las plantas por validar (`public.is_pending_plant(plant_id)`, [función de administrador](#funciones-de-administrador)), sin escribirlas. `anon` no tiene acceso; `service_role` lee y escribe.
- **Bucket:** las políticas de `storage.objects` no cambian. Las del dueño miran solo la carpeta del usuario, así que valen para cualquier número de archivos por planta. La del administrador abre, desde el #184, todas las fotos de `plant_photos` de las plantas por validar (`is_pending_plant_photo()`), y solo esas.

### Número de fotos

`public.photo_count(plants)` (#184, migración `20261124090000_varias_fotos_cola_y_recuento.sql`) devuelve cuántas filas de `plant_photos` tiene una planta (0 a 6). Es un **campo calculado** de PostgREST: se pide como una columna, `select=id,...,photo_count`, también en el `select` de un insert o un update, y `npm run db:types` lo pone en `Row` de `plants` (`photo_count: number | null`, con `ComputedFields: 'photo_count'`). La app lo lee con `COLLECTION_PLANT_SELECT`.

- **Por qué un recuento en la consulta y no un contador en `plants`:** un contador mantenido por disparadores obligaría a escribir la planta (y mover su `updated_at`) al añadir o quitar una foto que no es la principal, algo que el #182 evita a propósito; el recuento no cambia ninguna escritura. Tampoco depende de las funciones de agregado de PostgREST (`plant_photos(count)`), que Supabase trae desactivadas.
- **Coste medido** (base desechable, Postgres 14 en un portátil, 500 plantas con 1 500 fotos de un usuario y 5 000 plantas de otros, como ese usuario y con RLS): la consulta de la colección pasa de unos 0,2 ms a unos 7 ms, unos 14 µs por planta (la llamada a la función y la política de `plant_photos` por fila; en PL/pgSQL cuesta lo mismo). Una página de 1 000 plantas añadiría unos 14 ms, poco frente a la red y a la serialización.
- **Permisos:** `security invoker`, `stable`, `search_path` vacío; la ejecutan `authenticated` y `service_role`, no `anon`. Cuenta con RLS de quien llama: cada usuario solo sus fotos; con una fila ajena construida a mano, 0.
- **Detalle:** en un insert o un update con `select` ve el estado de antes de la sentencia, así que si la sentencia crea la principal por la sincronización con `plants` (la app antigua) devuelve 0 aunque la planta ya tenga foto. La app toma como mínimo 1 si hay principal (`photoCountOf()`).

### Foto principal y sincronización con `plants`

`plants.photo_path`, `plants.thumbnail_path` y `plants.photo_in_bloom` son una copia de la foto principal. Existen porque las versiones de la app ya instaladas (PWA con service worker) solo leen y escriben esas columnas, y porque la tarjeta del inventario las lee. `list_proposal_groups()` e `is_pending_plant_photo()` leen `plant_photos` desde el #184 y solo usan estas columnas para una planta antigua sin filas. El script de fotos huérfanas lee las dos tablas (#219). La base las mantiene sincronizadas en los dos sentidos con disparadores:

- **De `plant_photos` a `plants`:** al insertar, borrar o cambiar la posición, las rutas o `in_bloom` de una foto, se copia la principal (o `null`, `null`, `false` si no queda ninguna). Si no cambia nada, `plants` no se escribe y su `updated_at` no se mueve.
- **De `plants` a `plant_photos`** (la app antigua):
  - Poner la foto (rutas no nulas en una planta sin fotos, también al crearla): se crea la principal en la posición 0, con `in_bloom = photo_in_bloom`.
  - Sustituirla (rutas nuevas): cambian las rutas e `in_bloom` de la principal, y su fecha y su nota vuelven a `null`. Las demás fotos no cambian y no se añade ninguna.
  - Cambiar solo `photo_in_bloom`: cambia `in_bloom` de la principal.
  - Quitarla (las dos rutas a `null`): se borra solo la principal y la siguiente pasa a serlo. La misma sentencia devuelve ya la planta con la foto nueva. Sin más fotos, la planta queda sin foto y `photo_in_bloom` conserva lo que mande la app, como antes.
  - Una sola de las dos rutas se rechaza (`23514`, `plants_photo_paths_together`), igual que una ruta fuera de la carpeta de la planta (`plant_photos_photo_path_valid`). La app nunca lo hace.
- **Sin recursión:** cada lado escribe en el otro con la marca de transacción `orki.photo_sync` puesta y la restaura en cuanto termina; los disparadores del otro lado la ven y no hacen nada. Si la sentencia falla, Postgres revierte también la marca.
- **Concurrencia:** antes de escribir una foto, `check_plant` bloquea la fila de la planta (`for no key update`), así que las escrituras de fotos de una planta se hacen de una en una y la copia a `plants` parte siempre de lo confirmado. No frena las lecturas.
- **Otros disparadores de `plants`:** `set_updated_at` sigue actuando igual (si la sincronización cambia la foto de la planta, `updated_at` avanza) y `sync_with_species` no mira estas columnas. Una planta con fotos no puede cambiar de dueño (`check_photos_owner`).
- **Datos existentes:** la migración copió cada planta con foto y miniatura a la posición 0, con `in_bloom` de `photo_in_bloom` y `created_at` de la planta (`private.copy_legacy_plant_photos()`, idempotente). Las que tuvieran una sola ruta o rutas fuera de la convención se quedan sin fila, con un aviso en la salida de la migración.

Retirada (#186): cuando ninguna versión instalada de la app lea ni escriba las columnas de foto de `plants` y la tarjeta del inventario lea `plant_photos` (`list_proposal_groups()` e `is_pending_plant_photo()` ya lo hacen desde el #184, con las columnas solo como respaldo que habrá que quitar), una migración quitará los disparadores de sincronización y las tres columnas.

**Reordenar** (#183): `public.reorder_plant_photos(target_plant_id uuid, photo_ids uuid[])` recibe los ids de todas las fotos de la planta en el orden nuevo y las recoloca con un solo `UPDATE` (la unicidad de la posición es diferible y se comprueba al final de la sentencia); la primera pasa a ser la principal y `sync_plant` la copia a `plants`. Es `security invoker`: valen la RLS y los privilegios por columna. Una lista incompleta, con repetidos o con fotos de otra planta o de otra persona se rechaza con `22023`. Migración `20261124100000_reordenar_fotos.sql`, pruebas en `tests/reordenar_fotos.sql`.

## Fotos de referencia

La migración `20261124110000_fotos_de_referencia.sql` (#234, parte de #180), donde están explicadas las decisiones, añade las fotos de referencia de las especies: una foto por especie, sacada de iNaturalist y **copiada** a nuestro almacenamiento, que la app muestra siempre como «foto de referencia» con su autor y su licencia (en la ficha del catálogo público, al elegir la especie en el registro y en el detalle de una planta sin foto propia). La investigación (campos de iNaturalist, licencias, atribución, tamaños, cobertura) está en [docs/inaturalist.md](../docs/inaturalist.md); la carga que las obtiene es otro encargo y tiene que cumplir el [contrato](#contrato-de-la-carga) de abajo.

### Modelo

`public.species_photos`, una fila por especie (restricción única `species_photos_species_id_key`; la tabla tiene su propio `id` para poder admitir varias fotos el día que haga falta, como `plant_photos`):

| Columna                                                       | Qué es                                                                                                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `species_id`                                                  | La especie; al borrarla se borra su foto (cascada).                                                                                                                       |
| `medium_path`, `medium_width`, `medium_height`                | Versión media (unos 500 px de lado mayor, como mucho 1024) en el bucket `species-photos`, sin el nombre del bucket.                                                       |
| `thumbnail_path`, `thumbnail_width`, `thumbnail_height`       | Miniatura (unos 160 px, como mucho 320), en la misma carpeta.                                                                                                             |
| `source`                                                      | Enumerado `species_photo_source`; hoy solo `inaturalist`.                                                                                                                 |
| `source_photo_id`, `source_observation_id`, `source_taxon_id` | Ids en iNaturalist de la foto (obligatorio), de la observación de la que salió (si salió de una) y del taxón emparejado. Enteros positivos, como texto.                   |
| `source_selection`                                            | Cómo la eligió la carga: `taxon_default` (la foto por defecto del taxón), `taxon_photo` (otra foto del taxón) u `observation` (exige `source_observation_id`). Opcional.  |
| `source_url`                                                  | La página de la foto, exactamente `https://www.inaturalist.org/photos/<source_photo_id>`: el enlace de la atribución.                                                     |
| `license`                                                     | `cc0`, `pd` (dominio público), `cc-by` o `cc-by-sa`: los códigos de iNaturalist.                                                                                          |
| `author_name`                                                 | El autor como hay que nombrarlo (`attribution_name` de iNaturalist o, en las de observaciones, el nombre o el usuario del observador). Obligatorio, hasta 200 caracteres. |
| `attribution`                                                 | El texto de atribución de la fuente («(c) Ana Pérez, some rights reserved (CC BY)»). Obligatorio, hasta 500 caracteres.                                                   |
| `is_modified`                                                 | Si la imagen guardada está adaptada (reducida y convertida a WebP): `true` por defecto. La atribución lo dice («adaptada»).                                               |
| `obtained_at`, `created_at`, `updated_at`                     | Cuándo la obtuvo la carga de la fuente, cuándo se creó la fila y cuándo cambió.                                                                                           |

- **Licencias:** la restricción `species_photos_license_accepted` impide guardar cualquier otra (NC, ND, «todos los derechos reservados», mayúsculas o variantes), también a la carga. Es texto con una restricción y no un enumerado para poder quitar una licencia de la lista el día que se decida. Con BY-SA, la versión reducida se publica con esa misma licencia (decisión del #180). En TypeScript, `SpeciesPhotoLicense` y `speciesPhotoLicenses`.
- **Atribución:** `author_name` y `attribution` no pueden faltar ni estar en blanco, tampoco con CC0 y dominio público (que no la exigen, pero se da igual): no puede existir una foto sin atribución.
- **Rutas:** `<uuid>/<nombre>.webp`, sin subcarpetas, las dos en la misma carpeta y distintas. La convención es `<id de la especie>/medium-<source_photo_id>.webp` y `<id de la especie>/thumb-<source_photo_id>.webp`: una foto nueva tiene otra URL, así que ninguna caché sirve la anterior. La base no exige que la carpeta sea la especie de la fila, porque tras una fusión la foto pasa a la conservada con sus rutas. Ningún dato personal.

### Fotos retiradas

`public.species_photo_rejections` guarda una fila por foto retirada de una especie (clave primaria `species_id`, `source`, `source_photo_id`), con `source_url` y `author_name` (para leerla sin la auditoría), `reason` (`misidentified`, `inappropriate`, `author_request` u `other`), `rejected_by` (id de Clerk), `rejected_at` y `action_id` (la acción de la auditoría). Si se borra la especie, su memoria se va con ella.

- **Retirar** es borrar la fila de `species_photos` y anotar la retirada. Se eligió una tabla aparte y no una marca en `species_photos`: con la marca, la foto retirada seguiría ocupando el único sitio de la especie, todas las lecturas tendrían que filtrarla y solo se recordaría una retirada por especie.
- **La base impide reponerla:** el disparador `check_not_rejected` (`before insert or update` en `species_photos`) rechaza con `23514` (`species_photos_not_rejected`) una fila cuya foto está retirada para esa especie, la escriba quien la escriba (la carga como `postgres`, la clave de servicio o una fusión). Una foto distinta se acepta: así se propone otra.
- **Por especie:** una foto mal identificada para una especie puede ser buena para otra. Si el autor pide que no se use (`author_request`), la carga debería dejar de usar esa foto en todas las especies; eso no lo impone la base.
- **Concurrencia:** `retire_species_photo()` bloquea la especie `for update` y el disparador la bloquea `for key share` antes de mirar las retiradas, así que una retirada y una carga que escribe esa foto se hacen una detrás de otra: o la carga ve la retirada y falla, o la retirada ve la foto nueva y avisa. `for key share` no frena las ediciones de la especie, pero sí su fusión y su baja mientras dure la transacción de la carga.

`public.retire_species_photo(target_species_id, target_source_photo_id, retire_reason)` es una [función de administrador](#funciones-de-administrador) (`security definer`, guardián primero, `search_path` vacío, solo `authenticated`): registra la acción `retire_species_photo` en la auditoría (con la especie como objetivo, así que sale en `species_history()`, y en `details` la especie, el motivo, la foto, su licencia, su autor y sus rutas), borra la foto y anota la retirada, en una transacción. Devuelve `action_id`, `medium_path` y `thumbnail_path`. `target_source_photo_id` es la foto que vio el administrador: si la especie ya tiene otra o ninguna, no se toca nada.

| Código  | Motivo                    | Cuándo                                                                                    | Datos                                                      |
| ------- | ------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `22023` | `reason_required`         | El motivo es nulo o no es uno de los cuatro.                                              |                                                            |
| `P0002` | `species_photo_not_found` | La especie no existe, no tiene foto o su foto no es `target_source_photo_id` (o es nulo). | `species_id`, `source_photo_id`, `current_source_photo_id` |
| `42501` |                           | Sin el rol de administrador.                                                              |                                                            |

**Hueco: los archivos.** El administrador no puede escribir en el bucket, así que tras una retirada los dos archivos se quedan en `species-photos` (sin ninguna fila que los cite; quien conozca la ruta todavía los puede descargar). Los borra la carga, o un script con la clave de servicio, comparando los objetos del bucket con las rutas de `species_photos` (ver el contrato). Lo mismo pasa con la foto de una especie borrada o la de una absorbida que se descarta en una fusión.

### Bucket `species-photos`

- **Público** (`public = true`): son imágenes con licencia abierta para visitantes sin sesión, y un bucket público las sirve por `/storage/v1/object/public/species-photos/<ruta>` (en la app, `supabase.storage.from('species-photos').getPublicUrl(ruta)`) sin firmar URL, con la caché del CDN. Es el único bucket público declarado en `tests/seguridad_general.sql`.
- **Sin políticas** de `storage.objects`: nadie lo lista ni sube, reemplaza o borra por la API (ni `anon`, ni un usuario, ni el administrador); la clave de servicio (`service_role`) se salta RLS y es la única que escribe. Un archivo se descarga conociendo su ruta, también el de una especie no pública; las rutas solo las dan las funciones públicas (que no sacan las no públicas) y la tabla, con sesión.
- Tope de 256 KiB por archivo (`file_size_limit = 262144`; el medio en WebP ronda los 60 KB y la miniatura los 10 KB) y solo `image/webp`. Como en `plant-photos`, la base desechable no aplica estos límites: se comprueban al aplicar la migración en desarrollo.

### Quién lee y escribe

| Quién                                       | `species_photos`                                                                                                                           | `species_photo_rejections`       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `anon`                                      | Nada directamente: la foto de las especies públicas por `get_public_species()`, `search_public_species()` y `list_public_genus_species()`. | Nada.                            |
| `authenticated` sin rol                     | Lee todas (como el resto del catálogo).                                                                                                    | Nada (la política exige el rol). |
| Administrador del catálogo                  | Lee todas; retira con `retire_species_photo()`.                                                                                            | Lee.                             |
| `service_role` (clave de servicio)          | Lee, inserta, cambia y borra.                                                                                                              | Solo lee.                        |
| `postgres` (la carga, con conexión directa) | Todo, sujeto a las restricciones y al disparador.                                                                                          | Todo; no debería escribirla.     |

- **Catálogo público:** `get_public_species()` devuelve `reference_photo`, un objeto con `medium_path`, `medium_width`, `medium_height`, `thumbnail_path`, `thumbnail_width`, `thumbnail_height`, `author_name`, `attribution`, `license`, `source`, `source_url`, `source_observation_id`, `is_modified` y `obtained_at`; `search_public_species()` y `list_public_genus_species()`, `reference_thumbnail`, con solo la miniatura y lo que hace falta para atribuirla (`thumbnail_*`, `author_name`, `license`, `source`, `source_url`, `is_modified`). Las dos son nulas si la especie no tiene foto, y una especie no pública no sale en ninguna. Son una columna nueva al final de cada función: el JSON de respuesta solo gana un campo, así que el código que ya las llamaba sigue funcionando; las funciones se borraron y se crearon otra vez en la migración, en la misma transacción, y PostgREST recarga su caché al terminar.
- **Con sesión:** la app lee la tabla. La foto de la especie elegida en el registro es una consulta por clave (`/rest/v1/species_photos?species_id=eq.<id>`); en el detalle de una planta sin foto propia se puede embeber en la consulta que ya hace (`species(..., species_photos(...))`; PostgREST la ve como uno a uno y devuelve un objeto). No se amplió `search_species()`: es la función más delicada del catálogo, `search_public_species()` depende de ella y el registro solo enseña la foto al elegir la especie, no en cada sugerencia. Si un día se quieren miniaturas en las sugerencias, es una consulta por lote (`species_id=in.(...)`) por respuesta.
- **Tipos:** `SpeciesPhoto`, `SpeciesPhotoRejection`, `SpeciesPhotoLicense`, `SpeciesPhotoSource`, `ReferencePhoto`, `ReferenceThumbnail` y `RetireSpeciesPhotoResult`, en `apps/web/src/lib/database.ts`.

### Fusiones

`merge_species()` (redefinida en esta migración, con la misma firma y el mismo resultado):

- La foto de la conservada nunca se toca.
- Si la conservada no tiene foto y la absorbida sí, la de la absorbida pasa a la conservada (se mueve la fila, con sus rutas; los archivos no se mueven), salvo que esa foto esté retirada para la conservada. Es una foto de la misma especie y ahorra volver a obtenerla.
- Si las dos tienen foto, la de la absorbida se borra con ella y sus archivos quedan para la limpieza.
- Las retiradas de la absorbida pasan a la conservada, sin repetir las que ya tenía.
- Los detalles de la acción `merge_species` llevan `reference_photo`: `outcome` (`moved`, `discarded` o `null` si la absorbida no tenía foto), `merged_source_photo_id`, `kept_source_photo_id` y `moved_rejection_count`. La vista previa no cambia: no dice qué pasará con la foto.

### Contrato de la carga

La carga de fotos (otro encargo, en `scripts/catalog-import`) tiene que:

1. **Leer** con conexión directa como `postgres`, como la del catálogo: las especies, las fotos actuales (`species_id`, `source`, `source_photo_id`, rutas) y **todas** las retiradas, y descartar de antemano las fotos retiradas de cada especie (la base las rechazaría igualmente, con `23514`, y la transacción entera fallaría). Si la base no tiene `species_photos` (migración sin aplicar), negarse a escribir.
2. **Elegir** solo fotos con licencia `cc0`, `pd`, `cc-by` o `cc-by-sa` y sin marcas y, si el autor pidió que no se use una foto suya (`author_request`), no usarla en ninguna especie.
3. **Subir primero los archivos**, con la clave de servicio (API de Storage), a `species-photos/<id de la especie>/medium-<id de la foto>.webp` y `.../thumb-<id de la foto>.webp`, en WebP, como mucho 1024 y 320 px de lado y 256 KiB, con una caché larga (`cacheControl`): el contenido de una ruta no cambia. El nombre depende solo de la foto, así que repetir una subida (con `upsert`) es inofensivo.
4. **Después, escribir las filas** en **una transacción** por carga: `insert ... on conflict (species_id) do update` (sustituir es cambiar la fila), solo las que cambian, y en la misma transacción una fila de resumen con `private.log_catalog_action('catalog_import', details, null, null, <identificador de la carga>)` y `details.load_type = 'fotos_referencia'`, con los recuentos (creadas, sustituidas, sin cambios, omitidas por retiradas, sin foto). Las filas no se auditan una a una (la conexión no trae token). Si algo falla, no queda ninguna fila a medias y los archivos subidos quedan sin citar.
5. **Al final, limpiar:** borrar del bucket los archivos que ninguna fila de `species_photos` cita (los de fotos sustituidas, retiradas, de especies borradas o absorbidas, y los de una carga anterior que falló), solo con cierta antigüedad (como `fotos:huerfanas`, para no llevarse los de una carga en curso) y en modo de prueba por defecto. Se compara por la ruta, no por la carpeta: tras una fusión, la carpeta puede ser la de la especie absorbida.
6. **Reanudar:** volver a ejecutarla. Las subidas se repiten sin efecto (mismo nombre, mismo contenido) o se saltan si el objeto ya existe; las filas van en una sola transacción, así que una carga cortada no dejó ninguna y la siguiente las escribe todas; la limpieza se lleva lo que sobró.
7. **Mantenimiento:** al repetirla, comparar por `source_photo_id`: si la foto elegida cambió a una licencia no aceptada o desapareció, quitar la fila (no es una retirada del administrador y no se anota en la memoria) o sustituirla.

### Rendimiento de las fotos

Índices: `species_photos_species_id_key` (la restricción única) resuelve todas las lecturas por especie (las tres funciones públicas, la consulta por clave de la app, el embebido y el borrado en cascada), y la clave primaria de `species_photo_rejections`, que empieza por `species_id`, la comprobación del disparador y la cascada. No hace falta ningún otro: la carga lee las tablas enteras.

`npm run db:perf` añade una foto sintética a una de cada tres especies (10 000 fotos; la cobertura medida en iNaturalist ronda el 10-30 %) y mide, además de las consultas de antes, la ficha de una especie con foto y las dos lecturas con sesión. 23 de noviembre de 2026, catálogo sintético por defecto, PostgreSQL 17.12 en un contenedor `postgres:17` (Podman, 4 CPU y 3,7 GB) sobre un Apple M4 Pro, 30 ejecuciones medidas tras 3 de calentamiento:

| Llamada                                             |     Mediana (ms) |         p95 (ms) | Antes, sin fotos (mediana, ver [Índices y rendimiento](#índices-y-rendimiento)) |
| --------------------------------------------------- | ---------------: | ---------------: | ------------------------------------------------------------------------------: |
| Búsqueda pública `ph` / `phal amab` / `alba`        | 0,2 / 9,2 / 15,4 | 0,2 / 9,3 / 16,9 |                                                                0,1 / 9,6 / 16,2 |
| Especies del género más grande, página 1 (50)       |              0,5 |              0,5 |                                                                             0,5 |
| Especies del género más grande, última página (100) |              2,9 |              3,0 |                                                                             3,5 |
| Ficha (Phalaenopsis amabilis)                       |              0,5 |              0,6 |                                                                             0,6 |
| Ficha de una especie con foto (la primera por id)   |              0,2 |              0,2 |                                                                               — |
| Con sesión: la foto de la especie elegida           |           < 0,05 |           < 0,05 |                                                                               — |
| Con sesión: las fotos de diez sugerencias           |           < 0,05 |           < 0,05 |                                                                               — |

Una segunda ejecución dio lo mismo con diferencias de menos de 1 ms (la mayor, la última página del género grande: 3,1 ms). La foto no cuesta nada medible: es una búsqueda por clave por fila devuelta (como mucho 100 en una página), y ninguna consulta recorre `species_photos` de forma secuencial. La tabla con 10 000 fotos ocupa 4,3 MB (0,7 MB de índices). En el registro, mostrar la foto al elegir la especie añade una petición por elección (no por tecla); embebida en el detalle de una planta, ninguna.

## Eventos de producto

Los dos eventos con los que se miden los objetivos de la Fase 1 (#24) viven en `public.product_events`, de la migración `20261121170000_eventos_de_producto.sql` (#145), donde están explicadas las decisiones. Los envía la app (#146).

| Columna             | Qué es                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `id`                | uuid generado por la app al crear el evento; evita duplicados al reintentar. Obligatorio.                     |
| `user_id`           | Id de Clerk del token (`public.requesting_user_id()`). Lo pone la base: `authenticated` no puede escribirlo.  |
| `type`              | `plant_registered` (registro completado) o `have_it_search` (búsqueda "¿Ya la tengo?").                       |
| `result`            | Solo en `have_it_search`, obligatorio: `owned` (la tengo), `not_owned` (no la tengo) o `similar` (parecidas). |
| `duration_ms`       | Duración medida en la app, de 0 a 86 400 000 (24 horas).                                                      |
| `has_photo`         | Solo en `plant_registered`, obligatorio: si se registró con foto.                                             |
| `name_pending`      | Solo en `plant_registered`, obligatorio: si el nombre quedó por validar.                                      |
| `generated_offline` | Si se generó sin conexión y se envió después.                                                                 |
| `occurred_at`       | Cuándo ocurrió, según el dispositivo: de 30 días antes a 1 hora después de `received_at`.                     |
| `received_at`       | Cuándo llegó a la base (`now()`). `authenticated` no puede escribirlo.                                        |

No hay ninguna columna de texto libre (ni nombres de plantas, ni textos buscados, ni correo, ni nombre) ni de ambiente (cada proyecto de Supabase es uno). Cada fila tiene forma y tamaño fijos y solo admite los valores de las listas cerradas, así que la tabla no sirve de almacén arbitrario.

Envío, con sesión:

```ts
const { error } = await supabase.rpc('record_product_events', {
  events: [
    {
      id: crypto.randomUUID(),
      type: 'have_it_search',
      result: 'owned',
      duration_ms: 2300,
      generated_offline: false,
      occurred_at: new Date().toISOString(),
    },
  ],
})
```

- `public.record_product_events(events jsonb) returns void`: inserta un lote de 0 a 100 eventos (el tipo de cada elemento es `ProductEventPayload`, en `apps/web/src/lib/database.ts`). Es `security invoker` y con `search_path` vacío; solo la ejecuta `authenticated`.
- **Reintentos:** un evento con un `id` ya registrado se ignora sin error y sin cambiarlo (`on conflict do nothing`), también dentro del mismo lote. La función no dice si un id ya existía. Reenviar un lote cuya respuesta se perdió es seguro.
- **Errores:** el lote es atómico. Si no es un arreglo o tiene más de 100 elementos da `22023`; un valor que no es del tipo (un enumerado desconocido, un id que no es uuid) da `22P02`; un campo obligatorio que falta, `23502`; una restricción incumplida, `23514`. Ninguno se arregla reintentando: la app debe descartar ese lote. Los errores de red, de sesión o 5xx sí se reintentan.
- **Fuera de la función:** un `insert` directo en la tabla funciona, pero un id repetido da `23505`, y un upsert de supabase-js con `ignoreDuplicates` (como el de `profiles`) da `42501`, porque `on conflict (id)` exige leer la columna `id`. Por eso la app usa la función.

Quién puede qué:

- `authenticated`: solo insertar eventos suyos (permiso por columna sin `user_id` ni `received_at`, y la política "Cada usuario registra sus eventos" exige `user_id = (select public.requesting_user_id())`). No puede leer, editar, borrar ni vaciar, tampoco sus propios eventos. Un token sin `sub` no puede registrar nada.
- `anon`: nada. La app guarda los eventos hasta tener sesión.
- `service_role`: leer y borrar, para scripts de mantenimiento (como el de datos sin dueño del #26). No inserta ni edita.
- Los indicadores se consultan como dueño de la tabla, en el editor SQL de Supabase o con una conexión directa.

Borrado con la cuenta: como `plants`, la tabla no tiene clave foránea hacia `profiles` (un evento puede llegar antes de que exista el perfil). El disparador `delete_product_events` de `profiles` (función `private.delete_profile_events()`, `security definer`) borra los eventos del usuario al borrar su perfil, venga de la app (eliminación de cuenta, #26), de la clave de servicio o del editor SQL. La app debe vaciar su cola de eventos antes de borrar el perfil; un evento que llegue después queda sin perfil, como lo que deja un fallo a medias, y lo detecta el script de datos sin dueño del #26.

Indicadores: [`docs/indicadores-de-eventos.sql`](../docs/indicadores-de-eventos.sql) da, por semana (de lunes a domingo, en hora de Lima, por `occurred_at`), el total, cuántos cumplen el objetivo y su porcentaje, y la mediana y el percentil 90 de la duración: registros en menos de 1 minuto y búsquedas "¿Ya la tengo?" en menos de 5 segundos. `tests/eventos_de_producto.sql` ejecuta ese mismo archivo sobre datos de prueba.

## Tipos de TypeScript

La app usa tipos generados a partir de estas migraciones (`apps/web/src/lib/database.types.ts`), con los que el cliente de Supabase comprueba al compilar tablas, columnas y enumerados. Cuándo regenerarlos:

- Después de crear o cambiar una migración (antes de hacer commit).
- Después de actualizar la CLI de Supabase o Prettier, si `npm run db:types:check` dice que no coinciden.

`npm run db:types` los genera sin Docker ni credenciales, sobre la misma base desechable que las pruebas, y solo con el esquema `public`. `npm run db:types:check` hace lo mismo sin escribir y falla si el archivo versionado es distinto; es lo que ejecuta el CI. Si la migración añade una tabla o un enumerado, añade también su alias en `apps/web/src/lib/database.ts`. El detalle está en la sección [Tipos de TypeScript del esquema](../README.md#tipos-de-typescript-del-esquema) del README principal.

## Rendimiento de la búsqueda

`npm run db:perf` mide `public.search_species()` y las funciones del [catálogo público](#catálogo-público) con un catálogo sintético del tamaño del real (#70) o, con `--catalogo-real`, con la exportación real de COL. No corre en el CI: es una orden aparte, para repetirla cuando cambie la búsqueda, sus índices o el catálogo.

Qué hace, siempre sobre la base desechable de las pruebas (nunca sobre los proyectos de Supabase):

1. Aplica todas las migraciones y carga el catálogo sintético de `scripts/db-perf/catalogo-sintetico.sql` (o, con `--catalogo-real RUTA`, la exportación de COL con `orki-catalogo cargar --ambiente local --escribir`; ver [su README](../scripts/catalog-import/README.md)), y después hace `vacuum analyze`.
2. Ejecuta como `authenticated` (la app la llama siempre con sesión; antes del #231 se medía como `anon`) 31 consultas típicas del autocompletado (prefijos de 2 y 3 letras, prefijo de género, abreviaturas solas y con epíteto, género e inicio de epíteto, híbrido natural con y sin «x», nombres con errores, sin tildes, sinónimos, nombre común, sin resultados, epítetos muy frecuentes y una consulta larga), cada una 3 veces para calentar y 30 veces medidas, con el tope de resultados por defecto (10).
3. Ejecuta como `anon` 14 llamadas a las funciones del [catálogo público](#catálogo-público): la búsqueda con seis textos y con 15 resultados, la primera y la última página de géneros, la primera y la última página del género con más especies, un género pequeño y dos fichas (la especie con más nombres y Phalaenopsis amabilis). Los ids se calculan antes, como dueño.
4. Reporta por consulta la mediana, el p95 y el máximo del tiempo dentro de la base de datos (con `clock_timestamp()` alrededor de la llamada, sin la red ni PostgREST), las filas devueltas y cuántas veces por llamada se recorrieron los índices de búsqueda (el btree de prefijo y los dos de trigramas) y, de forma secuencial, `species` y `species_names` (diferencia de `pg_stat_user_indexes` y `pg_stat_user_tables`; hace falta PostgreSQL 15 o posterior).
5. Imprime el tamaño de las tablas e índices del catálogo y de la base completa.

Termina con código 1 si el p95 de alguna consulta supera el objetivo, si alguna no recorre sus índices (los de búsqueda; en el catálogo público, también los parciales y las claves de la ficha) o si recorre `species_names` de forma secuencial (las listas y la ficha públicas, tampoco `species`). Desde la búsqueda por etapas, una consulta que se resuelve por prefijo de una palabra (`dendrob`) solo recorre el btree de prefijo.

```sh
npm run db:perf
npm run db:perf -- --especies 60000 --sinonimos 160000 --planes
npm run db:perf -- --catalogo-real /ruta/a/export.zip   # necesita uv
```

| Opción                 | Por defecto | Qué es                                                                                                                                                                                                          |
| ---------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--generos N`          | 900         | Géneros del catálogo sintético.                                                                                                                                                                                 |
| `--especies N`         | 30000       | Especies e híbridos aceptados.                                                                                                                                                                                  |
| `--sinonimos N`        | 80000       | Sinónimos.                                                                                                                                                                                                      |
| `--comunes N`          | 3000        | Nombres comunes.                                                                                                                                                                                                |
| `--semilla TEXTO`      | `orki`      | Semilla del generador: la misma semilla con las mismas cifras da exactamente el mismo catálogo.                                                                                                                 |
| `--repeticiones N`     | 30          | Ejecuciones medidas de cada consulta, después de 3 de calentamiento.                                                                                                                                            |
| `--umbral-ms N`        | 300         | Objetivo por consulta, comparado con el p95.                                                                                                                                                                    |
| `--planes`             | no          | Muestra además el plan (`explain analyze, buffers`) de las consultas internas de `search_species` que tardan 1 ms o más (una por etapa) y de todas las de las funciones del catálogo público, con auto_explain. |
| `--catalogo-real RUTA` | no          | Carga la exportación de COL indicada (`export.zip`) en lugar del catálogo sintético; las cinco opciones del generador no se usan.                                                                               |

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
