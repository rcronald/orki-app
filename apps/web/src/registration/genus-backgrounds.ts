import cattleya from '../assets/fondos-genero/cattleya.avif?no-inline'
import dendrobium from '../assets/fondos-genero/dendrobium.avif?no-inline'
import oncidium from '../assets/fondos-genero/oncidium.avif?no-inline'
import phalaenopsis from '../assets/fondos-genero/phalaenopsis.avif?no-inline'
import vanda from '../assets/fondos-genero/vanda.avif?no-inline'

// Fotos de fondo por género del registro (#13). Van empaquetadas en la app (no
// en un bucket): Vite las copia al build como archivos aparte con huella en el
// nombre y el service worker las precachea (globPatterns de vite.config.ts),
// así funcionan sin conexión. Aquí solo hay sus URL: ni las fotos ni este
// módulo van en el bundle inicial, porque solo lo importa el formulario de
// registro, que es un chunk diferido. `?no-inline` impide que Vite meta una
// foto pequeña dentro del JavaScript como data URL.
//
// Hoy son fotos PROVISIONALES generadas por script; cómo se sustituyen por las
// definitivas está en src/assets/fondos-genero/LEEME.md.
//
// Se buscan por el nombre del género (los cinco de acceso rápido), sin
// distinguir mayúsculas: los ids de genera dependen de cada base de datos.

const BACKGROUNDS: ReadonlyMap<string, string> = new Map([
  ['cattleya', cattleya],
  ['dendrobium', dendrobium],
  ['oncidium', oncidium],
  ['phalaenopsis', phalaenopsis],
  ['vanda', vanda],
])

/** Géneros con foto de fondo, en minúsculas. */
export const GENERA_WITH_BACKGROUND: readonly string[] = [...BACKGROUNDS.keys()]

/** URL de la foto de fondo del género, o null si no tiene (fondo neutro). */
export function genusBackgroundUrl(genusName: string | null): string | null {
  if (genusName === null) return null
  return BACKGROUNDS.get(genusName.trim().toLowerCase()) ?? null
}
