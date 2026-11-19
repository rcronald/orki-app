# Orki

Orki es una aplicación web para coleccionistas de orquídeas. Es una PWA pensada primero para el celular y con la interfaz en español. En la Fase 1 cada persona registra las orquídeas que tiene y, al ver una nueva en una tienda o un vivero, comprueba al instante si ya la tiene para no comprarla repetida.

La especificación completa de la Fase 1 está en [docs/specification.md](docs/specification.md).

## Estado actual

El repositorio contiene la base del monorepo: la app web con React, Vite, TypeScript y Tailwind CSS, configurada como PWA, junto con el lint, el formato, las pruebas y la integración continua. También está el flujo de migraciones de la base de datos con la CLI de Supabase (ver [Base de datos y migraciones](#base-de-datos-y-migraciones)). La app lee su configuración de variables de entorno, la valida al arrancar y crea el cliente de Supabase, aunque todavía no hace ninguna consulta (ver [Variables de entorno de la app](#variables-de-entorno-de-la-app)). La configuración de despliegue en Vercel está versionada en `apps/web/vercel.json` (ver [Despliegue en Vercel](#despliegue-en-vercel)); el proyecto de Vercel se crea a mano en un paso posterior. La app ya tiene los tokens y los componentes base del design system de Orki, con una página interna de muestra fuera de producción (ver [Design system en la app](#design-system-en-la-app)), aunque todavía no hay pantallas reales ni enrutamiento. Todavía no hay autenticación; llega en un issue posterior.

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
│       │   ├── assets/        Marcador sin-foto.svg del design system
│       │   ├── components/    Componentes de la app
│       │   │   └── ui/        Componentes del design system
│       │   ├── config/        Lectura y validación de las variables de entorno
│       │   ├── lib/           Cliente de Supabase
│       │   ├── showcase/      Página interna de muestra (solo fuera de producción)
│       │   └── styles/        Tokens, fuentes y hojas de estilos de los componentes
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

## Design system en la app

La fuente de verdad del diseño es el [design system de Orki](https://claude.ai/artifact/BCQrAtoNqdjgkxEBfLpoaK): sus tokens, sus reglas de color, tipografía, iconos y voz, y los estilos de sus componentes. La app los lleva a código sin cambiarles el nombre; si algo difiere, manda el design system y la app se ajusta.

### Tokens

Los tokens viven en `apps/web/src/styles/tokens.css`, que es la única fuente de sus valores dentro de la app. Cada token es una variable CSS con el mismo nombre que en el design system (`var(--color-primary)`, `var(--space-4)`, `var(--radius-md)`) y, a la vez, forma parte del tema de Tailwind. La prueba de contraste (`src/styles/contrast.test.ts`) y la página de muestra leen ese archivo, así que un cambio de valor se hace solo ahí.

### Hojas de estilos

`apps/web/src/index.css` importa Tailwind, las fuentes (`styles/fonts.css`, servidas desde la app para que funcionen sin conexión), los tokens y una sola hoja de estilos de componentes, `styles/bundle.css`, en la capa `components` de Tailwind.

`styles/bundle.css` es una copia literal de `components/bundle.css` del design system, con las clases `orki-`. No se edita ni se formatea, para poder compararla con el original. Un cambio de estilo de un componente se hace primero en el design system y después se vuelve a copiar aquí.

### Utilidades de Tailwind

Los valores por defecto de Tailwind están vaciados: solo existen utilidades con valores del sistema. `bg-white`, `text-base`, `rounded`, `font-bold` o `p-5` no generan nada. Se usan los nombres de los tokens:

- Color: `bg-neutral-0`, `bg-neutral-50`, `text-neutral-900`, `text-neutral-700`, `text-secondary`, `border-secondary`, `bg-primary`, `bg-danger-soft`.
- Texto: `text-display`, `text-xl`, `text-lg`, `text-md`, `text-sm` y `text-xs` (cada uno con su interlineado y peso), `font-display`, `font-body`, `font-normal`, `font-semibold` y la utilidad `scientific-name` para los nombres científicos (font-display en cursiva).
- Espaciado: las utilidades llevan el nombre del token, `p-space-4`, `gap-space-2`, `mt-space-6`, `w-space-6`. No existe la escala numérica, así `space-5` (24 px) no se confunde con el paso 5 de Tailwind.
- Radios y sombra: `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-pill` y `shadow-card` (solo en tarjetas).

Los componentes usan las clases `orki-` de las hojas de estilos; Tailwind queda para componer las pantallas. Un `className` con utilidades de Tailwind (por ejemplo un margen) se aplica por encima de los estilos del componente sin reescribirlos.

### Componentes

Están en `apps/web/src/components/ui/`, cada uno con su prueba. No hay archivo de índice: se importa cada uno desde su archivo.

| Componente        | Para qué                                                                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `Button`          | Acciones. Variantes `primary` (una por pantalla), `secondary` y `danger`; ancho completo con `block`.                 |
| `Chip`            | Filtros y opciones cortas; botón de alternar con `selected`.                                                          |
| `ChipGroup`       | Fila de chips con su nombre para el lector de pantalla.                                                               |
| `TextField`       | Campo de texto con etiqueta visible, ayuda y error.                                                                   |
| `StatusBadge`     | Validación del nombre: "Validada" o "Nombre por validar".                                                             |
| `SpecimenCard`    | Tarjeta de un ejemplar; sin foto usa el marcador `sin-foto.svg`.                                                      |
| `OwnershipAnswer` | Respuesta de "¿Ya la tengo?".                                                                                         |
| `Autocomplete`    | Buscador con autocompletado de lista, con carga, sin resultados y una acción final opcional.                          |
| `Collapsible`     | Sección plegable.                                                                                                     |
| `Icon`            | Único punto de entrada de los iconos (subconjunto de Lucide del sistema); ningún otro archivo importa `lucide-react`. |

### Página de muestra

Fuera de producción, la ruta `/muestra` enseña todos los tokens (cada color con su valor y la razón de contraste de sus pares válidos, los estilos de texto, el espaciado, los radios y la sombra) y todos los componentes con sus variantes y estados. Para abrirla, con `npm run dev` en marcha, ve a <http://localhost:5173/muestra>; en una vista previa de Vercel, añade `/muestra` a la URL.

- Solo existe cuando `VITE_APP_ENV` no es `prod`. Con `prod`, la ruta muestra la app normal y el código de la página no entra en el build: `main.tsx` la carga de forma diferida detrás de una comparación con `import.meta.env.VITE_APP_ENV`, que Vite resuelve al construir, y el import desaparece. Además, al arrancar se comprueba otra vez el ambiente ya validado.
- No hay enrutador: `main.tsx` mira `location.pathname` al arrancar. Abrir o recargar `/muestra` funciona porque Vercel y el service worker responden cualquier ruta con `index.html`.
- Los nombres y valores que muestra se leen de `tokens.css`, y los contrastes usan la misma lista de pares y el mismo cálculo que la prueba de contraste (`src/styles/contrast.ts`), así la página no se desactualiza.
- `src/showcase/ShowcasePage.test.tsx` pasa [axe-core](https://github.com/dequelabs/axe-core) sobre la página (al cargar y con el buscador y la sección plegable abiertos) y falla ante cualquier incumplimiento de nivel A o AA de WCAG. jsdom no calcula colores, así que esa revisión no mide el contraste: lo cubre `contrast.test.ts`.

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

El token puede ser de alcance limitado a los dos proyectos de Orki. Necesita, como mínimo, lectura del proyecto y lectura de la configuración del pooler de conexiones (`database_pooling_config_read`).

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

## Despliegue en Vercel

La app web se despliega en Vercel, conectado al repositorio de GitHub:

- Cada pull request genera un despliegue de vista previa (ambiente Preview de Vercel) con su propia URL, y Vercel la publica como comentario en el pull request. Cada commit nuevo en el pull request genera una vista previa nueva. Las vistas previas apuntan al proyecto de Supabase de desarrollo.
- Cada push a `main` (al fusionar un pull request) despliega en producción (ambiente Production de Vercel), que apunta al proyecto de Supabase de producción.

Vercel solo construye y publica. Lint, formato, typecheck y pruebas los ejecuta la [integración continua](#integración-continua) de GitHub, que es la que tiene que pasar antes de fusionar; Vercel no los repite. Las migraciones de la base de datos tampoco pasan por Vercel: las aplica su propio workflow (ver [Producción](#producción)).

### Configuración versionada

La configuración vive en `apps/web/vercel.json`, porque Vercel lee ese archivo en el directorio raíz del proyecto de Vercel, que es `apps/web`. Define:

- Instalación: `npm ci --workspace=@orki/web`. Vercel ejecuta los comandos dentro de `apps/web`; npm detecta que es un workspace, usa el único `package-lock.json` de la raíz del repositorio y deja las dependencias en el `node_modules` de la raíz. Solo instala las dependencias de la app, no las herramientas de la raíz (ESLint, Prettier, la CLI de Supabase), que el build no necesita.
- Build: `npm run build`, el mismo script `tsc -b && vite build` que ejecuta la integración continua (allí se lanza desde la raíz con `npm run build`, que delega en este).
- Carpeta de salida: `dist`, es decir, `apps/web/dist`.
- Reescritura: cualquier ruta que no corresponda a un archivo del build responde con `index.html`, para que la app de una sola página funcione al abrir o recargar cualquier URL. Vercel sirve primero los archivos que existen, así que la reescritura nunca tapa `sw.js`, el manifest, los iconos ni los archivos de `assets/`. Las rutas bajo `assets/` y los `workbox-*.js` que no existen devuelven 404 en lugar de `index.html`, para que un archivo con hash que falta no se sirva como HTML.
- Caché: los archivos con hash en el nombre (`assets/*` y `workbox-*.js`) se guardan un año como inmutables (`public, max-age=31536000, immutable`). Todo lo demás, en particular `index.html`, `sw.js`, `registerSW.js` y `manifest.webmanifest`, se revalida en cada visita (`public, max-age=0, must-revalidate`), para que una versión nueva llegue en cuanto se despliega.

La versión de Node también está fijada en el repositorio. Vercel toma la versión del campo `engines.node` del `package.json` del directorio raíz del proyecto (`apps/web/package.json`), no del de la raíz del repositorio, y sin ese campo usaría la versión elegida en el panel (por defecto, la más reciente). Por eso `apps/web/package.json` repite el mismo rango que la raíz, `>=24.15.0 <25`, con el que Vercel usa Node 24. Si cambia el rango de la raíz, hay que cambiarlo también en `apps/web/package.json` y en `.nvmrc`. Vercel solo permite elegir la versión mayor y actualiza la menor por su cuenta.

### Crear el proyecto en Vercel

Se hace una sola vez, desde el panel de Vercel (Add New > Project, importando el repositorio `rcronald/orki-app`):

| Ajuste                                                                     | Valor                                                                                                                                     |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Root Directory                                                             | `apps/web`                                                                                                                                |
| Include files outside the root directory in the Build Step                 | Activado (es el valor por defecto). Hace falta porque el `package-lock.json` y el `node_modules` están en la raíz del repositorio.        |
| Framework Preset                                                           | Vite (Vercel lo detecta; `vercel.json` también lo fija).                                                                                  |
| Build Command, Output Directory, Install Command                           | Sin override: los valores salen de `vercel.json`. Si el panel muestra un override activado, desactívalo para que no haya dos fuentes.     |
| Node.js Version (Settings > Build and Deployment)                          | 24.x. Es solo para que el panel coincida con el repositorio: `engines` de `apps/web/package.json` manda y, si no coinciden, Vercel avisa. |
| Production Branch (Settings > Environments > Production > Branch Tracking) | `main` (Vercel elige `main` por defecto al importar; basta comprobarlo)                                                                   |

### Variables por ambiente

Las tres variables de la app (ver [Variables de entorno de la app](#variables-de-entorno-de-la-app)) se definen en Settings > Environment Variables, con un valor distinto según el ambiente de Vercel:

| Ambiente de Vercel | `VITE_SUPABASE_URL`            | `VITE_SUPABASE_PUBLISHABLE_KEY`             | `VITE_APP_ENV` |
| ------------------ | ------------------------------ | ------------------------------------------- | -------------- |
| Production         | URL del proyecto de producción | Clave publicable del proyecto de producción | `prod`         |
| Preview            | URL del proyecto de desarrollo | Clave publicable del proyecto de desarrollo | `dev`          |
| Development        | URL del proyecto de desarrollo | Clave publicable del proyecto de desarrollo | `dev`          |

Vite escribe estos valores en el JavaScript durante el build, así que un cambio de variable solo se aplica en el siguiente despliegue: después de cambiarla hay que volver a desplegar (Redeploy). Si falta alguna, el build termina bien, pero la app muestra la pantalla de error de configuración. El ambiente Development de Vercel solo se usa con la CLI de Vercel (`vercel env pull`, `vercel dev`), que este proyecto no necesita; se rellena igual para que los tres ambientes estén completos. Ninguna de estas variables es secreta: al crearlas se elige el tipo Config, no Secret, para que sus valores sigan siendo legibles en el panel.

## Flujo de ramas

El proyecto sigue GitHub Flow:

1. `main` siempre está en estado desplegable. No se hacen commits directos en `main`.
2. Cada cambio se trabaja en una rama creada desde `main` y asociada a un issue, por ejemplo `feat/1-monorepo-base`.
3. Al terminar se abre un pull request hacia `main`. La integración continua ejecuta lint, verificación de formato, typecheck, pruebas y build, y tiene que pasar antes de fusionar.
4. Tras la revisión, el pull request se fusiona en `main` y la rama se borra.

## Integración continua

El workflow `.github/workflows/ci.yml` se ejecuta en cada pull request y en cada push a `main`. Instala las dependencias con `npm ci` usando la versión de Node de `.nvmrc` y la caché de npm, y después ejecuta `lint`, `format:check`, `typecheck`, `test` y `build`, en ese orden. Si cualquiera de esos pasos falla, el job falla. Cuando se suben nuevos commits a un pull request, la ejecución anterior de ese mismo pull request se cancela.
