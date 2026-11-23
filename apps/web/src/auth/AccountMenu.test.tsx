import { act, render, renderHook, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '../components/AppShell.tsx'
import { expectNoAxeViolations } from '../test/axe.ts'
import {
  FAKE_USER_EMAIL,
  openUserProfile,
  resetFakeClerk,
  setFakeClerk,
  signOut,
} from '../test/clerk-mock.tsx'
import {
  LAST_USER_KEY,
  PENDING_SIGN_OUT_KEY,
  rememberUser,
} from './offline-identity.ts'
import { PendingSignOut } from './PendingSignOut.tsx'
import { PROFILE_EDITOR_PROPS, useProfileEditor } from './profile-editor.ts'

vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))

// La barra de AppShell según la sesión y el menú «Tu cuenta» (#207).

function renderShell(path = '/coleccion') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PendingSignOut />
      <Routes>
        <Route path="/" element={<p>Portada</p>} />
        <Route element={<AppShell />}>
          <Route path="/coleccion" element={<h1>Mi colección</h1>} />
          <Route path="/cuenta" element={<h1>Tu cuenta</h1>} />
          <Route path="/privacidad" element={<h1>Privacidad</h1>} />
          <Route
            path="/administracion/catalogo"
            element={<h1>Administración del catálogo</h1>}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

function setOnline(online: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online)
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'))
  })
}

const accountButton = () => screen.getByRole('button', { name: 'Tu cuenta' })
const menuItems = () =>
  screen.getAllByRole('menuitem').map((item) => item.textContent)

