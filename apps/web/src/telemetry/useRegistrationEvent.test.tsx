import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { plant } from '../test/collection.ts'
import type { ProductEvent } from './events.ts'
import { useRegistrationEvent } from './useRegistrationEvent.ts'

const AT = new Date('2026-11-21T12:00:00.000Z')

let clock = 0
let record: ReturnType<typeof vi.fn<(event: ProductEvent | null) => void>>

function renderRegistration(photoFirst = false) {
  return renderHook(() =>
    useRegistrationEvent({
      photoFirst,
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

  it('con "Con foto", desde que se elige la primera foto', () => {
    const { result } = renderRegistration(true)
    clock = 5000
    act(() => result.current.onPhotoChosen())
    clock = 9000
    // Cambiar la foto no mueve el inicio.
    act(() => result.current.onPhotoChosen())
    clock = 25_000
    act(() =>
      result.current.onRegistered(
        plant({ photoPath: null, validation: 'validated' }),
      ),
    )
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      duration_ms: 20_000,
      has_photo: false,
      name_pending: false,
    })
  })

  it('"Con foto" sin elegir ninguna mide desde que se abrió; y solo una vez', () => {
    const { result } = renderRegistration(true)
    clock = 11_000
    act(() => result.current.onRegistered(plant()))
    act(() => result.current.onRegistered(plant()))
    expect(record).toHaveBeenCalledTimes(1)
    expect(record.mock.calls[0]?.[0]?.duration_ms).toBe(10_000)
  })
})
