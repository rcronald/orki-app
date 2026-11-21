import { describe, expect, it } from 'vitest'
import { clerkDeletionReason, deleteClerkAccount } from './clerk-deletion.ts'
import { AccountDeletionError } from './deletion.ts'

describe('clerkDeletionReason', () => {
  it.each([
    // La persona cerró la ventana de reverificación de Clerk.
    [
      { name: 'ClerkRuntimeError', code: 'reverification_cancelled' },
      'reverification-cancelled',
    ],
    // La reverificación hacía falta y no se pidió (sin useReverification).
    [
      { status: 403, errors: [{ code: 'session_reverification_required' }] },
      'reverification-cancelled',
    ],
    // Ajuste "Allow users to delete their accounts" desactivado (supuesto: 403).
    [{ status: 403, errors: [{ code: 'not_allowed' }] }, 'not-allowed'],
    [
      { status: 401, errors: [{ code: 'authentication_invalid' }] },
      'session-ended',
    ],
    [{ name: 'ClerkOfflineError', message: 'offline' }, 'offline'],
    [
      new TypeError('NetworkError when attempting to fetch resource.'),
      'offline',
    ],
    [{ status: 500 }, 'failed'],
    ['texto', 'failed'],
    [null, 'failed'],
  ] as const)('%o: %s', (error, reason) => {
    expect(clerkDeletionReason(error)).toBe(reason)
  })
})

describe('deleteClerkAccount', () => {
  it('llama a la función de borrado y traduce su fallo', async () => {
    await expect(
      deleteClerkAccount(() => Promise.resolve()),
    ).resolves.toBeUndefined()
    const error = await deleteClerkAccount(() =>
      Promise.reject(
        Object.assign(new Error('403'), {
          status: 403,
          errors: [{ code: 'x' }],
        }),
      ),
    ).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AccountDeletionError)
    expect(error).toMatchObject({ reason: 'not-allowed' })
  })
})
