# Pruebas

Secciones que estaban en el README de la raíz hasta el #288; el índice de la documentación está en el [README](../README.md#documentación).

## Pruebas de extremo a extremo

Los flujos principales de la Fase 1 (#148) se prueban con [Playwright](https://playwright.dev) en un navegador real: acceso, registro (con y sin foto, y con un nombre por validar), inventario (lista, cuadrícula, búsqueda y filtros), «¿Ya la tengo?», edición y baja, backoffice del catálogo y la PWA (manifiesto, service worker y arranque sin conexión). Cada pantalla recorrida pasa además por [axe](https://github.com/dequelabs/axe-core) (en Chromium, ver [Qué corre en cada perfil](#qué-corre-en-cada-perfil)) con las reglas de nivel A y AA de WCAG 2.0, 2.1 y 2.2; la app no tiene tema oscuro, así que se revisa solo el claro. Lo que axe no ve se prueba aparte: `e2e/foco-no-tapado.spec.ts` comprueba, con el tabulador en una pantalla de celular, que el registro, la edición y el inventario siguen sin barras fijas (nada con `position: fixed` o `sticky`; las quitaron el #208 y el #221) y que el control con el foco queda a la vista (WCAG 2.4.11, #151). WebKit solo tabula a los campos de formulario, así que las comprobaciones que llegan a botones y enlaces no corren en los perfiles `webkit` y `celular`.

`e2e/portada.spec.ts` revisa la portada a 360 px (una columna, logotipo centrado, sin desplazamiento horizontal, acciones y enlaces del pie de al menos 44 px, foto 2:1) y en escritorio a 1536 px (dos columnas, foto a toda la altura hasta el borde, ventajas en fila y enlaces del pie a la derecha), las dos con axe.

`e2e/barra.spec.ts` revisa la barra de la app y el menú «Tu cuenta» (#207) a 1440 y 360 px, con el menú abierto y axe: sin desplazamiento horizontal, el orden de los controles, teclado, la opción de administración solo con el rol y una cuenta sin nombre.

`e2e/cuenta.spec.ts` revisa «Tu cuenta» (#214) a 1440 y 360 px con axe: se abre desde el menú, «Editar perfil» abre el editor (el del Clerk simulado) y el nombre nuevo se ve sin recargar, el CSV descargado es idéntico al de «Mi colección», la privacidad ofrece «Volver a Tu cuenta», cancelar la eliminación devuelve el foco al botón, «Volver a Mi colección» y «Cerrar sesión», sin desplazamiento horizontal y con objetivos de 44 px; y una cuenta sin nombre.

Corren en cuatro perfiles: Chromium, Firefox y WebKit de escritorio, y `celular`, un iPhone 15 (WebKit, pantalla pequeña y táctil). Las pruebas están en `apps/web/e2e/` y la configuración en `apps/web/playwright.config.ts`.

### Qué corre en cada perfil

No todo se repite en los cuatro perfiles (#259): lo que no depende del navegador se prueba una vez por motor, y el perfil `celular` se queda con lo que cambia en un iPhone.

|                                                                                                                               | chromium | firefox | webkit | celular                             |
| ----------------------------------------------------------------------------------------------------------------------------- | -------- | ------- | ------ | ----------------------------------- |
| Pruebas sin etiqueta (diseño, medidas y 44 px, foco y teclado, puntero y toque, fotos, service worker, portada prerrenderada) | sí       | sí      | sí     | sí                                  |
| `@logica`: flujos que no dependen del motor (rutas y sesión, lo que se guarda en Supabase, respuestas de la app)              | sí       | sí      | sí     | no: es el mismo motor que `webkit`  |
| `@escritorio`: variantes a 1440 o 1536 px                                                                                     | sí       | sí      | sí     | no: no es un caso real en un iPhone |
| axe                                                                                                                           | sí       | no      | no     | no                                  |

- **Etiquetas.** Van en el título con la opción de Playwright: `test('…', { tag: '@logica' }, async …)`, o en un `test.describe`. En las pruebas que recorren varios anchos, `{ tag: ancho > 720 ? '@escritorio' : [] }`. El perfil `celular` las excluye con `grepInvert` en `playwright.config.ts`. **Una prueba sin etiqueta corre en los cuatro perfiles**: olvidar la etiqueta solo cuesta tiempo, nunca cobertura. Ante la duda, sin etiqueta. `@logica` no va en una prueba que mida el diseño, mueva el foco, use el teclado o el puntero, prepare fotos o dependa del service worker o de la portada prerrenderada, aunque además recorra un flujo.
- **axe solo en Chromium.** Lo decide la fixture `revisarAccesibilidad` (`e2e/soporte/fixtures.ts`), no cada prueba: fuera de Chromium no hace nada y deja una anotación. Las pautas que comprueba axe (estructura, nombres, roles, contraste) no dependen del motor; lo que sí cambia con el motor (medidas, foco, desplazamiento) lo comprueban las propias pruebas en todos los perfiles. En Firefox, además, el Firefox de Playwright cerraba la pestaña («Page crashed») de forma intermitente mientras axe recorría la página (#170).
- **Firefox** corre todo salvo axe: es su único perfil.
- **Saltos dentro de una prueba** (`test.skip` con su motivo): las comprobaciones de foco en botones y enlaces de `foco-no-tapado.spec.ts` no corren en WebKit, que solo tabula a los campos de formulario; las pruebas sin conexión que necesitan el service worker y el Supabase simulado a la vez, y las de la versión nueva con service worker (`actualizacion.spec.ts`), solo corren en Chromium (ver los límites más abajo); la de la recarga única sin service worker corre en todos los motores (`@logica`); y limitar la CPU (`backoffice-buscadores.spec.ts`) solo se puede en Chromium.
- **«¿Ya la tengo?»** se prueba a 360 px; solo la primera respuesta, también a 1440. La lógica de cada respuesta está en `OwnershipCheckPage.test.tsx`.

Para ver qué corre en un perfil: `npm run test:e2e:sin-build -- --list --project=celular`.

### Lanzarlas en local

```sh
npx --workspace=apps/web playwright install    # una vez (y al actualizar @playwright/test): descarga los navegadores
npm run test:e2e                                # construye la app de las pruebas y ejecuta todo
npm run test:e2e:sin-build -- --project=webkit  # sin volver a construir, un solo perfil
npm run test:e2e:sin-build -- e2e/registro.spec.ts --headed   # un archivo, viendo el navegador
npm run test:e2e:sin-build -- --ui              # modo interactivo de Playwright
```

El servidor de las pruebas escucha en el puerto 4317, o en el de `ORKI_E2E_PUERTO` (por ejemplo, `ORKI_E2E_PUERTO=4441 npm run test:e2e:sin-build`) para lanzarlas a la vez desde otra copia de trabajo. Playwright nunca reutiliza un servidor que ya esté en ese puerto, porque podría servir el build de otra copia: si está ocupado, se para con «is already used» y basta con elegir otro (#295).

En Linux, la primera vez hace falta `npx playwright install --with-deps` (instala también las bibliotecas del sistema). Al terminar, `npx playwright show-report apps/web/playwright-report` abre el informe; de cada prueba que falla quedan en `apps/web/test-results/` la captura, el vídeo y la traza (`npx playwright show-trace <ruta de trace.zip>`). No hace falta ninguna variable de entorno ni conexión con Clerk, Supabase o Sentry.

### Qué se prueba y qué se simula

- **La app es la de producción.** `npm run build:e2e` construye `apps/web` con los valores ficticios de `scripts/medicion/entorno.mjs` (los mismos que el presupuesto de tamaño) y con un solo módulo cambiado al construir: `@clerk/react`, por `apps/web/medicion/clerk-simulado.tsx` (ver `apps/web/medicion/vite.config.e2e.ts` y `apps/web/medicion/sustitutos.ts`, compartido con la medición de la carga). Clerk descarga su script de su CDN y habla con su API, así que no se puede simular en la red; el sustituto da la sesión que elige cada prueba (sin sesión, la persona de prueba o una con el rol `catalog_admin`) y sus pantallas de acceso son un botón que inicia la sesión. Nada de esto llega a `apps/web/dist`. Se sirve con el servidor de la medición (`scripts/servir-e2e.mjs`), como Vercel: cualquier ruta responde con `index.html`. A la vez, en paralelo, construye la «versión B» en `apps/web/dist-medicion/e2e-b` (#278): el mismo build con un texto de los créditos cambiado (`apps/web/medicion/version-b.ts`), así que el paso apenas se alarga. La usa `e2e/actualizacion.spec.ts`, que sirve A y después B en el mismo origen con su propio servidor (`e2e/soporte/servidor-de-versiones.ts`, en un puerto libre por prueba), que responde como Vercel, con 404 para lo que falta en `assets/`: lo que ve una pestaña vieja tras un despliegue.
- **Supabase se simula en la red**, no en el código: el cliente de Supabase de la app (postgrest-js y storage-js) hace sus peticiones de verdad hacia `https://supabase.orki.invalid` y Playwright las responde desde la memoria de cada prueba (`apps/web/e2e/soporte/supabase-simulado.ts`), con la forma de PostgREST y de Storage, las reglas de las políticas (cada persona ve y escribe sus plantas; el backoffice, solo `catalog_admin`) y lo que hacen los disparadores de `plants`. Simula también `plant_photos` (#219), para probar el formulario con galería: cada persona solo sus fotos, el dueño de la foto es el de la planta, rutas en `<usuario>/<planta>/`, `position` de 0 a 5 y única por planta (`23505`), solo las columnas que la API deja cambiar, la cascada al borrar la planta y la sincronización en los dos sentidos con las columnas de foto de `plants` (también lo que escribía en `plants` el formulario de una foto), que la base desplegada aún mantiene. Desde el #186 las plantas se devuelven con la principal embebida de `plant_photos` (con `plant_photos.order` y `plant_photos.limit`), y si la app pide en el select de `plants` o envía en un insert o un update `photo_path`, `thumbnail_path` o `photo_in_bloom`, la petición queda sin simular y la prueba falla. Una prueba que pone la foto directamente en `datos.plantas` la ve como principal en `plant_photos`, como tras la copia de la migración; `supabase.fotosDe(planta)` devuelve sus fotos en orden. Bitácora (#267): `plant_log_entries` con `add_plant_log_entry` (clave de reintento), `list_plant_log_entries` (filtro y cursor), el borrado y la cascada; `supabase.registrosDe(planta)` y `fallosDeBitacora` (hace fallar la próxima alta, lectura o borrado, antes o después de aplicarlo). El listado de Storage devuelve, como el real, solo el primer nivel de una carpeta. Estas reglas del simulado no tienen pruebas propias (las de la base de verdad están en `supabase/tests/fotos_de_plantas.sql`): se ejercitan a través de la app, en la galería, la edición (`e2e/editar-planta.spec.ts`) y el borrado de una planta con varias fotos (`e2e/edicion.spec.ts`). Así se ejercita el código de la app que arma las consultas, interpreta las respuestas, sube y descarga las fotos y traduce los errores. Los datos de partida están en `apps/web/e2e/soporte/datos.ts`.
- **Con las cabeceras de Vercel y la CSP obligatoria** (#282): el servidor de las pruebas añade las cabeceras firmes de `vercel.json` y la CSP que genera `apps/web/seguridad/politica.ts` con las variables ficticias, como `Content-Security-Policy` (no en modo informe). Cualquier violación hace fallar la prueba (fixture `violacionesCsp`); ver [En las pruebas de extremo a extremo](operacion/cabeceras-de-seguridad.md#en-las-pruebas-de-extremo-a-extremo).
- **La red está cerrada.** Solo pasa el origen de la app. Una petición a Supabase que el simulado no conoce, cualquier salida a otro dominio o un error que la app envíe a Sentry (el DSN ficticio, que se responde sin salir) hacen fallar la prueba.
- **Cada prueba es independiente:** contexto de navegador nuevo (almacenamiento vacío) y su propio Supabase simulado. El service worker está bloqueado salvo en las pruebas de la PWA (`apps/web/e2e/pwa.spec.ts`), que lo registran de verdad.

Límites: no se prueba la interfaz real de Clerk (inicio de sesión con Google o correo), ni Supabase o Storage reales, ni Sentry. En Firefox, el modo sin conexión de Playwright no deja responder al service worker, así que la prueba del arranque sin conexión corta el servidor de la app en su lugar; y la del inventario sin conexión solo corre en Chromium, porque en los demás motores Playwright no intercepta la red de una página que controla un service worker.

axe corre solo en Chromium (ver [Qué corre en cada perfil](#qué-corre-en-cada-perfil)); el resto de cada prueba sí corre en Firefox.

### A mano, contra el ambiente de desarrollo

Estas pruebas dependen de los datos simulados y no se lanzan contra el ambiente de desarrollo: allí la sesión es la de Clerk de verdad y en el CI haría falta un secreto de sesión, que a propósito no existe (#25). Para repasar los mismos flujos en desarrollo, a mano y con un usuario de prueba de la instancia de desarrollo de Clerk:

1. Abre la URL de desarrollo con el generador de Playwright, que deja un navegador limpio y anota cada paso: `npx --workspace=apps/web playwright codegen <URL de desarrollo>` (o, sin Playwright, una ventana privada).
2. Recorre los flujos en el orden de `apps/web/e2e/`: acceso y vuelta a la página pedida, registro con especie, registro con foto y nombre por validar, inventario en lista y cuadrícula con búsqueda y filtros, «¿Ya la tengo?», edición, baja y eliminación, y backoffice con un usuario con el rol de administrador (ver [Rol de administrador del catálogo](app/autenticacion.md#rol-de-administrador-del-catálogo)).
3. Borra después lo que hayas creado (`npm run db:seed:plants -- <id de usuario> --borrar` quita las plantas de ejemplo).

No guardes el estado de la sesión (`--save-storage`) dentro del repositorio: lleva el token de Clerk.

### En el CI

Las pruebas de extremo a extremo corren en `.github/workflows/ci.yml` como cuatro jobs en paralelo, uno por perfil (**Pruebas de extremo a extremo (chromium)**, **(firefox)**, **(webkit)** y **(celular)**), a la vez que los demás jobs: cada uno instala solo su navegador (en caché por versión de Playwright y navegador; el perfil de celular usa WebKit), construye la app de las pruebas y ejecuta su perfil, con un reintento por prueba (una prueba que pasa a la segunda queda marcada como inestable en el informe). Que un perfil falle no cancela los demás. No usan secretos. Si uno falla, sube como artefacto `informe-playwright-<perfil>` el informe HTML y las trazas. Por ahora no son obligatorios para fusionar; la propuesta es exigirlos cuando lleven dos semanas estables.
