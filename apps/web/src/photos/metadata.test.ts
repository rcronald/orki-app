import { describe, expect, it } from 'vitest'
import { fixture } from '../test/photo-fixtures.ts'
import { webpChunks } from './containers.ts'
import { findMetadata, stripMetadata } from './metadata.ts'
import { sniffImage } from './sniff.ts'

const kinds = (bytes: Uint8Array) =>
  findMetadata(bytes).findings.map((finding) => finding.kind)

/** ¿Aparece el texto en los bytes? (para buscar el GPS y la cámara) */
const contains = (bytes: Uint8Array, value: string) =>
  new TextDecoder('latin1').decode(bytes).includes(value)

describe('findMetadata', () => {
  it('encuentra EXIF, XMP y el comentario de un JPEG de cámara', () => {
    const report = findMetadata(fixture('exif-gps-orientacion-6.jpg'))
    expect(report.format).toBe('jpeg')
    // El perfil ICC lo puso Chrome al codificar el JPEG base.
    expect(kinds(fixture('exif-gps-orientacion-6.jpg'))).toEqual([
      'exif',
      'xmp',
      'comment',
      'icc',
    ])
    expect(report.hasPrivateMetadata).toBe(true)
  })

  it('encuentra EXIF, XMP y el perfil ICC de un WebP', () => {
    const report = findMetadata(fixture('exif-xmp.webp'))
    expect(report.format).toBe('webp')
    expect(report.findings.map((finding) => finding.kind).sort()).toEqual([
      'exif',
      'icc',
      'xmp',
    ])
    expect(report.hasPrivateMetadata).toBe(true)
  })

  it('no da por privado el perfil ICC que añade el navegador', () => {
    expect(kinds(fixture('sin-metadatos.webp'))).toEqual(['icc'])
    expect(findMetadata(fixture('sin-metadatos.webp')).hasPrivateMetadata).toBe(
      false,
    )
    expect(findMetadata(fixture('sin-metadatos.jpg')).hasPrivateMetadata).toBe(
      false,
    )
  })

  it('clasifica IPTC, MPF y otros APPn de un JPEG', () => {
    const segment = (marker: number, payload: string) => {
      const data = new TextEncoder().encode(payload)
      return [0xff, marker, 0, data.length + 2, ...data]
    }
    const bytes = new Uint8Array([
      0xff,
      0xd8,
      ...segment(0xe2, 'MPF\u0000xx'),
      ...segment(0xed, 'Photoshop 3.0\u0000'),
      ...segment(0xe5, 'otro'),
      ...segment(0xee, 'Adobe'),
      0xff,
      0xda,
      0,
      2,
    ])
    expect(kinds(bytes)).toEqual(['mpf', 'iptc', 'app-other'])
  })

  it('no inspecciona otros formatos', () => {
    expect(findMetadata(fixture('sin-metadatos.png'))).toEqual({
      format: 'other',
      findings: [],
      hasPrivateMetadata: false,
    })
  })
})

describe('stripMetadata', () => {
  it('quita EXIF, GPS, XMP y comentario de un JPEG y deja la imagen', () => {
    const original = fixture('exif-gps-orientacion-6.jpg')
    expect(contains(original, 'Prueba')).toBe(true)
    expect(contains(original, 'GPSLatitude')).toBe(true)

    const stripped = stripMetadata(original)
    expect(findMetadata(stripped).hasPrivateMetadata).toBe(false)
    expect(contains(stripped, 'Prueba')).toBe(false)
    expect(contains(stripped, 'GPSLatitude')).toBe(false)
    // Es el JPEG sin metadatos byte a byte.
    expect(stripped).toEqual(fixture('sin-metadatos.jpg'))
    expect(sniffImage(stripped)).toEqual({
      format: 'jpeg',
      width: 48,
      height: 32,
      orientation: 1,
    })
  })

  it('quita EXIF y XMP de un WebP y corrige RIFF y VP8X', () => {
    const stripped = stripMetadata(fixture('exif-xmp.webp'))
    expect(kinds(stripped)).toEqual(['icc'])
    expect(contains(stripped, 'GPSLatitude')).toBe(false)
    const riffSize = new DataView(stripped.buffer).getUint32(4, true)
    expect(riffSize).toBe(stripped.length - 8)
    const vp8x = webpChunks(stripped).find((c) => c.fourcc === 'VP8X')
    // ICC (0x20) se conserva; EXIF (0x08) y XMP (0x04) se apagan.
    expect((stripped[vp8x?.dataOffset ?? 0] ?? 0) & 0x2c).toBe(0x20)
    expect(webpChunks(stripped).map((c) => c.fourcc)).toEqual([
      'VP8X',
      'ICCP',
      'VP8 ',
    ])
  })

  it('devuelve los mismos bytes si no hay nada que quitar', () => {
    const clean = fixture('sin-metadatos.webp')
    expect(stripMetadata(clean)).toBe(clean)
  })
})
