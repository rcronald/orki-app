# Cabeceras de seguridad y CSP

Qué cabeceras de seguridad sirve orqui.app en Vercel, por qué cada valor, cómo se genera la política de seguridad de contenido (CSP) en cada ambiente y cómo se comprueba (#282). El índice de la documentación está en el [README](../../README.md#documentación).

## Resumen

| Dónde                          | Qué                                                                                                    | Estado                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------- |
| `apps/web/vercel.json`         | Cabeceras fijas para todas las rutas: HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options` y COOP | En firme                     |
| `apps/web/middleware.ts`       | La CSP, compuesta con las variables del despliegue, y `Reporting-Endpoints`                            | Solo informe (`Report-Only`) |
| `apps/web/seguridad/politica.ts` | El generador de la CSP: lo usan el middleware, la comprobación y las pruebas de extremo a extremo      |                              |
| `scripts/cabeceras/`           | `npm run cabeceras`: la comprobación del CI, con sus pruebas                                           |                              |

## Cabeceras en firme

Van en la regla `"/(.*)"` de `apps/web/vercel.json`, así que las sirve el CDN de Vercel en todas las respuestas, también en `sw.js`, el manifiesto y los archivos de `assets/`. No dependen del ambiente.

| Cabecera                    | Valor                                                             | Por qué                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Strict-Transport-Security` | `max-age=63072000`                                                | Dos años solo por HTTPS. Es el valor que [Vercel pone por defecto](https://vercel.com/docs/encryption) en los dominios propios; escrito aquí, la comprobación impide que desaparezca. En las vistas previas (`*.vercel.app`) sustituye al de Vercel, que añade `includeSubDomains; preload`, pero ese dominio ya está en la lista de precarga de los navegadores, que no depende de la cabecera. Sin `includeSubDomains` ni `preload`: obligaría a HTTPS a todos los subdominios del dominio de producción (también los que crean Clerk o el correo) y la lista de precarga no se deshace con facilidad. Se puede endurecer cuando se sepa qué subdominios hay.                                                    |
| `X-Content-Type-Options`    | `nosniff`                                                         | El navegador no adivina el tipo de un archivo: un script o una hoja de estilos solo se ejecuta si se sirve con su tipo. Vercel sirve cada archivo del build con el suyo.                                                                                                                                                                                                                                                                      |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                                 | A otros sitios (Supabase, Clerk, Sentry, un enlace de los créditos) solo les llega el origen, nunca la ruta ni la búsqueda (`/coleccion/<id>`, `?q=`). Es el valor por defecto de los navegadores actuales; fijarlo cubre a los antiguos.                                                                                                                                                                                                      |
| `Permissions-Policy`        | `camera=(self), microphone=(), geolocation=(), payment=(), usb=()` | Apaga lo que la app no usa, también para cualquier marco que se colara. La cámara queda permitida para la propia app: hoy las fotos se eligen con `<input type="file">` (que abre la cámara del sistema y no necesita este permiso), pero así no se bloquea si algún día se usa la cámara del navegador. El selector de archivos no depende de esta cabecera. Solo nombres que reconocen los navegadores, para no llenar la consola de avisos. |
| `X-Frame-Options`           | `DENY`                                                            | Nadie puede meter la app en un marco (clickjacking sobre «Eliminar cuenta» o «Cerrar sesión»). La CSP dice lo mismo con `frame-ancestors 'none'`, pero mientras esté en modo informe no protege; esta cabecera sí, desde ya.                                                                                                                                                                                                                   |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups`                                       | Una página de otro origen que abra la app en una ventana no conserva acceso a ella (`window.opener`). Se permite que las ventanas que abre la app sigan comunicándose con ella: el inicio de sesión con Google de Clerk va por redirección, pero Clerk usa una ventana emergente cuando la app va dentro de un marco o si se configura `oauthFlow="popup"`, y con `same-origin` esa ventana perdería la conexión con la app.                     |

## La CSP

### La política

Para un despliegue de producción con Sentry queda así (una directiva por línea; los dominios entre `<>` salen de las variables, ver [Cómo se genera en cada ambiente](#cómo-se-genera-en-cada-ambiente)):

```text
default-src 'self'
script-src 'self' 'sha256-…' 'sha256-…' https://<Clerk> https://challenges.cloudflare.com https://*.protect.clerk.com
style-src 'self' 'unsafe-inline'
img-src 'self' data: blob: https://<Supabase> https://img.clerk.com
font-src 'self'
connect-src 'self' https://<Supabase> https://<Clerk> https://*.protect.clerk.com:* https://<Sentry>
worker-src 'self' blob:
frame-src https://challenges.cloudflare.com https://*.protect.clerk.com
manifest-src 'self'
object-src 'none'
base-uri 'self'
form-action 'self'
frame-ancestors 'none'
report-uri https://<Sentry>/api/<proyecto>/security/?sentry_key=<clave pública>&sentry_environment=<dev|prod>&sentry_release=<commit>
report-to csp
```

Y, aparte, `Reporting-Endpoints: csp="<la misma dirección de report-uri>"`.

| Directiva         | Por qué                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `script-src`      | El JavaScript de la app (y los `import()` diferidos) es del mismo origen. Los dos scripts en línea de la portada prerrenderada (`prerender/portada-previa-plugin.ts`) van por su hash (ver [Scripts en línea](#scripts-en-línea)). Clerk descarga ClerkJS y su interfaz desde el dominio de Frontend API de la instancia (`/npm/@clerk/clerk-js@6/…` y `/npm/@clerk/ui@…`), Turnstile es el CAPTCHA del registro y `*.protect.clerk.com` la protección contra abuso de Clerk, según la [guía de CSP de Clerk](https://clerk.com/docs/guides/secure/best-practices/csp-headers). Sin `'unsafe-inline'` ni `'unsafe-eval'`: ni la app ni el build usan `eval`, `new Function` ni manejadores `on*` (comprobado en el build). |
| `style-src`       | `'unsafe-inline'` porque los componentes de Clerk inyectan sus estilos en `<style>` al pintarse; la guía de Clerk lo exige y dice que quitarlo está en sus planes. El CSS de la app es del mismo origen.                                                                                                                                                                                                                                              |
| `img-src`         | `blob:` para las fotos (vista previa al registrar, galería y miniaturas, que la app descarga de Storage y muestra desde memoria), `data:` para las imágenes en línea de las bibliotecas, Supabase para las fotos de referencia públicas de las especies (`species-photos`) y `img.clerk.com` para la foto de la cuenta (también la de Google).                                                                                                          |
| `font-src`        | Las fuentes son de la app (`@fontsource`, servidas desde `assets/`), no de Google Fonts.                                                                                                                                                                                                                                                                                                                                                            |
| `connect-src`     | La API de datos y Storage de Supabase, la API de Clerk, la protección de Clerk (en puertos distintos del 443, de ahí `:*`) y la ingesta de Sentry (directa, sin túnel). En las instancias de desarrollo de Clerk (`pk_test_`), además `https://clerk-telemetry.com`, adonde su SDK envía telemetría.                                                                                                                                                  |
| `worker-src`      | El service worker (`sw.js`) es del mismo origen; `blob:` porque lo pide la guía de CSP de Clerk, que puede crear workers en memoria.                                                                                                                                                                                                                                                                                                             |
| `frame-src`       | Los marcos de Turnstile y de la protección de Clerk. Nada más puede ir en un marco dentro de la app.                                                                                                                                                                                                                                                                                                                                                |
| `object-src`, `base-uri` | Sin plugins y sin `<base>` que cambie adónde apuntan las rutas relativas.                                                                                                                                                                                                                                                                                                                                                                    |
| `form-action`     | Los formularios solo se envían a la propia app (Clerk envía los suyos por JavaScript).                                                                                                                                                                                                                                                                                                                                                              |
| `frame-ancestors` | Igual que `X-Frame-Options: DENY`, la forma moderna.                                                                                                                                                                                                                                                                                                                                                                                                |
| `report-uri`, `report-to` | Solo si el build tiene `VITE_SENTRY_DSN`: las violaciones llegan a Sentry como problemas de seguridad, con el ambiente y la versión ([informes de CSP en Sentry](https://docs.sentry.io/platforms/javascript/security-policy-reporting/)). `report-uri` lo entienden todos los navegadores; `report-to` con `Reporting-Endpoints`, los que ya usan la Reporting API.                                                                                  |

En las vistas previas (`VERCEL_ENV=preview`) se añaden los orígenes de la [barra de herramientas de Vercel](https://vercel.com/docs/vercel-toolbar/managing-toolbar#using-a-content-security-policy) (`vercel.live` y compañía), que Vercel inyecta en ellas para los comentarios. En producción no.

Qué no está y por qué:

- Google: el inicio de sesión con Google es una navegación a la página de Google y la vuelta a la app, que la CSP no limita. No se usa Google One Tap.
- `upgrade-insecure-requests`: todo ya va por HTTPS, y en modo informe los navegadores la ignoran con un aviso.
- Nonces: harían falta para quitar `'unsafe-inline'` de `style-src` con Clerk, pero exigen generar el HTML en cada petición; la app es estática.

### Scripts en línea

`index.html` lleva dos scripts en línea, los de la portada prerrenderada: el de la cabecera decide si se muestra y precarga la foto, y el del cuerpo la copia de su plantilla. Pasarlos a un archivo añadiría una petición antes de pintar la portada, así que se permiten por su hash SHA-256, guardado en `apps/web/seguridad/scripts-en-linea.ts`.

Los hashes dependen del código de esos scripts y de los nombres con hash de las fotos de la portada, no del ambiente: valen para desarrollo, vistas previas y producción. Si cambia la portada (su foto o su script), `npm run cabeceras` falla en el CI con el hash nuevo; se actualizan con:

```sh
npm run build:medicion
npm run cabeceras -- --actualizar
```

y se sube el archivo cambiado. Antes, mira que el script nuevo sea el que esperas: el hash permite exactamente ese texto.

### Cómo se genera en cada ambiente

Desarrollo, vistas previas y producción usan instancias distintas de Clerk y proyectos distintos de Supabase (ver [Variables por ambiente](despliegue-y-ci.md#variables-por-ambiente)), así que la CSP no puede ir escrita en `vercel.json`, que es estático. La compone `apps/web/seguridad/politica.ts` a partir de las mismas variables con las que se construye la app:

| De dónde                     | Qué da                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`          | El origen de Supabase (API, Storage y fotos públicas).                                                     |
| `VITE_CLERK_PUBLISHABLE_KEY` | El dominio de Frontend API de Clerk, que va dentro de la clave (en base64, como lo decodifica el SDK de Clerk); con `pk_test_`, la telemetría de desarrollo. |
| `VITE_SENTRY_DSN`            | El origen de la ingesta y la dirección de los informes. La clave del DSN es la pública: ya va en el JavaScript. Ningún DSN se escribe en el repositorio. |
| `VITE_APP_ENV`               | El ambiente de los informes en Sentry (`sentry_environment`).                                              |
| `VERCEL_ENV`                 | En `preview`, la barra de herramientas de Vercel.                                                          |
| `VERCEL_GIT_COMMIT_SHA`      | La versión de los informes en Sentry (`sentry_release`).                                                   |

Quien la pone en las respuestas es el **middleware de Vercel** ([Routing Middleware](https://vercel.com/docs/routing-middleware), `apps/web/middleware.ts`, con `next()` de `@vercel/functions`). Corre antes de servir cada página, lee esas variables (Vercel las da también en tiempo de ejecución, y no cambian sin un despliegue nuevo) y añade la CSP y `Reporting-Endpoints`; la calcula una vez por instancia. Su `matcher` lo deja fuera de `assets/`, `workbox-*` y `sw.js` (con CSP, `sw.js` limitaría al propio service worker), pero no de `/index.html`, que es lo que precachea el service worker: la app instalada sirve esa respuesta, con su CSP, sin volver a pasar por el middleware. Si falta o no vale alguna variable, la página se sirve sin CSP y el error queda en los registros de la función, en lugar de fallar cada visita.

Alternativas que se descartaron:

- **`vercel.json` con dominios comodín** (`*.supabase.co`, `*.clerk.accounts.dev`): permitiría enviar datos a cualquier proyecto de Supabase o instancia de Clerk, no solo a los nuestros, y aun así habría que escribir a mano el dominio de Clerk de producción.
- **`vercel.ts` o `vercel.mjs`**, la configuración programática de Vercel, que se evalúa al construir y puede leer las variables: sustituye a `vercel.json` (no pueden convivir), así que habría que mover allí toda la configuración. Sería la opción sin código en cada petición; queda como alternativa si el middleware da problemas (ver [Cambiar de mecanismo](#cambiar-de-mecanismo)).
- **Build Output API** (que el build escriba `.vercel/output/config.json` con las cabeceras): sustituye la salida que Vercel genera para Vite, rutas y reescrituras incluidas; un error dejaría la app sin rutas.
- **`<meta http-equiv="Content-Security-Policy">`** generada en el build: no admite el modo informe, `frame-ancestors` ni `report-uri`.

Coste del middleware: una invocación por cada página pedida a Vercel (la primera visita y cada recarga o enlace abierto en el navegador sin la app instalada; con el service worker activo, las navegaciones dentro de la app no llegan a Vercel). Se factura como cómputo de funciones.

#### Cambiar de mecanismo

Si el middleware no conviniera, `politica.ts` no cambia: lo que cambia es quién la llama. Con `vercel.mjs`, se mueve el contenido de `vercel.json` a su `config` y se añade una regla de cabeceras para las páginas con `cabecerasDeLaPolitica(process.env, …)`.

## Modo informe y paso a obligatoria

Hoy la CSP va como `Content-Security-Policy-Report-Only`: el navegador no bloquea nada, solo avisa en la consola y envía el informe a Sentry. Las cabeceras firmes, en cambio, ya protegen.

Para hacerla obligatoria, una vez revisada la vista previa (ver la lista siguiente) y una semana de informes en Sentry sin violaciones de la app, se cambia **una línea** de `apps/web/seguridad/politica.ts`:

```ts
export const MODO_CSP: ModoCsp = 'obligatoria'
```

Con eso el middleware envía `Content-Security-Policy`. Conviene hacerlo en un pull request propio y repetir la lista en su vista previa, ya bloqueando. Volver atrás es la misma línea.

## Comprobación automática

`npm run cabeceras` (`scripts/cabeceras/index.mjs`) corre en el CI después del presupuesto de tamaño, sobre el build de `npm run build:medicion` (la app de producción con las variables ficticias de `scripts/medicion/entorno.mjs`). Falla si:

- falta en `vercel.json` alguna de las cabeceras firmes, o tiene otro valor (`CABECERAS_FIRMES` en `scripts/cabeceras/comprobar.mjs`);
- `index.html` tiene un script en línea cuyo hash no está en `scripts-en-linea.ts`, un manejador `on*` o una dirección `javascript:`, que un hash no puede permitir;
- la política no permite Supabase (en `connect-src` e `img-src`), Clerk (en `script-src` y `connect-src`) o Sentry (en `connect-src`);
- el código del build (JavaScript, CSS, HTML y manifiesto) contiene un origen que la política no cubre y que no está en `ORIGENES_SOLO_ENLACE` (enlaces que se abren al pulsarlos, espacios de nombres XML y textos de ayuda de las bibliotecas). Si la app de verdad carga algo de un origen nuevo, se añade a `politica.ts`; si es solo un enlace, a esa lista con su motivo. Es una comprobación por texto: no ve un origen que se construya por partes en tiempo de ejecución, como el de Clerk (que sale de la clave); eso lo cubren las pruebas de extremo a extremo.

Sus pruebas (`scripts/cabeceras/*.test.mjs`, en `npm run test:scripts`) cubren el generador con entornos de producción y de vista previa, el middleware (con y sin variables, y su `matcher`), cada caso de fallo y que el `vercel.json` real tiene las cabeceras.

Con `--entorno-del-proceso` se comprueba un build hecho con las variables reales del proceso (por ejemplo, en local tras un build con las de desarrollo) en lugar de las ficticias.

### En las pruebas de extremo a extremo

El servidor de las pruebas (`scripts/servir-e2e.mjs`) sirve la app con las cabeceras de la regla `"/(.*)"` de `vercel.json` y con la CSP **obligatoria**, generada por el mismo `politica.ts` con las variables ficticias del build de las pruebas (Supabase, Clerk y Sentry en `*.orki.invalid`) en las mismas rutas que el `matcher` del middleware (`scripts/cabeceras/de-las-pruebas.mjs`). Así se prueba el generador, no una copia de la política. La fixture `violacionesCsp` (`apps/web/e2e/soporte/fixtures.ts`) escucha el evento `securitypolicyviolation` en todas las pruebas y cualquier violación hace fallar la prueba; si la prueba ya falló por otra cosa, las violaciones se adjuntan al informe, porque suelen ser la causa.

`apps/web/e2e/cabeceras-de-seguridad.spec.ts` comprueba las cabeceras de una página y de un archivo con hash, que la CSP bloquea de verdad un script en línea inyectado, y recorre portada prerrenderada, catálogo público, acceso, colección, registro con foto y ficha sin ninguna violación ni aviso de CSP en la consola.

Lo que las pruebas no cubren: el script y las pantallas reales de Clerk (están simulados), Turnstile, la foto de la cuenta de `img.clerk.com`, el envío real a Sentry y el servidor de versiones de `actualizacion.spec.ts`, que no pone cabeceras. Para eso, la lista siguiente.

## Qué revisar en una vista previa

En la vista previa del pull request, con las herramientas de desarrollo abiertas (consola y red) y en al menos Chrome y Safari (mejor también un iPhone):

1. **Que el middleware se despliega y corre.** En el despliegue de Vercel, que el build no falle (por ejemplo, con `proxy_runtime_mismatch`) y que aparezca el middleware entre las funciones. En la pestaña de red, la respuesta de `/`, de `/coleccion` y de `/index.html` lleva `Content-Security-Policy-Report-Only` con los dominios de **desarrollo** (Supabase de desarrollo, la instancia `*.clerk.accounts.dev`) y `Reporting-Endpoints`; la de un archivo de `assets/` y la de `sw.js`, no. Que el tiempo de respuesta de la página no se dispara.
2. **Cabeceras firmes** en cualquier respuesta: `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options` y `Cross-Origin-Opener-Policy`.
3. **Inicio de sesión con correo** (código de verificación) y **con Google**: entrar, volver a la página pedida y cerrar sesión, sin avisos de CSP en la consola.
4. **Registro de una cuenta nueva con el CAPTCHA** (Turnstile) visible y resuelto, sin avisos.
5. **Editor de perfil de Clerk** desde «Mi cuenta»: cambiar la foto de la cuenta y ver que el avatar (de `img.clerk.com`) se pinta.
6. **Registro de una planta con fotos** (desde la galería y, en el celular, con la cámara), su ficha con la galería, editar las fotos y la bitácora con foto.
7. **Catálogo público** con fotos de referencia de las especies, y «¿Ya la tengo?».
8. **Backoffice** del catálogo con una cuenta `catalog_admin`.
9. **Sentry:** en la consola, `orkiErrorDePrueba()` llega a Sentry como siempre; y una violación de prueba (por ejemplo, en la consola: `document.head.append(Object.assign(document.createElement('script'), { textContent: '1' }))`) llega a Sentry como problema de seguridad, con el ambiente `dev`.
10. **PWA:** instalarla (Chrome de escritorio y Android; en iPhone, «Añadir a pantalla de inicio»), abrirla sin conexión y comprobar que la respuesta servida por el service worker conserva la CSP y que no hay avisos; aceptar una versión nueva con «Actualizar».
11. **Barra de herramientas de Vercel** (comentarios) en la vista previa, sin avisos.
12. Que **ningún aviso** de CSP de la consola sea de la app (los de extensiones del navegador no cuentan).

Después de fusionar, lo mismo en producción con los dominios de producción, mirando sobre todo los informes de Sentry durante unos días antes del paso a obligatoria.

## Qué tiene que configurar el dueño

Nada nuevo para que funcione: el middleware usa las variables que ya existen en Vercel (`VITE_*`, y `VERCEL_ENV` y `VERCEL_GIT_COMMIT_SHA`, que Vercel da solo con «Automatically expose System Environment Variables», ya activado para Sentry). Conviene revisar:

- En **Sentry**, que el proyecto acepte los informes de seguridad: Settings > Projects > (el proyecto) > Security Headers muestra la dirección (debe coincidir con la que genera el middleware) y, en Inbound Filters, que no se descarten. Opcional: una alerta para los problemas de tipo CSP.
- En **Vercel**, tras el primer despliegue, que el middleware aparece en la pestaña de funciones del despliegue y sus registros no muestran «No se pudo componer la CSP».
- Si algún día se usa un dominio propio en la instancia de desarrollo de Clerk, o el proxy de Clerk (`proxyUrl`), la política se adapta sola en lo primero (sale de la clave), pero lo segundo cambia de dónde sale el script de Clerk y habría que revisarla.
