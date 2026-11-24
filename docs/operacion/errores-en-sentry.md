# Sentry

Secciones que estaban en el README de la raíz hasta el #288; el índice de la documentación está en el [README](../../README.md#documentación).

## Errores en Sentry

Los errores de la app se reportan a [Sentry](https://docs.sentry.io/platforms/javascript/guides/react/) con `@sentry/react` (versión 11), solo si el build tiene `VITE_SENTRY_DSN`. Sin esa variable no se descarga ni se inicializa nada de Sentry: el chunk del SDK ni siquiera se genera. Así corren el servidor local, las pruebas y la integración continua.

### Cómo está montado

- **Carga diferida.** En el JavaScript inicial solo va un cargador pequeño (`src/observability/reporter.ts`) y el límite de errores de React. El SDK (`src/observability/sentry.ts`, unos 33 kB comprimidos) se descarga con un import dinámico después del primer pintado, cuando el navegador está libre. Los errores que ocurren antes (errores no capturados, promesas rechazadas y los del límite de errores) se guardan en un búfer de 10 como mucho y se envían al cargar el SDK.
- **Ambiente y versión.** Cada evento lleva el ambiente (`VITE_APP_ENV`: `dev` o `prod`) y la versión, que es el commit desplegado: Vercel lo expone en el build como `VERCEL_GIT_COMMIT_SHA` y `vite.config.ts` lo escribe en una etiqueta `<meta name="orki-release">` del HTML. Va en el HTML y no en el JavaScript para que los chunks no cambien de nombre en cada despliegue. En local no hay versión.
- **Límite de errores.** Si un componente falla al pintarse, en lugar de una página en blanco aparece la pantalla "Algo salió mal" con el botón "Recargar la página", y el error se reporta con la pila de componentes (`src/observability/ErrorBoundary.tsx`). Si lo que falla es la carga de un chunk con conexión (un despliegue de por medio), la página se recarga una vez y no se reporta (ver [Service worker: versiones nuevas](../app/autenticacion.md#service-worker-versiones-nuevas)).
- **Usuario.** Solo el id de Clerk del usuario con sesión (`src/auth/ObservedUser.tsx`).
- **Ruido ignorado** (`src/observability/noise.ts`): los fallos de red con el navegador sin conexión (incluidos los errores de la app con motivo `offline` y el de Clerk sin conexión), los chunks que no llegan mientras la página ya se recarga por una versión nueva (#278) y los errores lanzados por extensiones del navegador. Con conexión, un "Failed to fetch" sí se envía.

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
