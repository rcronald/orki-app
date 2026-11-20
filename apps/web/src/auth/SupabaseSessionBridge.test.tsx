import { ClerkOfflineError } from '@clerk/react/errors'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getSessionToken,
  SessionTokenError,
  setSessionTokenSource,
} from '../lib/supabase.ts'
import {
  FAKE_SESSION_TOKEN,
  getToken,
  resetFakeClerk,
  setFakeClerk,
} from '../test/clerk-mock.tsx'
import { SupabaseSessionBridge } from './SupabaseSessionBridge.tsx'

vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))

beforeEach(() => {
  resetFakeClerk()
  setSessionTokenSource(null)
})

async function tokenFailure() {
  const error: unknown = await getSessionToken().catch((e: unknown) => e)
  expect(error).toBeInstanceOf(SessionTokenError)
  return (error as SessionTokenError).reason
}

describe('SupabaseSessionBridge', () => {
  it('con sesión, el cliente recibe el token de Clerk', async () => {
    setFakeClerk({ signedIn: true })
    render(<SupabaseSessionBridge />)

    expect(await getSessionToken()).toBe(FAKE_SESSION_TOKEN)
  })

  it('sin sesión, no hay token', async () => {
    render(<SupabaseSessionBridge />)

    expect(await getSessionToken()).toBeNull()
    expect(getToken).not.toHaveBeenCalled()
  })

  it('mientras Clerk carga, no hay token (va como anon)', async () => {
    setFakeClerk({ status: 'loading', signedIn: true })
    render(<SupabaseSessionBridge />)

    expect(await getSessionToken()).toBeNull()
  })

  it('al cerrar sesión, deja de enviarse el token', async () => {
    setFakeClerk({ signedIn: true })
    const { rerender } = render(<SupabaseSessionBridge />)
    expect(await getSessionToken()).toBe(FAKE_SESSION_TOKEN)

    setFakeClerk({ signedIn: false })
    rerender(<SupabaseSessionBridge />)

    expect(await getSessionToken()).toBeNull()
  })

  it('al desmontarse, quita la fuente del token', async () => {
    setFakeClerk({ signedIn: true })
    const { unmount } = render(<SupabaseSessionBridge />)
    unmount()

    expect(await getSessionToken()).toBeNull()
  })

  it('sin conexión (ClerkOfflineError), el error es "offline"', async () => {
    setFakeClerk({ signedIn: true })
    getToken.mockRejectedValue(new ClerkOfflineError('Sin red'))
    render(<SupabaseSessionBridge />)

    expect(await tokenFailure()).toBe('offline')
  })

  it('si getToken falla por otro motivo, el error es "failed"', async () => {
    setFakeClerk({ signedIn: true })
    getToken.mockRejectedValue(new Error('respuesta inesperada'))
    render(<SupabaseSessionBridge />)

    expect(await tokenFailure()).toBe('failed')
  })

  it('si la sesión caducó o se cerró en otra pestaña, el error es "session-ended"', async () => {
    setFakeClerk({ signedIn: true })
    // Clerk todavía cree tener sesión en esta pestaña, pero ya no hay token.
    getToken.mockResolvedValue(null)
    render(<SupabaseSessionBridge />)

    expect(await tokenFailure()).toBe('session-ended')
  })
})
