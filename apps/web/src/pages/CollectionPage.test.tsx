import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Link,
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

// Pantalla «¿Ya la tengo?» provisional (la hace el #209): muestra el estado
// de la navegación con el que se llegó.
function OwnershipCheckStub() {
  const state: unknown = useLocation().state
  return <p data-testid="consulta">{JSON.stringify(state)}</p>
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
              <Route path="/ya-la-tengo" element={<OwnershipCheckStub />} />
              <Route path="/inicio" element={<p>Inicio</p>} />
            </Routes>
          </main>
          <LocationProbe />
          <BackButton />
          {/* Como «Ver en mi colección» de otra pantalla, estando aquí. */}
          <Link to="/coleccion?q=maxima">Enlace externo</Link>
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
  screen.getByRole('searchbox', { name: 'Buscar en mi colección' })
const genusChip = (name: string) =>
  within(screen.getByRole('group', { name: 'Género' })).getByRole('button', {
    name,
  })
const meta = () => document.querySelector('.orki-pagehead__meta')
const location = () => screen.getByTestId('location').textContent

describe('CollectionPage', () => {
  it('pinta la colección del usuario y pasa la revisión de accesibilidad', async () => {
    renderAt('/coleccion')
    expect(screen.getByText('Cargando tu colección…')).toBeInTheDocument()

    await resolveLast()
    expect(document.title).toBe('Mi colección · orqui.apps')
    expect(screen.getAllByRole('article')).toHaveLength(3)
    await expectNoAxeViolations()
  })

  describe('cabecera', () => {
    it('título, contador de ejemplares y géneros, ilustración y las dos acciones', async () => {
      renderAt('/coleccion')
      // Mientras carga, sin contador; las acciones ya están.
      expect(meta()).toBeNull()
      expect(
        screen.getByRole('link', { name: 'Registrar orquídea' }),
      ).toBeInTheDocument()
      await resolveLast()

      expect(
        screen.getByRole('heading', { level: 1, name: 'Mi colección' }),
      ).toHaveClass('orki-pagehead__title')
      expect(meta()).toHaveTextContent('3 ejemplares · 2 géneros')
      expect(document.querySelector('.orki-pagehead__art')).toHaveAttribute(
        'alt',
        '',
      )
      const actions = document.querySelector('.orki-pagehead__actions')
      if (!(actions instanceof HTMLElement)) throw new Error('Sin acciones.')
      // La principal primero (en el celular se apilan en este orden).
      const [register, check] = within(actions).getAllByRole('link')
      expect(register).toHaveAccessibleName('Registrar orquídea')
      expect(register).toHaveAttribute('href', '/coleccion/nueva')
      expect(register).toHaveClass('orki-btn--primary')
      expect(check).toHaveAccessibleName('¿Ya la tengo?')
      expect(check).toHaveAttribute('href', '/ya-la-tengo')
      expect(check).toHaveClass('orki-btn--secondary')
      // Sin «Con foto» ni la barra fija de abajo.
      expect(
        screen.queryByRole('link', { name: 'Registrar con foto' }),
      ).toBeNull()
      expect(document.querySelector('[data-barra-inferior]')).toBeNull()
    })

    it('en singular y sin contar las dadas de baja', async () => {
      renderAt('/coleccion')
      const [first] = PLANTS
      if (!first) throw new Error('Sin plantas.')
      await resolveLast([
        first,
        plant({ id: 'planta-perdida', status: 'lost', genus: CATTLEYA }),
      ])
      expect(meta()).toHaveTextContent('1 ejemplar · 1 género')
    })

    it('el contador es el de la colección: no cambia al buscar', async () => {
      const user = userEvent.setup()
      renderAt('/coleccion')
      await resolveLast()
      await user.type(searchbox(), 'cattleya')
      expect(screen.getAllByRole('article')).toHaveLength(1)
      expect(meta()).toHaveTextContent('3 ejemplares · 2 géneros')
      expect(searchbox()).toHaveAccessibleDescription(
        '1 de 3 orquídeas coincide.',
      )
    })

    it('con la colección vacía, sin contador ni acciones arriba: la llamada a registrar va en el cuerpo', async () => {
      renderAt('/coleccion')
      await resolveLast([])
      expect(meta()).toBeNull()
      expect(document.querySelector('.orki-pagehead__actions')).toBeNull()
      expect(
        screen.getByRole('link', { name: 'Registrar mi primera orquídea' }),
      ).toHaveAttribute('href', '/coleccion/nueva')
      expect(screen.queryByRole('searchbox')).toBeNull()
      await expectNoAxeViolations()
    })
  })

  it('lee la búsqueda de la URL, como al recargar o abrir un enlace', async () => {
    renderAt('/coleccion?q=amabilis')
    await resolveLast()

    expect(searchbox()).toHaveValue('amabilis')
    expect(screen.getAllByRole('article')).toHaveLength(1)
  })

  it('un enlace a /coleccion?q= estando aquí cambia el texto del buscador', async () => {
    const user = userEvent.setup()
    renderAt('/coleccion')
    await resolveLast()
    await user.type(searchbox(), 'phal')
    expect(screen.getAllByRole('article')).toHaveLength(2)

    await user.click(screen.getByRole('link', { name: 'Enlace externo' }))
    expect(location()).toBe('/coleccion?q=maxima')
    expect(searchbox()).toHaveValue('maxima')
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

  it('un único buscador, sin el panel «¿Ya la tengo?» integrado', async () => {
    const user = userEvent.setup()
    // Con el filtro de color blanco, la lista solo muestra Cattleya maxima.
    renderAt('/coleccion?color=white')
    await resolveLast()

    await user.type(searchbox(), 'phal schilleriana')
    expect(screen.getAllByRole('searchbox')).toHaveLength(1)
    // La búsqueda solo filtra las tarjetas: con el filtro, ninguna coincide.
    expect(screen.queryAllByRole('article')).toHaveLength(0)
    expect(screen.queryByText(/la tienes/)).toBeNull()
    expect(
      screen.queryByText(
        'La respuesta es sobre toda tu colección, sin los filtros.',
      ),
    ).toBeNull()
    await expectNoAxeViolations()
  })

  it('«¿Ya la tengo?» abre su pantalla y "atrás" recupera la búsqueda, los filtros, los géneros y la vista', async () => {
    const user = userEvent.setup()
    renderAt('/coleccion')
    await resolveLast()

    await user.type(searchbox(), 'a')
    await user.click(genusChip('Phalaenopsis'))
    await user.click(screen.getByRole('button', { name: 'Lista' }))
    await user.click(screen.getByRole('button', { name: /^Filtros/ }))
    await user.click(screen.getByRole('button', { name: 'Blanco' }))
    const before = location()
    expect(before).toBe(`/coleccion?q=a&genero=${PHALAENOPSIS.id}&color=white`)
    setScrollY(320)
    window.dispatchEvent(new Event('scroll'))

    await user.click(screen.getByRole('link', { name: '¿Ya la tengo?' }))
    expect(location()).toBe('/ya-la-tengo')
    // Lleva que se llegó desde el inventario: su «Volver» puede ser "atrás".
    expect(screen.getByTestId('consulta')).toHaveTextContent(
      '{"fromInventory":true}',
    )

    await user.click(
      screen.getByRole('button', { name: 'Atrás del navegador' }),
    )
    expect(location()).toBe(before)
    expect(searchbox()).toHaveValue('a')
    expect(genusChip('Phalaenopsis')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Lista' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(
      screen.getByRole('button', { name: 'Filtros, 1 activo' }),
    ).toBeInTheDocument()
    expect(scrollTo).toHaveBeenLastCalledWith(0, 320)
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
    expect(searchbox()).toHaveAccessibleDescription(
      '1 de 3 orquídeas coincide.',
    )
    // El género se ve elegido en su fila; no cuenta en «Filtros».
    expect(genusChip('Cattleya')).toHaveAttribute('aria-pressed', 'true')
    expect(genusChip('Todos')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Filtros' })).toBeInTheDocument()
  })

  it('escribe los filtros en la URL junto a la búsqueda, sin añadir entradas al historial', async () => {
    const user = userEvent.setup()
    renderAt('/coleccion?q=a', ['/inicio'])
    await resolveLast()

    await user.click(screen.getByRole('button', { name: /^Filtros/ }))
    await user.click(screen.getByRole('button', { name: 'Perdidas' }))
    await user.click(screen.getByRole('button', { name: 'Activas' }))
    await user.click(genusChip('Cattleya'))
    await user.click(screen.getByRole('button', { name: 'Blanco' }))
    expect(location()).toBe(`/coleccion?q=a&genero=${CATTLEYA.id}&color=white`)
    // «Quitar filtros» quita los del panel; el género, «Todos».
    await user.click(screen.getByRole('button', { name: 'Quitar filtros' }))
    expect(location()).toBe(`/coleccion?q=a&genero=${CATTLEYA.id}`)
    await user.click(genusChip('Todos'))
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

    await user.click(genusChip('Phalaenopsis'))
    await user.click(screen.getByRole('link', { name: 'Registrar orquídea' }))
    await user.click(screen.getByRole('button', { name: 'Atrás' }))

    expect(location()).toBe(`/coleccion?genero=${PHALAENOPSIS.id}`)
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(genusChip('Phalaenopsis')).toHaveAttribute('aria-pressed', 'true')
  })

  it('sin conexión: el indicador con la fecha, registrar desactivado con su motivo, y el buscador reconoce abreviaturas y sinónimos de la copia local', async () => {
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

    const resultsFor = async (text: string) => {
      await user.clear(searchbox())
      await user.type(searchbox(), text)
      return screen.queryAllByRole('article').length
    }
    expect(await resultsFor('Rlc. George')).toBe(1)
    expect(await resultsFor('Brassolaeliocattleya George')).toBe(1)
    expect(await resultsFor('Vanda coerulea')).toBe(0)
  })

  it('en solo lectura, registrar se ve desactivado y cita el indicador; «¿Ya la tengo?» sigue disponible', async () => {
    const storage = createMemoryCopyStorage()
    await storage.write({
      userId: 'user_a',
      savedAt: '2026-11-20T08:00:00.000Z',
      plants: PLANTS,
      extras: {},
    })
    const cached = createCachedCollectionSource({
      network: source,
      storage,
      fetchExtras: () => Promise.resolve({}),
      onSaved: () => {},
    })
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderAt('/coleccion', [], cached)
    await act(async () => {
      for (let index = 0; index < 5; index += 1) await Promise.resolve()
    })
    await act(async () => {
      source.last().reject(new CollectionLoadError('offline'))
      await Promise.resolve()
    })

    const notice = screen.getByText('Sin conexión', { exact: true })
    expect(notice.parentElement).toHaveTextContent(/Última actualización/)
    expect(
      screen.queryByRole('link', { name: 'Registrar orquídea' }),
    ).toBeNull()
    const register = screen.getByRole('button', { name: 'Registrar orquídea' })
    expect(register).toHaveAttribute('aria-disabled', 'true')
    expect(register).toHaveAccessibleDescription(/Sin conexión/)
    expect(screen.getByRole('link', { name: '¿Ya la tengo?' })).toHaveAttribute(
      'href',
      '/ya-la-tengo',
    )
    expect(screen.getAllByRole('article')).toHaveLength(3)
    await expectNoAxeViolations()
    onLine.mockRestore()
  })
})
