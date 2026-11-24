import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollectionPlant } from '../collection/model.ts'
import type { PlantImageSource } from '../photos/read.ts'
import { PlantImagesContext } from '../photos/usePlantImage.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import { plant } from '../test/collection.ts'
import { PlantCard } from './PlantCard.tsx'

// IntersectionObserver de prueba: la prueba decide qué tarjetas entran en
// pantalla.
const observed = new Map<Element, IntersectionObserverCallback>()

class FakeIntersectionObserver {
  private readonly callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
  }
  observe(element: Element) {
    observed.set(element, this.callback)
  }
  disconnect() {
    for (const [element, callback] of observed) {
      if (callback === this.callback) observed.delete(element)
    }
  }
}

function scrollIntoView(element: Element) {
  const callback = observed.get(element)
  act(() => {
    callback?.(
      [{ isIntersecting: true, target: element } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    )
  })
}

function fakeSource() {
  const acquire = vi.fn<PlantImageSource['acquire']>((path) =>
    Promise.resolve(`blob:${path}`),
  )
  const release = vi.fn<PlantImageSource['release']>()
  const source: PlantImageSource = { acquire, release, clear: vi.fn() }
  return { source, acquire, release }
}

const withPhoto = (): CollectionPlant =>
  plant({
    displayName: 'Cattleya labiata',
    photoPath: 'user_a/11111111-1111-4111-8111-111111111111/photo-v1.webp',
    thumbnailPath: 'user_a/11111111-1111-4111-8111-111111111111/thumb-v1.webp',
  })

function renderCard(source: PlantImageSource, value: CollectionPlant) {
  return render(
    <MemoryRouter>
      <PlantImagesContext value={source}>
        <PlantCard plant={value} view="grid" headingLevel={2} />
      </PlantImagesContext>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  document.documentElement.lang = 'es'
  document.title = 'Mi colección · orqui.app'
})

afterEach(() => {
  vi.unstubAllGlobals()
  observed.clear()
})

describe('enlace al detalle', () => {
  it('el nombre es el enlace al detalle y el nombre accesible de la tarjeta', async () => {
    const { source } = fakeSource()
    const value = withPhoto()
    renderCard(source, value)
    const link = screen.getByRole('link', { name: 'Cattleya labiata' })
    expect(link).toHaveAttribute('href', `/coleccion/${value.id}`)
    expect(
      screen.getByRole('article', { name: 'Cattleya labiata' }),
    ).toContainElement(link)
    await expectNoAxeViolations()
  })
})

describe('identificador', () => {
  it('se ve bajo el nombre y describe la tarjeta sin cambiar su nombre', async () => {
    const { source } = fakeSource()
    renderCard(source, { ...withPhoto(), code: 'CAT-012' })
    const card = screen.getByRole('article', {
      name: 'Cattleya labiata',
      description: 'Identificador CAT-012.',
    })
    expect(card).toHaveTextContent('CAT-012')
    await expectNoAxeViolations()
  })

  it('sin identificador (una copia antigua), nada', () => {
    const { source } = fakeSource()
    renderCard(source, { ...withPhoto(), code: null })
    const card = screen.getByRole('article', { name: 'Cattleya labiata' })
    expect(card).not.toHaveAttribute('aria-describedby')
    expect(card).not.toHaveTextContent('Identificador')
  })
})

describe('número de fotos', () => {
  it('con más de una foto, «3 fotos» describe la tarjeta sin cambiar su nombre', async () => {
    const { source } = fakeSource()
    renderCard(source, { ...withPhoto(), photoCount: 3 })
    const card = screen.getByRole('article', {
      name: 'Cattleya labiata',
      description: 'Identificador PHA-001. 3 fotos',
    })
    expect(card.querySelector('.orki-count')).toHaveTextContent('3')
    expect(
      screen.getByRole('link', { name: 'Cattleya labiata' }),
    ).toBeInTheDocument()
    await expectNoAxeViolations()
  })

  it('con una sola foto, sin indicador', () => {
    const { source } = fakeSource()
    renderCard(source, { ...withPhoto(), photoCount: 1 })
    expect(document.querySelector('.orki-count')).toBeNull()
  })
})

describe('miniatura de la tarjeta', () => {
  it('no pide nada hasta que la tarjeta está cerca de la pantalla', async () => {
    const { source, acquire } = fakeSource()
    renderCard(source, withPhoto())
    expect(acquire).not.toHaveBeenCalled()
    expect(
      screen.getByRole('img', { name: 'Foto de Cattleya labiata: cargando' }),
    ).toBeInTheDocument()
    await expectNoAxeViolations()
  })

  it('pide solo la miniatura, nunca la foto grande', async () => {
    const { source, acquire } = fakeSource()
    const value = withPhoto()
    renderCard(source, value)
    scrollIntoView(screen.getByRole('article'))

    const image = await screen.findByRole('img', {
      name: 'Foto de Cattleya labiata',
    })
    expect(image).toHaveAttribute('src', `blob:${value.thumbnailPath}`)
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(acquire).toHaveBeenCalledWith(
      value.thumbnailPath,
      'thumbnail',
      expect.anything(),
    )
    expect(acquire).not.toHaveBeenCalledWith(
      value.photoPath,
      expect.anything(),
      expect.anything(),
    )
    await expectNoAxeViolations()
  })

  it('una planta sin foto sigue con el marcador y no pide nada', () => {
    const { source, acquire } = fakeSource()
    renderCard(source, plant())
    scrollIntoView(screen.getByRole('article'))
    expect(screen.getByRole('img', { name: 'Sin foto' })).toBeInTheDocument()
    expect(acquire).not.toHaveBeenCalled()
  })

  it('si falla, marcador neutro; reintenta al volver la conexión', async () => {
    const { source, acquire } = fakeSource()
    acquire.mockRejectedValueOnce(new Error('sin red'))
    renderCard(source, withPhoto())
    scrollIntoView(screen.getByRole('article'))

    expect(
      await screen.findByRole('img', {
        name: 'Foto de Cattleya labiata: no se pudo cargar',
      }),
    ).toHaveAttribute('src', expect.stringContaining('svg'))

    // El aviso de conexión se repite hasta que llega la miniatura: la tarjeta
    // empieza a escucharlo en un efecto posterior al pintado del error, y un
    // único aviso lanzado justo antes se perdería (pasó en el CI, con la suite
    // entera en paralelo). Tras el primer reintento deja de escuchar, así que
    // los avisos de más no piden nada.
    await waitFor(
      () => {
        act(() => {
          window.dispatchEvent(new Event('online'))
        })
        expect(
          screen.getByRole('img', { name: 'Foto de Cattleya labiata' }),
        ).toBeInTheDocument()
      },
      { timeout: 10_000 },
    )
    expect(acquire).toHaveBeenCalledTimes(2)
  }, 15_000)

  it('suelta la miniatura al desmontar', async () => {
    const { source, release } = fakeSource()
    const value = withPhoto()
    const { unmount } = renderCard(source, value)
    scrollIntoView(screen.getByRole('article'))
    await screen.findByRole('img', { name: 'Foto de Cattleya labiata' })
    unmount()
    expect(release).toHaveBeenCalledWith(value.thumbnailPath)
  })
})
