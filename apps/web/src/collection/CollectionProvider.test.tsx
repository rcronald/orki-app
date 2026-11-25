import { act, render, screen, waitFor } from '@testing-library/react'
import { StrictMode, useEffect, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFakeClerk, setFakeClerk } from '../test/clerk-mock.tsx'
import { plant } from '../test/collection.ts'
import {
  fakeCollectionSource,
  type FakeCollectionSource,
} from '../test/collection-source.ts'
import { createCachedCollectionSource } from './cached-source.ts'
import { CollectionProvider } from './CollectionProvider.tsx'
import type { ExtrasFetcher } from './extras-source.ts'
import { createMemoryCopyStorage } from './local-copy.ts'
import { countPlants } from './selectors.ts'
import { CollectionLoadError } from './source.ts'
import { COLLECTION_REFRESH_AFTER_MS } from './store.ts'
import { useCollection, type CollectionApi } from './useCollection.ts'
import {
  useCollectionCopy,
  useExtrasState,
  useRetryExtras,
} from './useCollectionCopy.ts'

vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))

let source: FakeCollectionSource

beforeEach(() => {
  resetFakeClerk()
  setFakeClerk({ signedIn: true, userId: 'user_a' })
  source = fakeCollectionSource()
})

/** Muestra el estado de la colección con un nombre propio por pantalla. */
function Screen({ name }: { name: string }) {
  const { status, plants, error } = useCollection()
  return (
    <p data-testid={name}>
      {status}:{plants === null ? '-' : countPlants(plants)}:
      {error?.reason ?? ''}
    </p>
  )
}

let api: CollectionApi | undefined
function ApiProbe() {
  const current = useCollection()
  useEffect(() => {
    api = current
  }, [current])
  return null
}

function Tree({
  children,
  strict = false,
}: {
  children: ReactNode
  strict?: boolean
}) {
  const tree = (
    <CollectionProvider source={source}>{children}</CollectionProvider>
  )
  return strict ? <StrictMode>{tree}</StrictMode> : tree
}

const text = (name: string) => screen.getByTestId(name).textContent

async function resolveLast(plants = [plant()]) {
  await source.respond(plants)
}

