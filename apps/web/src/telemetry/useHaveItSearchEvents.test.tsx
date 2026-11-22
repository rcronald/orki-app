import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OwnershipMeasurement } from '../inventory/ownership-measure.ts'
import type { ProductEvent } from './events.ts'
import {
  STABLE_ANSWER_MS,
  useHaveItSearchEvents,
} from './useHaveItSearchEvents.ts'

const AT = new Date('2026-11-21T12:00:00.000Z')

function measurement(
  overrides: Partial<OwnershipMeasurement> = {},
): OwnershipMeasurement {
  return {
    searchId: 1,
    startedByTyping: true,
    durationMs: 900,
    computeMs: 2,
    outcome: 'owned',
    scope: 'species',
    source: 'local',
    matchCount: 1,
    online: true,
    ...overrides,
  }
}

let record: ReturnType<typeof vi.fn<(event: ProductEvent | null) => void>>

function renderTracker(initial = { searching: true, offline: false }) {
  return renderHook(
    (props: { searching: boolean; offline: boolean }) =>
      useHaveItSearchEvents({ ...props, record, now: () => AT }),
    { initialProps: initial },
  )
}

const recorded = () =>
  record.mock.calls.map(([event]) => event).filter((event) => event !== null)

beforeEach(() => {
  vi.useFakeTimers()
  record = vi.fn()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('cuándo cuenta una búsqueda de "¿Ya la tengo?"', () => {
  it('mientras se escribe no cuenta; cuenta la respuesta que se queda en pantalla', () => {
    const { result } = renderTracker()
    act(() => {
      result.current(measurement({ durationMs: 300, outcome: 'not-owned' }))
    })
    act(() => {
      vi.advanceTimersByTime(STABLE_ANSWER_MS - 1)
    })
    act(() => {
      result.current(measurement({ durationMs: 700, outcome: 'similar' }))
    })
    act(() => {
      result.current(measurement({ durationMs: 1100, outcome: 'owned' }))
    })
    expect(record).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(STABLE_ANSWER_MS)
    })
    expect(recorded()).toHaveLength(1)
    expect(recorded()[0]).toMatchObject({
      type: 'have_it_search',
      result: 'owned',
      duration_ms: 1100,
      generated_offline: false,
      occurred_at: AT.toISOString(),
    })
  })

  it('una sola vez por búsqueda: lo que llega después no cuenta', () => {
    const { result } = renderTracker()
    act(() => {
      result.current(measurement())
    })
    act(() => {
      vi.advanceTimersByTime(STABLE_ANSWER_MS)
    })
    act(() => {
      result.current(measurement({ source: 'catalog' }))
    })
    act(() => {
      vi.advanceTimersByTime(STABLE_ANSWER_MS * 2)
    })
    expect(recorded()).toHaveLength(1)

    // Otra búsqueda sí.
    act(() => {
      result.current(measurement({ searchId: 2, outcome: 'not-owned' }))
    })
    act(() => {
      vi.advanceTimersByTime(STABLE_ANSWER_MS)
    })
    expect(recorded().map((event) => event.result)).toEqual([
      'owned',
      'not_owned',
    ])
  })

  it('vaciar el buscador antes de tiempo descarta la respuesta', () => {
    const { result, rerender } = renderTracker()
    act(() => {
      result.current(measurement())
    })
    rerender({ searching: false, offline: false })
    act(() => {
      vi.advanceTimersByTime(STABLE_ANSWER_MS * 2)
    })
    expect(record).not.toHaveBeenCalled()
  })

  it('una búsqueda que ya venía al abrir la pantalla no cuenta', () => {
    const { result } = renderTracker()
    act(() => {
      result.current(measurement({ startedByTyping: false }))
    })
    act(() => {
      vi.advanceTimersByTime(STABLE_ANSWER_MS * 2)
    })
    expect(record).not.toHaveBeenCalled()
  })

  it('al salir de la pantalla o al ocultarse la app cuenta lo que se veía', () => {
    const first = renderTracker()
    act(() => {
      first.result.current(measurement({ durationMs: 400 }))
    })
    first.unmount()
    expect(recorded().map((event) => event.duration_ms)).toEqual([400])

    const second = renderTracker()
    act(() => {
      second.result.current(measurement({ searchId: 5 }))
    })
    const visibility = vi
      .spyOn(document, 'visibilityState', 'get')
      .mockReturnValue('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    visibility.mockRestore()
    expect(recorded()).toHaveLength(2)
    act(() => {
      vi.advanceTimersByTime(STABLE_ANSWER_MS * 2)
    })
    second.unmount()
    expect(recorded()).toHaveLength(2)
  })

  it('sin conexión o con la sesión sin confirmar, va marcada como generada sin conexión', () => {
    const { result } = renderTracker({ searching: true, offline: true })
    act(() => {
      result.current(measurement())
    })
    act(() => {
      vi.advanceTimersByTime(STABLE_ANSWER_MS)
    })
    act(() => {
      result.current(measurement({ searchId: 2, online: false }))
    })
    act(() => {
      vi.advanceTimersByTime(STABLE_ANSWER_MS)
    })
    expect(recorded().map((event) => event.generated_offline)).toEqual([
      true,
      true,
    ])
  })
})
