import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFakeClerk, setFakeClerk } from '../test/clerk-mock.tsx'
import { markSignedOut, rememberUser } from './offline-identity.ts'
import { useAppIdentity } from './useAppIdentity.ts'

vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))

let online = true

beforeEach(() => {
  resetFakeClerk()
  online = true
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const identity = () => renderHook(() => useAppIdentity()).result.current

describe('useAppIdentity', () => {
  it('con Clerk: la sesión que dice Clerk', () => {
    setFakeClerk({ status: 'ready', signedIn: true, userId: 'user_a' })
    expect(identity()).toEqual({ kind: 'signed-in', userId: 'user_a' })
    setFakeClerk({ signedIn: false })
    expect(identity()).toEqual({ kind: 'signed-out' })
  })

  it('mientras Clerk carga con conexión: cargando, aunque haya un usuario recordado', () => {
    rememberUser('user_a')
    setFakeClerk({ status: 'loading' })
    expect(identity()).toEqual({ kind: 'loading' })
  })

  it('sin conexión y Clerk sin cargar: el último usuario, sin confirmar', () => {
    rememberUser('user_a')
    online = false
    setFakeClerk({ status: 'loading' })
    expect(identity()).toEqual({
      kind: 'unverified',
      userId: 'user_a',
      reason: 'offline',
    })
  })

  it('Clerk falló con conexión: el último usuario, sin confirmar', () => {
    rememberUser('user_a')
    setFakeClerk({ status: 'error' })
    expect(identity()).toEqual({
      kind: 'unverified',
      userId: 'user_a',
      reason: 'failed',
    })
  })

  it('sin Clerk y sin usuario recordado: no disponible', () => {
    online = false
    setFakeClerk({ status: 'error' })
    expect(identity()).toEqual({ kind: 'unavailable', reason: 'offline' })
  })

  it('Clerk dice "sin sesión" sin conexión: no se borra nada, sin confirmar', () => {
    rememberUser('user_a')
    online = false
    setFakeClerk({ status: 'ready', signedIn: false })
    expect(identity()).toMatchObject({ kind: 'unverified', userId: 'user_a' })
  })

  it('tras cerrar sesión aquí: sin sesión, aunque Clerk aún la tenga', () => {
    setFakeClerk({ status: 'ready', signedIn: true, userId: 'user_a' })
    markSignedOut('user_a')
    expect(identity()).toEqual({ kind: 'signed-out' })
    // Otra cuenta sí entra.
    setFakeClerk({ userId: 'user_b' })
    expect(identity()).toEqual({ kind: 'signed-in', userId: 'user_b' })
    // Sin Clerk, también sin sesión.
    setFakeClerk({ status: 'error' })
    expect(identity()).toEqual({ kind: 'signed-out' })
  })
})
