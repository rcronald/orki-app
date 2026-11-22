import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { PublicHeader } from './PublicHeader.tsx'

function renderHeader(actions?: boolean) {
  return render(
    <MemoryRouter>
      <PublicHeader actions={actions} />
    </MemoryRouter>,
  )
}

describe('PublicHeader', () => {
  it('logotipo al inicio y las dos acciones de acceso', () => {
    renderHeader()

    expect(screen.getByRole('banner')).toHaveClass('orki-nav')
    expect(
      screen.getByRole('link', { name: 'Inicio de orqui.apps' }),
    ).toHaveAttribute('href', '/')
    const signIn = screen.getByRole('link', { name: 'Iniciar sesión' })
    expect(signIn).toHaveAttribute('href', '/iniciar-sesion')
    expect(signIn).toHaveClass('orki-btn', 'orki-btn--secondary')
    const signUp = screen.getByRole('link', { name: 'Crear cuenta gratis' })
    expect(signUp).toHaveAttribute('href', '/registro')
    expect(signUp).toHaveClass('orki-btn', 'orki-btn--strong')
  })

  it('sin acciones, solo el logotipo', () => {
    renderHeader(false)

    expect(screen.getAllByRole('link')).toHaveLength(1)
  })
})
