import { startsWithAscii } from './bytes.ts'
import { isJpeg, isWebp, jpegSegments, webpChunks } from './containers.ts'

// Inspección y retirada de metadatos en JPEG y WebP, sobre los bytes.
//
// Al recodificar con canvas el navegador escribe un archivo nuevo a partir de
// los píxeles, sin los metadatos del original (EXIF con la cámara, la fecha y
// el GPS, la miniatura embebida, XMP, IPTC). Aun así no se da por supuesto:
// process.ts inspecciona cada resultado con findMetadata() y, si el
// codificador hubiera añadido algo, lo retira con stripMetadata() y vuelve a
// comprobarlo antes de devolverlo.

export type MetadataKind =
  /** APP1 "Exif" o fragmento EXIF de WebP: cámara, fecha, GPS, miniatura. */
  | 'exif'
  /** APP1 XMP (incluido el extendido) o fragmento "XMP " de WebP. */
  | 'xmp'
  /** APP13 de Photoshop con IPTC: autor, lugar, palabras clave. */
  | 'iptc'
  /** APP2 MPF: imágenes adicionales (vista previa, profundidad) del iPhone. */
  | 'mpf'
  /** Segmento COM: texto libre. */
  | 'comment'
  /** Cualquier otro APPn (APP3-APP15) salvo APP14 de Adobe. */
  | 'app-other'
  /** Perfil de color ICC: no identifica a nadie ni al lugar; se conserva. */
  | 'icc'

export interface MetadataFinding {
  kind: MetadataKind
  /** Posición y tamaño en bytes del segmento o fragmento completo. */
  offset: number
  length: number
}

export interface MetadataReport {
  format: 'jpeg' | 'webp' | 'other'
  findings: MetadataFinding[]
  /** ¿Hay algo distinto del perfil de color? */
  hasPrivateMetadata: boolean
}

const XMP_SIGNATURE = 'http://ns.adobe.com/xap/1.0/\u0000'
const XMP_EXTENDED_SIGNATURE = 'http://ns.adobe.com/xmp/extension/\u0000'

function jpegSegmentKind(
  bytes: Uint8Array,
  marker: number,
  dataOffset: number,
): MetadataKind | undefined {
  if (marker === 0xfe) return 'comment'
  if (marker === 0xe1) {
    if (startsWithAscii(bytes, dataOffset, 'Exif\u0000')) return 'exif'
    if (
      startsWithAscii(bytes, dataOffset, XMP_SIGNATURE) ||
      startsWithAscii(bytes, dataOffset, XMP_EXTENDED_SIGNATURE)
    ) {
      return 'xmp'
    }
    return 'app-other'
  }
  if (marker === 0xe2) {
    if (startsWithAscii(bytes, dataOffset, 'ICC_PROFILE\u0000')) return 'icc'
    if (startsWithAscii(bytes, dataOffset, 'MPF\u0000')) return 'mpf'
    return 'app-other'
  }
  if (marker === 0xed) return 'iptc'
  // APP0 (JFIF) describe la imagen; APP14 (Adobe) indica la transformación de
  // color y hace falta para leerla bien. El resto de APPn sobra.
  if (marker >= 0xe3 && marker <= 0xef && marker !== 0xee) return 'app-other'
  return undefined
}

function webpChunkKind(fourcc: string): MetadataKind | undefined {
  if (fourcc === 'EXIF') return 'exif'
  if (fourcc === 'XMP ') return 'xmp'
  if (fourcc === 'ICCP') return 'icc'
  return undefined
}

/** Metadatos de un JPEG o un WebP. Otros formatos dan una lista vacía. */
export function findMetadata(bytes: Uint8Array): MetadataReport {
  const findings: MetadataFinding[] = []
  let format: MetadataReport['format'] = 'other'
  if (isJpeg(bytes)) {
    format = 'jpeg'
    for (const segment of jpegSegments(bytes)) {
      const kind = jpegSegmentKind(bytes, segment.marker, segment.dataOffset)
      if (kind) {
        findings.push({ kind, offset: segment.offset, length: segment.length })
      }
    }
  } else if (isWebp(bytes)) {
    format = 'webp'
    for (const chunk of webpChunks(bytes)) {
      const kind = webpChunkKind(chunk.fourcc)
      if (kind) {
        findings.push({ kind, offset: chunk.offset, length: chunk.length })
      }
    }
  }
  return {
    format,
    findings,
    hasPrivateMetadata: findings.some((finding) => finding.kind !== 'icc'),
  }
}

// Bits de la cabecera VP8X que anuncian los fragmentos EXIF y XMP.
const VP8X_EXIF_FLAG = 0x08
const VP8X_XMP_FLAG = 0x04

/**
 * Copia de los bytes sin los metadatos privados (todo salvo el perfil ICC).
 * En WebP también corrige el tamaño RIFF y los indicadores de VP8X. Si no hay
 * nada que quitar, devuelve los mismos bytes.
 */
export function stripMetadata(bytes: Uint8Array): Uint8Array {
  const report = findMetadata(bytes)
  const remove = report.findings.filter((finding) => finding.kind !== 'icc')
  if (remove.length === 0) return bytes

  const parts: Uint8Array[] = []
  let cursor = 0
  for (const finding of remove) {
    parts.push(bytes.subarray(cursor, finding.offset))
    cursor = finding.offset + finding.length
  }
  parts.push(bytes.subarray(Math.min(cursor, bytes.length)))
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }

  if (report.format === 'webp') {
    const riffSize = out.length - 8
    out[4] = riffSize & 0xff
    out[5] = (riffSize >>> 8) & 0xff
    out[6] = (riffSize >>> 16) & 0xff
    out[7] = (riffSize >>> 24) & 0xff
    const vp8x = webpChunks(out).find((chunk) => chunk.fourcc === 'VP8X')
    if (vp8x) {
      const flags = out[vp8x.dataOffset] ?? 0
      out[vp8x.dataOffset] = flags & ~(VP8X_EXIF_FLAG | VP8X_XMP_FLAG)
    }
  }
  return out
}
