import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountMenu } from '../auth/AccountMenu.tsx'
import {
  getOfflineIdentity,
  LAST_USER_KEY,
  PENDING_SIGN_OUT_KEY,
  rememberUser,
  resetOfflineIdentity,
} from '../auth/offline-identity.ts'
import { PendingSignOut } from '../auth/PendingSignOut.tsx'
import { RequireAuth } from '../auth/RouteGuards.tsx'
import { createCachedCollectionSource } from '../collection/cached-source.ts'
import { CollectionProvider } from '../collection/CollectionProvider.tsx'
import { createMemoryCopyStorage } from '../collection/local-copy.ts'
import type { CollectionPlant } from '../collection/model.ts'
import { DETAIL_TEXT, NOTES_TEXT } from '../detail/texts.ts'
import { THUMBNAIL_CACHE_PREFIX } from '../photos/read.ts'
import { PlantImagesContext } from '../photos/usePlantImage.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import { resetFakeClerk, setFakeClerk, signOut } from '../test/clerk-mock.tsx'
import { CATTLEYA, plant } from '../test/collection.ts'
import {
  fakeCollectionSource,
  type FakeCollectionSource,
} from '../test/collection-source.ts'
import { fakeImageSource } from '../test/plant-routes.tsx'
import { CollectionPage } from './CollectionPage.tsx'
import PlantDetailPage from './PlantDetailPage.tsx'

// Modo sin conexión (#18, #120) de punta a punta: Clerk sin cargar, el
// último usuario recordado y su copia local; solo lectura; cerrar sesión
// borra todo; otra cuenta no ve la copia de la anterior.

vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))

const AMABILIS = plant({
  id: '6f1c2a4e-8b3d-4e5f-9a7b-0c1d2e3f4a5b',
  displayName: 'Phalaenopsis amabilis',
  enteredName: 'Phalaenopsis amabilis',
})
const MAXIMA = plant({
  displayName: 'Cattleya maxima',
  enteredName: 'Cattleya maxima',
  genus: CATTLEYA,
  species: {
    id: 'species-maxima',
    scientificName: 'Cattleya maxima',
    type: 'species',
    status: 'validated',
  },
})
const SAVED_AT = '2026-11-20T08:00:00.000Z'

let network: FakeCollectionSource
let storage: ReturnType<typeof createMemoryCopyStorage>
let online = true

function setOnline(value: boolean) {
  online = value
  act(() => {
    window.dispatchEvent(new Event(value ? 'online' : 'offline'))
  })
}

