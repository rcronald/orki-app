# Orki

Orki es una aplicación web para coleccionistas de orquídeas. Es una PWA pensada primero para el celular y con la interfaz en español. En la Fase 1 cada persona registra las orquídeas que tiene y, al ver una nueva en una tienda o un vivero, comprueba al instante si ya la tiene para no comprarla repetida.

La especificación completa de la Fase 1 está en [docs/specification.md](docs/specification.md).

## Estado actual

El repositorio contiene la base del monorepo: la app web con React, Vite, TypeScript y Tailwind CSS, configurada como PWA, junto con el lint, el formato, las pruebas y la integración continua. Todavía no hay base de datos, autenticación, despliegue ni variables de entorno; Supabase, Vercel y la autenticación llegan en issues posteriores. Para levantar el proyecto en local no hace falta ninguna cuenta ni configuración adicional.

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
npm run dev
```

`npm ci` instala las dependencias de todo el monorepo a partir del único `package-lock.json`, que está en la raíz. `npm run dev` levanta el servidor de desarrollo de Vite en <http://localhost:5173>.

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

La app web tiene además un script propio para regenerar los iconos provisionales de la PWA en `apps/web/public`:

```sh
npm run icons --workspace=apps/web
```

## Estructura del monorepo

```text
orki-app/
├── .github/workflows/ci.yml   Integración continua
├── apps/
│   └── web/                   App web (React, Vite, TypeScript, Tailwind CSS, PWA)
│       ├── public/            Iconos y archivos estáticos
│       ├── scripts/           Utilidades de la app (generación de iconos)
│       └── src/               Código fuente y pruebas
├── docs/
│   └── specification.md       Especificación de la Fase 1
├── scripts/
│   └── catalog-import/        Importación del catálogo de especies (pendiente)
├── supabase/                  Configuración de Supabase (pendiente)
├── eslint.config.js           Configuración de ESLint para todo el repositorio
├── .prettierrc.json           Configuración de Prettier
├── .nvmrc                     Versión de Node
└── package.json               Workspaces y scripts de la raíz
```

Las dependencias se declaran en el `package.json` de cada workspace y se instalan desde la raíz. Las herramientas comunes (ESLint, Prettier) viven en el `package.json` de la raíz.

Hay dos versiones de TypeScript a propósito. La app compila y comprueba tipos con TypeScript 7 (`apps/web`). La raíz instala TypeScript 6 solo para ESLint, porque `typescript-eslint` todavía no soporta TypeScript 7. Cuando lo soporte, se elimina el TypeScript de la raíz.

## Flujo de ramas

El proyecto sigue GitHub Flow:

1. `main` siempre está en estado desplegable. No se hacen commits directos en `main`.
2. Cada cambio se trabaja en una rama creada desde `main` y asociada a un issue, por ejemplo `feat/1-monorepo-base`.
3. Al terminar se abre un pull request hacia `main`. La integración continua ejecuta lint, verificación de formato, typecheck, pruebas y build, y tiene que pasar antes de fusionar.
4. Tras la revisión, el pull request se fusiona en `main` y la rama se borra.

## Integración continua

El workflow `.github/workflows/ci.yml` se ejecuta en cada pull request y en cada push a `main`. Instala las dependencias con `npm ci` usando la versión de Node de `.nvmrc` y la caché de npm, y después ejecuta `lint`, `format:check`, `typecheck`, `test` y `build`, en ese orden. Si cualquiera de esos pasos falla, el job falla. Cuando se suben nuevos commits a un pull request, la ejecución anterior de ese mismo pull request se cancela.
