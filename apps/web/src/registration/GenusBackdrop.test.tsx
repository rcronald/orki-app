import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GenusBackdrop } from './GenusBackdrop.tsx'
import { genusBackgroundUrl } from './genus-backgrounds.ts'

// Fondo por género (#13) por sí solo: la precarga es un doble que se resuelve
// o se rechaza a voluntad (jsdom no carga imágenes).

const PHALAENOPSIS = genusBackgroundUrl('Phalaenopsis')
const CATTLEYA = genusBackgroundUrl('Cattleya')

function deferredLoader() {
  const pending = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void }
  >()
  const loadImage = vi.fn(
    (src: string) =>
      new Promise<void>((resolve, reject) => {
        pending.set(src, { resolve, reject })
      }),
  )
  return { loadImage, pending }
}

const backdrop = () => screen.getByTestId('fondo-genero')
const layer = (src: string | null) =>
  backdrop().querySelector<HTMLElement>(`[data-foto="${src}"]`)

function mockReducedMotion(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)' && matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GenusBackdrop', () => {
  it('cada género de acceso rápido tiene foto, sin distinguir mayúsculas', () => {
    for (const name of [
      'Phalaenopsis',
      'cattleya',
      'DENDROBIUM',
      'Oncidium',
      'Vanda',
    ]) {
      expect(genusBackgroundUrl(name)).toMatch(/\/[a-z]+\.avif(\?|$)/)
    }
    expect(genusBackgroundUrl('Masdevallia')).toBeNull()
    expect(genusBackgroundUrl('constructor')).toBeNull()
    expect(genusBackgroundUrl(null)).toBeNull()
  })

  it('sin género queda el fondo neutro y no descarga nada', () => {
    const { loadImage } = deferredLoader()
    render(<GenusBackdrop genusName={null} loadImage={loadImage} />)

    expect(backdrop()).toHaveAttribute('data-fondo', 'neutro')
    expect(backdrop()).toHaveAttribute('aria-hidden', 'true')
    expect(backdrop().children).toHaveLength(0)
    expect(loadImage).not.toHaveBeenCalled()
  })

  it('un género sin foto usa el fondo neutro', () => {
    const { loadImage } = deferredLoader()
    render(<GenusBackdrop genusName="Masdevallia" loadImage={loadImage} />)

    expect(backdrop()).toHaveAttribute('data-fondo', 'neutro')
    expect(loadImage).not.toHaveBeenCalled()
  })

  it('la foto aparece cuando ya cargó, bajo el velo y con la transición motion-bg', async () => {
    const { loadImage, pending } = deferredLoader()
    render(<GenusBackdrop genusName="Phalaenopsis" loadImage={loadImage} />)

    // Mientras carga, nada: el formulario no la espera.
    expect(loadImage).toHaveBeenCalledWith(PHALAENOPSIS)
    expect(backdrop()).toHaveAttribute('data-fondo', 'neutro')
    expect(backdrop().children).toHaveLength(0)

    pending.get(PHALAENOPSIS ?? '')?.resolve()
    await waitFor(() =>
      expect(backdrop()).toHaveAttribute('data-fondo', PHALAENOPSIS),
    )
    const photo = layer(PHALAENOPSIS)
    expect(photo).toHaveStyle({ opacity: '1' })
    expect(photo?.style.backgroundImage).toBe(`url("${PHALAENOPSIS}")`)
    expect(photo?.style.transition).toBe('opacity var(--motion-bg)')
    // El velo, encima de la foto.
    expect(backdrop().lastElementChild).toHaveClass('bg-[var(--overlay-genus)]')
  })

  it('volver a pintar con el mismo género no vuelve a descargar ni cambia el fondo', async () => {
    const { loadImage, pending } = deferredLoader()
    const view = render(
      <GenusBackdrop genusName="Phalaenopsis" loadImage={loadImage} />,
    )
    pending.get(PHALAENOPSIS ?? '')?.resolve()
    await waitFor(() =>
      expect(backdrop()).toHaveAttribute('data-fondo', PHALAENOPSIS),
    )
    const photo = layer(PHALAENOPSIS)

    for (let i = 0; i < 5; i++) {
      view.rerender(
        <GenusBackdrop genusName="Phalaenopsis" loadImage={loadImage} />,
      )
    }
    expect(loadImage).toHaveBeenCalledTimes(1)
    expect(layer(PHALAENOPSIS)).toBe(photo)
    expect(photo).toHaveStyle({ opacity: '1' })
  })

  it('al cambiar de género sigue la foto anterior hasta que la nueva está lista', async () => {
    const { loadImage, pending } = deferredLoader()
    const view = render(
      <GenusBackdrop genusName="Phalaenopsis" loadImage={loadImage} />,
    )
    pending.get(PHALAENOPSIS ?? '')?.resolve()
    await waitFor(() =>
      expect(backdrop()).toHaveAttribute('data-fondo', PHALAENOPSIS),
    )

    view.rerender(<GenusBackdrop genusName="Cattleya" loadImage={loadImage} />)
    expect(backdrop()).toHaveAttribute('data-fondo', PHALAENOPSIS)

    pending.get(CATTLEYA ?? '')?.resolve()
    await waitFor(() =>
      expect(backdrop()).toHaveAttribute('data-fondo', CATTLEYA),
    )
    expect(layer(CATTLEYA)).toHaveStyle({ opacity: '1' })
    expect(layer(PHALAENOPSIS)).toHaveStyle({ opacity: '0' })

    // Volver a la primera no la descarga otra vez.
    view.rerender(
      <GenusBackdrop genusName="Phalaenopsis" loadImage={loadImage} />,
    )
    expect(backdrop()).toHaveAttribute('data-fondo', PHALAENOPSIS)
    expect(loadImage).toHaveBeenCalledTimes(2)

    // Quitar el género (abrir "Otro") vuelve al fondo neutro.
    view.rerender(<GenusBackdrop genusName={null} loadImage={loadImage} />)
    expect(backdrop()).toHaveAttribute('data-fondo', 'neutro')
    expect(layer(PHALAENOPSIS)).toHaveStyle({ opacity: '0' })
  })

  it('si la foto no carga, queda el fondo neutro', async () => {
    const { loadImage, pending } = deferredLoader()
    const view = render(
      <GenusBackdrop genusName="Phalaenopsis" loadImage={loadImage} />,
    )
    pending.get(PHALAENOPSIS ?? '')?.resolve()
    await waitFor(() =>
      expect(backdrop()).toHaveAttribute('data-fondo', PHALAENOPSIS),
    )

    // Mientras se intenta la de Vanda sigue la anterior; al fallar, neutro.
    view.rerender(<GenusBackdrop genusName="Vanda" loadImage={loadImage} />)
    const vanda = genusBackgroundUrl('Vanda') ?? ''
    expect(backdrop()).toHaveAttribute('data-fondo', PHALAENOPSIS)
    pending.get(vanda)?.reject(new Error('sin red'))
    await waitFor(() =>
      expect(backdrop()).toHaveAttribute('data-fondo', 'neutro'),
    )
    expect(layer(vanda)).toBeNull()
    expect(layer(PHALAENOPSIS)).toHaveStyle({ opacity: '0' })
  })

  it('con movimiento reducido no hay transición', async () => {
    mockReducedMotion(true)
    const { loadImage, pending } = deferredLoader()
    render(<GenusBackdrop genusName="Oncidium" loadImage={loadImage} />)
    const oncidium = genusBackgroundUrl('Oncidium') ?? ''

    pending.get(oncidium)?.resolve()
    await waitFor(() =>
      expect(backdrop()).toHaveAttribute('data-fondo', oncidium),
    )
    expect(layer(oncidium)?.style.transition).toBe('none')
  })

  it('ocupa la pantalla o, en la muestra, su contenedor', () => {
    const view = render(<GenusBackdrop genusName={null} />)
    expect(backdrop()).toHaveClass('fixed', 'inset-[0]', '-z-[1]')
    view.rerender(<GenusBackdrop genusName={null} placement="contained" />)
    expect(backdrop()).toHaveClass('absolute', 'inset-[0]', '-z-[1]')
  })
})
