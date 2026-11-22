import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { haveItSearchEvent, type ProductEvent } from './events.ts'
import { createMemoryEventQueue } from './queue.ts'
import {
  createProductEventsRuntime,
  RETRY_BASE_MS,
  type ProductEventsSession,
} from './runtime.ts'
import type { SendOutcome } from './sender.ts'

const NOW = new Date('2026-11-21T12:00:00.000Z')

function event(id: string, offline = false): ProductEvent {
  const created = haveItSearchEvent({
    id,
    durationMs: 800,
    outcome: 'owned',
    offline,
    occurredAt: NOW,
  })
  if (created === null) throw new Error('evento inválido')
  return created
}

const A_ONLINE: ProductEventsSession = {
  userId: 'user_a',
  confirmed: true,
  online: true,
}

let storage: ReturnType<typeof createMemoryEventQueue>
let send: ReturnType<
  typeof vi.fn<
    (
      events: readonly ProductEvent[],
      signal: AbortSignal,
    ) => Promise<SendOutcome>
  >
>

function create() {
  return createProductEventsRuntime({ storage, send, now: () => NOW })
}

/** Deja correr las promesas pendientes (la cola y el envío). */
async function settle() {
  await vi.advanceTimersByTimeAsync(0)
}

const sentIds = () =>
  send.mock.calls.map(([events]) => events.map(({ id }) => id))