describe('CollectionProvider y useCollection', () => {
  it('no lee nada al montarse si ninguna pantalla la usa', () => {
    render(
      <Tree>
        <p>Inicio</p>
      </Tree>,
    )
    expect(source.loads).toHaveLength(0)
  })

  it('dos pantallas comparten una sola petición y los mismos datos, también con StrictMode', async () => {
    render(
      <Tree strict>
        <Screen name="lista" />
        <Screen name="contador" />
      </Tree>,
    )

    expect(source.loads).toHaveLength(1)
    expect(source.last().request.userId).toBe('user_a')
    expect(text('lista')).toBe('loading:-:')

    await resolveLast([plant(), plant(), plant({ status: 'lost' })])
    expect(text('lista')).toBe('ready:2:')
    expect(text('contador')).toBe('ready:2:')
  })

  it('una pantalla que se monta después reutiliza los datos sin otra petición', async () => {
    const { rerender } = render(
      <Tree>
        <Screen name="lista" />
      </Tree>,
    )
    await resolveLast()

    // Se navega a otra pantalla: la primera se desmonta.
    rerender(
      <Tree>
        <Screen name="detalle" />
      </Tree>,
    )
    expect(text('detalle')).toBe('ready:1:')
    expect(source.loads).toHaveLength(1)
  })

  it('al cambiar de usuario descarta la colección y lee la del nuevo', async () => {
    const { rerender } = render(
      <Tree>
        <Screen name="lista" />
      </Tree>,
    )
    await resolveLast([plant(), plant()])
    expect(text('lista')).toBe('ready:2:')

    setFakeClerk({ userId: 'user_b' })
    rerender(
      <Tree>
        <Screen name="lista" />
      </Tree>,
    )
    // Nunca se pintan los datos de A con la sesión de B.
    expect(text('lista')).toBe('loading:-:')
    expect(source.loads).toHaveLength(2)
    expect(source.last().request.userId).toBe('user_b')

    await resolveLast([plant()])
    expect(text('lista')).toBe('ready:1:')
  })

  it('al cerrar sesión descarta la colección y no lee nada', async () => {
    const { rerender } = render(
      <Tree>
        <Screen name="lista" />
      </Tree>,
    )
    await resolveLast()

    setFakeClerk({ signedIn: false })
    rerender(
      <Tree>
        <Screen name="lista" />
      </Tree>,
    )
    expect(text('lista')).toBe('idle:-:')
    expect(source.loads).toHaveLength(1)
  })

  it('mientras Clerk recarga la sesión, conserva la colección', async () => {
    const { rerender } = render(
      <Tree>
        <Screen name="lista" />
      </Tree>,
    )
    await resolveLast()

    setFakeClerk({ status: 'loading' })
    rerender(
      <Tree>
        <Screen name="lista" />
      </Tree>,
    )
    setFakeClerk({ status: 'ready' })
    rerender(
      <Tree>
        <Screen name="lista" />
      </Tree>,
    )
    expect(text('lista')).toBe('ready:1:')
    expect(source.loads).toHaveLength(1)
  })

  it('la respuesta tardía del usuario anterior se ignora', async () => {
    const { rerender } = render(
      <Tree>
        <Screen name="lista" />
      </Tree>,
    )
    const fromA = source.last()

    setFakeClerk({ userId: 'user_b' })
    rerender(
      <Tree>
        <Screen name="lista" />
      </Tree>,
    )
    expect(fromA.request.signal.aborted).toBe(true)

    await act(async () => {
      fromA.resolve([plant(), plant(), plant()])
      await Promise.resolve()
    })
    expect(text('lista')).toBe('loading:-:')

    await resolveLast([plant()])
    expect(text('lista')).toBe('ready:1:')
  })

  it('muestra el motivo del error y reload() vuelve a leer', async () => {
    render(
      <Tree>
        <Screen name="lista" />
        <ApiProbe />
      </Tree>,
    )
    await source.fail(new CollectionLoadError('offline'))
    expect(text('lista')).toBe('error:-:offline')

    act(() => api?.reload())
    expect(source.loads).toHaveLength(2)
    expect(text('lista')).toBe('loading:-:')
    await resolveLast()
    expect(text('lista')).toBe('ready:1:')
  })

  it('al volver a la app tras un rato en segundo plano, actualiza la colección sin pasar por loading (#141)', async () => {
    let visibility: DocumentVisibilityState = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
      () => visibility,
    )
    const now = vi.spyOn(Date, 'now')
    const setVisibility = (value: DocumentVisibilityState, at: number) => {
      now.mockReturnValue(at)
      visibility = value
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
    }
    render(
      <Tree>
        <Screen name="lista" />
      </Tree>,
    )
    await resolveLast([plant({ id: 'a' })])

    // Un momento en segundo plano: no se vuelve a leer.
    setVisibility('hidden', 1_000)
    setVisibility('visible', 1_000 + COLLECTION_REFRESH_AFTER_MS - 1)
    expect(source.loads).toHaveLength(1)

    // Un rato: se vuelve a leer y se siguen viendo los datos mientras tanto.
    setVisibility('hidden', 10_000)
    setVisibility('visible', 10_000 + COLLECTION_REFRESH_AFTER_MS)
    expect(source.loads).toHaveLength(2)
    expect(text('lista')).toBe('ready:1:')
    await resolveLast([plant({ id: 'a' }), plant({ id: 'b' })])
    expect(text('lista')).toBe('ready:2:')
    now.mockRestore()
  })

  it('upsertPlant y removePlant actualizan todas las pantallas sin otra petición', async () => {
    render(
      <Tree>
        <Screen name="lista" />
        <ApiProbe />
      </Tree>,
    )
    await resolveLast([plant({ id: 'a' })])

    act(() => api?.upsertPlant(plant({ id: 'b' })))
    expect(text('lista')).toBe('ready:2:')
    act(() => api?.removePlant('a'))
    expect(text('lista')).toBe('ready:1:')
    expect(source.loads).toHaveLength(1)
  })

  it('una escritura que termina después de cambiar de usuario no toca la colección del nuevo', async () => {
    const { rerender } = render(
      <Tree>
        <Screen name="lista" />
        <ApiProbe />
      </Tree>,
    )
    await resolveLast([plant()])
    // Funciones obtenidas con la sesión de A (una escritura en curso).
    const upsertFromA = api?.upsertPlant

    setFakeClerk({ userId: 'user_b' })
    rerender(
      <Tree>
        <Screen name="lista" />
        <ApiProbe />
      </Tree>,
    )
    await resolveLast([])

    act(() => upsertFromA?.(plant({ id: 'de-a' })))
    expect(text('lista')).toBe('ready:0:')
  })

  it('fuera de un CollectionProvider, falla con un mensaje claro', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => render(<Screen name="suelta" />)).toThrow(
        'useCollection() necesita un <CollectionProvider>.',
      )
    } finally {
      error.mockRestore()
    }
  })
})

