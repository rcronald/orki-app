import { defineConfig, devices } from '@playwright/test'

// Pruebas de extremo a extremo (#148). Corren contra el build de
// apps/web/dist-medicion/e2e (npm run build:e2e: la app de producción con Clerk
// simulado), servido en local como en Vercel. Supabase se simula en la red
// (e2e/soporte/). Ver la sección "Pruebas de extremo a extremo" del README.
//
//   npm run test:e2e                       # construye y prueba en los 4 perfiles
//   npm run test:e2e -- --project=webkit   # un solo motor (sin volver a construir:
//                                          # npm run test:e2e:sin-build -- ...)

const PUERTO = 4317
const CI = Boolean(process.env.CI)

export default defineConfig({
  testDir: './e2e',
  // Cada prueba es independiente (contexto y Supabase propios), así que todas
  // pueden ir en paralelo, también las de un mismo archivo.
  fullyParallel: true,
  forbidOnly: CI,
  // En el CI, un reintento: si pasa a la segunda, el informe la marca como
  // inestable ("flaky") en vez de esconderla.
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: CI
    ? [['github'], ['list'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${PUERTO}`,
    locale: 'es-PE',
    timezoneId: 'America/Lima',
    // El service worker serviría las peticiones de la app sin pasar por las
    // rutas de Playwright; solo las pruebas de la PWA lo activan.
    serviceWorkers: 'block',
    actionTimeout: 10_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    // Celular: pantalla pequeña, táctil y Safari de iPhone, el navegador con
    // más limitaciones para una PWA (#25).
    { name: 'celular', use: { ...devices['iPhone 15'] } },
  ],
  webServer: {
    command: `node ../../scripts/servir-e2e.mjs ${PUERTO}`,
    url: `http://127.0.0.1:${PUERTO}/`,
    reuseExistingServer: !CI,
    stdout: 'pipe',
    timeout: 60_000,
  },
})
