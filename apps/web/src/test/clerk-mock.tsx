/* eslint-disable react-refresh/only-export-components -- módulo simulado solo para pruebas */
import { cloneElement, isValidElement, type ReactNode } from 'react'
import { vi } from 'vitest'

// Sustituto de @clerk/react para las pruebas: ninguna prueba carga Clerk ni
// necesita una clave. Cada archivo de prueba lo activa con
//
//   vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))
//
// y fija el estado con setFakeClerk() antes de pintar. Solo simula lo que usa
// la app: el estado de carga (useClerk().status), la sesión (<Show> y
// useAuth(), con su getToken()) y los componentes, que aquí son marcadores sin
// la interfaz real de Clerk.

export type FakeClerkStatus = 'loading' | 'ready' | 'degraded' | 'error'

interface FakeClerkState {
  status: FakeClerkStatus
  signedIn: boolean
  /** Valor del claim app_role del token de sesión; null si no lo trae. */
  appRole: string | null
  /** Id del usuario con sesión (userId y claim sub). */
  userId: string
}

/** Id de usuario de la sesión simulada por defecto (userId y claim sub). */
export const FAKE_USER_ID = 'user_prueba'

export const fakeClerk: FakeClerkState = {
  status: 'ready',
  signedIn: false,
  appRole: null,
  userId: FAKE_USER_ID,
}

/** Token de sesión que devuelve getToken() por defecto con sesión. */
export const FAKE_SESSION_TOKEN = 'token_de_sesion_de_prueba'

/**
 * getToken() de useAuth(). Como el real, es la misma función en cada pintado y
 * devuelve null sin sesión. Una prueba puede cambiar su comportamiento con
 * mockImplementation (por ejemplo, lanzar ClerkOfflineError).
 */
export const getToken = vi.fn<() => Promise<string | null>>(defaultGetToken)

function defaultGetToken() {
  return Promise.resolve(
    isLoaded() && fakeClerk.signedIn ? FAKE_SESSION_TOKEN : null,
  )
}

/** Llamadas a cerrar sesión, desde <SignOutButton> o useClerk().signOut(). */
export const signOut = vi.fn<() => Promise<void>>(() => Promise.resolve())

/** Props con las que se pintó <ClerkProvider> por última vez. */
export let lastProviderProps: Record<string, unknown> | undefined

// Recibe las props de cada pintado de <SignIn> o <SignUp>.
const authComponentRendered = vi.fn<(props: Record<string, unknown>) => void>()

/** Props con las que se pintó <SignIn> o <SignUp> por última vez. */
export function lastAuthComponentProps(): Record<string, unknown> | undefined {
  return authComponentRendered.mock.lastCall?.[0]
}

export function setFakeClerk(next: Partial<FakeClerkState>) {
  Object.assign(fakeClerk, next)
}

export function resetFakeClerk() {
  setFakeClerk({
    status: 'ready',
    signedIn: false,
    appRole: null,
    userId: FAKE_USER_ID,
  })
  signOut.mockReset()
  signOut.mockImplementation(() => Promise.resolve())
  getToken.mockReset()
  getToken.mockImplementation(defaultGetToken)
  lastProviderProps = undefined
  authComponentRendered.mockReset()
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
  return { status: fakeClerk.status, signOut }
}

// Como el real (tabla de valores de la documentación de useAuth): mientras
// carga, isLoaded false e isSignedIn, userId y sessionClaims undefined; sin
// sesión, false y null; con sesión, el id y los claims del token.
export function useAuth() {
  if (!isLoaded()) {
    return {
      isLoaded: false,
      isSignedIn: undefined,
      userId: undefined,
      sessionClaims: undefined,
      getToken,
    }
  }
  if (!fakeClerk.signedIn) {
    return {
      isLoaded: true,
      isSignedIn: false,
      userId: null,
      sessionClaims: null,
      getToken,
    }
  }
  const sessionClaims: Record<string, unknown> = {
    sub: fakeClerk.userId,
  }
  if (fakeClerk.appRole !== null) sessionClaims.app_role = fakeClerk.appRole
  return {
    isLoaded: true,
    isSignedIn: true,
    userId: fakeClerk.userId,
    sessionClaims,
    getToken,
  }
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

export function SignIn(props: { routing?: string; [prop: string]: unknown }) {
  authComponentRendered(props)
  return <div data-testid="clerk-sign-in" data-routing={props.routing} />
}

export function SignUp(props: { routing?: string; [prop: string]: unknown }) {
  authComponentRendered(props)
  return <div data-testid="clerk-sign-up" data-routing={props.routing} />
}

export function UserButton() {
  return <button type="button">Abrir menú de la cuenta</button>
}

// Como el real: envuelve el botón propio y le añade el cierre de sesión.
export function SignOutButton({ children }: { children: ReactNode }) {
  if (!isValidElement<{ onClick?: () => void }>(children)) return null
  return cloneElement(children, {
    onClick: () => {
      void signOut()
    },
  })
}
