import { describe, expect, it } from 'vitest'
import { fixture } from '../test/photo-fixtures.ts'
import type {
  DecodedImage,
  DrawOptions,
  ImageBackend,
  Surface,
} from './backend.ts'
import { PhotoProcessingError } from './errors.ts'
import type { OutputType } from './format.ts'
import type { Size } from './geometry.ts'
import { findMetadata } from './metadata.ts'
import {
  DEFAULT_PHOTO_LIMITS,
  processPhoto,
  type ProcessedPhoto,
} from './process.ts'

// Orquestación con un doble de la capa del navegador: jsdom no tiene canvas
// ni createImageBitmap. El doble "codifica" Blobs con la firma del formato y
// un peso que crece con el área y la calidad, como un códec real. La prueba
// en un navegador real está en la página de muestra (sección "Fotos").

interface FakeOptions {
  /** Tamaño que devuelve decode() (ya orientado si el navegador orienta). */
  decoded?: Size
  appliesOrientation?: boolean
  webp?: boolean
  /** Peso por píxel a calidad 1, en bits. */
  bitsPerPixel?: number
  decode?: (blob: Blob) => Promise<void>
  /** Tipo real del Blob codificado (por ejemplo, PNG en vez de WebP). */
  actualType?: (requested: OutputType) => string
  /** El codificador añade un EXIF (para probar que se retira). */
  addExif?: boolean
}

interface DrawCall {
  from: string
  size: Size
  options: DrawOptions | undefined
}

const EXIF_SEGMENT = (() => {
  // El APP1 EXIF del accesorio de cámara (con GPS).
  const bytes = fixture('exif-gps-orientacion-6.jpg')
  const start = bytes.indexOf(0xe1) - 1
  const length = ((bytes[start + 2] ?? 0) << 8) | (bytes[start + 3] ?? 0)
  return bytes.slice(start, start + 2 + length)
})()

function encodedBytes(type: string, size: number, addExif: boolean) {
  const out = new Uint8Array(Math.max(size, 64))
  const text = (value: string, at: number) =>
    out.set(new TextEncoder().encode(value), at)
  if (type === 'image/webp') {
    text('RIFF', 0)
    new DataView(out.buffer).setUint32(4, out.length - 8, true)
    text('WEBPVP8 ', 8)
    new DataView(out.buffer).setUint32(16, out.length - 20, true)
  } else if (type === 'image/jpeg') {
    out.set([0xff, 0xd8], 0)
    let at = 2
    if (addExif) {
      out.set(EXIF_SEGMENT, at)
      at += EXIF_SEGMENT.length
    }
    out.set([0xff, 0xda, 0x00, 0x02], at)
  } else {
    out.set([0x89, 0x50, 0x4e, 0x47], 0)
  }
  return out
}

function fakeBackend(options: FakeOptions = {}) {
  const decodedSize = options.decoded ?? { width: 4032, height: 3024 }
  const bitsPerPixel = options.bitsPerPixel ?? 1
  const draws: DrawCall[] = []
  const encodes: { type: OutputType; quality: number; size: Size }[] = []
  const surfaces: { id: string; released: boolean }[] = []
  const state = { decodedClosed: false, decodeCalls: 0 }
  let next = 0

  const backend: ImageBackend = {
    async decode(blob): Promise<DecodedImage> {
      state.decodeCalls++
      await options.decode?.(blob)
      return {
        ...decodedSize,
        source: { id: 'decoded' } as unknown as CanvasImageSource,
        close: () => {
          state.decodedClosed = true
        },
      }
    },
    draw(source, size, drawOptions): Surface {
      const id = `surface-${next++}`
      draws.push({
        from: (source as unknown as { id: string }).id,
        size,
        options: drawOptions,
      })
      const record = { id, released: false }
      surfaces.push(record)
      return {
        ...size,
        source: { id } as unknown as CanvasImageSource,
        encode: (type, quality) => {
          encodes.push({ type, quality, size })
          const actual = options.actualType?.(type) ?? type
          const bytes = Math.round(
            (size.width * size.height * bitsPerPixel * quality ** 2) / 8,
          )
          return Promise.resolve(
            new Blob([encodedBytes(actual, bytes, options.addExif ?? false)], {
              type: actual,
            }),
          )
        },
        release: () => {
          record.released = true
        },
      }
    },
    appliesExifOrientation: () =>
      Promise.resolve(options.appliesOrientation ?? true),
    encodesWebp: () => Promise.resolve(options.webp ?? true),
    yieldToMain: () => Promise.resolve(),
  }
  return { backend, draws, encodes, surfaces, state }
}

