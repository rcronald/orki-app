import 'fake-indexeddb/auto'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LAST_USER_KEY,
  rememberUser,
  resetOfflineIdentity,
} from '../auth/offline-identity.ts'
import { PendingSignOut } from '../auth/PendingSignOut.tsx'
import { RequireAuth } from '../auth/RouteGuards.tsx'
import { createCachedCollectionSource } from '../collection/cached-source.ts'
import { CollectionProvider } from '../collection/CollectionProvider.tsx'
import { createIndexedDbCopyStorage } from '../collection/local-copy.ts'
import { PREFERENCES_KEY } from '../inventory/preferences.ts'
import {
  accountDeletionMarkerKey,
  resetAccountDeletionMarkers,
} from '../lib/account-deletion-marker.ts'
import { AccountPage } from '../pages/AccountPage.tsx'
import { HomeRoute } from '../pages/HomeRoute.tsx'
import { THUMBNAIL_CACHE_PREFIX } from '../photos/read.ts'
import { plantDraftKey } from '../registration/draft.ts'
import {
  createIndexedDbDraftPhotoBackend,
  type DraftPhoto,
} from '../registration/draft-photo.ts'
import {
  deleteUser,
  fakeClerk,
  FAKE_USER_ID,
  resetFakeClerk,
  setActive,
  setFakeClerk,
  signOut,
} from '../test/clerk-mock.tsx'
import { fakeCollectionSource } from '../test/collection-source.ts'
import { plant } from '../test/collection.ts'
import { haveItSearchEvent, type ProductEvent } from '../telemetry/events.ts'
import {
  recordProductEvent,
  setProductEventsRuntimeLoader,
} from '../telemetry/product-events.ts'
import { ProductEventsSync } from '../telemetry/ProductEventsSync.tsx'
import { createIndexedDbEventQueue } from '../telemetry/queue.ts'
import { createProductEventsRuntime } from '../telemetry/runtime.ts'
import type { SendOutcome } from '../telemetry/sender.ts'
import { AccountDeletionGate } from './AccountDeletionGate.tsx'
import { setAccountDeletionPhase } from './deletion-status.ts'

// Eliminación de la cuenta de punta a punta en el dispositivo (#110): la app
// real (identidad, colección con su copia en IndexedDB, eventos de uso con su
// cola en IndexedDB, cierre de sesión pendiente) con Clerk simulado y los
// pasos de datos simulados (sin red). IndexedDB: fake-indexeddb, con las
// mismas bases que la app.

vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))

const USER = FAKE_USER_ID
const NOW = new Date()

const order: string[] = []
const dataEffects = {
  deletePhotos: (userId: string) => {
    order.push(`photos:${userId}`)
    return Promise.resolve()
  },
  deletePlants: (userId: string) => {
    order.push(`plants:${userId}`)
    return Promise.resolve()
  },
  deleteProfile: (userId: string) => {
    order.push(`profile:${userId}`)
    return Promise.resolve()
  },
}

function searchEvent(id: string): ProductEvent {
  const event = haveItSearchEvent({
    id,
    durationMs: 900,
    outcome: 'owned',
    offline: false,
    occurredAt: NOW,
  })
  if (event === null) throw new Error('evento inválido')
  return event
}

/** Cache Storage mínimo: solo los nombres de las cachés. */
function fakeCaches(names: string[]) {
  const stores = new Set(names)
  vi.stubGlobal('caches', {
    keys: () => Promise.resolve([...stores]),
    has: (name: string) => Promise.resolve(stores.has(name)),
    delete: (name: string) => Promise.resolve(stores.delete(name)),
    open: () => Promise.reject(new Error('sin uso en esta prueba')),
  })
  return stores
}

let send: ReturnType<
  typeof vi.fn<
    (
      events: readonly ProductEvent[],
      signal: AbortSignal,
    ) => Promise<SendOutcome>
  >
>

beforeEach(() => {
  resetFakeClerk()
  setFakeClerk({ signedIn: true })
  resetOfflineIdentity()
  document.documentElement.lang = 'es'
  document.title = 'orqui.apps'
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  order.length = 0
  deleteUser.mockImplementation(() => {
    order.push('clerk')
    fakeClerk.signedIn = false
    return Promise.resolve()
  })
  // El servidor de eventos no responde: lo pendiente se queda en la cola.
  send = vi.fn(() => {
    order.push('envío de eventos')
    return Promise.resolve<SendOutcome>('retry')
  })
  setProductEventsRuntimeLoader(() =>
    Promise.resolve(
      createProductEventsRuntime({
        storage: createIndexedDbEventQueue(),
        send,
      }),
    ),
  )
})

