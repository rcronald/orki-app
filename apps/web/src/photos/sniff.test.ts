import { describe, expect, it } from 'vitest'
import { fixture } from '../test/photo-fixtures.ts'
import { readTiffOrientation, sniffImage } from './sniff.ts'

const text = (value: string) => new TextEncoder().encode(value)

describe('sniffImage', () => {
  it('lee el tamaño y la orientación 6 de un JPEG de cámara', () => {
    expect(sniffImage(fixture('exif-gps-orientacion-6.jpg'))).toEqual({
      format: 'jpeg',
      width: 48,
      height: 32,
      orientation: 6,
    })
  })

  it('da orientación 1 a un JPEG sin EXIF', () => {
    expect(sniffImage(fixture('sin-metadatos.jpg'))).toEqual({
      format: 'jpeg',
      width: 48,
      height: 32,
      orientation: 1,
    })
  })

  it('lee el tamaño de WebP (VP8X y VP8) y PNG', () => {
    expect(sniffImage(fixture('exif-xmp.webp'))).toMatchObject({
      format: 'webp',
      width: 48,
      height: 32,
    })
    expect(sniffImage(fixture('sin-metadatos.webp'))).toMatchObject({
      format: 'webp',
      width: 48,
      height: 32,
    })
    expect(sniffImage(fixture('sin-metadatos.png'))).toMatchObject({
      format: 'png',
      width: 48,
      height: 32,
    })
  })

  it('reconoce HEIC por su caja ftyp, sin tamaño', () => {
    expect(sniffImage(fixture('foto.heic'))).toEqual({
      format: 'heic',
      orientation: 1,
    })
  })

  it('reconoce AVIF, GIF, BMP y TIFF', () => {
    const avif = new Uint8Array(24)
    avif.set([0, 0, 0, 24], 0)
    avif.set(text('ftypavif'), 4)
    expect(sniffImage(avif).format).toBe('avif')

    const gif = new Uint8Array(10)
    gif.set(text('GIF89a'), 0)
    gif.set([0x20, 0x03, 0x58, 0x02], 6)
    expect(sniffImage(gif)).toMatchObject({
      format: 'gif',
      width: 800,
      height: 600,
    })

    const bmp = new Uint8Array(26)
    bmp.set(text('BM'), 0)
    bmp.set([0x40, 0, 0, 0], 18)
    // Alto negativo (-32): filas de arriba abajo.
    bmp.set([0xe0, 0xff, 0xff, 0xff], 22)
    expect(sniffImage(bmp)).toMatchObject({
      format: 'bmp',
      width: 64,
      height: 32,
    })

    expect(sniffImage(text('II*\u0000resto')).format).toBe('tiff')
  })

  it('da unknown a lo que no es imagen y a un archivo vacío', () => {
    expect(sniffImage(text('hola, no soy una foto')).format).toBe('unknown')
    expect(sniffImage(new Uint8Array(0)).format).toBe('unknown')
  })

  it('no falla con un JPEG cortado antes del SOF', () => {
    const cut = fixture('exif-gps-orientacion-6.jpg').subarray(0, 40)
    expect(sniffImage(cut)).toEqual({ format: 'jpeg', orientation: 1 })
  })
})

describe('readTiffOrientation', () => {
  it('lee TIFF little-endian y descarta valores fuera de 1-8', () => {
    const tiff = (value: number) =>
      // prettier-ignore
      new Uint8Array([
        0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
        0x01, 0x00,
        0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, value, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
      ])
    expect(readTiffOrientation(tiff(8))).toBe(8)
    expect(readTiffOrientation(tiff(9))).toBe(1)
    expect(readTiffOrientation(tiff(0))).toBe(1)
    expect(readTiffOrientation(new Uint8Array([0x49, 0x49]))).toBe(1)
  })
})
