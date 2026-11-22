import { act, render, screen } from '@testing-library/react'
import { StrictMode, useEffect, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFakeClerk, setFakeClerk } from '../test/clerk-mock.tsx'
import { plant } from '../test/collection.ts'
import {
  fakeCollectionSource,
  type FakeCollectionSource,
} from '../test/collection-source.ts'
import { CollectionProvider } from './CollectionProvider.tsx'
import { countPlants } from './selectors.ts'
import { CollectionLoadError } from './source.ts'
import { COLLECTION_REFRESH_AFTER_MS } from './store.ts'
import { useCollection, type CollectionApi } from './useCollection.ts'

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
  await act(async () => {
    source.last().resolve(plants)
    await Promise.resolve()
  })
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
    await act(async () => {
      source.last().reject(new CollectionLoadError('offline'))
      await Promise.resolve()
    })
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
