import type {
  DecodedImage,
  DrawOptions,
  ImageBackend,
  Surface,
} from './backend.ts'
import { detectWebpEncoding, type OutputType } from './format.ts'
import type { Size } from './geometry.ts'
import {
  probeShowsOrientationApplied,
  withExifOrientation,
} from './orientation.ts'

// Capa del navegador: createImageBitmap para decodificar fuera del hilo
// principal (el navegador decodifica en segundo plano y la promesa resuelve
// con la imagen lista) y OffscreenCanvas donde exista (Chrome 69, Firefox 105,
// Safari 16.4; mdn/browser-compat-data), o un <canvas> sin insertar en la
// página. No hace falta un Web Worker: lo que bloquea el hilo es dibujar y
// codificar una foto de 1600 px, decenas de milisegundos por paso, y entre
// pasos se cede el hilo (ver la medición en el README, sección "Fotos").

/** Fondo para aplanar la transparencia (JPEG no la tiene). */
const OPAQUE_BACKGROUND = '#ffffff'

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement
type AnyContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

function createCanvas(size: Size): { canvas: AnyCanvas; context: AnyContext } {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(size.width, size.height)
    const context = canvas.getContext('2d')
    if (context) return { canvas, context }
  }
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No se pudo crear un contexto 2D')
  return { canvas, context }
}

function encodeCanvas(
  canvas: AnyCanvas,
  type: OutputType,
  quality: number,
): Promise<Blob> {
  if (
    typeof OffscreenCanvas !== 'undefined' &&
    canvas instanceof OffscreenCanvas
  ) {
    return canvas.convertToBlob({ type, quality })
  }
  const element = canvas as HTMLCanvasElement
  return new Promise((resolve, reject) => {
    element.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('toBlob devolvió null')),
      type,
      quality,
    )
  })
}

function releaseCanvas(canvas: AnyCanvas) {
  // Safari retiene la memoria de un lienzo hasta que se recolecta; con
  // tamaño 0 la suelta en el acto (pqina.nl, "Total canvas memory use
  // exceeds the maximum limit").
  canvas.width = 0
  canvas.height = 0
}

function draw(
  source: CanvasImageSource,
  size: Size,
  options: DrawOptions = {},
): Surface {
  const { canvas, context } = createCanvas(size)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  if (options.opaque) {
    context.fillStyle = OPAQUE_BACKGROUND
    context.fillRect(0, 0, size.width, size.height)
  }
  if (options.transform) {
    const [a, b, c, d, e, f] = options.transform.matrix
    context.setTransform(a, b, c, d, e, f)
    const { width, height } = options.transform.drawn
    context.drawImage(source, 0, 0, width, height)
    context.setTransform(1, 0, 0, 1, 0, 0)
  } else {
    context.drawImage(source, 0, 0, size.width, size.height)
  }
  return {
    width: size.width,
    height: size.height,
    source: canvas,
    encode: (type, quality) => encodeCanvas(canvas, type, quality),
    release: () => releaseCanvas(canvas),
  }
}

async function decode(blob: Blob): Promise<DecodedImage> {
  // 'from-image' es el valor por defecto; se pide explícito por claridad.
  const bitmap = await createImageBitmap(blob, {
    imageOrientation: 'from-image',
  })
  return {
    width: bitmap.width,
    height: bitmap.height,
    source: bitmap,
    close: () => bitmap.close(),
  }
}

async function probeOrientation(): Promise<boolean> {
  try {
    const surface = draw(
      // Un lienzo vacío de 2 × 1 como origen.
      createCanvas({ width: 2, height: 1 }).canvas,
      { width: 2, height: 1 },
      { opaque: true },
    )
    const jpeg = await surface.encode('image/jpeg', 0.9)
    surface.release()
    const bytes = new Uint8Array(await jpeg.arrayBuffer())
    const probe = new Blob([withExifOrientation(bytes, 6)], {
      type: 'image/jpeg',
    })
    const decoded = await decode(probe)
    const applied = probeShowsOrientationApplied(decoded)
    decoded.close()
    return applied
  } catch {
    // Si la prueba falla, lo seguro es suponer el comportamiento estándar
    // (el navegador orienta): girar de más es peor que no girar.
    return true
  }
}

function probeWebp(): Promise<boolean> {
  return detectWebpEncoding(async () => {
    const surface = draw(
      createCanvas({ width: 2, height: 2 }).canvas,
      { width: 2, height: 2 },
      { opaque: true },
    )
    try {
      return await surface.encode('image/webp', 0.8)
    } finally {
      surface.release()
    }
  })
}

/** ¿Tiene el navegador lo necesario para procesar fotos? */
export function browserSupportsPhotoProcessing(): boolean {
  return (
    typeof createImageBitmap === 'function' &&
    (typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined')
  )
}

let orientationProbe: Promise<boolean> | undefined
let webpProbe: Promise<boolean> | undefined

/** Capa del navegador; las dos pruebas se hacen una vez por sesión. */
export const browserBackend: ImageBackend = {
  decode,
  draw,
  appliesExifOrientation: () => (orientationProbe ??= probeOrientation()),
  encodesWebp: () => (webpProbe ??= probeWebp()),
  yieldToMain: () => new Promise((resolve) => setTimeout(resolve, 0)),
}
