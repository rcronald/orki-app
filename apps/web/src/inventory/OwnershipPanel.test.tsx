import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollectionPlant } from '../collection/model.ts'
import { SEARCH_DEBOUNCE_MS } from '../lib/useCatalogSearch.ts'
import {
  CatalogSearchError,
  type CatalogSearchFunction,
  type CatalogSearchOptions,
  type SpeciesSearchResult,
} from '../lib/catalogSearch.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import { CATTLEYA, plant } from '../test/collection.ts'
import { finishWait, typeWithClockStopped } from '../test/stopped-clock.ts'
import type { OwnershipMeasurement } from './ownership-measure.ts'
import { OwnershipPanel, type OwnershipPanelProps } from './OwnershipPanel.tsx'

beforeEach(() => {
  document.documentElement.lang = 'es'
  document.title = 'Mi colección · orqui.app'
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
      {/* Sin catálogo salvo que la prueba lo pida. */}
      <OwnershipPanel
        plants={PLANTS}
        query={query}
        searchSpecies={null}
        {...props}
      />
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

  it('una especie validada va en cursiva y un nombre por validar en redonda (#336)', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.type(field(), 'Cattleya maxima')
    expect(region()).toHaveTextContent('Tienes 1 ejemplar de Cattleya maxima.')
    expect(
      within(region()).getByText('Cattleya maxima').closest('em'),
    ).not.toBeNull()

    await user.clear(field())
    await user.type(field(), 'Orquídea del abuelo')
    expect(region()).toHaveTextContent(
      'Tienes 1 ejemplar de Orquídea del abuelo.',
    )
    expect(region().querySelector('em')).toBeNull()
  })

  it('"Aún no la tienes" lleva al registro con el nombre puesto', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.type(field(), 'Phragmipedium  kovachii')
    expect(region()).toHaveTextContent(
      // Lo escrito, entre comillas, como en «¿Ya la tengo?» (#336).
      'Aún no la tienes«Phragmipedium kovachii» no está en tu colección.',
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
      'startedByTyping',
    ])
    expect(last?.startedByTyping).toBe(true)

    // Al vaciar el campo empieza otra búsqueda, con otro número.
    const firstId = last?.searchId
    await user.clear(field())
    clock = 2000
    await user.type(field(), 'zz')
    const next = onMeasure.mock.calls.at(-1)?.[0]
    expect(next?.outcome).toBe('not-owned')
    expect(next?.searchId).not.toBe(firstId)
  })

  it('una búsqueda que ya venía al abrir no empezó al escribir', async () => {
    const user = userEvent.setup()
    const onMeasure = vi.fn<(measurement: OwnershipMeasurement) => void>()
    renderPanel({ onMeasure, initialQuery: 'cattleya' })
    expect(onMeasure.mock.calls.at(-1)?.[0].startedByTyping).toBe(false)

    // Seguir escribiendo es la misma búsqueda; vaciar y escribir, otra.
    await user.type(field(), ' max')
    expect(onMeasure.mock.calls.at(-1)?.[0].startedByTyping).toBe(false)
    await user.clear(field())
    await user.type(field(), 'ca')
    expect(onMeasure.mock.calls.at(-1)?.[0].startedByTyping).toBe(true)
  })
})

// Búsqueda del catálogo controlada por la prueba: cada llamada queda pendiente
// hasta que la prueba la resuelve o la rechaza.
interface PendingSearch {
  query: string
  options: CatalogSearchOptions | undefined
  resolve: (results: SpeciesSearchResult[]) => void
  reject: (error: unknown) => void
}

function fakeCatalog() {
  const calls: PendingSearch[] = []
  const search: CatalogSearchFunction<SpeciesSearchResult> = (query, options) =>
    new Promise((resolve, reject) => {
      calls.push({ query, options, resolve, reject })
    })
  return { calls, search }
}

function catalogSpecies(
  overrides: Partial<SpeciesSearchResult> = {},
): SpeciesSearchResult {
  return {
    id: 'species-amabilis',
    scientificName: 'Phalaenopsis amabilis',
    genusId: 'genus-phal',
    genusName: 'Phalaenopsis',
    type: 'species',
    status: 'validated',
    matchedName: 'Phalaenopsis grandiflora',
    matchedNameType: 'synonym',
    ...overrides,
  }
}

// La espera entre pulsaciones es de 250 ms; en un equipo cargado, más.
const LONG = { timeout: 3000 }

/**
 * Con temporizadores falsos (vi.useFakeTimers), deja pasar de sobra la espera
 * entre pulsaciones: si el panel fuera a consultar el catálogo, ya lo habría
 * hecho. Una pausa real podría no bastar con el equipo cargado (#295).
 */
async function pastTheDebounce() {
  await act(() => vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS * 4))
}

async function settle(call: PendingSearch, results: SpeciesSearchResult[]) {
  await act(async () => {
    call.resolve(results)
    await Promise.resolve()
  })
}

