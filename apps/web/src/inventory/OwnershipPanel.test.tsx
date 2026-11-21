import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollectionPlant } from '../collection/model.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import { CATTLEYA, plant } from '../test/collection.ts'
import type { OwnershipMeasurement } from './ownership-measure.ts'
import { OwnershipPanel, type OwnershipPanelProps } from './OwnershipPanel.tsx'

beforeEach(() => {
  document.documentElement.lang = 'es'
  document.title = 'Mi colección · Orki'
})

const amabilis1 = plant({ nickname: 'La blanca' })
const amabilis2 = plant()
const maxima = plant({
  displayName: 'Cattleya maxima',
  enteredName: 'Cattleya maxima',
  species: {
    id: 'species-maxima',
    scientificName: 'Cattleya maxima',
    type: 'species',
    status: 'validated',
  },
  genus: CATTLEYA,
})
const labiataLost = plant({
  displayName: 'Cattleya labiata',
  enteredName: 'Cattleya labiata',
  species: {
    id: 'species-labiata',
    scientificName: 'Cattleya labiata',
    type: 'species',
    status: 'validated',
  },
  genus: CATTLEYA,
  status: 'lost',
})
const pending = plant({
  displayName: 'Orquídea del abuelo',
  displayNameIsScientific: false,
  enteredName: 'Orquídea del abuelo',
  species: null,
  genus: CATTLEYA,
  validation: 'pending',
})

const PLANTS: readonly CollectionPlant[] = [
  amabilis1,
  amabilis2,
  maxima,
  labiataLost,
  pending,
]

function LocationProbe() {
  const location = useLocation()
  return (
    <div data-testid="location">{`${location.pathname}${location.search}`}</div>
  )
}

// El buscador de la prueba: un campo y el panel con el mismo texto.
function Harness({
  initialQuery = '',
  ...props
}: Partial<OwnershipPanelProps> & { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery)
  return (
    <>
      <label>
        Buscar
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <OwnershipPanel plants={PLANTS} query={query} {...props} />
    </>
  )
}

function renderPanel(
  props: Partial<OwnershipPanelProps> & { initialQuery?: string } = {},
) {
  return render(
    <MemoryRouter initialEntries={['/coleccion']}>
      <main>
        <Routes>
          <Route path="/coleccion" element={<Harness {...props} />} />
          <Route path="/coleccion/nueva" element={<p>Registro</p>} />
          <Route path="/coleccion/:id" element={<p>Detalle</p>} />
        </Routes>
      </main>
      <LocationProbe />
    </MemoryRouter>,
  )
}

const field = () => screen.getByRole('searchbox', { name: 'Buscar' })
const region = () => screen.getByRole('status')

