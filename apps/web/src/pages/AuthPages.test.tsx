import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
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
  document.title = 'orqui.apps'
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

describe.each([
  ['SignInPage', SignInPage, 'Iniciar sesión · orqui.apps', 'clerk-sign-in'],
  ['SignUpPage', SignUpPage, 'Crear cuenta · orqui.apps', 'clerk-sign-up'],
] as const)('%s', (_name, AuthPage, title, clerkTestId) => {
  // Las pantallas usan enlaces y parámetros del enrutador.
  function Page() {
    return (
      <MemoryRouter>
        <AuthPage />
      </MemoryRouter>
    )
  }

  it('con Clerk listo: muestra su componente con rutas del enrutador', async () => {
    render(<Page />)

    expect(document.title).toBe(title)
    expect(screen.getByTestId(clerkTestId)).toHaveAttribute(
      'data-routing',
      'path',
    )
    expect(
      screen.getByRole('link', { name: 'Volver al inicio de orqui.apps' }),
    ).toHaveAttribute('href', '/')
    await expectNoAxeViolations()
  })

  // Con sesión, los componentes de Clerk no pintan nada: la pantalla no puede
  // quedarse en blanco (pasaba al volver de una ruta protegida recién iniciada
  // la sesión).
  function PageAt({ entry }: { entry: string }) {
    return (
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/acceso" element={<AuthPage />} />
          <Route path="/coleccion" element={<p>Colección</p>} />
          <Route path="/" element={<p>Inicio</p>} />
        </Routes>
      </MemoryRouter>
    )
  }

  it('con sesión: va a la página pedida en redirect_url', () => {
    setFakeClerk({ signedIn: true })
    render(<PageAt entry="/acceso?redirect_url=%2Fcoleccion" />)

    expect(screen.getByText('Colección')).toBeInTheDocument()
    expect(screen.queryByTestId(clerkTestId)).not.toBeInTheDocument()
  })

  it('con sesión y sin redirect_url, o con un destino externo: va al inicio', () => {
    setFakeClerk({ signedIn: true })
    const { unmount } = render(<PageAt entry="/acceso" />)
    expect(screen.getByText('Inicio')).toBeInTheDocument()
    unmount()

    render(<PageAt entry="/acceso?redirect_url=https%3A%2F%2Fotro.sitio%2F" />)
    expect(screen.getByText('Inicio')).toBeInTheDocument()
  })

  it('al llegar la sesión con la pantalla abierta: sale hacia el destino', () => {
    const { rerender } = render(
      <PageAt entry="/acceso?redirect_url=%2Fcoleccion" />,
    )
    expect(screen.getByTestId(clerkTestId)).toBeInTheDocument()

    setFakeClerk({ signedIn: true })
    rerender(<PageAt entry="/acceso?redirect_url=%2Fcoleccion" />)

    expect(screen.getByText('Colección')).toBeInTheDocument()
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
      screen.getByRole('link', { name: 'Volver al inicio de orqui.apps' }),
    ).toHaveFocus()
  })
})
