# Medición de la carga y presupuesto de tamaño

Revisión de rendimiento de la Fase 1 (#149, parte del #25). Aquí están el método para medir la carga inicial, los resultados del 21 de noviembre de 2026, el presupuesto de tamaño que vigila el CI, qué pesa en el bundle y qué se puede recortar.

Todas las cifras de este documento salen de ejecuciones hechas con las órdenes que se indican, sobre el commit que añade este documento. No hay estimaciones sin marcar como tales.

## Resumen

| Pantalla | Condición | LCP (mediana de 5) | ¿Menos de 3 s? |
| --- | --- | --- | --- |
| Inicio (`/`), sin sesión | build de producción, Clerk sin cargar | 0,90 s | Sí |
| Inventario (`/coleccion`), 100 plantas | build de medición, sin Clerk ni Supabase reales | 2,80 s | Sí en esta condición, pero es un suelo: falta lo que añaden Clerk y Supabase (ver «Límites») |

- El inicio carga muy por debajo de 3 segundos.
- El inventario con 100 plantas queda en 2,80 s **sin** el script de Clerk (71,6 KiB con Brotli, ver abajo), sin las idas y vueltas a su API y sin la consulta a Supabase. Con ellos lo más probable es que pase de 3 s en la primera visita; no está medido. Queda propuesto un issue para medirlo contra el ambiente de desarrollo y el plan para bajarlo («Issues por abrir»).
- El CI falla si el JavaScript inicial, el CSS o el total precacheado superan el presupuesto (`apps/web/presupuesto-tamano.json`, margen del 5 %).

> **Actualización (22 nov 2026):** con la portada del #179, el inicio da 3,95 s de LCP (antes de ella, 3,20 s con el mismo método); el detalle, en «Portada». El presupuesto del CSS inicial y del precaché queda superado por las piezas nuevas del design system y está pendiente de decidir.
>
> **Actualización (#204):** el 0,90 s de la tabla no medía cuándo se veía el texto: Lighthouse 13, con un LCP de texto que coincide con el FCP, lo calcula solo con el HTML y el CSS, aunque el texto lo pintara el JavaScript. Con la portada prerrenderada en `index.html` el inicio baja a 2,40 s de LCP (3,95 s en `main`); la causa, las cifras y lo pendiente, en «Carga de la portada (#204)».

## Cómo medir

Requisitos: Node de `.nvmrc`, dependencias instaladas (`npm ci`) y Google Chrome instalado (o la variable `CHROME_PATH`). No hace falta ninguna variable de entorno real ni conexión con Supabase, Clerk o Sentry.

```sh
npm run medir:carga                       # construye y mide las dos pantallas, 5 veces cada una
npm run medir:carga -- --repeticiones 9   # más repeticiones
npm run medir:carga -- --solo inicio      # o --solo inventario
npm run medir:carga -- --sin-build        # reutiliza los builds que haya
```

La orden imprime la mediana, el mínimo y el máximo de cada métrica y deja los informes JSON de Lighthouse en `apps/web/dist-medicion/lighthouse/` (con `resumen.json`), fuera del control de versiones. Se pueden abrir en <https://googlechrome.github.io/lighthouse/viewer/>.

### Qué hace

1. **Build como producción con valores ficticios** (`npm run build:medicion`, `scripts/construir-medicion.mjs`): `VITE_APP_ENV=prod` (sin la muestra ni el diagnóstico), un DSN de Sentry ficticio (producción tiene DSN, y solo con él existe el chunk del SDK) y claves de Clerk y Supabase con formato válido que apuntan a dominios `.invalid`, que nunca resuelven (`scripts/medicion/entorno.mjs`). Quita del entorno las variables que activarían la subida de mapas a Sentry. Vite da prioridad a las variables del proceso sobre los archivos `.env`, así que un `.env.local` con valores reales no se cuela.
2. **Build de medición del inventario** (`apps/web/medicion/vite.config.ts`, en `apps/web/dist-medicion/app`): la misma app (mismo `index.html`, `main.tsx` y rutas) con dos módulos sustituidos al construir: `@clerk/react` por `medicion/clerk-simulado.tsx` (Clerk cargado, sesión iniciada) y `src/collection/supabase-source.ts` por `medicion/coleccion-simulada.ts`, que lee las 100 plantas de `/medicion/coleccion.json` con una petición. Las plantas son las de la página de muestra (`largeSampleCollection(100)`). Nada de esto entra en `apps/web/dist`: es otra configuración de Vite y otra carpeta de salida, y la app no importa nada de `apps/web/medicion/`. La sustitución está en `apps/web/medicion/sustitutos.ts`, que comparte con el build de las pruebas de extremo a extremo (#148, `apps/web/medicion/vite.config.e2e.ts`); el Clerk simulado, sin la clave `orki-sesion-simulada` en `localStorage`, se comporta como siempre aquí: sesión iniciada como `user_medicion`.
3. **Servidor local con compresión** (`scripts/medicion/servidor.mjs`): sirve cada build como Vercel (archivos tal cual y cualquier otra ruta con `index.html`) y con Brotli, que es lo que sirve Vercel. No se usa `vite preview` porque no comprime y la medida saldría peor que la real. Comprime todo antes de escuchar para no penalizar la primera ejecución.
4. **Lighthouse 13.6.0** con `npx` y versión fija, solo rendimiento, con su configuración móvil por defecto (explícita en la orden): emulación de un celular de gama media (Moto G Power), red 4G lenta simulada (150 ms de RTT, 1,6 Mbit/s) y CPU cuatro veces más lenta (`--form-factor=mobile --throttling-method=simulate`). Cada ejecución abre un Chrome sin caché ni service worker, como una primera visita.

Lighthouse va con `npx` y no como dependencia de desarrollo porque es una herramienta de medición a mano, no del CI: así no alarga cada `npm ci` (también los del CI) y la versión queda fijada en `scripts/medir-carga.mjs`. Cambiar esa versión cambia la vara de medir: hay que volver a medir y anotarlo aquí.

### Ruido

Con limitación simulada, la red no depende de la máquina, pero la CPU sí: Lighthouse multiplica la duración de las tareas observadas. En este equipo había otras tareas corriendo, por eso cada pantalla se mide 5 veces y se da la mediana con el mínimo y el máximo. En las primeras pruebas, antes de comprimir por adelantado, una ejecución suelta llegó a 4,8 s de LCP en el inventario por una tarea larga de 1,7 s ajena a la app; con la mediana de 5 y la compresión previa, las ejecuciones quedaron entre 2,79 y 2,82 s. El `benchmarkIndex` de Lighthouse en estas mediciones fue de 3900 a 4020.

## Resultados (21 nov 2026)

Orden: `npm run medir:carga` (5 ejecuciones por pantalla). Lighthouse 13.6.0, HeadlessChrome 157, macOS.

| Métrica | Inicio, mediana (mín.–máx.) | Inventario con 100 plantas, mediana (mín.–máx.) |
| --- | --- | --- |
| First Contentful Paint | 0,90 s (0,90–0,91) | 0,90 s (0,90–0,90) |
| Largest Contentful Paint | 0,90 s (0,90–0,91) | 2,80 s (2,79–2,82) |
| Speed Index | 0,91 s (0,90–1,12) | 1,45 s (1,20–1,48) |
| Total Blocking Time | 0 ms (0–0) | 20 ms (17–33) |
| Cumulative Layout Shift | 0,011 | 0,030 |
| Bytes transferidos | 180,5 KiB (180,5–250,7) | 156,0 KiB (156,0–156,0) |
| Puntuación de rendimiento | 100 | 96 |

- En el inicio, el elemento del LCP es el texto «Tu colección de orquídeas, siempre a mano.». En el inventario, la imagen «Sin foto» de la primera tarjeta (un SVG en línea).
- Los bytes transferidos varían entre ejecuciones porque el service worker se instala durante la carga y, según cuándo, sirve él las fuentes y el chunk de Supabase (no cuentan como descarga de la página). No es una métrica estable; para el tamaño está el presupuesto.
- Lighthouse marca `registerSW.js` como recurso que bloquea el pintado (ver «Propuestas»).

### Límites de la medición

- **Clerk no carga** en ninguna de las dos pantallas. En el inicio, su script apunta a `clerk.orki.invalid` y falla, como sin conexión con Clerk; la pantalla de inicio no lo espera. En el inventario, Clerk está sustituido. En la app real, con sesión, `/coleccion` espera a que Clerk cargue (`RequireAuth`), así que añade: el script `clerk.browser.js` (la app lo pide como `@clerk/clerk-js@6`; en la 6.46.3, la última 6.x publicada en npm hoy: 328 873 B, 85 554 B con gzip y 71 616 B con Brotli, medido sobre el paquete de npm con `npm pack @clerk/clerk-js@6`), las peticiones a su API para recuperar la sesión y el token, y la parte de `@clerk/react` que el sustituto quita del chunk `App` (65 128 B transferidos en el inicio frente a 36 919 B en el build de medición).
- **Supabase no responde**: la colección llega de un JSON local en una petición. En la app, la consulta necesita antes el token de Clerk y va a otro origen (DNS, TLS y la consulta a PostgREST). La petición de perfil (`ProfileBootstrap`) sí sale y falla contra `supabase.orki.invalid`, y el chunk de supabase-js sí se descarga.
- **Sin fotos**: las plantas de la muestra no tienen foto, así que no se miden las miniaturas.
- **Primera visita**: con la app instalada, el service worker sirve todo el JavaScript, el CSS y las fuentes desde la caché y la carga depende casi solo de la CPU y de Clerk. No está medido.
- **Simulación**: Lighthouse simula la red a partir de una carga local. Es repetible y sirve para comparar versiones, pero no sustituye una medición en un celular real con 4G.

## Portada (#193, 22 nov 2026)

Orden: `npm run build:medicion && npm run medir:carga -- --sin-build --solo inicio` (5 ejecuciones, mediana con mínimo y máximo), antes y después de la portada del #179 (#190 a #193), en este mismo equipo. Lighthouse 13.6.0, configuración móvil simulada, `benchmarkIndex` 4083 (antes) y 4140 (después).

| Métrica | Antes (`main`, 38db1fb) | Después (portada con foto) |
| --- | --- | --- |
| First Contentful Paint | 1,84 s (1,83–2,13) | 1,83 s (0,75–2,13) |
| Largest Contentful Paint | 3,20 s (3,20–3,21) | 3,95 s (3,95–3,95) |
| Speed Index | 1,84 s (1,83–2,13) | 1,83 s (1,53–2,13) |
| Total Blocking Time | 10 ms (0–20) | 0 ms (0–10) |
| Cumulative Layout Shift | 0,010 | 0,001 |
| Bytes transferidos | 199,4 KiB | 312,6 KiB |
| Puntuación de rendimiento | 92 (91–92) | 87 (86–88) |

- **Antes ya pasaba de 2,5 s.** Las cifras del resumen de arriba (0,90 s) son del 21 de noviembre; con lo que entró después, el inicio de `main` ya daba 3,20 s en esta medición, porque lo que pinta (el logotipo en el `h1`) llega con el chunk `App`, que espera al inicial.
- **Después**, el elemento del LCP es la foto (`img.orki-hero__photo`, la variante de 960 px, 55,6 KiB). Lighthouse lo desglosa así (ejecución 1, tiempos sin simular): espera 3 ms al primer byte, 73 ms a que se descubra la petición, 1 ms de descarga y **796 ms de retraso de pintado**: la foto no se puede pintar hasta que el chunk `App` (78 KiB transferidos) llega y se ejecuta. La petición no se ve en el HTML inicial.
- **Probado y descartado:** precargar la foto desde `index.html` (un script en línea que, solo en `/` y sin usuario recordado, añade `<link rel="preload" as="image" imagesrcset imagesizes fetchpriority="high">`). El LCP bajó de 3,95 a 3,80 s (mediana de 5), a cambio de 560 bytes más en el precaché, que ya está en el límite. No compensa.
- **CLS** bajó a 0,001: la foto lleva `width` y `height` y el Hero reserva el hueco 3:2.
- Los bytes suben por la foto (55,6 KiB) y por el CSS de las piezas nuevas; la foto no entra en el precaché.

Para bajar el LCP de la portada por debajo de 2,5 s hay que pintarla sin esperar al chunk `App`: que el Hero (sin Clerk) vaya en el chunk inicial o se pinte mientras `App` carga, y que `App` decida después si hay que ir a la colección. Queda propuesto como issue («Issues por abrir», 4); afecta al presupuesto del JavaScript inicial (95,3 % hoy). **Hecho en el #204** con la portada prerrenderada en `index.html`, sin tocar el JavaScript inicial: ver la sección siguiente. (La explicación de los 3,20 s de este apartado, el logotipo que llega con `App`, es incompleta: ver «Causa del salto».)

### Presupuesto con la portada

`npm run build:medicion && npm run presupuesto`, antes y después:

| Métrica | Antes | Después | Límite |
| --- | --- | --- | --- |
| `jsInicialGzip` | 86 043 B (95,3 %) | 86 038 B (95,3 %) | 90 321 B |
| `cssGzip` | 7 795 B (98,5 %) | 8 545 B (**107,9 %**) | 7 916 B |
| `precacheBytes` | 1 355 771 B (99,4 %) | 1 366 871 B (**100,2 %**) | 1 364 418 B |

Las dos que se pasan lo hacen por las piezas de las páginas públicas del design system: `bundle.css` es copia literal del sistema y pasa de 8 848 a 12 712 bytes (NavBar, Hero, FeatureItem, TextLink y `orki-btn--strong`), que van en la hoja inicial. El resto del aumento del precaché es el código de la portada en el chunk `App` (la página, la cabecera pública, la redirección con sesión y los iconos nuevos). Lo recortado antes de medir: la foto y el dibujo fuera del precaché, y el JavaScript solo con el texto alternativo y las medidas de la foto (no su informe). El presupuesto **no** se ha subido: hace falta decidirlo (`npm run presupuesto -- --actualizar` con el porqué en el PR).

## Carga de la portada (#204, 22 nov 2026)

Objetivo: LCP del inicio (`/` sin sesión) por debajo de 2,5 s en esta medición, sin saltos de contenido. Mismo método de siempre (`npm run medir:carga`, Lighthouse 13.6.0, móvil con limitación simulada), en el mismo equipo; los informes de cada paso se guardaron aparte y el desglose de la simulación se sacó recalculando el LCP de Lantern sobre la traza y el registro de red guardados (`--save-assets`).

### Causa del salto de 0,90 s a 3,20 s

Medido commit a commit con los scripts de medición actuales (no cambiaron desde el #149; `git diff 5584506 -- scripts/medir-carga.mjs scripts/medicion` está vacío), 5 ejecuciones, `--solo inicio`:

| Commit | Qué entra | FCP | LCP | Elemento del LCP |
| --- | --- | --- | --- | --- |
| `5584506` (el de las cifras del #149) | | 0,90 s (0,90–0,97) | 0,90 s (0,90–0,97) | texto |
| `f9eda46` | `registerSW.js` con `defer` | 0,75 s | 0,75 s | texto |
| `da21280` | justo antes del logotipo | 0,75 s (0,75–0,76) | 0,75 s (0,75–0,76) | texto |
| `d981083` | logotipo (#173) | 2,13 s (0,75–2,13) | **3,20 s** (3,20–3,22) | `<img>` del logotipo |
| `38db1fb` | fotos de las plantas (#182) | 1,83 s (0,76–2,13) | 3,20 s (3,20–3,36) | `<img>` del logotipo |
| `c5c32ae` (`main` al empezar) | portada (#179, #197) | 1,83 s (0,75–2,13) | 3,95 s (3,95–3,96) | la foto |

El salto entra con el logotipo, pero no porque el logotipo pese ni porque vaya en línea: una data URL le cuesta a la simulación unos 2 ms. Lo que cambia es **el tipo de elemento del LCP**, y con él cómo lo calcula Lighthouse:

- **El 0,90 s (y el 0,75 s) no medía cuándo se veía el texto.** Lighthouse 13, cuando el LCP es un texto y coincide con el FCP, calcula el LCP con el mismo grafo que el FCP (`LargestContentfulPaint.getPessimisticGraph` de Lantern): solo el HTML y lo que bloquea el pintado (el CSS). El grafo recalculado para `da21280` tiene 4 nodos: el documento, el CSS y dos tareas de la CPU. Pero aquel texto lo pintaba React desde el chunk `App`: en la realidad hacía falta el JavaScript inicial (72 KiB) y `App` (74 KiB), que la cifra no contaba. Se midió con el mismo método y en el mismo equipo (repetido hoy: 0,90 s), así que las condiciones son comparables; lo que no es comparable es lo que mide.
- **Con el logotipo, el LCP pasa a ser una imagen** (el `<img>` del logotipo, más grande que el texto) y Lighthouse usa el grafo completo: toda petición terminada antes del LCP observado en la carga sin limitar. Ahí entran el JavaScript inicial, `App` y el script de Clerk, que en esta medición apunta a `clerk.orki.invalid` y falla. En la simulación, ese fallo cuesta como una conexión nueva a otro origen (DNS, TCP y TLS: unos 780 ms tras ejecutarse `App`). Los 3,20 s son exactamente el final de esa petición fallida.
- **Por qué el LCP observado llegaba tan tarde:** `AppRouter` cargaba `App` con `lazy()` y `Suspense`, y React 19 deja **al menos 300 ms** entre que muestra el fallback de un `Suspense` y que lo sustituye por su contenido (`FALLBACK_THROTTLE_MS` en `react-dom`). En una carga sin limitar con Chromium (Playwright), el chunk se pedía a los 118 ms y la portada se confirmaba a los 418 ms; para entonces Clerk ya había fallado dos veces y esas peticiones entraban en el grafo. En un celular real esos 300 ms también existen, en cualquier ruta.
- **Con la portada (3,95 s)** es lo mismo con la foto como LCP: el grafo termina igual, en la petición fallida a Clerk (3 957 ms en la ejecución recalculada), después de `App` (3 177 ms). Por eso precargar la foto desde el HTML (lo que se probó en el #193) apenas cambiaba nada: la foto no era lo último del grafo.

Con Clerk real el script sí llega (71,6 KiB con Brotli), pero también va detrás de `App`, así que el problema de fondo es el mismo: la portada no se pintaba hasta tener la app, y la app arrastra a Clerk.

### Qué se cambió

Tres commits, medidos uno tras otro sobre `c5c32ae` (5 ejecuciones; el último, 9):

1. **La app se pinta en cuanto llega su chunk** (`AppRouter.tsx`): sin `lazy()` ni `Suspense` para `App`; el chunk se pide al montar y se pinta con una actualización normal. Quita los 300 ms del `Suspense` en **cualquier** primera pantalla. Solo, no mueve el LCP del inicio en esta medición (la foto sigue llegando con `App` y el fallo de Clerk sigue en el grafo), pero el FCP baja de 1,83 a 1,68 s y, en la carga sin limitar, la portada se confirma 300 ms antes.
2. **Portada prerrenderada en `index.html`** (`prerender/portada-previa-plugin.ts`, `src/prerender/`): el build renderiza `PublicHome` (la misma portada que pinta `HomeRoute`) con `react-dom/server` y la deja en un `<template>`. Un script en línea en el `<head>`, tras la etiqueta meta viewport (antes, el navegador calcula `sizes` con 980 px y precargaría la variante de 1296 px: se vio en la primera prueba, con dos descargas de la foto), decide si se muestra: solo en `/`, sin usuario recordado (`orki-ultimo-usuario`) y sin el aviso de cuenta eliminada en el historial, es decir, los casos en que `HomeRoute` pinta la portada mientras Clerk carga. Si se muestra, precarga la foto (`imagesrcset`, `imagesizes`, `fetchpriority="high"`). Otro script tras `#root` copia la plantilla a un contenedor; no corre hasta tener el CSS, así que nunca se ve sin estilos. La plantilla no lleva ningún `src` ni `srcset` de archivo (van en `data-orki-src` y `data-orki-srcset`, y ese script los devuelve a su sitio al mostrarla): Firefox descarga por adelantado las imágenes de un `<template>`, y en el CI pedía la foto en `/catalogo` y con usuario recordado (PR #230). La app la retira en la misma confirmación en que pinta la suya (efecto de diseño en `AppRouter`), antes del siguiente pintado. El FCP baja a 0,75 s, pero el LCP queda muy variable: 3,96 s (2,17–4,04), porque `App`, Sentry y Clerk se piden a la vez que la foto y, según quién termine antes en la carga sin limitar, entran o no en el grafo.
3. **La app y Sentry esperan a que se pinte la foto** (`esperarFotoDePortadaPrevia`): con la portada prerrenderada a la vista, el chunk de la app y el SDK de Sentry se piden cuando la foto ya está en pantalla (en Chromium, con la entrada de LCP de la foto; en los demás, tras decodificarla y un fotograma; como mucho, 2 s). Así no le quitan red a la foto, y los botones de la portada prerrenderada son enlaces normales que funcionan sin la app. Sin portada prerrenderada (otras rutas, usuario recordado) no se espera nada.

| Paso (sobre `c5c32ae`) | FCP | LCP | CLS | Bytes |
| --- | --- | --- | --- | --- |
| `main` | 1,83 s (0,75–2,13) | 3,95 s (3,95–3,96) | 0,001 | 313,5 KiB |
| 1. Sin la espera del `Suspense` | 1,68 s (1,67–1,82) | 3,95 s (3,95–4,03) | 0,001 | 328,1 KiB |
| 1 y 2. Portada prerrenderada | 0,75 s (0,75–0,77) | 3,96 s (2,17–4,04) | 0,001 | 332,5 KiB |
| 1, 2 y 3. La app espera a la foto (9 ejecuciones) | 0,76 s (0,75–0,77) | **2,26 s** (2,17–2,41) | 0,001 | 332,8 KiB |

Los bytes suben de 313 a 333 KiB porque las tres fuentes (72 KiB) se descargan ahora en la carga: antes llegaban tarde y las servía ya el service worker recién instalado (0 bytes en el informe); el texto prerrenderado las pide al primer pintado.

### Antes y después, sobre `main` actualizado

Rama rebasada sobre `19b8fef` (`main` al terminar, con la barra y las piezas nuevas del design system). `npm run medir:carga` en las dos: 5 ejecuciones en `main`, 9 en la rama.

| Métrica | Inicio, `main` | Inicio, #204 | Inventario, `main` | Inventario, #204 |
| --- | --- | --- | --- | --- |
| FCP | 1,83 s (0,82–1,83) | 0,75 s (0,75–0,75) | 0,75 s (0,75–0,75) | 0,75 s (0,75–1,22) |
| LCP | 3,95 s (3,95–4,41) | **2,40 s** (2,40–2,40) | 0,75 s (0,75–0,75) | 0,75 s (0,75–1,22) |
| CLS | 0,001 | 0,001 | 0,000 | 0,000 |
| Bytes transferidos | 319,7 KiB | 339,2 KiB | 183,6 KiB | 306,5 KiB |
| Puntuación | 87 (66–87) | 98 (98–98) | 100 (99–100) | 100 (100–100) |

- El elemento del LCP del inicio sigue siendo la foto (`img.orki-hero__photo`), ahora la de la portada prerrenderada. El grafo de la simulación queda en el documento, el CSS, las fuentes, la foto y el JavaScript inicial; ya no entran `App`, Sentry ni Clerk. Sobre `main` actualizado el margen es menor que sobre `c5c32ae` (2,40 frente a 2,26 s): la hoja inicial creció con las piezas nuevas (de 8,0 a 9,6 KiB transferidos) y compite con la foto.
- Los bytes del inventario suben de 183,6 a 306,5 KiB sin descargar nada nuevo: las fuentes (72 KiB) y el chunk de supabase-js (47 KiB) se piden ahora 300 ms antes, antes de que el service worker recién instalado pueda servirlos, y cuentan como descarga de la página (en `main`, el informe los daba como 0 bytes). En una primera visita real se descargan igual; ver «Resultados», sobre por qué los bytes no son una métrica estable. En la carga sin limitar, la colección se pide a los 97 ms en lugar de a los 367 ms.
- El inventario no empeora. Su LCP ya era de 0,75 s en `main` porque con la barra nueva el elemento del LCP pasó a ser el título «Mi colección» (texto que coincide con el FCP, el mismo atajo de Lighthouse de arriba); con el logotipo como LCP, en `c5c32ae`, daba 2,32 s. Esa cifra, por tanto, tampoco dice cuándo se ve el inventario: lo que sí se nota es el paso 1, que en la carga sin limitar adelanta la primera pantalla 300 ms.

### Presupuesto

`npm run build && npm run build:medicion && npm run presupuesto`:

| Métrica | `main` (`19b8fef`) | #204 | Límite |
| --- | --- | --- | --- |
| `jsInicialGzip` | 86 108 B (95,3 %) | 86 546 B (95,8 %) | 90 340 B |
| `cssGzip` | 10 749 B (96,4 %) | 10 749 B (96,4 %) | 11 156 B |
| `precacheBytes` | 1 409 837 B (96,2 %) | 1 433 894 B (97,8 %) | 1 465 989 B |

El JavaScript inicial apenas cambia (el código de la espera y de retirar la portada prerrenderada). El precaché crece por `index.html`, que pasa de 1,3 a 24 kB (6 kB con gzip, 5 960 B): la portada lleva el logotipo en línea dos veces (cabecera y pie), como en la app. El presupuesto no se ha subido.

### Probado y descartado

- **Precargar la foto sin prerrenderizar** (#193): 3,80 s. La foto no era lo último del grafo.
- **Prerrenderizar sin quitar la espera del `Suspense`** (primera prueba, con la precarga ya tras la meta viewport): 2,42 s de mediana pero con ejecuciones de 3,97 s, y la foto se descargaba dos veces (el `<img>` que React crea durante esos 300 ms no reutilizaba la descarga).
- **Llevar la portada al chunk inicial**: no se probó. Habría que meter en el JavaScript inicial la portada, el logotipo en línea (8 kB) y los iconos, con el presupuesto al 95,3 %, y la foto seguiría esperando al JavaScript inicial (72 KiB). La portada prerrenderada no añade nada al JavaScript inicial.
- **Logotipo como archivo aparte**: no hace falta. En línea le cuesta 2 ms a la simulación; el salto era por el cambio de elemento del LCP, no por el logotipo.
- **Fuentes** (precargar la del título, `font-display`): ya van con `font-display: swap` y el texto no espera a ellas. Precargarlas no adelanta nada: se piden con el CSS y compiten con la foto.
- **CSS crítico**: la hoja inicial son 8 KiB con Brotli y bloquea el pintado igual que bloquearía un CSS en línea del mismo tamaño en el HTML.

### Riesgos

- **La portada prerrenderada tiene que coincidir con la de la app.** Por construcción es el mismo componente (`PublicHome`), renderizado en el build; las pruebas comprueban el contenido de la plantilla, que las direcciones de la foto existen, que al llegar la app queda una sola portada y que, a 360 y a 1536 px, la cabecera, el título, las acciones, la foto, las ventajas y el pie quedan en el mismo sitio (al píxel) antes y después de la sustitución, en Chromium, WebKit y el perfil de iPhone. Las pruebas que miden la portada esperan antes a que la app la haya sustituido: medida a medias, una caja puede salir de la prerrenderada justo cuando se retira (`boundingBox()` nulo, fallos del CI en el perfil de celular). Lo que dependa del estado del navegador (el aviso de cuenta eliminada) no está en la plantilla: por eso el script no la usa en ese caso.
- **Usuarios con sesión sin usuario recordado** (por ejemplo, con el almacenamiento borrado): ven la portada prerrenderada y van a la colección cuando llegan la app y Clerk, como antes, pero la app se pide tras pintarse la foto (en celular, unos cientos de ms más tarde; como mucho 2 s).
- **Antes de que llegue la app**, los botones de la portada son enlaces: pulsarlos abre la página nueva con una carga completa, en lugar de navegar dentro de la app. El foco puesto en la portada prerrenderada se pierde al sustituirla.
- **Sin conexión** (app instalada): el service worker sirve el `index.html` con la portada; la foto no está en el precaché, falla y la app sigue enseguida. Lo prueba `e2e/pwa.spec.ts`.

### Pendiente

- **WebKit descarga también el JPEG de respaldo** (134 KiB) cuando la app pinta su portada: React pone `src` al `<img>` antes de meterlo en el `<picture>`, y WebKit lo empieza a descargar en ese momento. Pasaba ya en `main`, donde WebKit descargaba el JPEG y la variante AVIF dos veces; con la portada prerrenderada son el AVIF una vez y el JPEG. Visto con WebKit de Playwright, no en un iPhone. Para arreglarlo, `HeroPhoto` podría reutilizar el `<picture>` ya pintado o no llevar `src` hasta estar dentro del `<picture>`.
- **Las fuentes (72 KiB) están en el camino del LCP** ahora que el texto se pinta al principio. Subconjuntos más pequeños de Inter y Playfair Display, o solo dos pesos, bajarían el LCP de la simulación; no está medido.
- **El 300 ms de `Suspense` en las páginas diferidas** (registro, detalle, edición, privacidad, créditos, backoffice) sigue: al abrirlas por primera vez, su contenido aparece como pronto 300 ms después del fallback. No afecta al inicio ni al inventario.
- **No medido:** un celular real con 4G, la red de producción con Clerk real (su script y su API), y la segunda visita con el service worker instalado.

## Presupuesto de tamaño (CI)

El job «Lint, formato, typecheck, pruebas y build» del CI ejecuta, después del build normal:

```sh
npm run build:medicion   # build como producción con valores ficticios
npm run presupuesto      # scripts/presupuesto-tamano.mjs
```

`npm run presupuesto` mide `apps/web/dist` y falla (código de salida 1) si alguna métrica supera su límite en `apps/web/presupuesto-tamano.json`. No usa dependencias; sus funciones están probadas en `scripts/medicion/*.test.mjs` (`npm run test:scripts`, también en el CI). El paso que hace fallar el CI es este presupuesto, que es determinista; la puntuación de Lighthouse es demasiado ruidosa para eso y se mide a mano.

| Métrica | Qué cuenta | Referencia | Límite (+5 %) |
| --- | --- | --- | --- |
| `jsInicialGzip` | JavaScript que pide `index.html` (script y `modulepreload`) más sus imports estáticos, con gzip: hoy `index-*.js`, `react-*.js` y `registerSW.js` | 86 025 B (84,0 KiB) | 90 327 B |
| `cssGzip` | Hojas de estilo que enlaza `index.html`, con gzip | 7 258 B (7,1 KiB) | 7 621 B |
| `precacheBytes` | Todos los archivos del manifiesto de precaché del service worker, sin comprimir (29 entradas) | 1 194 535 B (1166,5 KiB) | 1 254 262 B |

- El JavaScript inicial es lo que se descarga antes de pintar nada. El chunk `App` (Clerk, rutas y pantallas) se pide justo después y no entra en esa cifra; cualquier crecimiento suyo, o de los chunks diferidos, lo recoge el total precacheado.
- El plugin de PWA informa al terminar el build un precaché algo menor (1150,33 KiB) que la suma de los tamaños de los archivos de su manifiesto (1166,5 KiB); el presupuesto usa la suma.
- Medido dos veces seguidas con `npm run build:medicion && npm run presupuesto`: mismas cifras al byte. No está comprobado todavía que el build de Linux del CI dé exactamente los mismos bytes que el de macOS; si difiriera, el margen del 5 % lo absorbe.
- **Subir el presupuesto** a propósito: `npm run build:medicion && npm run presupuesto -- --actualizar` reescribe el archivo con lo medido como referencia y el 5 % de margen. El PR tiene que explicar por qué crece.

## Qué pesa en el bundle

Tamaños del build de `npm run build:medicion`. Las columnas gzip y Brotli están calculadas con Node (gzip nivel 9, Brotli calidad 11) sobre los archivos de `apps/web/dist/assets`.

| Chunk | Cuándo se descarga | Sin comprimir | gzip | Brotli |
| --- | --- | --- | --- | --- |
| `index` | al abrir (inicial) | 261 509 B | 82 618 B | 71 718 B |
| `react` | al abrir (inicial) | 8 539 B | 3 282 B | 2 949 B |
| `index.css` | al abrir (inicial) | 33 081 B | 7 258 B | 6 320 B |
| `App` | justo después, en cualquier ruta | 276 610 B | 74 601 B | 64 886 B |
| `ScientificName` (con los iconos) | con `App` | 11 170 B | 4 947 B | 4 346 B |
| `sentry` | tras el primer pintado | 94 158 B | 32 267 B | 28 885 B |
| `dist` (supabase-js) | en la primera consulta (con sesión, al entrar) | 217 567 B | 55 671 B | 47 136 B |
| `CatalogAdminPage` | solo en el backoffice | 105 806 B | 28 589 B | 24 512 B |
| Fuentes (4 woff2) | al pintar texto | 93 228 B | — | — |

Reparto por paquete del código de cada chunk, según el tamaño de cada módulo **antes de minificar** que informa el empaquetador (sirve para comparar, no son bytes descargados):

- `index`: react-dom 538 KB, react-router 87 KB, scheduler 9 KB; el código propio (configuración, observabilidad, rutas) suma unos 20 KB.
- `App`: @clerk/react 108 KB, @clerk/localizations (es-MX) 84 KB, @clerk/shared 69 KB, @tanstack/query-core 63 KB (dependencia de @clerk/shared, no la usa la app), `src/inventory` 50 KB, `src/collection` 29 KB, `src/photos` 13 KB, `src/auth` 10 KB.
- `dist` (supabase-js): @supabase/auth-js 174 KB, realtime-js 57 KB, storage-js 43 KB, phoenix 41 KB, postgrest-js 32 KB, supabase-js 23 KB, iceberg-js 8 KB, functions-js 6 KB. La app usa supabase-js con `accessToken` (el token de Clerk), así que Auth, Realtime y Functions no se usan.
- `sentry`: @sentry/core 142 KB, @sentry/browser 38 KB, @sentry/browser-utils 16 KB.

Lo que más pesa en el camino de la primera pantalla es React (react-dom) y, justo detrás, Clerk: entre @clerk/react, su localización, @clerk/shared y TanStack Query ocupan más de la mitad del chunk `App`, y además Clerk descarga su propio script desde su CDN (71,6 KiB con Brotli).

## Propuestas de recorte

Ordenadas por ahorro esperado en la carga. Solo la primera tiene el ahorro medido en tiempo.

> **Actualización (21 nov 2026):** la propuesta 1 ya está aplicada (entró con el modo sin conexión, #163). Las cifras de este documento son anteriores a ese cambio y a las funciones que entraron después; el presupuesto de `apps/web/presupuesto-tamano.json` sí está al día.

1. **Registrar el service worker sin bloquear el pintado** (`apps/web/vite.config.ts`, `injectRegister: 'script'` → `'script-defer'`). `registerSW.js` va hoy en el `<head>` sin `defer` y Lighthouse lo marca como bloqueante. Medido con el cambio aplicado de forma temporal (`npm run build:medicion` y `npm run medir:carga -- --sin-build --solo inicio`, 5 ejecuciones): FCP y LCP del inicio de 0,90 s a 0,75 s (mín.–máx. 0,75–0,75); Speed Index de 0,91 s a 0,84 s. No cambia ningún byte. No se aplica en este cambio porque la configuración de PWA la está tocando otra tarea en paralelo.
2. **Cliente de Supabase sin Auth, Realtime ni Functions** (`apps/web/src/lib/supabase.ts`): usar `@supabase/postgrest-js` (y `@supabase/storage-js` para las fotos) en lugar de `@supabase/supabase-js`. Los módulos que sobran suman unas tres cuartas partes del chunk de 47,1 KiB (Brotli) según su tamaño antes de minificar; el ahorro exacto está por medir. Ese chunk se descarga en cada entrada con sesión (perfil y colección) y compite por la red con la lista del inventario.
3. **Retrasar Sentry hasta que la página esté quieta** (`apps/web/src/observability/reporter.ts`): hoy el SDK (28,9 KiB con Brotli) se pide tras el primer pintado, en paralelo con `App` y con la colección. Pedirlo tras el evento `load` o en un momento ocioso libera la red de la primera pantalla; los errores anteriores ya se guardan en memoria. Ahorro en tiempo no medido.
4. **Revisar el peso de Clerk en `App`**: la localización es-MX (84 KB antes de minificar) y TanStack Query (63 KB, que arrastra @clerk/shared) van en el chunk que necesita cualquier pantalla. Opciones a valorar: comprobar si versiones nuevas de `@clerk/react` lo separan, o cargar la localización solo en las pantallas de acceso si Clerk lo permite. Sin medir.
5. **Inventario en su propio chunk** (`apps/web/src/App.tsx`, `CollectionPage` con `lazy`). Medido de forma temporal (solo tamaños): `App` baja de 64 886 B a 54 456 B con Brotli (−10,4 KiB) y aparece un chunk `CollectionPage` de 10 798 B que se pide al abrir `/coleccion`. Ayuda al inicio, que ya está en 0,90 s, y añade una petición encadenada al inventario, que es la pantalla en riesgo. **No se recomienda** salvo que se precargue tras el primer pintado.

Lo que se revisó y no hace falta tocar ahora:

- **Precarga de fuentes**: en el inicio el LCP es texto con `font-display: swap` y no espera a las fuentes (LCP = FCP = 0,90 s). Precargarlas competiría con el JavaScript por la red. Las cuatro van precacheadas para usarlas sin conexión.
- **Carga diferida de rutas**: ya está hecha (`App`, registro, detalle, edición, backoffice, muestra y diagnóstico van en chunks propios).
- **Tamaños de imagen**: el marcador «Sin foto» es un SVG en línea de 620 B y los iconos y favicons suman 16 126 B (15,7 KiB); solo el favicon y el icono de 192 px se piden al abrir.

## Issues por abrir

Redactados aquí; no se han abierto todavía.

**1. Rendimiento: medir el inventario con Clerk y Supabase reales y bajarlo de 3 s** (prioridad alta, área calidad, ejecuta: ambos)

> Con el método de `docs/medicion-de-carga.md`, el inventario con 100 plantas carga en 2,80 s (LCP, mediana de 5) sin Clerk ni Supabase reales. Falta lo que añaden: el script de Clerk (71,6 KiB con Brotli), su API para recuperar la sesión, el token y la consulta a PostgREST.
>
> Pasos: 1) con un usuario de prueba del ambiente de desarrollo y 100 plantas de ejemplo (`npm run db:seed:plants -- <usuario> 100`), medir `/coleccion` a mano con Lighthouse 13.6.0 (móvil, limitación simulada, 5 ejecuciones, mediana), y también la segunda visita con el service worker instalado; 2) anotar el resultado en el documento; 3) si pasa de 3 s, aplicar por orden las propuestas 1 a 3 del documento y volver a medir.
>
> Criterio: LCP del inventario con 100 plantas por debajo de 3 s en primera visita, o una decisión explícita sobre la segunda visita como referencia para la app instalada.

**2. Registrar el service worker con `defer`** (prioridad media, área rendimiento, ejecuta: agente)

> `injectRegister: 'script'` en `apps/web/vite.config.ts` pone `registerSW.js` en el `<head>` sin `defer`. Con `'script-defer'`, el FCP y el LCP del inicio bajan de 0,90 s a 0,75 s (medido, 5 ejecuciones). Comprobar que la app instalada sigue actualizándose sola (prueba manual de #60) y que el presupuesto no cambia.

**3. Cliente de Supabase sin Auth, Realtime ni Functions** (prioridad baja, área rendimiento, ejecuta: agente)

> El chunk de supabase-js pesa 47,1 KiB con Brotli y la mayor parte (auth-js, realtime-js, phoenix, functions-js, iceberg-js) no se usa: el token viene de Clerk. Sustituirlo por `@supabase/postgrest-js` y `@supabase/storage-js` en `apps/web/src/lib/supabase.ts`, medir el ahorro con `npm run build:medicion` y bajar el presupuesto con `npm run presupuesto -- --actualizar`.

**4. Portada: pintar el Hero sin esperar al chunk de la app** (prioridad media, área rendimiento, ejecuta: agente). **Hecho en el #204** (ver «Carga de la portada»).

> La portada (#179) da 3,95 s de LCP en la medición móvil: la foto se descarga enseguida, pero no se pinta hasta que llega y se ejecuta el chunk `App` (Clerk, rutas y pantallas). Opciones: llevar el Hero y las ventajas (sin Clerk) al chunk inicial y que `App` solo decida después si `/` lleva a la colección, o pintarlos como `fallback` mientras `App` carga. Medir el efecto en el JavaScript inicial (hoy al 95,3 % del presupuesto) y en el inventario.

## Inventario con Clerk y Supabase reales (#169)

Medición a mano del 23 nov 2026, distinta de la de Lighthouse: el build de producción (`npm run build`, con la configuración del ambiente de desarrollo) servido con `scripts/medicion/servidor.mjs`, abierto en Chrome de escritorio con una sesión real y 100 plantas, **sin limitar la red ni la CPU** y con el service worker ya instalado. Los tiempos salen de la API de rendimiento del navegador (LCP y `PerformanceResourceTiming`). Son una o dos cargas por caso, no una mediana: sirven para ver el orden de las peticiones, no como cifra de referencia.

Qué añade la app real a la carga de `/coleccion`, en orden:

| Paso | Empieza | Termina |
| --- | --- | --- |
| `clerk.browser.js` y `ui.browser.js` (en caché) | 0,13–0,17 s | 0,28–0,31 s |
| API de Clerk (`/v1/environment` y `/v1/client`, en paralelo) | 0,34–0,37 s | 0,59–0,64 s |
| `profiles` y `plants` (PostgREST, en paralelo) | 0,56–0,68 s | 0,87–0,98 s |
| Extras de «¿Ya la tengo?» (`species_names` × 2 y `genus_abbreviations`) | tras `plants` | ver abajo |

Hallazgo: sin copia local, las tarjetas no se pintaban al llegar `plants`, sino al terminar los extras, que además se pedían uno tras otro (tres viajes más con 100 plantas).

| Caso (sin copia local) | Llega `plants` | Terminan los extras | LCP (primera tarjeta) |
| --- | --- | --- | --- |
| Antes | 0,98 s | 2,02 s | 2,08 s |
| Después | 0,87 s | 1,18 s | 0,93 s |

Cambio aplicado: `cached-source.ts` entrega las plantas de la red en cuanto llegan (`provide`) y `extras-source.ts` pide todos los grupos a la vez. Con copia local (visitas siguientes en el mismo dispositivo) el LCP fue de 0,72 s: la copia se pinta en cuanto Clerk confirma la sesión, sin esperar a Supabase.

Sin medir todavía: lo mismo con Lighthouse (móvil, red y CPU limitadas) y sesión real, que es lo que pide el criterio de los 3 s. Lighthouse abre un Chrome sin la sesión; hace falta lanzarlo contra un Chrome con depuración remota y la sesión iniciada. En red limitada cada viaje ahorrado pesa más que aquí (150 ms de ida y vuelta simulados más el tiempo del servidor), así que la mejora debería ser mayor, no menor; está por comprobar.
