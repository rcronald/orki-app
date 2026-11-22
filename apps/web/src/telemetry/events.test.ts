import { describe, expect, it } from 'vitest'
import {
  haveItSearchEvent,
  isProductEvent,
  MAX_EVENT_DURATION_MS,
  plantRegisteredEvent,
} from './events.ts'

const AT = new Date('2026-11-21T15:30:00.000Z')

describe('eventos de producto', () => {
  it('registro completado: solo los campos de la base, con la duración entera', () => {
    const event = plantRegisteredEvent({
      id: 'e1',
      durationMs: 41_234.6,
      hasPhoto: true,
      namePending: false,
      offline: false,
      occurredAt: AT,
    })
    expect(event).toEqual({
      id: 'e1',
      type: 'plant_registered',
      result: null,
      duration_ms: 41_235,
      has_photo: true,
      name_pending: false,
      generated_offline: false,
      occurred_at: '2026-11-21T15:30:00.000Z',
    })
    expect(isProductEvent(event)).toBe(true)
  })

  it('búsqueda ¿Ya la tengo?: el resultado con los valores de la base y sin texto', () => {
    const outcomes = (['owned', 'similar', 'not-owned'] as const).map(
      (outcome) =>
        haveItSearchEvent({
          durationMs: 1200,
          outcome,
          offline: true,
          occurredAt: AT,
        }),
    )
    expect(outcomes.map((event) => event?.result)).toEqual([
      'owned',
      'similar',
      'not_owned',
    ])
    const [first] = outcomes
    expect(first).toMatchObject({
      type: 'have_it_search',
      duration_ms: 1200,
      has_photo: null,
      name_pending: null,
      generated_offline: true,
    })
    expect(Object.keys(first ?? {}).sort()).toEqual([
      'duration_ms',
      'generated_offline',
      'has_photo',
      'id',
      'name_pending',
      'occurred_at',
      'result',
      'type',
    ])
    expect(first?.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(outcomes.every(isProductEvent)).toBe(true)
  })

  it('una duración negativa queda en 0 y una de más de 24 horas no se envía', () => {
    expect(
      haveItSearchEvent({
        durationMs: -5,
        outcome: 'owned',
        offline: false,
        occurredAt: AT,
      })?.duration_ms,
    ).toBe(0)
    expect(
      plantRegisteredEvent({
        durationMs: MAX_EVENT_DURATION_MS + 1,
        hasPhoto: false,
        namePending: true,
        offline: false,
        occurredAt: AT,
      }),
    ).toBeNull()
    expect(
      haveItSearchEvent({
        durationMs: Number.NaN,
        outcome: 'owned',
        offline: false,
        occurredAt: AT,
      }),
    ).toBeNull()
  })

  it('reconoce lo que no es un evento válido', () => {
    const valid = haveItSearchEvent({
      durationMs: 10,
      outcome: 'owned',
      offline: false,
      occurredAt: AT,
    })
    expect(isProductEvent(null)).toBe(false)
    expect(isProductEvent({ ...valid, result: 'quizá' })).toBe(false)
    expect(isProductEvent({ ...valid, has_photo: true })).toBe(false)
    expect(isProductEvent({ ...valid, duration_ms: 1.5 })).toBe(false)
    expect(isProductEvent({ ...valid, occurred_at: 'ayer' })).toBe(false)
    expect(isProductEvent({ ...valid, type: 'otro' })).toBe(false)
  })
})