beforeEach(() => {
  document.documentElement.lang = 'es'
  resetFakeClerk()
  resetOfflineIdentity()
  online = true
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  network = fakeCollectionSource()
  storage = createMemoryCopyStorage()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function saveCopy(
  userId: string,
  plants: readonly CollectionPlant[] = [AMABILIS, MAXIMA],
) {
  await storage.write({ userId, savedAt: SAVED_AT, plants, extras: {} })
}

let appTree: () => ReactElement

function renderApp(path = '/coleccion') {
  const source = createCachedCollectionSource({
    network,
    storage,
    fetchExtras: () => Promise.resolve({}),
    onSaved: () => {},
  })
  appTree = () => (
    <MemoryRouter initialEntries={[path]}>
      <PendingSignOut />
      <CollectionProvider source={source} thumbnailSync={null}>
        <PlantImagesContext value={fakeImageSource().source}>
          <header>
            <AccountMenu />
          </header>
          <main>
            <Routes>
              <Route path="/" element={<p>Inicio</p>} />
              <Route path="/iniciar-sesion" element={<p>Iniciar sesión</p>} />
              <Route element={<RequireAuth />}>
                <Route path="/coleccion" element={<CollectionPage />} />
                <Route
                  path="/coleccion/:plantId"
                  element={<PlantDetailPage />}
                />
              </Route>
            </Routes>
          </main>
        </PlantImagesContext>
      </CollectionProvider>
    </MemoryRouter>
  )
  return render(appTree())
}

/** Deja correr la lectura de la copia y los efectos. */
async function settle() {
  await act(async () => {
    for (let index = 0; index < 6; index += 1) await Promise.resolve()
  })
}

describe('sin conexión, abriendo la app desde cero', () => {
  beforeEach(async () => {
    // Clerk no cargó (sin red) y el navegador lo sabe.
    setFakeClerk({ status: 'error', signedIn: false })
    online = false
    rememberUser('user_a')
    await saveCopy('user_a')
  })

  it('muestra el inventario del último usuario en solo lectura, con la fecha', async () => {
    renderApp()
    await settle()
    // Sin Clerk no hay token: no se pide nada a la red, queda la copia.
    expect(network.loads).toHaveLength(0)
    expect(screen.getAllByRole('article')).toHaveLength(2)
    const notice = screen.getByText('Sin conexión', { selector: 'p' })
    expect(notice.parentElement).toHaveTextContent(
      'Ves la copia guardada en este dispositivo.',
    )
    expect(notice.parentElement).toHaveTextContent('Última actualización:')

    // Registrar, desactivado y con el motivo.
    const register = screen.getByRole('button', { name: 'Registrar orquídea' })
    expect(register).toHaveAttribute('aria-disabled', 'true')
    expect(register).toHaveAccessibleDescription(
      /para registrar, editar o dar de baja necesitas conexión/,
    )
    expect(
      screen.queryByRole('link', { name: 'Registrar orquídea' }),
    ).toBeNull()
    await expectNoAxeViolations()
  })

  it('el buscador funciona y «¿Ya la tengo?» sigue disponible', async () => {
    const user = userEvent.setup()
    renderApp()
    await settle()

    const search = screen.getByRole('searchbox', {
      name: 'Buscar en mi colección',
    })
    await user.type(search, 'cattleya max')
    expect(screen.getAllByRole('article')).toHaveLength(1)
    // La consulta tiene su propia pantalla (#209): el acceso no se desactiva.
    const check = screen.getByRole('link', { name: '¿Ya la tengo?' })
    expect(check).toHaveAttribute('href', '/ya-la-tengo')
    expect(check).not.toHaveAttribute('aria-disabled')
  })

  it('el detalle se ve, con editar, las notas, dar de baja y eliminar desactivados', async () => {
    const user = userEvent.setup()
    renderApp(`/coleccion/${AMABILIS.id}`)
    await settle()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Phalaenopsis amabilis',
    )
    // Un solo motivo, arriba, al que remiten todas (#265).
    expect(
      screen
        .getAllByRole('status')
        .filter((status) => status.textContent.includes(DETAIL_TEXT.offline)),
    ).toHaveLength(1)
    const edit = screen.getByRole('button', { name: DETAIL_TEXT.edit })
    const notes = screen.getByRole('button', { name: NOTES_TEXT.add })
    await user.click(
      screen.getByRole('button', { name: DETAIL_TEXT.actionsLabel }),
    )
    const actions = screen.getByRole('region', {
      name: DETAIL_TEXT.actionsLabel,
    })
    for (const button of [
      edit,
      notes,
      within(actions).getByRole('button', { name: DETAIL_TEXT.retire }),
      within(actions).getByRole('button', { name: DETAIL_TEXT.delete }),
    ]) {
      expect(button).toHaveAttribute('aria-disabled', 'true')
      expect(button).toHaveAccessibleDescription(DETAIL_TEXT.offline)
    }
    await user.click(notes)
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('cerrar sesión sin conexión borra la copia, el usuario recordado y las miniaturas', async () => {
    const deleted: string[] = []
    vi.stubGlobal('caches', {
      keys: () => Promise.resolve([`${THUMBNAIL_CACHE_PREFIX}user_a`]),
      delete: (name: string) => {
        deleted.push(name)
        return Promise.resolve(true)
      },
    })
    const user = userEvent.setup()
    renderApp()
    await settle()
    expect(screen.getAllByRole('article')).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Tu cuenta' }))
    await user.click(screen.getByRole('menuitem', { name: 'Cerrar sesión' }))
    await settle()

    expect(screen.getByText('Inicio')).toBeInTheDocument()
    expect(storage.copies.size).toBe(0)
    expect(localStorage.getItem(LAST_USER_KEY)).toBeNull()
    expect(deleted).toEqual([`${THUMBNAIL_CACHE_PREFIX}user_a`])
    // Clerk no estaba: el cierre queda pendiente para cuando vuelva.
    expect(signOut).not.toHaveBeenCalled()
    expect(localStorage.getItem(PENDING_SIGN_OUT_KEY)).toBe('user_a')
    expect(screen.queryByRole('article')).toBeNull()
  })
})

describe('con Clerk de vuelta', () => {
  it('si Clerk ya no tiene sesión, se borra la copia del usuario anterior', async () => {
    rememberUser('user_a')
    await saveCopy('user_a')
    setFakeClerk({ status: 'ready', signedIn: false })
    renderApp()
    await settle()
    expect(storage.copies.size).toBe(0)
    expect(getOfflineIdentity().lastUserId).toBeNull()
    expect(
      screen.getByText('Iniciar sesión', { selector: 'p' }),
    ).toBeInTheDocument()
  })

  it('otra cuenta en el mismo dispositivo nunca ve la copia de la anterior', async () => {
    rememberUser('user_a')
    await saveCopy('user_a')
    setFakeClerk({ status: 'ready', signedIn: true, userId: 'user_b' })
    renderApp()
    await settle()
    expect(network.last().request.userId).toBe('user_b')
    expect(screen.queryByRole('article')).toBeNull()
    expect(storage.copies.has('user_a')).toBe(false)
    expect(getOfflineIdentity().lastUserId).toBe('user_b')

    await act(async () => {
      network.last().resolve([MAXIMA])
      await Promise.resolve()
    })
    expect(screen.getAllByRole('article')).toHaveLength(1)
  })

  it('termina con Clerk un cierre de sesión hecho sin conexión', async () => {
    localStorage.setItem(PENDING_SIGN_OUT_KEY, 'user_a')
    resetOfflineIdentity()
    setFakeClerk({ status: 'ready', signedIn: true, userId: 'user_a' })
    renderApp()
    await settle()
    // Mientras tanto, la app lo trata como sin sesión.
    expect(screen.getByText('Inicio')).toBeInTheDocument()
    expect(screen.queryByRole('article')).toBeNull()
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('con sesión y sin conexión: solo lectura con el motivo', async () => {
    setFakeClerk({ status: 'ready', signedIn: true, userId: 'user_a' })
    renderApp()
    await settle()
    await act(async () => {
      network.last().resolve([AMABILIS])
      await Promise.resolve()
    })
    expect(
      screen.getByRole('link', { name: 'Registrar orquídea' }),
    ).toBeInTheDocument()

    setOnline(false)
    expect(
      screen.getByRole('button', { name: 'Registrar orquídea' }),
    ).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByText('Sin conexión', { selector: 'p' }),
    ).toBeInTheDocument()

    // Cerrar sesión sin conexión: borra igual, y Clerk lo sabrá después.
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Tu cuenta' }))
    await user.click(screen.getByRole('menuitem', { name: 'Cerrar sesión' }))
    await settle()
    expect(storage.copies.size).toBe(0)
    expect(signOut).not.toHaveBeenCalled()

    // Al volver la red, PendingSignOut se lo pide a Clerk.
    setOnline(true)
    await settle()
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('con sesión y conexión, cerrar sesión se lo pide a Clerk enseguida', async () => {
    setFakeClerk({ status: 'ready', signedIn: true, userId: 'user_a' })
    await saveCopy('user_a')
    renderApp()
    await settle()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Tu cuenta' }))
    await user.click(screen.getByRole('menuitem', { name: 'Cerrar sesión' }))
    await settle()
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(storage.copies.size).toBe(0)
  })
})

describe('Clerk no cargó aunque hay conexión', () => {
  it('muestra la copia como sesión sin confirmar, en solo lectura, sin pedir nada a la red', async () => {
    setFakeClerk({ status: 'error', signedIn: false })
    rememberUser('user_a')
    await saveCopy('user_a')
    const { rerender } = renderApp()
    await settle()
    // Sin token, la red devolvería una colección vacía y pisaría la copia.
    expect(network.loads).toHaveLength(0)
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(screen.getByText('Sesión sin confirmar')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Registrar orquídea' }),
    ).toHaveAttribute('aria-disabled', 'true')
    expect(storage.copies.has('user_a')).toBe(true)

    // Clerk carga y confirma al mismo usuario: se lee de la red.
    setFakeClerk({ status: 'ready', signedIn: true, userId: 'user_a' })
    rerender(appTree())
    await settle()
    expect(network.loads).toHaveLength(1)
    await act(async () => {
      network.last().resolve([AMABILIS])
      await Promise.resolve()
    })
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.queryByText('Sesión sin confirmar')).toBeNull()
    expect(
      screen.getByRole('link', { name: 'Registrar orquídea' }),
    ).toBeInTheDocument()
  })
})

describe('sin conexión y sin usuario recordado', () => {
  it('se ve el aviso de siempre, sin datos', async () => {
    setFakeClerk({ status: 'error', signedIn: false })
    online = false
    await saveCopy('user_a')
    renderApp()
    await settle()
    expect(screen.getByRole('alert')).toHaveTextContent('Sin conexión')
    expect(network.loads).toHaveLength(0)
  })
})
