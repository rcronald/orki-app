import axe from 'axe-core'
import { expect } from 'vitest'

// Revisión automática de accesibilidad con axe-core: falla ante cualquier
// incumplimiento de nivel A o AA de WCAG 2.0, 2.1 y 2.2. jsdom no calcula
// colores ni tamaños, así que el contraste lo cubre src/styles/contrast.test.ts
// y aquí axe lo deja como "incompleto".
const WCAG_A_AA = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22a',
  'wcag22aa',
]

/**
 * Revisa el documento entero o, con "context", solo ese elemento: en una
 * página muy grande, axe tarda segundos con el equipo cargado (#295).
 */
export async function expectNoAxeViolations(context: Element = document.body) {
  const results = await axe.run(context, {
    runOnly: { type: 'tag', values: WCAG_A_AA },
    resultTypes: ['violations'],
  })
  const report = results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact ?? 'sin impacto'}): ${violation.help}\n` +
      violation.nodes.map((node) => `  ${node.target.join(' ')}`).join('\n'),
  )
  expect(report).toEqual([])
}
