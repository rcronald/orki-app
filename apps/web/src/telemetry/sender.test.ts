import { describe, expect, it, vi } from 'vitest'
import { haveItSearchEvent, type ProductEvent } from './events.ts'
import { createSupabaseSender, isDataError } from './sender.ts'

const EVENT = haveItSearchEvent({
  id: '7a1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b',
  durationMs: 1500,
  outcome: 'similar',
  offline: false,
  occurredAt: new Date('2026-11-21T12:00:00.000Z'),
}) as ProductEvent

function fakeClient(result: { error: unknown } | Error) {
  const abortSignal = vi.fn((signal: AbortSignal) => {
    void signal
    return result instanceof Error
      ? Promise.reject(result)
      : Promise.resolve(result)
  })
  const rpc = vi.fn((name: string, args: unknown) => {
    void name
    void args
    return { abortSignal }
  })
  return { client: { rpc }, rpc, abortSignal }
}

describe('envío de eventos', () => {
  it('llama a record_product_events con el lote y la señal de cancelación', async () => {
    const { client, rpc, abortSignal } = fakeClient({ error: null })
    const send = createSupabaseSender(() => Promise.resolve(client as never))
    const controller = new AbortController()
    expect(await send([EVENT], controller.signal)).toBe('sent')
    expect(rpc).toHaveBeenCalledWith('record_product_events', {
      events: [EVENT],
    })
    expect(abortSignal).toHaveBeenCalledWith(controller.signal)
  })

  it('un error de los datos (clase 22 o 23) se descarta; el resto se reintenta', async () => {
    const signal = new AbortController().signal
    for (const code of ['22023', '23514', '22P02', '22007']) {
      const { client } = fakeClient({ error: { code, message: 'x' } })
      const send = createSupabaseSender(() => Promise.resolve(client as never))
      expect(await send([EVENT], signal)).toBe('rejected')
    }
    for (const code of ['', '42501', 'PGRST301', '57014', '08006']) {
      const { client } = fakeClient({ error: { code, message: 'x' } })
      const send = createSupabaseSender(() => Promise.resolve(client as never))
      expect(await send([EVENT], signal)).toBe('retry')
    }
  })

  it('sin cliente o con la petición cancelada, se reintenta sin lanzar', async () => {
    const signal = new AbortController().signal
    const withoutClient = createSupabaseSender(() =>
      Promise.reject(new Error('sin inicializar')),
    )
    expect(await withoutClient([EVENT], signal)).toBe('retry')
    const { client } = fakeClient(new Error('AbortError'))
    const aborted = createSupabaseSender(() => Promise.resolve(client as never))
    expect(await aborted([EVENT], signal)).toBe('retry')
  })

  it('reconoce los códigos de error de los datos', () => {
    expect(isDataError({ code: '23505' })).toBe(true)
    expect(isDataError({ code: '42501' })).toBe(false)
    expect(isDataError(null)).toBe(false)
    expect(isDataError({ message: 'sin código' })).toBe(false)
  })
})
