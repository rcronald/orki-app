// Contraste WCAG 2.x y lista de los pares de color que el design system declara
// válidos. Lo usan la prueba de contraste (contrast.test.ts), que comprueba
// cada par con los valores reales de tokens.css, y la página de muestra, que
// enseña la razón de cada par.

export const NORMAL_TEXT = 4.5
export const LARGE_TEXT = 3
export const UI = 3

export type ContrastKind = 'texto' | 'texto grande' | 'interfaz'

export interface ContrastPair {
  foreground: string
  background: string
  kind: ContrastKind
  min: number
}

const text = (foreground: string, background: string): ContrastPair => ({
  foreground,
  background,
  kind: 'texto',
  min: NORMAL_TEXT,
})
const largeText = (foreground: string, background: string): ContrastPair => ({
  foreground,
  background,
  kind: 'texto grande',
  min: LARGE_TEXT,
})
const ui = (foreground: string, background: string): ContrastPair => ({
  foreground,
  background,
  kind: 'interfaz',
  min: UI,
})

// No están color-warning como texto ni color-primary como texto sobre
// color-primary-soft, que el sistema prohíbe.
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
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
  text('color-success', 'color-neutral-50'),
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
  // Borde del campo con error.
  ui('color-danger', 'color-neutral-0'),
  // Sugerencia activa del buscador: texto secundario
  // y acción final sobre color-primary-soft, con el anillo color-secondary.
  text('color-neutral-700', 'color-primary-soft'),
  ui('color-secondary', 'color-primary-soft'),
]

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  const [r = 0, g = 0, b = 0] = channels
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Razón de contraste WCAG 2.x entre dos colores #rrggbb. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground)
  const b = relativeLuminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/**
 * Lo que el formulario de registro pinta directamente sobre el fondo de la
 * página (sin tarjeta ni campo debajo), y que con el fondo por género (#13)
 * queda sobre la foto bajo el velo overlay-genus: títulos y textos
 * (neutral-900), ayudas (neutral-700), etiquetas, botón secundario y
 * "Más detalles" (secondary) y errores (danger); como interfaz, el borde de
 * los campos y el anillo de foco (secondary) y el borde del campo con error
 * (danger). Los chips, los campos y la barra de acciones llevan fondo propio
 * opaco. Lo comprueba src/registration/genus-backdrop-contrast.test.ts.
 */
export const BACKDROP_FOREGROUNDS: readonly Omit<ContrastPair, 'background'>[] =
  [
    { foreground: 'color-neutral-900', kind: 'texto', min: NORMAL_TEXT },
    { foreground: 'color-neutral-700', kind: 'texto', min: NORMAL_TEXT },
    { foreground: 'color-secondary', kind: 'texto', min: NORMAL_TEXT },
    { foreground: 'color-danger', kind: 'texto', min: NORMAL_TEXT },
    { foreground: 'color-secondary', kind: 'interfaz', min: UI },
    { foreground: 'color-danger', kind: 'interfaz', min: UI },
  ]

/**
 * Color #rrggbb que resulta de pintar `overlay` (rgba(r, g, b, a), como
 * overlay-genus) sobre `background` (#rrggbb), mezclando en sRGB como hacen
 * los navegadores.
 */
export function compositeOver(overlay: string, background: string): string {
  const match =
    /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i.exec(
      overlay,
    )
  if (!match) throw new Error(`Color con transparencia no válido: ${overlay}`)
  const [, r = '0', g = '0', b = '0', a = '1'] = match
  const alpha = Number(a)
  return `#${[r, g, b]
    .map((channel, index) => {
      const under = Number.parseInt(
        background.slice(1 + index * 2, 3 + index * 2),
        16,
      )
      const mixed = Math.round(alpha * Number(channel) + (1 - alpha) * under)
      return mixed.toString(16).padStart(2, '0')
    })
    .join('')}`
}
