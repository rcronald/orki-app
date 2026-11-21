import type { DecodedImage, ImageBackend, Surface } from './backend.ts'
import { fitToBudget, type Attempt, type BudgetPlan } from './budget.ts'
import { browserBackend, browserSupportsPhotoProcessing } from './browser.ts'
import { classifyDecodeFailure, PhotoProcessingError } from './errors.ts'
import { chooseOutputType, matchesType, type OutputType } from './format.ts'
import {
  fitWithin,
  orientationMatrix,
  orientedSize,
  planResizeSteps,
  type Size,
} from './geometry.ts'
import { findMetadata, stripMetadata } from './metadata.ts'
import {
  SNIFF_BYTES,
  sniffImage,
  type ExifOrientation,
  type SourceFormat,
} from './sniff.ts'

// Preparación de una foto en el navegador antes de subirla: foto comprimida y
// miniatura, recodificadas (sin metadatos), orientadas y por debajo de sus
// topes de peso. Se carga de forma diferida (ver load.ts): nada de este
// módulo entra en el chunk inicial.

export {
  PHOTO_ERROR_TEXT,
  PhotoProcessingError,
  photoErrorReason,
  type PhotoErrorReason,
} from './errors.ts'

/** ¿Codifica WebP este navegador? (la prueba se hace una vez por sesión) */
export function encodesWebp(): Promise<boolean> {
  return browserBackend.encodesWebp()
}

/** Tope de la foto y su búsqueda de calidad. */
export interface ImageTarget extends Omit<BudgetPlan, 'minSide'> {
  /** Lado mayor como mucho, en píxeles. */
  maxSide: number
  /** Lado mayor por debajo del cual ya no se reduce para cumplir el peso. */
  minSide: number
}

export interface PhotoLimits {
  photo: ImageTarget
  thumbnail: ImageTarget
  /** Archivo de entrada como mucho, en bytes. */
  maxInputBytes: number
  /** Píxeles de la imagen de entrada como mucho (ancho × alto). */
  maxInputPixels: number
}

/**
 * Foto: 1600 px de lado mayor. En el detalle (#16) la foto ocupa el ancho de
 * un celular, unos 390 px CSS a 3x, es decir unos 1170 px reales; 1600 deja
 * margen para ampliarla o verla en una tableta. A 1600 × 1200 (1,9 MP), WebP
 * con calidad 0,8 da del orden de 150-250 KB con una foto de plantas
 * (detalle fino y fondo desenfocado) y JPEG 0,8 algo más, que la búsqueda de
 * calidad ajusta por debajo de 300 KB. 2048 px obligaría casi siempre a
 * bajar la calidad.
 *
 * Miniatura: 400 px de lado mayor, sin recortar. SpecimenCard la muestra
 * cuadrada en la lista (un cuarto del ancho, ~90 px CSS) y en 4:3 en la
 * cuadrícula (~175 px CSS de ancho con dos columnas en el celular), las dos
 * con object-fit: cover. Un recorte cuadrado fijo perdería los lados en la
 * cuadrícula; sin recortar, cada vista recorta lo suyo centrado. 400 px cubre
 * la cuadrícula a 2x (~350 px) y la lista a 3x (~270 px); a 400 × 300, WebP
 * 0,75 da unos 15-25 KB.
 *
 * Topes en bytes decimales y estrictos (menos de 300 000 y de 30 000), un
 * poco por debajo de 300 KiB y 30 KiB para que valgan con cualquier lectura
 * de "KB".
 */
export const DEFAULT_PHOTO_LIMITS: PhotoLimits = {
  photo: {
    maxSide: 1600,
    maxBytes: 300_000,
    startQuality: 0.8,
    minQuality: 0.5,
    qualitySteps: 4,
    maxAttempts: 8,
    minSide: 800,
  },
  thumbnail: {
    maxSide: 400,
    maxBytes: 30_000,
    startQuality: 0.75,
    minQuality: 0.45,
    qualitySteps: 4,
    maxAttempts: 8,
    minSide: 200,
  },
  // Un JPEG de 48 MP de un iPhone o un Android de gama alta pesa 15-25 MB.
  maxInputBytes: 50 * 1024 * 1024,
  // 48 MP del iPhone (8064 × 6048 = 48,8 MP) con margen. Decodificada, una
  // imagen así ocupa unos 200 MB (4 bytes por píxel), cerca de lo que
  // aguanta un iPhone; por encima se rechaza sin decodificar.
  maxInputPixels: 50_000_000,
}

