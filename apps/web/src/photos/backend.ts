import type { OutputType } from './format.ts'
import type { Matrix, Size } from './geometry.ts'

// Capa del navegador que usa process.ts: decodificar, dibujar y codificar. La
// de la app está en browser.ts; las pruebas pasan un doble (jsdom no tiene
// canvas ni createImageBitmap).

/** Imagen decodificada (ImageBitmap en el navegador). */
export interface DecodedImage extends Size {
  readonly source: CanvasImageSource
  /** Libera la memoria de la imagen. */
  close: () => void
}

/** Lienzo con una imagen dibujada (OffscreenCanvas o <canvas>). */
export interface Surface extends Size {
  readonly source: CanvasImageSource
  /** Codifica el lienzo. El Blob puede no ser del tipo pedido (ver format.ts). */
  encode: (type: OutputType, quality: number) => Promise<Blob>
  /** Libera la memoria del lienzo. */
  release: () => void
}

export interface DrawOptions {
  /**
   * Transformación previa al dibujo (giro EXIF a mano) y tamaño con el que se
   * dibuja la imagen antes de transformarla.
   */
  transform?: { matrix: Matrix; drawn: Size }
  /** Rellena el fondo de blanco (aplana la transparencia antes de JPEG). */
  opaque?: boolean
}

export interface ImageBackend {
  /** Decodifica el archivo. Rechaza si el navegador no puede leerlo. */
  decode: (blob: Blob) => Promise<DecodedImage>
  /** Dibuja `source` escalada en un lienzo nuevo de tamaño `size`. */
  draw: (
    source: CanvasImageSource,
    size: Size,
    options?: DrawOptions,
  ) => Surface
  /** ¿Aplica decode() la orientación EXIF? Se calcula una vez. */
  appliesExifOrientation: () => Promise<boolean>
  /** ¿Codifica WebP de verdad? Se calcula una vez. */
  encodesWebp: () => Promise<boolean>
  /** Cede el hilo principal entre pasos para que la interfaz responda. */
  yieldToMain: () => Promise<void>
}
