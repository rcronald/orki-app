import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeConfig } from 'vite'
import baseConfig from '../vite.config.ts'
import { sustitutos } from './sustitutos.ts'
import { VERSION_B_E2E, versionB } from './version-b.ts'

// Build de las pruebas de extremo a extremo (#148): la app real, construida
// como producción con los valores ficticios de scripts/medicion/entorno.mjs,
// con un solo módulo sustituido: @clerk/react → medicion/clerk-simulado.tsx,
// cuya sesión elige cada prueba (ver ese archivo). Todo lo demás es el código
// de la app, también el cliente de Supabase: sus peticiones salen hacia
// https://supabase.orki.invalid y las pruebas las responden en la capa de red
// de Playwright (apps/web/e2e/soporte/supabase-simulado.ts). El service worker
// es el de producción y se registra de verdad.
//
// Lo construye `npm run build:e2e` en apps/web/dist-medicion/e2e. No forma
// parte del build de la app: nada de esta carpeta llega a apps/web/dist.
//
// Con ORKI_E2E_VERSION=b sale además la «versión B» en
// apps/web/dist-medicion/e2e-b: el mismo build con un texto de los créditos
// cambiado, para probar el paso de una versión a otra (#278; ver
// medicion/version-b.ts y e2e/actualizacion.spec.ts).

const CARPETA = path.dirname(fileURLToPath(import.meta.url))
const ES_VERSION_B = process.env.ORKI_E2E_VERSION === VERSION_B_E2E

export default mergeConfig(baseConfig, {
  plugins: [sustitutos(), ...(ES_VERSION_B ? [versionB()] : [])],
  build: {
    outDir: path.resolve(
      CARPETA,
      ES_VERSION_B ? '../dist-medicion/e2e-b' : '../dist-medicion/e2e',
    ),
    emptyOutDir: true,
  },
})
