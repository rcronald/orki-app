import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '../test/axe.ts'
import { resetFakeClerk, setFakeClerk, signOut } from '../test/clerk-mock.tsx'
import { AccountControls } from './AccountControls.tsx'

vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))

function renderInRouter(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

beforeEach(() => {
  resetFakeClerk()
  // Como en index.html.
  document.documentElement.lang = 'es'
  document.title = 'Orki'
})

describe('AccountControls', () => {
  it('sin sesión: enlaces a iniciar sesión y crear cuenta', async () => {
    renderInRouter(<AccountControls />)

    expect(
      screen.getByRole('link', { name: 'Iniciar sesión' }),
    ).toHaveAttribute('href', '/iniciar-sesion')
    expect(screen.getByRole('link', { name: 'Crear cuenta' })).toHaveAttribute(
      'href',
      '/registro',
    )
    expect(
      screen.queryByRole('button', { name: 'Cerrar sesión' }),
    ).not.toBeInTheDocument()
    await expectNoAxeViolations()
  })

  it('con sesión: acceso a la cuenta y botón para salir', async () => {
    const user = userEvent.setup()
    setFakeClerk({ signedIn: true })
    renderInRouter(<AccountControls />)

    expect(
      screen.getByRole('button', { name: 'Abrir menú de la cuenta' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Iniciar sesión' }),
    ).not.toBeInTheDocument()
    // Pantalla de cuenta de Orki, donde se elimina la cuenta (#110).
    expect(screen.getByRole('link', { name: 'Tu cuenta' })).toHaveAttribute(
      'href',
      '/cuenta',
    )
    await expectNoAxeViolations()

    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    expect(signOut).toHaveBeenCalledOnce()
  })

  it('mientras Clerk carga: estado de carga, sin controles', () => {
    setFakeClerk({ status: 'loading', signedIn: true })
    renderInRouter(<AccountControls />)

    expect(screen.getByRole('status')).toHaveTextContent('Cargando el acceso…')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('si Clerk falla: aviso breve, sin controles', async () => {
    setFakeClerk({ status: 'error' })
    renderInRouter(<AccountControls />)

    expect(screen.getByRole('status')).toHaveTextContent(
      'El acceso a tu cuenta no está disponible ahora.',
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    await expectNoAxeViolations()
  })
})