beforeEach(() => {
  resetFakeClerk()
  document.documentElement.lang = 'es'
  document.title = 'orqui.app'
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('barra de AppShell', () => {
  it('con sesión: barra de la app, pestaña actual y menú con la foto o las iniciales', async () => {
    setFakeClerk({ signedIn: true, fullName: 'Ana López' })
    renderShell()

    const banner = screen.getByRole('banner')
    expect(banner).toHaveClass('orki-appbar')
    expect(
      within(banner).getByRole('link', { name: 'Mi colección' }),
    ).toHaveAttribute('aria-current', 'page')
    expect(accountButton()).toHaveAttribute('aria-haspopup', 'menu')
    expect(accountButton().querySelector('.orki-avatar')).toHaveTextContent(
      'AL',
    )
    expect(
      within(banner).queryByRole('link', { name: 'Iniciar sesión' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Saltar al contenido' }),
    ).toBeInTheDocument()
    await expectNoAxeViolations()
  })

  it('con foto: el avatar la muestra', () => {
    setFakeClerk({
      signedIn: true,
      imageUrl: 'https://img.clerk.invalid/ana.jpg',
    })
    renderShell()

    expect(accountButton().querySelector('img')).toHaveAttribute(
      'src',
      'https://img.clerk.invalid/ana.jpg',
    )
  })

  it('sin nombre: icono user en el avatar y el correo en el menú', async () => {
    const user = userEvent.setup()
    setFakeClerk({ signedIn: true, fullName: null })
    renderShell()

    expect(accountButton().querySelector('.orki-avatar svg')).toHaveClass(
      'lucide-user',
    )
    await user.click(accountButton())
    expect(screen.getByText(FAKE_USER_EMAIL)).toBeVisible()
  })

  it('sin sesión: la barra pública con «Iniciar sesión» y «Crear cuenta gratis»', async () => {
    renderShell('/privacidad')

    const banner = screen.getByRole('banner')
    expect(banner).toHaveClass('orki-nav')
    expect(
      within(banner).getByRole('link', { name: 'Iniciar sesión' }),
    ).toHaveAttribute('href', '/iniciar-sesion')
    expect(
      within(banner).getByRole('link', { name: 'Crear cuenta gratis' }),
    ).toHaveClass('orki-btn--strong')
    expect(
      screen.queryByRole('button', { name: 'Tu cuenta' }),
    ).not.toBeInTheDocument()
    await expectNoAxeViolations()
  })

  it('mientras Clerk carga: el logotipo y «Catálogo», sin acceso', () => {
    setFakeClerk({ status: 'loading' })
    renderShell('/privacidad')

    const banner = screen.getByRole('banner')
    const links = within(banner).getAllByRole('link')
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAccessibleName('Inicio de orqui.app')
    expect(links[1]).toHaveAccessibleName('Catálogo')
    expect(
      screen.queryByRole('button', { name: 'Tu cuenta' }),
    ).not.toBeInTheDocument()
  })

  it('sin Clerk y sin nadie recordado: logotipo y el aviso breve', async () => {
    setFakeClerk({ status: 'error' })
    renderShell('/privacidad')

    expect(screen.getByRole('status')).toHaveTextContent(
      'El acceso a tu cuenta no está disponible ahora.',
    )
    expect(
      screen.queryByRole('link', { name: 'Iniciar sesión' }),
    ).not.toBeInTheDocument()
    await expectNoAxeViolations()
  })
})

describe('menú «Tu cuenta»', () => {
  it('opciones con sesión: «Mi cuenta» y «Cerrar sesión», con nombre y correo arriba', async () => {
    const user = userEvent.setup()
    setFakeClerk({ signedIn: true, fullName: 'Ana López' })
    renderShell()

    await user.click(accountButton())
    expect(menuItems()).toEqual(['Mi cuenta', 'Cerrar sesión'])
    expect(screen.getByText('Ana López').tagName).toBe('STRONG')
    expect(screen.getByText(FAKE_USER_EMAIL)).toBeVisible()
    await expectNoAxeViolations()

    await user.click(screen.getByRole('menuitem', { name: 'Mi cuenta' }))
    expect(
      screen.getByRole('heading', { name: 'Tu cuenta' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Mi colección' }),
    ).not.toHaveAttribute('aria-current')
  })

  it('el administrador ve «Administración»', async () => {
    const user = userEvent.setup()
    setFakeClerk({ signedIn: true, appRole: 'catalog_admin' })
    renderShell()

    await user.click(accountButton())
    expect(menuItems()).toEqual([
      'Mi cuenta',
      'Administración',
      'Cerrar sesión',
    ])
    await user.click(screen.getByRole('menuitem', { name: 'Administración' }))
    expect(
      screen.getByRole('heading', { name: 'Administración del catálogo' }),
    ).toBeInTheDocument()
  })

  it('con el teclado: flechas, Escape devuelve el foco', async () => {
    const user = userEvent.setup()
    setFakeClerk({ signedIn: true, appRole: 'catalog_admin' })
    renderShell()

    accountButton().focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Mi cuenta' })).toHaveFocus()
    await user.keyboard('{End}')
    expect(
      screen.getByRole('menuitem', { name: 'Cerrar sesión' }),
    ).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(accountButton()).toHaveFocus()
    expect(accountButton()).toHaveAttribute('aria-expanded', 'false')
  })

  it('cerrar sesión con conexión: al inicio, sin la sesión de la app y Clerk avisado', async () => {
    const user = userEvent.setup()
    setFakeClerk({ signedIn: true, userId: 'user_a' })
    rememberUser('user_a')
    renderShell()

    await user.click(accountButton())
    await user.click(screen.getByRole('menuitem', { name: 'Cerrar sesión' }))
    expect(screen.getByText('Portada')).toBeInTheDocument()
    expect(localStorage.getItem(LAST_USER_KEY)).toBeNull()
    expect(signOut).toHaveBeenCalledOnce()
  })

  it('sin conexión y con la sesión sin confirmar: avatar neutro, aviso y cerrar sesión pendiente', async () => {
    const user = userEvent.setup()
    setOnline(false)
    setFakeClerk({ status: 'error' })
    rememberUser('user_a')
    renderShell()

    const banner = screen.getByRole('banner')
    expect(banner).toHaveClass('orki-appbar')
    expect(accountButton().querySelector('.orki-avatar svg')).toHaveClass(
      'lucide-user',
    )
    await user.click(accountButton())
    expect(menuItems()).toEqual(['Mi cuenta', 'Cerrar sesión'])
    expect(
      screen.getByText('Sin conexión: tu sesión se confirmará al recuperarla.'),
    ).toBeVisible()
    await expectNoAxeViolations()

    await user.click(screen.getByRole('menuitem', { name: 'Cerrar sesión' }))
    expect(screen.getByText('Portada')).toBeInTheDocument()
    expect(localStorage.getItem(LAST_USER_KEY)).toBeNull()
    expect(localStorage.getItem(PENDING_SIGN_OUT_KEY)).toBe('user_a')
    expect(signOut).not.toHaveBeenCalled()
  })
})

describe('useProfileEditor', () => {
  function wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter>{children}</MemoryRouter>
  }

  it('con sesión y conexión: abre el editor de Clerk sin «Eliminar cuenta»', () => {
    setFakeClerk({ signedIn: true })
    const { result } = renderHook(() => useProfileEditor(), { wrapper })

    expect(result.current.available).toBe(true)
    result.current.open()
    expect(openUserProfile).toHaveBeenCalledWith(PROFILE_EDITOR_PROPS)
    expect(PROFILE_EDITOR_PROPS.appearance.elements).toEqual({
      profileSection__danger: { display: 'none' },
    })
  })

  it('sin conexión o con la sesión sin confirmar: no disponible y no abre nada', () => {
    setOnline(false)
    setFakeClerk({ status: 'error' })
    rememberUser('user_a')
    const { result } = renderHook(() => useProfileEditor(), { wrapper })

    expect(result.current.available).toBe(false)
    result.current.open()
    expect(openUserProfile).not.toHaveBeenCalled()
  })

  it('con sesión pero sin conexión: no disponible', () => {
    setOnline(false)
    setFakeClerk({ signedIn: true })
    const { result } = renderHook(() => useProfileEditor(), { wrapper })

    expect(result.current.available).toBe(false)
  })
})
