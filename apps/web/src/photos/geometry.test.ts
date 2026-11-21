import { describe, expect, it } from 'vitest'
import {
  fitWithin,
  orientationMatrix,
  orientedSize,
  planResizeSteps,
} from './geometry.ts'
import type { ExifOrientation } from './sniff.ts'

describe('fitWithin', () => {
  it('limita el lado mayor y conserva la proporción', () => {
    expect(fitWithin({ width: 4032, height: 3024 }, 1600)).toEqual({
      width: 1600,
      height: 1200,
    })
    expect(fitWithin({ width: 3024, height: 4032 }, 400)).toEqual({
      width: 300,
      height: 400,
    })
  })

  it('no amplía una imagen pequeña', () => {
    expect(fitWithin({ width: 640, height: 480 }, 1600)).toEqual({
      width: 640,
      height: 480,
    })
  })

  it('deja al menos 1 px en una imagen muy alargada', () => {
    expect(fitWithin({ width: 20000, height: 2 }, 400)).toEqual({
      width: 400,
      height: 1,
    })
  })
})

describe('planResizeSteps', () => {
  it('reduce por mitades y termina en el tamaño exacto', () => {
    expect(
      planResizeSteps(
        { width: 4032, height: 3024 },
        { width: 400, height: 300 },
      ),
    ).toEqual([
      { width: 2016, height: 1512 },
      { width: 1008, height: 756 },
      { width: 504, height: 378 },
      { width: 400, height: 300 },
    ])
  })

  it('da un paso si la reducción es de menos del doble', () => {
    expect(
      planResizeSteps(
        { width: 2000, height: 1500 },
        { width: 1600, height: 1200 },
      ),
    ).toEqual([{ width: 1600, height: 1200 }])
  })

  it('no da pasos si ya tiene el tamaño', () => {
    expect(
      planResizeSteps({ width: 800, height: 600 }, { width: 800, height: 600 }),
    ).toEqual([])
  })

  it('ningún lienzo intermedio pasa de la mitad del original', () => {
    const steps = planResizeSteps(
      { width: 8064, height: 6048 },
      { width: 1600, height: 1200 },
    )
    for (const step of steps) {
      expect(step.width * step.height).toBeLessThanOrEqual((8064 * 6048) / 4)
    }
  })
})

describe('orientación', () => {
  it('intercambia ancho y alto solo con los giros de 90°', () => {
    const size = { width: 4, height: 3 }
    expect(orientedSize(size, 1)).toEqual(size)
    expect(orientedSize(size, 3)).toEqual(size)
    expect(orientedSize(size, 6)).toEqual({ width: 3, height: 4 })
    expect(orientedSize(size, 8)).toEqual({ width: 3, height: 4 })
  })

  // Dónde acaba la esquina de arriba a la izquierda de la imagen guardada
  // (0, 0) y la de arriba a la derecha (w, 0), según EXIF.
  const apply = (
    [a, b, c, d, e, f]: readonly number[],
    [x, y]: [number, number],
  ) => [a * x + c * y + e, b * x + d * y + f]

  it.each<[ExifOrientation, [number, number], [number, number]]>([
    [1, [0, 0], [4, 0]],
    [2, [4, 0], [0, 0]],
    [3, [4, 3], [0, 3]],
    [4, [0, 3], [4, 3]],
    [5, [0, 0], [0, 4]],
    [6, [3, 0], [3, 4]],
    [7, [3, 4], [3, 0]],
    [8, [0, 4], [0, 0]],
  ])(
    'orientación %i coloca bien las esquinas',
    (orientation, topLeft, topRight) => {
      const matrix = orientationMatrix(orientation, { width: 4, height: 3 })
      expect(apply(matrix, [0, 0])).toEqual(topLeft)
      expect(apply(matrix, [4, 0])).toEqual(topRight)
    },
  )
})
