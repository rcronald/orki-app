import { describe, expect, it } from 'vitest'
import { fixture } from '../test/photo-fixtures.ts'
import { HEIC_UNSUPPORTED_TEXT, classifyDecodeFailure } from './errors.ts'
import {
  chooseOutputType,
  detectWebpEncoding,
  isRealWebp,
  matchesType,
} from './format.ts'
import {
  probeShowsOrientationApplied,
  withExifOrientation,
} from './orientation.ts'
import { sniffImage, type ExifOrientation } from './sniff.ts'

const blob = (bytes: Uint8Array<ArrayBuffer>, type: string) =>
  new Blob([bytes], { type })

describe('formato de salida', () => {
  it('detecta WebP solo si el Blob es WebP de verdad', async () => {
    const webp = blob(fixture('sin-metadatos.webp'), 'image/webp')
    // Safari: pide WebP y recibe PNG, sin error.
    const png = blob(fixture('sin-metadatos.png'), 'image/png')
    // Tipo correcto, bytes de otro formato.
    const fake = blob(fixture('sin-metadatos.png'), 'image/webp')

    expect(await detectWebpEncoding(() => Promise.resolve(webp))).toBe(true)
    expect(await detectWebpEncoding(() => Promise.resolve(png))).toBe(false)
    expect(await isRealWebp(fake)).toBe(false)
    expect(
      await detectWebpEncoding(() => Promise.reject(new Error('sin canvas'))),
    ).toBe(false)
  })

  it('elige WebP o JPEG y comprueba el tipo pedido', async () => {
    expect(chooseOutputType(true)).toBe('image/webp')
    expect(chooseOutputType(false)).toBe('image/jpeg')
    const jpeg = blob(fixture('sin-metadatos.jpg'), 'image/jpeg')
    expect(await matchesType(jpeg, 'image/jpeg')).toBe(true)
    expect(await matchesType(jpeg, 'image/webp')).toBe(false)
  })
})

describe('orientación', () => {
  it.each<ExifOrientation>([1, 2, 3, 4, 5, 6, 7, 8])(
    'withExifOrientation escribe la orientación %i',
    (orientation) => {
      const jpeg = withExifOrientation(
        fixture('sin-metadatos.jpg'),
        orientation,
      )
      expect(sniffImage(jpeg)).toEqual({
        format: 'jpeg',
        width: 48,
        height: 32,
        orientation,
      })
    },
  )

  it('interpreta la prueba de 2 × 1 con orientación 6', () => {
    expect(probeShowsOrientationApplied({ width: 1, height: 2 })).toBe(true)
    expect(probeShowsOrientationApplied({ width: 2, height: 1 })).toBe(false)
  })
})

describe('classifyDecodeFailure', () => {
  it('distingue formato no soportado de archivo dañado', () => {
    const heic = classifyDecodeFailure('heic', new Error('x'))
    expect(heic.reason).toBe('unsupported-format')
    expect(heic.message).toBe(HEIC_UNSUPPORTED_TEXT)
    expect(classifyDecodeFailure('unknown', null).reason).toBe(
      'unsupported-format',
    )
    const jpeg = classifyDecodeFailure('jpeg', new Error('x'))
    expect(jpeg.reason).toBe('decode-failed')
    expect(jpeg.message).toMatch(/dañado/)
  })
})
