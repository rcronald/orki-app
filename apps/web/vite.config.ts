import { sentryVitePlugin } from '@sentry/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin, type PluginOption } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { portadaPrevia } from './prerender/portada-previa-plugin.ts'

// Versión desplegada: el commit que Vercel construye. Vercel la expone durante
// el build en VERCEL_GIT_COMMIT_SHA (variable de sistema, con "Automatically
// expose System Environment Variables" activado, que es lo normal). En local no
// existe y los errores van sin versión.
const release = /^[0-9a-f]{7,40}$/i.test(
  process.env.VERCEL_GIT_COMMIT_SHA ?? '',
)
  ? process.env.VERCEL_GIT_COMMIT_SHA
  : undefined

// La versión va en una etiqueta meta del HTML, que el cargador de Sentry lee al
// arrancar (src/observability/reporter.ts). Si fuera en el JavaScript, todos los
// chunks cambiarían de nombre en cada despliegue y quien vuelve a la app los
// descargaría de nuevo aunque su código no hubiera cambiado.
function releaseMeta(): Plugin {
  return {
    name: 'orki-release-meta',
    transformIndexHtml() {
      return release === undefined
        ? []
        : [
            {
              tag: 'meta',
              attrs: { name: 'orki-release', content: release },
              injectTo: 'head',
            },
          ]
    },
  }
}

