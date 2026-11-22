import { anchos, respaldo, textoAlternativo } from '../assets/portada/foto.json'

// Archivos y medidas de la foto de la portada (#192, #193). Las variantes las
// genera `npm run portada --workspace=apps/web -- preparar <foto> "<texto
// alternativo>"` (scripts/foto-portada.mjs) en src/assets/portada/, con
// foto.json; aquí solo se leen. Su origen y cómo sustituirla:
// src/assets/portada/LEEME.md.
//
// Lo usan HeroPhoto y la portada prerrenderada del index.html (#204), que
// precarga la misma variante que el navegador elegirá para el <img>.
//
// `?no-inline`: Vite nunca la mete en el JavaScript como data URL.

const AVIF = import.meta.glob<string>('../assets/portada/portada-*.avif', {
  eager: true,
  query: '?no-inline',
  import: 'default',
})
const JPEG = import.meta.glob<string>('../assets/portada/portada-*.jpg', {
  eager: true,
  query: '?no-inline',
  import: 'default',
})

function url(files: Record<string, string>, name: string): string {
  const found = files[`../assets/portada/${name}`]
  if (found === undefined) {
    throw new Error(`Falta ${name}: npm run portada -- preparar`)
  }
  return found
}

/** Variantes AVIF para srcset, de la más pequeña a la más grande. */
export const HERO_AVIF_SRCSET = anchos
  .map((entry) => `${url(AVIF, entry.archivo)} ${entry.ancho}w`)
  .join(', ')

/** JPEG de respaldo para los navegadores sin AVIF. */
export const HERO_FALLBACK = url(JPEG, respaldo.archivo)

/** Medidas del archivo más grande: reservan el hueco con su proporción. */
export const HERO_LARGEST = anchos.reduce((a, b) => (b.ancho > a.ancho ? b : a))

/**
 * Ancho con el que se pinta: hasta 720 px, el de la pantalla menos el margen
 * del Hero (16 px por lado); más ancho, la columna de la foto del Hero
 * dividido (5/9 de la pantalla, unos 56vw).
 */
export const HERO_SIZES = '(max-width: 720px) calc(100vw - 32px), 56vw'

export const HERO_ALT = textoAlternativo
