# orqui.app

Aplicación web para coleccionistas de orquídeas, que se llama «orqui.app» (en minúsculas, también al inicio de frase). Hasta el issue #173 se llamaba Orki, y ese nombre sigue en el repositorio, los paquetes, las clases CSS `orki-`, las claves de almacenamiento y las herramientas internas. Es una PWA pensada primero para el celular y con la interfaz en español. En la Fase 1 cada persona registra las orquídeas que tiene y, al ver una nueva en una tienda o un vivero, comprueba al instante si ya la tiene para no comprarla repetida.

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
npm run test:scripts
npm run build
```

El CI ejecuta además el lint, el formato y las pruebas del proyecto de Python de `scripts/catalog-import/` (con [uv](https://docs.astral.sh/uv/)), incluidas las de la carga del catálogo contra un Postgres 17 desechable; cómo instalarlo y ejecutarlos en local está en [su README](scripts/catalog-import/README.md).

## Scripts

Todos se ejecutan desde la raíz del repositorio.

| Script                       | Qué hace                                                                                                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                | Levanta el servidor de desarrollo de la app web (Vite). Acepta opciones de Vite después de `--`.                                                                                                |
| `npm run build`              | Comprueba los tipos y genera el build de producción de la app web en `apps/web/dist`, con el service worker.                                                                                    |
| `npm run preview`            | Sirve el build de `apps/web/dist` en local para probarlo. Requiere ejecutar antes `npm run build`.                                                                                              |
| `npm run typecheck`          | Comprueba los tipos de TypeScript de la app web sin generar archivos.                                                                                                                           |
| `npm run lint`               | Ejecuta ESLint en todo el repositorio. Falla con cualquier aviso.                                                                                                                               |
| `npm run format`             | Formatea todo el repositorio con Prettier.                                                                                                                                                      |
| `npm run format:check`       | Comprueba con Prettier que todo está formateado, sin modificar archivos.                                                                                                                        |
| `npm test`                   | Ejecuta las pruebas de la app web una vez (Vitest).                                                                                                                                             |
| `npm run test:watch`         | Ejecuta las pruebas de la app web en modo observación.                                                                                                                                          |
| `npm run db:new`             | Crea una migración vacía en `supabase/migrations`. Recibe el nombre después de `--`.                                                                                                            |
| `npm run db:status`          | Muestra qué migraciones están aplicadas y cuáles pendientes en el proyecto de desarrollo.                                                                                                       |
| `npm run db:push`            | Aplica las migraciones pendientes en el proyecto de desarrollo.                                                                                                                                 |
| `npm run db:seed:dev`        | Carga los datos de ejemplo del catálogo en el proyecto de desarrollo. Se niega a ejecutarse en producción.                                                                                      |
| `npm run db:seed:plants`     | Carga plantas de ejemplo para un usuario en el proyecto de desarrollo (`-- <id de usuario> [cantidad]`), o las borra con `--borrar`.                                                            |
| `npm run db:test`            | Ejecuta las pruebas de base de datos en un Postgres local y desechable. Acepta un filtro después de `--`.                                                                                       |
| `npm run db:perf`            | Mide la búsqueda con un catálogo sintético en un Postgres desechable. No corre en el CI (ver [Rendimiento de la búsqueda](supabase/README.md#rendimiento-de-la-búsqueda)).                      |
| `npm run db:types`           | Regenera los tipos de TypeScript del esquema (`apps/web/src/lib/database.types.ts`) desde las migraciones.                                                                                      |
| `npm run db:types:check`     | Comprueba, sin escribir nada, que los tipos versionados coinciden con las migraciones. Lo usa el CI.                                                                                            |
| `npm run test:scripts`       | Ejecuta las pruebas de los scripts de mantenimiento en Node (`scripts/**/*.test.mjs`, con `node:test`). Lo usa el CI.                                                                           |
| `npm run build:e2e`          | Construye la app de las pruebas de extremo a extremo en `apps/web/dist-medicion/e2e` (ver [Pruebas de extremo a extremo](#pruebas-de-extremo-a-extremo)).                                       |
| `npm run test:e2e`           | Construye esa app y ejecuta las pruebas de extremo a extremo con Playwright. Acepta opciones de Playwright después de `--`.                                                                     |
| `npm run test:e2e:sin-build` | Ejecuta las pruebas de extremo a extremo sin volver a construir. Lo usa el CI.                                                                                                                  |
| `npm run datos:sin-dueno`    | Detecta perfiles, plantas, eventos y fotos de usuarios que ya no existen en Clerk (`-- --ambiente desarrollo`); solo borra con `--borrar` (ver [su README](scripts/datos-sin-dueno/README.md)). |

La app web tiene además un script propio para regenerar los iconos de la PWA en `apps/web/public` a partir del logotipo (ver [Marca](#marca)):

```sh
npm run icons --workspace=apps/web
```

## Estructura del monorepo

```text
orki-app/
├── .github/workflows/
│   ├── ci.yml                 Integración continua
│   ├── fotos-de-referencia.yml  Carga manual de las fotos de referencia de iNaturalist
│   ├── importar-catalogo.yml  Importación manual del catálogo
│   └── migraciones.yml        Aplicación de migraciones en Supabase
├── apps/
│   └── web/                   App web (React, Vite, TypeScript, Tailwind CSS, PWA)
│       ├── public/            Iconos y archivos estáticos
│       ├── scripts/           Utilidades de la app (generación de iconos)
│       ├── src/               Código fuente y pruebas
│       │   ├── assets/        Marcador sin-foto.svg del design system
│       │   ├── auth/          Proveedor de Clerk, apariencia, estados, controles de cuenta, rol, rutas protegidas y token para Supabase
│       │   ├── collection/    Colección del usuario en memoria: lectura, almacén compartido, búsqueda, agrupación y contadores
│       │   ├── backoffice/    Backoffice del catálogo (/administracion/catalogo, chunk propio)
│       │   ├── components/    Componentes de la app (estructura con la navegación, página)
│       │   │   └── ui/        Componentes del design system
│       │   ├── config/        Lectura y validación de las variables de entorno
│       │   ├── diagnostics/   Panel de diagnóstico de la identidad (solo fuera de producción)
│       │   ├── lib/           Cliente de Supabase (con el token de Clerk) y tipos del esquema
│       │   ├── observability/ Sentry: cargador diferido, límite de errores, recorte de datos y ruido
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
│   ├── catalog-import/        Importación del catálogo de especies (Python; normalización y carga)
│   ├── db-desechable/         Base Postgres desechable con el esquema aplicado
│   ├── db-test.mjs            Pruebas de base de datos (db:test)
│   ├── db-types.mjs           Tipos de TypeScript del esquema (db:types, db:types:check)
│   └── supabase-db.mjs        Scripts de migraciones y datos de ejemplo (db:new, db:status, db:push, db:seed:dev, db:seed:plants)
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

## Marca

