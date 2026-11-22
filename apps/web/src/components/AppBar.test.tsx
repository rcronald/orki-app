import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '../test/axe.ts'
import { AppBar } from './AppBar.tsx'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppBar account={<button type="button">Tu cuenta</button>} />
      <main>Contenido</main>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  document.documentElement.lang = 'es'
  document.title = 'Prueba'
})

describe('AppBar', () => {
  it('logotipo al inicio, pestaña «Mi colección» y la cuenta; sin lupa', async () => {
    renderAt('/coleccion')

    expect(screen.getByRole('banner')).toHaveClass('orki-appbar')
    expect(
      screen.getByRole('link', { name: 'Inicio de orqui.app' }),
    ).toHaveAttribute('href', '/')
    const nav = screen.getByRole('navigation', { name: 'Principal' })
    const tab = screen.getByRole('link', { name: 'Mi colección' })
    expect(nav).toContainElement(tab)
    expect(tab).toHaveAttribute('href', '/coleccion')
    expect(tab.querySelector('svg')).toHaveClass('lucide-sprout')
    expect(
      screen
        .getByRole('button', { name: 'Tu cuenta' })
        .closest('.orki-appbar__end'),
    ).not.toBeNull()
    expect(document.querySelector('.lucide-search')).toBeNull()
    await expectNoAxeViolations()
  })

  it.each([
    '/coleccion',
    '/coleccion/nueva',
    '/coleccion/abc',
    '/coleccion/abc/editar',
    '/ya-la-tengo',
  ])('%s: la pestaña es la página actual', (path) => {
    renderAt(path)

    expect(screen.getByRole('link', { name: 'Mi colección' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it.each(['/cuenta', '/administracion/catalogo', '/privacidad'])(
    '%s: la pestaña no es la actual',
    (path) => {
      renderAt(path)

      expect(
        screen.getByRole('link', { name: 'Mi colección' }),
      ).not.toHaveAttribute('aria-current')
    },
  )
})
