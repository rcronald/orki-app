import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { PublicHeader } from './PublicHeader.tsx'

function renderHeader(actions?: boolean, path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PublicHeader actions={actions} />
    </MemoryRouter>,
  )
}

describe('PublicHeader', () => {
  it('logotipo al inicio y las dos acciones de acceso', () => {
    renderHeader()

    expect(screen.getByRole('banner')).toHaveClass('orki-nav')
    expect(
      screen.getByRole('link', { name: 'Inicio de orqui.app' }),
    ).toHaveAttribute('href', '/')
    const signIn = screen.getByRole('link', { name: 'Iniciar sesión' })
    expect(signIn).toHaveAttribute('href', '/iniciar-sesion')
    expect(signIn).toHaveClass('orki-btn', 'orki-btn--secondary')
    const signUp = screen.getByRole('link', { name: 'Crear cuenta gratis' })
    expect(signUp).toHaveAttribute('href', '/registro')
    expect(signUp).toHaveClass('orki-btn', 'orki-btn--strong')
  })

  it('«Catálogo» como enlace de sección (#232), también sin acciones', () => {
    renderHeader(false)

    const sections = screen.getByRole('navigation', { name: 'Secciones' })
    expect(sections).toHaveClass('orki-nav__links')
    const catalog = screen.getByRole('link', { name: 'Catálogo' })
    expect(sections).toContainElement(catalog)
    expect(catalog).toHaveAttribute('href', '/catalogo')
    expect(catalog).not.toHaveAttribute('aria-current')
    expect(screen.queryByRole('link', { name: 'Iniciar sesión' })).toBeNull()
  })

  it('en el catálogo, «Catálogo» es la página actual', () => {
    renderHeader(true, '/catalogo/especie/abc')

    expect(screen.getByRole('link', { name: 'Catálogo' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})
