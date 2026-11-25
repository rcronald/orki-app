# Base de datos

Secciones que estaban en el README de la raíz hasta el #288; el índice de la documentación está en el [README](../../README.md#documentación).

## Base de datos y migraciones

Orki tiene dos ambientes, cada uno con su propio proyecto de Supabase: desarrollo y producción. No se usa el entorno local de Supabase con Docker; el ambiente de desarrollo es el proyecto remoto de desarrollo.

El esquema de la base de datos se define con migraciones SQL versionadas en `supabase/migrations`. La CLI de Supabase está instalada como dependencia de desarrollo (paquete `supabase`), así que no hace falta instalarla aparte: `npm ci` la deja lista y se puede usar directamente con `npx supabase`. Los scripts `db:*` la envuelven para el flujo habitual.

### Credenciales

Los scripts y el workflow usan las mismas tres variables:

| Variable                | Qué es                                             | Dónde se obtiene                                                                                     |
| ----------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN` | Token de acceso a la API de gestión de Supabase.   | En el panel de Supabase, Account > Access Tokens.                                                    |
| `SUPABASE_DB_PASSWORD`  | Contraseña de la base de datos del proyecto.       | Se define al crear el proyecto; se puede restablecer en Project Settings > Database.                 |
| `SUPABASE_PROJECT_REF`  | Identificador del proyecto (20 letras minúsculas). | En Project Settings > General (Project ID); también es el subdominio de `https://<ref>.supabase.co`. |

