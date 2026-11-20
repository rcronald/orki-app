import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.tsx'
import { resetFakeClerk, setFakeClerk } from './test/clerk-mock.tsx'

vi.mock('@clerk/react', () => import('./test/clerk-mock.tsx'))

beforeEach(() => {
  resetFakeClerk()
})

describe('App', () => {
  it('muestra la pantalla de marcador de Orki', () => {
    render(<App pathname="/" />)

    expect(
      screen.getByRole('heading', { level: 1, name: 'Orki' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Tu colección de orquídeas, siempre a mano.'),
    ).toBeInTheDocument()
  })

  it('no queda en blanco si Clerk no carga', () => {
    setFakeClerk({ status: 'error' })
    render(<App pathname="/" />)

    expect(
      screen.getByRole('heading', { level: 1, name: 'Orki' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'El acceso a tu cuenta no está disponible ahora.',
    )
  })

  it('abre el inicio de sesión en su ruta', () => {
    render(<App pathname="/iniciar-sesion" />)

    expect(screen.getByTestId('clerk-sign-in')).toBeInTheDocument()
  })

  it('abre el registro en su ruta', () => {
    render(<App pathname="/registro/" />)

    expect(screen.getByTestId('clerk-sign-up')).toBeInTheDocument()
  })
})
