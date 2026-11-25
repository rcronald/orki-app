import { act, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountDeletedState } from '../account/deletion-status.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import { HomePage } from './HomePage.tsx'

beforeEach(() => {
  // Como en index.html.
  document.documentElement.lang = 'es'
})

function LocationState() {
  const location = useLocation()
  return <div data-testid="estado">{JSON.stringify(location.state)}</div>
}

function renderHome(state?: AccountDeletedState) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/', state }]}>
      <Routes>
        <Route
          path="/"
          element={
            <main>
              <HomePage />
              <LocationState />
            </main>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('HomePage', () => {
  it('un solo h1 con el título y tres ventajas como h2', async () => {
    renderHome()

    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent(
      'Tu colección de orquídeas, en un solo lugar',
    )
    expect(headings[0]).toHaveClass('orki-hero__title')
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
    ).toEqual([
      '¿Ya la tengo?',
      'Registra una orquídea',
      'Organiza tu colección',
    ])
    expect(document.title).toBe('orqui.app')
    await expectNoAxeViolations()
  })

  it('las dos acciones llevan al registro y al inicio de sesión', () => {
    renderHome()

    const hero = screen.getByRole('region', {
      name: 'Tu colección de orquídeas, en un solo lugar',
    })
    const signUp = within(hero).getByRole('link', {
      name: 'Crear cuenta gratis',
    })
    expect(signUp).toHaveAttribute('href', '/registro')
    expect(signUp).toHaveClass('orki-btn', 'orki-btn--strong')
    const signIn = within(hero).getByRole('link', { name: 'Iniciar sesión' })
    expect(signIn).toHaveAttribute('href', '/iniciar-sesion')
    expect(signIn).toHaveClass('orki-btn', 'orki-btn--secondary')
  })

  it('no promete lo que la app no hace', () => {
    const { container } = renderHome()

    const text = container.textContent ?? ''
    expect(text).not.toMatch(/floraci|historial|cuidado|fichas/i)
  })

  it('«Explorar el catálogo» bajo las ventajas, como enlace de texto (#232)', () => {
    const { container } = renderHome()

    const link = screen.getByRole('link', { name: 'Explorar el catálogo' })
    expect(link).toHaveAttribute('href', '/catalogo')
    expect(link).toHaveClass('orki-link')
    expect(link).not.toHaveClass('orki-btn')
    // Después de la lista de ventajas.
    const features = container.querySelector('.orki-features')
    expect(features?.compareDocumentPosition(link) ?? 0).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('foto con texto alternativo, medidas, variantes AVIF y prioridad alta', () => {
    const { container } = renderHome()

    const photo = screen.getByRole('img', {
      name: 'Phalaenopsis rosada en floración',
    })
    expect(photo).toHaveClass('orki-hero__photo')
    expect(photo).toHaveAttribute('width', '1536')
    expect(photo).toHaveAttribute('height', '1024')
    expect(photo).toHaveAttribute('fetchpriority', 'high')
    expect(photo).not.toHaveAttribute('loading')
    expect(photo.getAttribute('src')).toMatch(/portada-960\.jpg/)

    const source = container.querySelector('picture source')
    expect(source).toHaveAttribute('type', 'image/avif')
    const srcset = source?.getAttribute('srcset') ?? ''
    for (const width of [648, 960, 1296, 1536]) {
      expect(srcset).toMatch(
        new RegExp(`portada-${width}\\.avif\\S* ${width}w`),
      )
    }
    expect(source).toHaveAttribute(
      'sizes',
      '(max-width: 720px) calc(100vw - 32px), 56vw',
    )
  })

  it('Hero dividido, ventajas sin recuadro y sin dibujo botánico', () => {
    const { container } = renderHome()

    const hero = screen.getByRole('region', {
      name: 'Tu colección de orquídeas, en un solo lugar',
    })
    expect(hero).toHaveClass('orki-hero', 'orki-hero--split')
    expect(hero).toHaveTextContent(
      'Registra las orquídeas que tienes y, antes de comprar otra, comprueba desde el celular si esa especie ya está en tu colección.',
    )
    expect(container.querySelector('.orki-hero__art')).toBeNull()
    // Los botones van sin icono.
    expect(hero.querySelector('.orki-btn svg')).toBeNull()

    const list = screen.getByRole('list')
    expect(list).toHaveClass('orki-features--plain')
    const icons = Array.from(
      list.querySelectorAll('.orki-feature__icon svg'),
      (svg) => svg.getAttribute('class'),
    )
    expect(icons).toEqual([
      expect.stringContaining('lucide-search'),
      expect.stringContaining('lucide-square-plus'),
      expect.stringContaining('lucide-layers'),
    ])
    expect(list).toHaveTextContent(
      'Comprueba cuántos ejemplares tienes. Si ya cargaste tu colección en este dispositivo, puedes consultarla sin señal.',
    )
    expect(list).toHaveTextContent(
      'Elige un nombre sugerido por el catálogo y añade la fecha de adquisición. La foto es opcional.',
    )
    expect(list).toHaveTextContent(
      'Ve tus orquídeas en lista o cuadrícula, agrúpalas por género y expórtalas a CSV.',
    )
  })

  it('tras eliminar la cuenta, anuncia el aviso y lo quita del historial', async () => {
    vi.useFakeTimers()
    try {
      renderHome({ accountDeleted: true })
      const status = screen.getByRole('status')
      expect(status).toBeEmptyDOMElement()

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(status).toHaveTextContent(/Tu cuenta se eliminó/)
      expect(screen.getByTestId('estado')).toHaveTextContent('null')
    } finally {
      vi.useRealTimers()
    }
  })

  it('sin el estado, no hay aviso', () => {
    renderHome()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