La app se llama «orqui.app», siempre en minúsculas (#173). El logotipo está en `apps/web/src/assets/marca/`: `orqui-apps-light.svg` (flor y nombre) y `orqui-apps-light-icon.svg` (solo la flor, sobre fondo rosa pálido), para fondo claro, y sus variantes `-dark` para fondo oscuro, que no se usan porque la app no tiene tema oscuro. Son los SVG entregados por el responsable, optimizados a mano sin cambiar el dibujo. Sus colores son tokens: `color-primary` (pétalos), `color-secondary` (pétalo central, no `color-success`), `color-neutral-0` (marca de verificación), `color-neutral-900` («orqui»), `color-neutral-700` («.apps») y `color-primary-soft` (fondo del símbolo).

En las pantallas se usa el componente `Logo` (`src/components/Logo.tsx`, variantes `full` y `symbol`): una imagen con el texto alternativo «orqui.app», en línea en el JavaScript para que se vea sin conexión. Su nombre accesible ya es el de la app, así que al lado no se repite el nombre en texto.

Los iconos de `apps/web/public` (`favicon.svg`, `favicon.ico` con 16, 32 y 48 px, `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png` y `apple-touch-icon-180x180.png`) salen del símbolo para fondo claro con `npm run icons --workspace=apps/web` (`apps/web/scripts/generate-icons.mjs`). El script rasteriza el SVG con el Chromium de Playwright (si falta: `npx playwright install chromium`) y guarda los PNG con paleta de colores para que pesen poco en el precaché. Todos tienen el fondo opaco hasta el borde; el script comprueba que en el enmascarable la flor queda dentro de la zona segura (círculo central de radio 0,4 del lado). El favicon recorta el margen del lienzo para que la flor se reconozca a 16 px. Tras cambiar el logotipo, se regeneran los iconos y se confirman junto con él.

Quien ya instaló la app puede seguir viendo el icono y el nombre anteriores en la pantalla de inicio del celular: Android los actualiza por su cuenta pasado un tiempo, y en iOS hay que quitar la app de la pantalla de inicio y volver a añadirla.

## Design system en la app

La fuente de verdad del diseño es el [design system de Orki](https://claude.ai/artifact/BCQrAtoNqdjgkxEBfLpoaK): sus tokens, sus reglas de color, tipografía, iconos y voz, y los estilos de sus componentes. La app los lleva a código sin cambiarles el nombre; si algo difiere, manda el design system y la app se ajusta.

### Tokens

Los tokens viven en `apps/web/src/styles/tokens.css`, que es la única fuente de sus valores dentro de la app. Cada token es una variable CSS con el mismo nombre que en el design system (`var(--color-primary)`, `var(--space-4)`, `var(--radius-md)`) y, a la vez, forma parte del tema de Tailwind. La prueba de contraste (`src/styles/contrast.test.ts`) y la página de muestra leen ese archivo, así que un cambio de valor se hace solo ahí.

### Hojas de estilos

`apps/web/src/index.css` importa Tailwind, las fuentes (`styles/fonts.css`, servidas desde la app para que funcionen sin conexión), los tokens y una sola hoja de estilos de componentes, `styles/bundle.css`, en la capa `components` de Tailwind.

`styles/bundle.css` es una copia literal de `components/bundle.css` del design system, con las clases `orki-`. No se reformatea, para poder compararla con el original. Un cambio de estilo de un componente se hace primero en el design system y después se vuelve a copiar aquí. Excepción: las piezas del #199 (portada nueva y páginas de texto) y las del #206, #213 y #207 («Mi colección», «¿Ya la tengo?», «Tu cuenta» y la barra de la app) se escribieron primero aquí y el responsable las publica después en el design system con este mismo archivo. Lo mismo las del catálogo público (#232: `orki-letters`, `orki-pager` y, hasta 720 px, las pestañas de la barra sin icono).

**El verde es la acción principal en toda la app (#206).** `orki-btn--primary` usa `color-secondary-strong` (y `color-secondary` al pasar por encima); `orki-btn--strong` queda como alias para la portada. La selección también es verde: chip seleccionado relleno (`orki-chip--selected` para lo que no es un botón de alternar), y el hover del chip, la sugerencia activa del buscador y las opciones del menú en `color-secondary-soft`. Clerk usa el mismo verde como primario. El rosa (`color-primary`) queda solo para la marca. Las ilustraciones en color están permitidas dentro de la app, una por pantalla en su cabecera (`src/assets/ilustraciones/`, generadas con IA como todas las imágenes del proyecto).

Cómo usar las piezas nuevas (componentes, props, marcado y ejemplos): [`docs/piezas-de-interfaz.md`](docs/piezas-de-interfaz.md).

### Utilidades de Tailwind

Los valores por defecto de Tailwind están vaciados: solo existen utilidades con valores del sistema. `bg-white`, `text-base`, `rounded`, `font-bold` o `p-5` no generan nada. Se usan los nombres de los tokens:

- Color: `bg-neutral-0`, `bg-neutral-50`, `text-neutral-900`, `text-neutral-700`, `text-secondary`, `border-secondary`, `bg-primary`, `bg-danger-soft`. Las páginas públicas (#190) añaden `color-secondary-strong` (verde bosque del botón principal, los títulos y los enlaces), `color-secondary-soft` (recuadro de los iconos de las ventajas) y `color-neutral-200` (líneas divisorias de 1 px, solo decorativa).
- Texto: `text-hero` y `text-lead` (título y frase de apoyo del Hero de las páginas públicas), `text-display`, `text-xl`, `text-lg`, `text-md`, `text-sm` y `text-xs` (cada uno con su interlineado y peso), `font-display`, `font-body`, `font-normal`, `font-semibold` y la utilidad `scientific-name` para los nombres científicos (font-display en cursiva).
- Espaciado: las utilidades llevan el nombre del token, `p-space-4`, `gap-space-2`, `mt-space-6`, `w-space-6`. No existe la escala numérica, así `space-5` (24 px) no se confunde con el paso 5 de Tailwind.
- Radios y sombra: `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-pill` y `shadow-card` (solo en tarjetas).

Los componentes usan las clases `orki-` de las hojas de estilos; Tailwind queda para componer las pantallas. Un `className` con utilidades de Tailwind (por ejemplo un margen) se aplica por encima de los estilos del componente sin reescribirlos.

### Componentes

Están en `apps/web/src/components/ui/`, cada uno con su prueba. No hay archivo de índice: se importa cada uno desde su archivo.

| Componente         | Para qué                                                                                                                                                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`           | Acciones. Variantes `primary` (una por pantalla, verde), `strong` (alias de `primary` en las páginas públicas), `secondary`, `danger` (confirmación final) y `danger-outline` (la que la abre); ancho completo con `block`.                                                            |
| `Chip`             | Filtros y opciones cortas; botón de alternar con `selected`.                                                                                                                                                                                                                           |
| `ChipGroup`        | Fila de chips con su nombre para el lector de pantalla.                                                                                                                                                                                                                                |
| `TextField`        | Campo de texto con etiqueta visible, ayuda y error.                                                                                                                                                                                                                                    |
| `StatusBadge`      | Validación del nombre: "Validada", "Nombre por validar" o "No identificable".                                                                                                                                                                                                          |
| `SpecimenCard`     | Tarjeta de un ejemplar; sin foto usa el marcador `sin-foto.svg`. `layout="row"` para listas, `nameStyle="plain"` para un nombre por validar y `renderName` para envolver el nombre (por ejemplo, en un enlace).                                                                        |
| `ScientificName`   | Nombre científico con cada tramo en cursiva o en redonda según la nomenclatura (ver abajo).                                                                                                                                                                                            |
| `OwnershipAnswer`  | Respuesta de "¿Ya la tengo?" con el texto del inventario, sobre `QueryAnswer`.                                                                                                                                                                                                         |
| `QueryAnswer`      | Resultado de una consulta (`orki-answer`) con tono `yes`, `similar`, `no` o `notice`, dato y acción.                                                                                                                                                                                   |
| `PageHeader`       | Cabecera de pantalla (`orki-pagehead`) con ilustración, contador y acciones, o centrada; se usa con la prop `header` de `Page`.                                                                                                                                                        |
| `SearchField`      | Campo de búsqueda con lupa y botón de borrar (`orki-search`).                                                                                                                                                                                                                          |
| `FiltersButton`    | Botón «Filtros» con el número de filtros activos (`orki-count`).                                                                                                                                                                                                                       |
| `SegmentedControl` | Control segmentado (`orki-segmented`), por ejemplo cuadrícula o lista.                                                                                                                                                                                                                 |
| `CollectionCard`   | Tarjeta de ejemplar con borde (`orki-card--outline`), con apodo, insignia opcional y ubicación; `layout="list"` para la fila.                                                                                                                                                          |
| `MenuButton`       | Botón con menú (`orki-menu`), con teclado según las ARIA APG.                                                                                                                                                                                                                          |
| `Avatar`           | Foto de la cuenta, iniciales o icono (`orki-avatar`, dos tamaños).                                                                                                                                                                                                                     |
| `ProfileSummary`   | Avatar, nombre y correo con una acción (`orki-profile`).                                                                                                                                                                                                                               |
| `Panel`            | Sección con borde y título (`orki-panel`), también de peligro.                                                                                                                                                                                                                         |
| `ActionRow`        | Fila de acción con icono, texto y chevron (`orki-action`), enlace o botón, deshabilitada con motivo; dentro de `ActionList`.                                                                                                                                                           |
| `Autocomplete`     | Buscador con autocompletado de lista, con carga, sin resultados, error y una acción final opcional.                                                                                                                                                                                    |
| `Modal`            | Base de todos los diálogos modales (#151): `role="dialog"` o `"alertdialog"` con `aria-modal`, resto de la página `inert`, foco inicial, foco atrapado, Escape y foco devuelto al cerrar. La usan `ConfirmDialog`, el `ModalDialog` del backoffice y el diálogo de eliminar la cuenta. |
| `ConfirmDialog`    | Confirmación modal con "Cancelar" y la acción (`danger` para lo que no se deshace), sobre `Modal`.                                                                                                                                                                                     |
| `Collapsible`      | Sección plegable.                                                                                                                                                                                                                                                                      |
| `PhotoGallery`     | Galería de fotos de un formulario (`orki-gallery`, #220): contador, miniaturas con «Principal» y quitar, estados por foto (preparando, subiendo, guardada, con error) y «Tomar foto» / «Elegir fotos».                                                                                 |
| `MatchBadge`       | Insignia «Coincidencia en el catálogo» (`orki-match`).                                                                                                                                                                                                                                 |
| `FormLayout`       | Formulario a dos columnas (`orki-form`), con `FormPair` (dos campos en una fila) y `FormActions` (pie de acciones, `orki-formactions`).                                                                                                                                                |
| `Feature`          | FeatureItem del sistema (#190, #199): ventaja con icono, título (`h2` por defecto) y una frase, dentro de `FeatureList` (`orki-features`); con `plain` (`orki-features--plain`), icono de trazo sin recuadro ni líneas. De a tres en fila; apiladas hasta 720 px, sin separadores.     |
| `Icon`             | Único punto de entrada de los iconos (subconjunto de Lucide del sistema); ningún otro archivo importa `lucide-react`.                                                                                                                                                                  |

Las páginas públicas usan además piezas del sistema fuera de `components/ui/`: la NavBar (`components/PublicHeader.tsx`, `orki-nav`), el Hero (`orki-hero` con la variante `--split` de la portada, `__panel`, `__title`, `__lead`, `__actions`, `__action--narrow` y `__photo`; `--bleed`, `--art` y `__art` siguen en el sistema sin uso), el pie (`components/SiteFooter.tsx`, `orki-footer`, también en `AppShell`), la barra de la app con sesión (`components/AppBar.tsx`, `orki-appbar`, #207), la página de texto (`components/TextPage.tsx`, `orki-textpage` con su índice `orki-toc`, para la privacidad y los créditos) y el enlace de texto (`orki-link`, `--nav`). Su media query corta en 720 px; para ajustar algo alrededor de esas piezas al mismo ancho, `src/index.css` define la variante `publico-estrecho:` (`max-width: 720px`), porque `max-[720px]:` de Tailwind sería «menos de 720 px».

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

Las dos funciones exigen sesión desde el #231: la petición lleva el token de Clerk como cualquier otra; si no se puede obtener por falta de conexión, el error es `offline`. Sin sesión (`anon`) la búsqueda es `search_public_species`, del catálogo público (ver [Catálogo público](supabase/README.md#catálogo-público)).

## Catálogo público

`/catalogo` (#232, parte de #187) es la consulta del catálogo para cualquiera, con o sin sesión: el buscador, los géneros, las especies de cada género y la ficha de cada especie. Con sesión se ve dentro de la barra de la app; sin ella, con la barra pública. Todo va en su propio chunk (`src/catalog/`, cargado de forma diferida desde `App.tsx`); nada en el chunk inicial ni en el de la app.

- **Direcciones** (`src/catalog/paths.ts`), todas compartibles y recargables:
  - `/catalogo`: buscador y géneros. `?q=` es lo buscado (se sustituye la entrada del historial al escribir) y `?letra=` la letra del índice de géneros (`a`…`z` u `otros`; sin ella o con una que no existe, la primera).
  - `/catalogo/genero/<id>`: las especies del género, de 50 en 50; `?pagina=` desde la 2. Una página mayor que la última muestra la última y corrige la dirección.
  - `/catalogo/especie/<id>`: la ficha.
- **Sin sesión y sin Clerk:** las cuatro funciones públicas de la base (ver [Catálogo público](supabase/README.md#catálogo-público)) se llaman con el cliente público (`getPublicSupabase()` en `src/lib/supabase.ts`), que no envía nunca el token: solo la clave publicable. Con sesión es el mismo cliente (las funciones no miran quién llama), así el catálogo no espera a Clerk ni falla si el token no se puede obtener. La capa de datos es `src/lib/publicCatalog.ts`.
- **Buscador:** `search_public_species`, desde 2 caracteres, con 250 ms de espera entre pulsaciones y la tolerancia del registro (tildes, «×», abreviaturas, errores de tipeo). Hasta 15 resultados (el tope de la base); cada uno con su género y, si coincidió por un sinónimo o un nombre común, cuál. El campo tiene su propio estado, como en «Mi colección», para no perder letras.
- **Géneros:** se cargan todos al abrir `/catalogo` (unos 755, en 4 peticiones de 200 a la vez, unos 40 kB) y se muestran por letra con un índice alfabético; cada género con su número de especies. La letra no cuenta el signo «×» (los nothogéneros van con su letra), como el orden de la base.
- **Ficha:** nombre aceptado en cursiva, género (enlace a su página), tipo, sinónimos y nombres comunes con su idioma (hasta 100 de cada uno; si hay más, se dice cuántos en total) y la fuente: el Catalogue of Life con enlace al taxón cuando hay `source_ref`, la lista curada o la propuesta validada. Un id que no existe o no es público: «Especie no encontrada», con la vuelta al catálogo.
- **Con sesión**, en la ficha: «La tienes» (ejemplares activos enlazados a la especie, con «Ver en mi colección», que abre `/coleccion?q=<nombre>`) o «Aún no la tienes», de la colección ya cargada o de la copia local, sin otra consulta; y «Registrar esta especie», que abre `/coleccion/nueva?nombre=<nombre>` con la especie en el estado de la navegación: el formulario empieza con ella elegida, como si se hubiera escogido en el autocompletado (`prefilledSpecies` en `src/registration/prefill-name.ts`). Sin conexión o con la sesión sin confirmar, registrar queda desactivado con el motivo.
- **Estados:** cargando, sin resultados, error con «Reintentar» y sin conexión. El catálogo no se guarda en el dispositivo (ni en IndexedDB ni en el precaché del service worker, que solo tiene el código): sin conexión se dice así. Lo ya cargado en la visita (hasta 100 respuestas, en memoria) se sigue viendo, también sin conexión, y al volver la conexión lo que faltó se pide solo (`src/catalog/useCatalogData.ts`).
- **Atribución** del Catalogue of Life (versión, DOI y licencia, de `src/backoffice/attribution.ts`) al pie de cada pantalla, con el enlace a «Créditos y fuentes».
- **Fotos de referencia** (#234, ver [Fotos de referencia](#fotos-de-referencia)): la ficha muestra la de la especie, si tiene, arriba y con su crédito (de `reference_photo`); la búsqueda y las especies de un género, su miniatura en las filas que la tienen (de `reference_thumbnail`), con «Foto de referencia: autor, licencia» en la fila y un hueco del mismo tamaño en las demás para que los nombres sigan alineados. No añaden consultas: llegan en la misma respuesta.
- **Pruebas:** `src/lib/publicCatalog.test.ts` (peticiones, sin token, errores), `src/catalog/CatalogRoutes.test.tsx` (las pantallas con el doble `src/test/public-catalog.ts`, axe en cada estado) y `e2e/catalogo.spec.ts` (con el Supabase simulado, que responde las cuatro funciones y comprueba que llegan sin token).

## Backoffice del catálogo

`/administracion/catalogo` (#20) muestra el catálogo completo en una tabla (#99), permite dar de alta, editar, borrar y cambiar el estado de especies (#106) y editar sus sinónimos y nombres comunes, los géneros y sus abreviaturas (#107). Solo la ven los administradores del catálogo (`RequireCatalogAdmin`); la protección real está en la base: las funciones que usa exigen el rol y responden `42501` a cualquier otro (ver [Listado del catálogo para el backoffice](supabase/README.md#listado-del-catálogo-para-el-backoffice) y [Escritura del catálogo desde el backoffice](supabase/README.md#escritura-del-catálogo-desde-el-backoffice)). Va en su propio chunk (`src/backoffice/CatalogAdminPage.tsx`, cargado de forma diferida desde `App.tsx`), que solo descarga quien abre la ruta.

- **Resumen** arriba: géneros, especies, híbridos, sinónimos y nombres comunes, y especies (con los híbridos) por estado y por fuente.
- **Pestañas "Especies", "Géneros" y "Por validar"** (patrón de pestañas de WAI-ARIA: flechas, Inicio y Fin). "Por validar" lleva el número de grupos pendientes de la cola de propuestas.
- **Especies:** buscador (con la tolerancia del autocompletado: tildes, errores de tipeo, abreviaturas, signo "×"), filtros por estado, tipo y fuente (chips) y por género (el buscador de géneros del registro), y una tabla con el nombre científico (cursiva botánica), el género, el tipo, el estado, la fuente y el número de sinónimos y de nombres comunes. Con búsqueda, bajo el nombre se dice si coincidió por un sinónimo o un nombre común. Sin texto la tabla es el catálogo en orden alfabético, paginado por clave; con texto, por relevancia, paginado por número. Cada petición trae una sola página de 50 filas, con el total.
- **Detalle de una especie** en un panel junto a la tabla (debajo en pantallas estrechas): sinónimos, nombres comunes, referencia de la fuente con enlace a su ficha en el Catalogue of Life (en otra pestaña, `rel="noopener noreferrer"`), fechas de alta y de última modificación y cuántas plantas de usuarios la tienen enlazada (solo el número). El nombre de cada especie es un enlace al detalle: se puede abrir en otra pestaña o compartir. Al abrirlo, el foco va a su título; al cerrarlo, vuelve al nombre en la tabla.
- **Alta** ("Añadir especie o híbrido", sobre la tabla): un formulario en el sitio del detalle con el nombre científico (con un botón para insertar el signo «×»), el género (el buscador de géneros del registro; si el nombre está vacío, empieza por el género), el tipo y el estado (validada u observada: una alta manual no queda como importada). La base le pone la fuente «Lista curada» sin referencia. Al guardar se abre su detalle.
- **Edición** desde el detalle ("Editar"): nombre, género, tipo y estado en un solo envío. Si cambian el género o el tipo, el formulario dice a cuántas plantas de usuarios se propaga y, si hay alguna, pide confirmación con el número recién pedido a la base. Una especie importada a la que se cambian los datos pasa a «Validada» (lo hace la base, ver [Editada pasa a validada](supabase/README.md#editada-pasa-a-validada)), y el formulario lo avisa antes; en una entrada de la lista curada de híbridos avisa de que la carga de la lista la revertirá mientras siga validada.
- **Baja** desde el detalle ("Borrar"), con confirmación, solo si ninguna planta de usuarios la tiene enlazada; si las tiene, el detalle lo explica y remite a la fusión de especies (#21), que aún no existe.
- **Cambio de estado por lote:** cada fila de la tabla tiene una casilla («Seleccionar …») y la cabecera una para toda la página (con estado intermedio). Con alguna marcada aparece la barra «N especies seleccionadas», con el estado nuevo, "Cambiar el estado" (tras confirmar; se cambian todas o ninguna) y "Quitar la selección". La selección es de la página que se ve, como mucho 50 filas (la base admite 100): cambiar de página, de búsqueda o de filtros la vacía.
- **Errores** junto a su campo, enlazados con `aria-describedby`, con el foco en él: nombre vacío, nombre que ya existe sin distinguir mayúsculas, que solo se diferencia en las tildes o el signo «×» (dice cuál), género inexistente, referencia de fuente. Los demás (sin conexión, sesión, permiso, especie que ya no existe, plantas enlazadas) salen en el formulario o en el diálogo. Los espacios sobrantes se quitan al salir del campo y otra vez antes de enviar.
- **Confirmaciones** con un diálogo propio (`src/backoffice/ConfirmDialog.tsx`, `role="alertdialog"` con título y explicación asociados, sobre la base común `Modal`): el foco empieza en "Cancelar" si la acción borra y en la acción si no, Tab no sale del diálogo, el resto de la página queda `inert`, Escape lo cierra y el foco vuelve a donde estaba.
- **Tras cada cambio** el resumen, la tabla y el detalle se vuelven a leer sin recargar la página ni perder la búsqueda, los filtros o la página (`revision` de `useRemoteData`: se sigue viendo lo de antes hasta que llega lo nuevo), y el resultado se anuncia arriba en una región `role="status"` («Se dio de alta…», «2 especies pasaron a «Validada»…»).
- **Sinónimos y nombres comunes** en el detalle de la especie: cada lista con "Editar" y "Quitar" en cada nombre (con confirmación) y "Añadir sinónimo" / "Añadir nombre común". Al editar se puede pasar un nombre de una lista a otra. Los nombres comunes llevan un idioma opcional (etiqueta corta: `es`, `en`, `pt-BR`); los sinónimos no, porque son nombres científicos. Un nombre repetido en la especie (sin distinguir mayúsculas, o que solo cambia en tildes o «×») o igual a su nombre científico se explica junto al campo.
- **Géneros:** abreviaturas, si son de acceso rápido y número de especies (enlace a la pestaña de especies filtrada por ese género), con búsqueda por nombre o abreviatura y el filtro "Solo de acceso rápido". "Añadir género" (nombre y acceso rápido) y, en cada fila, "Editar", que abre un panel junto a la tabla con el nombre (un nothogénero lleva «× » delante; avisa si ya hay otro que solo cambia en el signo), la casilla "Acceso rápido en el registro" (cambiarla pide confirmación: cambia los chips del registro de todos los usuarios), sus abreviaturas (se guardan con su punto final; si otra igual ya es de un género, el error dice cuál) y "Borrar el género", solo si no tiene especies (si las tiene, se explica; si la base dice que hay plantas registradas con él, también).
- **Cola de propuestas** ("Por validar", #140, parte de #22): las plantas con nombre por validar agrupadas por nombre normalizado y género (ver [Cola de propuestas](supabase/README.md#cola-de-propuestas)), del grupo con más plantas al que tiene menos, 20 por página. Cada grupo muestra el nombre propuesto, el género, el tipo, cuántas plantas tiene y hasta seis fotos de sus plantas (#184: la principal de cada una primero, después las demás por turnos), que se amplían en un diálogo con «Anterior» y «Siguiente»; nunca quién las registró. Tres acciones, cada una en un diálogo con teclado: "Enlazar a una especie" (el buscador del catálogo, precargado con el nombre propuesto; avisa si el género de la especie es otro), "Crear la especie" (el formulario de alta ya relleno con el nombre, el género y el tipo; nace validada con fuente «Propuesta de usuario») y "No identificable" (con confirmación). Tras resolver, el grupo sale de la lista sin esperar a la lectura nueva, la lista y el número de la pestaña se vuelven a leer y el resultado se anuncia; si otro administrador ya lo había resuelto, se dice así. Las fotos se descargan con la sesión como en la app (`src/photos/read.ts`), pero sin guardarlas en Cache Storage (son de otros usuarios), y se muestran con una URL de objeto: la ruta, que lleva el id del usuario, no llega al DOM. Estados: cola vacía, cargando, error con "Reintentar" y sin conexión.
- **Todo va en la URL** (`src/backoffice/url-state.ts`): pestaña (`pestana`), texto (`q`), filtros (`estado`, `genero`, `tipo`, `fuente`), página (`pagina`, y sin texto `desde`, `antes` o `ultima` para la página por clave), detalle (`especie`) en géneros, `gq`, `rapido` y `gpagina`, y en la cola, `ppagina` (con `pestana=por-validar`). Recargar o compartir el enlace muestra lo mismo; un valor que no se reconoce se ignora. Cambiar el texto o un filtro vuelve a la primera página. Escribir sustituye la entrada del historial; cambiar de página, de filtro, de pestaña o abrir un detalle añade una.
- **Estados:** mientras carga, un esqueleto con el tamaño de la página anterior y "Cargando especies…" en una región `role="status"` que también anuncia el resultado ("32.464 especies. Página 1 de 650."); nunca se ven filas de una petición anterior (ni mientras se escribe). Catálogo vacío, sin resultados (con "Limpiar búsqueda y filtros"), página que ya no existe y error con "Reintentar", con un texto distinto sin conexión, con la sesión terminada o sin el rol en la base.
- **Atribución** del Catalogue of Life (versión, DOI y licencia CC BY 4.0, como pide `scripts/catalog-import/FUENTE.md`) al pie. Los datos salen de `scripts/catalog-import/fuente.json`, el archivo que fija la versión de la importación: Vite lo lee al compilar (`src/backoffice/attribution.ts`), así que al cambiar de versión no hay que tocar la app.
- **Capa de datos:** `src/lib/catalogAdmin.ts` (`listCatalogSpecies`, `searchCatalogSpecies`, `listCatalogGenera`, `getCatalogSummary`, `getSpeciesDetail`, `countSpeciesPlants`, `getGenus`), con `AbortSignal`, tipos sacados de `database.types.ts` y errores `CatalogAdminError` con motivo (`aborted`, `offline`, `session-ended`, `forbidden`, `failed`). `src/backoffice/useRemoteData.ts` hace cada lectura con cancelación y descarta las respuestas de otra clave.
- **Escrituras:** `src/lib/catalogWrites.ts` es la única puerta por la que la pantalla escribe el catálogo (`createCatalogSpecies`, `updateCatalogSpecies`, `setCatalogSpeciesStatus`, `deleteCatalogSpecies`, `addSpeciesName`, `updateSpeciesName`, `deleteSpeciesName`, `createCatalogGenus`, `updateCatalogGenus`, `deleteCatalogGenus`, `addGenusAbbreviation`, `updateGenusAbbreviation`, `deleteGenusAbbreviation`), cada una una llamada a una función de administrador de la base. Traduce los rechazos a `CatalogWriteError`: un problema (`duplicate-name`, `similar-name`, `species-has-plants`…), el campo del formulario al que corresponde y el mensaje en español, a partir del motivo que la base pone en `details` o, si no lo hay, del nombre de la restricción.
- **Sin base de datos:** la página de muestra (`/muestra`, sección "Backoffice del catálogo") pinta la misma vista (`CatalogAdminView`) con unas 150 especies en memoria (`src/showcase/catalog-admin-data.ts`) y los estados de carga, vacío, sin conexión y fallo. Su búsqueda es solo una aproximación (prefijo o contener el texto). Las escrituras cambian el catálogo en memoria con las mismas reglas que la base, hasta que se cambia de escenario.
- **Pruebas:** `src/lib/catalogAdmin.test.ts` y `src/lib/catalogWrites.test.ts` (peticiones y errores), `src/backoffice/CatalogAdminPage.test.tsx` (la lectura: la pantalla con `fetch` simulado, la URL, el teclado y axe en cada estado) `src/backoffice/CatalogAdminEditing.test.tsx` (alta, edición con su confirmación, baja, lote, errores junto al campo, foco y axe con cada formulario y diálogo) y `src/backoffice/CatalogAdminNamesGenera.test.tsx` (nombres, géneros y abreviaturas), `src/lib/proposalQueue.test.ts` (peticiones y errores de la cola) y `src/backoffice/ProposalsQueue.test.tsx` (la cola: las tres acciones con teclado, el grupo ya resuelto, los estados, que no hay rutas de fotos en el DOM y axe).

## Variables de entorno de la app

La app web lee cuatro variables de entorno obligatorias y una opcional, la de Sentry. Vite solo expone al navegador las que empiezan por `VITE_`, y su valor queda escrito en el JavaScript del build, así que aquí nunca va un secreto.

| Variable                        | Qué es                                                                                                                 | Dónde se obtiene                                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`             | URL del proyecto de Supabase, con `https`.                                                                             | En el panel de Supabase, botón Connect o Project Settings > Data API (Project URL).                |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Clave publicable del proyecto. Empieza por `sb_publishable_`.                                                          | En Project Settings > API Keys. No uses nunca una clave secreta (`sb_secret_`); la app la rechaza. |
| `VITE_APP_ENV`                  | Ambiente al que apunta la app: `dev` o `prod`.                                                                         | Lo decide quien configura el ambiente. Coincide con los nombres de los environments de GitHub.     |
| `VITE_CLERK_PUBLISHABLE_KEY`    | Clave publicable de la instancia de Clerk del ambiente. Empieza por `pk_test_` (desarrollo) o `pk_live_` (producción). | En el panel de Clerk, página API keys. No uses nunca la clave secreta (`sk_`); la app la rechaza.  |
| `VITE_SENTRY_DSN` (opcional)    | DSN del proyecto de Sentry. Sin él, Sentry queda apagado (ver [Errores en Sentry](#errores-en-sentry)).                | En Sentry, Settings > Projects > (el proyecto) > Client Keys (DSN). No es un secreto.              |

La URL y las claves publicables no son secretas, pero tampoco se versionan, porque cambian de un ambiente a otro. La clave secreta de Clerk no la usa la app y no debe aparecer en el repositorio, en un issue ni en un chat.

### Preparar el `.env` local

En tu máquina la app apunta siempre al proyecto de Supabase de desarrollo. Copia la plantilla y completa los valores:

```sh
cp apps/web/.env.example apps/web/.env.local
```

`apps/web/.env.local` está ignorado por git. Pon en él la URL y la clave publicable del proyecto de Supabase de desarrollo, la clave publicable de la instancia de desarrollo de Clerk (`pk_test_`) y deja `VITE_APP_ENV=dev`. Si cambias el archivo con el servidor en marcha, reinicia `npm run dev`.

No lo confundas con `supabase/.env`: ese archivo es para la CLI de Supabase y contiene credenciales secretas (ver [Credenciales](#credenciales)); `apps/web/.env.local` es para la app y no lleva ningún secreto.

### Validación al arrancar

Al arrancar, la app comprueba que la URL es una URL `https` válida, que la clave de Supabase no está vacía (y no es una clave secreta), que el ambiente es `dev` o `prod` y que la clave de Clerk empieza por `pk_test_` o `pk_live_` y corresponde al ambiente: `pk_test_` solo con `dev` y `pk_live_` solo con `prod`. Si hay DSN de Sentry, tiene que tener la forma `https://<clave>@<host>/<id del proyecto>`; un DSN antiguo con clave secreta se rechaza. Si se pega la clave secreta de Clerk (`sk_`), el error lo dice expresamente. Si algo falla, en lugar de la app aparece una pantalla de error que nombra cada variable con problemas y el motivo, sin mostrar nunca sus valores; la consola del navegador muestra también los nombres.

Fuera de producción, la app muestra en la esquina inferior izquierda una etiqueta pequeña con el ambiente ("Desarrollo"), para comprobar a simple vista a qué ambiente apunta una vista previa o el servidor local. Con `VITE_APP_ENV=prod` no aparece.

El cliente de Supabase se crea una sola vez, en `apps/web/src/lib/supabase.ts`, a partir de la configuración validada, y se carga de forma diferida (ver [Identidad: de Clerk a Postgres](#identidad-de-clerk-a-postgres)). No usa Supabase Auth: la sesión es de Clerk y el cliente envía su token de sesión en cada petición. El catálogo público (#232) usa un segundo cliente, `getPublicSupabase()`, que no envía nunca el token: solo la clave publicable, como `anon`, con o sin sesión. Así la consulta del catálogo no depende de que Clerk cargue ni de que el token de una sesión se pueda obtener (ver [Catálogo público](#catálogo-público)).

Las pruebas no leen estas variables (la validación se prueba con objetos de entorno de ejemplo), así que `npm test` y `npm run build` funcionan sin ningún `.env`, también en la integración continua.

## Errores en Sentry

Los errores de la app se reportan a [Sentry](https://docs.sentry.io/platforms/javascript/guides/react/) con `@sentry/react` (versión 11), solo si el build tiene `VITE_SENTRY_DSN`. Sin esa variable no se descarga ni se inicializa nada de Sentry: el chunk del SDK ni siquiera se genera. Así corren el servidor local, las pruebas y la integración continua.

### Cómo está montado

- **Carga diferida.** En el JavaScript inicial solo va un cargador pequeño (`src/observability/reporter.ts`) y el límite de errores de React. El SDK (`src/observability/sentry.ts`, unos 33 kB comprimidos) se descarga con un import dinámico después del primer pintado, cuando el navegador está libre. Los errores que ocurren antes (errores no capturados, promesas rechazadas y los del límite de errores) se guardan en un búfer de 10 como mucho y se envían al cargar el SDK.
- **Ambiente y versión.** Cada evento lleva el ambiente (`VITE_APP_ENV`: `dev` o `prod`) y la versión, que es el commit desplegado: Vercel lo expone en el build como `VERCEL_GIT_COMMIT_SHA` y `vite.config.ts` lo escribe en una etiqueta `<meta name="orki-release">` del HTML. Va en el HTML y no en el JavaScript para que los chunks no cambien de nombre en cada despliegue. En local no hay versión.
- **Límite de errores.** Si un componente falla al pintarse, en lugar de una página en blanco aparece la pantalla "Algo salió mal" con el botón "Recargar la página", y el error se reporta con la pila de componentes (`src/observability/ErrorBoundary.tsx`).
- **Usuario.** Solo el id de Clerk del usuario con sesión (`src/auth/ObservedUser.tsx`).
- **Ruido ignorado** (`src/observability/noise.ts`): los fallos de red con el navegador sin conexión (incluidos los errores de la app con motivo `offline` y el de Clerk sin conexión) y los errores lanzados por extensiones del navegador. Con conexión, un "Failed to fetch" sí se envía.

### Qué no se envía

Solo se reportan errores: no hay trazas de rendimiento ni grabación de sesión. Las opciones del SDK (`dataCollection`) y dos filtros puros (`beforeSend` y `beforeBreadcrumb`, en `src/observability/privacy.ts`) quitan:

- Correo, nombre e IP del usuario. El SDK pide además a Sentry que no deduzca la IP de la conexión.
- Cookies, cuerpos de peticiones y cabeceras (salvo `User-Agent`).
- Los parámetros de consulta y el fragmento de todas las URL: la de la página (la búsqueda del inventario viaja en `?q=`), las de las navegaciones y peticiones de las migas y las que aparezcan en los mensajes de error.
- Las migas de la consola y los textos (`aria-label`, `title`, `alt`, `name`) de los elementos pulsados, que pueden llevar el nombre de una planta.
- La zona horaria y el idioma del dispositivo.

`src/observability/sentry-options.test.ts` arranca el SDK real con un transporte en memoria y comprueba que el evento saliente no lleva correo, nombre, IP ni parámetros de URL.

### Mapas de código fuente

El build sube los mapas de código fuente a Sentry solo si tiene estas tres variables, con los nombres estándar del plugin `@sentry/vite-plugin`. Se leen del entorno del proceso de build (no de los `.env`), así que se definen en Vercel:

| Variable            | Qué es                                                                                                                                         | Tipo en Vercel |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `SENTRY_AUTH_TOKEN` | Token de organización de Sentry (Organization Tokens, en la configuración de la organización), con permiso para subir mapas y crear versiones. | Secret         |
| `SENTRY_ORG`        | Identificador (slug) de la organización en Sentry.                                                                                             | Config         |
| `SENTRY_PROJECT`    | Identificador (slug) del proyecto en Sentry.                                                                                                   | Config         |

Con las tres, el plugin genera mapas ocultos, enlaza cada chunk con su mapa mediante un identificador (debug ID), los sube y los quita de la salida: no llegan a `dist`, así que no se sirven al público. Si la subida falla, el build avisa y termina bien; el despliegue no depende de que Sentry responda. Si falta alguna, el build es el de siempre, sin mapas y sin contactar con Sentry. La versión usa `VERCEL_GIT_COMMIT_SHA`, que requiere tener activado "Automatically expose System Environment Variables" en Settings > Environment Variables (es lo normal).

### Provocar un error de prueba

En un despliegue con `VITE_SENTRY_DSN`, abre la app, espera a que cargue y escribe en la consola del navegador:

```js
orkiErrorDePrueba()
```

Lanza un `SentryTestError` desde el código de la app (`src/observability/sentry.ts`), fuera de cualquier `try`, que debe aparecer en Sentry con su ambiente, su versión y la traza legible si se subieron los mapas. Si la consola dice que la función no existe, el SDK no se ha cargado: falta el DSN en el build o todavía no ha terminado de cargar. Un `throw` escrito directamente en la consola no sirve, porque no pasa por los manejadores globales de errores.

## Autenticación

La autenticación es de [Clerk](https://clerk.com/docs), con su SDK de React vigente, `@clerk/react` (Core 3). Los métodos de acceso (correo con código de verificación y Google) se activan en el panel de Clerk, no en el código; la app usa los componentes de Clerk en lugar de formularios propios.

### Cómo está montada

- `src/auth/AuthProvider.tsx` envuelve la app con [`<ClerkProvider>`](https://clerk.com/docs/react/reference/components/clerk-provider) y le pasa la clave validada, los textos en español ([`@clerk/localizations`](https://clerk.com/docs/guides/customizing-clerk/localization), variante `es-MX`, la de vocabulario latinoamericano), la apariencia del design system, las rutas de las pantallas de acceso, `afterSignOutUrl="/"` y `routerPush`/`routerReplace` con el `navigate` de React Router, para que Clerk navegue sin recargar la página ([React Router en modo declarativo](https://clerk.com/docs/react/guides/development/declarative-mode)). Un destino de otro origen se abre con una carga normal. La página de muestra queda fuera del proveedor.
- Pantallas: `src/pages/SignInPage.tsx` (`/iniciar-sesion`) y `src/pages/SignUpPage.tsx` (`/registro`) montan [`<SignIn />`](https://clerk.com/docs/react/reference/components/authentication/sign-in) y [`<SignUp />`](https://clerk.com/docs/react/reference/components/authentication/sign-up) dentro de un envoltorio propio (`AuthPageLayout`), con `routing="path"` y su `path`: Clerk lleva sus pasos internos como subrutas (`/iniciar-sesion/factor-one`, `/iniciar-sesion/sso-callback`), por eso esas rutas aceptan `/*`.
- Cuenta (#207): con sesión, la barra de la app lleva el menú «Tu cuenta» propio (`src/auth/AccountMenu.tsx`, en lugar del `UserButton` de Clerk): la foto de la cuenta (o sus iniciales), «Mi cuenta» (`/cuenta`), «Administración» solo con el rol de administrador y «Cerrar sesión», con el cierre propio de la app (`src/auth/useSignOutHere.ts`, también sin conexión). Editar el correo, el nombre o la foto se hace desde `/cuenta` con el editor de perfil de Clerk ([`openUserProfile`](https://clerk.com/docs/reference/javascript/clerk#open-user-profile), `src/auth/profile-editor.ts`). Sin sesión, la barra pública de la portada. La sesión se distingue con [`<Show when="signed-in">`](https://clerk.com/docs/react/reference/components/control/show), que en Core 3 sustituye a `<SignedIn>` y `<SignedOut>`.
- Apariencia: `src/auth/appearance.ts` define el prop [`appearance`](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/overview) con [`variables`](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/variables) y `elements`, y cada valor es una variable de `tokens.css` (`var(--color-primary)`, `var(--font-body)`, `var(--radius-md)`...). `appearance.test.ts` falla si aparece un valor suelto o una variable que no existe en `tokens.css`. Clerk calcula sus tonos con `color-mix()` y color relativo, que con variables CSS piden Safari 16.4+ (el mismo mínimo que ya exige Tailwind 4).
- Pruebas: ninguna carga Clerk ni necesita clave. `src/test/clerk-mock.tsx` sustituye a `@clerk/react` (`vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))`) y permite fijar el estado: cargando, listo, fallo de carga, con o sin sesión y con o sin el claim `app_role`. Las rutas se prueban con `MemoryRouter` en `src/routes/AppRouter.test.tsx`. Las pantallas propias pasan axe con el helper `src/test/axe.ts`.

### Rutas

El enrutador es [React Router](https://reactrouter.com/) 8 en modo declarativo (`<BrowserRouter>`, `<Routes>`, `<Route>`), sin el modo framework. Todas las rutas están en `src/routes/paths.ts` (`PATHS`); el mapa está en `src/App.tsx`, y la muestra, en `src/routes/AppRouter.tsx`. Van en español y sin acentos. "Registro" a secas es el de la cuenta; el de una planta cuelga de la colección.

| Ruta                       | Pantalla                                                                                                                                                      | Acceso                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `/`                        | Portada (ver [Portada](#portada)); con sesión lleva a «Mi colección»                                                                                          | Pública                    |
| `/creditos`                | Créditos y fuentes (ver [Créditos y fuentes](#créditos-y-fuentes))                                                                                            | Pública                    |
| `/catalogo`                | Catálogo público: buscador, géneros, especies de un género y ficha (ver [Catálogo público](#catálogo-público))                                                | Pública                    |
| `/coleccion`               | Mi colección (provisional)                                                                                                                                    | Con sesión                 |
| `/coleccion/nueva`         | Registrar una planta (provisional)                                                                                                                            | Con sesión                 |
| `/ya-la-tengo`             | ¿Ya la tengo? (ver [¿Ya la tengo?](#ya-la-tengo))                                                                                                             | Con sesión                 |
| `/administracion/catalogo` | Administración del catálogo: especies, sus nombres, géneros y abreviaturas, y la cola de propuestas (ver [Backoffice del catálogo](#backoffice-del-catálogo)) | Con sesión y rol de admin. |
| `/iniciar-sesion/*`        | Inicio de sesión (Clerk)                                                                                                                                      | Pública                    |
| `/registro/*`              | Crear cuenta (Clerk)                                                                                                                                          | Pública                    |
| `/muestra`                 | Muestra del design system                                                                                                                                     | Solo fuera de producción   |
| `/diagnostico`             | Diagnóstico de identidad                                                                                                                                      | Solo fuera de producción   |
| Cualquier otra             | Página no encontrada                                                                                                                                          | Pública                    |

- Navegación (#207): `src/components/AppShell.tsx` pinta un enlace "Saltar al contenido", la barra y el pie. Con sesión (o con la sesión recordada sin confirmar), la barra de la app (`src/components/AppBar.tsx`): el logotipo, que enlaza al inicio (con sesión, la colección), las pestañas «Mi colección» y «Catálogo» (`<nav aria-label="Principal">`, con `aria-current="page"` en la colección, sus pantallas hijas y `/ya-la-tengo`, o en todo `/catalogo`) y el menú «Tu cuenta»; «Administración» está en ese menú. Hasta 720 px el logotipo queda en la flor y las pestañas van sin icono, así caben en 360 px. Sin lupa: «¿Ya la tengo?» se abre desde la colección. Sin sesión, la barra pública (`PublicHeader`) con «Catálogo» como enlace de sección (solo en escritorio, como el resto de la NavBar); mientras Clerk carga, el logotipo y «Catálogo», sin los botones de acceso; sin Clerk ni sesión, lo mismo y el aviso breve debajo. La portada (`/`) no usa `AppShell` sino `PublicShell` (ver [Portada](#portada)).
- Cada página pone el título de la pestaña ("Catálogo · orqui.app") y, al llegar navegando dentro de la app (no al cargarla), el foco va a su título (`h1` con `tabIndex={-1}`) para que el lector de pantalla anuncie la página nueva; en las pantallas de acceso, al contenido principal. Ver `src/routes/navigation.ts`.
- Recargar cualquier ruta funciona: en Vercel, la reescritura de `vercel.json` responde con `index.html` todo lo que no es `assets/` ni `workbox-`; con la app instalada, el `navigateFallback` del service worker hace lo mismo con cualquier navegación.
- Carga: `src/routes/AppRouter.tsx` carga `App.tsx` (Clerk, su localización y las páginas) de forma diferida, en un chunk aparte del inicial. El service worker precachea todos los chunks, así que sin conexión también carga.

### Portada

`/` es la portada (#179, rediseñada en #200), según las maquetas de escritorio y de celular y con las piezas de las páginas públicas del design system (ver [Design system en la app](#design-system-en-la-app)): la NavBar (`src/components/PublicHeader.tsx`, dentro de `src/components/PublicShell.tsx`, que conserva «Saltar al contenido» y pone el pie `SiteFooter`), el Hero dividido con la foto a toda la altura y tres ventajas sin recuadro («¿Ya la tengo?», «Registra una orquídea» y «Organiza tu colección», en `src/pages/HomePage.tsx`). Los textos describen funciones que existen hoy; bajo las ventajas, el enlace de texto «Explorar el catálogo» (#232) lleva a `/catalogo`, y en escritorio la cabecera tiene «Catálogo» como enlace de sección. Ya no lleva el dibujo botánico. «Crear cuenta gratis» lleva a `/registro` e «Iniciar sesión» a `/iniciar-sesion`. Hasta 720 px va en una columna y la cabecera queda solo con el logotipo, centrado: las acciones están en el Hero, una debajo de otra, y la foto va debajo, apaisada (2:1).

Qué se ve en `/` lo decide `src/pages/HomeRoute.tsx` con `useAppIdentity()`:

| Situación                                                                      | Qué se ve                                                                                                                                                   |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Con sesión, o con la sesión recordada sin confirmar (sin conexión o sin Clerk) | Redirige a `/coleccion`, sin pintar la portada                                                                                                              |
| Sin sesión, o sin Clerk y sin nadie recordado                                  | La portada                                                                                                                                                  |
| Tras eliminar la cuenta                                                        | La portada con el aviso «Tu cuenta se eliminó…»                                                                                                             |
| Clerk aún no responde y el dispositivo recuerda a alguien                      | La cabecera con solo el logotipo y «Cargando el acceso…»: lo más probable es que tenga sesión, y así no aparece la portada para quitarla un momento después |
| Clerk aún no responde y no se recuerda a nadie                                 | La portada al momento, sin esperar a Clerk (lo normal en una visita nueva)                                                                                  |

Un único `h1` (el título); las ventajas son `h2`. La foto está en `src/assets/portada/` con su origen y cómo sustituirla (`LEEME.md`): la foto se prepara con `npm run portada --workspace=apps/web -- preparar <foto> "<texto alternativo>"` y no entra en el precaché del service worker. La medición de la carga está en [`docs/medicion-de-carga.md`](docs/medicion-de-carga.md).

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
| Sin sesión, Clerk cargando o sin cargar, o fuera de Clerk | Sin fuente registrada: envía solo la clave publicable y la petición va como `anon`. Solo funcionan las funciones del catálogo público.      |
| Tras cerrar sesión                                        | La fuente desaparece al cambiar `useAuth()`: la petición siguiente ya no lleva el token.                                                    |
| Con sesión y sin conexión                                 | `getToken()` lanza `ClerkOfflineError` (Core 3). La petición no se envía y devuelve un error con motivo `offline`.                          |
| Sesión caducada o cerrada en otra pestaña                 | `getToken()` devuelve `null` mientras la app aún cree tener sesión. La petición no se envía y devuelve un error con motivo `session-ended`. |
| Cualquier otro fallo de `getToken()`                      | La petición no se envía y devuelve un error con motivo `failed`.                                                                            |

La regla: **con sesión, una petición nunca sale como anónima ni falla en silencio.** Si no hay token, no se envía. El error es un `SessionTokenError` con su motivo (`reason`); como supabase-js convierte los fallos previos al envío en un `{ error }` con el texto del error, `sessionTokenFailure(error)` reconoce los dos y devuelve el motivo, y `SESSION_TOKEN_ERROR_TEXT` tiene el texto para la pantalla. Cuando Clerk propaga el cierre de sesión, las peticiones siguientes vuelven a ir como `anon`, que desde el #231 solo puede consultar el catálogo con las funciones del [catálogo público](supabase/README.md#catálogo-público). Mientras Clerk carga, la app no sabe aún si hay sesión y las peticiones van como `anon`: las rutas que exigen sesión no se pintan hasta que Clerk está listo (`RequireAuth`), y para que una petición a datos privados hecha como `anon` falle de forma visible en lugar de devolver una lista vacía, `anon` no debe tener privilegios sobre perfiles ni plantas (hoy no los tiene; #6 debe mantenerlo).

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

La app instalada abre sin red: el service worker sirve `index.html`, el JavaScript y las fuentes desde su precache, la portada se pinta enseguida (sin la foto, que no se precachea; queda su texto alternativo) y el acceso no bloquea el arranque. Con una sesión recordada, `/` lleva a la copia local de la colección.

Qué hace Clerk sin red. **Verificado en la documentación de Clerk:**

- `<ClerkProvider>` no carga Clerk en el bundle: descarga en el navegador el script de ClerkJS (y el de su interfaz, `@clerk/ui`) desde el CDN, en el dominio de Frontend API de la instancia. Sin conexión, o si el CDN está bloqueado, Clerk no carga ([Script loading](https://clerk.com/docs/guides/development/troubleshooting/script-loading)). La interfaz se puede empaquetar con la app pasando `ui` al proveedor ([`ui`](https://clerk.com/docs/react/reference/components/clerk-provider#ui)).
- El objeto Clerk tiene un [`status`](https://clerk.com/docs/react/reference/objects/clerk#status): `loading` al iniciar, `ready`, `degraded` (parcialmente operativo) y `error` cuando falla la carga del script o `Clerk.load()`. `loaded` es `true` con `ready` o `degraded`. Los componentes de control [`<ClerkLoading>`, `<ClerkLoaded>`, `<ClerkDegraded>` y `<ClerkFailed>`](https://clerk.com/docs/react/reference/components/control/clerk-failed) siguen ese estado.
- Desde Core 3, `getToken()` lanza `ClerkOfflineError` sin conexión en lugar de devolver `null` ([guía de Core 3](https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3)). Qué hace entonces el cliente de Supabase está en [Identidad: de Clerk a Postgres](#identidad-de-clerk-a-postgres).
- El modo sin conexión documentado de Clerk es solo para Expo (`__experimental_resourceCache`, con caché de recursos y de tokens; [Offline support](https://clerk.com/docs/guides/development/offline-support)). Para web, `<ClerkProvider>` acepta un prop [`experimental`](https://clerk.com/docs/react/reference/components/clerk-provider#experimental) con las opciones `persistClient` y `rethrowOfflineNetworkErrors`, pero la documentación no explica qué hacen ni las garantiza.

**Comprobado en el código de `@clerk/react` 6.19 y `@clerk/shared` 4.48 (no está en la documentación):** el script de ClerkJS se pide a `https://<frontend-api>/npm/@clerk/clerk-js@6/dist/clerk.browser.js` y Clerk espera hasta 15 s a que aparezca antes de pasar a `error`, aunque la petición falle antes; mientras tanto `status` sigue en `loading`. `<ClerkProvider>` pinta sus hijos desde el principio, sin esperar.

**Supuesto, sin verificar con una instancia real:** que una sesión iniciada no sirve sin red en web. Sin el script no hay objeto Clerk, así que la app no puede saber quién es el usuario aunque el navegador conserve las cookies de sesión; y aunque el script estuviera en la caché HTTP del navegador, `Clerk.load()` necesita consultar la API de Clerk.

Cómo arranca la app, en consecuencia (`src/auth/useAuthAvailability.ts`):

- Mientras Clerk carga, las pantallas de acceso y las rutas que exigen sesión muestran "Cargando el acceso…" (`role="status"`) y la barra de las páginas de la app queda solo con el logotipo.
- Si el navegador dice que no hay red (`navigator.onLine === false`), no se espera: se muestra enseguida "Sin conexión".
- Si Clerk falla (`status: error`) o tarda más de 10 s (`AUTH_LOAD_TIMEOUT_MS`), se da el acceso por no disponible. Las pantallas de acceso y las rutas que exigen sesión muestran una alerta (`role="alert"`) con "Volver a intentar", que recarga la página, en lugar de redirigir; las páginas públicas muestran un aviso breve bajo la barra (`role="status"`) y se siguen viendo enteras. Con un usuario recordado, la barra de la app sigue con el menú «Tu cuenta» (avatar neutro, el aviso arriba, «Mi cuenta» y «Cerrar sesión»).
- Si Clerk termina cargando más tarde, todo pasa al estado normal sin recargar.

Modo de solo lectura sin conexión (#18): el detalle, con lo confirmado y lo que falta comprobar en un celular, está en [`docs/sin-conexion.md`](docs/sin-conexion.md). En resumen:

- La app recuerda el id de Clerk del último usuario con sesión (`src/auth/offline-identity.ts`, `orki-ultimo-usuario` en `localStorage`). Sin Clerk (sin red o sin cargar), `useAppIdentity()` (`src/auth/useAppIdentity.ts`) da ese usuario como `unverified`: las rutas protegidas se abren con su copia local y todo es de solo lectura (`useReadOnly()`, `src/collection/useReadOnly.ts`).
- La colección se guarda en IndexedDB por usuario (`src/collection/local-copy.ts` y `cached-source.ts`) con los sinónimos, nombres comunes y abreviaturas que usa "¿Ya la tengo?", y las miniaturas se bajan en segundo plano a Cache Storage (`src/photos/thumbnail-sync.ts`).
- "Cerrar sesión" funciona sin red: borra la copia, las miniaturas y el usuario recordado al momento, y `PendingSignOut` (`src/auth/PendingSignOut.tsx`) se lo pide a Clerk cuando vuelve a estar disponible.
- Las fotos de referencia de las especies (#234) no se guardan en el dispositivo: ni en el precaché, ni en Cache Storage, ni en la copia local. Sin conexión no se piden y, donde faltan, no queda nada roto (ver [Fotos de referencia](#fotos-de-referencia)).

### Service worker y autenticación

El service worker (configuración en `apps/web/vite.config.ts`) no tiene `runtimeCaching`: solo responde a los archivos del precache y a las navegaciones dentro de la app. Las peticiones a Clerk (script y API, en su dominio de Frontend API) y a Google son de otro origen y van siempre a la red, sin guardarse. Las redirecciones de inicio de sesión ocurren en esos dominios; a la vuelta llegan a rutas de la app (subrutas de `/iniciar-sesion` o `/registro`, o la página pedida), que reciben `index.html` para que Clerk termine en el navegador. Clerk no tiene rutas propias en el dominio de la app, así que no hace falta `navigateFallbackDenylist`; haría falta si algún día se usara el proxy de Clerk (`proxyUrl`).

## Colección del usuario

La colección (todas las plantas del usuario con su especie y su género) se lee una vez y se comparte entre pantallas desde `apps/web/src/collection/` (#93). Filtrar, agrupar, contar y ordenar se hace en el dispositivo.

Desde una pantalla:

```tsx
import { useCollection } from '../collection/useCollection.ts'
import {
  countGenera,
  countPlants,
  filterByText,
  groupByGenus,
} from '../collection/selectors.ts'

const { status, plants, error, reload, upsertPlant, removePlant } =
  useCollection()
// status: 'idle' | 'loading' | 'ready' | 'error'
// plants: todas las plantas (también las dadas de baja) o null si aún no hay datos
// error.reason: 'offline' | 'session-ended' | 'failed'; error.message, el texto para mostrar
const visibles = plants ? filterByText(plants, query) : []
```

- **Una lectura por usuario:** `<CollectionProvider>` (dentro de `AuthProvider`) no lee nada al arrancar; la primera pantalla que llama a `useCollection()` lanza la lectura y las demás la comparten, también con `React.StrictMode`. Al cambiar de usuario o cerrar sesión, la colección se descarta y la respuesta tardía de la cuenta anterior se ignora. Tras un error no se reintenta solo: `reload()` (botón "Reintentar").
- **Después de escribir** (#11, #16): pide de vuelta la fila con `.select(COLLECTION_PLANT_SELECT)`, pásala por `toCollectionPlant()` (`model.ts`) y llama a `upsertPlant(planta)`; tras borrar, `removePlant(id)`. No se vuelve a leer todo.
- **Funciones puras** (`selectors.ts`): `filterByText`, `groupByGenus`, `countPlants`, `countGenera`, `sortByName`, `sortByNewest` y `plantsByStatus`. Por defecto solo cuentan las plantas activas; `{ includeInactive: true }` incluye las perdidas y regaladas. La búsqueda usa `normalizeSearchText()` (`normalize.ts`), la misma regla que el catálogo: minúsculas, sin tildes, espacios unificados y sin el signo de híbrido (`×` o una `x` suelta).
- **Lectura en Supabase** (`supabase-source.ts`): una consulta a `plants` con la especie y el género embebidos, filtrada por el usuario activo y paginada por id de 1 000 en 1 000 (el tope de filas de la API).
- **Número de fotos** (#184): cada planta trae `photoCount` (de 0 a 6), del campo calculado `photo_count` de la base (`public.photo_count(plants)`, ver [Número de fotos](supabase/README.md#número-de-fotos) en el README de Supabase), que va en `COLLECTION_PLANT_SELECT`. `photoCountOf()` (`model.ts`) lo normaliza: si falta (copias y respuestas anteriores) o llega a 0 con foto principal (la respuesta de un insert que crea la principal en la misma sentencia), cuenta 1 si hay principal. Tras añadir o quitar fotos, `uploadPlantPhotos` y `removeStoredPlantPhoto` releen la planta y la pasan a `onPlantUpdated`, así que el número se mantiene al día sin releer la colección. Va en la copia sin conexión y en la exportación a CSV. La tarjeta lo pinta cuando hay más de una (`photoCount` de `CollectionCard`, #181): ver la tarjeta más abajo.

La fuente por defecto es la de la copia local del #18 (`cached-source.ts`, ver [Sin conexión](#sin-conexión)), que envuelve a `supabaseCollectionSource`. Cómo sustituir la fuente: implementa `CollectionSource` (`source.ts`), cuyo `load({ userId, signal, provide })` devuelve todas las plantas del usuario o rechaza con un `CollectionLoadError` con su motivo. `provide(plantas)` entrega un resultado provisional (la copia del dispositivo) antes del definitivo. Pásala a `<CollectionProvider source={miFuente}>`; puede envolver a `supabaseCollectionSource`. En las pruebas, `src/test/collection-source.ts` tiene una fuente controlada a mano.

### Pantalla de inventario

`/coleccion` (`src/pages/CollectionPage.tsx`) conecta `useCollection()` con `InventoryView` (`src/inventory/`), que no carga datos: recibe la colección y la pinta. La cabecera la pone la página (#208). La página de muestra (`/muestra`, sección "Pantalla de inventario") usa la misma cabecera y vista con datos fijos (`src/showcase/inventory-data.ts`), también con 300 plantas, vacía, cargando y con cada tipo de error.

- **Cabecera** (`PageHeader` a través de `Page`, #208): «Mi colección», el contador de ejemplares activos y sus géneros ("18 ejemplares · 5 géneros", en singular o plural; no cambia al buscar ni filtrar), la ilustración (sin conexión no se pinta: no va en el precaché) y dos acciones (`src/inventory/CollectionActions.tsx`): "Registrar orquídea" (la principal, a `/coleccion/nueva`) y "¿Ya la tengo?" (secundaria, a `/ya-la-tengo`, con `FROM_INVENTORY` en el estado de la navegación para que su "Volver" sea "atrás"). En escritorio, a la derecha del título; hasta 720 px, apiladas a todo el ancho con "¿Ya la tengo?" debajo. Ya no hay barra fija de registrar abajo ni acceso "Con foto" en el inventario (la pantalla `?foto=1` sigue existiendo). Con la colección vacía, la cabecera va sin contador ni acciones: la llamada a registrar la primera va en el cuerpo.
- **Por defecto, solo plantas activas**, en el contador y en la lista. Las perdidas y regaladas se ven con el filtro de estado.
- **Cuadrícula o lista** (`SegmentedControl` "Vista", junto a "Filtros"). Sin preferencia guardada, cuadrícula: dos por fila en el celular y tres desde 768 px. Lista: la variante de fila de la tarjeta (miniatura de 96 px a la izquierda), una por fila y dos columnas desde 1024 px.
- **Agrupar por género** o no (en el panel "Filtros", grupo "Organizar"). Agrupada: un encabezado por género con su contador ("Phalaenopsis, 3 orquídeas" para el lector de pantalla), los géneros y las plantas en orden alfabético sin tener en cuenta el signo "×". Sin agrupar: las más recientes primero (por fecha de alta).
- **Cada tarjeta** (`CollectionCard`, `PlantCard.tsx`) lleva la foto (la miniatura, `usePlantThumbnail`, ver [Lectura de fotos](#lectura-de-fotos-y-borrado-sin-huérfanos); sin foto, el marcador neutro), el nombre mostrado, el apodo y la ubicación (con `map-pin`) si los hay, y una insignia solo cuando el nombre pide atención: "Nombre por validar" o "No identificable" (#141; esta última, neutra y con borde, `orki-badge--unidentifiable`; en el detalle va con una frase que explica que no se pudo identificar el nombre y que la planta sigue en la colección y se edita como cualquier otra). Las validadas no llevan insignia. Con más de una foto, el número sobre la esquina de la foto (icono de imagen y «3», en la píldora `orki-count`; arriba a la derecha en la cuadrícula, arriba a la izquierda de la miniatura en la lista); el lector de pantalla lo lee como «3 fotos», que es la descripción de la tarjeta, sin cambiar su nombre. El nombre es el enlace al detalle (#16, `orki-card__link`) y cubre toda la tarjeta.
- **Un único buscador** (`SearchField`, "Buscar en mi colección"; la etiqueta se ve en el celular y en escritorio queda para el lector de pantalla), en su sitio, sin quedar fijo arriba: filtra mientras se escribe con `filterByText` por nombre mostrado, nombre ingresado, género, apodo y origen, sin tildes, mayúsculas ni el signo "×". También encuentra, con el mismo índice que "¿Ya la tengo?" (`ownershipIndexFor` y `matchPlantNames` en `ownership.ts`), las plantas por los sinónimos y nombres comunes de su especie y por las abreviaturas de su género, que vienen de la copia local: "orquídea luna" encuentra _Phalaenopsis amabilis_ también sin conexión y sin peticiones nuevas; sin esos extras busca solo en los campos de la planta. Primero salen las coincidencias sin errores y, solo si no hay ninguna, las que toleran errores de tipeo. Escape o la cruz lo limpian. Bajo el campo se dice cuántas coinciden al buscar o filtrar ("3 de 18 orquídeas coinciden.", "2 orquídeas perdidas."), en una región `role="status"` enlazada al campo con `aria-describedby`. Agrupada, los géneros sin coincidencias desaparecen. La consulta "¿Ya la tengo?" ya no va aquí: tiene su propia pantalla (#209).
- **Accesos por género** (`ChipGroup scroll`, "Género"): "Todos" y los géneros de la colección (también los de las plantas dadas de baja), de más a menos plantas y, a igualdad, alfabético sin el "×", en una fila con desplazamiento horizontal. Selección múltiple, como el filtro de género de siempre: cada chip suma o quita su género; "Todos" los quita.
- **Filtros** (#15, `src/inventory/InventoryFilters.tsx`; funciones puras en `src/collection/filters.ts`): estado (uno solo: activas, perdidas o regaladas; por defecto, activas), color de flor (solo los usados, en el orden del enumerado), origen (los usados, de más a menos plantas; "Vivero Sol" y "vivero sol" son el mismo) y nombre (validación: validadas, por validar y no identificables, las presentes; #141). Varios valores a la vez en color, origen y nombre. Se combinan con O dentro de un grupo, con Y entre grupos, con el género y con la búsqueda. Un ejemplar sin color no aparece al filtrar por color; uno sin origen, al filtrar por origen. Las opciones salen de toda la colección (también las bajas), para que no desaparezcan al cambiar de estado. Un grupo sin opciones no se muestra, y sin plantas no hay filtros.
- **Panel de filtros:** el botón "Filtros" (`FiltersButton`, con el número de filtros del panel activos: "Filtros, 2 activos" para el lector de pantalla; el género no cuenta, se ve en su fila) abre y cierra un panel justo debajo de la barra del buscador (patrón disclosure: `aria-expanded`, `aria-controls`). "Listo" o Escape lo cierran y devuelven el foco al botón. Origen enseña 8 opciones y "Ver N más" (las elegidas siempre se ven). Con el panel cerrado, los filtros activos del panel quedan en una fila de chips ("Quitar el filtro Color de la flor: Rosado"); al quitar uno el foco pasa al siguiente y, si no queda ninguno, al botón. "Quitar filtros" quita los del panel y conserva el género. Sin resultados, el aviso ofrece "Quitar filtros" (todos, también el género) y "Limpiar la búsqueda" según lo que haya.
- **Filtros en la URL**, junto a la búsqueda, con nombres en español y valores estables: `/coleccion?q=phal&estado=lost&genero=<id del género>&color=white&color=pink&origen=vivero+sol&validacion=unidentifiable` (`src/inventory/filter-params.ts`). `estado` es la clave del enumerado (sin él, activas); `genero`, el id; `color`, la clave del enumerado; `origen`, el origen normalizado; `validacion`, la clave de `plant_validation`. Los valores múltiples van con el parámetro repetido (un origen puede llevar comas). Lo que no se entiende o ya no está en la colección se ignora. Como la búsqueda, cada toque sustituye la entrada del historial (`replace`): "atrás" sale del inventario en vez de deshacer los toques uno a uno, y al volver del registro, del detalle o de "¿Ya la tengo?" se recupera el último estado.
- **La búsqueda va en la URL** (`/coleccion?q=phal`): abrir esa dirección pone el texto en el buscador (lo usa "Ver en mi colección" desde "¿Ya la tengo?"), y se conserva al volver con "atrás", al recargar y al compartir el enlace. El campo tiene su propio estado y escribe la URL en cada pulsación (sustituyendo la entrada del historial, sin mover el foco): si leyera de la URL, que se actualiza en una transición del enrutador, al escribir deprisa se perderían letras. La URL manda al abrir y cuando cambia por otra navegación.
- **Posición de desplazamiento:** `src/inventory/scroll-memory.ts` la guarda en memoria por entrada del historial y la restaura al volver con atrás o adelante, cuando la lista ya está pintada. Dura la sesión de la pestaña; un enlace a `/coleccion` o una recarga empiezan arriba.
- **Sin barras fijas** (#208): ni el buscador ni registrar quedan fijos, así que el foco no puede quedar tapado (WCAG 2.4.11); `e2e/foco-no-tapado.spec.ts` comprueba que siga así. La protección de `index.css` (`scroll-padding`) queda solo para las acciones fijas del formulario de registro y edición.
- **Estados:** sin plantas, una invitación a registrar la primera; con solo plantas dadas de baja, un aviso de que no hay activas y de que se ven en "Filtros"; con plantas y sin coincidencias, "sin resultados" con la opción de quitar los filtros y de limpiar la búsqueda. Mientras carga, un esqueleto con la forma de la vista elegida (oculto al lector de pantalla, que oye "Cargando tu colección…"); el buscador ya está y no se vuelve a montar al llegar los datos. Si la lectura falla, el motivo en español (sin conexión, sesión terminada o fallo) y "Reintentar", que llama a `reload()`; si falla una recarga con datos en memoria, se siguen mostrando con un aviso.
- **Actualización al volver a la app** (#141): si la app estuvo 2 minutos o más en segundo plano (`visibilitychange`), al volver `CollectionProvider` vuelve a leer la colección ya cargada en segundo plano (`CollectionStore.refresh()`): sin pasar por "cargando", sin perder la búsqueda, los filtros ni la posición, y sin aviso si falla (se sigue con lo que había). Así el usuario ve lo que cambió fuera del dispositivo, como una propuesta que resolvió un administrador, sin cerrar sesión. No hay aviso ni notificación cuando un administrador resuelve una propuesta (decisión del #22).
- **Preferencias del dispositivo:** la vista y la agrupación se guardan en `localStorage` con la clave `orki:inventario:preferencias:v1` (`src/inventory/preferences.ts`). Si el almacenamiento no existe o falla, funcionan igual y duran lo que la pantalla.
- **Exportar a CSV** (#17): bajo la lista, encima del pie, una acción discreta con aspecto de enlace e icono de descarga (#208). "Exportar a CSV" genera el archivo en el dispositivo con la colección en memoria, sin peticiones (`src/collection/export-csv.ts`, función pura; `src/inventory/ExportAction.tsx` y `save-file.ts`). Sin plantas (o mientras carga) no aparece.
  - **Qué incluye:** todas las plantas del usuario, también las perdidas y regaladas, sin importar los filtros ni la búsqueda (lo dice el texto junto al botón). Una fila por ejemplar, ordenadas por género y nombre (como la vista agrupada, sin tener en cuenta el "×").
  - **Columnas:** Nombre científico (vacío si la planta está por validar), Nombre ingresado, Género, Tipo, Estado, Validación, Fecha de adquisición, Origen, Ubicación, Apodo, Color de flor, Foto en floración (de la principal: "Sí", "No" o vacío si no hay foto), Fecha de registro y Número de fotos (de 0 a 6, #184; al final, para no mover las anteriores). Sin fotos ni rutas. Valores en español con los mismos textos que la interfaz (`src/collection/labels.ts`); fechas `AAAA-MM-DD` (la de registro, en la fecha local del dispositivo).
  - **Formato:** UTF-8 con marca de orden de bytes (para que Excel muestre tildes, ñ y "×"), separador coma (configuración regional de Perú; un Excel configurado para España espera punto y coma y lo abriría en una columna), fin de línea CRLF y escapado RFC 4180: una celda con coma, comillas, salto de línea o espacios en los extremos va entre comillas, con las comillas duplicadas. Nombre: `orqui-app-inventario-AAAA-MM-DD.csv`, con la fecha local.
  - **Fórmulas:** una celda que empieza por `=`, `+`, `-`, `@`, tabulador o retorno de carro (también tras espacios) lleva delante un apóstrofo (regla de OWASP), y la hoja de cálculo la trata como texto. El valor sigue entero detrás: "-la pequeña" queda "'-la pequeña"; sin el apóstrofo, Excel lo tomaría por una fórmula y mostraría un error.
  - **Entrega:** en un dispositivo táctil con la Web Share API para archivos (`navigator.canShare({ files })`) se abre la hoja de compartir del sistema (guardar en Archivos, correo, abrir en Sheets); si el usuario la cierra no pasa nada más y, si falla, se descarga. En el resto, un enlace temporal con `download` a una URL de objeto del `Blob`, que se revoca un segundo después. El motivo: en la app instalada en iPhone (modo standalone), Safari no siempre respeta `download` con un `Blob`. Probado con pruebas automáticas y, en Chrome de escritorio (página de muestra), la generación del archivo y el enlace de descarga, sin llegar a guardarlo; la descarga en iPhone y Android y la apertura en Excel y Google Sheets están pendientes de la prueba manual del issue.

**Cursiva de los nombres** (`src/components/ui/scientific-name.ts`): solo va en cursiva un nombre del catálogo (`displayNameIsScientific`); el nombre que ingresó la persona para una planta por validar va en redonda y en la fuente de cuerpo. Dentro del nombre científico, el género y los epítetos van en cursiva y en redonda el signo "×" (también una "x" suelta), las abreviaturas de rango ("var.") y, desde la primera palabra con mayúscula o comilla después del género, el grex y el cultivar: _Phalaenopsis_ Sogo Yukidian, × _Rhyncholaeliocattleya_ Memoria Anna Balmores, _Phalaenopsis_ × _intermedia_. Los tramos en redonda van en la fuente de cuerpo, porque de Playfair Display solo se cargan la cursiva 400 y la redonda 600. El nombre se muestra tal como está guardado. Los géneros como etiqueta (encabezados de grupo, línea de la tarjeta) van sin cursiva, como en los chips del sistema.

### ¿Ya la tengo?

`/ya-la-tengo` (`PATHS.ownershipCheck`, `src/pages/OwnershipCheckPage.tsx`, en su propio chunk y con sesión) es la consulta rápida del #209: saber en segundos, delante de una planta en un vivero, si ya está en la colección. Se abre con el botón «¿Ya la tengo?» de «Mi colección» y la barra la trata como parte de esa pestaña. Pantalla de una sola tarea con `PageHeader` centrado (enlace «Volver a Mi colección», título, «Comprueba si una orquídea ya está en tu colección.» y la ilustración), un único campo (`SearchField`, que recibe el foco al entrar) y la respuesta debajo con `QueryAnswer`.

- **Lógica compartida:** `src/inventory/useOwnershipAnswer.ts` reúne lo que antes estaba dentro de `OwnershipPanel`: la respuesta sale de la colección en memoria al escribir (`collection/ownership.ts`), sin esperar a la red, con los sinónimos, nombres comunes y abreviaturas de la copia local (#18); con conexión el catálogo la mejora cuando llega (#124, `useCatalogOwnership`). La lista de ejemplares y el acceso a registrar están en `src/inventory/OwnershipMatches.tsx`. El panel del inventario usa las mismas piezas.
- **Respuestas** (`src/ownership-check/CheckAnswer.tsx`): «Sí, la tienes» con el número de ejemplares activos y de qué especie (o del género, si se busca un género); «Tienes parecidas» si solo se parecen dentro de la tolerancia de errores de tipeo; «No, pero la tuviste» si solo hay perdidos o regalados; «Aún no la tienes». Cuentan las plantas con el nombre por validar (por el nombre ingresado), y la lista lo dice. Bajo la respuesta, hasta 5 ejemplares con enlace a su detalle y, si no la tiene (o solo parecidas), «Registrarla con este nombre» (o «No es la misma: registrarla»), que abre el registro con el nombre del catálogo o lo escrito.
- **«Ver en mi colección»** (`src/ownership-check/collection-link.ts`): abre el inventario con su buscador lleno, `/coleccion?q=<lo consultado>`, que filtra con el mismo índice y la misma tolerancia y muestra los ejemplares contados. Si la coincidencia la añadió el catálogo (un sinónimo que la copia local no tiene), `q` lleva el nombre de los ejemplares; si solo la tuvo, se añade su estado (`&estado=lost`); con perdidos y regalados a la vez no hay enlace (la lista enlaza a cada uno). Con un solo ejemplar, su detalle está además a un toque en la lista.
- **«Volver a Mi colección»** (`detail/BackToCollection.tsx`, el del detalle): si se llegó desde el inventario con el estado `FROM_INVENTORY` (`detail/navigation.ts`), es «atrás» en el historial y el inventario recupera su búsqueda, sus filtros y su posición; abierta la dirección directamente, enlaza a `/coleccion`.
- **La consulta en la dirección:** lo escrito va en `?q=` sustituyendo la entrada del historial (`replace`, conservando el estado de navegación), así recargar o volver conserva la consulta sin llenar el historial. El campo tiene su propio estado y la dirección solo se lee al abrir: si el campo leyera de la dirección, que se actualiza en una transición del enrutador, al escribir deprisa se perderían letras.
- **Sin conexión:** responde sobre la copia local de solo lectura, con el indicador de siempre (`OfflineNotice`, con la fecha de la última actualización) y «Registrarla con este nombre» desactivado citándolo. Sin copia ni conexión, «Sin copia disponible» (`QueryAnswer` con tono `notice`) explica que no se puede comprobar y qué hacer (abrir «Mi colección» con señal una vez), con «Reintentar»: nunca un «Aún no la tienes». Mientras carga la colección, «Cargando tu colección para responder…». Sin red, la cabecera va sin la ilustración, que no está en el precaché.
- **Medición de uso** (#146): la pantalla pasa a `useOwnershipAnswer` el `onMeasure` de `useHaveItSearchEvents`, con las mismas reglas de siempre: un evento por búsqueda con la primera respuesta estable (o la que había al salir), sin el texto, marcado como sin conexión y en la cola cuando toca (ver [`docs/sin-conexion.md`](docs/sin-conexion.md), sección 6).
- **Accesibilidad:** la respuesta va en una región `role="status"` siempre montada (vacía sin respuesta), que se anuncia sin mover el foco del campo; la lista y el acceso a registrar quedan fuera, para no leerlos en cada pulsación. Objetivos de 44 px y sin desplazamiento horizontal a 360 px.
- **Pruebas:** `src/pages/OwnershipCheckPage.test.tsx` (cada respuesta, sin conexión con y sin copia, cargando, `?q=`, los enlaces, el regreso, el foco, el evento y axe) y `e2e/ya-la-tengo.spec.ts` (a 360 y 1440 px, con axe).

### Detalle de una planta

`/coleccion/:id` (`src/pages/PlantDetailPage.tsx`, chunk diferido; rediseño y galería del #183). Los datos salen de la colección en memoria; las fotos, de `plant_photos`.

- **Diseño:** cabecera del sistema (`Page` con `header`, sin ilustración) con «Volver a Mi colección» (`BackToCollection`, «atrás» si se llegó desde el inventario, para recuperar la búsqueda, los filtros y la posición; 44 px de alto), el nombre como título y el apodo debajo. En escritorio, dos columnas (`orki-detail`): la galería a la izquierda y, a la derecha, «Datos de la planta» (`Panel`) y las acciones de siempre (editar, dar de baja o reactivar, eliminar, con los mismos diálogos). Hasta 720 px, una columna: galería, datos y acciones.
- **Galería** (`src/detail/PlantGallery.tsx`, clases `orki-viewer`, ver `docs/piezas-de-interfaz.md`): la foto elegida en grande (la principal al entrar) y, con más de una, las seis como miniaturas (botones con `aria-pressed`, «Foto principal», «Foto 2 de 4»…). Sin fotos, el marcador de siempre y «Añadir fotos». Texto alternativo de cada foto: «Foto 2 de 4 de _Cattleya maxima_, en flor».
- **Ver en grande:** tocar la foto abre el visor a pantalla completa (`PhotoLightbox`, sobre `Modal`): «Foto 2 de 4» (anunciado), anterior y siguiente con botones, flechas del teclado o deslizando el dedo, sin dar la vuelta; el foco queda dentro, Escape cierra y el foco vuelve a la foto, que queda elegida. En la página solo se descargan miniaturas; la foto completa se pide en el visor, solo la que se ve (`usePlantImage(foto.photoPath, 'photo')`). Mientras llega, o si no se puede, la miniatura con un aviso.
- **Fecha y nota:** bajo la foto elegida, su fecha («Foto del 5 de octubre de 2026»), «En flor» y su nota, si las tiene. «Editar fecha y nota» abre ahí un formulario (`PhotoDetailsForm`): fecha opcional y no posterior a hoy, nota opcional de hasta 500 caracteres (con contador; la nota se guarda sin espacios a los lados y vacía es `null`) y «En flor». Guardado explícito («Guardando…», el error con su motivo y lo escrito conservado); al guardar o cancelar, el foco vuelve a «Editar fecha y nota». Cambiar «En flor» de la principal relee la planta (la base lo copia a `plants.photo_in_bloom`).
- **Principal y orden:** «Hacer principal», «Mover antes» y «Mover después» sobre la foto elegida (con `aria-disabled` y el motivo cuando no aplican). Cada cambio es una sola operación atómica (`reorderPlantPhotos`, ver la API más abajo); al cambiar la principal se relee la planta y la tarjeta del inventario muestra la nueva. Si otro dispositivo añadió o quitó una foto entre tanto, no se cambia nada, se dice y se vuelven a leer.
- **Añadir y quitar fotos** es cosa de la edición (#221): «Añadir o quitar fotos» lleva a ella desde la galería.
- **Sin conexión (o con la sesión sin confirmar):** nada se escribe; todos los cambios quedan con `aria-disabled` y el motivo. Lo único garantizado es la miniatura principal (está en la colección guardada y en Cache Storage, #119). La lista de fotos se recuerda en memoria mientras dura la pestaña (`usePlantGallery`): si ya se vio la planta, se ven todas, cada una si su miniatura está en la caché y, si no, el hueco «Disponible con conexión» (sin imágenes rotas). Si no se vio, solo la principal con «Sin conexión: solo está disponible la foto principal…». Al volver la conexión se vuelven a leer.
- **Pruebas:** `src/pages/PlantDetailGallery.test.tsx` (0, 1 y 6 fotos, elegir, el visor con el teclado, fecha y nota con sus errores, hacer principal con la tarjeta del inventario, mover, la galería que cambió entre tanto, sin conexión y axe), `src/components/ui/PhotoLightbox.test.tsx`, `src/pages/PlantDetailPage.test.tsx` y `e2e/galeria-del-detalle.spec.ts` (a 360 y 1440 px con axe, el visor, fecha y nota, hacer principal y la tarjeta, sin conexión).

## Fotos de referencia

Las fotos de referencia de las especies (#234, parte de #180) son fotos de iNaturalist que enseñan cómo es una especie, nunca la planta de nadie. El modelo, las licencias aceptadas (CC0, dominio público, CC BY y CC BY-SA) y el bucket público `species-photos` están en [Fotos de referencia](supabase/README.md#fotos-de-referencia); hoy puede no haber ninguna cargada, y todo se ve igual sin ellas.

- **La pieza** (`src/components/ui/ReferencePhoto.tsx`, ver `docs/piezas-de-interfaz.md`): siempre rotulada «Foto de referencia», con texto alternativo «Foto de referencia de <nombre científico>» y su crédito a la vista (autor, licencia enlazada a su texto legal en Creative Commons, «reducida» si la imagen está adaptada y «Ver el original en iNaturalist»). La imagen lleva su ancho y su alto, `loading="lazy"`, `decoding="async"` y sin `Referer`; si no carga, la pieza se retira entera, sin hueco roto.
- **Direcciones:** la pública del bucket (`supabase.storage.from('species-photos').getPublicUrl(ruta)`), sin token ni URL firmada. `src/lib/referencePhotos.ts` valida lo que llega (una licencia que no es de las cuatro, un original que no es de iNaturalist o una foto sin autor se tratan como «sin foto») y resuelve las direcciones.
- **Dónde se piden y cuántas consultas añaden:**
  - Catálogo público: en la misma respuesta de `get_public_species`, `search_public_species` y `list_public_genus_species`; ninguna consulta más.
  - Registro: al elegir una especie del catálogo (al editar, solo si cambia), «Así es esta especie» bajo el nombre, con la miniatura y el crédito. Una consulta por clave a `species_photos` con sesión por especie elegida (`useReferencePhoto`, que la recuerda en memoria mientras dura la pestaña); ninguna sin conexión. Sin foto, o si falla, nada.
  - Detalle de una planta sin ninguna foto propia: la de su especie en el recuadro de la foto, con el rótulo, el crédito y «Aún no tienes fotos de esta planta…»; no es principal, no cuenta en «N de 6» ni abre el visor. Una consulta por clave al abrir el detalle (la misma que en el registro), ninguna con fotos propias o sin especie. No se embebe en la consulta de la colección: con 100 plantas en el doble, la respuesta pesaría entre un 19 % (con foto en 3 de cada 10 especies) y un 55 % (todas con foto) más, en cada carga de «Mi colección» y en su copia del dispositivo. La tarjeta del inventario no cambia.
  - Backoffice: embebida en la lectura del detalle de la especie (`species(..., species_photos(...))`), sin consulta más.
- **Retirar** (backoffice, en el detalle de la especie): «Retirar foto», con el motivo obligatorio (mal identificada, inapropiada, a petición del autor u otro) y confirmación, llama a `retire_species_photo` con la foto que se está viendo. Si cambió entretanto (`species_photo_not_found`), no se toca nada, se avisa y se relee el detalle. La retirada sale en el historial de la especie con su motivo y la foto.
- **Sin conexión y service worker:** las fotos de referencia no van en el precaché (no son del build) ni se copian a Cache Storage o IndexedDB. El service worker no tiene `runtimeCaching` (ver la configuración de Workbox en `vite.config.ts`), así que no intercepta las peticiones a Supabase: las imágenes, de otro origen, van a la red y solo las guarda la caché HTTP del navegador, con el `Cache-Control` que les ponga la carga (las rutas cambian con cada foto, así que no se sirve una vieja). Se decidió no añadir una regla de Workbox para ellas: guardarlas sería una copia local más de fotos de terceros (con su crédito que mantener y su retirada que propagar) y el inventario sin conexión no las necesita. Las fotos de las plantas tampoco pasan por el service worker: sus miniaturas las guarda la app en Cache Storage.
- **Pruebas:** `src/lib/referencePhotos.test.ts`, `src/components/ui/ReferencePhoto.test.tsx`, `src/catalog/CatalogRoutes.test.tsx`, `src/registration/SpeciesPreview.test.tsx`, `src/pages/NewPlantPage.test.tsx`, `src/pages/PlantDetailGallery.test.tsx`, `src/backoffice/SpeciesReferencePhoto.test.tsx` y `e2e/fotos-de-referencia.spec.ts` (el Supabase simulado sirve dos especies con foto y una ilustración WebP local, nunca la red).
- **Sin verificar:** el bucket `species-photos` real (direcciones públicas, cabeceras de caché y CORS del CDN de Supabase) y la carga, que aún no ha subido ninguna foto.

## Registro de una planta

`/coleccion/nueva` (`src/pages/NewPlantPage.tsx`, chunk diferido) conecta el formulario `PlantForm` (`src/registration/`) con Supabase y con la colección. Desde el #221 (parte del #218) lleva los cuatro campos obligatorios (nombre, género, tipo y fecha de adquisición), el origen, una galería de 0 a 6 fotos y la sección plegable "Más detalles (opcional)". La página de muestra (`/muestra`, sección "Formulario de registro", plegada) usa el mismo formulario con datos fijos y deja elegir el resultado del guardado y de la subida de las fotos (también que falle solo la segunda) y quitar la conexión; las piezas sueltas están en "Registro: piezas" (ver `docs/piezas-de-interfaz.md`).

- **Diseño** (#221): cabecera del sistema (`Page` con `header`, sin ilustración) con «Volver a Mi colección» y «Registrar una orquídea». En escritorio, a dos columnas (`FormLayout`): los datos a la izquierda y la galería a la derecha, alineada arriba con el nombre; la fecha y el origen en una fila (`FormPair`); "Más detalles" debajo, a la izquierda. Hasta 720 px, una columna, con la galería después del origen; el tipo se ve como control segmentado de ancho completo (`ChipGroup segmented`, siguen siendo botones de alternar). Las acciones van al final del formulario (`FormActions`): en escritorio «Cancelar» y «Registrar orquídea» a la derecha; en el celular, «Cancelar» como enlace y «Registrar orquídea» a todo el ancho. Nada queda fijo al desplazar la página (ya no hay `data-barra-inferior` ni su `scroll-padding`). El fondo por género (#13) se quitó: la maqueta no lo lleva; las fotos y el script siguen en `src/assets/fondos-genero/` y `npm run fondos`.
- **Estado en un solo sitio** (`form-state.ts`): `PlantFormValues`, el reductor `plantFormReducer`, `validatePlantForm()` y `toPlantInsert()`, sin React. Las fotos van aparte (son archivos, no datos de la fila), en `usePhotoEntries.ts`, y se suben después de guardar; el aviso de duplicado (#88) depende de `species`; `isPendingName()` dice cuándo se guarda como "nombre por validar" (#12).
- **Nombre:** `Autocomplete` contra `search_species`, con el nombre científico en `ScientificName` (prop `renderLabel`) y, debajo, el sinónimo o el nombre común por el que coincidió. Elegir una especie marca su género y su tipo y los bloquea (`aria-disabled`, con la explicación enlazada por `aria-describedby`) y pone bajo el campo la insignia «Coincidencia en el catálogo» (`MatchBadge`, dentro de la ayuda «Busca por nombre científico, sinónimo o nombre común.», así el lector la lee con el campo). Cambiar el texto desenlaza la especie: la insignia desaparece y el género y el tipo vuelven a ser editables con lo que tenían, hasta volver a elegir una sugerencia. Tope de 200 caracteres, sin espacios sobrantes. El camino corto (nombre con coincidencia y guardar) no tiene más pasos que antes.
- **Nombre por validar** (#12): un nombre que no está en el catálogo se guarda tal cual, sin especie (`validation` la pone la base: `pending`), con los mismos pasos que una especie del catálogo; la acción final de la lista solo lo confirma y no es obligatoria. La ayuda del campo explica qué pasará: queda en el inventario como "Nombre por validar" y un administrador confirmará el nombre. Mientras `isPendingName()`, la galería lleva un solo aviso bajo su título (su descripción, `aria-describedby`), sin exigir fotos ni añadir pasos: sin fotos las recomienda y dice que el equipo del catálogo podrá verlas para validar el nombre (`PLANT_FORM_TEXT.pendingPhotoHint`); con fotos, también las que ya tenía la planta al editar, avisa de lo mismo en singular o plural (`pendingPhotoNotice(n)`: «…podrá ver esta foto / estas fotos para identificarla»); los dos terminan con «Más en Privacidad» (#210), un enlace de la app al registrar (el borrador conserva lo escrito y las fotos y se recupera al volver) y en otra pestaña al editar, que no tiene borrador. En el inventario y en el aviso tras registrar el estado va con `StatusBadge`; una planta "no identificable" (la marca el administrador desde la cola de propuestas, #22) lleva su propia etiqueta, "No identificable" (#141). Cuando el administrador la enlaza a una especie, la tarjeta pierde la insignia (las validadas no la llevan) y muestra el nombre del catálogo y el nombre ingresado se conserva (`enteredName`, que el buscador del inventario sigue mirando).
- **Aviso de duplicado** (`DuplicateNotice.tsx`, `duplicates.ts`): al elegir una especie del catálogo, si el usuario ya tiene ejemplares activos de ella, bajo el nombre aparece "Ya tienes 2 ejemplares de … Puedes registrar otro igualmente."; no bloquea el guardado. Cuenta sobre la colección en memoria (solo las plantas activas enlazadas a esa especie; no las dadas de baja ni los nombres por validar), sin consulta propia: la pantalla ya pide la colección para sumar la planta nueva y llega en una sola lectura. Mientras se lee, o si falla, no hay aviso y el formulario no espera; si llega después de elegir la especie, el aviso aparece entonces. Va en una región `role="status"` siempre montada, que lo anuncia sin mover el foco. No reutiliza `OwnershipAnswer`: es la respuesta grande de "¿Ya la tengo?", con título propio y una región que no se puede dejar montada vacía.
- **Género:** chips de los géneros de acceso rápido, leídos de `genera` (`is_quick_access`, lectura pública) con una consulta que se hace una vez por sesión (`quick-genera.ts`), más "Otro", que abre el buscador de géneros (`search_genera`, también por abreviatura) y guarda el elegido, que aparece como un chip más. Siempre se guarda un `genus_id` del catálogo.
- **Fecha:** `<input type="date">` precargado con la fecha local del dispositivo (`src/lib/localDate.ts`, no `toISOString()`, que da la de UTC), con `max` en hoy y validación propia contra fechas futuras.
- **Origen** (`OriginField.tsx`, `origin-suggestions.ts`): `Autocomplete` con los orígenes que el usuario ya usó, sacados de la colección en memoria (todas sus plantas, también las dadas de baja), sin consulta propia. Se agrupan sin distinguir mayúsculas, tildes ni espacios sobrantes (`normalizeSearchText()`), se muestra la forma del registro más reciente y se ordenan por número de usos y, a igualdad, por el uso más reciente; como mucho 6. Acepta cualquier texto nuevo, sin "sin resultados". Mientras la colección se lee, o si no se pudo leer, no hay sugerencias y el campo funciona igual.
- **"Más detalles (opcional)"** (`Collapsible` con borde, cerrado por defecto): ubicación, apodo y color de la flor (chips del enumerado `flower_color`; tocar el elegido lo quita). Si al intentar guardar hay un error dentro, se abre sola y el foco va al campo. "La foto principal es en floración" (`photoInBloom`, un chip de alternar con `aria-pressed`) solo aparece con alguna foto; quedarse sin fotos lo desmarca, y sin fotos nunca se envía `photo_in_bloom`. Va en la fila de la principal (`in_bloom` de la primera foto), que la base copia a `plants.photo_in_bloom`.
- **Topes:** 200 caracteres en el nombre y 120 en origen, ubicación y apodo, los de la base. Los campos cortan con `maxLength` y la validación cuenta caracteres (no unidades de UTF-16) para lo que llega por otra vía, como un borrador. Los opcionales se envían sin espacios sobrantes y solo si tienen valor.
- **Borrador** (`draft.ts`): cada cambio guarda `PlantFormValues` y el `id` de la planta en `localStorage`, en la clave `orki:registro:borrador:<id de usuario>`, con versión de formato y la hora del último cambio. Se usa `localStorage` y no `sessionStorage` porque este último se pierde cuando iOS termina la PWA instalada (al abrir la cámara, por ejemplo) y al reabrirla empieza otra sesión. Al volver al formulario se recupera con un aviso discreto (`role="status"`, «Recuperamos lo que estabas escribiendo.») y "Descartar borrador" (formulario vacío, sin fotos y otro `id`). Caduca a las 24 horas del último cambio; uno caducado, de otra versión o ilegible se borra. Se borra también al guardar con éxito, al vaciar el formulario y al salir con "Cancelar" (que pregunta antes si hay algo escrito o alguna foto). Salir de otra forma (otra pestaña de la app, «Volver a Mi colección», cerrar, recargar) lo conserva. Con otra cuenta en el mismo dispositivo no aparece. Conservar el `id` hace que un guardado que llegó a la base justo antes de una recarga no se duplique al reintentar. Si `localStorage` no está o falla, todo va en `try/catch` y el formulario funciona sin borrador.
- **Validación:** solo al intentar guardar (después, al corregir); cada error va junto a su campo con `aria-describedby` y el foco pasa al primero.
- **Guardado** (`save-plant.ts`): `POST /rest/v1/plants?select=<COLLECTION_PLANT_SELECT>` con `{ id, entered_name, genus_id, type, acquired_on[, species_id, origin, location, nickname, flower_color, photo_in_bloom] }`, nunca `validation` ni `user_id`. La fila devuelta pasa por `toCollectionPlant()` y `upsertPlant()`. El `id` lo genera la app y se reutiliza al reintentar: si un intento llegó a la base y se perdió la respuesta, el siguiente choca con la clave primaria y se lee la planta ya guardada en lugar de crear otra. Errores con motivo (sin conexión, sesión terminada, servidor, rechazo de la base traducido) sin perder lo escrito y con "Reintentar"; sin doble envío. Exige conexión.
- **Galería** (#221, `PhotoGallery` y `usePhotoEntries.ts`): «Fotos (opcional)», el contador («3 de 6»), las miniaturas en tres columnas (la primera con «Principal») con su botón de quitar, «Elegir fotos» (`<input type="file" accept="image/*" multiple>`) y, solo en dispositivos táctiles (`useTouchDevice`: puntero grueso o `maxTouchPoints`), «Tomar foto» (con `capture="environment"`, que abre la cámara trasera; un navegador no dice si hay cámara sin pedir permiso y en el escritorio `capture` se ignora). Cada foto elegida o tomada se prepara como siempre (reducción, sin metadatos y miniatura, en el chunk diferido de fotos), de una en una, con su hueco ya reservado («Preparando…»), así el máximo de 6 cuenta también las que se preparan; mientras tanto, el botón principal dice «Preparando las fotos…» con `aria-disabled`. Si una selección no cabe, se añaden las que caben y se dice cuántas quedaron fuera («Se añadieron 2 fotos; 1 quedó fuera: el máximo es 6.»), sin tocar las ya elegidas. Con seis, «Tomar foto» y «Elegir fotos» quedan con `aria-disabled` y el motivo («Ya tienes 6 fotos. Quita una para añadir otra.»); vuelven al quitar una. Quitar la principal promueve la siguiente. Una foto que no se puede preparar se quita con su motivo (`role="alert"`). Los cambios se anuncian en una región `role="status"` («Foto añadida: 3 de 6.», «Foto quitada: quedan 2 de 6. La siguiente pasa a ser la principal.»). Cada miniatura tiene nombre («Foto principal», «Foto 2 de 3») y todo se usa con el teclado; al quitar, el foco pasa a la que ocupa su lugar o a «Elegir fotos».
- **Orden de guardado con fotos:** 1) se inserta la planta (como sin fotos); 2) se borra el borrador y la planta pasa a la colección (`onPlantStored`, que la pantalla conecta con `upsertPlant`); 3) se suben las fotos con `uploadPlantPhotos` (ver [Varias fotos por planta](#varias-fotos-por-planta-api-de-datos)), una detrás de otra, con el progreso de cada una en su miniatura («Subiendo… 40 %», después «Guardada») y en una región `role="status"` («Tu orquídea quedó registrada. Subiendo las fotos… (1 de 3)»); al cambiar la principal, la planta releída vuelve a la colección; 4) se vuelve al inventario con el aviso de registro, y la tarjeta muestra la principal. La subida se espera en el formulario y no en segundo plano: las fotos preparadas siguen en memoria para reintentar. Mientras sube, los campos quedan desactivados (la planta ya existe), el botón principal dice «Subiendo las fotos…» con `aria-disabled` (sin doble envío) y «Cancelar subida» la corta.
- **Si alguna foto falla** (o se cancela): la planta ya está registrada y en la colección, y las fotos que subieron, guardadas. Un aviso `role="alert"` dice cuáles fallaron («Tu orquídea quedó registrada, pero no se pudo subir la foto 2 de 3.», con el motivo), cada miniatura que falló lo muestra («No se subió», con «Reintentar foto 2 de 3») y el foco pasa a «Reintentar fotos», que reintenta solo las que fallaron, con las mismas fotos ya preparadas y en su lugar (la API no duplica ni la planta ni las filas), o a «Continuar sin ellas», que vuelve al inventario. Con la sesión terminada o la planta borrada no se ofrece reintentar, solo «Continuar». Salir a mitad deja la planta con las fotos que llegaron; los archivos sin fila los encuentra el script de limpieza.
- **`?foto=1`:** la antigua entrada "desde la cámara" (#87) se retiró con su código (`photo-first.ts`): desde el #208 no había botón que llevara a ella y la galería ya ofrece «Tomar foto». La dirección sigue abriendo el registro de siempre (el parámetro se ignora).
- **Borrador con fotos** (`draft-photo.ts`): las fotos ya preparadas (dos `Blob` cada una) no caben en `localStorage`, así que van en IndexedDB (base `orki-registro`, almacén `foto-pendiente`), una entrada por usuario con hasta 6 fotos en su orden (`writeDraftPhotos`, `readDraftPhotos`, `clearDraftPhotos`, formato de la versión 2; uno de la versión 1, de una foto, se lee igual) y el `id` de planta del borrador de texto. Al volver al formulario se recuperan en su orden, sin volver a prepararlas, solo si ese `id` coincide; sin borrador o con otro `id`, se borran, y al leer se borran también las de otros usuarios. Con fotos el borrador de texto se guarda aunque no haya nada escrito, para conservar ese `id`. Caducan a las 24 horas y se borran al guardar la planta, al quitar la última, al descartar el borrador y al salir con "Cancelar". Límite: cubre una recarga después de elegir las fotos (por ejemplo, si iOS descarga la app al salir a buscar el nombre); si iOS recarga la app mientras la cámara está abierta, esa foto todavía no llegó a la página y hay que volver a tomarla. Si IndexedDB no existe o falla (también la navegación privada de Safari, que no guarda `Blob`), todo va en `try/catch` y el formulario funciona igual, sin conservar las fotos.
- **Sin conexión** (`useOnlineStatus`): el formulario se desactiva con el motivo y vuelve solo al recuperarla; la galería queda con `aria-disabled` y las fotos elegidas se conservan. Si se pierde la conexión con una subida fallida, «Reintentar fotos» queda con `aria-disabled` y «Continuar sin ellas» sigue disponible.
- **Después de guardar** vuelve al inventario (sustituyendo la entrada del historial) con un aviso de confirmación (`role="status"`) con la etiqueta de validación y "Registrar otra". "Cancelar" pregunta antes de salir solo si hay cambios. El evento de producto «registro completado» (#146) mide desde que se abre el formulario hasta que termina el registro; «con foto» (`has_photo`) es verdadero si quedó al menos una de las fotos de la galería, sean una o seis, y falso si no se eligió ninguna o fallaron todas y se siguió sin ellas (#184; el esquema del evento no cambia, `NewPlantPage.test.tsx` lo comprueba con 0, 2 y 6 fotos y con todas fallidas).
- **Edición** (`/coleccion/:id/editar`, `EditPlantPage.tsx`): el mismo formulario, precargado, con «Volver a la planta» (que, como «Cancelar», pregunta si hay cambios). La galería muestra las fotos guardadas (`listPlantPhotos`, sus miniaturas con `useStoredThumbnails`). Quitar una guardada no la borra todavía: se dice («Una foto guardada se borrará al guardar los cambios.») y se puede deshacer; «Cancelar» no borra nada. Al guardar: primero los datos que cambiaron, después se borran las quitadas (`removeStoredPlantPhoto`, que promueve la siguiente) y al final se suben las nuevas detrás de las que quedan, hasta 6 en total. Si algo de las fotos falla, los cambios ya están guardados («Los cambios quedaron guardados, pero…») y se reintenta o se continúa igual que al registrar.
- **Pruebas:** `src/pages/NewPlantPage.test.tsx` (con `fetch` simulado: PostgREST con `plants` y `plant_photos`, Storage y la zona horaria `America/Lima`; la recarga se simula desmontando y volviendo a montar la app con el mismo `localStorage`; la preparación de la foto es un doble y las fotos pendientes van en un almacén en memoria, porque jsdom no tiene canvas ni IndexedDB), `src/pages/EditPlantPage.test.tsx` (galería de la edición sobre `src/test/supabase-plants.ts`, que ya atiende `plant_photos`), `src/registration/*.test.ts`, `src/components/ui/RegistrationPieces.test.tsx` y `src/lib/localDate.test.ts`. De extremo a extremo, `e2e/registro.spec.ts` (0, 1 y 6 fotos, con coincidencia y por validar, recarga con borrador, fallo de subida y reintento, 360 y 1440 px con axe) y `e2e/edicion.spec.ts` (quitar la principal y añadir). La parte de IndexedDB de `draft-photo.ts` solo se prueba sin IndexedDB disponible y en Chromium; el WebKit de Playwright es efímero y no guarda `Blob`; falta comprobarla en un iPhone y un Android reales (#89). `src/test/setup.ts` vacía `localStorage` después de cada prueba.

## Fotos: compresión en el navegador

`apps/web/src/photos/` prepara una foto antes de subirla (#81): la recodifica con canvas, la orienta, la reduce hasta los topes y genera su miniatura. No usa dependencias ni las transformaciones de imagen de Supabase (no están en el plan gratuito).

```ts
import { loadPhotoProcessing } from '../photos/load.ts'

const { processPhoto, PhotoProcessingError } = await loadPhotoProcessing()
const { photo, thumbnail } = await processPhoto(file, { signal })
// photo.blob, photo.type ('image/webp' | 'image/jpeg'), photo.width, photo.height,
// photo.bytes, photo.quality, photo.withinBudget; lo mismo en thumbnail.
// Error: PhotoProcessingError con reason 'empty' | 'not-an-image' | 'unsupported-format'
// | 'too-large' | 'decode-failed' | 'encode-failed' | 'unsupported-browser' | 'aborted'
// y message en español, listo para mostrar.
```

- **Carga diferida:** las pantallas solo importan `load.ts`; el resto va en un chunk propio que se descarga con la primera foto (y el service worker lo precachea).
- **Topes** (`DEFAULT_PHOTO_LIMITS` en `process.ts`): foto de 1600 px de lado mayor y menos de 300 000 bytes; miniatura de 400 px de lado mayor, sin recortar (la tarjeta la recorta con `object-fit: cover`, cuadrada en la lista y 4:3 en la cuadrícula) y menos de 30 000 bytes. La calidad empieza en 0,8 (0,75 la miniatura); si no cabe, prueba la mínima (0,5 y 0,45) y afina por bisección; si ni la mínima cabe, reduce las dimensiones. Como mucho 8 codificaciones por imagen; si no llega, devuelve la más ligera con `withinBudget: false`.
- **Entrada:** hasta 50 MB y 50 megapíxeles (un JPEG de 48 MP del iPhone cabe). El formato y el tamaño se leen de los primeros bytes, así que una imagen enorme se rechaza sin decodificarla. Se reduce por mitades, sin ningún lienzo mayor que la mitad del original (el tope de iOS es de 16,7 MP por lienzo).
- **Formato:** WebP donde el navegador lo codifica de verdad (Chrome, Edge, Firefox) y JPEG en Safari (macOS e iOS), que pide WebP y devuelve PNG sin avisar. Se averigua una vez por sesión codificando un lienzo de 2 × 2 y mirando el tipo y la firma del resultado, sin mirar el user agent.
- **Privacidad:** se devuelve siempre una imagen recodificada, nunca el archivo original, aunque ya sea pequeño. Al recodificar se pierden EXIF (cámara, fecha, GPS, miniatura embebida), XMP, IPTC y las imágenes adicionales (MPF). Cada resultado se inspecciona (`findMetadata()` en `metadata.ts`, sobre los bytes de JPEG y WebP); si llevara algo, se retira con `stripMetadata()` y se vuelve a comprobar. Solo queda el perfil de color ICC que escribe el navegador, que no identifica a nadie.
- **Orientación:** los navegadores actuales ya giran la foto según EXIF al decodificarla (`createImageBitmap`, Chrome 52, Firefox 93, Safari 15). Una prueba de una vez por sesión (un JPEG de 2 × 1 con orientación 6) lo confirma; solo si el navegador no gira, gira el módulo. Así nunca se gira dos veces.
- **Sin bloquear la interfaz:** `createImageBitmap` decodifica fuera del hilo principal, se dibuja en `OffscreenCanvas` donde existe y se cede el hilo entre pasos. Medido en Chrome 157 de escritorio (Mac): una foto de 12 MP tarda 180-400 ms con una sola tarea larga de unos 190 ms la primera vez y ninguna después; una de 48 MP, 360 ms con una tarea larga de 107 ms. No compensa un Web Worker.
- **Limitaciones por navegador:** HEIC solo lo abre Safari 17 o posterior; en Chrome, Edge, Firefox y Android da `unsupported-format` con un mensaje que lo explica. En el iPhone, al elegir de la galería con `accept="image/*"`, Safari entrega normalmente un JPEG (convierte el HEIC), según los informes de WebKit; falta comprobarlo en un iPhone real (#84). Safari siempre genera JPEG, algo más pesado que WebP a la misma calidad.
- **Prueba a mano:** fuera de producción, la sección "Fotos" de `/muestra` deja elegir una foto (o hacerla con la cámara en el celular) y muestra el original, el formato, las dimensiones, el peso y la calidad de la foto y la miniatura, los intentos, el tiempo y los metadatos que quedan. Es la que sirve para la prueba en iPhone y Android (#84).
- **Pruebas:** jsdom no tiene canvas, así que la lógica pura (tamaños, orientación, búsqueda de calidad, formato, metadatos, errores) se prueba directamente y la orquestación con un doble de la capa del navegador (`ImageBackend`). Los accesorios de `src/photos/fixtures/` son imágenes sintéticas de 48 × 32 px, entre ellas un JPEG con EXIF, GPS inventado y orientación 6, y un WebP con EXIF y XMP.

### Campo de foto y subida

El registro y la edición usan la galería desde el #221 (ver [Registro de una planta](#registro-de-una-planta) y `docs/piezas-de-interfaz.md`). `PhotoField` (`src/photos/PhotoField.tsx`, #82), el campo de una sola foto (elegir, vista previa, reemplazar y quitar), queda para la sección "Fotos" de `/muestra`, la de la prueba a mano en el iPhone y en Android (#84). Prepara la foto con el módulo anterior y la entrega ya preparada; no sube nada.

```tsx
import { PhotoField, type PhotoFieldValue } from '../photos/PhotoField.tsx'
import { uploadPhotoFiles } from '../photos/upload.ts'
import { usePhotoUpload } from '../photos/usePhotoUpload.ts'

const [foto, setFoto] = useState<PhotoFieldValue | null>(null)
// { kind: 'new', photo: ProcessedPhoto, fileName } | { kind: 'stored', src } | null
const subida = usePhotoUpload<PlantPhotoPaths>()

<PhotoField
  value={foto}
  onChange={(valor) => { subida.reset(); setFoto(valor) }}
  upload={subida.state}            // opcional: lo muestra con "Reintentar" y "Cancelar subida"
  onRetryUpload={() => void subida.retry()}
  onCancelUpload={subida.cancel}
/>

if (foto?.kind === 'new') {
  const files = foto.photo
  await subida.start(({ signal, onProgress }) =>
    uploadPhotoFiles(files, { userId, plantId, signal, onProgress }))
}
```

- **Cámara y galería:** en el celular, dos botones: "Tomar foto" abre un `<input type="file" accept="image/*" capture="environment">` y "Elegir de la galería", uno sin `capture`. Con `capture`, iOS y Android abren directamente la cámara trasera. Sin él, el iPhone muestra su menú (fototeca, hacer foto, elegir archivo), pero Chrome en Android 14 y 15 abre el selector de fotos del sistema, que muchas veces ya no ofrece la cámara; por eso hay un botón para cada cosa. Los navegadores de escritorio ignoran `capture` (es una pista, según MDN), así que donde el puntero principal no es táctil (`(pointer: coarse)` no se cumple) queda un solo botón, "Elegir foto". La prop `camera` (`'auto' | 'show' | 'hide'`) lo fuerza. La galería del registro sigue la misma regla, con `useTouchDevice` (puntero grueso o `maxTouchPoints`).
- **Estados:** preparando (con "Cancelar"), lista (con el peso) y error con el texto del motivo (formato no admitido, HEIC, no es una imagen, demasiado grande...). Los estados se anuncian en una región `role="status"` y los errores en `role="alert"`. Mientras se prepara o se sube, los botones quedan con `aria-disabled` en vez de `disabled`, para no perder el foco.
- **Foco:** al quitar la foto, o al cancelar o terminar cuando el botón con el foco desaparece, el foco vuelve al primer botón de elegir. Todo funciona con el teclado; los `<input type="file">` están ocultos, fuera del orden de tabulación y del árbol de accesibilidad, y los abren los botones.
- **Vista previa:** una URL de objeto de la foto preparada, que se revoca al cambiar de foto, al quitarla y al desmontar. La caja es de 4:3 fija, así que la vista previa no mueve nada al aparecer.

Subida (`src/photos/upload.ts`), sobre una interfaz mínima del bucket (`PhotoStorage`, en `storage.ts`), con un doble en memoria para las pruebas y la página de muestra (`memory-storage.ts`):

- **`uploadPhotoFiles(files, { userId, plantId, signal, onProgress })`:** sube la foto y la miniatura a la vez con la [convención de rutas](supabase/README.md#fotos-de-plantas-storage) (`src/photos/paths.ts`): `<usuario>/<planta>/photo-<versión>.<webp|jpg>` y `thumb-<versión>`, con una versión nueva (`crypto.randomUUID()`) por foto preparada y la misma en sus reintentos. El tipo de contenido es el del Blob (con un Blob, supabase-js envía un formulario y Storage toma el tipo de la parte del archivo, no de `contentType`) y la caché es de un año (`cacheControl: '31536000'`): las rutas llevan versión y nunca cambian de contenido. Sin `upsert`; si la ruta ya existe (409), se da por subida, porque solo puede ser un intento anterior de esta misma foto cuya respuesta se perdió. Si falla una de las dos, borra las dos rutas antes de rechazar. La usa `uploadPlantPhotos` para cada foto de la galería.
- **Progreso:** archivos y bytes terminados (`UploadProgress`); supabase-js no da el progreso de cada petición.
- **Cancelar:** supabase-js no deja abortar una subida (`upload` no acepta `AbortSignal`). Al cancelar se deja de esperar enseguida (rechaza con `aborted`) y, cuando terminan las peticiones en curso, se borra lo que haya llegado. El reintento usa otra versión para que ese borrado tardío no se lleve sus archivos.
- **Errores** (`PhotoStorageError`, con `reason` y `message` en español): `offline`, `session-ended`, `too-large` y `unsupported-type` (rechazo del bucket por el tope de 1 MiB o el tipo), `forbidden` (políticas), `not-found`, `too-many-photos`, `position-taken`, `failed` y `aborted`. Storage a veces responde 400 con el código real en `statusCode` (`"413"`, `"403"`); se mira ese también. `uncertain` indica que la petición salió y no hubo respuesta, así que no se sabe si se aplicó.
- **Reintentar sin volver a elegir ni preparar la foto:** `usePhotoUpload()` guarda la última tarea y `retry()` la vuelve a lanzar con la misma foto ya preparada. Con la sesión terminada o la planta borrada no se ofrece "Reintentar" (`canRetryUpload`).

`replacePlantPhoto` y `removePlantPhoto` (una foto por planta, escribiendo las rutas en `plants`) y `PlantPhotoRecords.setPhotoPaths` se retiraron en el #221: ya no los usaba nada. Las versiones de la app ya instaladas que aún escriben esas columnas siguen funcionando, porque la base lo refleja en la foto principal de `plant_photos`. En `/muestra`, sección "Fotos", el campo sube a un bucket simulado en memoria (la página no tiene sesión de Clerk ni usa Supabase), con las rutas reales y la opción de simular un fallo de red, de la miniatura o de tamaño para ver el reintento.

### Lectura de fotos y borrado sin huérfanos

El bucket es privado (#83): las imágenes no tienen una dirección pública. Hay dos formas de leerlas: URL firmadas (`createSignedUrls`, una petición firma muchas rutas) o descarga autenticada a `Blob` (`download`, con el token de la sesión). La app usa la **descarga autenticada, guardada por ruta**:

- Una URL firmada caduca y cambia en cada firma: el navegador la trata como otra dirección y la vuelve a bajar en cada sesión, y la caché sin conexión del #18 no puede usarla como clave. Firmar en lote ahorra una petición por imagen, pero las imágenes se bajan igual una a una.
- La ruta es una clave estable y su contenido nunca cambia (lleva la versión). Cada miniatura se baja una vez por dispositivo: queda en memoria mientras dura la pestaña y en **Cache Storage**, en una caché por usuario (`orki-miniaturas-v1:<usuario>`) con clave `/_orki/plant-photos/<ruta>` (una dirección del propio origen que nadie sirve). Desde la segunda visita, una lista de cientos de miniaturas no hace ninguna petición, y Cache Storage se lee sin red y también desde el service worker, que es lo que necesita el #18.
- Las descargas van como mucho de 6 en 6. Cada imagen se muestra con una URL de objeto que se revoca 30 s después de que ninguna pantalla la use (así no se recrea al desplazarse arriba y abajo).
- Al cambiar de usuario o cerrar sesión, `CollectionProvider` llama a `forgetPlantImagesExcept(usuario)`: vacía la memoria y borra de Cache Storage las miniaturas de los demás usuarios.

La estrategia vive en `src/photos/read.ts` detrás de `PlantImageSource` (`acquire(ruta, 'thumbnail' | 'photo')` devuelve una URL de objeto y `release(ruta)` la suelta) y de `PersistentImageCache`. Las pantallas solo usan los hooks de `src/photos/usePlantImage.ts`, así que el #18 puede cambiarla (por ejemplo, que el service worker sirva la caché) pasando otra fuente con `<PlantImagesContext value={...}>`, sin tocarlas:

```ts
const miniatura = usePlantImage(plant.thumbnailPath, 'thumbnail', visible)
const foto = usePlantImage(foto.photoPath, 'photo') // visor del detalle (#183), bajo demanda
// { status: 'none' | 'loading' | 'error' } o { status: 'ready', src }
```

- **Inventario:** `PlantCard` usa `usePlantThumbnail(plant, ref)` (`src/inventory/usePlantThumbnail.ts`), que pide solo `thumbnailPath`, nunca la foto grande, y solo cuando la tarjeta está en pantalla o a menos de 300 px (`useNearViewport`, con `IntersectionObserver`). Mientras carga o si falla, el marcador neutro del sistema, con un texto alternativo que lo dice ("Foto de _Cattleya labiata_: cargando"); la caja de la foto tiene proporción fija, así que la imagen no mueve nada al llegar. Tras un fallo se reintenta al volver la conexión (evento `online`) o al volver a montar la tarjeta: el fallo no se guarda. Las plantas sin foto siguen con "Sin foto".
- **Foto grande:** `usePlantImage(foto.photoPath, 'photo')` la baja bajo demanda, solo en el visor del detalle (#183), y la guarda solo en memoria (no ocupa Cache Storage). En la página del detalle se ven las miniaturas. La galería de la edición pide solo las miniaturas (`useStoredThumbnails`, con la misma fuente).

Sin huérfanos:

- **Quitar una foto de la galería** (`removeStoredPlantPhoto`) borra su fila y después sus dos archivos (ver [Varias fotos por planta](#varias-fotos-por-planta-api-de-datos)).
- **Eliminar una planta** (lo llamará el #16): `deletePlantWithPhotos({ userId, plantId, onPlantRemoved: removePlant })` (`src/photos/delete.ts`) borra primero la fila, la quita de la colección y después toda la carpeta `<usuario>/<planta>/` (`deletePlantPhotoFolder`, que también se lleva restos de subidas anteriores). Si falla el borrado de la planta no se toca nada; si fallan los archivos, la planta ya no existe y devuelve `photosDeleted: false`.
- **Script de limpieza:** un fallo de red a mitad puede dejar archivos sin planta. `npm run fotos:huerfanas -- --ambiente desarrollo` los lista (modo de prueba, por defecto) y con `--borrar` los borra; da por usado todo archivo que citen `plants` o `plant_photos`, así que no se lleva las fotos secundarias. Ver [su sección](supabase/README.md#limpieza-de-fotos-huérfanas) en el README de Supabase.
- **Varias fotos:** eliminar una planta o la cuenta borra también las fotos secundarias: están en la misma carpeta `<usuario>/<planta>/` y sus filas de `plant_photos` se van con la planta (`on delete cascade`). Lo prueban `src/photos/delete.test.ts`, `src/account/supabase-effects.test.ts` y `e2e/fotos-de-plantas.spec.ts`.

### Varias fotos por planta: API de datos

Desde el #182 una planta tiene de 0 a 6 fotos en `public.plant_photos` (ver [Varias fotos por planta](supabase/README.md#varias-fotos-por-planta) en el README de Supabase). El #219 dejó la capa de datos y el formulario con galería (#221) la usa al registrar y al editar. Las columnas `photo_path`, `thumbnail_path` y `photo_in_bloom` de `plants` siguen siendo la copia de la principal (la de `position` más baja), que la base mantiene en los dos sentidos: la tarjeta del inventario no cambia, y las versiones de la app ya instaladas que escriben en `plants` (el formulario de una foto, retirado en el #221) siguen funcionando, porque la base lo refleja en la principal.

Módulos (`src/photos/`), con la misma separación que la subida de una foto:

- `gallery.ts`: las operaciones (`uploadPlantPhotos`, `listPlantPhotos`, `removeStoredPlantPhoto` y, para el detalle (#183), `updatePlantPhoto`, `reorderPlantPhotos`, `orderWithMain`, `orderWithMove` y `checkPlantPhotoDetails`).
- `photo-rows.ts`: `PlantPhotoRows`, el acceso a `plant_photos` con PostgREST (`appPlantPhotoRows()`), `StoredPlantPhoto` (la fila con nombres de la app) y la traducción de errores (`photoRowError`). Tipos y alias de la tabla en `src/lib/database.ts` (`PlantPhoto`, `PlantPhotoInsert`, `PlantPhotoUpdate`).
- `memory-photo-rows.ts`: el doble en memoria con las reglas de la base (dueño, carpeta de las rutas, posiciones de 0 a 5 sin repetir, copia de la principal a la planta) y fallos a voluntad, también «después de aplicar». Lo usan las pruebas; sirve para la página de muestra.
- `MAX_PLANT_PHOTOS` (6) está en `paths.ts`.

| Función                                                                                            | Qué hace                                                                                                                                                                                                                                                                                                      | Errores                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uploadPlantPhotos(fotos, { userId, plantId, signal, onProgress, onPlantUpdated, storage, rows })` | Sube las fotos ya preparadas (`{ files, inBloom?, takenAt?, note? }`, con `files` = `ProcessedPhoto`) a una planta que ya existe, una detrás de otra y en el orden dado, y crea su fila con su `position`. Sirve para registrar y para añadir en la edición. Devuelve `{ results, photos, complete, plant }`. | Rechaza sin subir nada si no puede leer las fotos de la planta, si la señal ya está cancelada o si no caben (`too-many-photos`, contando las guardadas). Después resuelve siempre, con un resultado por foto: `uploaded` (`reused` si ya estaba), `failed` (con su `PhotoStorageError`) o `skipped` (cancelada antes de empezarla). |
| `listPlantPhotos({ userId, plantId, rows })`                                                       | Las fotos de la planta en orden (`StoredPlantPhoto[]`, la principal primero).                                                                                                                                                                                                                                 | `PhotoStorageError` (`offline`, `session-ended`...).                                                                                                                                                                                                                                                                                |
| `removeStoredPlantPhoto({ userId, plantId, photo, onPlantUpdated, storage, rows })`                | Quita una foto guardada: borra la fila (si era la principal, la base promueve la siguiente), relee la planta para la colección y borra sus dos archivos. Devuelve `{ photosDeleted, leftovers, plant }`.                                                                                                      | Si falla el borrado de la fila, rechaza y no toca los archivos. Si fallan los archivos, la foto ya no está y devuelve `photosDeleted: false` con las rutas en `leftovers` (para el script de limpieza).                                                                                                                             |
| `updatePlantPhoto({ userId, plantId, photo, main, changes, onPlantUpdated, rows })`                | Cambia `takenAt`, `note` o `inBloom` de una foto (solo las claves pasadas; la nota sin espacios a los lados, vacía `null`). Si cambia «en flor» de la principal (`main`), relee la planta. Devuelve `{ photo, plant }`.                                                                                       | Lo que no cumple las reglas (`checkPlantPhotoDetails`: fecha no posterior a hoy, nota de hasta 500 caracteres) rechaza con `failed` sin enviar nada; `not-found` si la foto ya no está; `offline`, `session-ended`.                                                                                                                 |
| `reorderPlantPhotos({ userId, plantId, photos, order, onPlantUpdated, rows })`                     | Pone las fotos en el orden `order` (los mismos ids; `orderWithMain` y `orderWithMove` lo calculan) de una vez: posiciones 0, 1, 2… Si cambia la principal, relee la planta. Mismo orden: no envía nada. Devuelve `{ photos, plant }`.                                                                         | `position-taken` si las fotos de la planta ya no son las leídas (hay que volver a leerlas); `offline`, `session-ended`, `failed`. Nunca deja la galería a medias.                                                                                                                                                                   |

- **Orden de cada foto: primero los dos archivos y después la fila.** Una fila sin archivo sería una foto rota (si es la principal, la base la copiaría a `plants` y la tarjeta no podría mostrarla); un archivo sin fila no lo ve nadie y lo recoge el script de limpieza pasadas 24 horas. Si falla un archivo, se borran los dos y no se crea la fila. Si la base rechaza la fila, se borran los dos archivos; si ese borrado también falla, quedan para el script. Si no se sabe si la fila llegó (`uncertain`, la red cayó sin respuesta), los archivos se quedan, porque quizá ya los cita: el reintento lo resuelve.
- **Reintento sin duplicados:** cada foto preparada tiene su versión fija (`photoVersionFor`), así que sus rutas son las mismas en cada intento. Antes de subir se leen las filas de la planta y una foto cuya ruta ya está en una fila se da por guardada (`reused: true`): no se sube ni se crea otra fila. Los archivos que ya estaban en el bucket los da por subidos el 409 de Storage. Se puede volver a llamar con todas las fotos o solo con las que fallaron.
- **Posiciones:** la de cada foto se decide en el primer intento y se recuerda (por la foto preparada, como la versión): reintentar la vuelve a usar si sigue libre, así una foto que falló a mitad del registro conserva su lugar. Una foto nueva va a la primera posición libre detrás de la última ocupada y, si al final ya no queda sitio, a la primera libre. Si otra foto (otro dispositivo) ocupa la posición entre la lectura y la escritura, la base responde `23505` (`position-taken`) y se prueba una vez con otra libre; si no queda ninguna, la foto falla con `too-many-photos` y sus archivos se borran.
- **Máximo de 6:** se comprueba antes de subir, contando las ya guardadas; lo garantiza además la base (`position` de 0 a 5 y única por planta).
- **Progreso** (`onProgress`): `{ index, completed, total, step }`, con `step` `uploading` (y `files`, el `UploadProgress` de sus dos archivos), `saving` (creando la fila) o `done` (y `result`).
- **Cancelar** (`signal`): la foto en curso deja de esperarse (lo que llegue a subirse se borra al terminar, como en `uploadPhotoFiles`) y queda `failed` con `aborted`; las siguientes, `skipped`. Una fila que ya salió hacia la base se espera. El reintento usa otra versión para la cancelada y la misma posición.
- **La planta de la colección:** la base copia la principal a `plants`, pero la planta en memoria no se entera. Si la principal o el número de fotos cambian (al subir fotos o al quitar una), se relee la planta y se pasa a `onPlantUpdated` (conéctalo con `useCollection().upsertPlant`); así `photoCount` sigue al día (#184). Si esa lectura falla no es un error: la base ya está bien y la colección lo verá en la próxima lectura.
- **Leer las imágenes:** con las rutas de cada `StoredPlantPhoto`, con los mismos hooks y la misma caché que el resto (`usePlantImage(foto.thumbnailPath, 'thumbnail')` para la cuadrícula y `usePlantImage(foto.photoPath, 'photo')` para verla en grande).
- **Reordenar va por una función de la base** (`reorder_plant_photos`, migración `20261124100000_reordenar_fotos.sql`): la unicidad de `(plant_id, position)` es diferible y con seis fotos no queda ninguna posición libre de paso, así que elegir la principal o mover una foto se hace en una sola sentencia. Recibe los ids de todas las fotos en el orden nuevo; solo el dueño; una lista que no sea exactamente la de la planta se rechaza.
- **Errores nuevos de `PhotoStorageError`:** `too-many-photos` («Una planta puede tener como mucho 6 fotos…», sin «Reintentar»: `canRetryUpload` lo excluye) y `position-taken`, que la galería resuelve sola o traduce a `too-many-photos`.

Registrar una planta con N fotos (#221), con la planta ya insertada como hoy:

```ts
import { uploadPlantPhotos } from '../photos/gallery.ts'

// fotos: las de la galería en su orden, ya preparadas (ProcessedPhoto)
const fotos = galeria.map(({ photo, inBloom }) => ({ files: photo, inBloom }))
const tarea = ({ signal, onProgress }) =>
  uploadPlantPhotos(fotos, {
    userId,
    plantId,
    signal,
    onProgress,
    onPlantUpdated: upsertPlant,
  })

const { results, complete } = await tarea({ signal, onProgress })
if (!complete) {
  // La planta y las fotos guardadas se conservan. Mostrar cuáles fallaron
  // (results[i].status === 'failed', con results[i].error.message) y ofrecer
  // "Reintentar", que vuelve a llamar con las mismas fotos: no duplica nada.
  const faltan = fotos.filter((_, i) => results[i].status !== 'uploaded')
  await uploadPlantPhotos(faltan, {
    userId,
    plantId,
    onPlantUpdated: upsertPlant,
  })
}
```

Editar la galería de una planta ya guardada:

```ts
import {
  listPlantPhotos,
  removeStoredPlantPhoto,
  uploadPlantPhotos,
} from '../photos/gallery.ts'

const guardadas = await listPlantPhotos({ userId, plantId }) // en orden; la primera es la principal

// Quitar una (si es la principal, pasa a serlo la siguiente)
const { photosDeleted } = await removeStoredPlantPhoto({
  userId,
  plantId,
  photo: guardadas[0],
  onPlantUpdated: upsertPlant,
})

// Añadir: van detrás de las que ya tiene; 'too-many-photos' si no caben
await uploadPlantPhotos(
  nuevas.map((photo) => ({ files: photo })),
  { userId, plantId, onPlantUpdated: upsertPlant },
)
```

Pruebas: `src/photos/gallery.test.ts` (0, 1 y 6 fotos, la séptima, fallo de un archivo, rechazo de la fila, limpieza que también falla, reintento con la fila perdida o llegada, cancelación, posición ocupada, añadir, leer en orden, quitar la principal y los fallos al quitar) y `src/photos/photo-rows.test.ts` (consultas y errores de PostgREST). Sin comprobar contra Supabase y Storage reales: lo que la base hace con las filas lo prueban `supabase/tests/fotos_de_plantas.sql` y el Supabase simulado de las pruebas de extremo a extremo.

## Eliminación de la cuenta

`/cuenta`, «Tu cuenta» (#110, parte de #26; rediseño del #214), exige sesión y se abre desde «Mi cuenta» del menú «Tu cuenta» de la barra. Bajo «Volver a Mi colección» y el título, tres paneles (`Panel`, ver `docs/piezas-de-interfaz.md`) y «Cerrar sesión» debajo (`src/pages/AccountPage.tsx`, que conecta Clerk y la colección, y `src/account/AccountView.tsx`, el contenido sin Clerk ni Supabase):

- **Perfil:** foto, nombre y correo principal de Clerk (`ProfileSummary`); sin foto, las iniciales; sin nombre, el correo como identificación y el icono de perfil. «Editar perfil» (al lado en escritorio, debajo y a todo el ancho en el celular) abre el editor de perfil de Clerk (`useProfileEditor`, `src/auth/profile-editor.ts`), al que se le oculta su propio "Eliminar cuenta" (elemento `profileSection__danger`): borraría solo el usuario de Clerk y dejaría los datos sin dueño. Al cerrarlo, los datos nuevos se ven sin recargar (`useUser()` es reactivo).
- **Datos y privacidad:** «Exportar inventario a CSV» («El archivo CSV no incluye las fotos.») es la misma exportación de «Mi colección» (#17): las dos usan `useInventoryExport` (`src/inventory/useInventoryExport.ts`) con la colección compartida (`useCollection`), con los mismos errores y, sin plantas, el archivo solo con la cabecera. Sin conexión usa la copia local. Mientras la colección carga, o si falla sin datos, la fila queda deshabilitada con el motivo (y, tras un fallo, «Volver a cargar la colección»). «Aviso de privacidad» abre `/privacidad` con el origen `cuenta` («Volver a Tu cuenta»).
- **Eliminar cuenta** (en tono de peligro): «Se eliminarán tu cuenta, tus plantas y sus fotos. Esta acción es irreversible.» y «Eliminar mi cuenta» (con borde), que abre la confirmación descrita abajo (con relleno solo en la confirmación final).
- **Cerrar sesión:** fuera del panel de peligro, con el cierre propio de la app (`useSignOutHere`, el mismo del menú, también sin conexión).
- **Sin conexión o con la sesión sin confirmar:** la pantalla se abre igual. Si Clerk no tiene usuario, el perfil queda neutro (icono de perfil) con la explicación; «Editar perfil» y la eliminación quedan deshabilitados con su motivo (asociado con `aria-describedby`), y exportar, la privacidad y cerrar sesión siguen funcionando.

**Orden del borrado**, sin backend, con el token de la sesión y las políticas que ya dejan a cada usuario borrar lo suyo (`src/account/deletion.ts`, una función pura con los efectos inyectados):

| Paso                                                                                                  | Si falla                                                                                                       |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1. Fotos: todo lo que hay bajo `<usuario>/` en el bucket, listado carpeta por carpeta y de 100 en 100 | No se borró nada más.                                                                                          |
| 2. Plantas: `delete from plants where user_id = <usuario>`                                            | Las fotos ya no están; las plantas, el perfil y la cuenta siguen.                                              |
| 3. Perfil: `delete from profiles where id = <usuario>`                                                | Fotos y plantas borradas; perfil y cuenta siguen.                                                              |
| 4. Cuenta de Clerk: `user.delete()` dentro de `useReverification()`                                   | Los datos ya se borraron y la cuenta sigue, vacía. Se dice por qué (sin permiso, verificación cancelada, red). |

- Los datos van antes que la cuenta porque, una vez borrada la cuenta de Clerk, su token deja de servir y la app ya no puede borrar nada en Supabase. Entre `plants` y `profiles` no hay clave foránea.
- Si un paso falla, los siguientes no se ejecutan; el diálogo explica qué falló, por qué y qué quedó, y "Volver a intentarlo" sigue desde ese paso. Todos los pasos son idempotentes (borrar lo que ya no está no da error), así que repetir desde el principio también termina.
- Antes de empezar se mira `user.deleteSelfEnabled`: si Clerk no deja eliminar la cuenta (el ajuste del #109 sin activar), el botón está deshabilitado con el motivo y no se borra nada.
- **Perfil sin recrear:** antes del paso 1 se guarda una marca en `localStorage` (`orki:cuenta:eliminacion:<usuario>`, `src/lib/account-deletion-marker.ts`) y `ensureProfile()` no crea el perfil mientras existe. Sin ella, una recarga o la vuelta de la conexión entre los pasos 3 y 4 lo volverían a crear. Si la eliminación queda a medias, `/cuenta` lo dice y ofrece "Continuar la eliminación" o "Seguir usando Orki" (quita la marca y vuelve a crear el perfil).
- **Eventos de uso:** al poner la marca, `ProductEventsSync` deja de dar sesión a los eventos de producto (#146) y, antes del paso 1, `discardProductEvents()` (`src/telemetry/product-events.ts`) borra la cola de `orki-eventos` y espera a que termine un envío en curso. En la base, los eventos se borran con el perfil (disparador de la migración `20261121170000_eventos_de_producto.sql`); uno enviado después quedaría sin dueño. Si la persona elige "Seguir usando Orki", los eventos vuelven.
- **Dispositivo** (`src/account/device-cleanup.ts`, con la lista de lo que guarda la app y quién lo borra): con los datos ya borrados se limpia el borrador del registro (texto en `localStorage` y foto en IndexedDB `orki-registro`), las preferencias del inventario, las miniaturas de Cache Storage (`orki-miniaturas-v1:<usuario>`), las imágenes en memoria y cualquier clave `orki:` con el id del usuario en `localStorage` o `sessionStorage`, y se relee la colección. Con la cuenta de Clerk ya eliminada, otra vez lo mismo, la marca, y el **cierre de sesión de la app** (`markSignedOut`, el del botón "Cerrar sesión", ver `docs/sin-conexion.md`): la app deja de tratar al usuario como con sesión aunque Clerk tarde en saberlo, y borra la copia sin conexión (`orki-coleccion`), las miniaturas, el usuario recordado (`orki-ultimo-usuario`) y las colas de eventos. El precache del service worker no se toca.
- **Final:** `setActive({ session: null })`, como hace el `<UserProfile>` de Clerk (si falla, `PendingSignOut` cierra la sesión de Clerk), y vuelta al inicio con "Tu cuenta se eliminó…" en una región `role="status"`. `AccountDeletionGate` (por encima de `RequireAuth` en `/cuenta`, y mirando la sesión de la app, `useAppIdentity`) evita que, al caer la sesión, se mande al inicio de sesión.
- **Confirmación:** diálogo modal propio (`src/account/DeleteAccountDialog.tsx`, sobre la base común `Modal`) que explica qué se borra y que no se puede deshacer; el botón (variante `danger`) no se habilita hasta escribir "ELIMINAR". Foco atrapado, Escape cancela (no mientras se borra), el foco vuelve al botón que lo abrió y el resto de la página queda `inert`. Cada paso se anuncia en una región `role="status"` ("Paso 2 de 4: borrando tus plantas…"); los fallos, en `role="alert"`. Sin doble envío; mientras borra no hay "Cancelar" y salir de la página pide confirmación al navegador (`beforeunload`).
- **Solo lectura** (`useReadOnly`, #120): sin conexión, o con la sesión sin confirmar, el botón queda deshabilitado con el motivo. Con la sesión sin confirmar, `RequireAuth` deja abrir `/cuenta` pero Clerk no tiene usuario: la pantalla se abre con el perfil neutro y explica que para eliminar hace falta la sesión confirmada.
- **Sentry:** la eliminación no reporta nada; `start()` nunca rechaza, así que ningún fallo acaba como error sin capturar. Del usuario, Sentry solo recibe el id de Clerk (`ObservedUser`), que pasa a nulo al cerrarse la sesión. Los eventos de error que ya se enviaron antes llevan ese id y no se borran desde la app.
- **Lo comprobado en Clerk** (21 de noviembre de 2026, detalle y fuentes en `src/account/clerk-deletion.ts`): `user.delete()` y `user.deleteSelfEnabled` existen en los tipos de `@clerk/shared`; eliminar la cuenta pide reverificación por defecto (ventana de 10 minutos, [guía](https://clerk.com/docs/guides/secure/reverification)); cerrar la ventana de verificación rechaza con `reverification_cancelled`. **Sin comprobar** (nada se probó contra Clerk ni Supabase reales): el error exacto con el ajuste desactivado (se supone un 403) y que la sesión desaparezca sola tras `user.delete()`.
- **Exportar antes:** el panel «Datos y privacidad», justo encima, exporta el inventario a CSV (#17), igual que al final de «Mi colección».
- **Pendiente:** lo que no pueda borrar la app (por ejemplo, una cuenta eliminada desde el panel de Clerk) lo detectará el script del #112.
- **Pruebas:** `src/account/*.test.ts(x)` (orquestadora con cada fallo, efectos de Supabase con un cliente simulado, errores de Clerk, limpieza del dispositivo, diálogo con teclado y axe; `AccountDeletionDevice.test.tsx`, de punta a punta con la copia, la cola de eventos y la foto del borrador en IndexedDB, que no queda nada y que no sale ningún evento), `src/telemetry/*.test.ts(x)` (la cola se vacía y no registra durante la eliminación), `src/lib/profile.test.ts` (la marca) y `src/pages/AccountPage.test.tsx` (con el doble de Clerk y una colección simulada: de `/cuenta` al inicio, perfil con y sin foto o nombre, «Editar perfil» y sus cambios sin recargar, exportar con y sin plantas, con error y sin conexión, privacidad con su origen, cancelar, eliminación a medias, cerrar sesión, sin conexión y con la sesión sin confirmar, con axe). De extremo a extremo, `e2e/cuenta.spec.ts`. En `/muestra`, sección "Pantalla de cuenta", se ve con pasos simulados y se elige cuál falla.

## Página de privacidad

`/privacidad` (#111, parte de #26) es pública: se abre sin sesión y aunque Clerk no cargue. Se enlaza desde el pie (`SiteFooter`, en la portada y en el resto de la app), desde las pantallas de acceso (junto al formulario), desde `/cuenta` y desde el mensaje de error de la eliminación cuando Clerk no la permite. Va en su propio chunk (`src/privacy/PrivacyPage.tsx`, cargado de forma diferida desde `App.tsx`), sin Clerk.

Con el #202 usa la página de texto del design system (`src/components/TextPage.tsx`): enlace de volver, título, frase de apoyo, fecha, índice «En esta página» y secciones con una frase de resumen. Siguiendo el #194, el índice lleva cuatro secciones y el texto aprobado va dentro, íntegro: «Qué datos guardamos» (con las subsecciones «Mediciones de uso y errores» y «Dónde se guardan y quién los procesa»), «Quién puede verlos» (su resumen dice, junto a la regla general, que el equipo del catálogo puede revisar el nombre y las fotos de una planta por validar), «Qué se guarda en tu dispositivo» y «Cómo eliminar tu cuenta» (con un enlace a «Tu cuenta» y la subsección «Descargar tu inventario»); «Contacto» cierra la página, fuera del índice. La atribución del catálogo pasó a [Créditos y fuentes](#créditos-y-fuentes), enlazada desde «Dónde se guardan…».

- **Volver:** según el estado de navegación del enlace que trajo a la página (`src/routes/text-page-origin.ts`, no `document.referrer`): «Volver al inicio» (por defecto, también al abrir la dirección directamente), «Volver al registro» (desde «Crear cuenta»), «Volver a Mi colección» (desde el pie de las pantallas con sesión) o «Volver a Tu cuenta» (desde `/cuenta`). Para enlazar desde otra pantalla: `privacyLinkProps(origen)` o `textPageState(origen)`.
- **Índice:** cada enlace apunta al id del título de su sección; al activarlo, el foco pasa a ese título (que lleva `scroll-margin-top`), sin desplazamiento animado, y el `#id` se escribe en la dirección sin perder el estado de volver.

**Texto revisado y aprobado por el responsable del proyecto el 22 de noviembre de 2026.** Lo redactó un agente comprobándolo contra el código el 21 de noviembre de 2026. No es asesoría legal y no lo ha revisado nadie con criterio legal (ley peruana de protección de datos personales); sigue siendo conveniente. La página no lo dice; lo dicen este README y el comentario de `PrivacyPage.tsx`.

Contacto: `src/privacy/contact.ts`, constante `PRIVACY_CONTACT` (el correo que indicó el responsable). Si se deja vacía o con el marcador `CONTACTO_PENDIENTE`, la página dice que aún no hay un medio de contacto publicado.

Afirmaciones que debe verificar una persona (revisadas contra el código el 21 de noviembre de 2026, tras el modo sin conexión, los eventos de uso, Sentry, la cola de propuestas y la exportación):

1. Clerk recibe, si se entra con Google, datos del perfil de Google «como tu nombre y tu foto» (depende de los permisos que pida la instancia de Clerk).
2. Proveedores: Clerk (acceso), Supabase (base de datos, fotos y eventos de uso), Sentry (errores) y Vercel (alojamiento). No dice en qué países guardan los datos, cuánto tiempo los conservan ni qué registros técnicos (por ejemplo, direcciones IP) guardan por su cuenta: conviene revisarlo en sus condiciones y decidir si se menciona.
3. Eventos de uso (`src/telemetry/events.ts`, migración `20261121170000_eventos_de_producto.sql`): registro completado (duración, con foto, nombre por validar) y búsqueda «¿Ya la tengo?» (duración y resultado); los dos con el id de Clerk (lo pone la base), la hora y si se generó sin conexión. Sin textos. Nadie los lee por la API: solo el dueño de la base y la clave de servicio. Objetivos citados: registrar en menos de 1 minuto y responder en menos de 5 segundos (`docs/specification.md`).
4. Sentry (`src/observability/`): solo errores (no hay trazas de rendimiento ni grabación de sesión). Lo que se quita y lo que queda está en `privacy.ts` y `sentry-options.ts`. La página menciona además las sesiones de «release health» que manda la integración por defecto `BrowserSession` (no se quita en `sentry-options.ts`): un aviso al abrir la app con la versión, el navegador y el id del usuario. Si no se quieren, hay que quitar esa integración y cambiar el texto.
5. «En orqui.app no hay publicidad ni otros servicios de analítica o de publicidad»: en las dependencias y en `index.html` no hay nada más que Clerk, Supabase y Sentry. Que no se venden datos es una decisión del responsable, no algo que se pueda comprobar en el código: la página no lo dice.
6. Quién ve qué: cada usuario solo sus plantas; un administrador del catálogo ve cuántas plantas hay por especie (`count_species_plants`) y la cola de propuestas (`list_proposal_groups`, migración `20261121180000_cola_de_propuestas.sql`): por grupo de nombre normalizado y género, la forma más frecuente del nombre tal como se escribió, el género, el tipo más frecuente, el número de plantas y hasta seis fotos (#184, migración `20261124090000_varias_fotos_cola_y_recuento.sql`; puede abrir todas las fotos de las plantas por validar, no solo la principal, y ninguna de las demás; las rutas llevan el id del usuario; la pantalla no lo muestra). La auditoría de una resolución guarda el nombre propuesto, el género y el número de plantas, sin ids de usuario ni rutas, y no se borra.
7. Lo que se guarda en el dispositivo y cuándo se borra (`docs/sin-conexion.md` y `src/account/device-cleanup.ts`): copia del inventario, miniaturas, cola de eventos (29 días como mucho) y id del último usuario se borran al cerrar sesión, también sin conexión; el id se guarda hasta avisar a Clerk si se cerró sin conexión; el borrador (texto y foto) caduca a las 24 horas y no se borra al cerrar sesión; las preferencias tampoco.
8. Exportación (`src/collection/export-csv.ts`, `src/inventory/useInventoryExport.ts`): al final de «Mi colección» y en «Tu cuenta», todas las plantas con todas sus columnas, sin fotos.
9. Eliminación (sección «Eliminación de la cuenta»): lo que borra, y que no se borran los informes ya enviados a Sentry ni la auditoría del catálogo.
10. La atribución del Catalogue of Life (versión, DOI y licencia CC BY 4.0, leídos de `scripts/catalog-import/fuente.json`) y la frase «En orqui.app se filtró a las orquídeas y se normalizó», hoy en [Créditos y fuentes](#créditos-y-fuentes). `FUENTE.md` propone mencionar también la WCVP de Kew; no está en el texto.
11. La fecha de última actualización (`PRIVACY_LAST_UPDATED`) se cambia a mano con cada revisión del texto. Pasó al 22 de noviembre de 2026 con el #202 (atribución trasladada, secciones reagrupadas y frases de resumen).

Pruebas: `src/privacy/PrivacyPage.test.tsx` (sin sesión y con Clerk caído, encabezados en orden, índice y foco, cada enlace de volver, que no falta ninguna frase del texto aprobado, reparto en secciones, contacto, enlaces desde el pie y desde el acceso, axe) y `e2e/paginas-de-texto.spec.ts` (a 360 px y en escritorio, con axe).

## Créditos y fuentes

`/creditos` (#203) es pública, con el mismo diseño que la privacidad (`TextPage`), en su propio chunk (`src/credits/CreditsPage.tsx`) y sin Clerk. Se enlaza desde el pie y desde la privacidad, y su enlace de volver sigue la misma regla. Cada dato está comprobado en el repositorio:

- **Catálogo:** el Catalogue of Life con su versión, DOI y licencia (CC BY 4.0), leídos de `scripts/catalog-import/fuente.json` por `src/backoffice/attribution.ts`, y la indicación de que se filtró a las orquídeas y se normalizó; los híbridos de vivero, de la lista curada (`scripts/catalog-import/data/hibridos.csv`).
- **Imágenes:** la foto de la portada y los fondos por género del registro, generadas con IA (OpenAI) a petición del autor del proyecto (`LEEME.md` de `src/assets/portada/` y `src/assets/fondos-genero/`). Solo su origen, nada sobre sus derechos.
- **Tipografías:** Playfair Display e Inter, SIL Open Font License 1.1 (el `LICENSE` de cada paquete `@fontsource`).
- **Iconos:** Lucide, licencia ISC; los derivados de Feather, MIT (el `LICENSE` de `lucide-react`).

Las fotos de referencia (#234) tienen su apartado: vienen de iNaturalist, cada una con su autor y su licencia junto a la foto, las cuatro licencias aceptadas con su texto legal y que las versiones reducidas de fotos CC BY-SA se comparten con esa misma licencia. Pruebas: `src/credits/CreditsPage.test.tsx` y `e2e/paginas-de-texto.spec.ts`.

## Pruebas de extremo a extremo

Los flujos principales de la Fase 1 (#148) se prueban con [Playwright](https://playwright.dev) en un navegador real: acceso, registro (con y sin foto, y con un nombre por validar), inventario (lista, cuadrícula, búsqueda y filtros), «¿Ya la tengo?», edición y baja, backoffice del catálogo y la PWA (manifiesto, service worker y arranque sin conexión). Cada pantalla recorrida pasa además por [axe](https://github.com/dequelabs/axe-core) con las reglas de nivel A y AA de WCAG 2.0, 2.1 y 2.2; la app no tiene tema oscuro, así que se revisa solo el claro. Lo que axe no ve se prueba aparte: `e2e/foco-no-tapado.spec.ts` comprueba, con el tabulador en una pantalla de celular, que las acciones fijas del formulario de registro y edición no tapan el control con el foco (WCAG 2.4.11, #151; la barra se marca con `data-barra-inferior` y `src/index.css` deja ese margen con `scroll-padding`) y que el inventario sigue sin barras fijas (#208).

`e2e/portada.spec.ts` revisa la portada a 360 px (una columna, logotipo centrado, sin desplazamiento horizontal, acciones y enlaces del pie de al menos 44 px, foto 2:1) y en escritorio a 1536 px (dos columnas, foto a toda la altura hasta el borde, ventajas en fila y enlaces del pie a la derecha), las dos con axe.

`e2e/barra.spec.ts` revisa la barra de la app y el menú «Tu cuenta» (#207) a 1440 y 360 px, con el menú abierto y axe: sin desplazamiento horizontal, objetivos de 44 px, teclado, la opción de administración solo con el rol y una cuenta sin nombre.

`e2e/cuenta.spec.ts` revisa «Tu cuenta» (#214) a 1440 y 360 px con axe: se abre desde el menú, «Editar perfil» abre el editor (el del Clerk simulado) y el nombre nuevo se ve sin recargar, el CSV descargado es idéntico al de «Mi colección», la privacidad ofrece «Volver a Tu cuenta», cancelar la eliminación devuelve el foco al botón, «Volver a Mi colección» y «Cerrar sesión», sin desplazamiento horizontal y con objetivos de 44 px; y una cuenta sin nombre.

Corren en cuatro perfiles: Chromium, Firefox y WebKit de escritorio, y `celular`, un iPhone 15 (WebKit, pantalla pequeña y táctil). Las pruebas están en `apps/web/e2e/` y la configuración en `apps/web/playwright.config.ts`.

### Lanzarlas en local

```sh
npx --workspace=apps/web playwright install    # una vez (y al actualizar @playwright/test): descarga los navegadores
npm run test:e2e                                # construye la app de las pruebas y ejecuta todo
npm run test:e2e:sin-build -- --project=webkit  # sin volver a construir, un solo perfil
npm run test:e2e:sin-build -- e2e/registro.spec.ts --headed   # un archivo, viendo el navegador
npm run test:e2e:sin-build -- --ui              # modo interactivo de Playwright
```

En Linux, la primera vez hace falta `npx playwright install --with-deps` (instala también las bibliotecas del sistema). Al terminar, `npx playwright show-report apps/web/playwright-report` abre el informe; de cada prueba que falla quedan en `apps/web/test-results/` la captura, el vídeo y la traza (`npx playwright show-trace <ruta de trace.zip>`). No hace falta ninguna variable de entorno ni conexión con Clerk, Supabase o Sentry.

### Qué se prueba y qué se simula

- **La app es la de producción.** `npm run build:e2e` construye `apps/web` con los valores ficticios de `scripts/medicion/entorno.mjs` (los mismos que el presupuesto de tamaño) y con un solo módulo cambiado al construir: `@clerk/react`, por `apps/web/medicion/clerk-simulado.tsx` (ver `apps/web/medicion/vite.config.e2e.ts` y `apps/web/medicion/sustitutos.ts`, compartido con la medición de la carga). Clerk descarga su script de su CDN y habla con su API, así que no se puede simular en la red; el sustituto da la sesión que elige cada prueba (sin sesión, la persona de prueba o una con el rol `catalog_admin`) y sus pantallas de acceso son un botón que inicia la sesión. Nada de esto llega a `apps/web/dist`. Se sirve con el servidor de la medición (`scripts/servir-e2e.mjs`), como Vercel: cualquier ruta responde con `index.html`.
- **Supabase se simula en la red**, no en el código: el cliente de supabase-js de la app hace sus peticiones de verdad hacia `https://supabase.orki.invalid` y Playwright las responde desde la memoria de cada prueba (`apps/web/e2e/soporte/supabase-simulado.ts`), con la forma de PostgREST y de Storage, las reglas de las políticas (cada persona ve y escribe sus plantas; el backoffice, solo `catalog_admin`) y lo que hacen los disparadores de `plants`. Simula también `plant_photos` (#219), para probar el formulario con galería: cada persona solo sus fotos, el dueño de la foto es el de la planta, rutas en `<usuario>/<planta>/`, `position` de 0 a 5 y única por planta (`23505`), solo las columnas que la API deja cambiar, la cascada al borrar la planta y la sincronización en los dos sentidos con las columnas de foto de `plants` (también lo que escribe en `plants` el formulario de una foto). Una prueba que pone la foto directamente en `datos.plantas` la ve como principal en `plant_photos`, como tras la copia de la migración; `supabase.fotosDe(planta)` devuelve sus fotos en orden. Lo prueba `e2e/fotos-de-plantas.spec.ts`, que incluye eliminar desde la app una planta con varias fotos. Así se ejercita el código de la app que arma las consultas, interpreta las respuestas, sube y descarga las fotos y traduce los errores. Los datos de partida están en `apps/web/e2e/soporte/datos.ts`.
- **La red está cerrada.** Solo pasa el origen de la app. Una petición a Supabase que el simulado no conoce, cualquier salida a otro dominio o un error que la app envíe a Sentry (el DSN ficticio, que se responde sin salir) hacen fallar la prueba.
- **Cada prueba es independiente:** contexto de navegador nuevo (almacenamiento vacío) y su propio Supabase simulado. El service worker está bloqueado salvo en las pruebas de la PWA (`apps/web/e2e/pwa.spec.ts`), que lo registran de verdad.

Límites: no se prueba la interfaz real de Clerk (inicio de sesión con Google o correo), ni Supabase o Storage reales, ni Sentry. En Firefox, el modo sin conexión de Playwright no deja responder al service worker, así que la prueba del arranque sin conexión corta el servidor de la app en su lugar; y la del inventario sin conexión solo corre en Chromium, porque en los demás motores Playwright no intercepta la red de una página que controla un service worker.

En Firefox no se pasa axe (#170): el Firefox de Playwright cerraba la pestaña («Page crashed») de forma intermitente mientras axe recorría la página. Las pautas que comprueba axe no dependen del motor y se revisan en los otros tres perfiles; el resto de cada prueba sí corre en Firefox.

### A mano, contra el ambiente de desarrollo

Estas pruebas dependen de los datos simulados y no se lanzan contra el ambiente de desarrollo: allí la sesión es la de Clerk de verdad y en el CI haría falta un secreto de sesión, que a propósito no existe (#25). Para repasar los mismos flujos en desarrollo, a mano y con un usuario de prueba de la instancia de desarrollo de Clerk:

1. Abre la URL de desarrollo con el generador de Playwright, que deja un navegador limpio y anota cada paso: `npx --workspace=apps/web playwright codegen <URL de desarrollo>` (o, sin Playwright, una ventana privada).
2. Recorre los flujos en el orden de `apps/web/e2e/`: acceso y vuelta a la página pedida, registro con especie, registro con foto y nombre por validar, inventario en lista y cuadrícula con búsqueda y filtros, «¿Ya la tengo?», edición, baja y eliminación, y backoffice con un usuario con el rol de administrador (ver [Rol de administrador del catálogo](#rol-de-administrador-del-catálogo)).
3. Borra después lo que hayas creado (`npm run db:seed:plants -- <id de usuario> --borrar` quita las plantas de ejemplo).

No guardes el estado de la sesión (`--save-storage`) dentro del repositorio: lleva el token de Clerk.

### En el CI

Las pruebas de extremo a extremo corren en `.github/workflows/ci.yml` como cuatro jobs en paralelo, uno por perfil (**Pruebas de extremo a extremo (chromium)**, **(firefox)**, **(webkit)** y **(celular)**), a la vez que los demás jobs: cada uno instala solo su navegador (en caché por versión de Playwright y navegador; el perfil de celular usa WebKit), construye la app de las pruebas y ejecuta su perfil, con un reintento por prueba (una prueba que pasa a la segunda queda marcada como inestable en el informe). Que un perfil falle no cancela los demás. No usan secretos. Si uno falla, sube como artefacto `informe-playwright-<perfil>` el informe HTML y las trazas. Por ahora no son obligatorios para fusionar; la propuesta es exigirlos cuando lleven dos semanas estables.

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

Los workflows manuales de carga usan además `SUPABASE_POOLER_HOST` (variable de cada environment, «Importar catálogo» y «Fotos de referencia») y `SUPABASE_SECRET_KEY` (secreto de cada environment, solo «Fotos de referencia»); ver sus secciones abajo.

### Importación del catálogo

El catálogo de especies (Catalogue of Life) se carga con `orki-catalogo cargar` de `scripts/catalog-import/`, después de aplicar las migraciones. En desarrollo se puede cargar desde tu máquina o con el workflow; en producción, solo con el workflow manual `.github/workflows/importar-catalogo.yml` (Actions > Importar catálogo), que simula por defecto, exige escribir el identificador del proyecto para escribir en producción y deja el reporte como artefacto. Usa `SUPABASE_DB_PASSWORD` y `SUPABASE_PROJECT_REF` del environment y además la variable `SUPABASE_POOLER_HOST`, que hay que crear en cada environment. La guía completa (pasos por ambiente, cómo leer el reporte y qué hacer con una versión nueva de la fuente) está en [Ejecución por ambiente](scripts/catalog-import/README.md#ejecución-por-ambiente).

### Fotos de referencia

Las fotos de referencia de las especies (iNaturalist, #234) se cargan con `orki-catalogo cargar-fotos-inaturalist`. En producción, solo con el workflow manual `.github/workflows/fotos-de-referencia.yml` (Actions > Fotos de referencia), desde `main` y con el environment `prod`: simula por defecto, elige el alcance (por defecto el de la orden, unos géneros, un tope de especies o todo el catálogo), puede listar o borrar después los archivos que sobran en el bucket, guarda entre ejecuciones la caché de iNaturalist para reanudar una carga cortada y deja el reporte como artefacto. Usa los mismos `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` y `SUPABASE_POOLER_HOST` que la importación y además el secreto `SUPABASE_SECRET_KEY` de cada environment (la clave secreta de cada proyecto), que hay que crear. La guía (entradas, duración por alcance, cómo reanudar) está en [Con el workflow](scripts/catalog-import/README.md#con-el-workflow).

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

Las variables de la app (ver [Variables de entorno de la app](#variables-de-entorno-de-la-app)) se definen en Settings > Environment Variables, con un valor distinto según el ambiente de Vercel:

| Ambiente de Vercel | `VITE_SUPABASE_URL`            | `VITE_SUPABASE_PUBLISHABLE_KEY`             | `VITE_APP_ENV` | `VITE_CLERK_PUBLISHABLE_KEY`                     |
| ------------------ | ------------------------------ | ------------------------------------------- | -------------- | ------------------------------------------------ |
| Production         | URL del proyecto de producción | Clave publicable del proyecto de producción | `prod`         | Clave de la instancia de producción (`pk_live_`) |
| Preview            | URL del proyecto de desarrollo | Clave publicable del proyecto de desarrollo | `dev`          | Clave de la instancia de desarrollo (`pk_test_`) |
| Development        | URL del proyecto de desarrollo | Clave publicable del proyecto de desarrollo | `dev`          | Clave de la instancia de desarrollo (`pk_test_`) |

Vite escribe estos valores en el JavaScript durante el build, así que un cambio de variable solo se aplica en el siguiente despliegue: después de cambiarla hay que volver a desplegar (Redeploy). Si falta alguna, el build termina bien, pero la app muestra la pantalla de error de configuración. El ambiente Development de Vercel solo se usa con la CLI de Vercel (`vercel env pull`, `vercel dev`), que este proyecto no necesita; se rellena igual para que los tres ambientes estén completos. Ninguna de estas variables es secreta: al crearlas se elige el tipo Config, no Secret, para que sus valores sigan siendo legibles en el panel.

Para Sentry (ver [Errores en Sentry](#errores-en-sentry)) se añaden `VITE_SENTRY_DSN` (Config; el DSN del proyecto en Production y Preview, para que los errores de cada ambiente se separen por `VITE_APP_ENV`) y, para los mapas de código fuente, `SENTRY_AUTH_TOKEN` (Secret), `SENTRY_ORG` y `SENTRY_PROJECT` (Config), en los ambientes cuyos builds deban subirlos. El token vive solo en Vercel: nunca en el repositorio, en un issue ni en un chat.

## Flujo de ramas

El proyecto sigue GitHub Flow:

1. `main` siempre está en estado desplegable. No se hacen commits directos en `main`.
2. Cada cambio se trabaja en una rama creada desde `main` y asociada a un issue, por ejemplo `feat/1-monorepo-base`.
3. Al terminar se abre un pull request hacia `main`. La integración continua ejecuta lint, verificación de formato, typecheck, pruebas y build, y tiene que pasar antes de fusionar.
4. Tras la revisión, el pull request se fusiona en `main` y la rama se borra.

## Integración continua

El workflow `.github/workflows/ci.yml` se ejecuta en cada pull request y en cada push a `main`. Instala las dependencias con `npm ci` usando la versión de Node de `.nvmrc` y la caché de npm, y después ejecuta `lint`, `format:check`, `typecheck`, `test` y `build`, en ese orden. Si cualquiera de esos pasos falla, el job falla. Un segundo job, **Pruebas de base de datos**, ejecuta `npm run db:test` y `npm run db:types:check` sobre un Postgres 17 desechable (ver [Pruebas de la base de datos](#pruebas-de-la-base-de-datos) y [Tipos de TypeScript del esquema](#tipos-de-typescript-del-esquema)). Otro, **Pruebas de extremo a extremo (Playwright)**, prueba los flujos principales en un navegador real (ver [Pruebas de extremo a extremo](#pruebas-de-extremo-a-extremo)); todavía no es obligatorio. Cuando se suben nuevos commits a un pull request, la ejecución anterior de ese mismo pull request se cancela.
