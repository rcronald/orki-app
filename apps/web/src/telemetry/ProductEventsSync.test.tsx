import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountMenu } from '../auth/AccountMenu.tsx'
import { rememberUser, resetOfflineIdentity } from '../auth/offline-identity.ts'
import { RequireAuth } from '../auth/RouteGuards.tsx'
import { createCachedCollectionSource } from '../collection/cached-source.ts'
import {
  clearAccountDeletionMarker,
  markAccountDeletionStarted,
  resetAccountDeletionMarkers,
} from '../lib/account-deletion-marker.ts'
import { CollectionProvider } from '../collection/CollectionProvider.tsx'
import { createMemoryCopyStorage } from '../collection/local-copy.ts'
import { useCollection } from '../collection/useCollection.ts'
import { useCollectionCopy } from '../collection/useCollectionCopy.ts'
import { useReadOnly } from '../collection/useReadOnly.ts'
import { SearchField } from '../components/ui/SearchField.tsx'
import { OwnershipPanel } from '../inventory/OwnershipPanel.tsx'
import { PlantImagesContext } from '../photos/usePlantImage.ts'
import { resetFakeClerk, setFakeClerk } from '../test/clerk-mock.tsx'
import { CATTLEYA, plant } from '../test/collection.ts'
import { fakeCollectionSource } from '../test/collection-source.ts'
import { fakeImageSource } from '../test/plant-routes.tsx'
import type { ProductEvent } from './events.ts'
import { setProductEventsRuntimeLoader } from './product-events.ts'
import { ProductEventsSync } from './ProductEventsSync.tsx'
import { createMemoryEventQueue } from './queue.ts'
import { createProductEventsRuntime } from './runtime.ts'
import type { SendOutcome } from './sender.ts'
import { useHaveItSearchEvents } from './useHaveItSearchEvents.ts'

// Los eventos de producto de punta a punta (#146), con la app real hasta la
// cola y el envío: la cola en memoria y el envío simulado (sin red). Clerk
// simulado, como en pages/OfflineMode.test.tsx.
//
// La consulta «¿Ya la tengo?» salió del inventario (#208) y tendrá su propia
// pantalla (#209). Mientras tanto, la pantalla de la prueba monta las mismas
// piezas que usaba el inventario (OwnershipPanel con useHaveItSearchEvents,
// sobre la colección compartida) para seguir probando el camino del evento.

vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))

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

// Consulta provisional: el buscador y la respuesta, con su medición.
function HaveItScreen() {
  const { plants } = useCollection()
  const extras = useCollectionCopy()?.extras
  const readOnly = useReadOnly()
  const [query, setQuery] = useState('')
  const onMeasure = useHaveItSearchEvents({
    searching: query.trim() !== '',
    offline: readOnly !== null,
  })
  return (
    <main>
      <SearchField
        label="Buscar en tu colección"
        value={query}
        onValueChange={setQuery}
      />
      <OwnershipPanel
        plants={plants}
        query={query}
        extras={extras}
        searchSpecies={null}
        onMeasure={onMeasure}
      />
    </main>
  )
}

let online = true
let queue: ReturnType<typeof createMemoryEventQueue>
let copies: ReturnType<typeof createMemoryCopyStorage>
let send: ReturnType<
  typeof vi.fn<
    (
      events: readonly ProductEvent[],
      signal: AbortSignal,
    ) => Promise<SendOutcome>
  >
>

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
  queue = createMemoryEventQueue()
  copies = createMemoryCopyStorage()
  send = vi.fn(() => Promise.resolve<SendOutcome>('sent'))
  setProductEventsRuntimeLoader(() =>
    Promise.resolve(createProductEventsRuntime({ storage: queue, send })),
  )
})

afterEach(() => {
  resetAccountDeletionMarkers()
  setProductEventsRuntimeLoader(null)
  vi.restoreAllMocks()
})

function app() {
  const source = createCachedCollectionSource({
    network: fakeCollectionSource(),
    storage: copies,
    fetchExtras: () => Promise.resolve({}),
    onSaved: () => {},
  })
  return (
    <MemoryRouter initialEntries={['/coleccion']}>
      <ProductEventsSync />
      <CollectionProvider source={source} thumbnailSync={null}>
        <PlantImagesContext value={fakeImageSource().source}>
          <AccountMenu />
          <Routes>
            <Route path="/" element={<p>Inicio</p>} />
            <Route element={<RequireAuth />}>
              <Route path="/coleccion" element={<HaveItScreen />} />
            </Route>
          </Routes>
        </PlantImagesContext>
      </CollectionProvider>
    </MemoryRouter>
  )
}

