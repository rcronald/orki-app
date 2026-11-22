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

// La página de muestra pinta todos los componentes y pantallas a la vez: con
// el equipo cargado (o en el CI) una prueba que además escribe en ella no
// cabe en los 5 s por defecto.
vi.setConfig({ testTimeout: 20_000 })

describe('ShowcasePage', () => {
  it('pone el título de la pestaña', () => {
    renderShowcase()
    expect(document.title).toBe('Muestra del design system · orqui.app')
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
    expect(screen.getAllByText('Sí, la tienes').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Aún no la tienes').length).toBeGreaterThan(0)
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

  it('muestra las piezas de «Mi colección» (#206) sin fallos A ni AA', async () => {
    const user = userEvent.setup()
    renderShowcase()

    const section = screen.getByRole('region', {
      name: 'Mi colección y ¿Ya la tengo?: piezas',
    })
    expect(
      within(section).getByRole('navigation', { name: 'Principal' }),
    ).toBeInTheDocument()
    expect(
      within(section).getByRole('heading', { name: 'Mi colección' }),
    ).toHaveClass('orki-pagehead__title')
    const grid = within(section).getByRole('button', { name: 'Cuadrícula' })
    expect(grid).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(section).getByRole('button', { name: 'Lista' }))
    expect(grid).toHaveAttribute('aria-pressed', 'false')
    const genera = within(section).getByRole('group', {
      name: 'Accesos por género',
    })
    expect(genera).toHaveClass('orki-chips--scroll')
    await user.click(within(genera).getByRole('button', { name: 'Vanda' }))
    expect(
      within(genera).getByRole('button', { name: 'Vanda' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(within(section).getAllByRole('article')).toHaveLength(5)
    expect(within(section).getAllByRole('status')).toHaveLength(4)
    await user.click(within(section).getByRole('button', { name: 'Tu cuenta' }))
    expect(
      within(section).getByRole('menu', { name: 'Tu cuenta' }),
    ).toBeInTheDocument()
    await expectNoAxeViolations()
  })

  it('muestra las piezas de «Tu cuenta» (#213) sin fallos A ni AA', async () => {
    renderShowcase()

    const section = screen.getByRole('region', { name: 'Tu cuenta: piezas' })
    expect(section.querySelectorAll('.orki-avatar')).toHaveLength(8)
    expect(
      within(section).getByRole('region', { name: 'Eliminar cuenta' }),
    ).toHaveClass('orki-panel--danger')
    expect(
      within(section).getByRole('button', { name: 'Eliminar mi cuenta' }),
    ).toHaveClass('orki-btn--danger-outline')
    expect(
      within(section).getByRole('link', { name: /^Aviso de privacidad/ }),
    ).toHaveAttribute('href', '/privacidad')
    expect(
      within(section).getByRole('button', {
        name: 'Editar perfil Necesitas conexión para editar tu perfil.',
      }),
    ).toHaveAttribute('aria-disabled', 'true')
    await expectNoAxeViolations()
  })

  it('los chips alternan al pulsarlos', async () => {
    const user = userEvent.setup()
    renderShowcase()

    // La sección de chips va antes que la pantalla de inventario, que tiene
    // su propia fila «Género».
    const [genus] = screen.getAllByRole('group', { name: 'Género' })
    if (!genus) throw new Error('Sin chips de género.')
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
    expect(
      within(inventory).getByText('10 ejemplares · 6 géneros'),
    ).toBeInTheDocument()
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
    expect(
      within(inventory).getByText(/^300 ejemplares · \d+ géneros$/),
    ).toBeInTheDocument()

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
