import { describe, expect, it, vi } from 'vitest'
import {
  AccountDeletionError,
  DELETION_STEPS,
  deleteAccountAndData,
  type AccountDeletionEffects,
  type DeletionStep,
} from './deletion.ts'
import { failureText } from './texts.ts'

const USER = 'user_prueba'

/** Efectos que anotan cada llamada en `calls`; `failing` hace fallar pasos. */
function fakeEffects(failing: Partial<Record<DeletionStep, Error>> = {}) {
  const calls: string[] = []
  const failures = { ...failing }
  const step = (name: DeletionStep) => (userId?: string) => {
    calls.push(userId ? `${name}:${userId}` : name)
    const error = failures[name]
    if (error) {
      // Falla una sola vez: el reintento sale bien.
      delete failures[name]
      return Promise.reject(error)
    }
    return Promise.resolve()
  }
  const effects: AccountDeletionEffects = {
    deletePhotos: step('photos'),
    deletePlants: step('plants'),
    deleteProfile: step('profile'),
    deleteAccount: step('account'),
  }
  return { effects, calls }
}

describe('deleteAccountAndData', () => {
  it('borra fotos, plantas, perfil y cuenta, en ese orden', async () => {
    const { effects, calls } = fakeEffects()
    const started: DeletionStep[] = []
    const done: DeletionStep[] = []

    const result = await deleteAccountAndData({
      userId: USER,
      effects,
      canDeleteAccount: true,
      onStepStart: (step) => started.push(step),
      onStepDone: (step) => done.push(step),
    })

    expect(result).toEqual({ ok: true })
    expect(calls).toEqual([
      `photos:${USER}`,
      `plants:${USER}`,
      `profile:${USER}`,
      'account',
    ])
    expect(started).toEqual([...DELETION_STEPS])
    expect(done).toEqual([...DELETION_STEPS])
  })

  it.each(DELETION_STEPS.map((step, index) => [step, index] as const))(
    'si falla %s, no sigue y el reintento desde ese paso termina',
    async (failingStep, index) => {
      const { effects, calls } = fakeEffects({
        [failingStep]: new AccountDeletionError('offline'),
      })

      const first = await deleteAccountAndData({
        userId: USER,
        effects,
        canDeleteAccount: true,
      })

      expect(first).toMatchObject({
        ok: false,
        step: failingStep,
        reason: 'offline',
      })
      // Se ejecutaron los anteriores y el que falló; ninguno de los siguientes.
      expect(calls.map((call) => call.split(':')[0])).toEqual(
        DELETION_STEPS.slice(0, index + 1),
      )

      calls.length = 0
      const retry = await deleteAccountAndData({
        userId: USER,
        effects,
        canDeleteAccount: true,
        from: failingStep,
      })
      expect(retry).toEqual({ ok: true })
      expect(calls.map((call) => call.split(':')[0])).toEqual(
        DELETION_STEPS.slice(index),
      )
    },
  )

  it('reintentar desde el principio también termina (pasos idempotentes)', async () => {
    const { effects } = fakeEffects({ profile: new Error('500') })
    const first = await deleteAccountAndData({
      userId: USER,
      effects,
      canDeleteAccount: true,
    })
    expect(first).toMatchObject({
      ok: false,
      step: 'profile',
      reason: 'failed',
    })

    const again = await deleteAccountAndData({
      userId: USER,
      effects,
      canDeleteAccount: true,
    })
    expect(again).toEqual({ ok: true })
  })

  it('un error sin motivo cuenta como failed', async () => {
    const { effects } = fakeEffects({ plants: new TypeError('algo raro') })
    const result = await deleteAccountAndData({
      userId: USER,
      effects,
      canDeleteAccount: true,
    })
    expect(result).toMatchObject({
      ok: false,
      step: 'plants',
      reason: 'failed',
    })
  })

  it('si Clerk no deja eliminar la cuenta, no borra nada', async () => {
    const { effects, calls } = fakeEffects()
    const onStepStart = vi.fn()

    const result = await deleteAccountAndData({
      userId: USER,
      effects,
      canDeleteAccount: false,
      onStepStart,
    })

    expect(result).toMatchObject({
      ok: false,
      step: 'account',
      reason: 'not-allowed',
    })
    expect(calls).toEqual([])
    expect(onStepStart).not.toHaveBeenCalled()
  })

  it('si Clerk rechaza al final, los datos ya se borraron y se dice', async () => {
    const { effects, calls } = fakeEffects({
      account: new AccountDeletionError('not-allowed'),
    })
    const result = await deleteAccountAndData({
      userId: USER,
      effects,
      canDeleteAccount: true,
    })
    expect(result).toMatchObject({
      ok: false,
      step: 'account',
      reason: 'not-allowed',
    })
    expect(calls).toHaveLength(4)
    if (!result.ok) {
      expect(failureText(result.step, result.reason)).toBe(
        'No se pudo eliminar tu cuenta de acceso. Orki todavía no permite eliminar la cuenta desde la app. Tus fotos, tus plantas y tu perfil ya se borraron; solo queda tu cuenta de acceso, vacía. Para eliminarla, escribe a quien administra Orki.',
      )
    }
  })
})

describe('failureText', () => {
  it('dice qué falló, por qué, qué quedó y qué hacer', () => {
    expect(failureText('photos', 'offline')).toBe(
      'No se pudieron borrar tus fotos. No hay conexión. No se borró nada: tus fotos, tus plantas, tu perfil y tu cuenta siguen igual. Vuelve a intentarlo: se continuará donde se quedó.',
    )
    expect(failureText('plants', 'failed')).toContain(
      'Tus fotos ya se borraron; tus plantas, tu perfil y tu cuenta siguen.',
    )
    expect(failureText('account', 'reverification-cancelled')).toContain(
      'confirmar que eres tú',
    )
    expect(failureText('profile', 'session-ended')).toContain(
      'Vuelve a iniciar sesión',
    )
  })
})