describe('OwnershipPanel con el catálogo (#124)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('un sinónimo de una especie que tiene pasa de "Aún no" a "Sí" cuando llega el catálogo', async () => {
    const catalog = fakeCatalog()
    const onMeasure = vi.fn<(measurement: OwnershipMeasurement) => void>()
    renderPanel({ searchSpecies: catalog.search, online: true, onMeasure })

    // Con el reloj parado entre pulsaciones (#311): con el real, una pulsación
    // lenta en un equipo cargado dejaba salir una consulta a medias.
    await typeWithClockStopped(field(), 'Phalaenopsis grandiflora')
    // La respuesta local sale primero, sin esperar a la red.
    expect(region()).toHaveTextContent('Aún no la tienes')
    expect(catalog.calls).toHaveLength(0)
    await finishWait(SEARCH_DEBOUNCE_MS)
    await waitFor(() => expect(catalog.calls).toHaveLength(1), LONG)
    expect(catalog.calls[0].query).toBe('Phalaenopsis grandiflora')

    await settle(catalog.calls[0], [catalogSpecies()])
    expect(region()).toHaveTextContent(
      'Sí, la tienesTienes 2 ejemplares de Phalaenopsis amabilis.',
    )
    const list = screen.getByRole('list', { name: 'Ejemplares que coinciden' })
    expect(
      within(list).getAllByText('Sinónimo: Phalaenopsis grandiflora', {
        exact: false,
      }),
    ).toHaveLength(2)
    expect(onMeasure.mock.calls.at(-1)?.[0]).toMatchObject({
      outcome: 'owned',
      source: 'catalog',
    })
    await expectNoAxeViolations()
  })

  it('una respuesta tardía de una consulta anterior no pisa la actual', async () => {
    const user = userEvent.setup()
    const catalog = fakeCatalog()
    renderPanel({ searchSpecies: catalog.search, online: true })

    await user.type(field(), 'Phalaenopsis grandiflora')
    await waitFor(() => expect(catalog.calls).toHaveLength(1), LONG)
    const first = catalog.calls[0]

    await user.clear(field())
    await user.type(field(), 'Phragmipedium kovachii')
    expect(first.options?.signal?.aborted).toBe(true)
    // La primera llega tarde: no cuenta para lo escrito ahora.
    await settle(first, [catalogSpecies()])
    expect(region()).toHaveTextContent(
      // Lo escrito, entre comillas, como en «¿Ya la tengo?» (#336).
      'Aún no la tienes«Phragmipedium kovachii» no está en tu colección.',
    )
    expect(region()).not.toHaveTextContent('Sí, la tienes')
  })

  it('al seguir escribiendo no parpadea: la mejora sigue mientras llega la siguiente', async () => {
    const user = userEvent.setup()
    const catalog = fakeCatalog()
    renderPanel({ searchSpecies: catalog.search, online: true })

    await user.type(field(), 'Phalaenopsis grandi')
    await waitFor(() => expect(catalog.calls).toHaveLength(1), LONG)
    await settle(catalog.calls[0], [catalogSpecies()])
    expect(region()).toHaveTextContent('Sí, la tienes')

    await user.type(field(), 'flora')
    // Aún sin la respuesta de lo nuevo, las especies anteriores siguen
    // valiendo porque corresponden a lo escrito.
    expect(region()).toHaveTextContent('Sí, la tienes')
  })

  it('sin conexión no consulta el catálogo y la respuesta local funciona igual', async () => {
    // El reloj avanza también solo, para lo que la pantalla espera sin
    // pulsaciones; pastTheDebounce() lo adelanta de golpe.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const catalog = fakeCatalog()
    renderPanel({ searchSpecies: catalog.search, online: false })

    await user.type(field(), 'Phalaenopsis grandiflora')
    expect(region()).toHaveTextContent('Aún no la tienes')
    await user.clear(field())
    await user.type(field(), 'phal amab')
    expect(region()).toHaveTextContent('Sí, la tienes')
    await pastTheDebounce()
    expect(catalog.calls).toHaveLength(0)
  })

  it('un fallo del catálogo no se muestra: queda la respuesta local', async () => {
    const user = userEvent.setup()
    const catalog = fakeCatalog()
    renderPanel({ searchSpecies: catalog.search, online: true })

    await user.type(field(), 'Phalaenopsis grandiflora')
    await waitFor(() => expect(catalog.calls).toHaveLength(1), LONG)
    await act(async () => {
      catalog.calls[0].reject(new CatalogSearchError('failed'))
      await Promise.resolve()
    })
    expect(region()).toHaveTextContent('Aún no la tienes')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      screen.queryByText(/No se pudo|Sin conexión/),
    ).not.toBeInTheDocument()
  })

  it('con un "Sí" local no consulta el catálogo', async () => {
    // El reloj avanza también solo, para lo que la pantalla espera sin
    // pulsaciones; pastTheDebounce() lo adelanta de golpe.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const catalog = fakeCatalog()
    renderPanel({ searchSpecies: catalog.search, online: true })

    await user.type(field(), 'Phalaenopsis amabilis')
    expect(region()).toHaveTextContent('Sí, la tienes')
    await pastTheDebounce()
    expect(catalog.calls).toHaveLength(0)
  })

  it('"Aún no la tienes" con el nombre del catálogo, también para registrarla', async () => {
    const user = userEvent.setup()
    const catalog = fakeCatalog()
    renderPanel({ searchSpecies: catalog.search, online: true })

    await user.type(field(), 'phrag kovachii')
    await waitFor(() => expect(catalog.calls).toHaveLength(1), LONG)
    await settle(catalog.calls[0], [
      catalogSpecies({
        id: 'species-kovachii',
        scientificName: 'Phragmipedium kovachii',
        genusName: 'Phragmipedium',
        matchedName: 'Phragmipedium kovachii',
        matchedNameType: 'scientific',
      }),
    ])
    expect(region()).toHaveTextContent(
      'Phragmipedium kovachii no está en tu colección.',
    )
    expect(
      screen.getByRole('link', { name: 'Registrarla con este nombre' }),
    ).toHaveAttribute('href', '/coleccion/nueva?nombre=Phragmipedium+kovachii')
  })
})
