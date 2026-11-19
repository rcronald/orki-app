// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CONTRAST_PAIRS, contrastRatio } from './contrast.ts'
import { readColorTokens } from './tokens.ts'

// Contraste WCAG 2.x de los pares de color que el design system declara
// válidos (CONTRAST_PAIRS, en contrast.ts), con los valores reales de
// tokens.css (la única fuente de los tokens en la app). Si un token cambia y
// un par baja de su mínimo, la prueba falla. La página de muestra enseña las
// mismas razones con la misma lista y el mismo cálculo.

// Se lee el archivo del disco, sin pasar por el procesado de CSS de Vitest.
const tokensCss = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')
const colors = readColorTokens(tokensCss)

function color(name: string): string {
  const value = colors.get(name)
  if (!value) throw new Error(`Falta el token ${name} en tokens.css`)
  return value
}

describe('contraste de los tokens de color', () => {
  it('lee los colores de tokens.css', () => {
    expect(colors.size).toBeGreaterThanOrEqual(11)
  })

  it('calcula la razón WCAG con valores ya conocidos del sistema', () => {
    const primary = color('color-primary')
    expect(contrastRatio(primary, primary)).toBeCloseTo(1, 5)
    // Razones publicadas en el issue #3, redondeadas a dos decimales.
    expect(
      contrastRatio(color('color-neutral-0'), color('color-primary')),
    ).toBeCloseTo(4.65, 2)
    expect(
      contrastRatio(color('color-success'), color('color-neutral-50')),
    ).toBeCloseTo(4.6, 2)
  })

  it.each(CONTRAST_PAIRS)(
    '$foreground sobre $background ($kind, mínimo $min:1)',
    ({ foreground, background, min }) => {
      const ratio = contrastRatio(color(foreground), color(background))
      expect(ratio).toBeGreaterThanOrEqual(min)
    },
  )
})