afterEach(() => {
  setProductEventsRuntimeLoader(null)
  resetAccountDeletionMarkers()
  setAccountDeletionPhase('idle')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function renderApp() {
  const source = createCachedCollectionSource({
    network: fakeCollectionSource(),
    storage: createIndexedDbCopyStorage(),
    fetchExtras: () => Promise.resolve({}),
    onSaved: () => {},
  })
  render(
    <MemoryRouter initialEntries={['/cuenta']}>
      <PendingSignOut />
      <ProductEventsSync />
      <CollectionProvider source={source} thumbnailSync={null}>
        <Routes>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/iniciar-sesion" element={<p>Pantalla de acceso</p>} />
          <Route element={<AccountDeletionGate />}>
            <Route element={<RequireAuth />}>
              <Route
                path="/cuenta"
                element={<AccountPage dataEffects={dataEffects} />}
              />
            </Route>
          </Route>
        </Routes>
      </CollectionProvider>
    </MemoryRouter>,
  )
}

describe('eliminar la cuenta no deja nada del usuario en el dispositivo', () => {
  it('borra la copia, las miniaturas, el usuario recordado, la cola de eventos, el borrador y las preferencias', async () => {
    const user = userEvent.setup()
    // Lo que el dispositivo tiene de esta cuenta antes de eliminarla.
    await createIndexedDbCopyStorage().write({
      userId: USER,
      savedAt: NOW.toISOString(),
      plants: [plant()],
      extras: {},
    })
    await createIndexedDbEventQueue().add(USER, searchEvent('e1'), NOW)
    const draftPhotos = createIndexedDbDraftPhotoBackend()
    await draftPhotos.put(USER, {
      plantId: 'planta-borrador',
      savedAt: NOW.getTime(),
      fileName: 'foto.jpg',
    } as unknown as DraftPhoto)
    localStorage.setItem(plantDraftKey(USER), '{}')
    localStorage.setItem(PREFERENCES_KEY, '{"view":"grid"}')
    const thumbnails = fakeCaches([
      `${THUMBNAIL_CACHE_PREFIX}${USER}`,
      'workbox-precache-v2-https://orki.test/',
    ])

    renderApp()
    // Con sesión: la app recuerda al usuario e intenta enviar sus eventos.
    await vi.waitFor(() =>
      expect(localStorage.getItem(LAST_USER_KEY)).toBe(USER),
    )
    await vi.waitFor(() => expect(send).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: 'Eliminar mi cuenta' }))
    const dialog = screen.getByRole('dialog')
    await user.type(
      within(dialog).getByLabelText('Para confirmar, escribe ELIMINAR'),
      'ELIMINAR',
    )
    await user.click(
      within(dialog).getByRole('button', {
        name: 'Eliminar mi cuenta para siempre',
      }),
    )
    // Un evento que llegue durante la eliminación se descarta.
    recordProductEvent(searchEvent('e2'))

    expect(await screen.findByText(/Tu cuenta se eliminó/)).toBeInTheDocument()

    // Servidor: en orden, y ningún envío de eventos desde que empezó.
    const firstStep = order.indexOf(`photos:${USER}`)
    expect(order.slice(firstStep)).toEqual([
      `photos:${USER}`,
      `plants:${USER}`,
      `profile:${USER}`,
      'clerk',
    ])
    expect(setActive).toHaveBeenCalledWith({ session: null })

    // Dispositivo.
    await vi.waitFor(async () => {
      expect(await createIndexedDbCopyStorage().read(USER)).toBeNull()
      expect(await createIndexedDbEventQueue().read(USER, NOW)).toEqual([])
      expect(await draftPhotos.keys()).toEqual([])
      expect([...thumbnails]).toEqual([
        'workbox-precache-v2-https://orki.test/',
      ])
    })
    expect(localStorage.getItem(LAST_USER_KEY)).toBeNull()
    expect(localStorage.getItem(plantDraftKey(USER))).toBeNull()
    expect(localStorage.getItem(PREFERENCES_KEY)).toBeNull()
    expect(localStorage.getItem(accountDeletionMarkerKey(USER))).toBeNull()

    // Y nada de esta cuenta se envía después.
    const sends = send.mock.calls.length
    recordProductEvent(searchEvent('e3'))
    window.dispatchEvent(new Event('online'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(send.mock.calls.length).toBe(sends)
    expect(await createIndexedDbEventQueue().read(USER, NOW)).toEqual([])
  })

  it('si Clerk sigue con la sesión abierta, la app ya la trata como cerrada y se la pide cerrar', async () => {
    const user = userEvent.setup()
    // user.delete() termina, pero el cliente de Clerk no suelta la sesión.
    deleteUser.mockImplementation(() => {
      order.push('clerk')
      return Promise.resolve()
    })
    setActive.mockRejectedValue(new Error('sesión inexistente'))
    renderApp()
    await vi.waitFor(() =>
      expect(localStorage.getItem(LAST_USER_KEY)).toBe(USER),
    )

    await user.click(screen.getByRole('button', { name: 'Eliminar mi cuenta' }))
    const dialog = screen.getByRole('dialog')
    await user.type(
      within(dialog).getByLabelText('Para confirmar, escribe ELIMINAR'),
      'ELIMINAR',
    )
    await user.click(
      within(dialog).getByRole('button', {
        name: 'Eliminar mi cuenta para siempre',
      }),
    )

    expect(await screen.findByText(/Tu cuenta se eliminó/)).toBeInTheDocument()
    expect(localStorage.getItem(LAST_USER_KEY)).toBeNull()
    // PendingSignOut: el cierre de sesión de la app termina en Clerk.
    await vi.waitFor(() => expect(signOut).toHaveBeenCalled())
  })

  it('con la sesión sin confirmar queda deshabilitada: explica por qué y no borra nada', async () => {
    setFakeClerk({ status: 'error', signedIn: false })
    rememberUser(USER)
    renderApp()

    // La pantalla se abre (#214); el botón, deshabilitado con el motivo.
    const button = await screen.findByRole('button', {
      name: 'Eliminar mi cuenta',
    })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription(/No se pudo confirmar tu sesión/)
    expect(order).toEqual([])
    expect(localStorage.getItem(LAST_USER_KEY)).toBe(USER)
  })
})
