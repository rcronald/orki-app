// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseTokens, readDeclarations } from './tokens.ts'

const tokensCss = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')
const tokens = parseTokens(tokensCss)
const names = (list: readonly { name: string }[]) => list.map((t) => t.name)

describe('parseTokens con tokens.css', () => {
  it('lee los colores, incluidos los añadidos de la app y el velo', () => {
    expect(names(tokens.colors)).toEqual([
      'color-primary',
      'color-primary-soft',
      'color-secondary',
      'color-success',
      'color-warning',
      'color-danger',
      'color-danger-soft',
      'color-neutral-0',
      'color-neutral-50',
      'color-neutral-700',
      'color-neutral-900',
      'overlay-genus',
    ])
    expect(tokens.colors[0]).toEqual({
      name: 'color-primary',
      value: '#d52e66',
    })
    expect(tokens.colors.at(-1)?.value).toBe('rgba(255, 252, 247, 0.85)')
  })

  it('lee los estilos de texto con su interlineado y peso', () => {
    expect(names(tokens.textStyles)).toEqual([
      'text-display',
      'text-xl',
      'text-lg',
      'text-md',
      'text-sm',
      'text-xs',
    ])
    expect(tokens.textStyles[1]).toEqual({
      name: 'text-xl',
      fontSize: '22px',
      lineHeight: '28px',
      fontWeight: '600',
    })
  })

  it('lee familias, espaciado, radios, sombra y movimiento', () => {
    expect(names(tokens.families)).toEqual(['font-display', 'font-body'])
    expect(tokens.spacing.map((t) => t.value)).toEqual([
      '4px',
      '8px',
      '12px',
      '16px',
      '24px',
      '32px',
    ])
    expect(names(tokens.radii)).toEqual([
      'radius-sm',
      'radius-md',
      'radius-lg',
      'radius-pill',
    ])
    expect(tokens.shadows).toEqual([
      { name: 'shadow-card', value: '0 2px 8px rgba(31, 31, 31, 0.08)' },
    ])
    expect(tokens.motion).toEqual([
      { name: 'motion-bg', value: '300ms ease-in-out' },
    ])
  })
})

describe('readDeclarations', () => {
  it('ignora comentarios, vaciados de Tailwind y variables puente', () => {
    const css = `
      /* --color-falso: #000000; */
      @theme static { --color-*: initial; --color-a: #112233; }
      @theme inline { --spacing-space-1: var(--space-1); }
    `
    expect(readDeclarations(css)).toEqual([
      { name: 'color-a', value: '#112233' },
    ])
  })
})
