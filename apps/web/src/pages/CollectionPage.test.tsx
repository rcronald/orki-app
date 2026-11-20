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
import { CollectionProvider } from '../collection/CollectionProvider.tsx'
import type { CollectionPlant } from '../collection/model.ts'
import { CollectionLoadError } from '../collection/source.ts'
import { NavigationFocusProvider } from '../routes/NavigationFocusProvider.tsx'
import { expectNoAxeViolations } from '../test/axe.ts'
import { resetFakeClerk, setFakeClerk } from '../test/clerk-mock.tsx'
import { CATTLEYA, plant } from '../test/collection.ts'
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
  }),
  plant({
    displayName: 'Cattleya maxima',
    enteredName: 'Cattleya maxima',
    genus: CATTLEYA,
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

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NavigationFocusProvider>
        <CollectionProvider source={source}>
          <main>
            <Routes>
              <Route path="/coleccion" element={<CollectionPage />} />
              <Route path="/coleccion/nueva" element={<RegisterStub />} />
            </Routes>
          </main>
          <LocationProbe />
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
    expect(document.title).toBe('Mi colección · Orki')
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
})
