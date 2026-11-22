import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '../../test/axe.ts'
import { FiltersButton } from './FiltersButton.tsx'
import { SearchField } from './SearchField.tsx'
import { SegmentedControl } from './SegmentedControl.tsx'

// La barra de búsqueda del inventario (#206) se compone con tres piezas:
// SearchField, FiltersButton y SegmentedControl, dentro de orki-toolbar.

type View = 'grid' | 'list'

const VIEWS = [
  { value: 'grid', label: 'Cuadrícula', icon: 'layout-grid' },
  { value: 'list', label: 'Lista', icon: 'list' },
] as const

function Toolbar({ activeCount = 0 }: { activeCount?: number }) {
  const [query, setQuery] = useState('')
  const [view, setView] = useState<View>('grid')
  return (
    <main>
      <div className="orki-toolbar">
        <SearchField
          label="Buscar en mi colección"
          hideLabel
          value={query}
          onValueChange={setQuery}
        />
        <FiltersButton activeCount={activeCount} aria-expanded={false} />
        <SegmentedControl
          label="Vista"
          options={VIEWS}
          value={view}
          onValueChange={setView}
          iconOnly
        />
      </div>
      <p>Vista actual: {view}</p>
    </main>
  )
}

beforeEach(() => {
  document.documentElement.lang = 'es'
  document.title = 'Prueba'
})

describe('FiltersButton', () => {
  it('sin filtros: icono sliders-horizontal y sin indicador', () => {
    render(<FiltersButton activeCount={0} />)

    const button = screen.getByRole('button', { name: 'Filtros' })
    expect(button).toHaveClass('orki-btn', 'orki-btn--secondary')
    expect(button.querySelector('svg')).toHaveClass('lucide-sliders-horizontal')
    expect(button.querySelector('.orki-count')).toBeNull()
  })

  it('con filtros: el número en orki-count, también para el lector', () => {
    const { rerender } = render(<FiltersButton activeCount={2} />)

    const button = screen.getByRole('button', { name: 'Filtros, 2 activos' })
    expect(button.querySelector('.orki-count')).toHaveTextContent('2')

    rerender(<FiltersButton activeCount={1} />)
    expect(
      screen.getByRole('button', { name: 'Filtros, 1 activo' }),
    ).toBeInTheDocument()
  })
})

describe('SegmentedControl', () => {
  it('grupo con nombre y una opción presionada; cambia al pulsar', async () => {
    const user = userEvent.setup()
    render(<Toolbar />)

    const group = screen.getByRole('group', { name: 'Vista' })
    expect(group).toHaveClass('orki-segmented')
    const grid = within(group).getByRole('button', { name: 'Cuadrícula' })
    const list = within(group).getByRole('button', { name: 'Lista' })
    expect(grid).toHaveAttribute('aria-pressed', 'true')
    expect(list).toHaveAttribute('aria-pressed', 'false')
    expect(grid).toHaveClass('orki-segmented__option')
    expect(grid).toHaveAttribute('title', 'Cuadrícula')

    await user.click(list)
    expect(list).toHaveAttribute('aria-pressed', 'true')
    expect(grid).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Vista actual: list')).toBeInTheDocument()
  })

  it('con el teclado: Tab llega a cada opción y Espacio la elige', async () => {
    const user = userEvent.setup()
    render(<Toolbar />)

    screen.getByRole('button', { name: 'Filtros' }).focus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Cuadrícula' })).toHaveFocus()
    await user.tab()
    await user.keyboard(' ')
    expect(screen.getByRole('button', { name: 'Lista' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('con etiquetas visibles, sin title', () => {
    render(
      <SegmentedControl
        label="Vista"
        options={VIEWS}
        value="grid"
        onValueChange={() => {}}
      />,
    )

    const grid = screen.getByRole('button', { name: 'Cuadrícula' })
    expect(grid).not.toHaveAttribute('title')
    expect(screen.getByText('Cuadrícula')).not.toHaveClass('sr-only')
  })
})

describe('barra de búsqueda del inventario', () => {
  it('no tiene fallos A ni AA, con y sin filtros', async () => {
    const { unmount } = render(<Toolbar />)
    await expectNoAxeViolations()
    unmount()

    render(<Toolbar activeCount={3} />)
    await expectNoAxeViolations()
  })
})
