import { scaleSize, type Size } from './geometry.ts'

// Búsqueda de calidad y tamaño para que una imagen quede por debajo de un
// tope de bytes, con pocos intentos. No sabe de canvas: recibe la función que
// codifica, así se prueba con dobles.

export interface BudgetPlan {
  /** Tope estricto: el resultado debe pesar menos de esto. */
  maxBytes: number
  /** Calidad del primer intento (0-1). */
  startQuality: number
  /** Calidad más baja que se acepta antes de reducir las dimensiones. */
  minQuality: number
  /** Codificaciones como mucho por cada tamaño (al menos 2). */
  qualitySteps: number
  /** Codificaciones como mucho en total. */
  maxAttempts: number
  /** Lado mayor por debajo del cual ya no se reduce más. */
  minSide: number
}

export interface Attempt extends Size {
  quality: number
  bytes: number
}

export interface BudgetResult<T> extends Size {
  encoded: T
  quality: number
  bytes: number
  /** false: no se llegó al tope y es el resultado más ligero conseguido. */
  withinBudget: boolean
  attempts: Attempt[]
}

export type Encoder<T> = (size: Size, quality: number) => Promise<T>

const round2 = (value: number) => Math.round(value * 100) / 100

/**
 * Factor de reducción cuando ni la calidad mínima cabe: el peso crece más o
 * menos con el área, así que se escala por la raíz de la proporción, con un
 * 10 % de margen, entre 0,5 y 0,9 para no pasarse ni quedarse corto.
 */
export function shrinkFactor(bytes: number, maxBytes: number): number {
  const factor = Math.sqrt(maxBytes / bytes) * 0.9
  return Math.min(0.9, Math.max(0.5, factor))
}

/**
 * Codifica con `startQuality`; si cabe, termina (el caso normal: un intento).
 * Si no, prueba `minQuality`: si tampoco cabe, reduce las dimensiones y vuelve
 * a empezar; si cabe, afina por bisección entre las dos con los intentos que
 * queden por tamaño y se queda con la calidad más alta que cabe. Si se acaban
 * los intentos o se llega a `minSide`, devuelve el resultado más ligero
 * marcado con withinBudget: false.
 *
 * `checkpoint` se llama antes de cada codificación (por ejemplo, para lanzar
 * si se canceló).
 */
export async function fitToBudget<T>(
  encode: Encoder<T>,
  measure: (encoded: T) => number,
  initial: Size,
  plan: BudgetPlan,
  checkpoint: () => void = () => {},
): Promise<BudgetResult<T>> {
  const attempts: Attempt[] = []
  let lightest: BudgetResult<T> | undefined
  let size = initial

  const tryEncode = async (quality: number) => {
    checkpoint()
    const encoded = await encode(size, quality)
    const bytes = measure(encoded)
    attempts.push({ ...size, quality, bytes })
    const result: BudgetResult<T> = {
      ...size,
      encoded,
      quality,
      bytes,
      withinBudget: bytes < plan.maxBytes,
      attempts,
    }
    if (!lightest || bytes < lightest.bytes) lightest = result
    return result
  }

  const startQuality = round2(plan.startQuality)
  const minQuality = round2(Math.min(plan.minQuality, startQuality))

  for (;;) {
    let steps = 0
    const first = await tryEncode(startQuality)
    steps++
    if (first.withinBudget) return first
    if (attempts.length >= plan.maxAttempts) break

    let best: BudgetResult<T> | undefined
    let worstBytes = first.bytes
    if (minQuality < startQuality) {
      const low = await tryEncode(minQuality)
      steps++
      worstBytes = low.bytes
      if (low.withinBudget) {
        best = low
        let lo = minQuality
        let hi = startQuality
        while (
          steps < plan.qualitySteps &&
          attempts.length < plan.maxAttempts &&
          hi - lo > 0.02
        ) {
          const mid = round2((lo + hi) / 2)
          const result = await tryEncode(mid)
          steps++
          if (result.withinBudget) {
            best = result
            lo = mid
          } else {
            hi = mid
          }
        }
      }
    }
    if (best) return best
    if (attempts.length >= plan.maxAttempts) break

    const longest = Math.max(size.width, size.height)
    if (longest <= plan.minSide) break
    const next = scaleSize(size, shrinkFactor(worstBytes, plan.maxBytes))
    const nextLongest = Math.max(next.width, next.height)
    size =
      nextLongest < plan.minSide
        ? scaleSize(size, plan.minSide / longest)
        : next
  }

  // Sin intentos o sin margen para reducir: lo más ligero que se consiguió.
  if (!lightest) throw new Error('fitToBudget: sin intentos')
  return { ...lightest, attempts }
}
