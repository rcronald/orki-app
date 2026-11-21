import { isJpeg, isWebp } from './containers.ts'

// Formato de salida: WebP donde el navegador lo codifique de verdad, si no
// JPEG.
//
// Lo que se comprobó (21 nov 2026):
// - HTMLCanvasElement.toBlob() y OffscreenCanvas.convertToBlob() usan
//   image/png si el tipo pedido no está soportado, sin error (MDN, toBlob:
//   "if the given format is not supported, then the data will be exported as
//   image/png").
// - Codificar WebP: Chrome 50 (toBlob) y 69 (convertToBlob), Firefox 96 y 105;
//   Safari no lo soporta en ninguna versión, ni en macOS ni en iOS (y en iOS
//   todos los navegadores usan WebKit): mdn/browser-compat-data,
//   api.HTMLCanvasElement.toBlob.type_parameter_webp y
//   api.OffscreenCanvas.convertToBlob.option_type_parameter_webp, ambos
//   "version_added: false" para Safari. Informes recientes lo confirman en
//   WebKit 26.x: Safari devuelve un PNG aunque se pida WebP.
// - Safari sí decodifica WebP desde la versión 14 (caniuse "webp"), así que
//   un WebP generado en Chrome se ve en el iPhone.
// Por eso no se mira el user agent: se codifica una vez un lienzo de 2 × 2 px
// como WebP y se comprueba el tipo del Blob y su firma RIFF/WEBP. En Safari
// sale PNG y se usa JPEG (que todos codifican: Safari 11, Chrome 50, Firefox
// 18). Un PNG nunca sirve: una foto en PNG pesa varios megabytes.

export type OutputType = 'image/webp' | 'image/jpeg'

/** ¿Es el Blob de verdad un WebP (tipo y firma)? */
export async function isRealWebp(blob: Blob): Promise<boolean> {
  if (blob.type !== 'image/webp') return false
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer())
  return isWebp(head)
}

/** ¿Coincide el Blob con el tipo pedido (tipo y firma)? */
export async function matchesType(
  blob: Blob,
  type: OutputType,
): Promise<boolean> {
  if (blob.type !== type) return false
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer())
  return type === 'image/webp' ? isWebp(head) : isJpeg(head)
}

/**
 * Prueba de WebP: `encodeProbe` codifica un lienzo diminuto pidiendo
 * image/webp. Cualquier fallo cuenta como "no".
 */
export async function detectWebpEncoding(
  encodeProbe: () => Promise<Blob>,
): Promise<boolean> {
  try {
    return await isRealWebp(await encodeProbe())
  } catch {
    return false
  }
}

export function chooseOutputType(webpSupported: boolean): OutputType {
  return webpSupported ? 'image/webp' : 'image/jpeg'
}
