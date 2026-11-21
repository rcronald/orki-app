import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ICON_NAMES } from '../components/ui/icons.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import ShowcasePage from './ShowcasePage.tsx'

beforeEach(() => {
  // Como en index.html.
  document.documentElement.lang = 'es'
})

afterEach(() => {
  vi.useRealTimers()
})

// La pantalla de inventario de la muestra lleva enlaces de React Router.
function renderShowcase() {
  return render(
    <MemoryRouter>
      <ShowcasePage />
    </MemoryRouter>,
  )
}

describe('ShowcasePage', () => {
  it('pone el título de la pestaña', () => {
    renderShowcase()
    expect(document.title).toBe('Muestra del design system · Orki')
  })

  it('muestra los tokens leídos de tokens.css con sus contrastes', () => {
    renderShowcase()

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
    renderShowcase()

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
    expect(
      screen.getAllByRole('img', { name: 'Sin foto' }).length,
    ).toBeGreaterThan(0)
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
    renderShowcase()

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
    renderShowcase()

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

  it('muestra la pantalla de inventario con datos fijos y con 300 plantas', async () => {
    const user = userEvent.setup()
    window.localStorage.clear()
    renderShowcase()

    const inventory = screen.getByRole('region', {
      name: 'Pantalla de inventario',
    })
    // 10 activas; la regalada no se cuenta.
    expect(within(inventory).getByText('10 orquídeas')).toBeInTheDocument()
    expect(within(inventory).getByText('6 géneros')).toBeInTheDocument()
    expect(within(inventory).getAllByRole('article')).toHaveLength(10)
    expect(
      within(inventory).getByRole('article', {
        name: '× Rhyncholaeliocattleya Memoria Anna Balmores',
      }),
    ).toBeInTheDocument()

    await user.click(
      within(inventory).getByRole('button', { name: '300 plantas' }),
    )
    expect(within(inventory).getAllByRole('article')).toHaveLength(300)
    expect(within(inventory).getByText('300 orquídeas')).toBeInTheDocument()

    await user.click(within(inventory).getByRole('button', { name: 'Vacía' }))
    expect(
      within(inventory).getByRole('heading', {
        name: 'Tu colección está vacía',
      }),
    ).toBeInTheDocument()
    await user.click(
      within(inventory).getByRole('button', { name: 'Sin conexión' }),
    )
    expect(within(inventory).getByRole('alert')).toHaveTextContent(
      'Sin conexión',
    )
    await expectNoAxeViolations()
  })

  it('muestra el formulario de registro con datos fijos', async () => {
    const user = userEvent.setup()
    renderShowcase()

    const section = screen.getByRole('region', {
      name: 'Formulario de registro',
    })
    await user.click(
      within(section).getByRole('button', { name: 'Ver el formulario' }),
    )
    const form = within(section).getByRole('form', {
      name: 'Registrar una orquídea',
    })
    await user.type(
      within(form).getByRole('combobox', { name: 'Nombre' }),
      'wakanki',
    )
    await user.click(
      await within(form).findByRole('option', {
        name: /^Masdevallia veitchiana,/,
      }),
    )
    expect(
      within(form).getByRole('button', { name: 'Masdevallia' }),
    ).toHaveAttribute('aria-disabled', 'true')
    await expectNoAxeViolations()

    await user.click(
      within(form).getByRole('button', { name: 'Registrar orquídea' }),
    )
    await waitFor(() =>
      expect(within(section).getByRole('status')).toHaveTextContent(
        'Guardada: «Masdevallia veitchiana», validada, sin foto.',
      ),
    )
    expect(within(section).getByText(/"species_id"/)).toBeInTheDocument()

    // Sin conexión: el formulario se ve desactivado con el motivo.
    await user.click(
      within(section).getByRole('button', { name: 'Registrar otra' }),
    )
    await user.click(
      within(section).getByRole('button', { name: 'Sin conexión' }),
    )
    expect(
      within(section).getByRole('combobox', { name: 'Nombre' }),
    ).toBeDisabled()
    await expectNoAxeViolations()
  })

  it('sin configuración de Supabase, los buscadores usan los datos fijos', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    try {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const user = userEvent.setup({
        advanceTimers: (ms) => vi.advanceTimersByTime(ms),
      })
      renderShowcase()
      expect(screen.getAllByText(/^Datos fijos/)).toHaveLength(2)

      await user.type(
        screen.getByRole('combobox', { name: 'Nombre científico' }),
        'wakanki',
      )
      await act(() => vi.advanceTimersByTimeAsync(1000))
      expect(
        screen.getByRole('option', { name: /^Masdevallia veitchiana,/ }),
      ).toBeVisible()

      await user.type(
        screen.getByRole('combobox', { name: 'Otro género' }),
        'den',
      )
      expect(screen.getByRole('option', { name: 'Dendrobium' })).toBeVisible()
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('no tiene fallos de accesibilidad A ni AA al cargar', async () => {
    renderShowcase()
    await expectNoAxeViolations()
  })

  it('no tiene fallos A ni AA con el buscador abierto y las secciones plegables abiertas', async () => {
    const user = userEvent.setup()
    renderShowcase()

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