describe('CollectionProvider con copia local (#18)', () => {
  function CopyScreen() {
    const { status, plants } = useCollection()
    const copy = useCollectionCopy()
    return (
      <p data-testid="copia">
        {status}:{plants === null ? '-' : plants.length}:
        {copy === null ? 'sin-copia' : `${copy.userId}@${copy.savedAt ?? ''}`}
        {copy?.unreachable ? `:${copy.unreachable}` : ''}
      </p>
    )
  }

  function cached() {
    const storage = createMemoryCopyStorage()
    const cachedSource = createCachedCollectionSource({
      network: source,
      storage,
      fetchExtras: () => Promise.resolve({}),
      now: () => new Date('2026-11-21T12:00:00.000Z'),
      onSaved: () => {},
    })
    return { storage, cachedSource }
  }

  it('muestra la copia guardada sin esperar a la red y dice de cuándo es', async () => {
    const { storage, cachedSource } = cached()
    await storage.write({
      userId: 'user_a',
      savedAt: '2026-11-20T08:00:00.000Z',
      plants: [plant(), plant()],
      extras: {},
    })
    render(
      <CollectionProvider source={cachedSource}>
        <CopyScreen />
      </CollectionProvider>,
    )
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(text('copia')).toBe('loading:2:user_a@2026-11-20T08:00:00.000Z')

    await resolveLast([plant()])
    expect(text('copia')).toBe('ready:1:user_a@2026-11-21T12:00:00.000Z')
  })

  it('al cerrar sesión borra las copias guardadas', async () => {
    const { storage, cachedSource } = cached()
    await storage.write({
      userId: 'user_a',
      savedAt: '2026-11-20T08:00:00.000Z',
      plants: [plant()],
      extras: {},
    })
    const { rerender } = render(
      <CollectionProvider source={cachedSource}>
        <CopyScreen />
      </CollectionProvider>,
    )
    setFakeClerk({ signedIn: false })
    rerender(
      <CollectionProvider source={cachedSource}>
        <CopyScreen />
      </CollectionProvider>,
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(storage.copies.size).toBe(0)
    expect(text('copia')).toBe('idle:-:sin-copia')
  })

  it('otra cuenta en el mismo dispositivo no ve la copia de la anterior', async () => {
    const { storage, cachedSource } = cached()
    await storage.write({
      userId: 'user_a',
      savedAt: '2026-11-20T08:00:00.000Z',
      plants: [plant(), plant(), plant()],
      extras: {},
    })
    setFakeClerk({ userId: 'user_b' })
    render(
      <CollectionProvider source={cachedSource}>
        <CopyScreen />
      </CollectionProvider>,
    )
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(text('copia')).toBe('loading:-:sin-copia')
    expect(storage.copies.has('user_a')).toBe(false)
  })

  it('al recuperar la conexión vuelve a leer la colección sola', async () => {
    render(
      <Tree>
        <Screen name="lista" />
      </Tree>,
    )
    await resolveLast([plant()])
    expect(source.loads).toHaveLength(1)

    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(source.loads).toHaveLength(2)
    await resolveLast([plant(), plant()])
    expect(text('lista')).toBe('ready:2:')
  })

  describe('sinónimos y abreviaturas que faltan (#274)', () => {
    const RLC = plant({
      species: null,
      genus: { id: 'genus-rlc', name: 'Rhyncholaeliocattleya' },
    })

    let retry: (() => void) | null = null
    function RetryProbe() {
      const current = useRetryExtras()
      useEffect(() => {
        retry = current
      }, [current])
      return null
    }

    function ExtrasScreen() {
      const { plants } = useCollection()
      return <p data-testid="extras">{useExtrasState(plants)}</p>
    }

    it('una planta registrada de un género nuevo: pide solo sus extras, sin otra lectura', async () => {
      const fetchExtras = vi.fn<ExtrasFetcher>(() => Promise.resolve({}))
      const cachedSource = createCachedCollectionSource({
        network: source,
        storage: createMemoryCopyStorage(),
        fetchExtras,
        onSaved: () => {},
      })
      render(
        <CollectionProvider source={cachedSource} thumbnailSync={null}>
          <ApiProbe />
          <ExtrasScreen />
        </CollectionProvider>,
      )
      const amabilis = plant()
      await resolveLast([amabilis])
      await waitFor(() => expect(text('extras')).toBe('complete'))
      expect(fetchExtras).toHaveBeenCalledTimes(1)

      await act(async () => {
        api?.upsertPlant(RLC)
        await Promise.resolve()
      })
      expect(fetchExtras).toHaveBeenCalledTimes(2)
      expect(fetchExtras.mock.calls[1]).toEqual([[RLC], expect.anything()])
      await waitFor(() => expect(text('extras')).toBe('complete'))
      expect(source.loads).toHaveLength(1)
    })

    it('tras un fallo no insiste sola; «Reintentar» (retryExtras) los vuelve a pedir', async () => {
      const fetchExtras = vi.fn<ExtrasFetcher>(() =>
        Promise.reject(new TypeError('red')),
      )
      const cachedSource = createCachedCollectionSource({
        network: source,
        storage: createMemoryCopyStorage(),
        fetchExtras,
        onSaved: () => {},
      })
      render(
        <CollectionProvider source={cachedSource} thumbnailSync={null}>
          <ApiProbe />
          <RetryProbe />
          <ExtrasScreen />
        </CollectionProvider>,
      )
      await resolveLast([plant()])
      await waitFor(() => expect(text('extras')).toBe('failed'))
      expect(fetchExtras).toHaveBeenCalledTimes(1)

      // Otro cambio de la colección no vuelve a pedirlos.
      await act(async () => {
        api?.upsertPlant(RLC)
        await Promise.resolve()
      })
      expect(fetchExtras).toHaveBeenCalledTimes(1)

      fetchExtras.mockImplementationOnce(() => Promise.resolve({}))
      act(() => {
        retry?.()
      })
      expect(text('extras')).toBe('pending')
      await waitFor(() => expect(text('extras')).toBe('complete'))
      expect(fetchExtras).toHaveBeenCalledTimes(2)
    })
  })

  it('el evento online sin colección pedida no lee nada', () => {
    render(
      <Tree>
        <p>Inicio</p>
      </Tree>,
    )
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(source.loads).toHaveLength(0)
  })
})

describe('CollectionProvider: miniaturas sin conexión (#119)', () => {
  const thumb = (n: number) =>
    `user_a/6f1c2a4e-8b3d-4e5f-9a7b-${String(n).padStart(12, '0')}/thumb-v1.webp`

  it('con la colección completa, baja las miniaturas; otra vez si cambian las fotos', async () => {
    vi.useFakeTimers()
    try {
      const thumbnailSync = vi.fn(() => Promise.resolve())
      render(
        <CollectionProvider
          source={source}
          thumbnailSync={thumbnailSync}
          thumbnailSyncDelayMs={100}
        >
          <Screen name="lista" />
          <ApiProbe />
        </CollectionProvider>,
      )
      await resolveLast([plant({ thumbnailPath: thumb(1) })])
      expect(thumbnailSync).not.toHaveBeenCalled()
      act(() => {
        vi.advanceTimersByTime(100)
      })
      expect(thumbnailSync).toHaveBeenCalledTimes(1)
      expect(thumbnailSync).toHaveBeenLastCalledWith(
        expect.objectContaining({ userId: 'user_a' }),
      )

      // Un cambio que no toca las fotos no lanza otra pasada.
      act(() => api?.upsertPlant(plant({ id: 'sin-foto' })))
      act(() => {
        vi.advanceTimersByTime(100)
      })
      expect(thumbnailSync).toHaveBeenCalledTimes(1)

      act(() => api?.upsertPlant(plant({ thumbnailPath: thumb(2) })))
      act(() => {
        vi.advanceTimersByTime(100)
      })
      expect(thumbnailSync).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('al cerrar sesión cancela la pasada en curso', async () => {
    vi.useFakeTimers()
    try {
      const signals: AbortSignal[] = []
      const thumbnailSync = vi.fn(({ signal }: { signal: AbortSignal }) => {
        signals.push(signal)
        return Promise.resolve()
      })
      const { rerender } = render(
        <CollectionProvider
          source={source}
          thumbnailSync={thumbnailSync}
          thumbnailSyncDelayMs={0}
        >
          <Screen name="lista" />
        </CollectionProvider>,
      )
      await resolveLast([plant({ thumbnailPath: thumb(1) })])
      act(() => {
        vi.advanceTimersByTime(0)
      })
      expect(signals).toHaveLength(1)

      setFakeClerk({ signedIn: false })
      rerender(
        <CollectionProvider
          source={source}
          thumbnailSync={thumbnailSync}
          thumbnailSyncDelayMs={0}
        >
          <Screen name="lista" />
        </CollectionProvider>,
      )
      expect(signals[0]?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
