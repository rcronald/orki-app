import { describe, expect, it } from 'vitest'
import { fitToBudget, shrinkFactor, type BudgetPlan } from './budget.ts'
import type { Size } from './geometry.ts'

const plan: BudgetPlan = {
  maxBytes: 300_000,
  startQuality: 0.8,
  minQuality: 0.5,
  qualitySteps: 4,
  maxAttempts: 8,
  minSide: 800,
}

/**
 * Codificador de mentira: el peso crece con el área y con la calidad, como
 * en un códec real. `bitsPerPixel` es el peso por píxel a calidad 1.
 */
function fakeEncoder(bitsPerPixel: number) {
  return async ({ width, height }: Size, quality: number) =>
    Promise.resolve({
      size: Math.round((width * height * bitsPerPixel * quality ** 2) / 8),
    })
}

const measure = (encoded: { size: number }) => encoded.size

describe('fitToBudget', () => {
  it('se queda con el primer intento si ya cabe', async () => {
    const result = await fitToBudget(
      fakeEncoder(1),
      measure,
      { width: 1600, height: 1200 },
      plan,
    )
    expect(result.attempts).toHaveLength(1)
    expect(result).toMatchObject({
      width: 1600,
      height: 1200,
      quality: 0.8,
      withinBudget: true,
    })
  })

  it('baja la calidad por bisección y se queda con la más alta que cabe', async () => {
    // 1600 × 1200 a 2 bits/píxel: 0,8 → 307 KB (no cabe), 0,5 → 120 KB.
    const result = await fitToBudget(
      fakeEncoder(2),
      measure,
      { width: 1600, height: 1200 },
      plan,
    )
    expect(result.withinBudget).toBe(true)
    expect(result.bytes).toBeLessThan(300_000)
    const qualities = result.attempts.map((a) => a.quality)
    expect(qualities.slice(0, 3)).toEqual([0.8, 0.5, 0.65])
    expect(result.attempts).toHaveLength(4)
    // El cuarto intento, entre 0,65 y 0,8, también cabe y es el elegido.
    expect(result.quality).toBe(qualities[3])
    expect(result.quality).toBeGreaterThan(0.65)
    expect({ width: result.width, height: result.height }).toEqual({
      width: 1600,
      height: 1200,
    })
  })

  it('reduce las dimensiones si ni la calidad mínima cabe', async () => {
    // 6 bits/píxel: a 1600 × 1200 y calidad 0,5, 360 KB.
    const result = await fitToBudget(
      fakeEncoder(6),
      measure,
      { width: 1600, height: 1200 },
      plan,
    )
    expect(result.withinBudget).toBe(true)
    expect(result.bytes).toBeLessThan(300_000)
    expect(result.width).toBeLessThan(1600)
    expect(result.width / result.height).toBeCloseTo(4 / 3, 2)
    expect(result.attempts.length).toBeLessThanOrEqual(plan.maxAttempts)
  })

  it('devuelve lo más ligero marcado si no se llega al tope', async () => {
    const result = await fitToBudget(
      fakeEncoder(200),
      measure,
      { width: 1600, height: 1200 },
      plan,
    )
    expect(result.withinBudget).toBe(false)
    expect(result.attempts.length).toBeLessThanOrEqual(plan.maxAttempts)
    expect(result.bytes).toBe(Math.min(...result.attempts.map((a) => a.bytes)))
    // No baja del lado mínimo.
    expect(Math.max(result.width, result.height)).toBeGreaterThanOrEqual(800)
  })

  it('llama a checkpoint antes de cada codificación', async () => {
    let calls = 0
    await expect(
      fitToBudget(
        fakeEncoder(2),
        measure,
        { width: 1600, height: 1200 },
        plan,
        () => {
          calls++
          if (calls === 2) throw new Error('cancelado')
        },
      ),
    ).rejects.toThrow('cancelado')
    expect(calls).toBe(2)
  })
})

describe('shrinkFactor', () => {
  it('escala por la raíz del exceso con margen, entre 0,5 y 0,9', () => {
    expect(shrinkFactor(400_000, 300_000)).toBeCloseTo(Math.sqrt(0.75) * 0.9, 5)
    expect(shrinkFactor(300_001, 300_000)).toBeCloseTo(0.9, 3)
    expect(shrinkFactor(10_000_000, 300_000)).toBe(0.5)
  })
})
