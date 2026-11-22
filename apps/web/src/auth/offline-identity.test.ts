import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearPendingSignOut,
  forgetUser,
  getOfflineIdentity,
  LAST_USER_KEY,
  markSignedOut,
  PENDING_SIGN_OUT_KEY,
  rememberUser,
  resetOfflineIdentity,
} from './offline-identity.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('identidad sin conexión', () => {
  it('recuerda solo el id del último usuario, en localStorage', () => {
    rememberUser('user_a')
    expect(localStorage.getItem(LAST_USER_KEY)).toBe('user_a')
    resetOfflineIdentity()
    expect(getOfflineIdentity()).toEqual({
      lastUserId: 'user_a',
      pendingSignOut: null,
    })
  })

  it('cerrar sesión aquí olvida al usuario y deja el cierre pendiente', () => {
    rememberUser('user_a')
    markSignedOut('user_a')
    expect(getOfflineIdentity()).toEqual({
      lastUserId: null,
      pendingSignOut: 'user_a',
    })
    expect(localStorage.getItem(LAST_USER_KEY)).toBeNull()
    expect(localStorage.getItem(PENDING_SIGN_OUT_KEY)).toBe('user_a')

    // Sin sesión según Clerk: el cierre pendiente se conserva hasta que lo
    // confirme.
    forgetUser()
    expect(getOfflineIdentity().pendingSignOut).toBe('user_a')
    clearPendingSignOut()
    expect(getOfflineIdentity()).toEqual({
      lastUserId: null,
      pendingSignOut: null,
    })
    expect(localStorage.getItem(PENDING_SIGN_OUT_KEY)).toBeNull()
  })

  it('sin localStorage utilizable, funciona en memoria', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Bloqueado', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Lleno', 'QuotaExceededError')
    })
    resetOfflineIdentity()
    expect(getOfflineIdentity().lastUserId).toBeNull()
    rememberUser('user_a')
    expect(getOfflineIdentity().lastUserId).toBe('user_a')
  })
})