describe('OwnershipPanel', () => {
  it('sin búsqueda, la región está montada y vacía', () => {
    renderPanel()
    expect(region()).toBeEmptyDOMElement()
  })

  it('responde "Sí, la tienes" mientras se escribe, sin mover el foco', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.type(field(), 'phal amab')
    expect(field()).toHaveFocus()
    expect(region()).toHaveTextContent(
      'Sí, la tienesTienes 2 ejemplares de Phalaenopsis amabilis.',
    )
    // Una sola región: la respuesta no lleva otra propia.
    expect(screen.getAllByRole('status')).toHaveLength(1)

    const list = screen.getByRole('list', { name: 'Ejemplares que coinciden' })
    const links = within(list).getAllByRole('link')
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAccessibleName(/Phalaenopsis amabilis/)
    expect(
      screen.queryByRole('link', { name: /Registrarla/ }),
    ).not.toBeInTheDocument()
    await expectNoAxeViolations()

    // Cada ejemplar lleva a su detalle.
    await user.click(within(list).getByRole('link', { name: /La blanca/ }))
    expect(screen.getByTestId('location')).toHaveTextContent(
      `/coleccion/${amabilis1.id}`,
    )
  })

  it('con un error de tipeo responde "Sí" y pide revisar', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.type(field(), 'Phalaenopsis amabils')
    expect(region()).toHaveTextContent('Sí, la tienes')
    expect(region()).toHaveTextContent(
      'No coincide exactamente: revisa si es la misma.',
    )
    expect(
      screen.getByRole('link', { name: 'No es la misma: registrarla' }),
    ).toHaveAttribute('href', '/coleccion/nueva?nombre=Phalaenopsis+amabils')
  })

  it('"Aún no la tienes" lleva al registro con el nombre puesto', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.type(field(), 'Phragmipedium  kovachii')
    expect(region()).toHaveTextContent(
      'Aún no la tienesPhragmipedium kovachii no está en tu colección.',
    )
    await user.click(
      screen.getByRole('link', { name: 'Registrarla con este nombre' }),
    )
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/coleccion/nueva?nombre=Phragmipedium+kovachii',
    )
  })

  it('una planta perdida no da un "Sí": nota aparte y su enlace', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.type(field(), 'cattleya labiata')
    expect(region()).toHaveTextContent('Aún no la tienes')
    expect(region()).toHaveTextContent('La tuviste: 1 ejemplar perdido.')
    const list = screen.getByRole('list', { name: 'Ejemplares que tuviste' })
    expect(within(list).getByRole('link')).toHaveAccessibleName(
      /Cattleya labiata.*Perdida/,
    )
    await expectNoAxeViolations()
  })

  it('un género dice cuántos ejemplares activos hay de él', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.type(field(), 'Cattleya')
    expect(region()).toHaveTextContent(
      'Sí, la tienesTienes 2 ejemplares de Cattleya.',
    )
    expect(region()).toHaveTextContent('Además, tuviste 1 ejemplar perdido.')
  })

  it('una planta por validar se encuentra por el nombre ingresado', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.type(field(), 'orquidea del abuelo')
    expect(region()).toHaveTextContent(
      'Tienes 1 ejemplar de Orquídea del abuelo.',
    )
  })

  it('con filtros en la lista, avisa de que responde sobre toda la colección', () => {
    renderPanel({ initialQuery: 'amabilis', filtered: true })
    expect(
      screen.getByText(
        'La respuesta es sobre toda tu colección, sin los filtros.',
      ),
    ).toBeInTheDocument()
  })

  it('con la colección sin cargar no responde', () => {
    render(
      <MemoryRouter>
        <OwnershipPanel plants={null} query="amabilis" />
      </MemoryRouter>,
    )
    expect(region()).toBeEmptyDOMElement()
  })

  it('mide cada respuesta mostrada, sin el texto buscado', async () => {
    const user = userEvent.setup()
    let clock = 1000
    const now = () => clock
    const onMeasure = vi.fn<(measurement: OwnershipMeasurement) => void>()
    renderPanel({ onMeasure, now })

    clock = 1000
    await user.type(field(), 'c')
    // Una letra no basta para responder.
    expect(onMeasure).not.toHaveBeenCalled()
    clock = 1040
    await user.type(field(), 'a')
    const last = onMeasure.mock.calls.at(-1)?.[0]
    expect(last).toMatchObject({
      outcome: 'owned',
      scope: 'genus',
      source: 'local',
      matchCount: 2,
      online: true,
    })
    expect(last?.durationMs).toBe(40)
    // Solo números y valores cerrados.
    expect(Object.keys(last ?? {}).sort()).toEqual([
      'computeMs',
      'durationMs',
      'matchCount',
      'online',
      'outcome',
      'scope',
      'searchId',
      'source',
    ])

    // Al vaciar el campo empieza otra búsqueda, con otro número.
    const firstId = last?.searchId
    await user.clear(field())
    clock = 2000
    await user.type(field(), 'zz')
    const next = onMeasure.mock.calls.at(-1)?.[0]
    expect(next?.outcome).toBe('not-owned')
    expect(next?.searchId).not.toBe(firstId)
  })
})