const cameraJpeg = () =>
  new Blob([fixture('exif-gps-orientacion-6.jpg')], { type: 'image/jpeg' })

async function bytesOf(blob: Blob) {
  return new Uint8Array(await blob.arrayBuffer())
}

async function expectClean(result: ProcessedPhoto) {
  for (const image of [result.photo, result.thumbnail]) {
    const report = findMetadata(await bytesOf(image.blob))
    expect(report.hasPrivateMetadata).toBe(false)
  }
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    if (error instanceof PhotoProcessingError) return error
    throw error
  }
  throw new Error('Se esperaba un error')
}

describe('processPhoto', () => {
  it('reduce una foto de 12 MP vertical a 1600 px y su miniatura a 400 px', async () => {
    // El navegador orienta: decode() ya da la foto en vertical.
    const fake = fakeBackend({ decoded: { width: 3024, height: 4032 } })
    const result = await processPhoto(cameraJpeg(), { backend: fake.backend })

    expect(result.photo).toMatchObject({
      type: 'image/webp',
      width: 1200,
      height: 1600,
      withinBudget: true,
    })
    expect(result.photo.bytes).toBeLessThan(300_000)
    expect(result.photo.blob.type).toBe('image/webp')
    expect(result.thumbnail).toMatchObject({
      type: 'image/webp',
      width: 300,
      height: 400,
      withinBudget: true,
    })
    expect(result.thumbnail.bytes).toBeLessThan(30_000)
    expect(result.source).toMatchObject({
      format: 'jpeg',
      width: 3024,
      height: 4032,
      orientation: 6,
    })
    expect(result.orientationAppliedBy).toBe('browser')
    // Ningún dibujo gira a mano: la orientación se aplica una sola vez.
    expect(fake.draws.every((d) => d.options?.transform === undefined)).toBe(
      true,
    )
    // De 4032 a 1600 por mitades: 2016 y luego 1600.
    expect(fake.draws.slice(0, 2).map((d) => d.size)).toEqual([
      { width: 1512, height: 2016 },
      { width: 1200, height: 1600 },
    ])
    // La miniatura sale de la foto reducida, no del original.
    expect(fake.draws.at(-1)?.from).not.toBe('decoded')
    await expectClean(result)
  })

  it('gira a mano solo si el navegador no aplica la orientación', async () => {
    const fake = fakeBackend({
      decoded: { width: 4032, height: 3024 },
      appliesOrientation: false,
    })
    const result = await processPhoto(cameraJpeg(), { backend: fake.backend })

    expect(result.orientationAppliedBy).toBe('module')
    expect(result.source).toMatchObject({ width: 3024, height: 4032 })
    expect({ w: result.photo.width, h: result.photo.height }).toEqual({
      w: 1200,
      h: 1600,
    })
    const [first, ...rest] = fake.draws
    expect(first?.from).toBe('decoded')
    expect(first?.size).toEqual({ width: 1512, height: 2016 })
    // Orientación 6 dibujando la imagen guardada (apaisada) en 2016 × 1512.
    expect(first?.options?.transform).toEqual({
      matrix: [0, 1, -1, 0, 1512, 0],
      drawn: { width: 2016, height: 1512 },
    })
    expect(rest.every((d) => d.options?.transform === undefined)).toBe(true)
  })

  it('no gira una foto sin orientación aunque el navegador no oriente', async () => {
    const fake = fakeBackend({
      decoded: { width: 48, height: 32 },
      appliesOrientation: false,
    })
    const result = await processPhoto(
      new Blob([fixture('sin-metadatos.jpg')], { type: 'image/jpeg' }),
      { backend: fake.backend },
    )
    expect(result.orientationAppliedBy).toBe('none')
    expect(fake.draws.every((d) => d.options?.transform === undefined)).toBe(
      true,
    )
  })

  it('recodifica siempre, aunque la foto ya sea pequeña', async () => {
    const input = cameraJpeg()
    const fake = fakeBackend({ decoded: { width: 32, height: 48 } })
    const result = await processPhoto(input, { backend: fake.backend })

    expect(fake.draws[0]).toMatchObject({
      from: 'decoded',
      size: { width: 32, height: 48 },
    })
    expect(result.photo.blob).not.toBe(input)
    expect(result.photo.blob.type).toBe('image/webp')
    // El original lleva EXIF con GPS; el resultado no.
    expect(findMetadata(await bytesOf(input)).hasPrivateMetadata).toBe(true)
    await expectClean(result)
  })

  it('usa JPEG si el navegador no codifica WebP (Safari)', async () => {
    const fake = fakeBackend({ webp: false })
    const result = await processPhoto(cameraJpeg(), { backend: fake.backend })
    expect(result.photo.type).toBe('image/jpeg')
    expect(result.photo.blob.type).toBe('image/jpeg')
    expect(result.thumbnail.type).toBe('image/jpeg')
    expect(fake.encodes.every((e) => e.type === 'image/jpeg')).toBe(true)
  })

  it('pasa a JPEG si pide WebP y recibe PNG', async () => {
    const fake = fakeBackend({
      actualType: (type) => (type === 'image/webp' ? 'image/png' : type),
    })
    const result = await processPhoto(cameraJpeg(), { backend: fake.backend })
    expect(result.photo.type).toBe('image/jpeg')
    expect(result.thumbnail.type).toBe('image/jpeg')
  })

  it('retira los metadatos si el codificador los añadiera', async () => {
    const fake = fakeBackend({ webp: false, addExif: true })
    const result = await processPhoto(cameraJpeg(), { backend: fake.backend })
    expect(fake.encodes.length).toBeGreaterThan(0)
    await expectClean(result)
    expect(result.photo.blob.type).toBe('image/jpeg')
  })

  it('baja la calidad hasta cumplir los topes', async () => {
    const fake = fakeBackend({ bitsPerPixel: 2 })
    const result = await processPhoto(cameraJpeg(), { backend: fake.backend })
    expect(result.photo.withinBudget).toBe(true)
    expect(result.photo.bytes).toBeLessThan(300_000)
    expect(result.photo.quality).toBeLessThan(0.8)
    expect(result.photo.attempts.length).toBeGreaterThan(1)
  })

  it('marca el resultado si no llega al tope tras los intentos', async () => {
    const fake = fakeBackend({ bitsPerPixel: 400 })
    const result = await processPhoto(cameraJpeg(), { backend: fake.backend })
    expect(result.photo.withinBudget).toBe(false)
    expect(result.photo.attempts.length).toBeLessThanOrEqual(
      DEFAULT_PHOTO_LIMITS.photo.maxAttempts,
    )
  })

  it('libera la imagen decodificada y todos los lienzos', async () => {
    const fake = fakeBackend({ bitsPerPixel: 2 })
    await processPhoto(cameraJpeg(), { backend: fake.backend })
    expect(fake.state.decodedClosed).toBe(true)
    expect(fake.surfaces.every((s) => s.released)).toBe(true)
  })
})