export interface EncodedImage extends Size {
  blob: Blob
  type: OutputType
  /** Peso en bytes (blob.size). */
  bytes: number
  /** Calidad usada (0-1). */
  quality: number
  /** false: no se llegó al tope; es el resultado más ligero conseguido. */
  withinBudget: boolean
  /** Codificaciones que hicieron falta. */
  attempts: Attempt[]
}

export interface ProcessedPhoto {
  photo: EncodedImage
  thumbnail: EncodedImage
  source: {
    bytes: number
    /** Tipo MIME declarado por el navegador (puede estar vacío). */
    declaredType: string
    /** Formato detectado por la firma de los bytes. */
    format: SourceFormat
    /** Tamaño ya orientado. */
    width: number
    height: number
    orientation: ExifOrientation
  }
  /** Quién aplicó la orientación EXIF: el navegador, este módulo o nadie. */
  orientationAppliedBy: 'browser' | 'module' | 'none'
  /** Tiempo total en milisegundos. */
  durationMs: number
}

export interface ProcessPhotoOptions {
  signal?: AbortSignal
  limits?: PhotoLimits
  /** Capa del navegador; las pruebas pasan un doble. */
  backend?: ImageBackend
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new PhotoProcessingError('aborted', { cause: signal.reason })
  }
}

