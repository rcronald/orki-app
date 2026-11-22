import { afterEach, describe, expect, it, vi } from 'vitest'
import { haveItSearchEvent, type ProductEvent } from './events.ts'
import {
  recordProductEvent,
  setProductEventsRuntimeLoader,
  setProductEventsSession,
} from './product-events.ts'
import type { ProductEventsRuntime } from './runtime.ts'

const EVENT = haveItSearchEvent({
  id: 'e1',
  durationMs: 10,
  outcome: 'owned',
  offline: false,
  occurredAt: new Date('2026-11-21T12:00:00.000Z'),
}) as ProductEvent

function fakeRuntime() {
  return {
    setSession: vi.fn<ProductEventsRuntime['setSession']>(),
    record: vi.fn<ProductEventsRuntime['record']>(),
    flush: vi.fn(() => Promise.resolve()),
  }
}

async function settle() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}

afterEach(() => {
  setProductEventsRuntimeLoader(null)
})

describe('punto de entrada de los eventos', () => {
  it('sin sesión no carga nada y descarta los eventos', async () => {
    const loader = vi.fn(() => Promise.resolve(fakeRuntime()))
    setProductEventsRuntimeLoader(loader)
    recordProductEvent(EVENT)
    await settle()
    expect(loader).not.toHaveBeenCalled()
  })

  it('carga la cola una vez y guarda a nombre del usuario activo', async () => {
    const runtime = fakeRuntime()
    const loader = vi.fn(() => Promise.resolve(runtime))
    setProductEventsRuntimeLoader(loader)
    const session = { userId: 'user_a', confirmed: true, online: true }
    setProductEventsSession(session)
    setProductEventsSession({ ...session })
    recordProductEvent(EVENT)
    recordProductEvent(null)
    await settle()
    expect(loader).toHaveBeenCalledTimes(1)
    expect(runtime.setSession).toHaveBeenLastCalledWith(session)
    expect(runtime.record).toHaveBeenCalledTimes(1)
    expect(runtime.record).toHaveBeenCalledWith('user_a', EVENT)

    // Al cerrar sesión, nadie: lo que llegue después se descarta.
    setProductEventsSession(null)
    recordProductEvent(EVENT)
    await settle()
    expect(runtime.setSession).toHaveBeenLastCalledWith(null)
    expect(runtime.record).toHaveBeenCalledTimes(1)
  })

  it('si la carga falla, la siguiente vez lo vuelve a intentar con la sesión de ahora', async () => {
    const runtime = fakeRuntime()
    const loader = vi
      .fn<() => Promise<ProductEventsRuntime>>()
      .mockRejectedValueOnce(new Error('sin chunk'))
      .mockResolvedValue(runtime)
    setProductEventsRuntimeLoader(loader)
    setProductEventsSession({
      userId: 'user_a',
      confirmed: false,
      online: false,
    })
    await settle()
    recordProductEvent(EVENT)
    await settle()
    expect(loader).toHaveBeenCalledTimes(2)
    expect(runtime.setSession).toHaveBeenCalledWith({
      userId: 'user_a',
      confirmed: false,
      online: false,
    })
    expect(runtime.record).toHaveBeenCalledWith('user_a', EVENT)
  })
})
