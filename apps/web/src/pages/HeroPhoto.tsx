import {
  HERO_ALT,
  HERO_AVIF_SRCSET,
  HERO_FALLBACK,
  HERO_LARGEST,
  HERO_SIZES,
} from './hero-photo-sources.ts'

// Foto del Hero de la portada (#192, #193); los archivos y las medidas, en
// hero-photo-sources.ts.
//
// - AVIF en varios anchos con srcset y sizes; un JPEG de respaldo para los
//   navegadores sin AVIF.
// - width y height del archivo más grande: el navegador reserva el hueco y
//   nada se mueve al llegar. El Hero dividido la recorta con object-fit:
//   cover a la altura del bloque en escritorio y a 2:1 en celular.
// - Prioridad alta y sin carga diferida: en celular es el elemento más grande
//   de la primera pantalla (el LCP). Va también en la portada prerrenderada
//   del index.html, que la precarga desde el HTML (#204, ver
//   docs/medicion-de-carga.md).
// - Fuera del precaché del service worker (globIgnores en vite.config.ts):
//   sin conexión, en su hueco queda el texto alternativo.
export function HeroPhoto() {
  return (
    <picture>
      <source type="image/avif" srcSet={HERO_AVIF_SRCSET} sizes={HERO_SIZES} />
      <img
        className="orki-hero__photo"
        src={HERO_FALLBACK}
        alt={HERO_ALT}
        width={HERO_LARGEST.ancho}
        height={HERO_LARGEST.alto}
        fetchPriority="high"
      />
    </picture>
  )
}
