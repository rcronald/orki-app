import {
  ascii,
  startsWithAscii,
  u16be,
  u16le,
  u24le,
  u32be,
  u32le,
} from './bytes.ts'
import { isJpeg, isWebp, jpegSegments, webpChunks } from './containers.ts'

// Identificación de una imagen por sus primeros bytes, antes de decodificarla:
// formato real (sin fiarse de la extensión ni del tipo MIME que da el
// navegador), dimensiones si la cabecera las trae y orientación EXIF del JPEG.
// Sirve para rechazar una imagen enorme sin llegar a decodificarla, para dar
// un error claro con HEIC y para saber cómo girar la foto si el navegador no
// lo hace (ver orientation.ts).

export type SourceFormat =
  'jpeg' | 'png' | 'webp' | 'gif' | 'bmp' | 'avif' | 'heic' | 'tiff' | 'unknown'

/** Orientación EXIF (1 a 8); 1 es "tal cual". */
export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export interface SniffedImage {
  format: SourceFormat
  /** Ancho y alto guardados (sin aplicar la orientación), si se encontraron. */
  width?: number
  height?: number
  /** Orientación EXIF; 1 si no hay o el formato no la lleva. */
  orientation: ExifOrientation
}

/**
 * Cuántos bytes del principio del archivo se leen para identificarlo. En un
 * JPEG de cámara el SOF va tras los APPn, que miden como mucho 64 KB cada uno
 * (EXIF con su miniatura, ICC, XMP, MPF): 512 KB los cubre de sobra.
 */
export const SNIFF_BYTES = 512 * 1024

// Marcas de "ftyp" de HEIF (HEVC) y de AVIF (ISO/IEC 23008-12 y AV1 Image
// File Format). mif1/msf1 son genéricas: se mira la lista de compatibles.
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'])
const AVIF_BRANDS = new Set(['avif', 'avis'])
const GENERIC_HEIF_BRANDS = new Set(['mif1', 'msf1'])

export function sniffImage(bytes: Uint8Array): SniffedImage {
  if (isJpeg(bytes)) return sniffJpeg(bytes)
  if (
    bytes.length >= 24 &&
    u32be(bytes, 0) === 0x89504e47 &&
    u32be(bytes, 4) === 0x0d0a1a0a &&
    startsWithAscii(bytes, 12, 'IHDR')
  ) {
    return {
      format: 'png',
      width: u32be(bytes, 16),
      height: u32be(bytes, 20),
      orientation: 1,
    }
  }
  if (isWebp(bytes)) return sniffWebp(bytes)
  if (
    startsWithAscii(bytes, 0, 'GIF87a') ||
    startsWithAscii(bytes, 0, 'GIF89a')
  ) {
    return {
      format: 'gif',
      width: u16le(bytes, 6),
      height: u16le(bytes, 8),
      orientation: 1,
    }
  }
  if (startsWithAscii(bytes, 0, 'BM') && bytes.length >= 26) {
    const height = u32le(bytes, 22)
    return {
      format: 'bmp',
      width: u32le(bytes, 18),
      // Alto negativo (de arriba abajo) en complemento a dos.
      height: height > 0x7fffffff ? 0x100000000 - height : height,
      orientation: 1,
    }
  }
  if (
    startsWithAscii(bytes, 0, 'II*\u0000') ||
    startsWithAscii(bytes, 0, 'MM\u0000*')
  ) {
    return { format: 'tiff', orientation: 1 }
  }
  if (startsWithAscii(bytes, 4, 'ftyp')) {
    const format = isoBmffFormat(bytes)
    if (format) return { format, orientation: 1 }
  }
  return { format: 'unknown', orientation: 1 }
}

