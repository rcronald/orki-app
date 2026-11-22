import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest'
import { createCachedCollectionSource } from '../collection/cached-source.ts'
import { CollectionProvider } from '../collection/CollectionProvider.tsx'
import { createMemoryCopyStorage } from '../collection/local-copy.ts'
import type { CollectionPlant } from '../collection/model.ts'
import {
  CollectionLoadError,
  type CollectionSource,
} from '../collection/source.ts'
import { NavigationFocusProvider } from '../routes/NavigationFocusProvider.tsx'
import { expectNoAxeViolations } from '../test/axe.ts'
import { resetFakeClerk, setFakeClerk } from '../test/clerk-mock.tsx'
import {
  CATTLEYA,
  PHALAENOPSIS,
  plant,
  RHYNCHOLAELIOCATTLEYA,
  speciesNamed,
} from '../test/collection.ts'
import {
  fakeCollectionSource,
  type FakeCollectionSource,
} from '../test/collection-source.ts'
import { CollectionPage } from './CollectionPage.tsx'

vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))

let source: FakeCollectionSource
let scrollTo: MockInstance<typeof window.scrollTo>

beforeEach(() => {
  document.documentElement.lang = 'es'
  window.localStorage.clear()
  resetFakeClerk()
  setFakeClerk({ signedIn: true, userId: 'user_a' })
  source = fakeCollectionSource()
  // jsdom no desplaza: se registra a dónde se pidió ir.
  scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  setScrollY(0)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function setScrollY(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true })
}

const PLANTS: CollectionPlant[] = [
  plant({
    displayName: 'Phalaenopsis amabilis',
    enteredName: 'Phalaenopsis amabilis',
  }),
  plant({
    displayName: 'Phalaenopsis schilleriana',
    enteredName: 'Phalaenopsis schilleriana',
    species: speciesNamed('Phalaenopsis schilleriana'),
  }),
  plant({
    displayName: 'Cattleya maxima',
    enteredName: 'Cattleya maxima',
    species: speciesNamed('Cattleya maxima'),
    genus: CATTLEYA,
    flowerColor: 'white',
  }),
]

function LocationProbe() {
  const location = useLocation()
  return (
    <div data-testid="location">{`${location.pathname}${location.search}`}</div>
  )
}

// Registro provisional de la prueba: solo permite volver con "atrás".
function RegisterStub() {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => void navigate(-1)}>
      Atrás
    </button>
  )
}

// "Atrás" del navegador, fuera de las rutas.
function BackButton() {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => void navigate(-1)}>
      Atrás del navegador
    </button>
  )
}

function renderAt(
  path: string,
  previous: string[] = [],
  collectionSource: CollectionSource = source,
) {
  return render(
    <MemoryRouter initialEntries={[...previous, path]}>
      <NavigationFocusProvider>
        <CollectionProvider source={collectionSource}>
          <main>
            <Routes>
              <Route path="/coleccion" element={<CollectionPage />} />
              <Route path="/coleccion/nueva" element={<RegisterStub />} />
              <Route path="/inicio" element={<p>Inicio</p>} />
            </Routes>
          </main>
          <LocationProbe />
          <BackButton />
        </CollectionProvider>
      </NavigationFocusProvider>
    </MemoryRouter>,
  )
}

async function resolveLast(plants: readonly CollectionPlant[] = PLANTS) {
  await act(async () => {
    source.last().resolve(plants)
    await Promise.resolve()
  })
}

const searchbox = () =>
  screen.getByRole('searchbox', { name: 'Buscar en tu colección' })
const location = () => screen.getByTestId('location').textContent

