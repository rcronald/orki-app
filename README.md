# Orki

Orki es una aplicación web para coleccionistas de orquídeas. Es una PWA pensada primero para el celular y con la interfaz en español. En la Fase 1 cada persona registra las orquídeas que tiene y, al ver una nueva en una tienda o un vivero, comprueba al instante si ya la tiene para no comprarla repetida.

La especificación completa de la Fase 1 está en [docs/specification.md](docs/specification.md).

## Estado actual

El repositorio contiene la base del monorepo: la app web con React, Vite, TypeScript y Tailwind CSS, configurada como PWA, junto con el lint, el formato, las pruebas y la integración continua. También está el flujo de migraciones de la base de datos con la CLI de Supabase (ver [Base de datos y migraciones](#base-de-datos-y-migraciones)). La app lee su configuración de variables de entorno, la valida al arrancar y crea el cliente de Supabase, aunque todavía no hace ninguna consulta (ver [Variables de entorno de la app](#variables-de-entorno-de-la-app)). La configuración de despliegue en Vercel está versionada en `apps/web/vercel.json` (ver [Despliegue en Vercel](#despliegue-en-vercel)); el proyecto de Vercel se crea a mano en un paso posterior. Todavía no hay autenticación; llega en un issue posterior.

## Requisitos

- Node.js 24.15.0 o posterior dentro de la línea 24 (LTS). El archivo `.nvmrc` fija la versión mayor 24; algunas dependencias de pruebas (jsdom) exigen al menos la 24.15.0, así que con una 24 anterior `npm` muestra avisos `EBADENGINE`.
- npm 11 o posterior, el que viene con Node 24. El proyecto usa npm workspaces; no uses pnpm ni yarn.
- Git.

Si usas [nvm](https://github.com/nvm-sh/nvm), `nvm install` dentro del repositorio instala la última versión 24 disponible, que cumple el requisito.

## Instalación y desarrollo local

```sh
git clone https://github.com/rcronald/orki-app.git
cd orki-app
nvm install    # opcional, solo si usas nvm
npm ci
cp apps/web/.env.example apps/web/.env.local   # y completa los valores
npm run dev
```

`npm ci` instala las dependencias de todo el monorepo a partir del único `package-lock.json`, que está en la raíz. `npm run dev` levanta el servidor de desarrollo de Vite en <http://localhost:5173>. Antes de `npm run dev` hay que preparar `apps/web/.env.local` con los datos del proyecto de Supabase de desarrollo, como se explica en [Variables de entorno de la app](#variables-de-entorno-de-la-app); sin ese archivo la app arranca, pero muestra una pantalla de error que dice qué variables faltan. Las pruebas y el build no necesitan ninguna variable.

Para abrir la app desde el celular en la misma red, expón el servidor en la red local:

```sh
npm run dev -- --host
```

Antes de abrir un pull request conviene ejecutar lo mismo que ejecuta la integración continua:

```sh
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```

## Scripts

Todos se ejecutan desde la raíz del repositorio.

| Script                 | Qué hace                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| `npm run dev`          | Levanta el servidor de desarrollo de la app web (Vite). Acepta opciones de Vite después de `--`.             |
| `npm run build`        | Comprueba los tipos y genera el build de producción de la app web en `apps/web/dist`, con el service worker. |
| `npm run preview`      | Sirve el build de `apps/web/dist` en local para probarlo. Requiere ejecutar antes `npm run build`.           |
| `npm run typecheck`    | Comprueba los tipos de TypeScript de la app web sin generar archivos.                                        |
| `npm run lint`         | Ejecuta ESLint en todo el repositorio. Falla con cualquier aviso.                                            |
| `npm run format`       | Formatea todo el repositorio con Prettier.                                                                   |
| `npm run format:check` | Comprueba con Prettier que todo está formateado, sin modificar archivos.                                     |
| `npm test`             | Ejecuta las pruebas de la app web una vez (Vitest).                                                          |
| `npm run test:watch`   | Ejecuta las pruebas de la app web en modo observación.                                                       |
| `npm run db:new`       | Crea una migración vacía en `supabase/migrations`. Recibe el nombre después de `--`.                         |
| `npm run db:status`    | Muestra qué migraciones están aplicadas y cuáles pendientes en el proyecto de desarrollo.                    |
| `npm run db:push`      | Aplica las migraciones pendientes en el proyecto de desarrollo.                                              |

La app web tiene además un script propio para regenerar los iconos provisionales de la PWA en `apps/web/public`:

```sh
npm run icons --workspace=apps/web
```

## Estructura del monorepo

```text
orki-app/
├── .github/workflows/
│   ├── ci.yml                 Integración continua
│   └── migraciones.yml        Aplicación de migraciones en Supabase
├── apps/
│   └── web/                   App web (React, Vite, TypeScript, Tailwind CSS, PWA)
│       ├── public/            Iconos y archivos estáticos
│       ├── scripts/           Utilidades de la app (generación de iconos)
│       ├── src/               Código fuente y pruebas
│       │   ├── config/        Lectura y validación de las variables de entorno
│       │   └── lib/           Cliente de Supabase
│       ├── .env.example       Plantilla de las variables de entorno de la app
│       └── vercel.json        Configuración del despliegue en Vercel
├── docs/
│   └── specification.md       Especificación de la Fase 1
├── scripts/
│   ├── catalog-import/        Importación del catálogo de especies (pendiente)
│   └── supabase-db.mjs        Scripts de migraciones (db:new, db:status, db:push)
├── supabase/
│   ├── config.toml            Configuración de la CLI de Supabase
│   ├── migrations/            Migraciones SQL
│   └── .env.example           Plantilla de credenciales del proyecto de desarrollo
├── eslint.config.js           Configuración de ESLint para todo el repositorio
├── .prettierrc.json           Configuración de Prettier
├── .nvmrc                     Versión de Node
└── package.json               Workspaces y scripts de la raíz
```

Las dependencias se declaran en el `package.json` de cada workspace y se instalan desde la raíz. Las herramientas comunes (ESLint, Prettier, la CLI de Supabase) viven en el `package.json` de la raíz.

Hay dos versiones de TypeScript a propósito. La app compila y comprueba tipos con TypeScript 7 (`apps/web`). La raíz instala TypeScript 6 solo para ESLint, porque `typescript-eslint` todavía no soporta TypeScript 7. Cuando lo soporte, se elimina el TypeScript de la raíz.

## Variables de entorno de la app

La app web lee tres variables de entorno. Vite solo expone al navegador las que empiezan por `VITE_`, y su valor queda escrito en el JavaScript del build, así que aquí nunca va un secreto.

| Variable                        | Qué es                                                        | Dónde se obtiene                                                                                   |
| ------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`             | URL del proyecto de Supabase, con `https`.                    | En el panel de Supabase, botón Connect o Project Settings > Data API (Project URL).                |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Clave publicable del proyecto. Empieza por `sb_publishable_`. | En Project Settings > API Keys. No uses nunca una clave secreta (`sb_secret_`); la app la rechaza. |
| `VITE_APP_ENV`                  | Ambiente al que apunta la app: `dev` o `prod`.                | Lo decide quien configura el ambiente. Coincide con los nombres de los environments de GitHub.     |

La URL y la clave publicable no son secretas, pero tampoco se versionan, porque cambian de un ambiente a otro.

### Preparar el `.env` local

En tu máquina la app apunta siempre al proyecto de Supabase de desarrollo. Copia la plantilla y completa los valores:

```sh
cp apps/web/.env.example apps/web/.env.local
```

`apps/web/.env.local` está ignorado por git. Pon en él la URL y la clave publicable del proyecto de desarrollo y deja `VITE_APP_ENV=dev`. Si cambias el archivo con el servidor en marcha, reinicia `npm run dev`.

No lo confundas con `supabase/.env`: ese archivo es para la CLI de Supabase y contiene credenciales secretas (ver [Credenciales](#credenciales)); `apps/web/.env.local` es para la app y no lleva ningún secreto.

### Validación al arrancar

Al arrancar, la app comprueba que la URL es una URL `https` válida, que la clave no está vacía (y no es una clave secreta) y que el ambiente es `dev` o `prod`. Si algo falla, en lugar de la app aparece una pantalla de error que nombra cada variable con problemas y el motivo, sin mostrar nunca sus valores; la consola del navegador muestra también los nombres.

Fuera de producción, la app muestra en la esquina inferior izquierda una etiqueta pequeña con el ambiente ("Desarrollo"), para comprobar a simple vista a qué ambiente apunta una vista previa o el servidor local. Con `VITE_APP_ENV=prod` no aparece.

El cliente de Supabase se crea una sola vez, en `apps/web/src/lib/supabase.ts`, a partir de la configuración validada. No guarda sesión de Supabase Auth: la autenticación llegará con Clerk.

Las pruebas no leen estas variables (la validación se prueba con objetos de entorno de ejemplo), así que `npm test` y `npm run build` funcionan sin ningún `.env`, también en la integración continua.

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

El token necesita, como mínimo, permiso de lectura del proyecto y de lectura y escritura de la base de datos en los proyectos donde se van a aplicar migraciones.

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

Lo habitual es aplicar y probar la migración en desarrollo antes de abrir el pull request.

### Producción

Las migraciones nunca se aplican en producción desde una máquina local. El workflow `.github/workflows/migraciones.yml` las aplica:

- Automáticamente, cuando llega a `main` un cambio en `supabase/migrations/` (al fusionar un pull request). Usa el environment `prod` de GitHub.
- A mano, desde la pestaña Actions de GitHub con "Run workflow", eligiendo el environment `dev` o `prod`. Producción solo se puede lanzar desde `main`; desarrollo se puede lanzar desde cualquier rama.

El workflow instala las dependencias, ejecuta `npm run db:push -- --yes` y después `npm run db:status` para dejar el estado en el registro. Solo aplica las migraciones que faltan en ese ambiente; si no falta ninguna, termina sin cambios. Nunca corren dos ejecuciones a la vez sobre el mismo ambiente: la siguiente espera a que termine la que está en curso.

Las credenciales están registradas en GitHub (Settings > Secrets and variables > Actions, y Settings > Environments):

- `SUPABASE_ACCESS_TOKEN`: secreto del repositorio, compartido por los dos ambientes.
- `SUPABASE_DB_PASSWORD`: secreto de cada environment (`dev` y `prod`).
- `SUPABASE_PROJECT_REF`: variable de cada environment (`dev` y `prod`).

## Flujo de ramas

El proyecto sigue GitHub Flow:

1. `main` siempre está en estado desplegable. No se hacen commits directos en `main`.
2. Cada cambio se trabaja en una rama creada desde `main` y asociada a un issue, por ejemplo `feat/1-monorepo-base`.
3. Al terminar se abre un pull request hacia `main`. La integración continua ejecuta lint, verificación de formato, typecheck, pruebas y build, y tiene que pasar antes de fusionar.
4. Tras la revisión, el pull request se fusiona en `main` y la rama se borra.

## Integración continua

El workflow `.github/workflows/ci.yml` se ejecuta en cada pull request y en cada push a `main`. Instala las dependencias con `npm ci` usando la versión de Node de `.nvmrc` y la caché de npm, y después ejecuta `lint`, `format:check`, `typecheck`, `test` y `build`, en ese orden. Si cualquiera de esos pasos falla, el job falla. Cuando se suben nuevos commits a un pull request, la ejecución anterior de ese mismo pull request se cancela.
