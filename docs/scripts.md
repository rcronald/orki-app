# Scripts de npm

Secciones que estaban en el README de la raíz hasta el #288; el índice de la documentación está en el [README](../README.md#documentación).

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
| `npm run enlaces`            | Comprueba que los enlaces relativos de los `.md` apuntan a un archivo y a una sección que existen (`scripts/enlaces/`). Lo usa el CI. |
| `npm test`                   | Ejecuta las pruebas de la app web una vez (Vitest).                                                                                                                                             |
| `npm run test:watch`         | Ejecuta las pruebas de la app web en modo observación.                                                                                                                                          |
| `npm run db:new`             | Crea una migración vacía en `supabase/migrations`. Recibe el nombre después de `--`.                                                                                                            |
| `npm run db:status`          | Muestra qué migraciones están aplicadas y cuáles pendientes en el proyecto de desarrollo.                                                                                                       |
| `npm run db:push`            | Aplica las migraciones pendientes en el proyecto de desarrollo.                                                                                                                                 |
| `npm run db:seed:dev`        | Carga los datos de ejemplo del catálogo en el proyecto de desarrollo. Se niega a ejecutarse en producción.                                                                                      |
| `npm run db:seed:plants`     | Carga plantas de ejemplo para un usuario en el proyecto de desarrollo (`-- <id de usuario> [cantidad]`), o las borra con `--borrar`.                                                            |
| `npm run db:test`            | Ejecuta las pruebas de base de datos en un Postgres local y desechable. Acepta un filtro después de `--`.                                                                                       |
| `npm run db:concurrencia`    | Ejecuta las pruebas de concurrencia de la base (dos sesiones a la vez, con `node:test`) en otro Postgres desechable. Lo usa el CI.                                                              |
| `npm run db:perf`            | Mide la búsqueda con un catálogo sintético en un Postgres desechable. No corre en el CI (ver [Rendimiento de la búsqueda](../supabase/README.md#rendimiento-de-la-búsqueda)).                      |
| `npm run db:types`           | Regenera los tipos de TypeScript del esquema (`apps/web/src/lib/database.types.ts`) desde las migraciones.                                                                                      |
| `npm run db:types:check`     | Comprueba, sin escribir nada, que los tipos versionados coinciden con las migraciones. Lo usa el CI.                                                                                            |
| `npm run test:scripts`       | Ejecuta las pruebas de los scripts de mantenimiento en Node (`scripts/**/*.test.mjs`, con `node:test`). Lo usa el CI.                                                                           |
| `npm run build:e2e`          | Construye la app de las pruebas de extremo a extremo en `apps/web/dist-medicion/e2e`, y su «versión B» en `e2e-b` (ver [Pruebas de extremo a extremo](pruebas.md#pruebas-de-extremo-a-extremo)).          |
| `npm run test:e2e`           | Construye esa app y ejecuta las pruebas de extremo a extremo con Playwright. Acepta opciones de Playwright después de `--`.                                                                     |
| `npm run test:e2e:sin-build` | Ejecuta las pruebas de extremo a extremo sin volver a construir. Lo usa el CI.                                                                                                                  |
| `npm run datos:sin-dueno`    | Detecta perfiles, plantas, eventos y fotos de usuarios que ya no existen en Clerk (`-- --ambiente desarrollo`); solo borra con `--borrar` (ver [su README](../scripts/datos-sin-dueno/README.md)). |
| `npm run fotos:huerfanas`    | Lista los archivos del bucket de fotos que ya no cita ninguna planta (`-- --ambiente desarrollo`); solo borra con `--borrar` (ver [Lectura de fotos y borrado sin huérfanos](app/fotos.md#lectura-de-fotos-y-borrado-sin-huérfanos)). |
| `npm run build:medicion`     | Construye la app como producción con valores ficticios, sin contactar con ningún servicio, en `apps/web/dist` (ver [Medición de la carga](medicion-de-carga.md)). |
| `npm run presupuesto`        | Compara el build de `build:medicion` con `apps/web/presupuesto-tamano.json` y falla si lo supera; informa también el precaché con Brotli, sin límite. Con `-- --bajar` baja los límites que el build permite y con `-- --actualizar` los fija en lo medido; las dos imprimen la tabla para el PR (ver [Cambiar el presupuesto](medicion-de-carga.md#cambiar-el-presupuesto)). Lo usa el CI. |
| `npm run cabeceras`          | Comprueba el build de `build:medicion` contra las cabeceras de seguridad: las firmes de `vercel.json`, los scripts en línea y los orígenes que cubre la CSP. Con `-- --actualizar` reescribe los hashes de los scripts en línea. Lo usa el CI (ver [Cabeceras de seguridad y CSP](operacion/cabeceras-de-seguridad.md#comprobación-automática)). |
| `npm run medir:carga`        | Mide la carga inicial con Lighthouse contra la app construida en local, nunca contra producción. |

La app web tiene además un script propio para regenerar los iconos de la PWA en `apps/web/public` a partir del logotipo (ver [Marca](app/design-system.md#marca)):

```sh
npm run icons --workspace=apps/web
```
