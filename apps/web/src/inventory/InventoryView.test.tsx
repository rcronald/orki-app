import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FILTERS, type PlantFilters } from '../collection/filters.ts'
import { toCollectionPlant, type CollectionPlant } from '../collection/model.ts'
import type { OwnershipExtras } from '../collection/ownership.ts'
import { CollectionLoadError } from '../collection/source.ts'
import type { CollectionStatus } from '../collection/store.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import {
  CATTLEYA,
  PHALAENOPSIS,
  plant,
  plantRow,
  RHYNCHOLAELIOCATTLEYA,
  speciesNamed,
} from '../test/collection.ts'
import { InventoryView } from './InventoryView.tsx'
import { PREFERENCES_KEY } from './preferences.ts'

beforeEach(() => {
  document.documentElement.lang = 'es'
  document.title = 'Mi colección · orqui.apps'
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

interface Props {
  status?: CollectionStatus
  error?: CollectionLoadError | null
  onRetry?: () => void
  initialQuery?: string
  initialFilters?: PlantFilters
  extras?: OwnershipExtras
}

// La vista con el buscador y los filtros controlados por un estado local, como
// lo hace CollectionPage con la URL.
function Harness({
  plants,
  status,
  error = null,
  onRetry = () => {},
  initialQuery = '',
  initialFilters = DEFAULT_FILTERS,
  extras,
}: Props & { plants: readonly CollectionPlant[] | null }) {
  const [query, setQuery] = useState(initialQuery)
  const [filters, setFilters] = useState(initialFilters)
  return (
    <InventoryView
      status={status ?? (plants === null ? 'loading' : 'ready')}
      plants={plants}
      error={error}
      onRetry={onRetry}
      query={query}
      onQueryChange={setQuery}
      filters={filters}
      onFiltersChange={setFilters}
      extras={extras}
    />
  )
}

function renderInventory(
  plants: readonly CollectionPlant[] | null,
  props: Props = {},
) {
  const tree = (current: readonly CollectionPlant[] | null, extra: Props) => (
    <MemoryRouter>
      <main>
        <Harness plants={current} {...props} {...extra} />
      </main>
    </MemoryRouter>
  )
  const result = render(tree(plants, {}))
  return {
    ...result,
    rerenderWith: (
      next: readonly CollectionPlant[] | null,
      extra: Props = {},
    ) => {
      result.rerender(tree(next, extra))
    },
  }
}

// Planta de prueba con el nombre ingresado y el de su especie iguales al
// mostrado (plant() deja "Phalaenopsis amabilis" por defecto, que el buscador
// también mira: los campos de la planta y, como "¿Ya la tengo?", el nombre
// científico de su especie).
function specimen(
  overrides: Partial<CollectionPlant> & { displayName: string },
): CollectionPlant {
  return plant({
    enteredName: overrides.displayName,
    species: speciesNamed(overrides.displayName),
    ...overrides,
  })
}

// Colección de ejemplo: dos Phalaenopsis, una Cattleya, un híbrido de género
// híbrido, una planta por validar y una perdida que no cuenta.
const amabilis = specimen({
  displayName: 'Phalaenopsis amabilis',
  createdAt: '2026-11-01T10:00:00+00:00',
  nickname: 'La blanca',
})
const schilleriana = specimen({
  displayName: 'Phalaenopsis schilleriana',
  createdAt: '2026-11-05T10:00:00+00:00',
})
const maxima = specimen({
  displayName: 'Cattleya maxima',
  genus: CATTLEYA,
  createdAt: '2026-10-01T10:00:00+00:00',
})
const memoria = specimen({
  displayName: '× Rhyncholaeliocattleya Memoria Anna Balmores',
  genus: RHYNCHOLAELIOCATTLEYA,
  type: 'hybrid',
  createdAt: '2026-11-10T10:00:00+00:00',
})
const pending = specimen({
  displayName: 'la naranja del mercado',
  displayNameIsScientific: false,
  enteredName: 'la naranja del mercado',
  species: null,
  genus: CATTLEYA,
  validation: 'pending',
  createdAt: '2026-09-01T10:00:00+00:00',
})
const lost = specimen({
  displayName: 'Phalaenopsis aphrodite',
  status: 'lost',
  createdAt: '2026-11-15T10:00:00+00:00',
})
const COLLECTION = [amabilis, schilleriana, maxima, memoria, pending, lost]

const cardNames = () =>
  screen
    .getAllByRole('article')
    .map((card) => card.getAttribute('aria-labelledby'))
    .map((id) => document.getElementById(id ?? '')?.textContent)

describe('InventoryView', () => {
  it('cuenta solo las orquídeas activas y sus géneros, en singular y en plural', () => {
    const { unmount } = renderInventory(COLLECTION)
    const summary = screen.getByRole('list', {
      name: 'Resumen de tu colección',
    })
    expect(
      within(summary)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['5 orquídeas', '3 géneros'])
    expect(screen.getAllByRole('article')).toHaveLength(5)
    unmount()

    renderInventory([amabilis])
    expect(
      within(
        screen.getByRole('list', { name: 'Resumen de tu colección' }),
      ).getAllByRole('listitem')[0],
    ).toHaveTextContent('1 orquídea')
    expect(screen.getByText('1 género')).toBeInTheDocument()
  })

  it('sin agrupar, las más recientes primero', () => {
    renderInventory(COLLECTION)
    expect(cardNames()).toEqual([
      '× Rhyncholaeliocattleya Memoria Anna Balmores',
      'Phalaenopsis schilleriana',
      'Phalaenopsis amabilis',
      'Cattleya maxima',
      'la naranja del mercado',
    ])
  })

  it('agrupa por género con su contador y en orden alfabético', async () => {
    const user = userEvent.setup()
    renderInventory(COLLECTION)

    const toggle = screen.getByRole('button', { name: 'Agrupar por género' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')

    // El signo "×" no cuenta para ordenar: el híbrido va con la R.
    // El contador se lee con el género: "Cattleya, 2 orquídeas".
    const headings = screen.getAllByRole('heading', { level: 2 })
    expect(headings).toEqual([
      screen.getByRole('heading', { name: 'Cattleya, 2 orquídeas' }),
      screen.getByRole('heading', { name: 'Phalaenopsis, 2 orquídeas' }),
      screen.getByRole('heading', {
        name: '× Rhyncholaeliocattleya, 1 orquídea',
      }),
    ])
    const cattleya = screen.getByRole('region', {
      name: 'Cattleya, 2 orquídeas',
    })
    expect(
      within(cattleya)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(['Cattleya maxima', 'la naranja del mercado'])
    expect(cardNames()).toEqual([
      'Cattleya maxima',
      'la naranja del mercado',
      'Phalaenopsis amabilis',
      'Phalaenopsis schilleriana',
      '× Rhyncholaeliocattleya Memoria Anna Balmores',
    ])
  })

  it('una planta por validar o no identificable se ve con su nombre ingresado, sin cursiva, y su propia etiqueta', () => {
    const unidentifiable = specimen({
      displayName: 'regalo de la abuela',
      displayNameIsScientific: false,
      enteredName: 'regalo de la abuela',
      species: null,
      validation: 'unidentifiable',
    })
    renderInventory([pending, unidentifiable, maxima])

    for (const [name, label] of [
      ['la naranja del mercado', 'Nombre por validar'],
      ['regalo de la abuela', 'No identificable'],
    ] as const) {
      const card = screen.getByRole('article', { name })
      expect(within(card).getByRole('heading', { name })).toHaveClass(
        'not-italic',
        'font-body',
      )
      expect(within(card).getByText(label)).toBeInTheDocument()
    }
    // Se distinguen: la no identificable no dice "por validar".
    expect(
      within(
        screen.getByRole('article', { name: 'regalo de la abuela' }),
      ).queryByText('Nombre por validar'),
    ).toBeNull()
    const validated = screen.getByRole('article', { name: 'Cattleya maxima' })
    expect(within(validated).getByText('Validada')).toBeInTheDocument()
    expect(within(validated).getByText('Cattleya maxima')).toHaveClass('italic')
  })

  it('al enlazarla a una especie se ve validada con el nombre del catálogo y conserva el ingresado (#12)', async () => {
    const user = userEvent.setup()
    const row = plantRow({
      id: 'planta-naranja',
      entered_name: 'la naranja del mercado',
      species: null,
      validation: 'pending',
      type: 'unknown',
      genus: CATTLEYA,
      nickname: null,
    })
    const { rerenderWith } = renderInventory([toCollectionPlant(row)])
    const before = screen.getByRole('article', {
      name: 'la naranja del mercado',
    })
    expect(within(before).getByText('Nombre por validar')).toBeInTheDocument()

    // Lo que devuelve la base cuando un administrador la enlaza (#22): la
    // especie, validada, con el género y el tipo de la especie; el nombre
    // ingresado no cambia.
    const linked = toCollectionPlant({
      ...row,
      species: {
        id: 'species-maxima',
        scientific_name: 'Cattleya maxima',
        type: 'species',
        status: 'validated',
      },
      validation: 'validated',
      type: 'species',
    })
    expect(linked.enteredName).toBe('la naranja del mercado')
    rerenderWith([linked])

    const after = screen.getByRole('article', { name: 'Cattleya maxima' })
    expect(within(after).getByText('Validada')).toBeInTheDocument()
    expect(within(after).getByText('Cattleya maxima')).toHaveClass('italic')
    expect(within(after).queryByText('Nombre por validar')).toBeNull()
    // Se sigue encontrando por el nombre que ingresó.
    await user.type(
      screen.getByRole('searchbox', { name: 'Buscar en tu colección' }),
      'naranja',
    )
    expect(
      await screen.findByRole('article', { name: 'Cattleya maxima' }),
    ).toBeInTheDocument()
  })

  it('un híbrido conserva el "×" en redonda y muestra género y apodo', () => {
    renderInventory([memoria, amabilis])

    const hybrid = screen.getByRole('article', {
      name: '× Rhyncholaeliocattleya Memoria Anna Balmores',
    })
    expect(within(hybrid).getByText('×')).toHaveClass('not-italic')
    expect(within(hybrid).getByText('Memoria Anna Balmores')).toHaveClass(
      'not-italic',
    )
    expect(
      within(hybrid).getByText('× Rhyncholaeliocattleya', {
        selector: '.orki-card__meta',
      }),
    ).toBeInTheDocument()

    const withNickname = screen.getByRole('article', {
      name: 'Phalaenopsis amabilis',
    })
    expect(within(withNickname).getByText('La blanca')).toBeInTheDocument()
    expect(
      within(withNickname).getByText(PHALAENOPSIS.name, {
        selector: '.orki-card__meta',
      }),
    ).toBeInTheDocument()
    // Sin foto todavía (#10): el marcador neutro, con carga diferida.
    expect(
      within(withNickname).getByRole('img', { name: 'Sin foto' }),
    ).toHaveAttribute('loading', 'lazy')
  })

  it('cambia entre lista y cuadrícula y lo recuerda al volver', async () => {
    const user = userEvent.setup()
    const { unmount } = renderInventory(COLLECTION)

    const view = screen.getByRole('group', { name: 'Vista' })
    const list = within(view).getByRole('button', { name: 'Lista' })
    const grid = within(view).getByRole('button', { name: 'Cuadrícula' })
    expect(list).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('article')[0]).toHaveClass('flex-row')

    await user.click(grid)
    expect(grid).toHaveAttribute('aria-pressed', 'true')
    expect(list).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getAllByRole('article')[0]).not.toHaveClass('flex-row')
    await user.click(screen.getByRole('button', { name: 'Agrupar por género' }))
    expect(
      JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) ?? ''),
    ).toEqual({ view: 'grid', grouped: true })

    // Como al recargar: la pantalla se vuelve a montar y lee la preferencia.
    unmount()
    renderInventory(COLLECTION)
    expect(screen.getByRole('button', { name: 'Cuadrícula' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(
      screen.getByRole('button', { name: 'Agrupar por género' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('article')[0]).not.toHaveClass('flex-row')
  })

  it('una preferencia guardada que no se entiende se ignora', () => {
    window.localStorage.setItem(PREFERENCES_KEY, '{"view":"mosaico"')
    renderInventory(COLLECTION)
    expect(screen.getByRole('button', { name: 'Lista' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('funciona sin almacenamiento local', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Bloqueado', 'SecurityError')
    })
    const user = userEvent.setup()
    renderInventory(COLLECTION)

    const grid = screen.getByRole('button', { name: 'Cuadrícula' })
    await user.click(grid)
    expect(grid).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('article')[0]).not.toHaveClass('flex-row')
  })

  it('funciona si el almacenamiento local falla al leer o escribir', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Lleno', 'QuotaExceededError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Lleno', 'QuotaExceededError')
    })
    const user = userEvent.setup()
    renderInventory(COLLECTION)

    const toggle = screen.getByRole('button', { name: 'Agrupar por género' })
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(3)
  })

  it('ofrece registrar una planta, escribiendo el nombre o empezando por la foto', () => {
    renderInventory(COLLECTION)
    expect(
      screen.getByRole('link', { name: 'Registrar orquídea' }),
    ).toHaveAttribute('href', '/coleccion/nueva')
    // El nombre accesible contiene el texto visible ("Con foto").
    const withPhoto = screen.getByRole('link', { name: 'Registrar con foto' })
    expect(withPhoto).toHaveAttribute('href', '/coleccion/nueva?foto=1')
    expect(withPhoto).toHaveTextContent('Con foto')
  })

  it('el orden del tabulador va del registro al buscador y a los controles de vista', async () => {
    const user = userEvent.setup()
    renderInventory(COLLECTION)

    await user.tab()
    expect(
      screen.getByRole('link', { name: 'Registrar orquídea' }),
    ).toHaveFocus()
    await user.tab()
    expect(
      screen.getByRole('link', { name: 'Registrar con foto' }),
    ).toHaveFocus()
    await user.tab()
    expect(
      screen.getByRole('searchbox', { name: 'Buscar en tu colección' }),
    ).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Lista' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Cuadrícula' })).toHaveFocus()
    await user.tab()
    expect(
      screen.getByRole('button', { name: 'Agrupar por género' }),
    ).toHaveFocus()
  })

  it('no tiene fallos A ni AA en lista, en cuadrícula y agrupada', async () => {
    const user = userEvent.setup()
    renderInventory(COLLECTION)
    await expectNoAxeViolations()

    await user.click(screen.getByRole('button', { name: 'Cuadrícula' }))
    await expectNoAxeViolations()

    await user.click(screen.getByRole('button', { name: 'Agrupar por género' }))
    await expectNoAxeViolations()

    await user.click(screen.getByRole('button', { name: 'Lista' }))
    await expectNoAxeViolations()
  })

  it('con 300 plantas se pinta entera y cambia de vista y de agrupación', async () => {
    const genera = [PHALAENOPSIS, CATTLEYA, RHYNCHOLAELIOCATTLEYA]
    const many = Array.from({ length: 300 }, (_, index) =>
      specimen({
        displayName: `${genera[index % 3]?.name ?? ''} ejemplar ${index}`,
        genus: genera[index % 3] ?? PHALAENOPSIS,
        createdAt: new Date(
          Date.UTC(2026, 0, 1) + index * 60_000,
        ).toISOString(),
      }),
    )
    const user = userEvent.setup()
    renderInventory(many)

    expect(screen.getAllByRole('article')).toHaveLength(300)
    expect(screen.getByText('300 orquídeas')).toBeInTheDocument()
    expect(cardNames()[0]).toBe('× Rhyncholaeliocattleya ejemplar 299')

    await user.click(screen.getByRole('button', { name: 'Cuadrícula' }))
    expect(screen.getAllByRole('article')).toHaveLength(300)
    expect(screen.getAllByRole('article')[299]).not.toHaveClass('flex-row')

    await user.click(screen.getByRole('button', { name: 'Agrupar por género' }))
    expect(
      screen.getByRole('region', { name: 'Cattleya, 100 orquídeas' }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('article')).toHaveLength(300)
  })
})

describe('InventoryView: buscador', () => {
  const searchbox = () =>
    screen.getByRole('searchbox', { name: 'Buscar en tu colección' })
  const status = () => within(screen.getByRole('search')).getByRole('status')

  // Con origen y apodo, para buscar por ellos.
  const oncidium = specimen({
    displayName: 'Oncidium Sharry Baby',
    genus: { id: 'genus-onc', name: 'Oncidium' },
    nickname: 'La de chocolate',
    origin: 'Feria de Miraflores',
    createdAt: '2026-08-01T10:00:00+00:00',
  })
  const PLANTS = [...COLLECTION, oncidium]
  const HYBRID = '× Rhyncholaeliocattleya Memoria Anna Balmores'

  it.each([
    ['sin tildes ni mayúsculas', 'MIRAFLORES', 'Oncidium Sharry Baby'],
    ['por el apodo', 'chocolate', 'Oncidium Sharry Baby'],
    ['por el origen con tilde', 'féria', 'Oncidium Sharry Baby'],
    ['sin el signo "×"', 'rhyncho memoria', HYBRID],
    ['con el signo "×"', '× rhyncholaeliocattleya', HYBRID],
    ['por el nombre ingresado', 'naranja', 'la naranja del mercado'],
  ])('filtra %s', async (_case, text, expected) => {
    const user = userEvent.setup()
    renderInventory(PLANTS)

    await user.type(searchbox(), text)
    expect(cardNames()).toEqual([expected])
    // La cabecera dice cuántas se ven de las activas.
    expect(screen.getByText('1 de 6 orquídeas')).toBeInTheDocument()
    expect(screen.getByText('1 género')).toBeInTheDocument()
    expect(status()).toHaveTextContent('1 de 6 orquídeas coincide.')
  })

  it('anuncia cuántas coinciden sin sacar el foco del campo', async () => {
    const user = userEvent.setup()
    renderInventory(PLANTS)

    expect(status()).toBeEmptyDOMElement()
    await user.type(searchbox(), 'phal')
    expect(status()).toHaveTextContent('2 de 6 orquídeas coinciden.')
    expect(searchbox()).toHaveFocus()
    await user.type(searchbox(), 'zzz')
    expect(status()).toHaveTextContent('Ninguna de tus 6 orquídeas coincide.')
    expect(searchbox()).toHaveFocus()
  })

  it('agrupada, los géneros sin coincidencias desaparecen', async () => {
    const user = userEvent.setup()
    renderInventory(PLANTS)
    await user.click(screen.getByRole('button', { name: 'Agrupar por género' }))

    await user.type(searchbox(), 'cattleya')
    expect(
      screen
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.firstChild?.textContent),
    ).toEqual(['Cattleya', '× Rhyncholaeliocattleya'])
  })

  it('el botón limpia la búsqueda y devuelve el foco al campo', async () => {
    const user = userEvent.setup()
    renderInventory(PLANTS)

    expect(
      screen.queryByRole('button', { name: 'Limpiar la búsqueda' }),
    ).toBeNull()
    await user.type(searchbox(), 'phal')
    await user.click(
      screen.getByRole('button', { name: 'Limpiar la búsqueda' }),
    )
    expect(searchbox()).toHaveValue('')
    expect(searchbox()).toHaveFocus()
    expect(screen.getAllByRole('article')).toHaveLength(6)
    expect(status()).toBeEmptyDOMElement()
  })

  it('solo el campo queda fijo arriba: la respuesta de "¿Ya la tengo?" se desplaza con la lista (#19)', () => {
    render(
      <MemoryRouter>
        <main>
          <InventoryView
            status="ready"
            plants={PLANTS}
            error={null}
            onRetry={() => {}}
            query="phal"
            onQueryChange={() => {}}
            filters={DEFAULT_FILTERS}
            onFiltersChange={() => {}}
            searchResult={
              <a href="/coleccion/planta" data-testid="respuesta">
                Phalaenopsis amabilis
              </a>
            }
          />
        </main>
      </MemoryRouter>,
    )
    // El bloque fijo, con su fondo opaco, lleva el campo y el contador.
    const pinned = searchbox().closest('.sticky')
    expect(pinned).not.toBeNull()
    expect(pinned).toHaveClass('bg-neutral-0')
    expect(pinned).toContainElement(status())
    // La respuesta no va dentro: no puede quedar montada sobre las tarjetas.
    const answer = screen.getByTestId('respuesta')
    expect(pinned).not.toContainElement(answer)
    expect(answer.closest('.sticky')).toBeNull()
    // Y va entre el buscador y la lista, en el orden del tabulador.
    const firstCard = screen.getAllByRole('article')[0]
    expect(
      searchbox().compareDocumentPosition(answer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      answer.compareDocumentPosition(firstCard as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('Escape limpia la búsqueda', async () => {
    const user = userEvent.setup()
    renderInventory(PLANTS)

    await user.type(searchbox(), 'phal')
    await user.keyboard('{Escape}')
    expect(searchbox()).toHaveValue('')
    expect(screen.getAllByRole('article')).toHaveLength(6)
  })

  it('sin resultados ofrece limpiar la búsqueda', async () => {
    const user = userEvent.setup()
    renderInventory(PLANTS, { initialQuery: 'vanda' })

    expect(screen.queryAllByRole('article')).toHaveLength(0)
    expect(
      screen.getByText(/Ninguna orquídea de tu colección coincide con/),
    ).toHaveTextContent('«vanda»')
    // No es la invitación de la colección vacía.
    expect(screen.queryByText('Tu colección está vacía')).toBeNull()
    await expectNoAxeViolations()

    // El botón del panel (el del campo hace lo mismo).
    const panelButton = screen.getAllByRole('button', {
      name: 'Limpiar la búsqueda',
    })[1]
    expect(panelButton).toBeDefined()
    if (panelButton) await user.click(panelButton)
    expect(searchbox()).toHaveValue('')
    expect(screen.getAllByRole('article')).toHaveLength(6)
  })

  it('no tiene fallos A ni AA con una búsqueda escrita', async () => {
    const user = userEvent.setup()
    renderInventory(PLANTS)
    await user.type(searchbox(), 'phal')
    await expectNoAxeViolations()
  })
  describe('por sinónimos y nombres comunes de la copia local', () => {
    // Los mismos extras que "¿Ya la tengo?": por id de especie.
    const EXTRAS: OwnershipExtras = {
      speciesNames: new Map([
        [
          amabilis.species?.id ?? '',
          [
            { name: 'Phalaenopsis grandiflora', type: 'synonym' as const },
            { name: 'Orquídea luna', type: 'common' as const },
          ],
        ],
      ]),
    }

    it.each([
      ['un nombre común', 'orquidea luna'],
      ['un sinónimo', 'grandiflora'],
      ['un nombre común con un error de tipeo', 'orquidea lunna'],
    ])('encuentra la planta por %s', async (_case, text) => {
      const user = userEvent.setup()
      renderInventory(PLANTS, { extras: EXTRAS })

      await user.type(searchbox(), text)
      expect(cardNames()).toEqual(['Phalaenopsis amabilis'])
      expect(status()).toHaveTextContent('1 de 6 orquídeas coincide.')
    })

    it('sin extras, como antes; al llegar, la lista los usa', () => {
      const { rerenderWith } = renderInventory(PLANTS, {
        initialQuery: 'orquidea luna',
      })
      expect(screen.queryAllByRole('article')).toHaveLength(0)
      expect(
        screen.getByText(/Ninguna orquídea de tu colección coincide con/),
      ).toBeInTheDocument()

      rerenderWith(PLANTS, { extras: EXTRAS })
      expect(cardNames()).toEqual(['Phalaenopsis amabilis'])
    })

    it('los filtros se siguen aplicando', () => {
      renderInventory(PLANTS, {
        extras: EXTRAS,
        initialQuery: 'orquidea luna',
        initialFilters: { ...DEFAULT_FILTERS, genera: [CATTLEYA.id] },
      })
      expect(screen.queryAllByRole('article')).toHaveLength(0)
    })
  })
})

describe('InventoryView: vacía, carga y error', () => {
  it('sin plantas invita a registrar la primera, sin buscador ni controles', async () => {
    renderInventory([])

    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Tu colección está vacía',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Registrar mi primera orquídea' }),
    ).toHaveAttribute('href', '/coleccion/nueva')
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Vista' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Filtros/ })).toBeNull()
    // Una sola acción principal: el acceso fijo no se repite.
    expect(screen.getAllByRole('link')).toHaveLength(1)
    await expectNoAxeViolations()
  })

  it('con solo plantas dadas de baja lo dice', () => {
    renderInventory([lost])
    expect(
      screen.getByRole('heading', { name: 'No tienes orquídeas activas' }),
    ).toBeInTheDocument()
  })

  it('mientras carga: esqueleto oculto al lector, estado anunciado y sin saltos al llegar', async () => {
    const user = userEvent.setup()
    const { rerenderWith } = renderInventory(null)

    expect(screen.getByText('Cargando tu colección…')).toHaveAttribute(
      'role',
      'status',
    )
    expect(screen.queryAllByRole('article')).toHaveLength(0)
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    await expectNoAxeViolations()

    // Se puede escribir mientras carga; al llegar los datos, el campo es el
    // mismo (no se vuelve a montar) y conserva el foco y lo escrito.
    const input = screen.getByRole('searchbox')
    await user.type(input, 'phal')
    rerenderWith(COLLECTION)
    expect(screen.getByRole('searchbox')).toBe(input)
    expect(input).toHaveFocus()
    expect(cardNames()).toEqual([
      'Phalaenopsis schilleriana',
      'Phalaenopsis amabilis',
    ])
    expect(document.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it.each([
    [
      'offline',
      'Sin conexión',
      'No se pudo cargar tu colección porque no hay conexión.',
    ],
    ['session-ended', 'Tu sesión terminó', 'Vuelve a iniciar sesión'],
    ['failed', 'No se pudo cargar tu colección', 'Algo falló al leerla.'],
  ] as const)(
    'error %s: mensaje claro y "Reintentar"',
    async (reason, title, text) => {
      const user = userEvent.setup()
      const onRetry = vi.fn()
      renderInventory(null, {
        status: 'error',
        error: new CollectionLoadError(reason),
        onRetry,
      })

      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent(title)
      expect(alert).toHaveTextContent(text)
      expect(
        within(alert).queryByRole('link', { name: 'Iniciar sesión' }) !== null,
      ).toBe(reason === 'session-ended')
      expect(screen.queryByText('Cargando tu colección…')).toBeNull()
      await user.click(
        within(alert).getByRole('button', { name: 'Reintentar' }),
      )
      expect(onRetry).toHaveBeenCalledTimes(1)
      await expectNoAxeViolations()
    },
  )

  it('si falla una recarga, sigue mostrando los datos con un aviso', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    renderInventory(COLLECTION, {
      status: 'error',
      error: new CollectionLoadError('offline'),
      onRetry,
    })

    expect(screen.getAllByRole('article')).toHaveLength(5)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(
      'Sin conexión: no se pudo actualizar tu colección.',
    )
    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    await expectNoAxeViolations()
  })
})
