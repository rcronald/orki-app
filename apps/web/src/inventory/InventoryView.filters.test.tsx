import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FILTERS, type PlantFilters } from '../collection/filters.ts'
import type { CollectionPlant } from '../collection/model.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import {
  CATTLEYA,
  PHALAENOPSIS,
  plant,
  RHYNCHOLAELIOCATTLEYA,
} from '../test/collection.ts'
import { InventoryView } from './InventoryView.tsx'
import { VISIBLE_OPTIONS } from './InventoryFilters.tsx'

// Filtros del inventario (#15): panel, chips activos, contadores, sin
// resultados y accesibilidad. La lógica pura está en collection/filters.test.ts
// y la URL en filter-params.test.ts y pages/CollectionPage.test.tsx.

beforeEach(() => {
  onFiltersChange.mockClear()
  document.documentElement.lang = 'es'
  document.title = 'Mi colección · Orki'
  window.localStorage.clear()
})

// Recibe cada cambio de filtros, como lo recibiría CollectionPage.
const onFiltersChange = vi.fn<(filters: PlantFilters) => void>()
const lastFilters = () => onFiltersChange.mock.lastCall?.[0]

function Harness({
  plants,
  initialFilters = DEFAULT_FILTERS,
  initialQuery = '',
}: {
  plants: readonly CollectionPlant[]
  initialFilters?: PlantFilters
  initialQuery?: string
}) {
  const [query, setQuery] = useState(initialQuery)
  const [filters, setFilters] = useState(initialFilters)
  return (
    <InventoryView
      status="ready"
      plants={plants}
      error={null}
      onRetry={() => {}}
      query={query}
      onQueryChange={setQuery}
      filters={filters}
      onFiltersChange={(next) => {
        onFiltersChange(next)
        setFilters(next)
      }}
    />
  )
}

function renderInventory(
  plants: readonly CollectionPlant[],
  props: { initialFilters?: PlantFilters; initialQuery?: string } = {},
) {
  return render(
    <MemoryRouter>
      <main>
        <Harness plants={plants} {...props} />
      </main>
    </MemoryRouter>,
  )
}

const specimen = (
  overrides: Partial<CollectionPlant> & { displayName: string },
) => plant({ enteredName: overrides.displayName, ...overrides })

const amabilis = specimen({
  displayName: 'Phalaenopsis amabilis',
  flowerColor: 'white',
  origin: 'Vivero Moyobamba',
  createdAt: '2026-11-05T10:00:00+00:00',
})
const schilleriana = specimen({
  displayName: 'Phalaenopsis schilleriana',
  flowerColor: 'pink',
  origin: 'Feria de Miraflores',
  createdAt: '2026-11-04T10:00:00+00:00',
})
const maxima = specimen({
  displayName: 'Cattleya maxima',
  genus: CATTLEYA,
  flowerColor: 'pink',
  origin: 'Vivero Moyobamba',
  createdAt: '2026-11-03T10:00:00+00:00',
})
const memoria = specimen({
  displayName: '× Rhyncholaeliocattleya Memoria Anna Balmores',
  genus: RHYNCHOLAELIOCATTLEYA,
  createdAt: '2026-11-02T10:00:00+00:00',
})
const lost = specimen({
  displayName: 'Phalaenopsis aphrodite',
  status: 'lost',
  flowerColor: 'white',
  createdAt: '2026-11-01T10:00:00+00:00',
})
const COLLECTION = [amabilis, schilleriana, maxima, memoria, lost]

const toggle = () => screen.getByRole('button', { name: /^Filtros/ })
const panel = () => {
  const element = document.getElementById(
    toggle().getAttribute('aria-controls') ?? '',
  )
  if (!element) throw new Error('Sin panel de filtros.')
  return element
}
const group = (name: string) => within(panel()).getByRole('group', { name })
const chip = (groupName: string, name: string) =>
  within(group(groupName)).getByRole('button', { name })