function isoBmffFormat(bytes: Uint8Array): SourceFormat | undefined {
  const boxSize = u32be(bytes, 0)
  const end = Math.min(bytes.length, boxSize >= 16 ? boxSize : 16)
  const brands = [ascii(bytes, 8, 4)]
  // Tras la marca principal (8) y la versión (12), las compatibles.
  for (let i = 16; i + 4 <= end; i += 4) brands.push(ascii(bytes, i, 4))
  if (brands.some((brand) => AVIF_BRANDS.has(brand))) return 'avif'
  if (brands.some((brand) => HEIC_BRANDS.has(brand))) return 'heic'
  if (brands.some((brand) => GENERIC_HEIF_BRANDS.has(brand))) return 'heic'
  return undefined
}

// SOF0-SOF15 salvo DHT (C4), JPG (C8) y DAC (CC).
function isStartOfFrame(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  )
}

function sniffJpeg(bytes: Uint8Array): SniffedImage {
  const result: SniffedImage = { format: 'jpeg', orientation: 1 }
  let orientationFound = false
  for (const segment of jpegSegments(bytes)) {
    if (
      !orientationFound &&
      segment.marker === 0xe1 &&
      startsWithAscii(bytes, segment.dataOffset, 'Exif\u0000\u0000')
    ) {
      const tiffStart = segment.dataOffset + 6
      const tiffEnd = Math.min(
        bytes.length,
        segment.dataOffset + segment.dataLength,
      )
      result.orientation = readTiffOrientation(
        bytes.subarray(tiffStart, tiffEnd),
      )
      orientationFound = true
    }
    if (isStartOfFrame(segment.marker) && segment.dataLength >= 5) {
      result.height = u16be(bytes, segment.dataOffset + 1)
      result.width = u16be(bytes, segment.dataOffset + 3)
      break
    }
  }
  return result
}

/**
 * Orientación (etiqueta 0x0112) del IFD0 de un bloque TIFF/EXIF. Devuelve 1 si
 * falta o tiene un valor fuera de 1-8.
 */
export function readTiffOrientation(tiff: Uint8Array): ExifOrientation {
  const order = ascii(tiff, 0, 2)
  if (order !== 'II' && order !== 'MM') return 1
  const little = order === 'II'
  const u16 = (offset: number) =>
    little ? u16le(tiff, offset) : u16be(tiff, offset)
  const u32 = (offset: number) =>
    little ? u32le(tiff, offset) : u32be(tiff, offset)
  if (u16(2) !== 42) return 1
  const ifd = u32(4)
  if (ifd + 2 > tiff.length) return 1
  const entries = u16(ifd)
  for (let n = 0; n < entries; n++) {
    const entry = ifd + 2 + n * 12
    if (entry + 12 > tiff.length) return 1
    if (u16(entry) === 0x0112) {
      // Tipo SHORT (3), un valor, guardado en los dos primeros bytes.
      const value = u16(entry + 8)
      return value >= 1 && value <= 8 ? (value as ExifOrientation) : 1
    }
  }
  return 1
}

function sniffWebp(bytes: Uint8Array): SniffedImage {
  const result: SniffedImage = { format: 'webp', orientation: 1 }
  const first = webpChunks(bytes)[0]
  if (!first) return result
  const d = first.dataOffset
  if (first.fourcc === 'VP8X' && first.dataLength >= 10) {
    result.width = u24le(bytes, d + 4) + 1
    result.height = u24le(bytes, d + 7) + 1
  } else if (first.fourcc === 'VP8 ' && first.dataLength >= 10) {
    // Cabecera de fotograma clave: 3 bytes, código 9d 01 2a y 14 bits por lado.
    result.width = u16le(bytes, d + 6) & 0x3fff
    result.height = u16le(bytes, d + 8) & 0x3fff
  } else if (first.fourcc === 'VP8L' && first.dataLength >= 5) {
    // Firma 0x2f y luego ancho-1 y alto-1 en 14 bits cada uno.
    const bits = u32le(bytes, d + 1)
    result.width = (bits & 0x3fff) + 1
    result.height = ((bits >>> 14) & 0x3fff) + 1
  }
  return result
}