beforeEach(() => {
  vi.useFakeTimers()
  storage = createMemoryEventQueue()
  send = vi.fn(() => Promise.resolve<SendOutcome>('sent'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('eventos de producto: cola y envío', () => {
  it('con la sesión confirmada y conexión, envía y vacía la cola', async () => {
    const runtime = create()
    runtime.setSession(A_ONLINE)
    runtime.record('user_a', event('e1'))
    await settle()
    expect(sentIds()).toEqual([['e1']])
    expect(storage.queues.size).toBe(0)
  })

  it('sin conexión guarda la búsqueda y la envía al volver la red, con su marca y su hora', async () => {
    const runtime = create()
    runtime.setSession({ ...A_ONLINE, online: false })
    runtime.record('user_a', event('e1', true))
    await settle()
    expect(send).not.toHaveBeenCalled()
    expect(storage.queues.get('user_a')).toHaveLength(1)

    runtime.setSession(A_ONLINE)
    await settle()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[0][0]).toMatchObject({
      id: 'e1',
      generated_offline: true,
      occurred_at: NOW.toISOString(),
    })
    expect(storage.queues.size).toBe(0)
  })

  it('con la sesión sin confirmar no pide nada a la red', async () => {
    const runtime = create()
    runtime.setSession({ ...A_ONLINE, confirmed: false })
    runtime.record('user_a', event('e1', true))
    await runtime.flush()
    await settle()
    expect(send).not.toHaveBeenCalled()

    // Clerk confirma al mismo usuario.
    runtime.setSession(A_ONLINE)
    await settle()
    expect(sentIds()).toEqual([['e1']])
  })

  it('un fallo no lanza, deja la cola y se reintenta más tarde', async () => {
    send.mockResolvedValueOnce('retry')
    const runtime = create()
    runtime.setSession(A_ONLINE)
    runtime.record('user_a', event('e1'))
    await settle()
    expect(send).toHaveBeenCalledTimes(1)
    expect(storage.queues.get('user_a')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS)
    expect(send).toHaveBeenCalledTimes(2)
    expect(storage.queues.size).toBe(0)
  })

  it('las esperas entre reintentos crecen', async () => {
    send.mockResolvedValue('retry')
    const runtime = create()
    runtime.setSession(A_ONLINE)
    runtime.record('user_a', event('e1'))
    await settle()
    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS)
    expect(send).toHaveBeenCalledTimes(2)
    // La segunda espera es el doble.
    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS)
    expect(send).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS)
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('un lote rechazado por la base se descarta', async () => {
    send.mockResolvedValueOnce('rejected')
    const runtime = create()
    runtime.setSession(A_ONLINE)
    runtime.record('user_a', event('e1'))
    await settle()
    expect(storage.queues.size).toBe(0)
    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS * 4)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('envía en lotes de 100 como mucho', async () => {
    const runtime = create()
    runtime.setSession({ ...A_ONLINE, online: false })
    for (let index = 0; index < 230; index += 1) {
      runtime.record('user_a', event(`e${index}`))
    }
    await settle()
    runtime.setSession(A_ONLINE)
    await settle()
    expect(send.mock.calls.map(([events]) => events.length)).toEqual([
      100, 100, 30,
    ])
  })

  it('un evento de quien no es el usuario activo, o sin usuario, se descarta', async () => {
    const runtime = create()
    runtime.record('user_a', event('sin-sesion'))
    runtime.setSession(A_ONLINE)
    runtime.record('user_b', event('de-otro'))
    await settle()
    expect(send).not.toHaveBeenCalled()
    expect(storage.queues.size).toBe(0)
  })

  it('al cerrar sesión se borra la cola: nada se envía con otra cuenta', async () => {
    const runtime = create()
    runtime.setSession({ ...A_ONLINE, confirmed: false, online: false })
    runtime.record('user_a', event('de-a', true))
    await settle()
    expect(storage.queues.get('user_a')).toHaveLength(1)

    runtime.setSession(null)
    await settle()
    expect(storage.queues.size).toBe(0)

    runtime.setSession({ userId: 'user_b', confirmed: true, online: true })
    runtime.record('user_b', event('de-b'))
    await settle()
    expect(sentIds()).toEqual([['de-b']])
  })

  it('otra cuenta sin cerrar sesión antes: se borran las colas de las demás', async () => {
    const runtime = create()
    runtime.setSession({ ...A_ONLINE, online: false })
    runtime.record('user_a', event('de-a'))
    await settle()
    runtime.setSession({ userId: 'user_b', confirmed: true, online: true })
    await settle()
    expect(send).not.toHaveBeenCalled()
    expect(storage.queues.has('user_a')).toBe(false)
  })

  it('un envío en curso se cancela al cambiar de cuenta y no toca la cola nueva', async () => {
    let resolve: (outcome: SendOutcome) => void = () => {}
    send.mockImplementationOnce(
      () =>
        new Promise<SendOutcome>((done) => {
          resolve = done
        }),
    )
    const runtime = create()
    runtime.setSession(A_ONLINE)
    runtime.record('user_a', event('de-a'))
    await settle()
    const signal = send.mock.calls[0]?.[1]
    expect(signal?.aborted).toBe(false)

    runtime.setSession(null)
    expect(signal?.aborted).toBe(true)
    resolve('retry')
    await settle()
    // No queda ningún reintento de la cuenta anterior.
    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS * 4)
    expect(send).toHaveBeenCalledTimes(1)
    expect(storage.queues.size).toBe(0)
  })

  it('lo que llega mientras se envía sale en la vuelta siguiente', async () => {
    let resolve: (outcome: SendOutcome) => void = () => {}
    send.mockImplementationOnce(
      () =>
        new Promise<SendOutcome>((done) => {
          resolve = done
        }),
    )
    const runtime = create()
    runtime.setSession(A_ONLINE)
    runtime.record('user_a', event('e1'))
    await settle()
    runtime.record('user_a', event('e2'))
    await settle()
    resolve('sent')
    await settle()
    expect(sentIds()).toEqual([['e1'], ['e2']])
    expect(storage.queues.size).toBe(0)
  })

  it('settle espera al borrado de las colas y al envío en curso (#110)', async () => {
    let finishSend: (outcome: SendOutcome) => void = () => {}
    send.mockImplementation(
      () =>
        new Promise<SendOutcome>((resolve) => {
          finishSend = resolve
        }),
    )
    const runtime = create()
    runtime.setSession(A_ONLINE)
    runtime.record('user_a', event('e1'))
    await settle()
    expect(send).toHaveBeenCalledTimes(1)

    // Como al eliminar la cuenta: sin sesión, y esperar a que todo termine.
    runtime.setSession(null)
    runtime.record('user_a', event('e2'))
    let settled = false
    const done = runtime.settle().then(() => {
      settled = true
    })
    await settle()
    // El envío en curso se canceló, pero settle espera a que se resuelva.
    finishSend('sent')
    await settle()
    await done
    expect(settled).toBe(true)
    expect(storage.queues.size).toBe(0)
    // Nada más sale después.
    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS * 4)
    expect(send).toHaveBeenCalledTimes(1)
  })
})