/** Espera `promise` o rechaza en cuanto se cancele. */
function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return promise
  return new Promise<T>((resolve, reject) => {
    const onAbort = () =>
      reject(new PhotoProcessingError('aborted', { cause: signal.reason }))
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

/**
 * Prepara una foto para subirla. Devuelve la foto y la miniatura como Blob
 * (WebP o JPEG), siempre recodificadas: nunca el archivo original, aunque ya
 * sea pequeño. Rechaza con PhotoProcessingError y su motivo.
 */
export async function processPhoto(
  input: Blob,
  options: ProcessPhotoOptions = {},
): Promise<ProcessedPhoto> {
  const started = performance.now()
  const { signal } = options
  const limits = options.limits ?? DEFAULT_PHOTO_LIMITS
  const backend = options.backend ?? browserBackend
  if (!options.backend && !browserSupportsPhotoProcessing()) {
    throw new PhotoProcessingError('unsupported-browser')
  }
  throwIfAborted(signal)

  if (input.size === 0) throw new PhotoProcessingError('empty')
  if (input.size > limits.maxInputBytes) {
    throw new PhotoProcessingError('too-large')
  }

  const head = new Uint8Array(
    await abortable(input.slice(0, SNIFF_BYTES).arrayBuffer(), signal),
  )
  const sniffed = sniffImage(head)
  if (sniffed.format === 'unknown' && !input.type.startsWith('image/')) {
    throw new PhotoProcessingError('not-an-image')
  }
  if (
    sniffed.width !== undefined &&
    sniffed.height !== undefined &&
    sniffed.width * sniffed.height > limits.maxInputPixels
  ) {
    throw new PhotoProcessingError('too-large', { format: sniffed.format })
  }

  // Las dos pruebas del navegador (una vez por sesión) mientras se decodifica.
  const probes = Promise.all([
    backend.appliesExifOrientation(),
    backend.encodesWebp(),
  ])

  let decoded: DecodedImage
  try {
    decoded = await abortable(backend.decode(input), signal)
  } catch (error) {
    if (error instanceof PhotoProcessingError) throw error
    throw classifyDecodeFailure(sniffed.format, error)
  }

  let decodedOpen = true
  const closeDecoded = () => {
    if (decodedOpen) decoded.close()
    decodedOpen = false
  }
  const surfaces: Surface[] = []
  try {
    if (decoded.width * decoded.height > limits.maxInputPixels) {
      throw new PhotoProcessingError('too-large', { format: sniffed.format })
    }
    const [browserOrients, webp] = await abortable(probes, signal)
    const orientation = sniffed.orientation
    const rotateHere = !browserOrients && orientation !== 1
    const decodedSize = { width: decoded.width, height: decoded.height }
    const upright = rotateHere
      ? orientedSize(decodedSize, orientation)
      : decodedSize

    // Base: la foto orientada y reducida a su tamaño máximo. De ella salen
    // la foto y la miniatura; la imagen decodificada se libera enseguida.
    // Si ya cabe, un único paso del mismo tamaño: se recodifica igual.
    const target = fitWithin(upright, limits.photo.maxSide)
    const steps = planResizeSteps(upright, target)
    if (steps.length === 0) steps.push(target)
    let current: Surface | undefined
    for (const [index, step] of steps.entries()) {
      throwIfAborted(signal)
      const first = index === 0
      const source = current?.source ?? decoded.source
      const drawn = rotateHere && first ? orientedSize(step, orientation) : step
      const next = backend.draw(source, step, {
        opaque: first,
        transform:
          rotateHere && first
            ? { matrix: orientationMatrix(orientation, drawn), drawn }
            : undefined,
      })
      surfaces.push(next)
      current?.release()
      current = next
      await backend.yieldToMain()
    }
    if (!current) throw new Error('Sin pasos de reducción')
    const base = current
    closeDecoded()

    const encodeTarget = async (
      targetLimits: ImageTarget,
      initial: Size,
    ): Promise<EncodedImage> => {
      let type = chooseOutputType(webp)
      for (;;) {
        try {
          return await encodeWithin(
            backend,
            base,
            initial,
            type,
            targetLimits,
            signal,
          )
        } catch (error) {
          // El navegador devolvió otro tipo (PNG en vez de WebP) pese a la
          // prueba: se repite en JPEG.
          if (error instanceof TypeMismatch && type === 'image/webp') {
            type = 'image/jpeg'
            continue
          }
          throw error
        }
      }
    }

    const photo = await encodeTarget(limits.photo, base)
    await backend.yieldToMain()
    const thumbnail = await encodeTarget(
      limits.thumbnail,
      fitWithin(base, limits.thumbnail.maxSide),
    )

    return {
      photo,
      thumbnail,
      source: {
        bytes: input.size,
        declaredType: input.type,
        format: sniffed.format,
        width: upright.width,
        height: upright.height,
        orientation,
      },
      orientationAppliedBy:
        orientation === 1 ? 'none' : rotateHere ? 'module' : 'browser',
      durationMs: Math.round(performance.now() - started),
    }
  } catch (error) {
    if (error instanceof PhotoProcessingError) throw error
    throw new PhotoProcessingError('encode-failed', { cause: error })
  } finally {
    closeDecoded()
    for (const surface of surfaces) surface.release()
  }
}

class TypeMismatch extends Error {}

/**
 * Codifica `base` al tamaño que pida la búsqueda de calidad, comprueba el
 * tipo real y garantiza que no lleva metadatos.
 */
async function encodeWithin(
  backend: ImageBackend,
  base: Surface,
  initial: Size,
  type: OutputType,
  target: ImageTarget,
  signal: AbortSignal | undefined,
): Promise<EncodedImage> {
  const encodeAt = async (size: Size, quality: number): Promise<Blob> => {
    let surface = base
    const temporary: Surface[] = []
    try {
      if (size.width !== base.width || size.height !== base.height) {
        for (const step of planResizeSteps(base, size)) {
          surface = backend.draw(surface.source, step)
          temporary.push(surface)
        }
      }
      const blob = await abortable(surface.encode(type, quality), signal)
      if (!(await matchesType(blob, type))) throw new TypeMismatch()
      return await withoutMetadata(blob, type)
    } finally {
      for (const surface of temporary) surface.release()
      await backend.yieldToMain()
    }
  }

  const result = await fitToBudget(
    encodeAt,
    (blob) => blob.size,
    fitWithin(initial, target.maxSide),
    target,
    () => throwIfAborted(signal),
  )
  return {
    blob: result.encoded,
    type,
    width: result.width,
    height: result.height,
    bytes: result.bytes,
    quality: result.quality,
    withinBudget: result.withinBudget,
    attempts: result.attempts,
  }
}

/**
 * El Blob tal cual si no lleva metadatos privados; si los llevara (algún
 * codificador podría añadir un EXIF mínimo), una copia sin ellos. Si aun así
 * quedara algo, falla en vez de devolverlo.
 */
async function withoutMetadata(blob: Blob, type: OutputType): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (!findMetadata(bytes).hasPrivateMetadata) return blob
  const stripped = stripMetadata(bytes)
  if (findMetadata(stripped).hasPrivateMetadata) {
    throw new Error('No se pudieron retirar los metadatos del resultado')
  }
  return new Blob([stripped as Uint8Array<ArrayBuffer>], { type })
}
