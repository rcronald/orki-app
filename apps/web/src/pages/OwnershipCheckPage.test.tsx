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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCachedCollectionSource } from '../collection/cached-source.ts'
import { CollectionProvider } from '../collection/CollectionProvider.tsx'
import { createMemoryCopyStorage } from '../collection/local-copy.ts'
import type { CollectionPlant } from '../collection/model.ts'
import {
  CollectionLoadError,
  type CollectionSource,
} from '../collection/source.ts'
import { FROM_INVENTORY } from '../detail/navigation.ts'
import { NavigationFocusProvider } from '../routes/NavigationFocusProvider.tsx'
import { recordProductEvent } from '../telemetry/product-events.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import { resetFakeClerk, setFakeClerk } from '../test/clerk-mock.tsx'
import { CATTLEYA, plant, speciesNamed } from '../test/collection.ts'
import {
  fakeCollectionSource,
  type FakeCollectionSource,
} from '../test/collection-source.ts'
import OwnershipCheckPage from './OwnershipCheckPage.tsx'

// «¿Ya la tengo?» en su pantalla (#209): cada respuesta, sin conexión con y
// sin copia, mientras carga, la consulta en la dirección, «Ver en mi
// colección», «Volver a Mi colección», el foco y el evento de uso (#146).

vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))
vi.mock('../telemetry/product-events.ts', () => ({
  recordProductEvent: vi.fn(),
}))

let source: FakeCollectionSource
let online = true

beforeEach(() => {
  document.documentElement.lang = 'es'
  window.localStorage.clear()
  resetFakeClerk()
  setFakeClerk({ signedIn: true, userId: 'user_a' })
  source = fakeCollectionSource()
  online = true
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.mocked(recordProductEvent).mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const AMABILIS_1 = plant({ nickname: 'La blanca' })
const AMABILIS_2 = plant()
const MAXIMA = plant({
  displayName: 'Cattleya maxima',
  enteredName: 'Cattleya maxima',
  species: speciesNamed('Cattleya maxima'),
  genus: CATTLEYA,
})
const LABIATA_LOST = plant({
  displayName: 'Cattleya labiata',
  enteredName: 'Cattleya labiata',
  species: speciesNamed('Cattleya labiata'),
  genus: CATTLEYA,
  status: 'lost',
})
const PENDING = plant({
  displayName: 'Orquídea del abuelo',
  displayNameIsScientific: false,
  enteredName: 'Orquídea del abuelo',
  species: null,
  genus: CATTLEYA,
  validation: 'pending',
})
const PLANTS: readonly CollectionPlant[] = [
  AMABILIS_1,
  AMABILIS_2,
  MAXIMA,
  LABIATA_LOST,
  PENDING,
]

function LocationProbe() {
  const location = useLocation()
  return (
    <div data-testid="location">{`${location.pathname}${location.search}`}</div>
  )
}

function BackButton() {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => void navigate(-1)}>
      Atrás del navegador
    </button>
  )
}

// Un inventario mínimo con el botón que abre la consulta como lo hará el
// #208: con el estado FROM_INVENTORY.
function InventoryStub() {
  return (
    <Link to="/ya-la-tengo" state={FROM_INVENTORY}>
      Abrir ¿Ya la tengo?
    </Link>
  )
}

type Entry = string | { pathname: string; search?: string; state?: unknown }

