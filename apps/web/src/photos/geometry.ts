import type { ExifOrientation } from './sniff.ts'

// Cálculos de tamaño y orientación, sin tocar el navegador.

export interface Size {
  width: number
  height: number
}

/**
 * Tamaño con el lado mayor como mucho `maxSide`, conservando la proporción.
 * Nunca amplía: una imagen más pequeña se queda como está.
 */
export function fitWithin(size: Size, maxSide: number): Size {
  const longest = Math.max(size.width, size.height)
  if (longest <= maxSide) return { width: size.width, height: size.height }
  const scale = maxSide / longest
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  }
}

/** Escala un tamaño por `factor` (redondeado, mínimo 1 px por lado). */
export function scaleSize(size: Size, factor: number): Size {
  return {
    width: Math.max(1, Math.round(size.width * factor)),
    height: Math.max(1, Math.round(size.height * factor)),
  }
}

/**
 * Pasos de reducción de `from` a `to`: se divide a la mitad mientras la
 * reducción restante sea de más del doble y el último paso da el tamaño
 * exacto. Dibujar de una vez una foto de 4000 px en 400 px con el suavizado
 * del canvas deja dientes de sierra (muestrea pocos píxeles de origen); por
 * mitades cada píxel nuevo promedia los de origen. Además, ningún lienzo
 * intermedio es mayor que la mitad del original, lo que respeta el tope de
 * área de canvas de iOS (16 777 216 px, 4096 × 4096; pqina.nl, "Canvas area
 * exceeds the maximum limit", y WebKit bug 195325) con fotos de hasta 64 MP.
 */
export function planResizeSteps(from: Size, to: Size): Size[] {
  const steps: Size[] = []
  let current = from
  while (current.width > to.width * 2 && current.height > to.height * 2) {
    current = {
      width: Math.max(to.width, Math.round(current.width / 2)),
      height: Math.max(to.height, Math.round(current.height / 2)),
    }
    steps.push(current)
  }
  const last = steps.at(-1) ?? from
  if (last.width !== to.width || last.height !== to.height) steps.push(to)
  return steps
}

/** ¿Intercambia la orientación el ancho y el alto (giros de 90°)? */
export function swapsAxes(orientation: ExifOrientation): boolean {
  return orientation >= 5
}

/** Tamaño de la imagen ya girada según su orientación. */
export function orientedSize(size: Size, orientation: ExifOrientation): Size {
  return swapsAxes(orientation)
    ? { width: size.height, height: size.width }
    : { width: size.width, height: size.height }
}

/** Matriz [a, b, c, d, e, f] de CanvasRenderingContext2D.setTransform(). */
export type Matrix = readonly [number, number, number, number, number, number]

/**
 * Transformación que, aplicada antes de dibujar la imagen guardada (sin girar)
 * con tamaño `drawn`, la deja en su orientación correcta dentro de un lienzo
 * de tamaño orientedSize(drawn, orientation). Solo se usa si el navegador no
 * aplica la orientación EXIF por sí mismo (ver orientation.ts).
 */
export function orientationMatrix(
  orientation: ExifOrientation,
  drawn: Size,
): Matrix {
  const { width: w, height: h } = drawn
  switch (orientation) {
    case 2:
      return [-1, 0, 0, 1, w, 0]
    case 3:
      return [-1, 0, 0, -1, w, h]
    case 4:
      return [1, 0, 0, -1, 0, h]
    case 5:
      return [0, 1, 1, 0, 0, 0]
    case 6:
      return [0, 1, -1, 0, h, 0]
    case 7:
      return [0, -1, -1, 0, h, w]
    case 8:
      return [0, -1, 1, 0, 0, w]
    default:
      return [1, 0, 0, 1, 0, 0]
  }
}
