import { ascii, startsWithAscii, u16be, u32le } from './bytes.ts'

// Recorrido de los contenedores JPEG y WebP (RIFF), sin decodificar la imagen.

/** Segmento de cabecera de un JPEG (de SOI a SOS). */
export interface JpegSegment {
  /** Byte del marcador: 0xE1 para APP1, 0xFE para COM, 0xC0 para SOF0... */
  marker: number
  /** Posición del 0xFF del marcador. */
  offset: number
  /** Bytes totales del segmento, marcador incluido. */
  length: number
  /** Posición del primer byte de datos (tras el marcador y la longitud). */
  dataOffset: number
  /** Bytes de datos. */
  dataLength: number
}

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

/**
 * Segmentos de un JPEG desde el SOI hasta el SOS (incluido), que es donde
 * están los metadatos y el tamaño. Se detiene sin error si los bytes se
 * acaban (archivo cortado o solo su principio).
 */
export function jpegSegments(bytes: Uint8Array): JpegSegment[] {
  const segments: JpegSegment[] = []
  if (!isJpeg(bytes)) return segments
  let i = 2
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) break
    // Bytes de relleno 0xFF antes del marcador.
    let markerAt = i
    while (bytes[markerAt + 1] === 0xff) markerAt++
    const marker = bytes[markerAt + 1]
    if (marker === undefined) break
    // Marcadores sin longitud: TEM y RST0-7. EOI termina.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i = markerAt + 2
      continue
    }
    if (marker === 0xd9) break
    if (markerAt + 3 >= bytes.length) break
    const declared = u16be(bytes, markerAt + 2)
    if (declared < 2) break
    const segment: JpegSegment = {
      marker,
      offset: i,
      length: markerAt + 2 + declared - i,
      dataOffset: markerAt + 4,
      dataLength: declared - 2,
    }
    segments.push(segment)
    // Tras SOS vienen los datos comprimidos: ya no hay más cabeceras.
    if (marker === 0xda) break
    i = markerAt + 2 + declared
  }
  return segments
}

/** Fragmento (chunk) de un archivo RIFF como WebP. */
export interface RiffChunk {
  /** FourCC: "VP8 ", "VP8L", "VP8X", "EXIF", "XMP ", "ICCP", "ALPH"... */
  fourcc: string
  /** Posición de la FourCC. */
  offset: number
  /** Bytes totales del fragmento: cabecera, datos y relleno. */
  length: number
  dataOffset: number
  dataLength: number
}

export function isWebp(bytes: Uint8Array): boolean {
  return startsWithAscii(bytes, 0, 'RIFF') && startsWithAscii(bytes, 8, 'WEBP')
}

/** Fragmentos de un WebP. Se detiene si los bytes se acaban. */
export function webpChunks(bytes: Uint8Array): RiffChunk[] {
  const chunks: RiffChunk[] = []
  if (!isWebp(bytes)) return chunks
  let i = 12
  while (i + 8 <= bytes.length) {
    const fourcc = ascii(bytes, i, 4)
    const dataLength = u32le(bytes, i + 4)
    // Cada fragmento ocupa un número par de bytes (relleno de 1 si es impar).
    const length = 8 + dataLength + (dataLength % 2)
    chunks.push({ fourcc, offset: i, length, dataOffset: i + 8, dataLength })
    i += length
  }
  return chunks
}
