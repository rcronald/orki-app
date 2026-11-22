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
    ).toEqual(['Organiza tus plantas', 'Nombres confiables', '¿Ya la tengo?'])
    expect(document.title).toBe('orqui.apps')
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

  it('no promete lo que la app no hace ni enlaza al catálogo', () => {
    const { container } = renderHome()

    const text = container.textContent ?? ''
    expect(text).not.toMatch(/floraci|historial|cuidado|fichas/i)
    expect(
      screen.queryByRole('link', { name: /catálogo/i }),
    ).not.toBeInTheDocument()
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
      '(max-width: 720px) calc(100vw - 32px), 50vw',
    )
  })

  it('el dibujo botánico es decorativo', () => {
    const { container } = renderHome()

    const art = container.querySelector('img.orki-hero__art')
    expect(art).toHaveAttribute('alt', '')
    expect(art).toHaveAttribute('loading', 'lazy')
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
