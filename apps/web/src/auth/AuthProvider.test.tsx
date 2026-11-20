import { esMX } from '@clerk/localizations/es-MX'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lastProviderProps, resetFakeClerk } from '../test/clerk-mock.tsx'
import { clerkAppearance } from './appearance.ts'
import { AuthProvider } from './AuthProvider.tsx'

vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))

beforeEach(() => {
  resetFakeClerk()
})

describe('AuthProvider', () => {
  it('configura Clerk con la clave, el español y el design system', () => {
    render(
      <AuthProvider publishableKey="pk_test_clave_de_prueba">
        <p>Contenido</p>
      </AuthProvider>,
    )

    // Pinta los hijos sin esperar a que Clerk cargue.
    expect(screen.getByText('Contenido')).toBeInTheDocument()
    expect(lastProviderProps).toEqual({
      publishableKey: 'pk_test_clave_de_prueba',
      localization: esMX,
      appearance: clerkAppearance,
      signInUrl: '/iniciar-sesion',
      signUpUrl: '/registro',
      afterSignOutUrl: '/',
    })
  })
})
