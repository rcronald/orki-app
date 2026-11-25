# orqui.app

Aplicación web para coleccionistas de orquídeas, que se llama «orqui.app»
(en minúsculas, también al inicio de frase).
Hasta el issue #173 se llamaba Orki, y ese nombre sigue en el repositorio,
los paquetes, las clases CSS `orki-`, las claves de almacenamiento
y las herramientas internas.
Es una PWA pensada primero para el celular y con la interfaz en español.
En la Fase 1 cada persona registra las orquídeas que tiene y,
al ver una nueva en una tienda o un vivero,
comprueba al instante si ya la tiene para no comprarla repetida.

La especificación completa de la Fase 1 está en
[docs/specification.md](docs/specification.md).

## Estado actual

La Fase 1 está construida y conectada a Supabase,
y cada fusión en `main` se despliega en producción en Vercel:

- **Acceso** con Clerk (inicio de sesión y registro en español)
  y una portada pública.
- **Registro de una planta**, con galería de hasta 6 fotos,
  borradores y nombres por validar.
- **Mi colección**: inventario en lista y cuadrícula,
  con búsqueda, filtros y exportación.
- **«¿Ya la tengo?»**, la consulta rápida antes de comprar.
- **Ficha** de cada planta, con galería, bitácora y fotos de referencia,
  y su **edición**.
- **Catálogo público** de especies y géneros, sin sesión.
- **Backoffice del catálogo** para administradores:
  especies, nombres, géneros, fusión y cola de propuestas.
- **Tu cuenta**, con la eliminación de la cuenta,
  y las páginas de **privacidad** y **créditos**.
- **Sin conexión**: la app instalada arranca y enseña la colección guardada.

Por debajo: React, Vite, TypeScript y Tailwind CSS como PWA;
migraciones de Postgres con la CLI de Supabase y sus pruebas
en un Postgres desechable; errores en Sentry;
y la integración continua de GitHub
(ver [Despliegue e integración continua](docs/operacion/despliegue-y-ci.md)).

## Requisitos

- Node.js 24.15.0 o posterior dentro de la línea 24 (LTS).
  El archivo `.nvmrc` fija la versión mayor 24;
  algunas dependencias de pruebas (jsdom) exigen al menos la 24.15.0,
  así que con una 24 anterior `npm` muestra avisos `EBADENGINE`.
- npm 11 o posterior, el que viene con Node 24.
  El proyecto usa npm workspaces; no uses pnpm ni yarn.
- Git.

