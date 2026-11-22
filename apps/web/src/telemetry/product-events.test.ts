import { afterEach, describe, expect, it, vi } from 'vitest'
import { haveItSearchEvent, type ProductEvent } from './events.ts'
import {
  discardProductEvents,
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
    settle: vi.fn(() => Promise.resolve()),
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

  it('discardProductEvents deja sin sesión, espera a la cola y descarta lo que llegue después (#110)', async () => {
    const runtime = fakeRuntime()
    let finishSettle: () => void = () => {}
    runtime.settle.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishSettle = resolve
        }),
    )
    setProductEventsRuntimeLoader(() => Promise.resolve(runtime))
    setProductEventsSession({ userId: 'user_a', confirmed: true, online: true })

    let done = false
    const discarded = discardProductEvents().then(() => {
      done = true
    })
    await settle()
    expect(runtime.setSession).toHaveBeenLastCalledWith(null)
    expect(runtime.settle).toHaveBeenCalled()
    // Hasta que la cola y el envío en curso terminan, no se resuelve.
    expect(done).toBe(false)
    finishSettle()
    await discarded
    expect(done).toBe(true)

    recordProductEvent(EVENT)
    await settle()
    expect(runtime.record).not.toHaveBeenCalled()
  })

  it('discardProductEvents carga la cola aunque no hubiera sesión, para borrarla', async () => {
    const runtime = fakeRuntime()
    const loader = vi.fn(() => Promise.resolve(runtime))
    setProductEventsRuntimeLoader(loader)
    await discardProductEvents()
    expect(loader).toHaveBeenCalledTimes(1)
    expect(runtime.setSession).toHaveBeenCalledWith(null)
    expect(runtime.settle).toHaveBeenCalled()
  })

  it('discardProductEvents se resuelve aunque la cola no se pueda cargar', async () => {
    setProductEventsRuntimeLoader(() => Promise.reject(new Error('sin chunk')))
    await expect(discardProductEvents()).resolves.toBeUndefined()
  })
})
