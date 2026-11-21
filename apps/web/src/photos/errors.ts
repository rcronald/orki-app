import type { SourceFormat } from './sniff.ts'

// Errores del procesamiento de fotos, con su motivo y el texto para mostrar.

/**
 * Por qué no se pudo preparar la foto:
 * - empty: el archivo está vacío.
 * - not-an-image: el archivo no es una imagen.
 * - unsupported-format: es una imagen, pero este navegador no la sabe abrir
 *   (HEIC en Chrome, Firefox o Android; TIFF fuera de Safari).
 * - too-large: pesa o mide demasiado para procesarla en el dispositivo.
 * - decode-failed: el navegador no pudo leerla (archivo dañado o cortado).
 * - encode-failed: no se pudo generar el resultado.
 * - unsupported-browser: al navegador le faltan las API necesarias.
 * - aborted: se canceló con el AbortSignal.
 */
export type PhotoErrorReason =
  | 'empty'
  | 'not-an-image'
  | 'unsupported-format'
  | 'too-large'
  | 'decode-failed'
  | 'encode-failed'
  | 'unsupported-browser'
  | 'aborted'

/** Textos para mostrar en pantalla, uno por motivo. */
export const PHOTO_ERROR_TEXT: Record<PhotoErrorReason, string> = {
  empty: 'El archivo está vacío. Elige otra foto.',
  'not-an-image':
    'El archivo no es una imagen. Elige una foto en JPEG, PNG o WebP.',
  'unsupported-format':
    'Este navegador no puede abrir ese formato de imagen. Elige una foto en JPEG, PNG o WebP.',
  'too-large':
    'La foto es demasiado grande para prepararla en este dispositivo. Elige una más pequeña.',
  'decode-failed':
    'No se pudo leer la foto; puede que el archivo esté dañado. Elige otra.',
  'encode-failed':
    'No se pudo preparar la foto en este dispositivo. Vuelve a intentarlo.',
  'unsupported-browser':
    'Este navegador no puede preparar fotos. Actualízalo o usa otro.',
  aborted: 'Se canceló la preparación de la foto.',
}

/** Texto propio de HEIC, el caso más habitual de formato no soportado. */
export const HEIC_UNSUPPORTED_TEXT =
  'Este navegador no puede abrir fotos HEIC. Elige una foto en JPEG o, en el iPhone, cambia el formato de la cámara a “Más compatible” (Ajustes > Cámara > Formatos).'

/** Error al preparar una foto, con su motivo. */
export class PhotoProcessingError extends Error {
  readonly reason: PhotoErrorReason
  /** Formato detectado en los bytes del archivo, si se llegó a leer. */
  readonly format: SourceFormat | undefined

  constructor(
    reason: PhotoErrorReason,
    options?: { cause?: unknown; format?: SourceFormat },
  ) {
    super(
      reason === 'unsupported-format' && options?.format === 'heic'
        ? HEIC_UNSUPPORTED_TEXT
        : PHOTO_ERROR_TEXT[reason],
      options?.cause === undefined ? undefined : { cause: options.cause },
    )
    this.name = 'PhotoProcessingError'
    this.reason = reason
    this.format = options?.format
  }
}

/** Motivo de cualquier error: el de PhotoProcessingError o encode-failed. */
export function photoErrorReason(error: unknown): PhotoErrorReason {
  return error instanceof PhotoProcessingError ? error.reason : 'encode-failed'
}

// Formatos que el navegador quizá no sabe abrir aunque sean imágenes válidas.
// HEIC: Safari 17+ lo abre; Chrome, Edge y Firefox no (caniuse "heif").
// AVIF lo abren todos los navegadores actuales, pero no versiones antiguas.
// TIFF solo lo abre Safari.
const MAYBE_UNSUPPORTED: ReadonlySet<SourceFormat> = new Set([
  'heic',
  'avif',
  'tiff',
])

/**
 * Clasifica un fallo al decodificar: un formato que el navegador quizá no
 * soporta, o una imagen con firma desconocida que el navegador no abrió, es
 * unsupported-format; un formato que todos abren (JPEG, PNG, WebP, GIF, BMP)
 * que falla es un archivo dañado (decode-failed).
 */
export function classifyDecodeFailure(
  format: SourceFormat,
  cause: unknown,
): PhotoProcessingError {
  if (MAYBE_UNSUPPORTED.has(format) || format === 'unknown') {
    return new PhotoProcessingError('unsupported-format', { cause, format })
  }
  return new PhotoProcessingError('decode-failed', { cause, format })
}