// Mapas de código fuente para Sentry: solo si el build tiene las tres
// variables con los nombres estándar del plugin (en Vercel, solo en los
// ambientes que deban subirlos). Sin ellas el plugin no se registra y el build
// es el de siempre: sin mapas de código fuente y sin contactar con Sentry.
//
// Con ellas, el plugin activa mapas ocultos (sin comentario sourceMappingURL),
// inyecta en cada chunk un identificador (debug ID) que enlaza el archivo con
// su mapa, los sube y los quita de la salida: nunca llegan a dist, así que no
// se sirven al público. filesToDeleteAfterUpload es una segunda barrera por si
// otro plugin genera alguno. Un fallo al subir solo avisa: el despliegue no
// depende de que Sentry responda.
function sentrySourceMaps(): PluginOption[] {
  const { SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT } = process.env
  if (!SENTRY_AUTH_TOKEN || !SENTRY_ORG || !SENTRY_PROJECT) return []
  return [
    sentryVitePlugin({
      org: SENTRY_ORG,
      project: SENTRY_PROJECT,
      authToken: SENTRY_AUTH_TOKEN,
      telemetry: false,
      sourcemaps: {
        deleteSourcemapsAfterUpload: true,
        filesToDeleteAfterUpload: ['./dist/**/*.map'],
      },
      release: {
        // La versión va en el HTML (releaseMeta); aquí solo se crea en Sentry.
        ...(release !== undefined && { name: release }),
        inject: false,
        setCommits: false,
      },
      errorHandler: (error) => {
        console.warn(
          `No se pudieron subir los mapas de código fuente a Sentry: ${error.message}`,
        )
      },
    }),
  ]
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    releaseMeta(),
    react(),
    tailwindcss(),
    // Portada prerrenderada en index.html (#204), antes del plugin de PWA:
    // la revisión de index.html en el precaché tiene que ser la del HTML final.
    portadaPrevia(),
    VitePWA({
      // Versión nueva con aviso (#278). El service worker nuevo se instala y
      // espera: la pestaña sigue con el código y el precaché de su versión,
      // así que sus chunks siguen llegando. Entra cuando la persona pulsa
      // «Actualizar» (src/pwa/UpdateNotice.tsx) o cuando no queda ninguna
      // pestaña de la app abierta. Con 'autoUpdate' se activaba solo, borraba
      // del precaché los chunks viejos y la pestaña abierta, al pedir uno, se
      // encontraba un 404 y la pantalla «Algo salió mal».
      registerType: 'prompt',
      // Lo registra la app con virtual:pwa-register (src/pwa/actualizacion.ts)
      // cuando llega el chunk de App, después del primer pintado, como hacía
      // el registerSW.js con `defer` (#149): nada en el HTML. En `vite dev` no
      // se genera service worker.
      injectRegister: false,
      devOptions: { enabled: false },
      includeAssets: [
        'favicon.ico',
        'favicon.svg',
        'apple-touch-icon-180x180.png',
      ],
      manifest: {
        name: 'orqui.app',
        short_name: 'orqui.app',
        description: 'Inventario de tu colección de orquídeas.',
        lang: 'es',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#D52E66',
        background_color: '#FFFCF7',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // JS, CSS, HTML y fuentes (woff2) del build; los iconos y el manifest los
        // añade el plugin (includeAssets e iconos del manifest), así no se
        // duplican en el precache. Las fuentes van precacheadas para que la app
        // se vea con su tipografía sin conexión. Las fotos de fondo por género
        // del registro (avif, #13) se precacheaban; desde el #221 el
        // formulario no las usa, así que ya no van en el build.
        globPatterns: ['**/*.{js,css,html,woff2,avif}'],
        // La foto de la portada (#193) no: sus cinco variantes suman unos
        // 450 KB, más de lo que queda en el presupuesto del precaché, y quien
        // la necesita es una visita nueva, con conexión. Sin conexión, la
        // portada se ve igual con el fondo de la foto y su texto alternativo.
        // El JPEG de respaldo no entra en globPatterns; se nombra por claridad.
        globIgnores: ['**/portada-*.avif', '**/portada-*.jpg'],
        // Cualquier navegación sin coincidencia en caché responde con index.html,
        // así que todas las rutas de la app (src/routes/paths.ts, incluidas las
        // subrutas de Clerk como /iniciar-sesion/sso-callback) se abren y se
        // recargan con la app instalada; el enrutador decide la pantalla. En
        // Vercel lo mismo lo hace la reescritura de vercel.json.
        //
        // Autenticación (Clerk y Google): a propósito no hay runtimeCaching, así
        // que el service worker solo responde a los archivos precacheados y a
        // las navegaciones dentro de la app. Las peticiones a Clerk (su script
        // y su API, en el dominio de Frontend API de cada instancia) y a Google
        // son de otro origen y van siempre a la red, sin guardarse. Las
        // redirecciones de inicio de sesión ocurren en esos dominios y, a la
        // vuelta, llegan a rutas de la app (subrutas de /iniciar-sesion o de
        // /registro, o la página pedida con parámetros de Clerk), que deben recibir
        // index.html para que Clerk termine el proceso en el navegador. Por eso
        // no hace falta navigateFallbackDenylist: Clerk no tiene rutas propias
        // en este dominio. Haría falta si algún día se usa el proxy de Clerk
        // (proxyUrl), que sí sirve rutas bajo el dominio de la app.
        navigateFallback: 'index.html',
        // Borra las cachés de formatos viejos de Workbox. No toca el precaché
        // de la versión en uso: los chunks viejos los quita el service worker
        // nuevo al activarse, y en modo 'prompt' eso no pasa hasta que se
        // acepta la versión nueva o se cierran todas las pestañas.
        cleanupOutdatedCaches: true,
        // Sin skipWaiting (#278): el service worker nuevo espera. «Actualizar»
        // le pide que deje de esperar con un mensaje (SKIP_WAITING), que el
        // modo 'prompt' añade al service worker generado.
        skipWaiting: false,
        // La primera vez que se instala toma el control de la pestaña abierta
        // sin recargar, así la app ya funciona sin conexión desde la primera
        // visita. En una actualización no cambia nada: al activarse, el
        // service worker nuevo pasa a controlar las pestañas de todos modos.
        clientsClaim: true,
        // Sin mapas del service worker. El plugin de PWA los generaría al ver
        // los mapas ocultos que activa el plugin de Sentry, y como se escriben
        // después de que este limpie la salida, se quedarían publicados.
        sourcemap: false,
      },
    }),
    // El plugin de Sentry va el último, como pide su documentación.
    ...sentrySourceMaps(),
  ],
})
