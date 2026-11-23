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
const ui = (foreground: string, background: string): ContrastPair => ({
  foreground,
  background,
  kind: 'interfaz',
  min: UI,
})

// No están color-warning como texto ni color-primary como texto sobre
// color-primary-soft, que el sistema prohíbe. Desde el #206 el rosa
// (color-primary y color-primary-soft) es solo color de marca (el logotipo):
// las acciones y la selección van en verde, así que sus pares de texto e
// interfaz ya no están; queda el del botón rosa que el issue #3 publicó, como
// referencia del cálculo.
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  text('color-neutral-0', 'color-primary'),
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
  // Bordes de campos y anillo de foco en color-secondary.
  ui('color-secondary', 'color-neutral-0'),
  ui('color-secondary', 'color-neutral-50'),
  // Borde de los mensajes de error y del botón destructivo en hover.
  ui('color-danger', 'color-danger-soft'),
  // Borde del campo con error.
  ui('color-danger', 'color-neutral-0'),
  // Páginas públicas (#190): botón orki-btn--strong (y su hover, que pasa a
  // color-secondary con el par ya listado), títulos y enlaces en
  // color-secondary-strong, e iconos de las ventajas en su recuadro
  // color-secondary-soft. color-neutral-200 es solo decorativa: sin par.
  text('color-neutral-0', 'color-secondary-strong'),
  text('color-secondary-strong', 'color-neutral-0'),
  text('color-secondary-strong', 'color-neutral-50'),
  text('color-secondary-strong', 'color-secondary-soft'),
  text('color-secondary', 'color-secondary-soft'),
  ui('color-secondary-strong', 'color-secondary-soft'),
  // Portada y páginas de texto (#199): lema del pie (color-neutral-900) y sus
  // enlaces (color-secondary-strong, y color-secondary al pasar por encima)
  // sobre la banda color-secondary-soft, con el anillo de foco
  // color-secondary; el mismo fondo en la caja «En esta página». Iconos de
  // trazo de las ventajas sin recuadro, en color-secondary-strong sobre el
  // fondo de la página. La línea superior del pie (color-secondary) y los
  // separadores de sus enlaces (color-neutral-200) son decorativos: sin par.
  text('color-neutral-900', 'color-secondary-soft'),
  ui('color-secondary', 'color-secondary-soft'),
  ui('color-secondary-strong', 'color-neutral-0'),
  // Verde como acción principal en toda la app (#206): orki-btn--primary
  // (color-neutral-0 sobre color-secondary-strong y, al pasar por encima,
  // sobre color-secondary, pares ya listados); chip seleccionado, opción
  // elegida del control segmentado e indicador de filtros, igual. Fondo
  // color-secondary-soft del chip al pasar por encima, de la sugerencia
  // activa del buscador, de las opciones del menú y del resultado «Sí, la
  // tienes»: texto color-neutral-900 (ya listado), texto secundario
  // color-neutral-700, acción y títulos en color-secondary-strong y el anillo
  // color-secondary (ya listados). Pestaña activa de la barra y su subrayado
  // en color-secondary-strong sobre color-neutral-0 (ya listado). Iniciales
  // del avatar en color-neutral-900 sobre color-neutral-50 (ya listado).
  text('color-neutral-700', 'color-secondary-soft'),
  // Registro con galería (#220), todo con pares ya listados: insignia de
  // coincidencia y contador de la galería en color-secondary-strong sobre
  // color-secondary-soft; recuadro de la galería color-neutral-50 (título en
  // color-secondary-strong, ayuda en color-neutral-700) o color-neutral-0 en
  // el celular; etiqueta «Principal» en color-secondary-strong y estado de la
  // miniatura en color-neutral-900 sobre color-neutral-0; con error, en
  // color-danger sobre color-danger-soft. El icono de «Guardada» va en
  // color-success sobre color-neutral-0. El borde de las miniaturas y del
  // recuadro vacío (color-neutral-200) es decorativo: sin par.
  // Galería del detalle (#183): miniatura elegida con borde
  // color-secondary-strong sobre color-neutral-0 (ya listado). Visor a
  // pantalla completa sobre color-neutral-900: título, contador, nota y
  // fecha en color-neutral-0, y el anillo de foco en color-neutral-0; los
  // botones, icono color-neutral-900 sobre color-neutral-0 (ya listado) y,
  // en un extremo, color-neutral-0 sobre color-neutral-700.
  text('color-neutral-0', 'color-neutral-900'),
  ui('color-neutral-0', 'color-neutral-900'),
  ui('color-neutral-0', 'color-neutral-700'),
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
