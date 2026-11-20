import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '../test/axe.ts'
import { resetFakeClerk, setFakeClerk } from '../test/clerk-mock.tsx'
import { SignInPage } from './SignInPage.tsx'
import { SignUpPage } from './SignUpPage.tsx'

vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))

beforeEach(() => {
  resetFakeClerk()
  // Como en index.html.
  document.documentElement.lang = 'es'
  document.title = 'Orki'
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

describe.each([
  ['SignInPage', SignInPage, 'Iniciar sesión · Orki', 'clerk-sign-in'],
  ['SignUpPage', SignUpPage, 'Crear cuenta · Orki', 'clerk-sign-up'],
] as const)('%s', (_name, Page, title, clerkTestId) => {
  it('con Clerk listo: muestra su componente con rutas en el hash', async () => {
    render(<Page />)

    expect(document.title).toBe(title)
    expect(screen.getByTestId(clerkTestId)).toHaveAttribute(
      'data-routing',
      'hash',
    )
    expect(
      screen.getByRole('link', { name: 'Volver al inicio de Orki' }),
    ).toHaveAttribute('href', '/')
    await expectNoAxeViolations()
  })

  it('mientras Clerk carga: estado de carga anunciado', async () => {
    setFakeClerk({ status: 'loading' })
    render(<Page />)

    expect(screen.getByRole('status')).toHaveTextContent('Cargando el acceso…')
    expect(screen.queryByTestId(clerkTestId)).not.toBeInTheDocument()
    await expectNoAxeViolations()
  })

  it('si Clerk no carga: alerta con la opción de reintentar', async () => {
    setFakeClerk({ status: 'error' })
    render(<Page />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'No se pudo cargar el acceso',
    )
    expect(
      screen.getByRole('button', { name: 'Volver a intentar' }),
    ).toBeInTheDocument()
    await expectNoAxeViolations()
  })

  it('sin conexión: lo dice sin esperar a Clerk', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    setFakeClerk({ status: 'loading' })
    render(<Page />)

    expect(screen.getByRole('alert')).toHaveTextContent('Sin conexión')
    await expectNoAxeViolations()
  })

  it('el enlace al inicio se alcanza con el teclado', async () => {
    const user = userEvent.setup()
    render(<Page />)

    await user.tab()

    expect(
      screen.getByRole('link', { name: 'Volver al inicio de Orki' }),
    ).toHaveFocus()
  })
})