const activeRow = () => screen.queryByRole('group', { name: 'Filtros activos' })
const summary = () =>
  within(screen.getByRole('list', { name: 'Resumen de tu colección' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent)
const status = () => within(screen.getByRole('search')).getByRole('status')
const cardNames = () =>
  screen
    .queryAllByRole('article')
    .map((card) => card.getAttribute('aria-labelledby'))
    .map((id) => document.getElementById(id ?? '')?.textContent)

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(toggle())
  expect(toggle()).toHaveAttribute('aria-expanded', 'true')
}

describe('InventoryView: filtros', () => {
  it('el panel está cerrado y se abre y cierra con el botón, que lo controla', async () => {
    const user = userEvent.setup()
    renderInventory(COLLECTION)

    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(toggle()).toHaveAttribute('aria-controls', panel().id)
    expect(panel()).not.toBeVisible()

    await openPanel(user)
    expect(panel()).toBeVisible()
    expect(
      screen.getByRole('region', { name: 'Filtros de la colección' }),
    ).toBe(panel())
    // Grupos con nombre; el estado, con "Activas" elegido por defecto.
    expect(chip('Estado', 'Activas')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('Estado', 'Perdidas')).toHaveAttribute('aria-pressed', 'false')
    expect(
      within(group('Género'))
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Cattleya', 'Phalaenopsis', '× Rhyncholaeliocattleya'])
    expect(
      within(group('Color de la flor'))
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Blanco', 'Rosado'])
    // Orígenes por uso: Moyobamba tiene dos plantas.
    expect(
      within(group('Origen'))
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Vivero Moyobamba', 'Feria de Miraflores'])
    await expectNoAxeViolations()

    await user.click(toggle())
    expect(panel()).not.toBeVisible()
  })

  it('"Listo" y Escape cierran el panel y devuelven el foco al botón', async () => {
    const user = userEvent.setup()
    renderInventory(COLLECTION)

    await openPanel(user)
    await user.click(within(panel()).getByRole('button', { name: 'Listo' }))
    expect(panel()).not.toBeVisible()
    expect(toggle()).toHaveFocus()

    await openPanel(user)
    // Con el teclado: del botón se pasa al panel, que le sigue.
    await user.tab()
    expect(chip('Estado', 'Activas')).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(panel()).not.toBeVisible()
    expect(toggle()).toHaveFocus()
  })

  it('cada filtro reduce la lista y actualiza los contadores', async () => {
    const user = userEvent.setup()
    renderInventory(COLLECTION)
    expect(summary()).toEqual(['4 orquídeas', '3 géneros'])
    expect(status()).toBeEmptyDOMElement()

    await openPanel(user)
    await user.click(chip('Género', 'Phalaenopsis'))
    expect(chip('Género', 'Phalaenopsis')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(cardNames()).toEqual([
      'Phalaenopsis amabilis',
      'Phalaenopsis schilleriana',
    ])
    expect(summary()).toEqual(['2 de 4 orquídeas', '1 género'])
    expect(status()).toHaveTextContent('2 de 4 orquídeas coinciden.')
    expect(toggle()).toHaveAccessibleName('Filtros, 1 activo')

    // Selección múltiple: O dentro del grupo.
    await user.click(chip('Género', 'Cattleya'))
    expect(summary()).toEqual(['3 de 4 orquídeas', '2 géneros'])

    // Y entre grupos.
    await user.click(chip('Color de la flor', 'Rosado'))
    expect(cardNames()).toEqual([
      'Phalaenopsis schilleriana',
      'Cattleya maxima',
    ])
    await user.click(chip('Origen', 'Vivero Moyobamba'))
    expect(cardNames()).toEqual(['Cattleya maxima'])
    expect(status()).toHaveTextContent('1 de 4 orquídeas coincide.')
    expect(toggle()).toHaveAccessibleName('Filtros, 4 activos')
    expect(lastFilters()).toEqual({
      status: 'active',
      genera: [PHALAENOPSIS.id, CATTLEYA.id],
      colors: ['pink'],
      origins: ['vivero moyobamba'],
    })
    await expectNoAxeViolations()
  })

  it('al filtrar por color no aparecen los ejemplares sin color', async () => {
    const user = userEvent.setup()
    renderInventory(COLLECTION)
    await openPanel(user)
    await user.click(chip('Color de la flor', 'Blanco'))
    expect(cardNames()).toEqual(['Phalaenopsis amabilis'])
  })

  it('el estado elige uno y muestra las dadas de baja', async () => {
    const user = userEvent.setup()
    renderInventory(COLLECTION)
    await openPanel(user)

    await user.click(chip('Estado', 'Perdidas'))
    expect(chip('Estado', 'Perdidas')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('Estado', 'Activas')).toHaveAttribute('aria-pressed', 'false')
    expect(cardNames()).toEqual(['Phalaenopsis aphrodite'])
    expect(summary()).toEqual(['1 orquídea perdida', '1 género'])
    expect(status()).toHaveTextContent('1 orquídea perdida.')

    await user.click(chip('Estado', 'Regaladas'))
    expect(cardNames()).toEqual([])
    // Lo dicen la región de estado y el panel de resultados.
    expect(screen.getAllByText('No tienes orquídeas regaladas.')).toHaveLength(
      2,
    )
    await expectNoAxeViolations()
  })

  it('los filtros se combinan con la búsqueda', async () => {
    const user = userEvent.setup()
    renderInventory(COLLECTION, { initialQuery: 'phal' })
    expect(summary()).toEqual(['2 de 4 orquídeas', '1 género'])

    await openPanel(user)
    await user.click(chip('Color de la flor', 'Rosado'))
    expect(cardNames()).toEqual(['Phalaenopsis schilleriana'])
    expect(summary()).toEqual(['1 de 4 orquídeas', '1 género'])
  })

  it('con el panel cerrado, los filtros activos se ven en chips que se quitan uno a uno', async () => {
    const user = userEvent.setup()
    renderInventory(COLLECTION, {
      initialFilters: {
        status: 'active',
        genera: [PHALAENOPSIS.id],
        colors: ['pink'],
        origins: [],
      },
    })
    const row = activeRow()
    expect(row).not.toBeNull()
    const remove = (name: string) =>
      within(activeRow() ?? document.body).getByRole('button', { name })

    expect(cardNames()).toEqual(['Phalaenopsis schilleriana'])
    await user.click(remove('Quitar el filtro Género: Phalaenopsis'))
    expect(cardNames()).toEqual([
      'Phalaenopsis schilleriana',
      'Cattleya maxima',
    ])
    // El foco pasa al chip que queda.
    expect(remove('Quitar el filtro Color de la flor: Rosado')).toHaveFocus()

    await user.click(remove('Quitar el filtro Color de la flor: Rosado'))
    expect(activeRow()).toBeNull()
    expect(toggle()).toHaveFocus()
    expect(toggle()).toHaveAccessibleName('Filtros')
    expect(summary()).toEqual(['4 orquídeas', '3 géneros'])
  })

  it('"Quitar filtros" los quita todos de una vez', async () => {
    const user = userEvent.setup()
    renderInventory(COLLECTION, {
      initialFilters: {
        status: 'lost',
        genera: [PHALAENOPSIS.id],
        colors: ['white'],
        origins: [],
      },
    })
    expect(
      within(activeRow() ?? document.body)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Perdidas', 'Phalaenopsis', 'Blanco', 'Quitar filtros'])
    await expectNoAxeViolations()

    await user.click(
      within(activeRow() ?? document.body).getByRole('button', {
        name: 'Quitar filtros',
      }),
    )
    expect(lastFilters()).toEqual(DEFAULT_FILTERS)
    expect(activeRow()).toBeNull()
    expect(toggle()).toHaveFocus()
    expect(cardNames()).toHaveLength(4)
  })

  it('sin resultados ofrece quitar los filtros y limpiar la búsqueda', async () => {
    const user = userEvent.setup()
    renderInventory(COLLECTION, {
      initialQuery: 'maxima',
      initialFilters: { ...DEFAULT_FILTERS, colors: ['white'] },
    })
    expect(cardNames()).toEqual([])
    expect(
      screen.getByText(/Ninguna orquídea de tu colección coincide con/),
    ).toHaveTextContent('«maxima» con los filtros elegidos.')
    expect(status()).toHaveTextContent('Ninguna de tus 4 orquídeas coincide.')
    await expectNoAxeViolations()

    const results = screen.getByText(/Ninguna orquídea/).parentElement
    if (!results) throw new Error('Sin panel de resultados.')
    await user.click(
      within(results).getByRole('button', { name: 'Quitar filtros' }),
    )
    expect(toggle()).toHaveFocus()
    expect(cardNames()).toEqual(['Cattleya maxima'])
  })

  it('solo con filtros, sin resultados, ofrece quitarlos y no limpiar la búsqueda', () => {
    renderInventory(COLLECTION, {
      initialFilters: {
        ...DEFAULT_FILTERS,
        genera: [RHYNCHOLAELIOCATTLEYA.id],
        colors: ['white'],
      },
    })
    expect(
      screen.getByText(
        'Ninguna orquídea de tu colección coincide con los filtros elegidos.',
      ),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Limpiar la búsqueda' }),
    ).toBeNull()
  })

  it('ignora los valores que no están en la colección', () => {
    renderInventory(COLLECTION, {
      initialFilters: {
        status: 'active',
        genera: ['genero-borrado'],
        colors: [],
        origins: ['vivero que ya no está'],
      },
    })
    expect(cardNames()).toHaveLength(4)
    expect(toggle()).toHaveAccessibleName('Filtros')
    expect(activeRow()).toBeNull()
  })

  it('un grupo sin opciones no aparece', async () => {
    const user = userEvent.setup()
    renderInventory([memoria])
    await openPanel(user)
    expect(
      within(panel()).queryByRole('group', { name: 'Color de la flor' }),
    ).toBeNull()
    expect(within(panel()).queryByRole('group', { name: 'Origen' })).toBeNull()
    expect(group('Género')).toBeInTheDocument()
  })

  it('con muchos orígenes enseña los primeros y "Ver más", y conserva los elegidos', async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: VISIBLE_OPTIONS + 4 }, (_, index) =>
      specimen({
        displayName: `Phalaenopsis ejemplar ${index}`,
        // Todos con una planta: van en orden alfabético.
        origin: `Vivero ${String(index).padStart(2, '0')}`,
      }),
    )
    const last = 'Vivero 11'
    renderInventory(many, {
      initialFilters: { ...DEFAULT_FILTERS, origins: ['vivero 11'] },
    })
    await openPanel(user)
    const origins = () =>
      within(group('Origen'))
        .getAllByRole('button')
        .map((button) => button.textContent)
    expect(origins()).toHaveLength(VISIBLE_OPTIONS + 1)
    expect(origins()).toContain(last)

    const more = within(panel()).getByRole('button', { name: 'Ver 3 más' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    await user.click(more)
    expect(origins()).toHaveLength(VISIBLE_OPTIONS + 4)
    expect(
      within(panel()).getByRole('button', { name: 'Ver menos' }),
    ).toHaveFocus()
    await expectNoAxeViolations()
  })

  it('con 300 plantas filtra y quita los filtros', async () => {
    const genera = [PHALAENOPSIS, CATTLEYA, RHYNCHOLAELIOCATTLEYA]
    const many = Array.from({ length: 300 }, (_, index) =>
      specimen({
        displayName: `${genera[index % 3]?.name ?? ''} ejemplar ${index}`,
        genus: genera[index % 3] ?? PHALAENOPSIS,
        flowerColor: index % 2 ? 'white' : 'pink',
        origin: `Vivero ${index % 15}`,
      }),
    )
    const user = userEvent.setup()
    renderInventory(many)
    await openPanel(user)
    await user.click(chip('Género', 'Cattleya'))
    await user.click(chip('Color de la flor', 'Blanco'))
    expect(summary()).toEqual(['50 de 300 orquídeas', '1 género'])
    await user.click(
      within(panel()).getByRole('button', { name: 'Quitar filtros' }),
    )
    expect(screen.getAllByRole('article')).toHaveLength(300)
  })

  it('con solo plantas dadas de baja, los filtros permiten verlas', async () => {
    const user = userEvent.setup()
    renderInventory([lost])
    expect(
      screen.getByRole('heading', { name: 'No tienes orquídeas activas' }),
    ).toBeInTheDocument()
    // Sin la invitación del estado vacío: bastan los accesos de la cabecera
    // (registrar y registrar con foto).
    expect(
      screen
        .getAllByRole('link', { name: /Registrar/ })
        .map((link) => link.getAttribute('aria-label') ?? link.textContent),
    ).toEqual(['Registrar orquídea', 'Registrar con foto'])
    await openPanel(user)
    await user.click(chip('Estado', 'Perdidas'))
    expect(cardNames()).toEqual(['Phalaenopsis aphrodite'])
  })
})
