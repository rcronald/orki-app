/* eslint-disable react-refresh/only-export-components -- sustituto de un paquete, no un módulo de componentes */
import { cloneElement, isValidElement, type ReactNode } from 'react'

// Sustituto de @clerk/react en el build de medición (medicion/vite.config.ts):
// Clerk ya cargado y una sesión iniciada, sin descargar su script ni hablar
// con su API. Solo simula lo que usa la app (como src/test/clerk-mock.tsx,
// que no sirve aquí porque depende de Vitest).

const USUARIO = 'user_medicion'
const SESION = {
  isLoaded: true,
  isSignedIn: true,
  userId: USUARIO,
  sessionClaims: { sub: USUARIO },
  // La misma función en cada pintado, como la real.
  getToken: () => Promise.resolve('token_ficticio_de_medicion'),
} as const

export function ClerkProvider({ children }: { children: ReactNode }) {
  return children
}

export function useClerk() {
  return { status: 'ready' as const }
}

export function useAuth() {
  return SESION
}

export function Show({
  when,
  fallback = null,
  children,
}: {
  when: 'signed-in' | 'signed-out'
  fallback?: ReactNode
  children: ReactNode
}) {
  return when === 'signed-in' ? children : fallback
}

export function SignIn() {
  return null
}

export function SignUp() {
  return null
}

export function UserButton() {
  return (
    <button type="button" className="orki-chip">
      Cuenta
    </button>
  )
}

export function SignOutButton({ children }: { children: ReactNode }) {
  if (!isValidElement<{ onClick?: () => void }>(children)) return null
  return cloneElement(children, { onClick: () => {} })
}