El token puede ser de alcance limitado a un proyecto, y en GitHub se usa uno por ambiente (ver [Producción](#producción)): el de desarrollo no tiene acceso a producción. Necesita, como mínimo, lectura del proyecto y lectura de la configuración del pooler de conexiones (`database_pooling_config_read`). Los permisos que pide cada orden están en su ayuda, sección PERMISSIONS (`npx supabase link --help`, `npx supabase db push --help`, `npx supabase db dump --help`).

El segundo permiso hace falta porque la conexión directa a la base de datos solo funciona por IPv6, que no está disponible en muchas redes ni en los ejecutores de GitHub Actions. Los scripts enlazan el proyecto antes de cada comando (`supabase link`), y el enlace guarda la dirección del pooler, que sí funciona por IPv4, en `supabase/.temp` (ignorado por git). Sin ese permiso el enlace no guarda la dirección y la CLI falla con "IPv6 is not supported on your current network".

En tu máquina, las credenciales son siempre las del proyecto de desarrollo. Cópialas en `supabase/.env` a partir de la plantilla:

```sh
cp supabase/.env.example supabase/.env
```

`supabase/.env` está ignorado por git y es solo para la CLI de Supabase; no lo confundas con las variables de la app web, que viven en `apps/web`. Si una variable ya está definida en el entorno de la terminal, se usa esa en lugar de la del archivo. Las credenciales de producción no se guardan en ninguna máquina: solo están en GitHub.

### Crear una migración

```sh
npm run db:new -- crear_tabla_plantas
```

Crea un archivo vacío `supabase/migrations/<fecha y hora>_crear_tabla_plantas.sql` donde se escribe el SQL. No necesita credenciales. Usa nombres descriptivos en minúsculas y con guiones bajos.

Una migración que ya está en `main` no se edita ni se borra, porque ya se aplicó en producción: para cambiar algo, se crea otra migración.

### Aplicar migraciones en desarrollo

```sh
npm run db:status   # qué migraciones están aplicadas y cuáles pendientes
npm run db:push     # aplica las pendientes
```

`db:push` muestra las migraciones pendientes y, en una terminal interactiva, pide confirmación antes de aplicarlas. Para saltar la confirmación (por ejemplo, fuera de una terminal interactiva) se usa `npm run db:push -- --yes`, y para ver qué se aplicaría sin aplicar nada, `npm run db:push -- --dry-run`. Si no hay migraciones pendientes, no hace nada. Si falta alguna de las tres variables, los dos scripts terminan con un error que dice cuál.

Lo habitual es pasar las pruebas de base de datos (`npm run db:test`, ver la sección siguiente) y después aplicar y probar la migración en desarrollo antes de abrir el pull request.

### Datos de ejemplo en desarrollo

```sh
npm run db:seed:dev
```

Carga en el proyecto de desarrollo unas pocas especies e híbridos reales del catálogo, con sinónimos y nombres comunes, para probar el registro y el autocompletado sin esperar al catálogo real, que llega con la importación del issue #8. El SQL está en `supabase/datos-ejemplo/catalogo.sql`: 40 especies e híbridos de los cinco géneros de acceso rápido y de tres géneros más (Guarianthe, Paphiopedilum y Brassia, con sus abreviaturas de la RHS), 10 sinónimos (varios de un género distinto del aceptado, como _Cattleya skinneri_ para _Guarianthe skinneri_) y 12 nombres comunes, con tildes y eñes.

**Es solo para desarrollo.** No es una migración ni el `seed.sql` de la CLI, así que `db:push` y el workflow de producción no lo aplican nunca. Además, el comando se niega a ejecutarse si `SUPABASE_PROJECT_REF` no es el proyecto de desarrollo (`xaitolsnmjlpyptntfwi`), y lo dice expresamente si es el de producción. Usa las mismas credenciales que `db:push` (ver [Credenciales](#credenciales)): enlaza el proyecto, ejecuta el archivo con `supabase db query --remote --yes` y muestra un resumen de lo que hay en el catálogo.

Se puede repetir: todas las inserciones usan `on conflict ... do nothing` sobre las claves únicas del esquema, así que volver a cargarlo no duplica nada ni cambia lo que ya existe (tampoco las especies editadas a mano; si cambias en el archivo el género o el tipo de una especie ya cargada, ese cambio no se aplica). Todo va en un único bloque `do`, de modo que o se carga entero o no se carga nada. No toca `plants` ni `profiles`. Las pruebas de base de datos (`supabase/tests/datos_ejemplo.sql`) lo cargan sobre la base desechable y comprueban los recuentos, que una segunda carga no cambia nada y que no toca el inventario.

#### Plantas de ejemplo para un usuario

Para probar el inventario con una colección grande (por ejemplo, la prueba de fluidez con 100 plantas) hay un segundo conjunto de datos, también solo para desarrollo:

```bash
npm run db:seed:plants -- <id de usuario de Clerk> [cantidad]   # 100 por defecto, 1000 como mucho
npm run db:seed:plants -- <id de usuario de Clerk> --borrar     # quita solo las de ejemplo
```

- El id de usuario es el de la instancia de **desarrollo** de Clerk (`user_...`). Se ve en `/diagnostico` con la sesión iniciada, en local o en una vista previa.
- Carga `supabase/datos-ejemplo/plantas.sql`: un 85 % de plantas enlazadas a especies del catálogo, repartidas entre los géneros más comunes en cultivo, y un 15 % con nombre libre, que quedan "por validar"; con fechas, orígenes, ubicaciones, algunos apodos y colores, y unas pocas dadas de baja. Conviene tener cargado antes el catálogo (el real o los datos de ejemplo).
- Todas llevan un origen terminado en " (prueba)". Por eso `--borrar` no toca las plantas reales del usuario.
- Cada ejecución añade plantas; no sustituye las anteriores.
- Como `db:seed:dev`, se niega a ejecutarse si el proyecto no es el de desarrollo. Escribe con la conexión de administración, que no pasa por las políticas RLS: por eso exige el id exacto del usuario.

### Pruebas de la base de datos

```sh
npm run db:test
npm run db:test -- sincronizacion acceso   # solo los archivos cuyo nombre contiene alguna palabra
npm run db:concurrencia                    # dos sesiones a la vez (supabase/tests/concurrencia.test.mjs)
```

`npm run db:concurrencia` prepara la misma base desechable, con el mismo servidor, y abre dos conexiones a la vez para lo que una sola sesión no puede probar: fusiones simultáneas de especies, el contador de identificadores de planta, la bitácora sin duplicados y la séptima foto (#295). Cada prueba deja a una sesión esperando el bloqueo de la otra (lo comprueba en `pg_stat_activity`, sin pausas), confirma o revierte la primera y mira qué le pasó a la segunda.

Las pruebas comprueban el esquema sin tocar los proyectos de Supabase. El comando crea una base de datos Postgres vacía y desechable, le añade lo mínimo de Supabase que necesitan las migraciones, aplica todas las migraciones de `supabase/migrations` en orden, ejecuta las pruebas de `supabase/tests` y, al terminar, borra la base. Cada prueba corre en una transacción que se revierte, así que no deja datos (y el comando lo comprueba al final). La salida dice qué prueba falló, en qué línea y por qué; el comando termina con código distinto de cero si falla alguna prueba o alguna migración.

Necesita PostgreSQL 17 (en macOS, `brew install postgresql@17`), la misma versión mayor que el CI y los proyectos de Supabase. No necesita Docker, ni credenciales, ni `npm ci`. Con un servidor anterior al 17 el comando se niega a seguir y explica cómo instalarlo, porque algo puede pasar en otra versión y fallar en el CI: ya pasó con una prueba que funcionaba en el 14 y fallaba en el 17 por una conversión implícita (`text || "char"`), y en el 14 no existen `security_invoker` ni `nulls not distinct`. Para ejecutarlo de todos modos con otra versión, sin garantías, `ORKI_PERMITIR_PG_ANTIGUO=1 npm run db:test` (solo avisa). Lo mismo vale para `npm run db:types` y `npm run db:perf`, que preparan la misma base. Puede usar dos tipos de servidor:

- **Clúster temporal (por defecto).** Si no se define `ORKI_TEST_DB_URL`, crea un servidor Postgres con `initdb` y `pg_ctl` en un directorio temporal, que escucha solo en `127.0.0.1` en un puerto libre y con una contraseña aleatoria, y lo destruye al terminar, también si falla una prueba o se interrumpe con Ctrl+C. Busca los binarios (`initdb`, `pg_ctl` y `psql`), por este orden, en el directorio que indique `ORKI_PG_BINDIR`, en el PostgreSQL 17 de Homebrew (`/opt/homebrew/opt/postgresql@17/bin`, o `/usr/local/opt/postgresql@17/bin` en un Mac con Intel), en el de `pg_config --bindir` y en el `PATH`. `postgresql@17` es un paquete keg-only: Homebrew no lo enlaza en el `PATH`, así que puede convivir con otra versión enlazada (por ejemplo, la 14) sin cambiar nada, y el comando usa igualmente el 17. Si lo tienes en otro sitio, indícalo con `ORKI_PG_BINDIR=/ruta/a/postgresql-17/bin`. La primera línea de la salida dice qué versión se usa.
- **Un servidor que ya tengas.** Indica su URL en `ORKI_TEST_DB_URL` con un usuario superusuario:

  ```sh
  ORKI_TEST_DB_URL=postgresql://usuario:clave@localhost:5432/postgres npm run db:test
  ```

  Si no quieres instalar el 17, sirve un contenedor desechable con la imagen oficial (con Docker o Podman; el superusuario se llama `supabase_admin` para que `postgres` no lo sea, como en Supabase y en el CI):

  ```sh
  podman run -d --rm --name orki-pg17 -e POSTGRES_USER=supabase_admin -e POSTGRES_PASSWORD=desechable -p 127.0.0.1:55432:5432 postgres:17
  ORKI_TEST_DB_URL=postgresql://supabase_admin:desechable@127.0.0.1:55432/postgres npm run db:test
  podman stop orki-pg17
  ```

  La base de la URL solo se usa para conectarse: el comando trabaja en una base nueva que crea y borra él mismo (`orki_pruebas_...`) y no toca las demás. Crea los roles `anon`, `authenticated`, `service_role` y `postgres` si no existen (son del servidor, no de una base) y los borra al terminar si los creó él. Si el servidor ya tiene un rol `postgres` superusuario, avisa: las migraciones se aplicarán con más permisos que en Supabase.

Por seguridad, el comando se niega a ejecutarse si la URL apunta a Supabase (`*.supabase.co`, `*.supabase.com`, incluido el pooler, o `*.supabase.net`), sin excepciones, y solo acepta hosts locales (`localhost`, `127.x.x.x` y `::1`). Para usar un servidor desechable en otra máquina o contenedor, nombra su host en `ORKI_TEST_DB_ALLOW_HOST` (por ejemplo `ORKI_TEST_DB_ALLOW_HOST=postgres-pruebas`). La URL no admite más parámetros que `sslmode`, para que nada cambie el servidor al que se conecta, y la contraseña nunca se imprime.

En el CI, el job **Pruebas de base de datos** de `.github/workflows/ci.yml` corre en cada pull request y en cada push a `main` con un servicio de Postgres 17 (imagen oficial `postgres:17`, la misma versión mayor que los proyectos de Supabase) y `ORKI_TEST_DB_URL` apuntando a él.

Qué simula de Supabase (en `scripts/db-desechable/supabase-minimo.sql`): los roles `anon`, `authenticated` y `service_role` (este último ignora RLS), el rol `postgres` sin superusuario como dueño de lo que crean las migraciones (que se aplican con él, cada una en su transacción, como la CLI de Supabase), los esquemas `extensions` y `auth`, `auth.jwt()` leyendo las claims de `request.jwt.claims` y los privilegios por defecto que Supabase concede sobre lo nuevo de `public` (el peor caso, para comprobar que las migraciones los retiran; desde el #283 una migración los cierra para `anon` y `authenticated`, ver [Privilegios por defecto y listas blancas](../../supabase/README.md#privilegios-por-defecto-y-listas-blancas)). Las pruebas de acceso reproducen una petición de la API con `set local role` y `set local request.jwt.claims`.

Qué no cubren:

- La API de Supabase (PostgREST): ni el paso del token a `request.jwt.claims` ni qué expone la API. Se simula en SQL.
- El token real de Clerk ni su validación en Supabase: las pruebas inventan las claims (`sub`).
- El resto de Supabase: Supabase Auth, almacenamiento, otros esquemas y extensiones del proyecto, y la configuración de cada proyecto (por ejemplo, si un proyecto antiguo concede privilegios por defecto distintos).
- Concurrencia entre transacciones: cada prueba corre en una sola sesión.
- Diferencias de versión menor: en local y en el CI se usa la 17, como Supabase, pero no necesariamente la misma versión menor. Con `ORKI_PERMITIR_PG_ANTIGUO=1` se puede usar una versión mayor anterior; el CI sigue siendo la referencia.
- La configuración regional: en el clúster temporal se usa `en_US.UTF-8` si existe (si no, `C.UTF-8` o `C`); con `C`, `lower()` no pasa a minúsculas las letras con tilde.

Cómo se escriben las pruebas y cómo añadir una al crear una migración está en [supabase/README.md](../../supabase/README.md#pruebas-de-base-de-datos).

La preparación de la base es una pieza aparte, `scripts/db-desechable/index.mjs`, que otros scripts pueden reutilizar cuando necesiten el esquema sin tocar Supabase: `conBaseDesechable(trabajo)` crea la base, aplica el mínimo de Supabase y las migraciones, llama a `trabajo` con la conexión y lo limpia todo al terminar. La usan también los tipos de TypeScript (sección siguiente).

### Tipos de TypeScript del esquema

```sh
npm run db:types         # regenera apps/web/src/lib/database.types.ts
npm run db:types:check   # comprueba que el archivo versionado está al día
```

El cliente de Supabase de la app está tipado con el esquema (`createClient<Database>` en `apps/web/src/lib/supabase.ts`), así que usar una tabla o una columna que no existe, o un valor que no está en un enumerado, es un error de compilación. Los tipos salen de las migraciones, no de un proyecto de Supabase:

- `apps/web/src/lib/database.types.ts` es el archivo generado. Se versiona y no se edita a mano; su cabecera lo recuerda. ESLint lo ignora; Prettier no, porque el generador ya lo entrega formateado con la configuración del repositorio.
- `apps/web/src/lib/database.ts` pone nombres cómodos a esos tipos para el resto de la app: la fila, la inserción y la actualización de cada tabla (`Plant`, `PlantInsert`, `PlantUpdate`, `Species`...), cada enumerado (`PlantStatus`, `FlowerColor`...) y `enumValues`, con los valores de cada enumerado en orden para recorrerlos en la interfaz. Este archivo se escribe a mano: si una migración añade una tabla o un enumerado, añade aquí su alias.
- `apps/web/src/lib/database.test.ts` es la prueba de tipos: con `@ts-expect-error` comprueba que `npm run typecheck` rechaza tablas y columnas inexistentes y valores de enumerado inválidos, y que los alias existen. No hace consultas.

`npm run db:types` prepara la misma base desechable que las pruebas (todas las migraciones sobre el mínimo de Supabase), ejecuta contra ella `supabase gen types --schema=public` con la CLI del proyecto y formatea el resultado con Prettier. Necesita lo mismo que `npm run db:test` (`psql`, y `initdb` y `pg_ctl` o `ORKI_TEST_DB_URL`) más las dependencias instaladas (`npm ci`), pero no Docker ni credenciales: la CLI de Supabase genera los tipos sin contenedores cuando recibe la URL de una base de datos. Solo incluye el esquema `public`, que es el que expone la API; los esquemas `auth`, `extensions` y `private` quedan fuera. Si el archivo ya estaba al día, no lo toca.

La regla: **una migración nueva va en el mismo commit que los tipos regenerados.** Después de escribir o cambiar una migración, ejecuta `npm run db:types` e incluye `database.types.ts` en el commit. En el CI, el job **Pruebas de base de datos** ejecuta `npm run db:types:check` sobre el Postgres 17 del job: genera los tipos de nuevo y falla si no son idénticos al archivo versionado, mostrando la primera línea distinta y el comando que hay que ejecutar. Falla tanto si falta regenerar tras una migración como si alguien editó el archivo a mano.

El resultado no depende de la versión de PostgreSQL (se comprobó que la 14 y la 17 generan exactamente el mismo archivo) ni de la configuración regional del servidor, porque la CLI ordena tablas, columnas y enumerados por su cuenta. Sí depende de las versiones de la CLI de Supabase y de Prettier fijadas en `package-lock.json`: al actualizar cualquiera de las dos, ejecuta `npm run db:types` y versiona el resultado si cambia.

Una limitación: al generar desde una URL de base de datos, la CLI no añade la versión de PostgREST del proyecto (la clave interna `__InternalSupabase` que sí añade al generar desde un proyecto de Supabase), y el cliente de la app (`supabase-client.ts`), como hacía `supabase-js`, supone entonces PostgREST 12. Solo afecta al tipado de opciones propias de versiones posteriores de PostgREST.

### Producción

Las migraciones nunca se aplican en producción desde una máquina local. El workflow `.github/workflows/migraciones.yml` (Actions > Migraciones) las aplica y, en producción, publica después la web (ver [Despliegue ordenado](despliegue-y-ci.md#despliegue-ordenado)):

- Automáticamente, en cada push a `main` (al fusionar un pull request), toque o no `supabase/migrations/`. Usa el environment `prod` de GitHub.
- A mano, desde la pestaña Actions de GitHub con "Run workflow", eligiendo el environment `dev` o `prod`. Con `dev` solo aplica las migraciones y no despliega nada; con `prod`, que solo se puede lanzar desde `main`, aplica y publica la web. Desarrollo se puede lanzar desde cualquier rama, para probar en el proyecto de desarrollo la migración de un pull request antes de fusionarlo.

En cada ejecución, por este orden:

1. Comprueba la rama (producción, solo `main`), el identificador del proyecto y, en producción, que existe el secreto del Deploy Hook de Vercel. Si algo falta, termina con un error que dice qué crear y dónde, **antes de tocar la base**: o se aplican las migraciones y se publica la web, o ninguna de las dos cosas.
2. Simula (`db push --dry-run`) y deja en el resumen de la ejecución la lista de migraciones pendientes, o «Ninguna».
3. Si hay alguna pendiente, guarda una copia del esquema de la base tal como está (`node scripts/supabase-db.mjs esquema <archivo>`, que llama a `supabase db dump`: solo estructura, sin filas ni roles) como artefacto `esquema-previo-<ambiente>-...` de la ejecución, que se conserva 14 días. Antes de subirla comprueba que no contiene la contraseña ni el token; si los contuviera, la borra y no aplica nada. Si la copia no se puede hacer, avisa y sigue sin ella: es una ayuda, no una condición (el esquema ya está en las migraciones). El repositorio es público: cualquiera con cuenta de GitHub puede descargar los artefactos. El esquema es el de las migraciones, que ya son públicas, más lo que se haya cambiado a mano en el panel.
4. Aplica las pendientes (`npm run db:push -- --yes`) y deja el estado en el registro (`npm run db:status`). Si no falta ninguna, no cambia nada.
5. Solo en producción: publica la web, y la prueba de humo comprueba que se publicó (ver [Despliegue ordenado](despliegue-y-ci.md#despliegue-ordenado)).

Nunca corren dos ejecuciones a la vez sobre el mismo ambiente: la siguiente espera a que termine la que está en curso.

Las credenciales de este workflow están en GitHub, en Settings > Environments, cada una en su environment (`dev` y `prod`):

| Nombre                     | Tipo     | Qué es                                                                                                                                          |
| -------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN`    | Secreto  | Token de la API de gestión de Supabase, **uno por ambiente**, limitado a su proyecto (ver [Credenciales](#credenciales)).                       |
| `SUPABASE_DB_PASSWORD`     | Secreto  | Contraseña de la base de datos del proyecto del ambiente.                                                                                       |
| `SUPABASE_PROJECT_REF`     | Variable | Identificador del proyecto del ambiente.                                                                                                        |
| `VERCEL_DEPLOY_HOOK_URL`   | Secreto  | Solo en `prod`: URL del Deploy Hook de producción de Vercel. Nunca como secreto del repositorio, para que un job de `dev` no pueda usarlo.      |
| `APP_URL`                  | Variable | Solo en `prod`, opcional: URL pública de la app (`https://...`), para la prueba de humo.                                                        |
| `SUPABASE_PUBLISHABLE_KEY` | Variable | Solo en `prod`, opcional: la clave publicable del proyecto de producción (la misma de `VITE_SUPABASE_PUBLISHABLE_KEY`), para la prueba de humo. |

Hasta el #281, `SUPABASE_ACCESS_TOKEN` era un único secreto del repositorio con acceso a la cuenta: cualquier job lo leía, también uno de `dev` lanzado desde una rama con el workflow cambiado. Un secreto de environment tiene prioridad sobre uno del repositorio con el mismo nombre, así que, una vez creados los dos de environment, hay que **borrar el del repositorio** para que deje de estar al alcance de los jobs sin environment o de `dev`. Solo lo usa este workflow: los demás (importación, fotos de referencia y los dos programados) no usan la API de gestión.

Protección de los environments (Settings > Environments, la configura el responsable):

- `prod`: «Deployment branches and tags» limitado a `main`. Así ningún workflow lanzado desde otra rama, aunque lo hayan cambiado en ella, recibe los secretos de producción. Es la protección de verdad; la comprobación de rama del propio workflow solo evita equivocarse. Los demás workflows que usan `prod` (importación, fotos de referencia, retención e informe) ya exigen `main` o corren programados desde `main`, así que la restricción no les afecta.
- `prod`, opcional: «Required reviewers». Cada push a `main` esperaría entonces a que alguien apruebe en Actions antes de migrar y publicar, también los cambios que solo tocan documentación. Afectaría también a la retención diaria y al informe semanal, que se quedarían esperando la aprobación.
- `dev` se deja sin restricción de rama: probar la migración de un pull request en el proyecto de desarrollo desde Actions es parte del flujo, y lo mismo hacen «Importar catálogo» y «Fotos de referencia». Con un token limitado al proyecto de desarrollo, lo peor que puede hacer un job de `dev` es tocar desarrollo.

Los workflows manuales de carga usan además `SUPABASE_POOLER_HOST` (variable de cada environment, «Importar catálogo» y «Fotos de referencia») y `SUPABASE_SECRET_KEY` (secreto de cada environment, «Fotos de referencia» y los dos programados de abajo); ver sus secciones abajo. El informe semanal usa además `CLERK_SECRET_KEY` (secreto de cada environment, nuevo con el #293).

### Tareas periódicas

Dos workflows programados, en producción (detalles, configuración y qué hacer con un aviso en [Retención y limpieza](retencion-y-limpieza.md)):

- **Retención de eventos** (`.github/workflows/retencion-de-eventos.yml`), **cada día** a las 04:17 UTC: borra los eventos de producto de más de 13 meses con `public.purge_expired_product_events()`.
- **Informe de datos sin dueño** (`.github/workflows/informe-datos-sin-dueno.yml`), **cada lunes** a las 07:23 UTC: cuenta, sin borrar nada, las fotos huérfanas y los datos de usuarios que ya no existen en Clerk.

Además, **el primer lunes de cada mes**, alguien revisa el resumen de la última ejecución del informe (o antes, si deja un aviso) y, si hay algo, lo lista y lo borra a mano con `npm run fotos:huerfanas` y `npm run datos:sin-dueno`.

### Importación del catálogo

El catálogo de especies (Catalogue of Life) se carga con `orki-catalogo cargar` de `scripts/catalog-import/`, después de aplicar las migraciones. En desarrollo se puede cargar desde tu máquina o con el workflow; en producción, solo con el workflow manual `.github/workflows/importar-catalogo.yml` (Actions > Importar catálogo), que simula por defecto, exige escribir el identificador del proyecto para escribir en producción y deja el reporte como artefacto. Usa `SUPABASE_DB_PASSWORD` y `SUPABASE_PROJECT_REF` del environment y además la variable `SUPABASE_POOLER_HOST`, que hay que crear en cada environment. La guía completa (pasos por ambiente, cómo leer el reporte y qué hacer con una versión nueva de la fuente) está en [Ejecución por ambiente](../../scripts/catalog-import/README.md#ejecución-por-ambiente).

### Fotos de referencia

Las fotos de referencia de las especies (iNaturalist, #234) se cargan con `orki-catalogo cargar-fotos-inaturalist`. En producción, solo con el workflow manual `.github/workflows/fotos-de-referencia.yml` (Actions > Fotos de referencia), desde `main` y con el environment `prod`: simula por defecto, elige el alcance (por defecto el de la orden, unos géneros, un tope de especies o todo el catálogo), puede listar o borrar después los archivos que sobran en el bucket, guarda entre ejecuciones la caché de iNaturalist para reanudar una carga cortada y deja el reporte como artefacto. Usa los mismos `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` y `SUPABASE_POOLER_HOST` que la importación y además el secreto `SUPABASE_SECRET_KEY` de cada environment (la clave secreta de cada proyecto), que hay que crear. La guía (entradas, duración por alcance, cómo reanudar) está en [Con el workflow](../../scripts/catalog-import/README.md#con-el-workflow).
