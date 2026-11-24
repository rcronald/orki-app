import { defineConfig, devices } from '@playwright/test'

// Pruebas de extremo a extremo (#148). Corren contra el build de
// apps/web/dist-medicion/e2e (npm run build:e2e: la app de producción con Clerk
// simulado), servido en local como en Vercel. Supabase se simula en la red
// (e2e/soporte/). Ver docs/pruebas.md.
//
//   npm run test:e2e                       # construye y prueba en los 4 perfiles
//   npm run test:e2e -- --project=webkit   # un solo motor (sin volver a construir:
//                                          # npm run test:e2e:sin-build -- ...)

const CI = Boolean(process.env.CI)

// Puerto del servidor de las pruebas: 4317, o el de ORKI_E2E_PUERTO para correr
// a la vez desde otra copia de trabajo (#295):
//
//   ORKI_E2E_PUERTO=4441 npm run test:e2e:sin-build -- --project=chromium
function puertoDeLasPruebas(valor: string | undefined): number {
  if (valor === undefined || valor === '') return 4317
  const puerto = Number(valor)
  if (!Number.isInteger(puerto) || puerto < 1024 || puerto > 65535) {
    throw new Error(
      `ORKI_E2E_PUERTO tiene que ser un número de puerto entre 1024 y 65535, no «${valor}».`,
    )
  }
  return puerto
}
const PUERTO = puertoDeLasPruebas(process.env.ORKI_E2E_PUERTO)

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
  // Reparto por perfil (#259). Sin etiqueta, una prueba corre en los cuatro
  // perfiles: es lo que se espera de una prueba nueva, y ante la duda se deja
  // así. Dos etiquetas (`{ tag: ... }` en test o test.describe) la sacan solo
  // del perfil `celular`:
  //
  // - @logica: flujos que no dependen del motor (rutas, sesión, lo que se
  //   escribe en Supabase, respuestas de la app). WebKit ya los corre en el
  //   perfil `webkit`; el de celular es el mismo motor. No se pone en lo que
  //   mide el diseño, el foco o el teclado, ni en lo que usa el puntero, las
  //   fotos, el service worker o la portada prerrenderada.
  // - @escritorio: variantes a ancho de escritorio (1440 o 1536 px), que no
  //   son un caso real con la pantalla de un iPhone.
  //
  // axe corre solo en chromium, y eso lo decide la fixture
  // revisarAccesibilidad (e2e/soporte/fixtures.ts), no las pruebas.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    // Celular: pantalla pequeña, táctil y Safari de iPhone, el navegador con
    // más limitaciones para una PWA (#25).
    {
      name: 'celular',
      use: { ...devices['iPhone 15'] },
      grepInvert: /@logica|@escritorio/,
    },
  ],
  webServer: {
    command: `node ../../scripts/servir-e2e.mjs ${PUERTO}`,
    url: `http://127.0.0.1:${PUERTO}/`,
    // Nunca se reutiliza un servidor que ya escuche en el puerto: podría ser el
    // de otra copia de trabajo, con otro build, y las pruebas pasarían o
    // fallarían por un código que no es este. Si el puerto está ocupado,
    // Playwright se para con «… is already used»: usa otro con
    // ORKI_E2E_PUERTO. Arrancar este servidor tarda menos de un segundo.
    reuseExistingServer: false,
    stdout: 'pipe',
    timeout: 60_000,
  },
})
