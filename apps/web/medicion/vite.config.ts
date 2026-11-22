import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeConfig, type Plugin } from 'vite'
import { largeSampleCollection } from '../src/showcase/inventory-data.ts'
import baseConfig from '../vite.config.ts'

// Build de medición del inventario (#149): la app real (mismo index.html,
// main.tsx y rutas) con dos módulos sustituidos al construir, para abrir
// /coleccion con sesión y 100 plantas sin Clerk ni Supabase reales:
//
// - @clerk/react → medicion/clerk-simulado.tsx (sesión iniciada, sin red).
// - src/collection/supabase-source.ts → medicion/coleccion-simulada.ts, que
//   pide /medicion/coleccion.json (generado aquí con las plantas de la
//   muestra) en lugar de consultar Supabase, así la lectura sigue siendo una
//   petición de red que Lighthouse simula con la latencia y el ancho de banda
//   del 4G.
//
// Solo lo usa scripts/medir-carga.mjs, que lo construye en
// apps/web/dist-medicion/app. No forma parte del build de la app: ni main.tsx ni
// vite.config.ts lo importan, y nada de esta carpeta llega a apps/web/dist.

const CARPETA = path.dirname(fileURLToPath(import.meta.url))
const ORIGINAL_DE_LA_COLECCION = path.resolve(
  CARPETA,
  '../src/collection/supabase-source.ts',
)

/** Plantas de la colección simulada; las del criterio del #149. */
export const PLANTAS_DE_MEDICION = 100

function sustitutosDeMedicion(): Plugin {
  return {
    name: 'orki-medicion-sustitutos',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (source === '@clerk/react') {
        return path.join(CARPETA, 'clerk-simulado.tsx')
      }
      if (importer === undefined || !source.includes('supabase-source')) {
        return null
      }
      const resuelto = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      })
      return resuelto?.id === ORIGINAL_DE_LA_COLECCION
        ? path.join(CARPETA, 'coleccion-simulada.ts')
        : null
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'medicion/coleccion.json',
        source: JSON.stringify(largeSampleCollection(PLANTAS_DE_MEDICION)),
      })
    },
  }
}

export default mergeConfig(baseConfig, {
  plugins: [sustitutosDeMedicion()],
  build: {
    outDir: path.resolve(CARPETA, '../dist-medicion/app'),
    emptyOutDir: true,
  },
})
