import { isJpeg } from './containers.ts'
import type { ExifOrientation } from './sniff.ts'

// Orientación EXIF: aplicarla una sola vez.
//
// La cámara del teléfono guarda la foto vertical como la ve el sensor
// (apaisada) y anota en EXIF cómo girarla (normalmente orientación 6, 90° a la
// derecha). Los navegadores actuales ya la aplican al decodificar:
// - CSS `image-orientation: from-image` es el valor por defecto en Chrome 81,
//   Firefox 26 y Safari 13.1 (MDN, image-orientation; datos de
//   mdn/browser-compat-data consultados el 21 nov 2026).
// - createImageBitmap() con `imageOrientation: 'from-image'` (el valor por
//   defecto) orienta según EXIF: Chrome 52, Firefox 93, Safari 15 (MDN,
//   Window.createImageBitmap; mismos datos).
// Si además se girara a mano, la foto quedaría girada dos veces. Por eso no se
// gira a mano salvo que una prueba, hecha una sola vez por sesión, demuestre
// que este navegador no la aplica: se decodifica un JPEG de 2 × 1 px con
// orientación 6 y, si sale de 1 × 2, el navegador ya gira.

/**
 * Segmento APP1 EXIF mínimo (TIFF big-endian, un IFD con la etiqueta
 * Orientation) insertado justo tras el SOI de un JPEG.
 */
export function withExifOrientation(
  jpeg: Uint8Array,
  orientation: ExifOrientation,
): Uint8Array<ArrayBuffer> {
  if (!isJpeg(jpeg)) throw new Error('withExifOrientation: no es un JPEG')
  // prettier-ignore
  const app1 = [
    0xff, 0xe1, 0x00, 0x22, // APP1, longitud 34
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // "MM", 42, IFD0 en 8
    0x00, 0x01, // una entrada
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, // Orientation, SHORT, 1
    0x00, orientation, 0x00, 0x00, // valor
    0x00, 0x00, 0x00, 0x00, // sin IFD siguiente
  ]
  const out = new Uint8Array(jpeg.length + app1.length)
  out.set(jpeg.subarray(0, 2), 0)
  out.set(app1, 2)
  out.set(jpeg.subarray(2), 2 + app1.length)
  return out
}

/**
 * Interpreta el resultado de la prueba: el JPEG de 2 × 1 con orientación 6
 * decodificado mide 1 × 2 si el navegador aplica la orientación.
 */
export function probeShowsOrientationApplied(decoded: {
  width: number
  height: number
}): boolean {
  return decoded.width === 1 && decoded.height === 2
}
