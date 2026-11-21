import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FAKE_USER_ID,
  resetFakeClerk,
  setFakeClerk,
} from '../test/clerk-mock.tsx'
import { ObservedUser } from './ObservedUser.tsx'

vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))

beforeEach(() => {
  resetFakeClerk()
})

describe('ObservedUser', () => {
  it('con sesión, pasa solo el id de Clerk', () => {
    setFakeClerk({ signedIn: true })
    const setUserId = vi.fn()

    render(<ObservedUser reporter={{ setUserId }} />)

    expect(setUserId).toHaveBeenCalledWith(FAKE_USER_ID)
  })

  it('sin sesión, no hay usuario', () => {
    const setUserId = vi.fn()

    render(<ObservedUser reporter={{ setUserId }} />)

    expect(setUserId).toHaveBeenCalledWith(null)
  })

  it('mientras Clerk carga, no cambia nada', () => {
    setFakeClerk({ status: 'loading' })
    const setUserId = vi.fn()

    render(<ObservedUser reporter={{ setUserId }} />)

    expect(setUserId).not.toHaveBeenCalled()
  })
})