Si usas [nvm](https://github.com/nvm-sh/nvm), `nvm install` dentro del
repositorio instala la última versión 24 disponible, que cumple el requisito.

## Instalación y desarrollo local

```sh
git clone https://github.com/rcronald/orki-app.git
cd orki-app
nvm install    # opcional, solo si usas nvm
npm ci
cp apps/web/.env.example apps/web/.env.local   # y completa los valores
npm run dev
```

`npm ci` instala las dependencias de todo el monorepo a partir del único
`package-lock.json`, que está en la raíz.
`npm run dev` levanta el servidor de desarrollo de Vite en <http://localhost:5173>.
Antes de `npm run dev` hay que preparar `apps/web/.env.local`
con los datos del proyecto de Supabase de desarrollo
y la clave publicable de la instancia de desarrollo de Clerk,
como se explica en
[Variables de entorno de la app](docs/app/variables-de-entorno.md#variables-de-entorno-de-la-app);
sin ese archivo la app arranca,
pero muestra una pantalla de error que dice qué variables faltan.
Las pruebas y el build no necesitan ninguna variable.

Para abrir la app desde el celular en la misma red,
expón el servidor en la red local:

```sh
npm run dev -- --host
```

Todos los scripts de npm, con lo que hace cada uno,
están en [docs/scripts.md](docs/scripts.md).

## Comprobaciones antes de un pull request

Antes de abrir un pull request conviene ejecutar
lo mismo que ejecuta la integración continua:

```sh
npm run lint
npm run format:check
npm run enlaces          # enlaces relativos de los .md
npm run typecheck
npm test
npm run test:scripts
npm run build
npm run build:medicion && npm run presupuesto   # presupuesto de tamaño
```

Según lo que toque el cambio:

- **Base de datos:** `npm run db:test`, `npm run db:concurrencia`
  y `npm run db:types:check`, con Postgres 17
  (ver [Pruebas de la base de datos](docs/operacion/base-de-datos.md#pruebas-de-la-base-de-datos)).
- **Pantallas y flujos:** `npm run test:e2e`
  (ver [Pruebas de extremo a extremo](docs/pruebas.md#pruebas-de-extremo-a-extremo)).

El CI ejecuta además el lint, el formato y las pruebas del proyecto de Python
de `scripts/catalog-import/` (con [uv](https://docs.astral.sh/uv/)),
incluidas las de la carga del catálogo contra un Postgres 17 desechable;
cómo instalarlo y ejecutarlos en local está en
[su README](scripts/catalog-import/README.md).

Las reglas de trabajo (idioma, convenciones que muerden,
flujo de issues y pull requests) están en [CLAUDE.md](CLAUDE.md).

## Estructura del monorepo

```text
orki-app/
├── .claude/agents/            Agentes de Claude Code (base de datos, implementador, investigador)
├── .github/workflows/
│   ├── ci.yml                 Integración continua
│   ├── fotos-de-referencia.yml  Carga manual de las fotos de referencia de iNaturalist
│   ├── importar-catalogo.yml  Importación manual del catálogo
│   └── migraciones.yml        Aplicación de migraciones en Supabase
├── apps/
│   └── web/                   App web (React, Vite, TypeScript, Tailwind CSS, PWA)
│       ├── e2e/               Pruebas de extremo a extremo (Playwright)
│       ├── medicion/          Builds de medición y de las e2e (Clerk simulado)
│       ├── prerender/         Prerenderizado de la portada
│       ├── public/            Iconos y archivos estáticos
│       ├── scripts/           Utilidades de la app (iconos, ilustraciones, portada)
│       ├── src/               Código fuente y pruebas
│       │   ├── account/       Tu cuenta y eliminación de la cuenta
│       │   ├── assets/        Marca, ilustraciones, portada y sin-foto.svg
│       │   ├── auth/          Proveedor de Clerk, apariencia, estados, controles de cuenta, rol, rutas protegidas y token para Supabase
│       │   ├── backoffice/    Backoffice del catálogo (/administracion/catalogo, chunk propio)
│       │   ├── catalog/       Catálogo público (/catalogo)
│       │   ├── collection/    Colección del usuario en memoria: lectura, almacén compartido, búsqueda, agrupación y contadores
│       │   ├── components/    Componentes de la app (estructura con la navegación, página)
│       │   │   └── ui/        Componentes del design system
│       │   ├── config/        Lectura y validación de las variables de entorno
│       │   ├── credits/       Créditos y fuentes (/creditos)
│       │   ├── detail/        Ficha de una planta: galería, acciones, notas y bitácora
│       │   ├── diagnostics/   Panel de diagnóstico de la identidad (solo fuera de producción)
│       │   ├── editing/       Edición de una planta y de sus fotos
│       │   ├── inventory/     Pantalla «Mi colección»: lista, cuadrícula, filtros y exportación
│       │   ├── lib/           Cliente de Supabase (con el token de Clerk), capas de datos y tipos
│       │   ├── log/           Bitácora del ejemplar
│       │   ├── observability/ Sentry: cargador diferido, límite de errores, recorte de datos y ruido
│       │   ├── ownership-check/ «¿Ya la tengo?»
│       │   ├── pages/         Pantallas conectadas a sus datos
│       │   ├── photos/        Preparación, subida, lectura y borrado de fotos
│       │   ├── prerender/     Portada previa que se prerenderiza
│       │   ├── privacy/       Página de privacidad (/privacidad)
│       │   ├── pwa/           Versiones nuevas del service worker
│       │   ├── registration/  Formulario de registro, borradores y fotos pendientes
│       │   ├── routes/        Rutas de la app, enrutador de primer nivel, foco y título por página
│       │   ├── showcase/      Página interna de muestra (solo fuera de producción)
│       │   ├── styles/        Tokens, fuentes y hojas de estilos de los componentes
│       │   ├── telemetry/     Eventos de producto
│       │   └── test/          Utilidades de las pruebas (axe, Clerk simulado)
│       ├── .env.example       Plantilla de las variables de entorno de la app
│       ├── presupuesto-tamano.json  Presupuesto de tamaño del build
│       └── vercel.json        Configuración del despliegue en Vercel
├── docs/                      Documentación (ver el índice más abajo)
├── scripts/
│   ├── catalog-import/        Importación del catálogo y de las fotos de referencia (Python)
│   ├── datos-sin-dueno/       Datos de usuarios que ya no existen en Clerk (datos:sin-dueno)
│   ├── db-desechable/         Base Postgres desechable con el esquema aplicado
│   ├── db-perf/               Catálogo sintético de la medición de la búsqueda (db:perf)
│   ├── enlaces/               Comprobación de enlaces de los .md (enlaces)
│   ├── fotos-de-referencia/   Ayudas del workflow de fotos de referencia
│   ├── medicion/              Medición de la carga y presupuesto de tamaño
│   └── *.mjs                  Un script por orden de npm (ver docs/scripts.md), por ejemplo:
│       ├── db-test.mjs        Pruebas de base de datos (db:test)
│       ├── db-types.mjs       Tipos de TypeScript del esquema (db:types, db:types:check)
│       └── supabase-db.mjs    Scripts de migraciones y datos de ejemplo (db:new, db:status, db:push, db:seed:dev, db:seed:plants)
├── supabase/
│   ├── config.toml            Configuración de la CLI de Supabase
│   ├── datos-ejemplo/         Datos de ejemplo del catálogo, solo para desarrollo (db:seed:dev)
│   ├── migrations/            Migraciones SQL
│   ├── tests/                 Pruebas de base de datos en SQL y de concurrencia
│   └── .env.example           Plantilla de credenciales del proyecto de desarrollo
├── CLAUDE.md                  Reglas de trabajo para personas y agentes
├── eslint.config.js           Configuración de ESLint para todo el repositorio
├── .prettierrc.json           Configuración de Prettier
├── .nvmrc                     Versión de Node
└── package.json               Workspaces y scripts de la raíz
```

Las dependencias se declaran en el `package.json` de cada workspace
y se instalan desde la raíz.
Las herramientas comunes (ESLint, Prettier, la CLI de Supabase)
viven en el `package.json` de la raíz.

Hay dos versiones de TypeScript a propósito.
La app compila y comprueba tipos con TypeScript 7 (`apps/web`).
La raíz instala TypeScript 6 solo para ESLint,
porque `typescript-eslint` todavía no soporta TypeScript 7.
Cuando lo soporte, se elimina el TypeScript de la raíz.

## Documentación

La app, pantalla a pantalla:

- [Autenticación, rutas y sin conexión](docs/app/autenticacion.md):
  Clerk, la tabla de rutas, la portada, el rol de administrador,
  la identidad en Postgres, el modo sin conexión y el service worker.
- [Colección y registro](docs/app/coleccion-y-registro.md):
  «Mi colección», «¿Ya la tengo?», la ficha y el registro de una planta.
- [Fotos](docs/app/fotos.md): compresión, subida, bitácora,
  varias fotos por planta y fotos de referencia.
- [Catálogo](docs/app/catalogo.md): búsqueda y catálogo público.
- [Backoffice](docs/app/backoffice.md) del catálogo.
- [Cuenta, privacidad y créditos](docs/app/cuenta-y-privacidad.md).
- [Marca y design system](docs/app/design-system.md)
  y la guía de [piezas de interfaz](docs/piezas-de-interfaz.md).
- [Glosario de la interfaz](docs/app/textos.md):
  qué palabra va en cada pantalla.
- [Variables de entorno](docs/app/variables-de-entorno.md).
- [Sin conexión: investigación y decisiones](docs/sin-conexion.md).

Pruebas, operación y medidas:

- [Pruebas de extremo a extremo](docs/pruebas.md).
- [Scripts de npm](docs/scripts.md).
- [Base de datos y migraciones](docs/operacion/base-de-datos.md):
  credenciales, migraciones, datos de ejemplo, pruebas, tipos y producción.
- [Despliegue e integración continua](docs/operacion/despliegue-y-ci.md):
  Vercel, flujo de ramas y CI.
- [Errores en Sentry](docs/operacion/errores-en-sentry.md).
- [Cabeceras de seguridad y CSP](docs/operacion/cabeceras-de-seguridad.md):
  las cabeceras de Vercel, la CSP por ambiente y lo que hay que revisar.
- [Medición de la carga y presupuesto de tamaño](docs/medicion-de-carga.md).
- [Indicadores de eventos](docs/indicadores-de-eventos.sql) (consultas SQL).

Base de datos, catálogo e investigaciones:

- [supabase/README.md](supabase/README.md): esquema, RLS, funciones
  y contratos de la base.
- [scripts/catalog-import/README.md](scripts/catalog-import/README.md):
  importación del catálogo y de las fotos de referencia,
  con su [FUENTE.md](scripts/catalog-import/FUENTE.md).
- [scripts/datos-sin-dueno/README.md](scripts/datos-sin-dueno/README.md).
- [iNaturalist: fotos de referencia](docs/inaturalist.md)
  y [por qué hay especies sin taxón](docs/inaturalist-emparejamiento.md).
- [Especificación de la Fase 1](docs/specification.md).
