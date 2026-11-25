# Despliegue e integración continua

Secciones que estaban en el README de la raíz hasta el #288; el índice de la documentación está en el [README](../../README.md#documentación).

## Despliegue en Vercel

La app web se despliega en Vercel, conectado al repositorio de GitHub:

- Cada pull request genera un despliegue de vista previa (ambiente Preview de Vercel) con su propia URL, y Vercel la publica como comentario en el pull request. Cada commit nuevo en el pull request genera una vista previa nueva. Las vistas previas apuntan al proyecto de Supabase de desarrollo.
- Producción (ambiente Production de Vercel, que apunta al proyecto de Supabase de producción) se publica después de cada push a `main`, pero no la dispara Vercel: la dispara el workflow de migraciones cuando ha terminado de aplicarlas (ver [Despliegue ordenado](#despliegue-ordenado)).

Vercel solo construye y publica. Lint, formato, typecheck y pruebas los ejecuta la [integración continua](#integración-continua) de GitHub, que es la que tiene que pasar antes de fusionar; Vercel no los repite. Las migraciones de la base de datos tampoco pasan por Vercel: las aplica su propio workflow (ver [Producción](base-de-datos.md#producción)).

### Despliegue ordenado

Hasta el #281, el mismo push a `main` ponía en marcha dos cosas sin orden entre ellas: Vercel publicaba la web y el workflow de migraciones aplicaba las de `supabase/migrations/`. La web nueva podía llegar minutos antes que el esquema que necesita (una columna nueva en una consulta hace que PostgREST rechace la consulta entera: «Mi colección» fallaría para todos), y si la migración fallaba se quedaba así. Ahora:

1. `apps/web/vercel.json` tiene `"git": { "deploymentEnabled": { "main": false } }`: un push a `main` ya no despliega producción. Las vistas previas de los pull requests siguen igual.
2. El workflow **Migraciones** corre en cada push a `main`, aplica las migraciones pendientes (si no hay, no hace nada) y, solo si termina bien, llama al **Deploy Hook** de producción de Vercel, cuya URL es el secreto `VERCEL_DEPLOY_HOOK_URL` del environment `prod`. Vercel construye y publica entonces la cabeza de `main`, con su middleware de cabeceras (`apps/web/middleware.ts`) como en cualquier otro despliegue. El resumen de la ejecución deja el código HTTP de la respuesta (nunca la URL, que solo llega al script por el entorno y está enmascarada).
3. Si una migración falla, el hook no se llama y la web publicada sigue siendo la anterior, que es compatible con el esquema que quedó (ver [Expandir y contraer](../../supabase/README.md#expandir-y-contraer)).
4. Si al terminar `main` ya avanzó a otro commit, no llama al hook: el hook publica la cabeza de `main`, y ese commit puede traer migraciones que aún no se han aplicado. Lo publica la ejecución de ese commit, que espera a que termine esta. Queda una ventana de segundos (un push justo entre la comprobación y la llamada) que no se puede cerrar sin la API de Vercel.
5. Con el hook llamado, la **prueba de humo** (`scripts/despliegue/humo.mjs`, sin sesión ni secretos) espera hasta 15 minutos a que la portada sirva este commit (el build lo escribe en `<meta name="orki-release">`), comprueba que la portada y su script principal responden y que `search_public_species` responde con la clave publicable, con las mismas cabeceras que manda la app sin sesión. Si faltan las variables `APP_URL` o `SUPABASE_PUBLISHABLE_KEY` del environment `prod`, se omite con un aviso. No comprueba nada con sesión: haría falta un usuario de prueba de Clerk en producción, que hoy se evita a propósito (#25).

Lanzar el workflow a mano con `prod` (desde `main`) vuelve a publicar la web aunque no haya migraciones: es la forma de republicar sin pasar por el panel de Vercel. Con `dev` no despliega nada.

Si falta el secreto, el workflow termina en el primer paso con un `::error::` que dice qué crear y dónde, sin haber aplicado ninguna migración.

Los workflows programados de [Retención y limpieza](retencion-y-limpieza.md) no dependen de este: no publican nada ni esperan al despliegue. Comparten con él el environment `prod`, y la restricción de rama de `prod` no les afecta porque ya corren desde `main` (ver [Producción](base-de-datos.md#producción)).

**Puesta en marcha** (una vez; si `vercel.json` llega a `main` sin el secreto, `main` deja de publicarse):

1. En Vercel, proyecto > Settings > Git > Deploy Hooks: crea un hook (por ejemplo «GitHub Actions: producción») con la rama `main`, que es la de producción, y copia su URL. Quien tiene la URL puede desplegar: no la pegues en ningún issue, chat ni registro.
2. En GitHub, guárdala como secreto del environment `prod` (no del repositorio): `gh secret set VERCEL_DEPLOY_HOOK_URL --env prod -R rcronald/orki-app`, que la pide sin mostrarla.
3. Opcional, para la prueba de humo: `gh variable set APP_URL --env prod -R rcronald/orki-app --body 'https://<dominio de producción>'` y `gh variable set SUPABASE_PUBLISHABLE_KEY --env prod -R rcronald/orki-app --body '<clave publicable de producción>'`.

### Revertir una migración en producción

No hay migraciones «hacia atrás»: la CLI de Supabase no las tiene y una migración ya aplicada en `main` no se edita ni se borra.

1. **Lo primero, la web.** Si lo que falla es la web nueva y la migración está bien, vuelve a la versión anterior en Vercel (paso 4) y corrige con calma.
2. **Migración correctiva hacia delante** (lo normal). Crea una migración nueva que deshaga o arregle el cambio (`npm run db:new -- corregir_...`), con sus pruebas, pruébala en desarrollo y fusiónala como cualquier otra: el workflow la aplica y publica la web. Si una migración falló al aplicarse, la CLI la aplica en su propia transacción y no la registra como aplicada, así que producción se queda como estaba: en ese caso se puede corregir el mismo archivo en un pull request nuevo, porque no llegó a aplicarse en producción (si ya estaba aplicado en desarrollo, deja también desarrollo como corresponda), y volver a fusionar. El esquema de antes está en el artefacto `esquema-previo-prod-...` de la ejecución que la aplicó (Actions > Migraciones > la ejecución > Artifacts), para comparar qué cambió.
3. **Restaurar una copia de Supabase** (último recurso, si se perdieron o se estropearon datos). Qué copias hay depende del plan del proyecto de producción: compruébalo en el panel de Supabase, proyecto de producción > Database > Backups (copias diarias programadas y, si está contratado, Point in Time Recovery), y anota aquí lo que ofrece y cuántos días guarda. Antes de restaurar, ten en cuenta que restaurar devuelve **toda** la base al momento de la copia: se pierde todo lo escrito después (plantas, fotos registradas, bitácora, cambios del catálogo), y según la documentación de Supabase los archivos de Storage no forman parte de la copia de la base, así que pueden quedar fotos sin fila o filas sin foto (ver [Limpieza de fotos huérfanas](../../supabase/README.md#limpieza-de-fotos-huérfanas)). La propia página de Backups explica el procedimiento y si el proyecto queda sin servicio mientras tanto. Después de restaurar, `npm run db:status` en el workflow (lanzándolo a mano con `prod`) dirá qué migraciones considera aplicadas; las posteriores a la copia se volverán a aplicar en la siguiente ejecución, así que antes hay que retirar o corregir la que causó el problema.
4. **Volver a un despliegue anterior en Vercel.** Panel de Vercel > proyecto > Deployments, elige el último despliegue de producción bueno > menú > «Instant Rollback» (o «Promote to Production»). Es inmediato y no reconstruye nada. Según la documentación de Vercel, tras un Instant Rollback los despliegues nuevos de producción dejan de asignarse solos al dominio hasta que se deshace («Undo Rollback») o se promueve otro: compruébalo en el panel, porque mientras tanto el Deploy Hook construye pero no publica. La web anterior funciona con el esquema nuevo si las migraciones siguen la regla [Expandir y contraer](../../supabase/README.md#expandir-y-contraer). Las PWA que ya tenían la versión nueva recibirán la anterior como una versión más, con el aviso de siempre (ver [Service worker: versiones nuevas](../app/autenticacion.md#service-worker-versiones-nuevas)).

### Qué hacer si el despliegue no se dispara

Mira la ejecución de **Migraciones** del commit (Actions > Migraciones, o el check del commit en `main`). Su resumen dice qué migraciones había, si se copió el esquema y qué respondió Vercel.

| Lo que ves                                                                                    | Qué pasa y qué hacer                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No hay ninguna ejecución del commit                                                           | El workflow no se lanzó (Actions desactivado, o un error de sintaxis del YAML, que GitHub muestra en la pestaña Actions). Corrige y lánzalo a mano con `prod` desde `main`.                                                                                                                                                                                |
| «Waiting» o «Queued»                                                                          | Espera la aprobación del environment `prod` (si tiene revisores obligatorios) o a que termine otra ejecución sobre `prod`. Apruébala o espera.                                                                                                                                                                                                             |
| Falla en «Comprobar la rama y la configuración» con «Falta el secreto VERCEL_DEPLOY_HOOK_URL» | Crea el Deploy Hook y el secreto («Puesta en marcha» en [Despliegue ordenado](#despliegue-ordenado)) y pulsa «Re-run jobs». No se aplicó nada.                                                                                                                                                                                                             |
| Falla al simular, al copiar el esquema o al aplicar                                           | Una credencial, la conexión o la propia migración. No se publicó la web, y la anterior sigue funcionando. Lee el registro del paso; si es la migración, corrígela con un pull request nuevo ([Revertir una migración en producción](#revertir-una-migración-en-producción)). Si fue algo pasajero (la red, Docker al copiar el esquema), «Re-run jobs».    |
| «No se dispara: main ya está en …»                                                            | Es lo esperado: la ejecución del commit más nuevo publicará la web. Si esa falla, se queda publicada la de antes de los dos.                                                                                                                                                                                                                               |
| Falla en «Publicar la web» con un código HTTP                                                 | Las migraciones están aplicadas, la web no. Un 404 o un 4xx: el hook se borró o se regeneró en Vercel; crea otro y actualiza el secreto (`gh secret set VERCEL_DEPLOY_HOOK_URL --env prod -R rcronald/orki-app`). Un 5xx o sin respuesta tras tres intentos: Vercel tenía un problema; «Re-run jobs» (las migraciones ya aplicadas no se repiten).        |
| Falla la prueba de humo porque producción no sirve el commit                                  | Vercel recibió el hook pero no publicó: mira el despliegue en su panel (Deployments). Un build que falla, un Instant Rollback sin deshacer o un hook creado para otra rama. Si el build está bien y solo tardó, no hay nada que hacer.                                                                                                                     |
| Falla la prueba de humo en la portada, el script o `search_public_species`                    | La web publicada o la base no responden como deben: compruébalo en el navegador sin sesión. Si es la web, vuelve al despliegue anterior en Vercel; si es la base, una migración correctiva.                                                                                                                                                                |

**Para publicar de urgencia**, lanza Migraciones a mano con `prod` desde `main`, que aplica lo pendiente antes de publicar. Usar «Redeploy» en el panel de Vercel también publica, pero sin comprobar las migraciones: solo si sabes que no hay ninguna pendiente.

### Configuración versionada

La configuración vive en `apps/web/vercel.json`, porque Vercel lee ese archivo en el directorio raíz del proyecto de Vercel, que es `apps/web`. Define:

- Instalación: `npm ci --workspace=@orki/web`. Vercel ejecuta los comandos dentro de `apps/web`; npm detecta que es un workspace, usa el único `package-lock.json` de la raíz del repositorio y deja las dependencias en el `node_modules` de la raíz. Solo instala las dependencias de la app, no las herramientas de la raíz (ESLint, Prettier, la CLI de Supabase), que el build no necesita.
- Build: `npm run build`, el mismo script `tsc -b && vite build` que ejecuta la integración continua (allí se lanza desde la raíz con `npm run build`, que delega en este).
- Carpeta de salida: `dist`, es decir, `apps/web/dist`.
- Despliegue automático de `main` desactivado: `"git": { "deploymentEnabled": { "main": false } }`. Producción la publica el workflow de migraciones con un Deploy Hook (ver [Despliegue ordenado](#despliegue-ordenado)); las vistas previas de las demás ramas siguen automáticas.
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
4. Tras la revisión, el pull request se fusiona en `main` y la rama se borra. El workflow de migraciones aplica las pendientes y publica la web en producción (ver [Despliegue ordenado](#despliegue-ordenado)).

## Integración continua

El workflow `.github/workflows/ci.yml` se ejecuta en cada pull request y en cada push a `main`. El job **Lint, formato, typecheck, pruebas y build** instala las dependencias con `npm ci` usando la versión de Node de `.nvmrc` y la caché de npm, y después ejecuta `lint`, `format:check`, `enlaces`, `typecheck`, `test`, `test:scripts` y `build`, en ese orden, y al final el presupuesto de tamaño (`build:medicion` y `presupuesto`, ver [Medición de la carga y presupuesto de tamaño](../medicion-de-carga.md)) y, sobre ese mismo build, las cabeceras de seguridad (`cabeceras`, ver [Comprobación automática](cabeceras-de-seguridad.md#comprobación-automática)). Si cualquiera de esos pasos falla, el job falla. El job **Pruebas de base de datos** ejecuta `npm run db:test`, `npm run db:concurrencia` y `npm run db:types:check` sobre un Postgres 17 desechable (ver [Pruebas de la base de datos](base-de-datos.md#pruebas-de-la-base-de-datos) y [Tipos de TypeScript del esquema](base-de-datos.md#tipos-de-typescript-del-esquema)). El job **Importación del catálogo (Python)** ejecuta el lint y el formato con ruff, valida la lista curada de híbridos y pasa las pruebas con pytest, con su propio Postgres 17 desechable (ver [su README](../../scripts/catalog-import/README.md)). Las **Pruebas de extremo a extremo** son cuatro jobs, uno por perfil (chromium, firefox, webkit y celular), que prueban los flujos principales en un navegador real (ver [Pruebas de extremo a extremo](../pruebas.md#pruebas-de-extremo-a-extremo)); todavía no son obligatorios. Cuando se suben nuevos commits a un pull request, la ejecución anterior de ese mismo pull request se cancela.

Otro workflow, `.github/workflows/migraciones-y-codigo.yml` (**Migraciones separadas del código de la app**), comprueba en cada pull request la regla [Expandir y contraer](../../supabase/README.md#expandir-y-contraer): falla si el pull request toca `supabase/migrations/` y también `apps/web/src`, salvo `lib/database.types.ts`, `lib/database.ts` y `lib/database.test.ts`. Se salta con la etiqueta «migración con código» en el pull request: entonces pasa, con un aviso en la ejecución. Corre también al poner o quitar etiquetas. No es obligatorio para fusionar.

## Acciones fijadas y Dependabot

Cada acción de los workflows va fijada a un SHA de commit, con la versión en un comentario (`actions/checkout@3d3c… # v7.0.1`), no a una etiqueta (#294). Una etiqueta la puede mover quien controle el repositorio de la acción, y varios jobs reciben secretos de producción. `scripts/acciones-fijadas.test.mjs` (dentro de `npm run test:scripts`) falla si alguna `uses:` no cumple.

Para añadir una acción o cambiar su versión a mano, busca el commit de la etiqueta y copia el SHA:

```sh
git ls-remote https://github.com/actions/checkout 'refs/tags/v7*'
```

Si la etiqueta es anotada, el SHA que vale es el de la línea que termina en `^{}`.

`.github/dependabot.yml` abre cada lunes pull requests agrupados para las acciones (actualiza el SHA y el comentario), para npm (versiones menores y parches juntos; las mayores, una por una) y para el importador del catálogo (uv). Pasan por el CI como cualquier otro. `npm audit` da avisos moderados de `glob` y `minimatch` por `workbox-build`, que solo se usan en el build (`npm audit --omit=dev` da cero): no uses `npm audit fix --force`, que baja de versión `vite-plugin-pwa`.
