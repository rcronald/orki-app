import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ICON_NAMES } from '../components/ui/icons.ts'
import ShowcasePage from './ShowcasePage.tsx'

// Revisión automática de accesibilidad de la página de muestra con axe-core:
// falla ante cualquier incumplimiento de nivel A o AA de WCAG 2.0, 2.1 y 2.2.
// jsdom no calcula colores ni tamaños, así que el contraste lo cubre
// src/styles/contrast.test.ts y aquí axe lo deja como "incompleto".
const WCAG_A_AA = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22a',
  'wcag22aa',
]

async function expectNoAxeViolations() {
  const results = await axe.run(document, {
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

beforeEach(() => {
  // Como en index.html.
  document.documentElement.lang = 'es'
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ShowcasePage', () => {
  it('pone el título de la pestaña', () => {
    render(<ShowcasePage />)
    expect(document.title).toBe('Muestra del design system · Orki')
  })

  it('muestra los tokens leídos de tokens.css con sus contrastes', () => {
    render(<ShowcasePage />)

    const colors = screen.getByRole('region', { name: 'Color' })
    expect(within(colors).getByText('color-primary')).toBeInTheDocument()
    expect(within(colors).getByText('#d52e66')).toBeInTheDocument()
    expect(within(colors).getByText('color-danger-soft')).toBeInTheDocument()
    expect(within(colors).getByText('overlay-genus')).toBeInTheDocument()
    // Botón primario: color-neutral-0 sobre color-primary, 4.65:1.
    expect(within(colors).getAllByText('4.65:1').length).toBeGreaterThan(0)

    const type = screen.getByRole('region', { name: 'Tipografía' })
    expect(within(type).getByText('Mi colección')).toBeInTheDocument()
    expect(within(type).getByText('Agregada hace 3 días')).toBeInTheDocument()

    const space = screen.getByRole('region', {
      name: 'Espaciado, radios y sombra',
    })
    for (const name of ['space-6', 'radius-pill', 'shadow-card', 'motion-bg']) {
      expect(within(space).getByText(name)).toBeInTheDocument()
    }
  })

  it('muestra todos los componentes y sus variantes', () => {
    render(<ShowcasePage />)

    const icons = screen.getByRole('region', { name: 'Iconos' })
    for (const name of ICON_NAMES) {
      expect(within(icons).getByText(name)).toBeInTheDocument()
    }

    const buttons = screen.getByRole('region', { name: 'Botones' })
    expect(
      within(buttons).getByRole('button', { name: 'Registrar orquídea' }),
    ).toHaveClass('orki-btn--primary')
    expect(
      within(buttons).getByRole('button', { name: 'Borrar ejemplar' }),
    ).toHaveClass('orki-btn--danger')
    const [blockSave, disabledSave] = within(buttons).getAllByRole('button', {
      name: 'Guardar',
    })
    expect(blockSave).toHaveClass('orki-btn--primary', 'orki-btn--block')
    expect(disabledSave).toBeDisabled()
    expect(
      within(buttons).getAllByRole('button', { name: 'Borrar' }).at(-1),
    ).toBeDisabled()

    expect(
      screen.getByRole('textbox', { name: 'Fecha de compra' }),
    ).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getAllByText('Validada').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Nombre por validar').length).toBeGreaterThan(0)
    expect(screen.getByRole('img', { name: 'Sin foto' })).toBeInTheDocument()
    expect(screen.getByText('Sí, la tienes')).toBeInTheDocument()
    expect(screen.getByText('Aún no la tienes')).toBeInTheDocument()
    expect(
      screen.getByRole('combobox', { name: 'Nombre científico' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Más detalles' }),
    ).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.getByRole('button', { name: 'Notas de floración' }),
    ).toHaveAttribute('aria-expanded', 'true')
  })

  it('los chips alternan al pulsarlos', async () => {
    const user = userEvent.setup()
    render(<ShowcasePage />)

    const genus = screen.getByRole('group', { name: 'Género' })
    const cattleya = within(genus).getByRole('button', { name: 'Cattleya' })
    expect(cattleya).toHaveAttribute('aria-pressed', 'false')
    await user.click(cattleya)
    expect(cattleya).toHaveAttribute('aria-pressed', 'true')
    await user.click(cattleya)
    expect(cattleya).toHaveAttribute('aria-pressed', 'false')

    const state = screen.getByRole('group', { name: 'Estado de la planta' })
    await user.click(within(state).getByRole('button', { name: 'Perdida' }))
    expect(
      within(state).getByRole('button', { name: 'Perdida' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      within(state).getByRole('button', { name: 'Activa' }),
    ).toHaveAttribute('aria-pressed', 'false')
  })

  it('el buscador científico muestra la carga y luego las sugerencias', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({
      advanceTimers: (ms) => vi.advanceTimersByTime(ms),
    })
    render(<ShowcasePage />)

    const input = screen.getByRole('combobox', { name: 'Nombre científico' })
    await user.type(input, 'phal')
    expect(screen.getByText('Buscando…')).toBeVisible()

    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(
      screen.getByRole('option', { name: /^Phalaenopsis amabilis,/ }),
    ).toBeVisible()
    expect(
      screen.getByRole('option', {
        name: 'No la encuentro: guardarla con este nombre',
      }),
    ).toBeVisible()

    await user.keyboard('{ArrowDown}{Enter}')
    expect(input).toHaveValue('Phalaenopsis amabilis')
    expect(
      screen.getByText('Elegiste Phalaenopsis amabilis.'),
    ).toBeInTheDocument()
  })

  it('no tiene fallos de accesibilidad A ni AA al cargar', async () => {
    render(<ShowcasePage />)
    await expectNoAxeViolations()
  })

  it('no tiene fallos A ni AA con el buscador abierto y las secciones plegables abiertas', async () => {
    const user = userEvent.setup()
    render(<ShowcasePage />)

    await user.click(screen.getByRole('button', { name: 'Más detalles' }))
    // El buscador va al final: al salir del campo, la lista se cierra.
    await user.type(
      screen.getByRole('combobox', { name: 'Lugar de compra' }),
      'lima',
    )
    await user.keyboard('{ArrowDown}')
    expect(
      screen.getByRole('listbox', { name: 'Lugar de compra' }),
    ).toBeVisible()
    expect(screen.getByText('Riego')).toBeVisible()

    await expectNoAxeViolations()
  })
})
