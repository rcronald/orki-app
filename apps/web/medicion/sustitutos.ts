import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

// Sustitución de módulos al construir, común a los dos builds de esta carpeta
// (#149, #148): el de medición de la carga (vite.config.ts) y el de las pruebas
// de extremo a extremo (vite.config.e2e.ts). Los dos son la app real (mismo
// index.html, main.tsx y rutas) con algún módulo cambiado por un sustituto.
//
// - @clerk/react → clerk-simulado.tsx, siempre: Clerk descarga su script de
//   su CDN y habla con su API, así que no se puede simular en la red sin
//   reimplementarlo. El sustituto da la sesión que pida la prueba.
// - src/collection/supabase-source.ts → otro módulo, solo si se pide (el
//   build de medición lee la colección de un JSON local; el de las pruebas
//   usa el original y simula Supabase en la red).
//
// Nada de esto llega a apps/web/dist: ni main.tsx ni vite.config.ts importan
// esta carpeta, y cada build escribe en apps/web/dist-medicion.

const CARPETA = path.dirname(fileURLToPath(import.meta.url))
const ORIGINAL_DE_LA_COLECCION = path.resolve(
  CARPETA,
  '../src/collection/supabase-source.ts',
)

export const CLERK_SIMULADO = path.join(CARPETA, 'clerk-simulado.tsx')

interface OpcionesDeSustitutos {
  /** Módulo que sustituye a src/collection/supabase-source.ts, si alguno. */
  fuenteDeLaColeccion?: string
}

export function sustitutos({
  fuenteDeLaColeccion,
}: OpcionesDeSustitutos = {}): Plugin {
  return {
    name: 'orki-sustitutos',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      // Solo el paquete: @clerk/react/errors (ClerkOfflineError) es una clase
      // sin red y se queda la real.
      if (source === '@clerk/react') return CLERK_SIMULADO
      if (
        fuenteDeLaColeccion === undefined ||
        importer === undefined ||
        !source.includes('supabase-source')
      ) {
        return null
      }
      const resuelto = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      })
      return resuelto?.id === ORIGINAL_DE_LA_COLECCION
        ? fuenteDeLaColeccion
        : null
    },
  }
}
