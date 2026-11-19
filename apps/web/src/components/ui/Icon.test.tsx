import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Icon, type IconName } from './Icon.tsx'
import { ICON_NAMES } from './icons.ts'

// Subconjunto del design system (design-system.json, assetGroups.Icons).
const SYSTEM_ICONS: readonly IconName[] = [
  'calendar',
  'camera',
  'check',
  'chevron-down',
  'chevron-right',
  'circle-check',
  'droplets',
  'flower-2',
  'image',
  'map-pin',
  'nfc',
  'pencil',
  'plus',
  'search',
  'sprout',
  'store',
  'tag',
  'trash-2',
  'triangle-alert',
  'x',
]

describe('Icon', () => {
  it('ICON_NAMES lista exactamente el subconjunto del sistema', () => {
    expect([...ICON_NAMES].sort()).toEqual([...SYSTEM_ICONS].sort())
  })

  it.each(SYSTEM_ICONS)(
    '%s: SVG en línea con currentColor y trazo de 2 px, oculto',
    (name) => {
      const { container } = render(<Icon name={name} />)

      const svg = container.querySelector('svg')
      expect(svg).not.toBeNull()
      expect(svg).toHaveAttribute('aria-hidden', 'true')
      expect(svg).toHaveAttribute('stroke', 'currentColor')
      expect(svg).toHaveAttribute('stroke-width', '2')
      expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
    },
  )

  it('dibuja los mismos trazos que el design system', () => {
    // Trazos de los preview.html (Lucide 0.460.0). lucide-react 1.x redibujó
    // circle-check (la marca interior), camera (las esquinas del cuerpo) y
    // search (el mango): mismo icono y trazo, geometría algo distinta. Se
    // comprueban los que coinciden.
    const paths = (name: IconName) =>
      Array.from(
        render(<Icon name={name} />).container.querySelectorAll('path'),
        (path) => path.getAttribute('d'),
      )

    expect(paths('check')).toEqual(['M20 6 9 17l-5-5'])
    expect(paths('plus')).toEqual(['M5 12h14', 'M12 5v14'])
    expect(paths('triangle-alert')).toEqual([
      'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3',
      'M12 9v4',
      'M12 17h.01',
    ])
  })
})
