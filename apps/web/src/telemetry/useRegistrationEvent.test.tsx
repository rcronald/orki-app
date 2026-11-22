import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { plant } from '../test/collection.ts'
import type { ProductEvent } from './events.ts'
import { useRegistrationEvent } from './useRegistrationEvent.ts'

const AT = new Date('2026-11-21T12:00:00.000Z')

let clock = 0
let record: ReturnType<typeof vi.fn<(event: ProductEvent | null) => void>>

function renderRegistration() {
  return renderHook(() =>
    useRegistrationEvent({
      offline: false,
      record,
      clock: () => clock,
      now: () => AT,
    }),
  )
}

beforeEach(() => {
  clock = 1000
  record = vi.fn()
})

describe('evento "registro completado"', () => {
  it('mide desde que se abre el formulario, con foto y nombre por validar', () => {
    const { result } = renderRegistration()
    clock = 43_500
    act(() =>
      result.current.onRegistered(
        plant({ photoPath: 'user/planta/foto.webp', validation: 'pending' }),
      ),
    )
    expect(record).toHaveBeenCalledTimes(1)
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      type: 'plant_registered',
      result: null,
      duration_ms: 42_500,
      has_photo: true,
      name_pending: true,
      generated_offline: false,
      occurred_at: AT.toISOString(),
    })
  })

  it('«con foto» es verdadero con al menos una foto de la galería, aunque la planta aún no la refleje', () => {
    const { result } = renderRegistration()
    clock = 21_000
    act(() =>
      result.current.onRegistered(
        plant({ photoPath: null, validation: 'validated' }),
        { hasPhoto: true },
      ),
    )
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      duration_ms: 20_000,
      has_photo: true,
      name_pending: false,
    })
  })

  it('por defecto, «con foto» es tener al menos una (photoCount, #184)', () => {
    const { result } = renderRegistration()
    act(() => result.current.onRegistered(plant({ photoCount: 0 })))
    expect(record.mock.calls[0]?.[0]).toMatchObject({ has_photo: false })

    const second = renderRegistration()
    act(() =>
      second.result.current.onRegistered(
        plant({ photoPath: 'user/planta/foto.webp', photoCount: 3 }),
      ),
    )
    expect(record.mock.calls[1]?.[0]).toMatchObject({ has_photo: true })
  })

  it('sin fotos, «con foto» es falso; y se envía solo una vez', () => {
    const { result } = renderRegistration()
    clock = 11_000
    act(() => result.current.onRegistered(plant(), { hasPhoto: false }))
    act(() => result.current.onRegistered(plant(), { hasPhoto: true }))
    expect(record).toHaveBeenCalledTimes(1)
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      duration_ms: 10_000,
      has_photo: false,
    })
  })
})
