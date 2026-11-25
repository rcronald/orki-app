import { act, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFakeClerk, setFakeClerk } from '../test/clerk-mock.tsx'
import { resetOfflineIdentity } from './offline-identity.ts'
import { RequireAuth } from './RouteGuards.tsx'
import {
  startVoluntarySignOut,
  useVoluntarySignOutArrival,
} from './voluntary-sign-out.ts'

vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))

beforeEach(() => {
  resetFakeClerk()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  localStorage.clear()
  resetOfflineIdentity()
})

function LocationProbe() {
  const location = useLocation()
  return (
    <div data-testid="location">{`${location.pathname}${location.search}`}</div>
  )
}

function Home() {
  useVoluntarySignOutArrival()
  return <p>Inicio</p>
}

function Tree() {
  return (
    <>
      <Routes>
        <Route index element={<Home />} />
        <Route element={<RequireAuth />}>
          <Route path="/cuenta" element={<p>Tu cuenta</p>} />
        </Route>
        <Route path="/iniciar-sesion" element={<p>Iniciar sesión</p>} />
      </Routes>
      <LocationProbe />
    </>
  )
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Tree />
    </MemoryRouter>,
  )
}

function currentLocation() {
  return screen.getByTestId('location').textContent
}

/** Clerk deja de tener sesión (el simulado no avisa: se vuelve a pintar). */
function sessionEnds(rerender: (ui: ReactNode) => void) {
  setFakeClerk({ signedIn: false })
  rerender(
    <MemoryRouter initialEntries={['/cuenta']}>
      <Tree />
    </MemoryRouter>,
  )
}

describe('RequireAuth al perder la sesión', () => {
  it('si caduca sin pulsar «Cerrar sesión», pide entrar para volver a la pantalla', () => {
    setFakeClerk({ signedIn: true })
    const { rerender } = renderAt('/cuenta')
    expect(screen.getByText('Tu cuenta')).toBeInTheDocument()

    sessionEnds(rerender)

    expect(currentLocation()).toBe('/iniciar-sesion?redirect_url=%2Fcuenta')
  })

  it('tras pulsar «Cerrar sesión», al inicio aunque Clerk confirme antes de pintarlo', () => {
    setFakeClerk({ signedIn: true })
    const { rerender } = renderAt('/cuenta')

    // La salida pendiente ya no está (PendingSignOut la borra en cuanto Clerk
    // confirma); solo queda la marca de salida voluntaria.
    act(() => {
      startVoluntarySignOut()
    })
    sessionEnds(rerender)

    expect(currentLocation()).toBe('/')
    expect(screen.getByText('Inicio')).toBeInTheDocument()
  })

  it('al llegar al inicio la marca se quita: una caducidad después vuelve a pedir entrar', async () => {
    act(() => {
      startVoluntarySignOut()
    })
    const { unmount } = renderAt('/')
    expect(screen.getByText('Inicio')).toBeInTheDocument()
    unmount()

    renderAt('/cuenta')
    await act(async () => {})
    expect(currentLocation()).toBe('/iniciar-sesion?redirect_url=%2Fcuenta')
  })

  it('volver a entrar quita la marca aunque no se llegara al inicio', () => {
    act(() => {
      startVoluntarySignOut()
    })
    setFakeClerk({ signedIn: true })
    const { rerender } = renderAt('/cuenta')
    expect(screen.getByText('Tu cuenta')).toBeInTheDocument()

    sessionEnds(rerender)

    expect(currentLocation()).toBe('/iniciar-sesion?redirect_url=%2Fcuenta')
  })
})
