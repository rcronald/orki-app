import { anchos, respaldo, textoAlternativo } from '../assets/portada/foto.json'

// Foto del Hero de la portada (#192, #193). Las variantes las genera
// `npm run portada --workspace=apps/web -- preparar <foto> "<texto alternativo>"`
// (scripts/foto-portada.mjs) en src/assets/portada/, con foto.json; aquí
// solo se leen. Su origen y cómo sustituirla: src/assets/portada/LEEME.md.
//
// - AVIF en varios anchos con srcset y sizes; un JPEG de respaldo para los
//   navegadores sin AVIF.
// - width y height del archivo más grande: el navegador reserva el hueco
//   (3:2, como el recorte de orki-hero__photo) y nada se mueve al llegar.
// - Prioridad alta y sin carga diferida: en celular es el elemento más grande
//   de la primera pantalla (el LCP).
// - Fuera del precaché del service worker (globIgnores en vite.config.ts):
//   sin conexión, la portada se ve con el fondo y el texto alternativo.
// - `?no-inline`: Vite nunca la mete en el JavaScript como data URL.

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

const AVIF_SRCSET = anchos
  .map((entry) => `${url(AVIF, entry.archivo)} ${entry.ancho}w`)
  .join(', ')
const FALLBACK = url(JPEG, respaldo.archivo)
const LARGEST = anchos.reduce((a, b) => (b.ancho > a.ancho ? b : a))

// Ancho con el que se pinta: hasta 720 px, el de la pantalla menos el margen
// del Hero (16 px por lado); más ancho, la mitad de la pantalla como máximo.
const SIZES = '(max-width: 720px) calc(100vw - 32px), 50vw'

export function HeroPhoto() {
  return (
    <picture>
      <source type="image/avif" srcSet={AVIF_SRCSET} sizes={SIZES} />
      <img
        className="orki-hero__photo"
        src={FALLBACK}
        alt={textoAlternativo}
        width={LARGEST.ancho}
        height={LARGEST.alto}
        fetchPriority="high"
      />
    </picture>
  )
}
