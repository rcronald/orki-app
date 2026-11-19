// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Contraste WCAG 2.x de los pares de color que el design system declara
// válidos, con los valores reales de tokens.css (la única fuente de los tokens
// en la app). Si un token cambia y un par baja de su mínimo, la prueba falla.

const NORMAL_TEXT = 4.5
const LARGE_TEXT = 3
const UI = 3

type Kind = 'texto' | 'texto grande' | 'interfaz'

interface Pair {
  foreground: string
  background: string
  kind: Kind
  min: number
}

const text = (foreground: string, background: string): Pair => ({
  foreground,
  background,
  kind: 'texto',
  min: NORMAL_TEXT,
})
const largeText = (foreground: string, background: string): Pair => ({
  foreground,
  background,
  kind: 'texto grande',
  min: LARGE_TEXT,
})
const ui = (foreground: string, background: string): Pair => ({
  foreground,
  background,
  kind: 'interfaz',
  min: UI,
})

// color-success sobre color-neutral-50 (4.48:1) no está: el sistema solo lo
// permite en negrita o como relleno, nunca como texto normal. Tampoco
// color-warning como texto ni color-primary como texto sobre
// color-primary-soft, que el sistema prohíbe.
const PAIRS: readonly Pair[] = [
  text('color-neutral-0', 'color-primary'),
  text('color-neutral-900', 'color-primary-soft'),
  text('color-secondary', 'color-primary-soft'),
  text('color-secondary', 'color-neutral-0'),
  text('color-secondary', 'color-neutral-50'),
  text('color-neutral-700', 'color-neutral-0'),
  text('color-neutral-700', 'color-neutral-50'),
  text('color-neutral-900', 'color-neutral-0'),
  text('color-neutral-900', 'color-neutral-50'),
  text('color-neutral-0', 'color-secondary'),
  text('color-neutral-0', 'color-success'),
  text('color-success', 'color-neutral-0'),
  text('color-neutral-900', 'color-warning'),
  text('color-neutral-0', 'color-danger'),
  text('color-danger', 'color-neutral-0'),
  text('color-danger', 'color-neutral-50'),
  text('color-danger', 'color-danger-soft'),
  text('color-neutral-900', 'color-danger-soft'),
  largeText('color-primary', 'color-neutral-0'),
  largeText('color-primary', 'color-neutral-50'),
  // Chip seleccionado: borde color-primary sobre color-primary-soft.
  ui('color-primary', 'color-primary-soft'),
  // Bordes de campos y anillo de foco en color-secondary.
  ui('color-secondary', 'color-neutral-0'),
  ui('color-secondary', 'color-neutral-50'),
  // Borde de los mensajes de error y del botón destructivo en hover.
  ui('color-danger', 'color-danger-soft'),
  // Borde del campo con error (bundle-extra.css).
  ui('color-danger', 'color-neutral-0'),
  // Sugerencia activa del buscador (components-pending.css): texto secundario
  // y acción final sobre color-primary-soft, con el anillo color-secondary.
  text('color-neutral-700', 'color-primary-soft'),
  ui('color-secondary', 'color-primary-soft'),
]

function readColorTokens(css: string): Map<string, string> {
  const colors = new Map<string, string>()
  for (const match of css.matchAll(
    /--(color-[a-z0-9-]+):\s*(#[0-9a-f]{6});/gi,
  )) {
    const [, name, value] = match
    if (name && value) colors.set(name, value)
  }
  return colors
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  const [r = 0, g = 0, b = 0] = channels
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground)
  const b = relativeLuminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

// Se lee el archivo del disco: Vitest no procesa CSS y un import con ?raw
// llega vacío.
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
    ).toBeCloseTo(4.48, 2)
  })

  it.each(PAIRS)(
    '$foreground sobre $background ($kind, mínimo $min:1)',
    ({ foreground, background, min }) => {
      const ratio = contrastRatio(color(foreground), color(background))
      expect(ratio).toBeGreaterThanOrEqual(min)
    },
  )
})
