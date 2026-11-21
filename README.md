# Orki

Orki es una aplicación web para coleccionistas de orquídeas. Es una PWA pensada primero para el celular y con la interfaz en español. En la Fase 1 cada persona registra las orquídeas que tiene y, al ver una nueva en una tienda o un vivero, comprueba al instante si ya la tiene para no comprarla repetida.

La especificación completa de la Fase 1 está en [docs/specification.md](docs/specification.md).

## Estado actual

El repositorio contiene la base del monorepo: la app web con React, Vite, TypeScript y Tailwind CSS, configurada como PWA, junto con el lint, el formato, las pruebas y la integración continua. También está el flujo de migraciones de la base de datos con la CLI de Supabase, con pruebas que se ejecutan en un Postgres desechable (ver [Base de datos y migraciones](#base-de-datos-y-migraciones)). La app lee su configuración de variables de entorno, la valida al arrancar y crea el cliente de Supabase, aunque todavía no hace ninguna consulta (ver [Variables de entorno de la app](#variables-de-entorno-de-la-app)). La configuración de despliegue en Vercel está versionada en `apps/web/vercel.json` (ver [Despliegue en Vercel](#despliegue-en-vercel)); el proyecto de Vercel se crea a mano en un paso posterior. La app ya tiene los tokens y los componentes base del design system de Orki, con una página interna de muestra fuera de producción (ver [Design system en la app](#design-system-en-la-app)), aunque todavía no hay pantallas reales. La app usa Clerk para la autenticación, con las pantallas de inicio de sesión y de registro de Clerk en español y con la apariencia del design system, y React Router con el mapa de rutas de la Fase 1 (páginas provisionales), rutas que exigen sesión y una ruta solo para administradores del catálogo (ver [Autenticación](#autenticación)); la conexión con Supabase llega en un issue posterior.

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

`npm ci` instala las dependencias de todo el monorepo a partir del único `package-lock.json`, que está en la raíz. `npm run dev` levanta el servidor de desarrollo de Vite en <http://localhost:5173>. Antes de `npm run dev` hay que preparar `apps/web/.env.local` con los datos del proyecto de Supabase de desarrollo y la clave publicable de la instancia de desarrollo de Clerk, como se explica en [Variables de entorno de la app](#variables-de-entorno-de-la-app); sin ese archivo la app arranca, pero muestra una pantalla de error que dice qué variables faltan. Las pruebas y el build no necesitan ninguna variable.

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

| Script                   | Qué hace                                                                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`            | Levanta el servidor de desarrollo de la app web (Vite). Acepta opciones de Vite después de `--`.                                                                           |
| `npm run build`          | Comprueba los tipos y genera el build de producción de la app web en `apps/web/dist`, con el service worker.                                                               |
| `npm run preview`        | Sirve el build de `apps/web/dist` en local para probarlo. Requiere ejecutar antes `npm run build`.                                                                         |
| `npm run typecheck`      | Comprueba los tipos de TypeScript de la app web sin generar archivos.                                                                                                      |
| `npm run lint`           | Ejecuta ESLint en todo el repositorio. Falla con cualquier aviso.                                                                                                          |
| `npm run format`         | Formatea todo el repositorio con Prettier.                                                                                                                                 |
| `npm run format:check`   | Comprueba con Prettier que todo está formateado, sin modificar archivos.                                                                                                   |
| `npm test`               | Ejecuta las pruebas de la app web una vez (Vitest).                                                                                                                        |
| `npm run test:watch`     | Ejecuta las pruebas de la app web en modo observación.                                                                                                                     |
| `npm run db:new`         | Crea una migración vacía en `supabase/migrations`. Recibe el nombre después de `--`.                                                                                       |
| `npm run db:status`      | Muestra qué migraciones están aplicadas y cuáles pendientes en el proyecto de desarrollo.                                                                                  |
| `npm run db:push`        | Aplica las migraciones pendientes en el proyecto de desarrollo.                                                                                                            |
| `npm run db:seed:dev`    | Carga los datos de ejemplo del catálogo en el proyecto de desarrollo. Se niega a ejecutarse en producción.                                                                 |
| `npm run db:test`        | Ejecuta las pruebas de base de datos en un Postgres local y desechable. Acepta un filtro después de `--`.                                                                  |
| `npm run db:perf`        | Mide la búsqueda con un catálogo sintético en un Postgres desechable. No corre en el CI (ver [Rendimiento de la búsqueda](supabase/README.md#rendimiento-de-la-búsqueda)). |
| `npm run db:types`       | Regenera los tipos de TypeScript del esquema (`apps/web/src/lib/database.types.ts`) desde las migraciones.                                                                 |
| `npm run db:types:check` | Comprueba, sin escribir nada, que los tipos versionados coinciden con las migraciones. Lo usa el CI.                                                                       |

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
│       │   ├── auth/          Proveedor de Clerk, apariencia, estados, controles de cuenta, rol, rutas protegidas y token para Supabase
│       │   ├── components/    Componentes de la app (estructura con la navegación, página)
│       │   │   └── ui/        Componentes del design system
│       │   ├── config/        Lectura y validación de las variables de entorno
│       │   ├── diagnostics/   Panel de diagnóstico de la identidad (solo fuera de producción)
│       │   ├── lib/           Cliente de Supabase (con el token de Clerk) y tipos del esquema
│       │   ├── pages/         Pantallas (provisionales salvo las de acceso)
│       │   ├── routes/        Rutas de la app, enrutador de primer nivel, foco y título por página
│       │   ├── showcase/      Página interna de muestra (solo fuera de producción)
│       │   ├── styles/        Tokens, fuentes y hojas de estilos de los componentes
│       │   └── test/          Utilidades de las pruebas (axe, Clerk simulado)
│       ├── .env.example       Plantilla de las variables de entorno de la app
│       └── vercel.json        Configuración del despliegue en Vercel
├── docs/
│   └── specification.md       Especificación de la Fase 1
├── scripts/
│   ├── catalog-import/        Importación del catálogo de especies (pendiente)
│   ├── db-desechable/         Base Postgres desechable con el esquema aplicado
│   ├── db-test.mjs            Pruebas de base de datos (db:test)
│   ├── db-types.mjs           Tipos de TypeScript del esquema (db:types, db:types:check)
│   └── supabase-db.mjs        Scripts de migraciones y datos de ejemplo (db:new, db:status, db:push, db:seed:dev)
├── supabase/
│   ├── config.toml            Configuración de la CLI de Supabase
│   ├── datos-ejemplo/         Datos de ejemplo del catálogo, solo para desarrollo (db:seed:dev)
│   ├── migrations/            Migraciones SQL
│   ├── tests/                 Pruebas de base de datos en SQL
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
| `Autocomplete`    | Buscador con autocompletado de lista, con carga, sin resultados, error y una acción final opcional.                   |
| `Collapsible`     | Sección plegable.                                                                                                     |
| `Icon`            | Único punto de entrada de los iconos (subconjunto de Lucide del sistema); ningún otro archivo importa `lucide-react`. |

### Página de muestra

Fuera de producción, la ruta `/muestra` enseña todos los tokens (cada color con su valor y la razón de contraste de sus pares válidos, los estilos de texto, el espaciado, los radios y la sombra) y todos los componentes con sus variantes y estados. Para abrirla, con `npm run dev` en marcha, ve a <http://localhost:5173/muestra>; en una vista previa de Vercel, añade `/muestra` a la URL.

- Solo existe cuando `VITE_APP_ENV` no es `prod`. Con `prod`, la ruta da "Página no encontrada" y el código de la página no entra en el build: `src/routes/AppRouter.tsx` la carga de forma diferida detrás de una comparación con `import.meta.env.VITE_APP_ENV`, que Vite resuelve al construir, y el import desaparece. Además, la ruta solo se registra si el ambiente ya validado no es `prod`.
- Es una ruta de React Router de primer nivel, fuera de `<ClerkProvider>`: no necesita sesión, no descarga el script de Clerk y se ve aunque Clerk falle o no haya conexión. Abrir o recargar `/muestra` funciona porque Vercel y el service worker responden cualquier ruta con `index.html`.
- Los nombres y valores que muestra se leen de `tokens.css`, y los contrastes usan la misma lista de pares y el mismo cálculo que la prueba de contraste (`src/styles/contrast.ts`), así la página no se desactualiza.
- Con la configuración de Supabase (en la app siempre la hay), los buscadores "Nombre científico" y "Otro género" buscan en el catálogo real con la búsqueda de la app (ver [Búsqueda en el catálogo](#búsqueda-en-el-catálogo)), sin sesión: bajo cada especie se ve si coincidió por un sinónimo o un nombre común, y bajo cada género, la abreviatura. Sin conexión o con un fallo del servidor se ve un aviso en la lista. Sin configuración (en las pruebas) usan los datos fijos de `src/showcase/data.ts`; `src/showcase/ShowcaseLiveSearch.test.tsx` prueba la versión real con `fetch` simulado.
- `src/showcase/ShowcasePage.test.tsx` pasa [axe-core](https://github.com/dequelabs/axe-core) sobre la página (al cargar y con el buscador y la sección plegable abiertos) y falla ante cualquier incumplimiento de nivel A o AA de WCAG. jsdom no calcula colores, así que esa revisión no mide el contraste: lo cubre `contrast.test.ts`.

## Búsqueda en el catálogo

La app busca especies y géneros con las funciones de la API `search_species` y `search_genera` (ver [Búsqueda de especies](supabase/README.md#búsqueda-de-especies)). Desde la app se usan así:

- `apps/web/src/lib/catalogSearch.ts`: `searchSpecies(query, { signal, maxResults })` y `searchGenera(query, { signal, maxResults })` devuelven los resultados en camelCase (`scientificName`, `matchedName`, `matchedNameType`...). No hacen ninguna petición si la consulta recortada tiene menos de 2 o más de 100 caracteres (`SEARCH_QUERY_MIN_LENGTH` y `SEARCH_QUERY_MAX_LENGTH`, los límites de la base); piden 10 resultados por defecto y como mucho 20. Fallan con `CatalogSearchError`, cuyo `reason` es `aborted` (cancelada), `offline` (sin conexión) o `failed` (servidor o red). `speciesMatchText()` y `genusMatchText()` dan el texto de por qué coincidió ("Sinónimo: …", "Nombre común: …", "Abreviatura: …").
- `apps/web/src/lib/useCatalogSearch.ts`: `useSpeciesSearch(query)` y `useGenusSearch(query)` buscan mientras se escribe, con 250 ms de espera entre pulsaciones (`debounceMs`), cancelan la petición anterior al escribir de nuevo o al desmontar y nunca devuelven resultados de otra consulta. Devuelven `{ status, results, error }`, con `status` `idle` (menos de 2 caracteres), `loading`, `success`, `empty` o `error`, y `error.message` en español, distinto sin conexión.
- `Autocomplete` recibe esos estados: `loading`, `error` (el mensaje) y `minQueryLength` (por debajo no dice "Sin resultados").

Las funciones son públicas: sin sesión, la petición va con la clave publicable, como anon. Con sesión lleva el token de Clerk como cualquier otra; si no se puede obtener por falta de conexión, el error es `offline`.

## Variables de entorno de la app

La app web lee cuatro variables de entorno. Vite solo expone al navegador las que empiezan por `VITE_`, y su valor queda escrito en el JavaScript del build, así que aquí nunca va un secreto.

| Variable                        | Qué es                                                                                                                 | Dónde se obtiene                                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`             | URL del proyecto de Supabase, con `https`.                                                                             | En el panel de Supabase, botón Connect o Project Settings > Data API (Project URL).                |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Clave publicable del proyecto. Empieza por `sb_publishable_`.                                                          | En Project Settings > API Keys. No uses nunca una clave secreta (`sb_secret_`); la app la rechaza. |
| `VITE_APP_ENV`                  | Ambiente al que apunta la app: `dev` o `prod`.                                                                         | Lo decide quien configura el ambiente. Coincide con los nombres de los environments de GitHub.     |
| `VITE_CLERK_PUBLISHABLE_KEY`    | Clave publicable de la instancia de Clerk del ambiente. Empieza por `pk_test_` (desarrollo) o `pk_live_` (producción). | En el panel de Clerk, página API keys. No uses nunca la clave secreta (`sk_`); la app la rechaza.  |

La URL y las claves publicables no son secretas, pero tampoco se versionan, porque cambian de un ambiente a otro. La clave secreta de Clerk no la usa la app y no debe aparecer en el repositorio, en un issue ni en un chat.

### Preparar el `.env` local

En tu máquina la app apunta siempre al proyecto de Supabase de desarrollo. Copia la plantilla y completa los valores:

```sh
cp apps/web/.env.example apps/web/.env.local
```

`apps/web/.env.local` está ignorado por git. Pon en él la URL y la clave publicable del proyecto de Supabase de desarrollo, la clave publicable de la instancia de desarrollo de Clerk (`pk_test_`) y deja `VITE_APP_ENV=dev`. Si cambias el archivo con el servidor en marcha, reinicia `npm run dev`.

No lo confundas con `supabase/.env`: ese archivo es para la CLI de Supabase y contiene credenciales secretas (ver [Credenciales](#credenciales)); `apps/web/.env.local` es para la app y no lleva ningún secreto.

### Validación al arrancar

Al arrancar, la app comprueba que la URL es una URL `https` válida, que la clave de Supabase no está vacía (y no es una clave secreta), que el ambiente es `dev` o `prod` y que la clave de Clerk empieza por `pk_test_` o `pk_live_` y corresponde al ambiente: `pk_test_` solo con `dev` y `pk_live_` solo con `prod`. Si se pega la clave secreta de Clerk (`sk_`), el error lo dice expresamente. Si algo falla, en lugar de la app aparece una pantalla de error que nombra cada variable con problemas y el motivo, sin mostrar nunca sus valores; la consola del navegador muestra también los nombres.

Fuera de producción, la app muestra en la esquina inferior izquierda una etiqueta pequeña con el ambiente ("Desarrollo"), para comprobar a simple vista a qué ambiente apunta una vista previa o el servidor local. Con `VITE_APP_ENV=prod` no aparece.

El cliente de Supabase se crea una sola vez, en `apps/web/src/lib/supabase.ts`, a partir de la configuración validada, y se carga de forma diferida (ver [Identidad: de Clerk a Postgres](#identidad-de-clerk-a-postgres)). No usa Supabase Auth: la sesión es de Clerk y el cliente envía su token de sesión en cada petición.

Las pruebas no leen estas variables (la validación se prueba con objetos de entorno de ejemplo), así que `npm test` y `npm run build` funcionan sin ningún `.env`, también en la integración continua.

## Autenticación

La autenticación es de [Clerk](https://clerk.com/docs), con su SDK de React vigente, `@clerk/react` (Core 3). Los métodos de acceso (correo con código de verificación y Google) se activan en el panel de Clerk, no en el código; la app usa los componentes de Clerk en lugar de formularios propios.

### Cómo está montada

- `src/auth/AuthProvider.tsx` envuelve la app con [`<ClerkProvider>`](https://clerk.com/docs/react/reference/components/clerk-provider) y le pasa la clave validada, los textos en español ([`@clerk/localizations`](https://clerk.com/docs/guides/customizing-clerk/localization), variante `es-MX`, la de vocabulario latinoamericano), la apariencia del design system, las rutas de las pantallas de acceso, `afterSignOutUrl="/"` y `routerPush`/`routerReplace` con el `navigate` de React Router, para que Clerk navegue sin recargar la página ([React Router en modo declarativo](https://clerk.com/docs/react/guides/development/declarative-mode)). Un destino de otro origen se abre con una carga normal. La página de muestra queda fuera del proveedor.
- Pantallas: `src/pages/SignInPage.tsx` (`/iniciar-sesion`) y `src/pages/SignUpPage.tsx` (`/registro`) montan [`<SignIn />`](https://clerk.com/docs/react/reference/components/authentication/sign-in) y [`<SignUp />`](https://clerk.com/docs/react/reference/components/authentication/sign-up) dentro de un envoltorio propio (`AuthPageLayout`), con `routing="path"` y su `path`: Clerk lleva sus pasos internos como subrutas (`/iniciar-sesion/factor-one`, `/iniciar-sesion/sso-callback`), por eso esas rutas aceptan `/*`.
- Cuenta: en la cabecera de la app, `src/auth/AccountControls.tsx` muestra, con sesión, el [`<UserButton />`](https://clerk.com/docs/react/reference/components/user/user-button) de Clerk (avatar con el menú para administrar la cuenta) y un botón "Cerrar sesión" ([`<SignOutButton>`](https://clerk.com/docs/react/reference/components/unstyled/sign-out-button) con el `Button` del sistema); sin sesión, enlaces a "Iniciar sesión" y "Crear cuenta". La sesión se distingue con [`<Show when="signed-in">`](https://clerk.com/docs/react/reference/components/control/show), que en Core 3 sustituye a `<SignedIn>` y `<SignedOut>`.
- Apariencia: `src/auth/appearance.ts` define el prop [`appearance`](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/overview) con [`variables`](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/variables) y `elements`, y cada valor es una variable de `tokens.css` (`var(--color-primary)`, `var(--font-body)`, `var(--radius-md)`...). `appearance.test.ts` falla si aparece un valor suelto o una variable que no existe en `tokens.css`. Clerk calcula sus tonos con `color-mix()` y color relativo, que con variables CSS piden Safari 16.4+ (el mismo mínimo que ya exige Tailwind 4).
- Pruebas: ninguna carga Clerk ni necesita clave. `src/test/clerk-mock.tsx` sustituye a `@clerk/react` (`vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))`) y permite fijar el estado: cargando, listo, fallo de carga, con o sin sesión y con o sin el claim `app_role`. Las rutas se prueban con `MemoryRouter` en `src/routes/AppRouter.test.tsx`. Las pantallas propias pasan axe con el helper `src/test/axe.ts`.

### Rutas

El enrutador es [React Router](https://reactrouter.com/) 8 en modo declarativo (`<BrowserRouter>`, `<Routes>`, `<Route>`), sin el modo framework. Todas las rutas están en `src/routes/paths.ts` (`PATHS`); el mapa está en `src/App.tsx`, y la muestra, en `src/routes/AppRouter.tsx`. Van en español y sin acentos. "Registro" a secas es el de la cuenta; el de una planta cuelga de la colección.

| Ruta                       | Pantalla                                  | Acceso                     |
| -------------------------- | ----------------------------------------- | -------------------------- |
| `/`                        | Inicio                                    | Pública                    |
| `/catalogo`                | Catálogo (provisional)                    | Pública                    |
| `/coleccion`               | Mi colección (provisional)                | Con sesión                 |
| `/coleccion/nueva`         | Registrar una planta (provisional)        | Con sesión                 |
| `/administracion/catalogo` | Administración del catálogo (provisional) | Con sesión y rol de admin. |
| `/iniciar-sesion/*`        | Inicio de sesión (Clerk)                  | Pública                    |
| `/registro/*`              | Crear cuenta (Clerk)                      | Pública                    |
| `/muestra`                 | Muestra del design system                 | Solo fuera de producción   |
| `/diagnostico`             | Diagnóstico de identidad                  | Solo fuera de producción   |
| Cualquier otra             | Página no encontrada                      | Pública                    |

- Navegación: `src/components/AppShell.tsx` pinta la cabecera, un enlace "Saltar al contenido" y la navegación principal (`<nav aria-label="Principal">`) con enlaces con aspecto de chip del sistema. `NavLink` marca la página actual con `aria-current="page"` y el estilo seleccionado sale de ese atributo. El enlace "Administración" solo aparece con el rol de administrador.
- Cada página pone el título de la pestaña ("Catálogo · Orki") y, al llegar navegando dentro de la app (no al cargarla), el foco va a su título (`h1` con `tabIndex={-1}`) para que el lector de pantalla anuncie la página nueva; en las pantallas de acceso, al contenido principal. Ver `src/routes/navigation.ts`.
- Recargar cualquier ruta funciona: en Vercel, la reescritura de `vercel.json` responde con `index.html` todo lo que no es `assets/` ni `workbox-`; con la app instalada, el `navigateFallback` del service worker hace lo mismo con cualquier navegación.
- Carga: `src/routes/AppRouter.tsx` carga `App.tsx` (Clerk, su localización y las páginas) de forma diferida, en un chunk aparte del inicial. El service worker precachea todos los chunks, así que sin conexión también carga.

### Rutas protegidas y vuelta tras iniciar sesión

`src/auth/RouteGuards.tsx` tiene dos rutas de diseño (layout routes):

- `RequireAuth`: sin sesión, redirige a `/iniciar-sesion?redirect_url=<página pedida>` (ruta, búsqueda y hash). Mientras Clerk carga, "Cargando el acceso…"; si Clerk no está disponible (sin conexión o fallo, ver [Sin conexión](#sin-conexión)), la alerta con "Volver a intentar", sin redirigir.
- `RequireCatalogAdmin`, dentro de la anterior: sin el rol, la pantalla "No tienes acceso" en la misma dirección (no un "no encontrado" ni una redirección).

Las pantallas de acceso leen `redirect_url` (`src/auth/useAuthRedirectDestination.ts`), lo validan con `safeRedirectPath` y lo pasan a Clerk como `forceRedirectUrl` (y `signUpForceRedirectUrl` o `signInForceRedirectUrl` para el enlace entre ambas). Según la [documentación de Clerk](https://clerk.com/docs/guides/development/customize-redirect-urls), el destino forzado tiene prioridad sobre `redirect_url`, así que manda la ruta ya validada. Solo vale una ruta interna: que empiece por una sola barra, o una URL absoluta del mismo origen; nunca `//otro.sitio`, `/\otro.sitio`, otro origen, `javascript:` ni las propias pantallas de acceso. Un destino no válido lleva al inicio. Clerk, por su parte, también descarta destinos fuera de `allowedRedirectOrigins` (por defecto, el origen de la app y el dominio de la instancia).

### Rol de administrador del catálogo

- El rol viaja en el claim **`app_role`** del token de sesión de Clerk, no en `role` (lo reserva Supabase y debe valer `authenticated`).
- El valor de administrador es **`catalog_admin`** (`CATALOG_ADMIN_ROLE` en `src/auth/roles.ts`). Es el mismo que se pone en Clerk (#55) y el que comprueban las políticas RLS (#6); si cambia, cambia en los tres sitios.
- Configuración en el panel de Clerk (#55): en el usuario, metadatos públicos `{ "role": "catalog_admin" }`; en Sessions > Customize session token, el claim `{ "app_role": "{{user.public_metadata.role}}" }`. Los metadatos públicos solo se cambian desde el panel o el backend, no desde el navegador.
- La app lo lee de `sessionClaims` de [`useAuth()`](https://clerk.com/docs/react/reference/hooks/use-auth), sin peticiones extra (`useIsCatalogAdmin`). Un cambio de rol llega con el siguiente token de sesión, no al instante.
- Ocultar el enlace y la pantalla es **solo comodidad de la interfaz**: el token está en el navegador y la interfaz se puede manipular. La protección real son las políticas RLS de la base de datos (#6), que leen el mismo claim del token que verifica Supabase con `public.is_catalog_admin()`: con el rol, `authenticated` puede insertar, editar y borrar en las cuatro tablas del catálogo; sin él, solo leerlas. Las funciones que necesitan saltarse RLS siguen el patrón de [Funciones de administrador](supabase/README.md#funciones-de-administrador).

#### Asignar y retirar el rol

Se hace a mano en el [panel de Clerk](https://dashboard.clerk.com), en la instancia del ambiente que corresponda (desarrollo o producción tienen usuarios distintos):

1. **Asignar:** Users > el usuario > Metadata > Public > Edit, y deja `{ "role": "catalog_admin" }` (conservando las demás claves que hubiera). Guarda.
2. **Retirar:** en el mismo sitio, borra la clave `role` (o el valor entero si era la única) y guarda.
3. Comprueba una sola vez por instancia que Sessions > Customize session token tiene el claim `{ "app_role": "{{user.public_metadata.role}}" }`. Sin él, el token no lleva el rol aunque el usuario lo tenga.

El valor tiene que ser exactamente `catalog_admin`, en minúsculas y sin espacios; cualquier otro (`admin`, `CATALOG_ADMIN`...) no da permisos. Los metadatos públicos solo se escriben con la clave secreta de Clerk (panel o backend), así que el usuario no puede ponérselo; el rol en otro sitio que el usuario sí controla (`unsafe_metadata`) no sirve, porque solo cuenta el claim de primer nivel `app_role`.

**Cuánto tarda:** el cambio se refleja sin cerrar sesión cuando Clerk renueva el token de sesión, que dura un minuto aproximadamente: en general en un minuto, y en desarrollo se comprobó que en menos de dos. Hasta entonces, el token anterior sigue valiendo, también para la base de datos. Cerrar sesión y volver a entrar lo aplica al momento. En `/diagnostico` (fuera de producción) se ve el valor de `app_role` que trae el token.

### Identidad: de Clerk a Postgres

Supabase no tiene usuarios propios: Clerk está registrado en cada proyecto de Supabase como proveedor de autenticación externo ([integración de terceros con Clerk](https://supabase.com/docs/guides/auth/third-party/clerk), #55) y Supabase valida el token de sesión de Clerk en cada petición. No se usa la plantilla JWT antigua de Clerk ni Supabase Auth.

1. **Clerk** emite el token de sesión: un JWT corto que Clerk renueva solo. Lleva `sub` (el id de usuario de Clerk, `user_...`), `role: authenticated` (lo añade la integración y Supabase lo usa para elegir el rol de Postgres) y `app_role` (el rol de la app, ver [Rol de administrador del catálogo](#rol-de-administrador-del-catálogo)).
2. **La app** se lo pasa al cliente de Supabase con la opción [`accessToken`](https://supabase.com/docs/reference/javascript/initializing) de supabase-js para tokens de terceros, como indica la [guía de Clerk para Supabase](https://clerk.com/docs/guides/development/integrations/databases/supabase). Antes de cada petición, el cliente pide el token y lo envía en `Authorization: Bearer`, junto con la clave publicable en `apikey`.
3. **Supabase** comprueba la firma con las claves públicas de la instancia de Clerk, y PostgREST ejecuta la consulta con el rol del claim `role` y deja las claims en la transacción.
4. **Postgres** lee el usuario con `public.requesting_user_id()`, que devuelve `auth.jwt()->>'sub'` (texto) o `null` sin sesión. Es la función que usan las políticas RLS de perfiles y plantas (#64): `user_id = (select public.requesting_user_id())`.

Cómo llega el token al cliente (`src/lib/supabase.ts` y `src/auth/SupabaseSessionBridge.tsx`): el cliente vive en el chunk inicial y Clerk en el chunk diferido de la app, así que el cliente no importa Clerk. Pide el token a una _fuente_ registrable: `SupabaseSessionBridge`, montado dentro de `<ClerkProvider>` (en `AuthProvider`), registra una con `setSessionTokenSource()` mientras Clerk tiene sesión y la quita al cerrarla o al desmontarse. La fuente llama a `getToken()` de [`useAuth()`](https://clerk.com/docs/react/reference/hooks/use-auth). Sigue habiendo un único cliente, creado en un único módulo.

Qué pasa en cada caso:

| Situación                                                 | Qué hace el cliente                                                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Con sesión                                                | Envía el token de Clerk. Postgres ve el usuario.                                                                                            |
| Sin sesión, Clerk cargando o sin cargar, o fuera de Clerk | Sin fuente registrada: envía solo la clave publicable y la petición va como `anon`. El catálogo se lee igual.                               |
| Tras cerrar sesión                                        | La fuente desaparece al cambiar `useAuth()`: la petición siguiente ya no lleva el token.                                                    |
| Con sesión y sin conexión                                 | `getToken()` lanza `ClerkOfflineError` (Core 3). La petición no se envía y devuelve un error con motivo `offline`.                          |
| Sesión caducada o cerrada en otra pestaña                 | `getToken()` devuelve `null` mientras la app aún cree tener sesión. La petición no se envía y devuelve un error con motivo `session-ended`. |
| Cualquier otro fallo de `getToken()`                      | La petición no se envía y devuelve un error con motivo `failed`.                                                                            |

La regla: **con sesión, una petición nunca sale como anónima ni falla en silencio.** Si no hay token, no se envía. El error es un `SessionTokenError` con su motivo (`reason`); como supabase-js convierte los fallos previos al envío en un `{ error }` con el texto del error, `sessionTokenFailure(error)` reconoce los dos y devuelve el motivo, y `SESSION_TOKEN_ERROR_TEXT` tiene el texto para la pantalla. Cuando Clerk propaga el cierre de sesión, las peticiones siguientes vuelven a ir como `anon` y el catálogo se lee de nuevo. Mientras Clerk carga, la app no sabe aún si hay sesión y las peticiones van como `anon`: las rutas que exigen sesión no se pintan hasta que Clerk está listo (`RequireAuth`), y para que una petición a datos privados hecha como `anon` falle de forma visible en lugar de devolver una lista vacía, `anon` no debe tener privilegios sobre perfiles ni plantas (hoy no los tiene; #6 debe mantenerlo).

Detalle de supabase-js: las lecturas (`GET`) que fallan antes de enviarse se reintentan hasta tres veces (1, 2 y 4 s), pidiendo el token de nuevo en cada intento; las escrituras y las llamadas a funciones (`rpc`, `POST`) fallan enseguida.

Carga diferida: supabase-js (unos 230 kB) no va en el chunk inicial. `main.tsx` solo guarda la configuración con `initSupabase()`, y `getSupabase()` (asíncrona) carga supabase-js y crea el cliente la primera vez que se pide. El service worker precachea ese chunk como los demás, así que sin conexión también carga.

#### Perfil en el primer ingreso

La fila del usuario en `profiles` la crea la app sola la primera vez que ve una sesión iniciada; no hace falta ningún paso en Clerk ni en Supabase. `src/auth/ProfileBootstrap.tsx`, montado justo después de `SupabaseSessionBridge`, llama a `ensureProfile()` (`src/lib/profile.ts`), que hace un `upsert` con `ignoreDuplicates` sobre `id` (en Postgres, `insert ... on conflict (id) do nothing`): si el perfil ya existe no da error ni lo modifica (el idioma elegido se conserva). Se hace una vez por usuario y carga de la página, en segundo plano y sin bloquear la interfaz. Si falla (sin conexión, error de red o del servidor) no se muestra nada; se reintenta al recuperar la conexión, en el siguiente ingreso o al recargar.

#### Panel de diagnóstico

Fuera de producción, `/diagnostico` (<http://localhost:5173/diagnostico> con `npm run dev`, o `/diagnostico` en una vista previa) muestra el id de usuario según Clerk y según Postgres (llamando a `requesting_user_id()` con el cliente de la app), si coinciden, el valor del claim `app_role` y el error si la llamada falla. "Volver a consultar" repite la llamada. Sirve con y sin sesión: sin sesión, Postgres devuelve vacío y los dos coinciden "sin sesión". Nunca muestra el token ni lo escribe en la consola.

- Con sesión y "Sí": el token llega a Postgres y Supabase lo valida. Es la comprobación de extremo a extremo del #60.
- Con sesión y Postgres vacío: Supabase no reconoce el token (revisa la integración con Clerk en el proyecto de Supabase, #55) o la petición salió sin él.
- Error `PGRST202`: la migración de la función no está aplicada en ese proyecto (`npm run db:push`).
- Sin `app_role` con el rol puesto en Clerk: falta el claim en la personalización del token de sesión, o el token aún no se ha renovado.

Como la muestra, solo existe con `VITE_APP_ENV` distinto de `prod`: `src/App.tsx` lo carga de forma diferida detrás de la comparación estática con `import.meta.env.VITE_APP_ENV` y en el build de producción no entra. Va dentro de `<ClerkProvider>` porque necesita el usuario de Clerk, pero no exige sesión.

### Sin conexión

La app instalada abre sin red: el service worker sirve `index.html`, el JavaScript y las fuentes desde su precache, la pantalla pública se pinta enseguida y el acceso no bloquea el arranque.

Qué hace Clerk sin red. **Verificado en la documentación de Clerk:**

- `<ClerkProvider>` no carga Clerk en el bundle: descarga en el navegador el script de ClerkJS (y el de su interfaz, `@clerk/ui`) desde el CDN, en el dominio de Frontend API de la instancia. Sin conexión, o si el CDN está bloqueado, Clerk no carga ([Script loading](https://clerk.com/docs/guides/development/troubleshooting/script-loading)). La interfaz se puede empaquetar con la app pasando `ui` al proveedor ([`ui`](https://clerk.com/docs/react/reference/components/clerk-provider#ui)).
- El objeto Clerk tiene un [`status`](https://clerk.com/docs/react/reference/objects/clerk#status): `loading` al iniciar, `ready`, `degraded` (parcialmente operativo) y `error` cuando falla la carga del script o `Clerk.load()`. `loaded` es `true` con `ready` o `degraded`. Los componentes de control [`<ClerkLoading>`, `<ClerkLoaded>`, `<ClerkDegraded>` y `<ClerkFailed>`](https://clerk.com/docs/react/reference/components/control/clerk-failed) siguen ese estado.
- Desde Core 3, `getToken()` lanza `ClerkOfflineError` sin conexión en lugar de devolver `null` ([guía de Core 3](https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3)). Qué hace entonces el cliente de Supabase está en [Identidad: de Clerk a Postgres](#identidad-de-clerk-a-postgres).
- El modo sin conexión documentado de Clerk es solo para Expo (`__experimental_resourceCache`, con caché de recursos y de tokens; [Offline support](https://clerk.com/docs/guides/development/offline-support)). Para web, `<ClerkProvider>` acepta un prop [`experimental`](https://clerk.com/docs/react/reference/components/clerk-provider#experimental) con las opciones `persistClient` y `rethrowOfflineNetworkErrors`, pero la documentación no explica qué hacen ni las garantiza.

**Comprobado en el código de `@clerk/react` 6.19 y `@clerk/shared` 4.48 (no está en la documentación):** el script de ClerkJS se pide a `https://<frontend-api>/npm/@clerk/clerk-js@6/dist/clerk.browser.js` y Clerk espera hasta 15 s a que aparezca antes de pasar a `error`, aunque la petición falle antes; mientras tanto `status` sigue en `loading`. `<ClerkProvider>` pinta sus hijos desde el principio, sin esperar.

**Supuesto, sin verificar con una instancia real:** que una sesión iniciada no sirve sin red en web. Sin el script no hay objeto Clerk, así que la app no puede saber quién es el usuario aunque el navegador conserve las cookies de sesión; y aunque el script estuviera en la caché HTTP del navegador, `Clerk.load()` necesita consultar la API de Clerk.

Cómo arranca la app, en consecuencia (`src/auth/useAuthAvailability.ts`):

- Mientras Clerk carga, las pantallas de acceso y las rutas que exigen sesión muestran "Cargando el acceso…" (`role="status"`) y la cabecera de la app, el mismo texto en lugar de los controles de cuenta.
- Si el navegador dice que no hay red (`navigator.onLine === false`), no se espera: se muestra enseguida "Sin conexión".
- Si Clerk falla (`status: error`) o tarda más de 10 s (`AUTH_LOAD_TIMEOUT_MS`), se da el acceso por no disponible. Las pantallas de acceso y las rutas que exigen sesión muestran una alerta (`role="alert"`) con "Volver a intentar", que recarga la página, en lugar de redirigir; las páginas públicas muestran un aviso breve en la cabecera (`role="status"`) y se siguen viendo enteras.
- Si Clerk termina cargando más tarde, todo pasa al estado normal sin recargar.

Qué haría falta para el modo de solo lectura del issue #18 (colección visible sin conexión con la sesión iniciada):

- Que la app sepa sin red quién era el usuario: guardar en el dispositivo, al tener sesión, el id de usuario de Clerk y los datos necesarios, y borrarlos al cerrar sesión. No hay una opción documentada de Clerk para web que lo haga; `experimental.persistClient` habría que probarlo con una instancia real y aceptar que puede cambiar en cualquier versión.
- Guardar en el dispositivo una copia de la colección (por ejemplo en IndexedDB) al consultarla con conexión, porque sin red no hay token de Clerk para Supabase (`getToken()` lanza `ClerkOfflineError`) ni Supabase al que preguntar.
- Opcionalmente, empaquetar la interfaz de Clerk (`ui`) para que el precache la incluya; no basta por sí solo, porque `Clerk.load()` sigue necesitando la red.

### Service worker y autenticación

El service worker (configuración en `apps/web/vite.config.ts`) no tiene `runtimeCaching`: solo responde a los archivos del precache y a las navegaciones dentro de la app. Las peticiones a Clerk (script y API, en su dominio de Frontend API) y a Google son de otro origen y van siempre a la red, sin guardarse. Las redirecciones de inicio de sesión ocurren en esos dominios; a la vuelta llegan a rutas de la app (subrutas de `/iniciar-sesion` o `/registro`, o la página pedida), que reciben `index.html` para que Clerk termine en el navegador. Clerk no tiene rutas propias en el dominio de la app, así que no hace falta `navigateFallbackDenylist`; haría falta si algún día se usara el proxy de Clerk (`proxyUrl`).

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

Lo habitual es pasar las pruebas de base de datos (`npm run db:test`, ver la sección siguiente) y después aplicar y probar la migración en desarrollo antes de abrir el pull request.

### Datos de ejemplo en desarrollo

```sh
npm run db:seed:dev
```

Carga en el proyecto de desarrollo unas pocas especies e híbridos reales del catálogo, con sinónimos y nombres comunes, para probar el registro y el autocompletado sin esperar al catálogo real, que llega con la importación del issue #8. El SQL está en `supabase/datos-ejemplo/catalogo.sql`: 40 especies e híbridos de los cinco géneros de acceso rápido y de tres géneros más (Guarianthe, Paphiopedilum y Brassia, con sus abreviaturas de la RHS), 10 sinónimos (varios de un género distinto del aceptado, como _Cattleya skinneri_ para _Guarianthe skinneri_) y 12 nombres comunes, con tildes y eñes.

**Es solo para desarrollo.** No es una migración ni el `seed.sql` de la CLI, así que `db:push` y el workflow de producción no lo aplican nunca. Además, el comando se niega a ejecutarse si `SUPABASE_PROJECT_REF` no es el proyecto de desarrollo (`xaitolsnmjlpyptntfwi`), y lo dice expresamente si es el de producción. Usa las mismas credenciales que `db:push` (ver [Credenciales](#credenciales)): enlaza el proyecto, ejecuta el archivo con `supabase db query --remote --yes` y muestra un resumen de lo que hay en el catálogo.

Se puede repetir: todas las inserciones usan `on conflict ... do nothing` sobre las claves únicas del esquema, así que volver a cargarlo no duplica nada ni cambia lo que ya existe (tampoco las especies editadas a mano; si cambias en el archivo el género o el tipo de una especie ya cargada, ese cambio no se aplica). Todo va en un único bloque `do`, de modo que o se carga entero o no se carga nada. No toca `plants` ni `profiles`. Las pruebas de base de datos (`supabase/tests/datos_ejemplo.sql`) lo cargan sobre la base desechable y comprueban los recuentos, que una segunda carga no cambia nada y que no toca el inventario.

### Pruebas de la base de datos

```sh
npm run db:test
npm run db:test -- sincronizacion acceso   # solo los archivos cuyo nombre contiene alguna palabra
```

Las pruebas comprueban el esquema sin tocar los proyectos de Supabase. El comando crea una base de datos Postgres vacía y desechable, le añade lo mínimo de Supabase que necesitan las migraciones, aplica todas las migraciones de `supabase/migrations` en orden, ejecuta las pruebas de `supabase/tests` y, al terminar, borra la base. Cada prueba corre en una transacción que se revierte, así que no deja datos (y el comando lo comprueba al final). La salida dice qué prueba falló, en qué línea y por qué; el comando termina con código distinto de cero si falla alguna prueba o alguna migración.

Necesita el cliente `psql` de PostgreSQL 14 o posterior (en macOS, `brew install postgresql@17`). No necesita Docker, ni credenciales, ni `npm ci`. Puede usar dos tipos de servidor:

- **Clúster temporal (por defecto).** Si no se define `ORKI_TEST_DB_URL`, crea un servidor Postgres con `initdb` y `pg_ctl` en un directorio temporal, que escucha solo en `127.0.0.1` en un puerto libre y con una contraseña aleatoria, y lo destruye al terminar, también si falla una prueba o se interrumpe con Ctrl+C. Usa los binarios del directorio que indique `ORKI_PG_BINDIR`, si se define, o los de `pg_config --bindir` o el `PATH`. Con Homebrew vienen en el paquete `postgresql@17` (o el de la versión que tengas).
- **Un servidor que ya tengas.** Indica su URL en `ORKI_TEST_DB_URL` con un usuario superusuario:

  ```sh
  ORKI_TEST_DB_URL=postgresql://usuario:clave@localhost:5432/postgres npm run db:test
  ```

  La base de la URL solo se usa para conectarse: el comando trabaja en una base nueva que crea y borra él mismo (`orki_pruebas_...`) y no toca las demás. Crea los roles `anon`, `authenticated`, `service_role` y `postgres` si no existen (son del servidor, no de una base) y los borra al terminar si los creó él. Si el servidor ya tiene un rol `postgres` superusuario, avisa: las migraciones se aplicarán con más permisos que en Supabase.

Por seguridad, el comando se niega a ejecutarse si la URL apunta a Supabase (`*.supabase.co`, `*.supabase.com`, incluido el pooler, o `*.supabase.net`), sin excepciones, y solo acepta hosts locales (`localhost`, `127.x.x.x` y `::1`). Para usar un servidor desechable en otra máquina o contenedor, nombra su host en `ORKI_TEST_DB_ALLOW_HOST` (por ejemplo `ORKI_TEST_DB_ALLOW_HOST=postgres-pruebas`). La URL no admite más parámetros que `sslmode`, para que nada cambie el servidor al que se conecta, y la contraseña nunca se imprime.

En el CI, el job **Pruebas de base de datos** de `.github/workflows/ci.yml` corre en cada pull request y en cada push a `main` con un servicio de Postgres 17 (imagen oficial `postgres:17`, la misma versión mayor que los proyectos de Supabase) y `ORKI_TEST_DB_URL` apuntando a él.

Qué simula de Supabase (en `scripts/db-desechable/supabase-minimo.sql`): los roles `anon`, `authenticated` y `service_role` (este último ignora RLS), el rol `postgres` sin superusuario como dueño de lo que crean las migraciones (que se aplican con él, cada una en su transacción, como la CLI de Supabase), los esquemas `extensions` y `auth`, `auth.jwt()` leyendo las claims de `request.jwt.claims` y los privilegios por defecto que Supabase concede sobre las tablas nuevas de `public` (el peor caso, para comprobar que las migraciones los retiran). Las pruebas de acceso reproducen una petición de la API con `set local role` y `set local request.jwt.claims`.

Qué no cubren:

- La API de Supabase (PostgREST): ni el paso del token a `request.jwt.claims` ni qué expone la API. Se simula en SQL.
- El token real de Clerk ni su validación en Supabase: las pruebas inventan las claims (`sub`).
- El resto de Supabase: Supabase Auth, almacenamiento, otros esquemas y extensiones del proyecto, y la configuración de cada proyecto (por ejemplo, si un proyecto antiguo concede privilegios por defecto distintos).
- Concurrencia entre transacciones: cada prueba corre en una sola sesión.
- Diferencias de versión: en local se puede usar cualquier PostgreSQL desde la 14 y en el CI se usa la 17, como Supabase. Algo que solo falle en una versión puede pasar en local y fallar en el CI, o al revés; el CI es la referencia.
- La configuración regional: en el clúster temporal se usa `en_US.UTF-8` si existe (si no, `C.UTF-8` o `C`); con `C`, `lower()` no pasa a minúsculas las letras con tilde.

Cómo se escriben las pruebas y cómo añadir una al crear una migración está en [supabase/README.md](supabase/README.md#pruebas-de-base-de-datos).

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

Una limitación: al generar desde una URL de base de datos, la CLI no añade la versión de PostgREST del proyecto (la clave interna `__InternalSupabase` que sí añade al generar desde un proyecto de Supabase), y `supabase-js` supone entonces PostgREST 12. Solo afecta al tipado de opciones propias de versiones posteriores de PostgREST.

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

Las cuatro variables de la app (ver [Variables de entorno de la app](#variables-de-entorno-de-la-app)) se definen en Settings > Environment Variables, con un valor distinto según el ambiente de Vercel:

| Ambiente de Vercel | `VITE_SUPABASE_URL`            | `VITE_SUPABASE_PUBLISHABLE_KEY`             | `VITE_APP_ENV` | `VITE_CLERK_PUBLISHABLE_KEY`                     |
| ------------------ | ------------------------------ | ------------------------------------------- | -------------- | ------------------------------------------------ |
| Production         | URL del proyecto de producción | Clave publicable del proyecto de producción | `prod`         | Clave de la instancia de producción (`pk_live_`) |
| Preview            | URL del proyecto de desarrollo | Clave publicable del proyecto de desarrollo | `dev`          | Clave de la instancia de desarrollo (`pk_test_`) |
| Development        | URL del proyecto de desarrollo | Clave publicable del proyecto de desarrollo | `dev`          | Clave de la instancia de desarrollo (`pk_test_`) |

Vite escribe estos valores en el JavaScript durante el build, así que un cambio de variable solo se aplica en el siguiente despliegue: después de cambiarla hay que volver a desplegar (Redeploy). Si falta alguna, el build termina bien, pero la app muestra la pantalla de error de configuración. El ambiente Development de Vercel solo se usa con la CLI de Vercel (`vercel env pull`, `vercel dev`), que este proyecto no necesita; se rellena igual para que los tres ambientes estén completos. Ninguna de estas variables es secreta: al crearlas se elige el tipo Config, no Secret, para que sus valores sigan siendo legibles en el panel.

## Flujo de ramas

El proyecto sigue GitHub Flow:

1. `main` siempre está en estado desplegable. No se hacen commits directos en `main`.
2. Cada cambio se trabaja en una rama creada desde `main` y asociada a un issue, por ejemplo `feat/1-monorepo-base`.
3. Al terminar se abre un pull request hacia `main`. La integración continua ejecuta lint, verificación de formato, typecheck, pruebas y build, y tiene que pasar antes de fusionar.
4. Tras la revisión, el pull request se fusiona en `main` y la rama se borra.

## Integración continua

El workflow `.github/workflows/ci.yml` se ejecuta en cada pull request y en cada push a `main`. Instala las dependencias con `npm ci` usando la versión de Node de `.nvmrc` y la caché de npm, y después ejecuta `lint`, `format:check`, `typecheck`, `test` y `build`, en ese orden. Si cualquiera de esos pasos falla, el job falla. Un segundo job, **Pruebas de base de datos**, ejecuta `npm run db:test` y `npm run db:types:check` sobre un Postgres 17 desechable (ver [Pruebas de la base de datos](#pruebas-de-la-base-de-datos) y [Tipos de TypeScript del esquema](#tipos-de-typescript-del-esquema)). Cuando se suben nuevos commits a un pull request, la ejecución anterior de ese mismo pull request se cancela.
