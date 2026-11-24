# Configuración de la app

Secciones que estaban en el README de la raíz hasta el #288; el índice de la documentación está en el [README](../../README.md#documentación).

## Variables de entorno de la app

La app web lee cuatro variables de entorno obligatorias y una opcional, la de Sentry. Vite solo expone al navegador las que empiezan por `VITE_`, y su valor queda escrito en el JavaScript del build, así que aquí nunca va un secreto.

| Variable                        | Qué es                                                                                                                 | Dónde se obtiene                                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`             | URL del proyecto de Supabase, con `https`.                                                                             | En el panel de Supabase, botón Connect o Project Settings > Data API (Project URL).                |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Clave publicable del proyecto. Empieza por `sb_publishable_`.                                                          | En Project Settings > API Keys. No uses nunca una clave secreta (`sb_secret_`); la app la rechaza. |
| `VITE_APP_ENV`                  | Ambiente al que apunta la app: `dev` o `prod`.                                                                         | Lo decide quien configura el ambiente. Coincide con los nombres de los environments de GitHub.     |
| `VITE_CLERK_PUBLISHABLE_KEY`    | Clave publicable de la instancia de Clerk del ambiente. Empieza por `pk_test_` (desarrollo) o `pk_live_` (producción). | En el panel de Clerk, página API keys. No uses nunca la clave secreta (`sk_`); la app la rechaza.  |
| `VITE_SENTRY_DSN` (opcional)    | DSN del proyecto de Sentry. Sin él, Sentry queda apagado (ver [Errores en Sentry](../operacion/errores-en-sentry.md#errores-en-sentry)).                | En Sentry, Settings > Projects > (el proyecto) > Client Keys (DSN). No es un secreto.              |

La URL y las claves publicables no son secretas, pero tampoco se versionan, porque cambian de un ambiente a otro. La clave secreta de Clerk no la usa la app y no debe aparecer en el repositorio, en un issue ni en un chat.

### Preparar el `.env` local

En tu máquina la app apunta siempre al proyecto de Supabase de desarrollo. Copia la plantilla y completa los valores:

```sh
cp apps/web/.env.example apps/web/.env.local
```

`apps/web/.env.local` está ignorado por git. Pon en él la URL y la clave publicable del proyecto de Supabase de desarrollo, la clave publicable de la instancia de desarrollo de Clerk (`pk_test_`) y deja `VITE_APP_ENV=dev`. Si cambias el archivo con el servidor en marcha, reinicia `npm run dev`.

No lo confundas con `supabase/.env`: ese archivo es para la CLI de Supabase y contiene credenciales secretas (ver [Credenciales](../operacion/base-de-datos.md#credenciales)); `apps/web/.env.local` es para la app y no lleva ningún secreto.

### Validación al arrancar

Al arrancar, la app comprueba que la URL es una URL `https` válida, que la clave de Supabase no está vacía (y no es una clave secreta), que el ambiente es `dev` o `prod` y que la clave de Clerk empieza por `pk_test_` o `pk_live_` y corresponde al ambiente: `pk_test_` solo con `dev` y `pk_live_` solo con `prod`. Si hay DSN de Sentry, tiene que tener la forma `https://<clave>@<host>/<id del proyecto>`; un DSN antiguo con clave secreta se rechaza. Si se pega la clave secreta de Clerk (`sk_`), el error lo dice expresamente. Si algo falla, en lugar de la app aparece una pantalla de error que nombra cada variable con problemas y el motivo, sin mostrar nunca sus valores; la consola del navegador muestra también los nombres.

Fuera de producción, la app muestra en la esquina inferior izquierda una etiqueta pequeña con el ambiente ("Desarrollo"), para comprobar a simple vista a qué ambiente apunta una vista previa o el servidor local. Con `VITE_APP_ENV=prod` no aparece.

El cliente de Supabase se crea una sola vez, en `apps/web/src/lib/supabase.ts`, a partir de la configuración validada, y se carga de forma diferida (ver [Identidad: de Clerk a Postgres](autenticacion.md#identidad-de-clerk-a-postgres)). No usa Supabase Auth: la sesión es de Clerk y el cliente envía su token de sesión en cada petición. El catálogo público (#232) usa un segundo cliente, `getPublicSupabase()`, que no envía nunca el token: solo la clave publicable, como `anon`, con o sin sesión. Así la consulta del catálogo no depende de que Clerk cargue ni de que el token de una sesión se pueda obtener (ver [Catálogo público](catalogo.md#catálogo-público)).

Las pruebas no leen estas variables (la validación se prueba con objetos de entorno de ejemplo), así que `npm test` y `npm run build` funcionan sin ningún `.env`, también en la integración continua.