describe('processPhoto: errores', () => {
  it('rechaza un archivo vacío', async () => {
    const fake = fakeBackend()
    const error = await rejection(
      processPhoto(new Blob([], { type: 'image/jpeg' }), {
        backend: fake.backend,
      }),
    )
    expect(error.reason).toBe('empty')
    expect(fake.state.decodeCalls).toBe(0)
  })

  it('rechaza lo que no es imagen sin decodificarlo', async () => {
    const fake = fakeBackend()
    const error = await rejection(
      processPhoto(new Blob(['hola'], { type: 'text/plain' }), {
        backend: fake.backend,
      }),
    )
    expect(error.reason).toBe('not-an-image')
    expect(error.message).toMatch(/no es una imagen/)
    expect(fake.state.decodeCalls).toBe(0)
  })

  it('rechaza un archivo que pesa demasiado', async () => {
    const fake = fakeBackend()
    const error = await rejection(
      processPhoto(cameraJpeg(), {
        backend: fake.backend,
        limits: { ...DEFAULT_PHOTO_LIMITS, maxInputBytes: 1000 },
      }),
    )
    expect(error.reason).toBe('too-large')
  })

  it('rechaza por la cabecera una imagen con demasiados píxeles, sin decodificarla', async () => {
    const fake = fakeBackend()
    const error = await rejection(
      processPhoto(cameraJpeg(), {
        backend: fake.backend,
        limits: { ...DEFAULT_PHOTO_LIMITS, maxInputPixels: 48 * 32 - 1 },
      }),
    )
    expect(error.reason).toBe('too-large')
    expect(fake.state.decodeCalls).toBe(0)
  })

  it('rechaza tras decodificar si la cabecera no traía el tamaño', async () => {
    const fake = fakeBackend({ decoded: { width: 10000, height: 6000 } })
    const error = await rejection(
      processPhoto(new Blob([fixture('foto.heic')], { type: 'image/heic' }), {
        backend: fake.backend,
      }),
    )
    expect(error.reason).toBe('too-large')
    expect(fake.state.decodedClosed).toBe(true)
  })

  it('explica que el navegador no abre HEIC', async () => {
    const fake = fakeBackend({
      decode: () => Promise.reject(new DOMException('', 'InvalidStateError')),
    })
    const error = await rejection(
      processPhoto(new Blob([fixture('foto.heic')], { type: 'image/heic' }), {
        backend: fake.backend,
      }),
    )
    expect(error.reason).toBe('unsupported-format')
    expect(error.format).toBe('heic')
    expect(error.message).toMatch(/HEIC/)
  })

  it('da decode-failed con un JPEG dañado', async () => {
    const fake = fakeBackend({
      decode: () => Promise.reject(new DOMException('', 'InvalidStateError')),
    })
    const broken = fixture('sin-metadatos.jpg').slice(0, 200)
    const error = await rejection(
      processPhoto(new Blob([broken], { type: 'image/jpeg' }), {
        backend: fake.backend,
      }),
    )
    expect(error.reason).toBe('decode-failed')
  })

  it('no empieza si ya se canceló', async () => {
    const fake = fakeBackend()
    const controller = new AbortController()
    controller.abort()
    const error = await rejection(
      processPhoto(cameraJpeg(), {
        backend: fake.backend,
        signal: controller.signal,
      }),
    )
    expect(error.reason).toBe('aborted')
    expect(fake.state.decodeCalls).toBe(0)
  })

  it('se cancela mientras decodifica', async () => {
    const controller = new AbortController()
    const fake = fakeBackend({
      decode: () => {
        controller.abort()
        return new Promise(() => {})
      },
    })
    const error = await rejection(
      processPhoto(cameraJpeg(), {
        backend: fake.backend,
        signal: controller.signal,
      }),
    )
    expect(error.reason).toBe('aborted')
  })

  it('se cancela a mitad de la compresión y libera los lienzos', async () => {
    const controller = new AbortController()
    const fake = fakeBackend({ bitsPerPixel: 2 })
    const encode = fake.backend.draw
    fake.backend.draw = (source, size, options) => {
      const surface = encode(source, size, options)
      return {
        ...surface,
        encode: (type, quality) => {
          controller.abort()
          return surface.encode(type, quality)
        },
      }
    }
    const error = await rejection(
      processPhoto(cameraJpeg(), {
        backend: fake.backend,
        signal: controller.signal,
      }),
    )
    expect(error.reason).toBe('aborted')
    expect(fake.encodes).toHaveLength(1)
    expect(fake.state.decodedClosed).toBe(true)
    expect(fake.surfaces.every((s) => s.released)).toBe(true)
  })

  it('da encode-failed si el codificador falla', async () => {
    const fake = fakeBackend()
    const draw = fake.backend.draw
    fake.backend.draw = (source, size, options) => ({
      ...draw(source, size, options),
      encode: () => Promise.reject(new Error('sin memoria')),
    })
    const error = await rejection(
      processPhoto(cameraJpeg(), { backend: fake.backend }),
    )
    expect(error.reason).toBe('encode-failed')
    expect(error.message).toMatch(/Vuelve a intentarlo/)
  })
})
