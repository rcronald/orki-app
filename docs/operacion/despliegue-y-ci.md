# Despliegue e integración continua

Secciones que estaban en el README de la raíz hasta el #288; el índice de la documentación está en el [README](../../README.md#documentación).

## Despliegue en Vercel

La app web se despliega en Vercel, conectado al repositorio de GitHub:

- Cada pull request genera un despliegue de vista previa (ambiente Preview de Vercel) con su propia URL, y Vercel la publica como comentario en el pull request. Cada commit nuevo en el pull request genera una vista previa nueva. Las vistas previas apuntan al proyecto de Supabase de desarrollo.
- Cada push a `main` (al fusionar un pull request) despliega en producción (ambiente Production de Vercel), que apunta al proyecto de Supabase de producción.

Vercel solo construye y publica. Lint, formato, typecheck y pruebas los ejecuta la [integración continua](#integración-continua) de GitHub, que es la que tiene que pasar antes de fusionar; Vercel no los repite. Las migraciones de la base de datos tampoco pasan por Vercel: las aplica su propio workflow (ver [Producción](base-de-datos.md#producción)).

### Configuración versionada

La configuración vive en `apps/web/vercel.json`, porque Vercel lee ese archivo en el directorio raíz del proyecto de Vercel, que es `apps/web`. Define:

- Instalación: `npm ci --workspace=@orki/web`. Vercel ejecuta los comandos dentro de `apps/web`; npm detecta que es un workspace, usa el único `package-lock.json` de la raíz del repositorio y deja las dependencias en el `node_modules` de la raíz. Solo instala las dependencias de la app, no las herramientas de la raíz (ESLint, Prettier, la CLI de Supabase), que el build no necesita.
- Build: `npm run build`, el mismo script `tsc -b && vite build` que ejecuta la integración continua (allí se lanza desde la raíz con `npm run build`, que delega en este).
- Carpeta de salida: `dist`, es decir, `apps/web/dist`.
- Reescritura: cualquier ruta que no corresponda a un archivo del build responde con `index.html`, para que la app de una sola página funcione al abrir o recargar cualquier URL. Vercel sirve primero los archivos que existen, así que la reescritura nunca tapa `sw.js`, el manifest, los iconos ni los archivos de `assets/`. Las rutas bajo `assets/` y los `workbox-*.js` que no existen devuelven 404 en lugar de `index.html`, para que un archivo con hash que falta no se sirva como HTML.
- Cabeceras de seguridad: HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options` y `Cross-Origin-Opener-Policy` en todas las rutas. La CSP, que depende del ambiente, la pone el middleware `apps/web/middleware.ts` (ver [Cabeceras de seguridad y CSP](cabeceras-de-seguridad.md)).
- Caché: los archivos con hash en el nombre (`assets/*` y `workbox-*.js`) se guardan un año como inmutables (`public, max-age=31536000, immutable`). Todo lo demás, en particular `index.html`, `sw.js` y `manifest.webmanifest`, se revalida en cada visita (`public, max-age=0, must-revalidate`), para que una versión nueva llegue en cuanto se despliega (cómo la recibe una pestaña ya abierta: [Service worker: versiones nuevas](../app/autenticacion.md#service-worker-versiones-nuevas)).

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

Las variables de la app (ver [Variables de entorno de la app](../app/variables-de-entorno.md#variables-de-entorno-de-la-app)) se definen en Settings > Environment Variables, con un valor distinto según el ambiente de Vercel:

| Ambiente de Vercel | `VITE_SUPABASE_URL`            | `VITE_SUPABASE_PUBLISHABLE_KEY`             | `VITE_APP_ENV` | `VITE_CLERK_PUBLISHABLE_KEY`                     |
| ------------------ | ------------------------------ | ------------------------------------------- | -------------- | ------------------------------------------------ |
| Production         | URL del proyecto de producción | Clave publicable del proyecto de producción | `prod`         | Clave de la instancia de producción (`pk_live_`) |
| Preview            | URL del proyecto de desarrollo | Clave publicable del proyecto de desarrollo | `dev`          | Clave de la instancia de desarrollo (`pk_test_`) |
| Development        | URL del proyecto de desarrollo | Clave publicable del proyecto de desarrollo | `dev`          | Clave de la instancia de desarrollo (`pk_test_`) |

Vite escribe estos valores en el JavaScript durante el build, así que un cambio de variable solo se aplica en el siguiente despliegue: después de cambiarla hay que volver a desplegar (Redeploy). Si falta alguna, el build termina bien, pero la app muestra la pantalla de error de configuración. El ambiente Development de Vercel solo se usa con la CLI de Vercel (`vercel env pull`, `vercel dev`), que este proyecto no necesita; se rellena igual para que los tres ambientes estén completos. Ninguna de estas variables es secreta: al crearlas se elige el tipo Config, no Secret, para que sus valores sigan siendo legibles en el panel.

Para Sentry (ver [Errores en Sentry](errores-en-sentry.md#errores-en-sentry)) se añaden `VITE_SENTRY_DSN` (Config; el DSN del proyecto en Production y Preview, para que los errores de cada ambiente se separen por `VITE_APP_ENV`) y, para los mapas de código fuente, `SENTRY_AUTH_TOKEN` (Secret), `SENTRY_ORG` y `SENTRY_PROJECT` (Config), en los ambientes cuyos builds deban subirlos. El token vive solo en Vercel: nunca en el repositorio, en un issue ni en un chat.

## Flujo de ramas

El proyecto sigue GitHub Flow:

1. `main` siempre está en estado desplegable. No se hacen commits directos en `main`.
2. Cada cambio se trabaja en una rama creada desde `main` y asociada a un issue, por ejemplo `feat/1-monorepo-base`.
3. Al terminar se abre un pull request hacia `main`. La integración continua ejecuta lint, verificación de formato, typecheck, pruebas y build, y tiene que pasar antes de fusionar.
4. Tras la revisión, el pull request se fusiona en `main` y la rama se borra.

## Integración continua

El workflow `.github/workflows/ci.yml` se ejecuta en cada pull request y en cada push a `main`. El job **Lint, formato, typecheck, pruebas y build** instala las dependencias con `npm ci` usando la versión de Node de `.nvmrc` y la caché de npm, y después ejecuta `lint`, `format:check`, `enlaces`, `typecheck`, `test`, `test:scripts` y `build`, en ese orden, y al final el presupuesto de tamaño (`build:medicion` y `presupuesto`, ver [Medición de la carga y presupuesto de tamaño](../medicion-de-carga.md)) y, sobre ese mismo build, las cabeceras de seguridad (`cabeceras`, ver [Comprobación automática](cabeceras-de-seguridad.md#comprobación-automática)). Si cualquiera de esos pasos falla, el job falla. El job **Pruebas de base de datos** ejecuta `npm run db:test`, `npm run db:concurrencia` y `npm run db:types:check` sobre un Postgres 17 desechable (ver [Pruebas de la base de datos](base-de-datos.md#pruebas-de-la-base-de-datos) y [Tipos de TypeScript del esquema](base-de-datos.md#tipos-de-typescript-del-esquema)). El job **Importación del catálogo (Python)** ejecuta el lint y el formato con ruff, valida la lista curada de híbridos y pasa las pruebas con pytest, con su propio Postgres 17 desechable (ver [su README](../../scripts/catalog-import/README.md)). Las **Pruebas de extremo a extremo** son cuatro jobs, uno por perfil (chromium, firefox, webkit y celular), que prueban los flujos principales en un navegador real (ver [Pruebas de extremo a extremo](../pruebas.md#pruebas-de-extremo-a-extremo)); todavía no son obligatorios. Cuando se suben nuevos commits a un pull request, la ejecución anterior de ese mismo pull request se cancela.

## Acciones fijadas y Dependabot

Cada acción de los workflows va fijada a un SHA de commit, con la versión en un comentario (`actions/checkout@3d3c… # v7.0.1`), no a una etiqueta (#294). Una etiqueta la puede mover quien controle el repositorio de la acción, y varios jobs reciben secretos de producción. `scripts/acciones-fijadas.test.mjs` (dentro de `npm run test:scripts`) falla si alguna `uses:` no cumple.

Para añadir una acción o cambiar su versión a mano, busca el commit de la etiqueta y copia el SHA:

```sh
git ls-remote https://github.com/actions/checkout 'refs/tags/v7*'
```

Si la etiqueta es anotada, el SHA que vale es el de la línea que termina en `^{}`.

`.github/dependabot.yml` abre cada lunes pull requests agrupados para las acciones (actualiza el SHA y el comentario), para npm (versiones menores y parches juntos; las mayores, una por una) y para el importador del catálogo (uv). Pasan por el CI como cualquier otro. `npm audit` da avisos moderados de `glob` y `minimatch` por `workbox-build`, que solo se usan en el build (`npm audit --omit=dev` da cero): no uses `npm audit fix --force`, que baja de versión `vite-plugin-pwa`.