describe('CollectionPage', () => {
  it('pinta la colección del usuario y pasa la revisión de accesibilidad', async () => {
    renderAt('/coleccion')
    expect(screen.getByText('Cargando tu colección…')).toBeInTheDocument()

    await resolveLast()
    expect(document.title).toBe('Mi colección · orqui.apps')
    expect(screen.getAllByRole('article')).toHaveLength(3)
    expect(screen.getByText('3 orquídeas')).toBeInTheDocument()
    await expectNoAxeViolations()
  })

  it('lee la búsqueda de la URL, como al recargar o abrir un enlace', async () => {
    renderAt('/coleccion?q=amabilis')
    await resolveLast()

    expect(searchbox()).toHaveValue('amabilis')
    expect(screen.getAllByRole('article')).toHaveLength(1)
  })

  it('escribe la búsqueda en la URL sin sacar el foco del campo', async () => {
    const user = userEvent.setup()
    renderAt('/coleccion')
    await resolveLast()

    await user.type(searchbox(), 'cattleya')
    expect(location()).toBe('/coleccion?q=cattleya')
    expect(searchbox()).toHaveFocus()
    expect(screen.getAllByRole('article')).toHaveLength(1)

    await user.keyboard('{Escape}')
    expect(location()).toBe('/coleccion')
    expect(searchbox()).toHaveFocus()
  })

  it('"¿Ya la tengo?": responde bajo el buscador sobre toda la colección, aunque haya filtros', async () => {
    const user = userEvent.setup()
    // Con el filtro de color blanco, la lista solo muestra Cattleya maxima.
    renderAt('/coleccion?color=white')
    await resolveLast()

    await user.type(searchbox(), 'phal schilleriana')
    expect(searchbox()).toHaveFocus()
    const answer = screen
      .getAllByRole('status')
      .find((region) => region.textContent?.includes('la tienes'))
    expect(answer).toHaveTextContent(
      'Sí, la tienesTienes 1 ejemplar de Phalaenopsis schilleriana.',
    )
    expect(
      screen.getByText(
        'La respuesta es sobre toda tu colección, sin los filtros.',
      ),
    ).toBeInTheDocument()
    await expectNoAxeViolations()
  })

  it('al volver del registro conserva la búsqueda y la posición de desplazamiento', async () => {
    const user = userEvent.setup()
    renderAt('/coleccion')
    await resolveLast()

    await user.type(searchbox(), 'phal')
    setScrollY(640)
    window.dispatchEvent(new Event('scroll'))

    await user.click(screen.getByRole('link', { name: 'Registrar orquídea' }))
    expect(location()).toBe('/coleccion/nueva')

    setScrollY(0)
    await user.click(screen.getByRole('button', { name: 'Atrás' }))
    expect(location()).toBe('/coleccion?q=phal')
    expect(searchbox()).toHaveValue('phal')
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(scrollTo).toHaveBeenLastCalledWith(0, 640)
    // La colección no se volvió a pedir.
    expect(source.loads).toHaveLength(1)
  })

  it('un error muestra el motivo y "Reintentar" vuelve a leer la colección', async () => {
    const user = userEvent.setup()
    renderAt('/coleccion')

    await act(async () => {
      source.last().reject(new CollectionLoadError('offline'))
      await Promise.resolve()
    })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Sin conexión')
    await expectNoAxeViolations()

    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }))
    expect(source.loads).toHaveLength(2)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Cargando tu colección…')).toBeInTheDocument()

    await resolveLast()
    expect(screen.getAllByRole('article')).toHaveLength(3)
  })

  it('lee los filtros de la URL e ignora los valores que no entiende', async () => {
    renderAt(
      `/coleccion?genero=${CATTLEYA.id}&genero=no-existe&color=verde&estado=borrada`,
    )
    await resolveLast()

    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByText('1 de 3 orquídeas')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Filtros, 1 activo' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Quitar el filtro Género: Cattleya' }),
    ).toBeInTheDocument()
  })

  it('escribe los filtros en la URL junto a la búsqueda, sin añadir entradas al historial', async () => {
    const user = userEvent.setup()
    renderAt('/coleccion?q=a', ['/inicio'])
    await resolveLast()

    await user.click(screen.getByRole('button', { name: /^Filtros/ }))
    await user.click(screen.getByRole('button', { name: 'Perdidas' }))
    await user.click(screen.getByRole('button', { name: 'Activas' }))
    await user.click(screen.getByRole('button', { name: 'Cattleya' }))
    await user.click(screen.getByRole('button', { name: 'Blanco' }))
    expect(location()).toBe(`/coleccion?q=a&genero=${CATTLEYA.id}&color=white`)
    await user.click(screen.getByRole('button', { name: 'Quitar filtros' }))
    expect(location()).toBe('/coleccion?q=a')

    // Cada toque sustituyó la entrada: "atrás" sale del inventario.
    await user.click(
      screen.getByRole('button', { name: 'Atrás del navegador' }),
    )
    expect(location()).toBe('/inicio')
  })

  it('al volver del registro conserva los filtros', async () => {
    const user = userEvent.setup()
    renderAt('/coleccion')
    await resolveLast()

    await user.click(screen.getByRole('button', { name: /^Filtros/ }))
    await user.click(screen.getByRole('button', { name: 'Phalaenopsis' }))
    await user.click(screen.getByRole('link', { name: 'Registrar orquídea' }))
    await user.click(screen.getByRole('button', { name: 'Atrás' }))

    expect(location()).toBe(`/coleccion?genero=${PHALAENOPSIS.id}`)
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(
      screen.getByRole('button', {
        name: 'Quitar el filtro Género: Phalaenopsis',
      }),
    ).toBeInTheDocument()
  })

  it('sin conexión, "¿Ya la tengo?" reconoce abreviaturas y sinónimos de la copia local', async () => {
    const user = userEvent.setup()
    const storage = createMemoryCopyStorage()
    await storage.write({
      userId: 'user_a',
      savedAt: '2026-11-20T08:00:00.000Z',
      plants: [
        plant({
          displayName: 'Rhyncholaeliocattleya George King',
          enteredName: 'Rhyncholaeliocattleya George King',
          species: {
            id: 'species-george-king',
            scientificName: 'Rhyncholaeliocattleya George King',
            type: 'hybrid',
            status: 'validated',
          },
          genus: RHYNCHOLAELIOCATTLEYA,
        }),
      ],
      extras: {
        speciesNames: new Map([
          [
            'species-george-king',
            [{ name: 'Brassolaeliocattleya George King', type: 'synonym' }],
          ],
        ]),
        genusAbbreviations: new Map([[RHYNCHOLAELIOCATTLEYA.id, ['Rlc.']]]),
      },
    })
    const cached = createCachedCollectionSource({
      network: source,
      storage,
      fetchExtras: () => Promise.resolve({}),
      onSaved: () => {},
    })
    renderAt('/coleccion', [], cached)
    await act(async () => {
      for (let index = 0; index < 5; index += 1) await Promise.resolve()
    })
    await act(async () => {
      source.last().reject(new CollectionLoadError('offline'))
      await Promise.resolve()
    })
    expect(screen.getAllByRole('article')).toHaveLength(1)

    const answerFor = async (text: string) => {
      await user.clear(searchbox())
      await user.type(searchbox(), text)
      return screen
        .getAllByRole('status')
        .find((region) => /la tienes/.test(region.textContent ?? ''))
    }
    expect(await answerFor('Rlc. George')).toHaveTextContent('Sí, la tienes')
    expect(await answerFor('Brassolaeliocattleya George')).toHaveTextContent(
      'Sí, la tienes',
    )
  })
})
