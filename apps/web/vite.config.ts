import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // El service worker nuevo se activa solo y toma el control sin preguntar.
      registerType: 'autoUpdate',
      // Registro mediante un script generado (registerSW.js) inyectado en el HTML
      // del build; en `vite dev` no se inyecta ni se genera service worker.
      injectRegister: 'script',
      devOptions: { enabled: false },
      includeAssets: [
        'favicon.ico',
        'favicon.svg',
        'apple-touch-icon-180x180.png',
      ],
      manifest: {
        name: 'Orki',
        short_name: 'Orki',
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
        // se vea con su tipografía sin conexión.
        globPatterns: ['**/*.{js,css,html,woff2}'],
        // Cualquier navegación sin coincidencia en caché responde con index.html.
        //
        // Autenticación (Clerk y Google): a propósito no hay runtimeCaching, así
        // que el service worker solo responde a los archivos precacheados y a
        // las navegaciones dentro de la app. Las peticiones a Clerk (su script
        // y su API, en el dominio de Frontend API de cada instancia) y a Google
        // son de otro origen y van siempre a la red, sin guardarse. Las
        // redirecciones de inicio de sesión ocurren en esos dominios y, a la
        // vuelta, llegan a rutas de la app (/iniciar-sesion con los pasos en el
        // hash, o la raíz con parámetros de Clerk en la URL), que deben recibir
        // index.html para que Clerk termine el proceso en el navegador. Por eso
        // no hace falta navigateFallbackDenylist: Clerk no tiene rutas propias
        // en este dominio. Haría falta si algún día se usa el proxy de Clerk
        // (proxyUrl), que sí sirve rutas bajo el dominio de la app.
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // Con el registro por script no hay aviso en la interfaz: la versión
        // nueva se activa en cuanto se instala y controla las pestañas abiertas.
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
})