function renderAt(
  entries: Entry[] = ['/ya-la-tengo'],
  collectionSource: CollectionSource = source,
) {
  return render(
    <MemoryRouter initialEntries={entries}>
      <NavigationFocusProvider>
        <CollectionProvider source={collectionSource} thumbnailSync={null}>
          <main>
            <Routes>
              <Route path="/ya-la-tengo" element={<OwnershipCheckPage />} />
              <Route path="/coleccion" element={<InventoryStub />} />
              <Route path="/coleccion/nueva" element={<p>Registro</p>} />
              <Route path="/coleccion/:id" element={<p>Detalle</p>} />
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

async function settle() {
  await act(async () => {
    for (let index = 0; index < 6; index += 1) await Promise.resolve()
  })
}

const field = () =>
  screen.getByRole('searchbox', { name: 'Nombre de la orquídea' })
const location = () => screen.getByTestId('location').textContent
/** La región de la respuesta (la segunda; la primera es la de la conexión). */
const answer = () => screen.getAllByRole('status')[1]

async function ask(text: string) {
  const user = userEvent.setup()
  await user.clear(field())
  await user.type(field(), text)
  return user
}

describe('OwnershipCheckPage', () => {
  it('título, frase, foco en el campo y accesibilidad', async () => {
    renderAt()
    await resolveLast()

    expect(document.title).toBe('¿Ya la tengo? · orqui.app')
    expect(
      screen.getByRole('heading', { level: 1, name: '¿Ya la tengo?' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Comprueba si una orquídea ya está en tu colección.'),
    ).toBeInTheDocument()
    expect(field()).toHaveFocus()
    // Un solo campo de consulta.
    expect(screen.getAllByRole('searchbox')).toHaveLength(1)
    await expectNoAxeViolations()

    await ask('amabilis')
    await expectNoAxeViolations()
  })

  it('al llegar navegando desde la colección, el foco también va al campo', async () => {
    const user = userEvent.setup()
    renderAt(['/coleccion'])
    await user.click(screen.getByRole('link', { name: 'Abrir ¿Ya la tengo?' }))
    expect(field()).toHaveFocus()
  })

  it('varios ejemplares: «Sí, la tienes» con el número y «Ver en mi colección»', async () => {
    renderAt()
    await resolveLast()
    await ask('Phalaenopsis amabilis')

    expect(answer()).toHaveTextContent(
      'Sí, la tienes2 ejemplares de Phalaenopsis amabilis',
    )
    expect(
      within(answer()).getByRole('link', { name: 'Ver en mi colección' }),
    ).toHaveAttribute('href', '/coleccion?q=Phalaenopsis+amabilis')
    // Cada ejemplar enlaza a su detalle, fuera de la región.
    const list = screen.getByRole('list', { name: 'Ejemplares que coinciden' })
    expect(within(list).getAllByRole('link')).toHaveLength(2)
    expect(
      within(list).getByRole('link', { name: /La blanca/ }),
    ).toHaveAttribute('href', `/coleccion/${AMABILIS_1.id}`)
    // Ya la tiene: no se ofrece registrarla.
    expect(screen.queryByRole('link', { name: /registrarla/i })).toBeNull()
  })

  it('un ejemplar: «1 ejemplar», con el enlace a su detalle además del inventario', async () => {
    renderAt()
    await resolveLast()
    await ask('maxima')

    expect(answer()).toHaveTextContent(
      'Sí, la tienes1 ejemplar de Cattleya maxima',
    )
    expect(
      within(answer()).getByRole('link', { name: 'Ver en mi colección' }),
    ).toHaveAttribute('href', '/coleccion?q=maxima')
    expect(
      within(
        screen.getByRole('list', { name: 'Ejemplares que coinciden' }),
      ).getByRole('link', { name: 'Cattleya maxima' }),
    ).toHaveAttribute('href', `/coleccion/${MAXIMA.id}`)
  })

  it('parecidas: «Tienes parecidas», para que juzgue, y registrar como secundaria', async () => {
    renderAt()
    await resolveLast()
    await ask('Cattleya maximo')

    expect(answer()).toHaveTextContent(
      'Tienes parecidas1 ejemplar de Cattleya maxima',
    )
    expect(answer()).toHaveTextContent(
      'No coincide exactamente: revisa si es la misma.',
    )
    expect(
      screen.getByRole('link', { name: 'No es la misma: registrarla' }),
    ).toHaveClass('orki-btn--secondary')
  })

  it('la tuvo: «No, pero la tuviste» y el inventario con las perdidas', async () => {
    renderAt()
    await resolveLast()
    await ask('Cattleya labiata')

    expect(answer()).toHaveTextContent('No, pero la tuviste')
    expect(answer()).toHaveTextContent('La tuviste: 1 ejemplar perdido.')
    expect(
      within(answer()).getByRole('link', { name: 'Ver en mi colección' }),
    ).toHaveAttribute('href', '/coleccion?q=Cattleya+labiata&estado=lost')
    expect(
      screen.getByRole('list', { name: 'Ejemplares que tuviste' }),
    ).toHaveTextContent('Perdida')
    expect(
      screen.getByRole('link', { name: 'Registrarla con este nombre' }),
    ).toHaveAttribute('href', '/coleccion/nueva?nombre=Cattleya+labiata')
  })

  it('no la tiene: «Aún no la tienes» y registrarla con ese nombre', async () => {
    renderAt()
    await resolveLast()
    const user = await ask('Vanda coerulea')

    expect(answer()).toHaveTextContent(
      'Aún no la tienes«Vanda coerulea» no está en tu colección.',
    )
    expect(
      within(answer()).queryByRole('link', { name: 'Ver en mi colección' }),
    ).toBeNull()
    const register = screen.getByRole('link', {
      name: 'Registrarla con este nombre',
    })
    expect(register).toHaveClass('orki-btn--primary')
    await expectNoAxeViolations()

    await user.click(register)
    expect(location()).toBe('/coleccion/nueva?nombre=Vanda+coerulea')
  })

  it('por género: cuántos ejemplares hay del género', async () => {
    renderAt()
    await resolveLast()
    await ask('Cattleya')

    // Cattleya maxima y la del abuelo (por validar); la perdida no cuenta.
    expect(answer()).toHaveTextContent(
      'Sí, la tienes2 ejemplares del género Cattleya',
    )
    expect(
      within(answer()).getByRole('link', { name: 'Ver en mi colección' }),
    ).toHaveAttribute('href', '/coleccion?q=Cattleya')
  })

  it('cuenta las plantas con el nombre por validar, por el nombre ingresado', async () => {
    renderAt()
    await resolveLast()
    await ask('orquidea del abuelo')

    expect(answer()).toHaveTextContent(
      'Sí, la tienes1 ejemplar de Orquídea del abuelo',
    )
    expect(
      within(
        screen.getByRole('list', { name: 'Ejemplares que coinciden' }),
      ).getByRole('link'),
    ).toHaveAccessibleName(/Nombre por validar/)
  })

  it('mientras carga la colección, espera en lugar de responder que no', async () => {
    renderAt()
    await ask('Vanda coerulea')

    expect(answer()).toHaveTextContent('Cargando tu colección para responder…')
    expect(screen.queryByText(/Aún no la tienes/)).toBeNull()

    await resolveLast()
    expect(answer()).toHaveTextContent('Aún no la tienes')
  })

  describe('la consulta en la dirección', () => {
    it('lee ?q= al abrir, como al recargar', async () => {
      renderAt(['/ya-la-tengo?q=maxima'])
      await resolveLast()

      expect(field()).toHaveValue('maxima')
      expect(answer()).toHaveTextContent('Sí, la tienes')
    })

    it('escribe ?q= sustituyendo la entrada del historial', async () => {
      renderAt(['/inicio', '/ya-la-tengo'])
      await resolveLast()
      const user = await ask('phal')
      expect(location()).toBe('/ya-la-tengo?q=phal')
      expect(field()).toHaveFocus()

      await user.keyboard('{Escape}')
      expect(location()).toBe('/ya-la-tengo')

      await user.click(
        screen.getByRole('button', { name: 'Atrás del navegador' }),
      )
      expect(location()).toBe('/inicio')
    })
  })

  describe('«Volver a Mi colección»', () => {
    it('desde la colección, vuelve atrás y recupera su búsqueda y filtros', async () => {
      const user = userEvent.setup()
      renderAt([
        '/coleccion?q=vanda&estado=lost',
        { pathname: '/ya-la-tengo', state: FROM_INVENTORY },
      ])
      await resolveLast()
      // Escribir no pierde el origen (replace conserva el estado).
      await ask('maxima')

      await user.click(
        screen.getByRole('link', { name: 'Volver a Mi colección' }),
      )
      expect(location()).toBe('/coleccion?q=vanda&estado=lost')
    })

    it('abierta directamente, enlaza a /coleccion', async () => {
      const user = userEvent.setup()
      renderAt(['/inicio', '/ya-la-tengo'])
      await resolveLast()
      const back = screen.getByRole('link', { name: 'Volver a Mi colección' })
      expect(back).toHaveAttribute('href', '/coleccion')

      await user.click(back)
      expect(location()).toBe('/coleccion')
    })
  })

  describe('sin conexión', () => {
    it('con copia local: responde, dice cuándo se actualizó y no deja registrar', async () => {
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
      online = false
      renderAt(['/ya-la-tengo'], cached)
      await settle()
      await act(async () => {
        source.last().reject(new CollectionLoadError('offline'))
        await Promise.resolve()
      })

      const notice = screen.getAllByRole('status')[0]
      expect(notice).toHaveTextContent('Sin conexión')
      expect(notice).toHaveTextContent(/Última actualización: 20 de noviembre/)

      await ask('Vanda coerulea')
      expect(answer()).toHaveTextContent('Aún no la tienes')
      const register = screen.getByRole('button', {
        name: 'Registrarla con este nombre',
      })
      expect(register).toHaveAttribute('aria-disabled', 'true')
      expect(register).toHaveAccessibleDescription(/Sin conexión/)

      await ask('maxima')
      expect(answer()).toHaveTextContent('Sí, la tienes1 ejemplar')
      await expectNoAxeViolations()
    })

    it('sin copia: «Sin copia disponible», que no es «Aún no la tienes»', async () => {
      const cached = createCachedCollectionSource({
        network: source,
        storage: createMemoryCopyStorage(),
        fetchExtras: () => Promise.resolve({}),
        onSaved: () => {},
      })
      online = false
      renderAt(['/ya-la-tengo'], cached)
      await settle()
      await act(async () => {
        source.last().reject(new CollectionLoadError('offline'))
        await Promise.resolve()
      })

      expect(answer()).toHaveTextContent('Sin copia disponible')
      expect(answer()).toHaveTextContent(/abre Mi colección una vez/)
      await ask('Vanda coerulea')
      expect(screen.queryByText(/Aún no la tienes/)).toBeNull()
      expect(answer()).toHaveTextContent('Sin copia disponible')
      // El aviso de sin conexión no se repite: lo dice la respuesta.
      expect(screen.getAllByRole('status')[0]).toBeEmptyDOMElement()
      expect(
        screen.getByRole('button', { name: 'Reintentar' }),
      ).toBeInTheDocument()
      await expectNoAxeViolations()
    })
  })

  describe('evento de uso (#146)', () => {
    it('envía uno por búsqueda, con la respuesta y sin el texto', async () => {
      const view = renderAt()
      await resolveLast()
      await ask('Phalaenopsis amabilis')
      expect(recordProductEvent).not.toHaveBeenCalled()

      // Al salir de la pantalla cuenta la respuesta que se veía.
      view.unmount()
      expect(recordProductEvent).toHaveBeenCalledTimes(1)
      const event = vi.mocked(recordProductEvent).mock.calls[0][0]
      expect(event).toMatchObject({
        type: 'have_it_search',
        result: 'owned',
        generated_offline: false,
      })
      expect(JSON.stringify(event)).not.toMatch(/amabilis|phalaenopsis/i)
    })

    it('no cuenta una consulta que ya venía en la dirección', async () => {
      const view = renderAt(['/ya-la-tengo?q=maxima'])
      await resolveLast()
      expect(answer()).toHaveTextContent('Sí, la tienes')
      view.unmount()
      expect(recordProductEvent).not.toHaveBeenCalled()
    })

    it('sin conexión, el evento va marcado como generado sin conexión', async () => {
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
      online = false
      const view = renderAt(['/ya-la-tengo'], cached)
      await settle()
      await act(async () => {
        source.last().reject(new CollectionLoadError('offline'))
        await Promise.resolve()
      })
      await ask('Vanda coerulea')
      view.unmount()
      expect(recordProductEvent).toHaveBeenCalledTimes(1)
      expect(vi.mocked(recordProductEvent).mock.calls[0][0]).toMatchObject({
        result: 'not_owned',
        generated_offline: true,
      })
    })
  })
})
