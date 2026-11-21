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

El CI ejecuta además el lint, el formato y las pruebas del proyecto de Python de `scripts/catalog-import/` (con [uv](https://docs.astral.sh/uv/)), incluidas las de la carga del catálogo contra un Postgres 17 desechable; cómo instalarlo y ejecutarlos en local está en [su README](scripts/catalog-import/README.md).

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
| `npm run db:seed:plants` | Carga plantas de ejemplo para un usuario en el proyecto de desarrollo (`-- <id de usuario> [cantidad]`), o las borra con `--borrar`.                                       |
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

| Componente        | Para qué                                                                                                                                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`          | Acciones. Variantes `primary` (una por pantalla), `secondary` y `danger`; ancho completo con `block`.                                                                                                           |
| `Chip`            | Filtros y opciones cortas; botón de alternar con `selected`.                                                                                                                                                    |
| `ChipGroup`       | Fila de chips con su nombre para el lector de pantalla.                                                                                                                                                         |
| `TextField`       | Campo de texto con etiqueta visible, ayuda y error.                                                                                                                                                             |
| `StatusBadge`     | Validación del nombre: "Validada" o "Nombre por validar".                                                                                                                                                       |
| `SpecimenCard`    | Tarjeta de un ejemplar; sin foto usa el marcador `sin-foto.svg`. `layout="row"` para listas, `nameStyle="plain"` para un nombre por validar y `renderName` para envolver el nombre (por ejemplo, en un enlace). |
| `ScientificName`  | Nombre científico con cada tramo en cursiva o en redonda según la nomenclatura (ver abajo).                                                                                                                     |
| `OwnershipAnswer` | Respuesta de "¿Ya la tengo?".                                                                                                                                                                                   |
| `Autocomplete`    | Buscador con autocompletado de lista, con carga, sin resultados, error y una acción final opcional.                                                                                                             |
| `Collapsible`     | Sección plegable.                                                                                                                                                                                               |
| `Icon`            | Único punto de entrada de los iconos (subconjunto de Lucide del sistema); ningún otro archivo importa `lucide-react`.                                                                                           |

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

## Backoffice del catálogo

`/administracion/catalogo` (#20) muestra el catálogo completo en una tabla (#99), permite dar de alta, editar, borrar y cambiar el estado de especies (#106) y editar sus sinónimos y nombres comunes, los géneros y sus abreviaturas (#107). Solo la ven los administradores del catálogo (`RequireCatalogAdmin`); la protección real está en la base: las funciones que usa exigen el rol y responden `42501` a cualquier otro (ver [Listado del catálogo para el backoffice](supabase/README.md#listado-del-catálogo-para-el-backoffice) y [Escritura del catálogo desde el backoffice](supabase/README.md#escritura-del-catálogo-desde-el-backoffice)). Va en su propio chunk (`src/backoffice/CatalogAdminPage.tsx`, cargado de forma diferida desde `App.tsx`), que solo descarga quien abre la ruta.

- **Resumen** arriba: géneros, especies, híbridos, sinónimos y nombres comunes, y especies (con los híbridos) por estado y por fuente.
- **Pestañas "Especies" y "Géneros"** (patrón de pestañas de WAI-ARIA: flechas, Inicio y Fin).
- **Especies:** buscador (con la tolerancia del autocompletado: tildes, errores de tipeo, abreviaturas, signo "×"), filtros por estado, tipo y fuente (chips) y por género (el buscador de géneros del registro), y una tabla con el nombre científico (cursiva botánica), el género, el tipo, el estado, la fuente y el número de sinónimos y de nombres comunes. Con búsqueda, bajo el nombre se dice si coincidió por un sinónimo o un nombre común. Sin texto la tabla es el catálogo en orden alfabético, paginado por clave; con texto, por relevancia, paginado por número. Cada petición trae una sola página de 50 filas, con el total.
- **Detalle de una especie** en un panel junto a la tabla (debajo en pantallas estrechas): sinónimos, nombres comunes, referencia de la fuente con enlace a su ficha en el Catalogue of Life (en otra pestaña, `rel="noopener noreferrer"`), fechas de alta y de última modificación y cuántas plantas de usuarios la tienen enlazada (solo el número). El nombre de cada especie es un enlace al detalle: se puede abrir en otra pestaña o compartir. Al abrirlo, el foco va a su título; al cerrarlo, vuelve al nombre en la tabla.
- **Alta** ("Añadir especie o híbrido", sobre la tabla): un formulario en el sitio del detalle con el nombre científico (con un botón para insertar el signo «×»), el género (el buscador de géneros del registro; si el nombre está vacío, empieza por el género), el tipo y el estado (validada u observada: una alta manual no queda como importada). La base le pone la fuente «Lista curada» sin referencia. Al guardar se abre su detalle.
- **Edición** desde el detalle ("Editar"): nombre, género, tipo y estado en un solo envío. Si cambian el género o el tipo, el formulario dice a cuántas plantas de usuarios se propaga y, si hay alguna, pide confirmación con el número recién pedido a la base. Una especie importada a la que se cambian los datos pasa a «Validada» (lo hace la base, ver [Editada pasa a validada](supabase/README.md#editada-pasa-a-validada)), y el formulario lo avisa antes; en una entrada de la lista curada de híbridos avisa de que la carga de la lista la revertirá mientras siga validada.
- **Baja** desde el detalle ("Borrar"), con confirmación, solo si ninguna planta de usuarios la tiene enlazada; si las tiene, el detalle lo explica y remite a la fusión de especies (#21), que aún no existe.
- **Cambio de estado por lote:** cada fila de la tabla tiene una casilla («Seleccionar …») y la cabecera una para toda la página (con estado intermedio). Con alguna marcada aparece la barra «N especies seleccionadas», con el estado nuevo, "Cambiar el estado" (tras confirmar; se cambian todas o ninguna) y "Quitar la selección". La selección es de la página que se ve, como mucho 50 filas (la base admite 100): cambiar de página, de búsqueda o de filtros la vacía.
- **Errores** junto a su campo, enlazados con `aria-describedby`, con el foco en él: nombre vacío, nombre que ya existe sin distinguir mayúsculas, que solo se diferencia en las tildes o el signo «×» (dice cuál), género inexistente, referencia de fuente. Los demás (sin conexión, sesión, permiso, especie que ya no existe, plantas enlazadas) salen en el formulario o en el diálogo. Los espacios sobrantes se quitan al salir del campo y otra vez antes de enviar.
- **Confirmaciones** con un diálogo propio (`src/backoffice/ConfirmDialog.tsx`, `role="alertdialog"` con título y explicación asociados): el foco empieza en "Cancelar" si la acción borra y en la acción si no, Tab no sale del diálogo, Escape lo cierra y el foco vuelve a donde estaba.
- **Tras cada cambio** el resumen, la tabla y el detalle se vuelven a leer sin recargar la página ni perder la búsqueda, los filtros o la página (`revision` de `useRemoteData`: se sigue viendo lo de antes hasta que llega lo nuevo), y el resultado se anuncia arriba en una región `role="status"` («Se dio de alta…», «2 especies pasaron a «Validada»…»).
- **Sinónimos y nombres comunes** en el detalle de la especie: cada lista con "Editar" y "Quitar" en cada nombre (con confirmación) y "Añadir sinónimo" / "Añadir nombre común". Al editar se puede pasar un nombre de una lista a otra. Los nombres comunes llevan un idioma opcional (etiqueta corta: `es`, `en`, `pt-BR`); los sinónimos no, porque son nombres científicos. Un nombre repetido en la especie (sin distinguir mayúsculas, o que solo cambia en tildes o «×») o igual a su nombre científico se explica junto al campo.
- **Géneros:** abreviaturas, si son de acceso rápido y número de especies (enlace a la pestaña de especies filtrada por ese género), con búsqueda por nombre o abreviatura y el filtro "Solo de acceso rápido". "Añadir género" (nombre y acceso rápido) y, en cada fila, "Editar", que abre un panel junto a la tabla con el nombre (un nothogénero lleva «× » delante; avisa si ya hay otro que solo cambia en el signo), la casilla "Acceso rápido en el registro" (cambiarla pide confirmación: cambia los chips del registro de todos los usuarios), sus abreviaturas (se guardan con su punto final; si otra igual ya es de un género, el error dice cuál) y "Borrar el género", solo si no tiene especies (si las tiene, se explica; si la base dice que hay plantas registradas con él, también).
- **Todo va en la URL** (`src/backoffice/url-state.ts`): pestaña (`pestana`), texto (`q`), filtros (`estado`, `genero`, `tipo`, `fuente`), página (`pagina`, y sin texto `desde`, `antes` o `ultima` para la página por clave), detalle (`especie`) y, en géneros, `gq`, `rapido` y `gpagina`. Recargar o compartir el enlace muestra lo mismo; un valor que no se reconoce se ignora. Cambiar el texto o un filtro vuelve a la primera página. Escribir sustituye la entrada del historial; cambiar de página, de filtro, de pestaña o abrir un detalle añade una.
- **Estados:** mientras carga, un esqueleto con el tamaño de la página anterior y "Cargando especies…" en una región `role="status"` que también anuncia el resultado ("32.464 especies. Página 1 de 650."); nunca se ven filas de una petición anterior (ni mientras se escribe). Catálogo vacío, sin resultados (con "Limpiar búsqueda y filtros"), página que ya no existe y error con "Reintentar", con un texto distinto sin conexión, con la sesión terminada o sin el rol en la base.
- **Atribución** del Catalogue of Life (versión, DOI y licencia CC BY 4.0, como pide `scripts/catalog-import/FUENTE.md`) al pie. Los datos salen de `scripts/catalog-import/fuente.json`, el archivo que fija la versión de la importación: Vite lo lee al compilar (`src/backoffice/attribution.ts`), así que al cambiar de versión no hay que tocar la app.
- **Capa de datos:** `src/lib/catalogAdmin.ts` (`listCatalogSpecies`, `searchCatalogSpecies`, `listCatalogGenera`, `getCatalogSummary`, `getSpeciesDetail`, `countSpeciesPlants`, `getGenus`), con `AbortSignal`, tipos sacados de `database.types.ts` y errores `CatalogAdminError` con motivo (`aborted`, `offline`, `session-ended`, `forbidden`, `failed`). `src/backoffice/useRemoteData.ts` hace cada lectura con cancelación y descarta las respuestas de otra clave.
- **Escrituras:** `src/lib/catalogWrites.ts` es la única puerta por la que la pantalla escribe el catálogo (`createCatalogSpecies`, `updateCatalogSpecies`, `setCatalogSpeciesStatus`, `deleteCatalogSpecies`, `addSpeciesName`, `updateSpeciesName`, `deleteSpeciesName`, `createCatalogGenus`, `updateCatalogGenus`, `deleteCatalogGenus`, `addGenusAbbreviation`, `updateGenusAbbreviation`, `deleteGenusAbbreviation`), cada una una llamada a una función de administrador de la base. Traduce los rechazos a `CatalogWriteError`: un problema (`duplicate-name`, `similar-name`, `species-has-plants`…), el campo del formulario al que corresponde y el mensaje en español, a partir del motivo que la base pone en `details` o, si no lo hay, del nombre de la restricción.
- **Sin base de datos:** la página de muestra (`/muestra`, sección "Backoffice del catálogo") pinta la misma vista (`CatalogAdminView`) con unas 150 especies en memoria (`src/showcase/catalog-admin-data.ts`) y los estados de carga, vacío, sin conexión y fallo. Su búsqueda es solo una aproximación (prefijo o contener el texto). Las escrituras cambian el catálogo en memoria con las mismas reglas que la base, hasta que se cambia de escenario.
- **Pruebas:** `src/lib/catalogAdmin.test.ts` y `src/lib/catalogWrites.test.ts` (peticiones y errores), `src/backoffice/CatalogAdminPage.test.tsx` (la lectura: la pantalla con `fetch` simulado, la URL, el teclado y axe en cada estado) `src/backoffice/CatalogAdminEditing.test.tsx` (alta, edición con su confirmación, baja, lote, errores junto al campo, foco y axe con cada formulario y diálogo) y `src/backoffice/CatalogAdminNamesGenera.test.tsx` (nombres, géneros y abreviaturas).

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

El cliente de Supabase se crea una sola vez, en `apps/web/src/lib/supabase.ts`, a partir de la configuración validada, y se carga de forma diferida (ver [Identidad: de Clerk a Postgres](#identidad-de-clerk-a-postgres)). No usa Supabase Auth: la sesión es de Clerk y el cliente envía su token de sesión en cada petición.

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
- Cuenta: en la cabecera de la app, `src/auth/AccountControls.tsx` muestra, con sesión, el [`<UserButton />`](https://clerk.com/docs/react/reference/components/user/user-button) de Clerk (avatar con el menú para administrar la cuenta) y un botón "Cerrar sesión" ([`<SignOutButton>`](https://clerk.com/docs/react/reference/components/unstyled/sign-out-button) con el `Button` del sistema); sin sesión, enlaces a "Iniciar sesión" y "Crear cuenta". La sesión se distingue con [`<Show when="signed-in">`](https://clerk.com/docs/react/reference/components/control/show), que en Core 3 sustituye a `<SignedIn>` y `<SignedOut>`.
- Apariencia: `src/auth/appearance.ts` define el prop [`appearance`](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/overview) con [`variables`](https://clerk.com/docs/react/guides/customizing-clerk/appearance-prop/variables) y `elements`, y cada valor es una variable de `tokens.css` (`var(--color-primary)`, `var(--font-body)`, `var(--radius-md)`...). `appearance.test.ts` falla si aparece un valor suelto o una variable que no existe en `tokens.css`. Clerk calcula sus tonos con `color-mix()` y color relativo, que con variables CSS piden Safari 16.4+ (el mismo mínimo que ya exige Tailwind 4).
- Pruebas: ninguna carga Clerk ni necesita clave. `src/test/clerk-mock.tsx` sustituye a `@clerk/react` (`vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))`) y permite fijar el estado: cargando, listo, fallo de carga, con o sin sesión y con o sin el claim `app_role`. Las rutas se prueban con `MemoryRouter` en `src/routes/AppRouter.test.tsx`. Las pantallas propias pasan axe con el helper `src/test/axe.ts`.

### Rutas

El enrutador es [React Router](https://reactrouter.com/) 8 en modo declarativo (`<BrowserRouter>`, `<Routes>`, `<Route>`), sin el modo framework. Todas las rutas están en `src/routes/paths.ts` (`PATHS`); el mapa está en `src/App.tsx`, y la muestra, en `src/routes/AppRouter.tsx`. Van en español y sin acentos. "Registro" a secas es el de la cuenta; el de una planta cuelga de la colección.

| Ruta                       | Pantalla                                                                                                                             | Acceso                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| `/`                        | Inicio                                                                                                                               | Pública                    |
| `/catalogo`                | Catálogo (provisional)                                                                                                               | Pública                    |
| `/coleccion`               | Mi colección (provisional)                                                                                                           | Con sesión                 |
| `/coleccion/nueva`         | Registrar una planta (provisional)                                                                                                   | Con sesión                 |
| `/administracion/catalogo` | Administración del catálogo: especies, sus nombres, géneros y abreviaturas (ver [Backoffice del catálogo](#backoffice-del-catálogo)) | Con sesión y rol de admin. |
| `/iniciar-sesion/*`        | Inicio de sesión (Clerk)                                                                                                             | Pública                    |
| `/registro/*`              | Crear cuenta (Clerk)                                                                                                                 | Pública                    |
| `/muestra`                 | Muestra del design system                                                                                                            | Solo fuera de producción   |
| `/diagnostico`             | Diagnóstico de identidad                                                                                                             | Solo fuera de producción   |
| Cualquier otra             | Página no encontrada                                                                                                                 | Pública                    |

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

Cómo sustituir la fuente (por ejemplo, la caché local del #18): implementa `CollectionSource` (`source.ts`), cuyo `load({ userId, signal, provide })` devuelve todas las plantas del usuario o rechaza con un `CollectionLoadError` con su motivo. `provide(plantas)` entrega un resultado provisional (la copia del dispositivo) antes del definitivo. Pásala a `<CollectionProvider source={miFuente}>`; puede envolver a `supabaseCollectionSource`. En las pruebas, `src/test/collection-source.ts` tiene una fuente controlada a mano.

### Pantalla de inventario

`/coleccion` (`src/pages/CollectionPage.tsx`) conecta `useCollection()` con `InventoryView` (`src/inventory/`), que no carga datos: recibe la colección y la pinta. La página de muestra (`/muestra`, sección "Pantalla de inventario") usa la misma vista con datos fijos (`src/showcase/inventory-data.ts`), también con 300 plantas, vacía, cargando y con cada tipo de error.

- **Por defecto, solo plantas activas**, en los contadores de cabecera (orquídeas y géneros, en singular o plural) y en la lista. Las perdidas y regaladas se ven con el filtro de estado.
- **Lista o cuadrícula.** Lista: una tarjeta por fila con la miniatura a la izquierda (`SpecimenCard` con `layout="row"`). Cuadrícula: dos por fila en el celular, tres desde 640 px y cuatro desde 1024 px.
- **Agrupar por género** o no. Agrupada: un encabezado por género con su contador ("Phalaenopsis, 3 orquídeas" para el lector de pantalla), los géneros y las plantas en orden alfabético sin tener en cuenta el signo "×". Sin agrupar: las más recientes primero (por fecha de alta).
- **Cada tarjeta** lleva el nombre mostrado, el apodo, el género y la insignia de validación ("Nombre por validar" también para las no identificables). Con foto, la miniatura (`usePlantThumbnail`, ver [Lectura de fotos](#lectura-de-fotos-y-borrado-sin-huérfanos)); sin foto, el marcador neutro. Para el detalle (#16), la tarjeta se convierte en enlace pasando `renderName` a `SpecimenCard` en `PlantCard.tsx`.
- **Registrar orquídea:** enlace a `/coleccion/nueva`; en el celular queda fijo abajo, al alcance del pulgar.
- **Buscador fijo arriba** (se queda visible al desplazarse): filtra mientras se escribe con `filterByText` por nombre mostrado, nombre ingresado, género, apodo y origen, sin tildes, mayúsculas ni el signo "×". Escape o el botón de la cruz lo limpian. Bajo el campo se dice cuántas coinciden (también al filtrar), en una región `role="status"` que el lector de pantalla anuncia sin mover el foco. Agrupada, los géneros sin coincidencias desaparecen. `InventorySearch` acepta un bloque debajo (`children`), donde "¿Ya la tengo?" (#19) pondrá su respuesta.
- **Filtros** (#15, `src/inventory/InventoryFilters.tsx`; funciones puras en `src/collection/filters.ts`): estado (uno solo: activas, perdidas o regaladas; por defecto, activas), género (los presentes en la colección, en orden alfabético sin el "×"), color de flor (solo los usados, en el orden del enumerado) y origen (los usados, de más a menos plantas; "Vivero Sol" y "vivero sol" son el mismo). Varios valores a la vez en género, color y origen. Se combinan con O dentro de un grupo, con Y entre grupos y con la búsqueda. Un ejemplar sin color no aparece al filtrar por color; uno sin origen, al filtrar por origen. Las opciones salen de toda la colección (también las bajas), para que no desaparezcan al cambiar de estado. Un grupo sin opciones no se muestra, y sin plantas no hay filtros.
- **Filtros en el celular:** el botón "Filtros" (con el número de activos, "Filtros, 2 activos" para el lector de pantalla) abre y cierra un panel bajo los controles de vista (patrón disclosure: `aria-expanded`, `aria-controls`; el panel le sigue en el orden del tabulador). "Listo" o Escape lo cierran y devuelven el foco al botón. Género y origen enseñan 8 opciones y "Ver N más" (las elegidas siempre se ven). Con el panel cerrado, los filtros activos quedan en una fila de chips ("Rosado ×", "Quitar el filtro Color de la flor: Rosado"); al quitar uno el foco pasa al siguiente y, si no queda ninguno, al botón. "Quitar filtros" los quita todos. Sin resultados, el aviso ofrece "Quitar filtros" y "Limpiar la búsqueda" según lo que haya.
- **Contadores:** la cabecera dice cuántas se ven. Sin búsqueda ni filtros de género, color u origen, el total con el estado elegido ("12 orquídeas", "2 orquídeas perdidas"); con ellos, "N de M" ("3 de 12 orquídeas"), donde M es el total con ese estado. Los géneros son los de las plantas que se ven. Lo mismo, en frase ("3 de 12 orquídeas coinciden."), bajo el buscador fijo.
- **Filtros en la URL**, junto a la búsqueda, con nombres en español y valores estables: `/coleccion?q=phal&estado=lost&genero=<id del género>&color=white&color=pink&origen=vivero+sol` (`src/inventory/filter-params.ts`). `estado` es la clave del enumerado (sin él, activas); `genero`, el id; `color`, la clave del enumerado; `origen`, el origen normalizado. Los valores múltiples van con el parámetro repetido (un origen puede llevar comas). Lo que no se entiende o ya no está en la colección se ignora. Como la búsqueda, cada toque sustituye la entrada del historial (`replace`): "atrás" sale del inventario en vez de deshacer los toques uno a uno, y al volver del registro o del detalle se recupera el último estado.
- **La búsqueda va en la URL** (`/coleccion?q=phal`): se conserva al volver con "atrás" desde el registro o el detalle, al recargar y al compartir el enlace. Cada pulsación sustituye la entrada del historial en vez de añadir una, y no mueve el foco (`useFocusOnNavigation` solo lo mueve al cambiar de ruta).
- **Posición de desplazamiento:** `src/inventory/scroll-memory.ts` la guarda en memoria por entrada del historial y la restaura al volver con atrás o adelante, cuando la lista ya está pintada. Dura la sesión de la pestaña; un enlace a `/coleccion` o una recarga empiezan arriba.
- **Estados:** sin plantas, una invitación a registrar la primera; con solo plantas dadas de baja, un aviso de que no hay activas y de que se ven en "Filtros"; con plantas y sin coincidencias, "sin resultados" con la opción de quitar los filtros y de limpiar la búsqueda. Mientras carga, un esqueleto con la forma de la vista elegida (oculto al lector de pantalla, que oye "Cargando tu colección…"); el buscador y los controles ya están y no se vuelven a montar al llegar los datos. Si la lectura falla, el motivo en español (sin conexión, sesión terminada o fallo) y "Reintentar", que llama a `reload()`; si falla una recarga con datos en memoria, se siguen mostrando con un aviso.
- **Preferencias del dispositivo:** la vista y la agrupación se guardan en `localStorage` con la clave `orki:inventario:preferencias:v1` (`src/inventory/preferences.ts`). Si el almacenamiento no existe o falla, funcionan igual y duran lo que la pantalla.
- **Exportar a CSV** (#17): al final de la pantalla, "Exportar a CSV" genera el archivo en el dispositivo con la colección en memoria, sin peticiones (`src/collection/export-csv.ts`, función pura; `src/inventory/ExportAction.tsx` y `save-file.ts`). Sin plantas (o mientras carga) no aparece.
  - **Qué incluye:** todas las plantas del usuario, también las perdidas y regaladas, sin importar los filtros ni la búsqueda (lo dice el texto junto al botón). Una fila por ejemplar, ordenadas por género y nombre (como la vista agrupada, sin tener en cuenta el "×").
  - **Columnas:** Nombre científico (vacío si la planta está por validar), Nombre ingresado, Género, Tipo, Estado, Validación, Fecha de adquisición, Origen, Ubicación, Apodo, Color de flor, Foto en floración ("Sí", "No" o vacío si no hay foto) y Fecha de registro. Valores en español con los mismos textos que la interfaz (`src/collection/labels.ts`); fechas `AAAA-MM-DD` (la de registro, en la fecha local del dispositivo).
  - **Formato:** UTF-8 con marca de orden de bytes (para que Excel muestre tildes, ñ y "×"), separador coma (configuración regional de Perú; un Excel configurado para España espera punto y coma y lo abriría en una columna), fin de línea CRLF y escapado RFC 4180: una celda con coma, comillas, salto de línea o espacios en los extremos va entre comillas, con las comillas duplicadas. Nombre: `orki-inventario-AAAA-MM-DD.csv`, con la fecha local.
  - **Fórmulas:** una celda que empieza por `=`, `+`, `-`, `@`, tabulador o retorno de carro (también tras espacios) lleva delante un apóstrofo (regla de OWASP), y la hoja de cálculo la trata como texto. El valor sigue entero detrás: "-la pequeña" queda "'-la pequeña"; sin el apóstrofo, Excel lo tomaría por una fórmula y mostraría un error.
  - **Entrega:** en un dispositivo táctil con la Web Share API para archivos (`navigator.canShare({ files })`) se abre la hoja de compartir del sistema (guardar en Archivos, correo, abrir en Sheets); si el usuario la cierra no pasa nada más y, si falla, se descarga. En el resto, un enlace temporal con `download` a una URL de objeto del `Blob`, que se revoca un segundo después. El motivo: en la app instalada en iPhone (modo standalone), Safari no siempre respeta `download` con un `Blob`. Probado con pruebas automáticas y, en Chrome de escritorio (página de muestra), la generación del archivo y el enlace de descarga, sin llegar a guardarlo; la descarga en iPhone y Android y la apertura en Excel y Google Sheets están pendientes de la prueba manual del issue.

**Cursiva de los nombres** (`src/components/ui/scientific-name.ts`): solo va en cursiva un nombre del catálogo (`displayNameIsScientific`); el nombre que ingresó la persona para una planta por validar va en redonda y en la fuente de cuerpo. Dentro del nombre científico, el género y los epítetos van en cursiva y en redonda el signo "×" (también una "x" suelta), las abreviaturas de rango ("var.") y, desde la primera palabra con mayúscula o comilla después del género, el grex y el cultivar: _Phalaenopsis_ Sogo Yukidian, × _Rhyncholaeliocattleya_ Memoria Anna Balmores, _Phalaenopsis_ × _intermedia_. Los tramos en redonda van en la fuente de cuerpo, porque de Playfair Display solo se cargan la cursiva 400 y la redonda 600. El nombre se muestra tal como está guardado. Los géneros como etiqueta (encabezados de grupo, línea de la tarjeta) van sin cursiva, como en los chips del sistema.

## Registro de una planta

`/coleccion/nueva` (`src/pages/NewPlantPage.tsx`, chunk diferido) conecta el formulario `PlantForm` (`src/registration/`) con Supabase y con la colección. Lleva los cuatro campos obligatorios (nombre, género, tipo y fecha de adquisición), la foto (opcional), el origen y la sección plegable "Más detalles". La página de muestra (`/muestra`, sección "Formulario de registro", plegada) usa el mismo formulario con datos fijos y deja elegir el resultado del guardado y de la subida de la foto, empezar por la foto y quitar la conexión.

- **Estado en un solo sitio** (`form-state.ts`): `PlantFormValues`, el reductor `plantFormReducer`, `validatePlantForm()` y `toPlantInsert()`, sin React. La foto (#87) va aparte (es un archivo, no un dato de la fila) y se sube después de guardar; el aviso de duplicado (#88) depende de `species`; `isPendingName()` dice cuándo se guarda como "nombre por validar" (#12).
- **Nombre:** `Autocomplete` contra `search_species`, con el nombre científico en `ScientificName` (prop `renderLabel`) y, debajo, el sinónimo o el nombre común por el que coincidió. Elegir una especie marca su género y su tipo y los bloquea (`aria-disabled`, con la explicación enlazada por `aria-describedby`); cambiar el texto la desenlaza y los deja editables con lo que tenían. Tope de 200 caracteres, sin espacios sobrantes.
- **Nombre por validar** (#12): un nombre que no está en el catálogo se guarda tal cual, sin especie (`validation` la pone la base: `pending`), con los mismos pasos que una especie del catálogo; la acción final de la lista solo lo confirma y no es obligatoria. La ayuda del campo explica qué pasará: queda en el inventario como "Nombre por validar" y un administrador confirmará el nombre. Mientras `isPendingName()`, el campo de foto recomienda añadirla como texto de ayuda (`PLANT_FORM_TEXT.pendingPhotoHint`, enlazado al grupo con `aria-describedby`), sin exigirla. En el inventario y en el aviso tras registrar el estado va con `StatusBadge`; una planta "no identificable" (la marca el administrador, #22) se muestra también como "Nombre por validar", sin tercera etiqueta. Cuando el administrador la enlaza a una especie, la tarjeta pasa a "Validada" con el nombre del catálogo y el nombre ingresado se conserva (`enteredName`, que el buscador del inventario sigue mirando).
- **Aviso de duplicado** (`DuplicateNotice.tsx`, `duplicates.ts`): al elegir una especie del catálogo, si el usuario ya tiene ejemplares activos de ella, bajo el nombre aparece "Ya tienes 2 ejemplares de … Puedes registrar otro igualmente."; no bloquea el guardado. Cuenta sobre la colección en memoria (solo las plantas activas enlazadas a esa especie; no las dadas de baja ni los nombres por validar), sin consulta propia: la pantalla ya pide la colección para sumar la planta nueva y llega en una sola lectura. Mientras se lee, o si falla, no hay aviso y el formulario no espera; si llega después de elegir la especie, el aviso aparece entonces. Va en una región `role="status"` siempre montada, que lo anuncia sin mover el foco. No reutiliza `OwnershipAnswer`: es la respuesta grande de "¿Ya la tengo?", con título propio y una región que no se puede dejar montada vacía.
- **Género:** chips de los géneros de acceso rápido, leídos de `genera` (`is_quick_access`, lectura pública) con una consulta que se hace una vez por sesión (`quick-genera.ts`), más "Otro", que abre el buscador de géneros (`search_genera`, también por abreviatura). Siempre se guarda un `genus_id` del catálogo.
- **Fecha:** `<input type="date">` precargado con la fecha local del dispositivo (`src/lib/localDate.ts`, no `toISOString()`, que da la de UTC), con `max` en hoy y validación propia contra fechas futuras.
- **Origen** (`OriginField.tsx`, `origin-suggestions.ts`): `Autocomplete` con los orígenes que el usuario ya usó, sacados de la colección en memoria (todas sus plantas, también las dadas de baja), sin consulta propia. Se agrupan sin distinguir mayúsculas, tildes ni espacios sobrantes (`normalizeSearchText()`), se muestra la forma del registro más reciente y se ordenan por número de usos y, a igualdad, por el uso más reciente; como mucho 6. Acepta cualquier texto nuevo, sin "sin resultados". Mientras la colección se lee, o si no se pudo leer, no hay sugerencias y el campo funciona igual.
- **"Más detalles"** (`Collapsible`, cerrado por defecto): ubicación, apodo y color de la flor (chips del enumerado `flower_color`; tocar el elegido lo quita). Si al intentar guardar hay un error dentro, se abre sola y el foco va al campo. "La foto es en floración" (`photoInBloom`, un chip de alternar con `aria-pressed`) solo aparece con una foto elegida; quitar la foto lo desmarca, y sin foto nunca se envía `photo_in_bloom`.
- **Topes:** 200 caracteres en el nombre y 120 en origen, ubicación y apodo, los de la base. Los campos cortan con `maxLength` y la validación cuenta caracteres (no unidades de UTF-16) para lo que llega por otra vía, como un borrador. Los opcionales se envían sin espacios sobrantes y solo si tienen valor.
- **Borrador** (`draft.ts`): cada cambio guarda `PlantFormValues` y el `id` de la planta en `localStorage`, en la clave `orki:registro:borrador:<id de usuario>`, con versión de formato y la hora del último cambio. Se usa `localStorage` y no `sessionStorage` porque este último se pierde cuando iOS termina la PWA instalada (al abrir la cámara, por ejemplo) y al reabrirla empieza otra sesión. Al volver al formulario se recupera con un aviso discreto (`role="status"`) y "Descartar borrador" (formulario vacío y otro `id`). Caduca a las 24 horas del último cambio; uno caducado, de otra versión o ilegible se borra. Se borra también al guardar con éxito, al vaciar el formulario y al salir con "Cancelar" (que pregunta antes si hay algo escrito). Salir de otra forma (otra pestaña de la app, cerrar, recargar) lo conserva. Con otra cuenta en el mismo dispositivo no aparece. Conservar el `id` hace que un guardado que llegó a la base justo antes de una recarga no se duplique al reintentar. Si `localStorage` no está o falla, todo va en `try/catch` y el formulario funciona sin borrador.
- **Validación:** solo al intentar guardar (después, al corregir); cada error va junto a su campo con `aria-describedby` y el foco pasa al primero.
- **Guardado** (`save-plant.ts`): `POST /rest/v1/plants?select=<COLLECTION_PLANT_SELECT>` con `{ id, entered_name, genus_id, type, acquired_on[, species_id, origin, location, nickname, flower_color, photo_in_bloom] }`, nunca `validation` ni `user_id`. La fila devuelta pasa por `toCollectionPlant()` y `upsertPlant()`. El `id` lo genera la app y se reutiliza al reintentar: si un intento llegó a la base y se perdió la respuesta, el siguiente choca con la clave primaria y se lee la planta ya guardada en lugar de crear otra. Errores con motivo (sin conexión, sesión terminada, servidor, rechazo de la base traducido) sin perder lo escrito y con "Reintentar"; sin doble envío.
- **Foto** (#87): `PhotoField` (ver [Campo de foto y subida](#campo-de-foto-y-subida)) después de la fecha, antes del origen: registrar sin foto no pasa por ella y los obligatorios quedan arriba. Es opcional. Mientras se prepara, "Registrar orquídea" pasa a "Preparando la foto…" con `aria-disabled` y no envía (`onProcessingChange` de `PhotoField`). La preparación sigue en su chunk diferido: se descarga al elegir la primera foto.
- **Orden de guardado con foto:** 1) se inserta la planta (como sin foto); 2) se borra el borrador y la planta pasa a la colección (`onPlantStored`, que la pantalla conecta con `upsertPlant`); 3) se sube con `replacePlantPhoto` (foto y miniatura, después las rutas en la planta, que vuelve a la colección ya con `thumbnailPath`); 4) se vuelve al inventario, que muestra la miniatura. La subida se espera en el formulario y no en segundo plano: es lo más simple y lo más robusto (la foto preparada sigue en memoria para reintentar, no hace falta un estado global que sobreviva a la navegación ni un aviso de error en otra pantalla) y tarda poco (unos 200-300 KB). Mientras sube, el formulario queda desactivado (la planta ya existe), el botón principal dice "Subiendo la foto…" con `aria-disabled` (sin doble envío) y una región `role="status"` dice "Tu orquídea quedó registrada. Subiendo la foto… (1 de 2 archivos)"; "Cancelar subida" la corta.
- **Si la subida falla** (o se cancela): la planta ya está registrada y en la colección. Un aviso `role="alert"` dice "Tu orquídea quedó registrada, pero no se pudo subir la foto." con el motivo, y el foco pasa a "Reintentar subida", que repite la misma tarea con la foto ya preparada (sin volver a elegirla ni prepararla, y a las mismas rutas), o a "Continuar sin foto", que vuelve al inventario con la planta sin foto. Con la sesión terminada o la planta borrada no se ofrece reintentar. Salir a mitad (otra pestaña de la app) deja la planta sin foto; los archivos que lleguen a subirse sin planta que los apunte los encuentra el script de limpieza.
- **Dos entradas:** "Registrar orquídea" (nombre primero) y "Con foto" ("Registrar con foto" para el lector de pantalla), las dos en el inventario. "Con foto" lleva a la misma pantalla con `?foto=1` (`src/registration/photo-first.ts`), donde el campo de foto va arriba del todo, con la ayuda "Empieza por la foto; después completa los datos."; al elegir la primera foto el foco pasa al nombre. No se abre la cámara al cargar la página porque los navegadores solo abren el selector o la cámara como respuesta directa a un toque: el primer toque es el de "Tomar foto" (con `capture="environment"`, que en iOS y Android abre la cámara trasera) o "Elegir de la galería". Así funciona igual en iOS y en Android, y si iOS recarga la app al abrir la cámara se vuelve al formulario con lo escrito y con `?foto=1`. Cuesta un toque más que abrir la cámara desde el inventario, a cambio de no tener que pasar el archivo de una pantalla a otra.
- **Borrador con foto** (`draft-photo.ts`): la foto ya preparada (dos `Blob`) no cabe en `localStorage`, así que va en IndexedDB (base `orki-registro`, almacén `foto-pendiente`), una por usuario, con el `id` de planta del borrador de texto. Al volver al formulario se recupera solo si ese `id` coincide; sin borrador o con otro `id`, se borra, y al leer se borran también las de otros usuarios. Con una foto elegida el borrador de texto se guarda aunque no haya nada escrito, para conservar ese `id`. Caduca a las 24 horas y se borra al guardar la planta, al quitar la foto, al descartar el borrador y al salir con "Cancelar" (que ahora pregunta también si solo hay una foto). Límite: cubre una recarga después de elegir la foto (por ejemplo, si iOS descarga la app al salir a buscar el nombre); si iOS recarga la app mientras la cámara está abierta, la foto todavía no llegó a la página y hay que volver a tomarla, pero lo escrito se conserva. Si IndexedDB no existe o falla, todo va en `try/catch` y el formulario funciona igual, sin conservar la foto.
- **Sin conexión** (`useOnlineStatus`): el formulario se desactiva con el motivo y vuelve solo al recuperarla. El campo de foto se desactiva con él y la foto elegida se conserva. Si se pierde la conexión con la subida fallida, "Reintentar subida" queda con `aria-disabled` y "Continuar sin foto" sigue disponible.
- **Después de guardar** vuelve al inventario (sustituyendo la entrada del historial) con un aviso de confirmación (`role="status"`) con la etiqueta de validación y "Registrar otra". "Cancelar" pregunta antes de salir solo si hay cambios.
- **Pruebas:** `src/pages/NewPlantPage.test.tsx` (con `fetch` simulado, también Storage y la actualización de las rutas de la foto, y la zona horaria `America/Lima`; la recarga se simula desmontando y volviendo a montar la app con el mismo `localStorage`; la preparación de la foto es un doble y la foto pendiente va en un almacén en memoria, porque jsdom no tiene canvas ni IndexedDB), `src/registration/*.test.ts` y `src/lib/localDate.test.ts`. La parte de IndexedDB de `draft-photo.ts` solo se prueba sin IndexedDB disponible; falta comprobarla en un iPhone y un Android reales (#89). `src/test/setup.ts` vacía `localStorage` después de cada prueba.

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

`PhotoField` (`src/photos/PhotoField.tsx`, #82) es el campo de foto de los formularios: elegir, vista previa, reemplazar y quitar. Prepara la foto con el módulo anterior y la entrega ya preparada; no sube nada. El formulario decide cuándo subirla.

```tsx
import { PhotoField, type PhotoFieldValue } from '../photos/PhotoField.tsx'
import { replacePlantPhoto, removePlantPhoto } from '../photos/upload.ts'
import { usePhotoUpload } from '../photos/usePhotoUpload.ts'

const [foto, setFoto] = useState<PhotoFieldValue | null>(null)
// { kind: 'new', photo: ProcessedPhoto, fileName } | { kind: 'stored', src } | null
const subida = usePhotoUpload<PlantPhotoChangeResult>()

<PhotoField
  value={foto}
  onChange={(valor) => { subida.reset(); setFoto(valor) }}
  upload={subida.state}            // opcional: lo muestra con "Reintentar" y "Cancelar subida"
  onRetryUpload={() => void subida.retry()}
  onCancelUpload={subida.cancel}
/>

// Al guardar, con la planta ya escrita (#87) o al editar (#16):
if (foto?.kind === 'new') {
  const files = foto.photo
  await subida.start(({ signal, onProgress }) =>
    replacePlantPhoto(files, { userId, plant, signal, onProgress, onPlantUpdated: upsertPlant }))
}
if (foto === null && plant.photoPath) await removePlantPhoto({ userId, plant, onPlantUpdated: upsertPlant })
```

- **Cámara y galería:** en el celular, dos botones: "Tomar foto" abre un `<input type="file" accept="image/*" capture="environment">` y "Elegir de la galería", uno sin `capture`. Con `capture`, iOS y Android abren directamente la cámara trasera. Sin él, el iPhone muestra su menú (fototeca, hacer foto, elegir archivo), pero Chrome en Android 14 y 15 abre el selector de fotos del sistema, que muchas veces ya no ofrece la cámara; por eso hay un botón para cada cosa. Los navegadores de escritorio ignoran `capture` (es una pista, según MDN), así que donde el puntero principal no es táctil (`(pointer: coarse)` no se cumple) queda un solo botón, "Elegir foto", que abre el selector de archivos, con cámara en el equipo o sin ella. La prop `camera` (`'auto' | 'show' | 'hide'`) lo fuerza.
- **Estados:** preparando (con "Cancelar"), lista (con el peso) y error con el texto del motivo (formato no admitido, HEIC, no es una imagen, demasiado grande...). Los estados se anuncian en una región `role="status"` y los errores en `role="alert"`. Mientras se prepara o se sube, los botones quedan con `aria-disabled` en vez de `disabled`, para no perder el foco. `onProcessingChange(true | false)` avisa al formulario al empezar y al terminar de preparar (el registro no guarda mientras tanto).
- **Foco:** al quitar la foto, o al cancelar o terminar cuando el botón con el foco desaparece, el foco vuelve al primer botón de elegir. Todo funciona con el teclado; los `<input type="file">` están ocultos, fuera del orden de tabulación y del árbol de accesibilidad, y los abren los botones.
- **Vista previa:** una URL de objeto de la foto preparada, que se revoca al cambiar de foto, al quitarla y al desmontar. La caja es de 4:3 fija, así que la vista previa no mueve nada al aparecer. Con `{ kind: 'stored', src }` muestra una foto ya subida (edición, #16).

Subida (`src/photos/upload.ts`), sobre una interfaz mínima del bucket (`PhotoStorage`, en `storage.ts`) y otra de las escrituras de la planta (`PlantPhotoRecords`, en `plant-record.ts`), con dobles en memoria para las pruebas y la página de muestra (`memory-storage.ts`):

- **`uploadPhotoFiles(files, { userId, plantId, signal, onProgress })`:** sube la foto y la miniatura a la vez con la [convención de rutas](supabase/README.md#fotos-de-plantas-storage) (`src/photos/paths.ts`): `<usuario>/<planta>/photo-<versión>.<webp|jpg>` y `thumb-<versión>`, con una versión nueva (`crypto.randomUUID()`) por foto preparada y la misma en sus reintentos. El tipo de contenido es el del Blob (con un Blob, supabase-js envía un formulario y Storage toma el tipo de la parte del archivo, no de `contentType`) y la caché es de un año (`cacheControl: '31536000'`): las rutas llevan versión y nunca cambian de contenido. Sin `upsert`; si la ruta ya existe (409), se da por subida, porque solo puede ser un intento anterior de esta misma foto cuya respuesta se perdió. Si falla una de las dos, borra las dos rutas antes de rechazar.
- **Progreso:** archivos y bytes terminados (`UploadProgress`); supabase-js no da el progreso de cada petición.
- **Cancelar:** supabase-js no deja abortar una subida (`upload` no acepta `AbortSignal`). Al cancelar se deja de esperar enseguida (rechaza con `aborted`) y, cuando terminan las peticiones en curso, se borra lo que haya llegado. El reintento usa otra versión para que ese borrado tardío no se lleve sus archivos.
- **Errores** (`PhotoStorageError`, con `reason` y `message` en español): `offline`, `session-ended`, `too-large` y `unsupported-type` (rechazo del bucket por el tope de 1 MiB o el tipo), `forbidden` (políticas), `not-found`, `failed` y `aborted`. Storage a veces responde 400 con el código real en `statusCode` (`"413"`, `"403"`); se mira ese también. `uncertain` indica que la petición salió y no hubo respuesta, así que no se sabe si se aplicó.
- **Reintentar sin volver a elegir ni preparar la foto:** `usePhotoUpload()` guarda la última tarea y `retry()` la vuelve a lanzar con la misma foto ya preparada. Con la sesión terminada o la planta borrada no se ofrece "Reintentar".

Orden de las operaciones sobre una planta que ya existe (la planta nunca apunta a un archivo que no existe; lo peor que queda es un archivo sin planta, que encuentra el script de limpieza):

| Operación           | Pasos                                                                                                                                                                | Si falla un paso                                                                                                                                                                                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `replacePlantPhoto` | 1. Subir foto y miniatura nuevas. 2. Apuntar la planta (`photo_path`, `thumbnail_path`). 3. Reflejarla en la colección (`onPlantUpdated`). 4. Borrar las anteriores. | 1: se borra lo subido; la planta sigue igual. 2 rechazado por la base: se borra lo nuevo y la planta sigue con la anterior. 2 sin respuesta (`uncertain`): no se borra nada, porque la planta quizá ya apunta a lo nuevo; reintentar lo termina. 4: la operación vale y las rutas viejas vuelven en `leftovers`. |
| `removePlantPhoto`  | 1. Poner las rutas de la planta a `null`. 2. Reflejarla. 3. Borrar los archivos.                                                                                     | 1: no se borra nada. 3: la planta ya está sin foto y los archivos vuelven en `leftovers`.                                                                                                                                                                                                                        |

La cancelación vale hasta que sale la escritura en la base. En `/muestra`, sección "Fotos", el campo sube a un bucket simulado en memoria (la página no tiene sesión de Clerk ni usa Supabase), con las rutas reales y la opción de simular un fallo de red, de la miniatura o de tamaño para ver el reintento.

### Lectura de fotos y borrado sin huérfanos

El bucket es privado (#83): las imágenes no tienen una dirección pública. Hay dos formas de leerlas: URL firmadas (`createSignedUrls`, una petición firma muchas rutas) o descarga autenticada a `Blob` (`download`, con el token de la sesión). La app usa la **descarga autenticada, guardada por ruta**:

- Una URL firmada caduca y cambia en cada firma: el navegador la trata como otra dirección y la vuelve a bajar en cada sesión, y la caché sin conexión del #18 no puede usarla como clave. Firmar en lote ahorra una petición por imagen, pero las imágenes se bajan igual una a una.
- La ruta es una clave estable y su contenido nunca cambia (lleva la versión). Cada miniatura se baja una vez por dispositivo: queda en memoria mientras dura la pestaña y en **Cache Storage**, en una caché por usuario (`orki-miniaturas-v1:<usuario>`) con clave `/_orki/plant-photos/<ruta>` (una dirección del propio origen que nadie sirve). Desde la segunda visita, una lista de cientos de miniaturas no hace ninguna petición, y Cache Storage se lee sin red y también desde el service worker, que es lo que necesita el #18.
- Las descargas van como mucho de 6 en 6. Cada imagen se muestra con una URL de objeto que se revoca 30 s después de que ninguna pantalla la use (así no se recrea al desplazarse arriba y abajo).
- Al cambiar de usuario o cerrar sesión, `CollectionProvider` llama a `forgetPlantImagesExcept(usuario)`: vacía la memoria y borra de Cache Storage las miniaturas de los demás usuarios.

La estrategia vive en `src/photos/read.ts` detrás de `PlantImageSource` (`acquire(ruta, 'thumbnail' | 'photo')` devuelve una URL de objeto y `release(ruta)` la suelta) y de `PersistentImageCache`. Las pantallas solo usan los hooks de `src/photos/usePlantImage.ts`, así que el #18 puede cambiarla (por ejemplo, que el service worker sirva la caché) pasando otra fuente con `<PlantImagesContext value={...}>`, sin tocarlas:

```ts
const miniatura = usePlantImage(plant.thumbnailPath, 'thumbnail', visible)
const foto = usePlantImage(plant.photoPath, 'photo') // detalle (#16), bajo demanda
// { status: 'none' | 'loading' | 'error' } o { status: 'ready', src }
```

- **Inventario:** `PlantCard` usa `usePlantThumbnail(plant, ref)` (`src/inventory/usePlantThumbnail.ts`), que pide solo `thumbnailPath`, nunca la foto grande, y solo cuando la tarjeta está en pantalla o a menos de 300 px (`useNearViewport`, con `IntersectionObserver`). Mientras carga o si falla, el marcador neutro del sistema, con un texto alternativo que lo dice ("Foto de _Cattleya labiata_: cargando"); la caja de la foto tiene proporción fija, así que la imagen no mueve nada al llegar. Tras un fallo se reintenta al volver la conexión (evento `online`) o al volver a montar la tarjeta: el fallo no se guarda. Las plantas sin foto siguen con "Sin foto".
- **Foto grande:** `usePlantImage(plant.photoPath, 'photo')` la baja bajo demanda y la guarda solo en memoria (no ocupa Cache Storage). Para el campo de foto de la edición: `{ kind: 'stored', src }` con la `src` que devuelve.

Sin huérfanos:

- **Reemplazar y quitar** borran los archivos anteriores (ver la tabla de arriba).
- **Eliminar una planta** (lo llamará el #16): `deletePlantWithPhotos({ userId, plantId, onPlantRemoved: removePlant })` (`src/photos/delete.ts`) borra primero la fila, la quita de la colección y después toda la carpeta `<usuario>/<planta>/` (`deletePlantPhotoFolder`, que también se lleva restos de subidas anteriores). Si falla el borrado de la planta no se toca nada; si fallan los archivos, la planta ya no existe y devuelve `photosDeleted: false`.
- **Script de limpieza:** un fallo de red a mitad puede dejar archivos sin planta. `npm run fotos:huerfanas -- --ambiente desarrollo` los lista (modo de prueba, por defecto) y con `--borrar` los borra; ver [su sección](supabase/README.md#limpieza-de-fotos-huérfanas) en el README de Supabase.

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

### Importación del catálogo

El catálogo de especies (Catalogue of Life) se carga con `orki-catalogo cargar` de `scripts/catalog-import/`, después de aplicar las migraciones. En desarrollo se puede cargar desde tu máquina o con el workflow; en producción, solo con el workflow manual `.github/workflows/importar-catalogo.yml` (Actions > Importar catálogo), que simula por defecto, exige escribir el identificador del proyecto para escribir en producción y deja el reporte como artefacto. Usa `SUPABASE_DB_PASSWORD` y `SUPABASE_PROJECT_REF` del environment y además la variable `SUPABASE_POOLER_HOST`, que hay que crear en cada environment. La guía completa (pasos por ambiente, cómo leer el reporte y qué hacer con una versión nueva de la fuente) está en [Ejecución por ambiente](scripts/catalog-import/README.md#ejecución-por-ambiente).

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

El workflow `.github/workflows/ci.yml` se ejecuta en cada pull request y en cada push a `main`. Instala las dependencias con `npm ci` usando la versión de Node de `.nvmrc` y la caché de npm, y después ejecuta `lint`, `format:check`, `typecheck`, `test` y `build`, en ese orden. Si cualquiera de esos pasos falla, el job falla. Un segundo job, **Pruebas de base de datos**, ejecuta `npm run db:test` y `npm run db:types:check` sobre un Postgres 17 desechable (ver [Pruebas de la base de datos](#pruebas-de-la-base-de-datos) y [Tipos de TypeScript del esquema](#tipos-de-typescript-del-esquema)). Cuando se suben nuevos commits a un pull request, la ejecución anterior de ese mismo pull request se cancela.
