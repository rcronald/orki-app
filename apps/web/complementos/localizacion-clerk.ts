import type { Plugin } from 'vite'

// Localización es-MX de Clerk sin las cadenas que Clerk aún no ha traducido
// (#287). Solo en el build.
//
// @clerk/localizations/es-MX trae todas las claves de Clerk, y las que no
// tienen traducción van como `undefined` (`clave: void 0`): son unas tres de
// cada cinco. Clerk las trata igual que si faltaran: su interfaz (@clerk/ui,
// localization/parseLocalization.ts) mezcla primero sus textos en inglés y
// encima los de la localización con fastDeepMergeAndReplace (@clerk/shared),
// que se salta los valores `undefined`. Quitarlas no cambia ningún texto
// visible y no obliga a mantener una lista de claves: se conserva todo lo
// traducido, también lo de pantallas que la app no usa, y una versión nueva
// del paquete entra tal cual.
//
// El módulo del paquete se sustituye por el mismo objeto ya limpio, escrito
// como literal. En las pruebas unitarias (vitest) se usa el original.

/** El módulo de la localización es-MX, como lo resuelve Vite. */
export const MODULO_ES_MX =
  /[\\/]@clerk[\\/]localizations[\\/]dist[\\/]es-MX\.mjs$/

/**
 * Copia de la localización sin los valores `undefined` ni los objetos que se
 * quedan vacíos al quitarlos. El resto, tal cual.
 */
export function sinCadenasSinTraducir(valor: unknown): unknown {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) {
    return valor
  }
  const copia: Record<string, unknown> = {}
  for (const [clave, interior] of Object.entries(valor)) {
    const limpio = sinCadenasSinTraducir(interior)
    if (limpio === undefined) continue
    if (
      typeof limpio === 'object' &&
      limpio !== null &&
      !Array.isArray(limpio) &&
      Object.keys(limpio).length === 0
    ) {
      continue
    }
    copia[clave] = limpio
  }
  return copia
}

/** El código del módulo sustituto: exporta `esMX`, como el original. */
export function moduloEsMx(esMX: unknown): string {
  return `export const esMX = ${JSON.stringify(sinCadenasSinTraducir(esMX))};\n`
}

export function localizacionClerk(): Plugin {
  return {
    name: 'orki-localizacion-clerk',
    apply: 'build',
    async load(id) {
      if (!MODULO_ES_MX.test(id.split('?')[0])) return null
      const { esMX } = await import('@clerk/localizations/es-MX')
      return moduloEsMx(esMX)
    },
  }
}
