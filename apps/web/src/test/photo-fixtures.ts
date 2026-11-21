import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Accesorios de prueba de src/photos/fixtures/, todos sintéticos (un
// degradado de 48 × 32 px con un cuadrado rojo arriba a la izquierda, sin
// datos de ninguna persona ni lugar):
// - sin-metadatos.jpg, .webp y .png: codificados por Chrome 157 desde un
//   OffscreenCanvas (el WebP lleva VP8X con un perfil ICC, como el que genera
//   la app).
// - exif-gps-orientacion-6.jpg: el JPEG anterior con un APP1 EXIF (Make
//   "Orki", Model "Prueba", Orientation 6 y un GPS inventado: 1° 2' 3" N,
//   4° 5' 6" W), un APP1 XMP con el mismo GPS y un comentario COM.
// - exif-xmp.webp: el WebP anterior con fragmentos EXIF y XMP y los
//   indicadores de VP8X correspondientes.
// - foto.heic: el PNG convertido a HEIC con `sips` de macOS.
// Se armaron con un script de Node que escribe los segmentos a mano.

export type FixtureName =
  | 'sin-metadatos.jpg'
  | 'sin-metadatos.webp'
  | 'sin-metadatos.png'
  | 'exif-gps-orientacion-6.jpg'
  | 'exif-xmp.webp'
  | 'foto.heic'

export function fixture(name: FixtureName): Uint8Array<ArrayBuffer> {
  // Vitest corre en apps/web (los módulos que no son de prueba no reciben un
  // import.meta.url de archivo).
  const buffer = readFileSync(resolve('src/photos/fixtures', name))
  return new Uint8Array(buffer)
}
