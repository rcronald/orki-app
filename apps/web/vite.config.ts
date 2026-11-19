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
        theme_color: '#D83B6F',
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
        // JS, CSS y HTML del build; los iconos y el manifest los añade el plugin
        // (includeAssets e iconos del manifest), así no se duplican en el precache.
        globPatterns: ['**/*.{js,css,html}'],
        // Cualquier navegación sin coincidencia en caché responde con index.html.
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
