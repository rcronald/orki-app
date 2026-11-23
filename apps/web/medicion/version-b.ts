import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

// «Versión B» del build de las pruebas (#278): la misma app con un texto de
// los créditos cambiado, como haría un despliegue que solo toca esa página.
// Vite le da otro nombre al chunk de los créditos y, en cascada, a los que lo
// importan; el service worker de B lleva su propio precaché. Así
// e2e/actualizacion.spec.ts prueba el paso de A a B sin un segundo
// repositorio: B se construye en paralelo con A (scripts/construir-e2e.mjs).

/** Valor de ORKI_E2E_VERSION que construye la versión B. */
export const VERSION_B_E2E = 'b'

/** Texto de los créditos que cambia en B (el resumen de la primera sección). */
export const TEXTO_A = 'Las especies salen del Catalogue of Life;'
export const TEXTO_B = 'Versión B: las especies salen del Catalogue of Life;'

const CREDITOS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/credits/CreditsPage.tsx',
)

export function versionB(): Plugin {
  return {
    name: 'orki-version-b',
    enforce: 'pre',
    transform(codigo, id) {
      if (id !== CREDITOS) return null
      if (!codigo.includes(TEXTO_A)) {
        // Si el texto cambia en la app, que el build lo diga en lugar de
        // dejar una B idéntica a A.
        throw new Error(
          `version-b: no está «${TEXTO_A}» en src/credits/CreditsPage.tsx`,
        )
      }
      return codigo.replace(TEXTO_A, TEXTO_B)
    },
  }
}