async function settle() {
  await act(async () => {
    for (let index = 0; index < 10; index += 1) await Promise.resolve()
  })
}

/** Busca en el inventario y deja la app en segundo plano: la respuesta cuenta. */
async function searchAndHide(text: string) {
  const user = userEvent.setup()
  await user.type(
    screen.getByRole('searchbox', { name: 'Buscar en tu colección' }),
    text,
  )
  const visibility = vi
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('hidden')
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  visibility.mockRestore()
  await settle()
}

describe('eventos de producto en la app', () => {
  it('una búsqueda sin conexión se envía al volver la red y la sesión, marcada y con su hora', async () => {
    // Sin red y sin Clerk: la copia del último usuario, en solo lectura.
    setFakeClerk({ status: 'error', signedIn: false })
    online = false
    rememberUser('user_a')
    await copies.write({
      userId: 'user_a',
      savedAt: SAVED_AT,
      plants: [MAXIMA],
      extras: {},
    })
    const view = render(app())
    await settle()
    await searchAndHide('cattleya max')

    expect(send).not.toHaveBeenCalled()
    const [queued] = queue.queues.get('user_a') ?? []
    expect(queued).toMatchObject({
      type: 'have_it_search',
      result: 'owned',
      generated_offline: true,
    })
    // Nunca el texto buscado ni el nombre de la planta.
    expect(JSON.stringify(queued)).not.toMatch(/cattleya|maxima/i)

    // Vuelven la red y Clerk, con la sesión del mismo usuario.
    setFakeClerk({ status: 'ready', signedIn: true, userId: 'user_a' })
    setOnline(true)
    view.rerender(app())
    await settle()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[0]).toEqual([queued])
    expect(queue.queues.size).toBe(0)
  })

  it('cerrar sesión sin conexión borra la cola: no se envía con otra cuenta', async () => {
    setFakeClerk({ status: 'error', signedIn: false })
    online = false
    rememberUser('user_a')
    await copies.write({
      userId: 'user_a',
      savedAt: SAVED_AT,
      plants: [MAXIMA],
      extras: {},
    })
    const view = render(app())
    await settle()
    await searchAndHide('cattleya')
    expect(queue.queues.get('user_a')).toHaveLength(1)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Tu cuenta' }))
    await user.click(screen.getByRole('menuitem', { name: 'Cerrar sesión' }))
    await settle()
    expect(queue.queues.size).toBe(0)

    // Vuelve la red y entra otra cuenta.
    setFakeClerk({ status: 'ready', signedIn: true, userId: 'user_b' })
    setOnline(true)
    view.rerender(app())
    await settle()
    expect(send).not.toHaveBeenCalled()
  })

  it('un fallo al enviar no se ve y se reintenta', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      send.mockResolvedValueOnce('retry')
      setFakeClerk({ status: 'ready', signedIn: true, userId: 'user_a' })
      online = false
      rememberUser('user_a')
      await copies.write({
        userId: 'user_a',
        savedAt: SAVED_AT,
        plants: [MAXIMA],
        extras: {},
      })
      const view = render(app())
      await settle()
      await searchAndHide('cattleya')
      setOnline(true)
      view.rerender(app())
      await settle()
      expect(send).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('alert')).toBeNull()
      expect(queue.queues.get('user_a')).toHaveLength(1)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000)
      })
      expect(send).toHaveBeenCalledTimes(2)
      expect(queue.queues.size).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('con la eliminación de la cuenta en curso no registra ni envía; si la persona sigue, vuelve (#110)', async () => {
    setFakeClerk({ status: 'ready', signedIn: true, userId: 'user_a' })
    await copies.write({
      userId: 'user_a',
      savedAt: SAVED_AT,
      plants: [MAXIMA],
      extras: {},
    })
    render(app())
    await settle()

    act(() => markAccountDeletionStarted('user_a'))
    await settle()
    await searchAndHide('cattleya')
    expect(send).not.toHaveBeenCalled()
    expect(queue.queues.size).toBe(0)

    // «Seguir usando Orki»: la marca se quita y los eventos vuelven.
    act(() => clearAccountDeletionMarker('user_a'))
    await settle()
    // Otra búsqueda (la anterior ya no cuenta).
    await userEvent
      .setup()
      .clear(screen.getByRole('searchbox', { name: 'Buscar en tu colección' }))
    await settle()
    await searchAndHide('maxima')
    expect(send).toHaveBeenCalledTimes(1)
  })
})
