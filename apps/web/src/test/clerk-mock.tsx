/* eslint-disable react-refresh/only-export-components -- módulo simulado solo para pruebas */
import { cloneElement, isValidElement, type ReactNode } from 'react'
import { vi } from 'vitest'

// Sustituto de @clerk/react para las pruebas: ninguna prueba carga Clerk ni
// necesita una clave. Cada archivo de prueba lo activa con
//
//   vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))
//
// y fija el estado con setFakeClerk() antes de pintar. Solo simula lo que usa
// la app: el estado de carga (useClerk().status), la sesión (<Show>) y los
// componentes, que aquí son marcadores sin la interfaz real de Clerk.

export type FakeClerkStatus = 'loading' | 'ready' | 'degraded' | 'error'

interface FakeClerkState {
  status: FakeClerkStatus
  signedIn: boolean
}

export const fakeClerk: FakeClerkState = { status: 'ready', signedIn: false }

/** Llamadas a cerrar sesión desde <SignOutButton>. */
export const signOut = vi.fn()

/** Props con las que se pintó <ClerkProvider> por última vez. */
export let lastProviderProps: Record<string, unknown> | undefined

export function setFakeClerk(next: Partial<FakeClerkState>) {
  Object.assign(fakeClerk, next)
}

export function resetFakeClerk() {
  setFakeClerk({ status: 'ready', signedIn: false })
  signOut.mockReset()
  lastProviderProps = undefined
}

function isLoaded() {
  return fakeClerk.status === 'ready' || fakeClerk.status === 'degraded'
}

export function ClerkProvider({
  children,
  ...props
}: {
  children: ReactNode
  [prop: string]: unknown
}) {
  lastProviderProps = props
  return children
}

export function useClerk() {
  return { status: fakeClerk.status }
}

// Como el real: no pinta nada hasta que Clerk ha cargado.
export function Show({
  when,
  fallback = null,
  children,
}: {
  when: 'signed-in' | 'signed-out'
  fallback?: ReactNode
  children: ReactNode
}) {
  if (!isLoaded()) return null
  const visible =
    when === 'signed-in' ? fakeClerk.signedIn : !fakeClerk.signedIn
  return visible ? children : fallback
}

export function SignIn({ routing }: { routing?: string }) {
  return <div data-testid="clerk-sign-in" data-routing={routing} />
}

export function SignUp({ routing }: { routing?: string }) {
  return <div data-testid="clerk-sign-up" data-routing={routing} />
}

export function UserButton() {
  return <button type="button">Abrir menú de la cuenta</button>
}

// Como el real: envuelve el botón propio y le añade el cierre de sesión.
export function SignOutButton({ children }: { children: ReactNode }) {
  if (!isValidElement<{ onClick?: () => void }>(children)) return null
  return cloneElement(children, {
    onClick: () => {
      signOut()
    },
  })
}
