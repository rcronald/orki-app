import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { haveItSearchEvent, type ProductEvent } from './events.ts'
import {
  createIndexedDbEventQueue,
  createMemoryEventQueue,
  MAX_EVENT_AGE_MS,
  MAX_QUEUED_EVENTS,
  type EventQueueStorage,
} from './queue.ts'

// IndexedDB de las pruebas: fake-indexeddb (dependencia de desarrollo); jsdom
// no trae IndexedDB.

const NOW = new Date('2026-11-21T12:00:00.000Z')

let dbCount = 0
function freshDbName() {
  dbCount += 1
  return `orki-eventos-prueba-${dbCount}`
}

function event(id: string, occurredAt: Date = NOW): ProductEvent {
  const created = haveItSearchEvent({
    id,
    durationMs: 900,
    outcome: 'owned',
    offline: true,
    occurredAt,
  })
  if (created === null) throw new Error('evento inválido')
  return created
}

const ids = (events: readonly ProductEvent[]) => events.map(({ id }) => id)

describe.each([
  ['IndexedDB', () => createIndexedDbEventQueue(freshDbName())],
  ['memoria', () => createMemoryEventQueue()],
] as const)('cola de eventos en %s', (_, create: () => EventQueueStorage) => {
  it('guarda por usuario, en orden, y quita los enviados', async () => {
    const queue = create()
    await queue.add('user_a', event('a1'), NOW)
    await queue.add('user_a', event('a2'), NOW)
    await queue.add('user_b', event('b1'), NOW)
    expect(ids(await queue.read('user_a', NOW))).toEqual(['a1', 'a2'])
    expect(ids(await queue.read('user_b', NOW))).toEqual(['b1'])

    await queue.remove('user_a', ['a1'])
    expect(ids(await queue.read('user_a', NOW))).toEqual(['a2'])
  })

  it('el mismo id no se guarda dos veces', async () => {
    const queue = create()
    await queue.add('user_a', event('a1'), NOW)
    await queue.add('user_a', event('a1'), NOW)
    expect(ids(await queue.read('user_a', NOW))).toEqual(['a1'])
  })

  it('descarta los de más de 29 días', async () => {
    const queue = create()
    const old = new Date(NOW.getTime() - MAX_EVENT_AGE_MS - 1)
    const recent = new Date(NOW.getTime() - MAX_EVENT_AGE_MS + 60_000)
    await queue.add('user_a', event('viejo', old), old)
    await queue.add('user_a', event('reciente', recent), recent)
    expect(ids(await queue.read('user_a', NOW))).toEqual(['reciente'])
  })

  it(`con más de ${MAX_QUEUED_EVENTS}, se descartan los más antiguos`, async () => {
    const queue = create()
    for (let index = 0; index < MAX_QUEUED_EVENTS + 3; index += 1) {
      await queue.add('user_a', event(`e${index}`), NOW)
    }
    const pending = await queue.read('user_a', NOW)
    expect(pending).toHaveLength(MAX_QUEUED_EVENTS)
    expect(pending[0]?.id).toBe('e3')
    expect(pending.at(-1)?.id).toBe(`e${MAX_QUEUED_EVENTS + 2}`)
  })

  it('borra las colas de los demás usuarios, o todas', async () => {
    const queue = create()
    await queue.add('user_a', event('a1'), NOW)
    await queue.add('user_b', event('b1'), NOW)
    await queue.deleteExcept('user_b')
    expect(await queue.read('user_a', NOW)).toEqual([])
    expect(ids(await queue.read('user_b', NOW))).toEqual(['b1'])
    await queue.deleteExcept(null)
    expect(await queue.read('user_b', NOW)).toEqual([])
  })
})

describe('cola de eventos en IndexedDB', () => {
  it('sobrevive a otra instancia (una recarga de la app)', async () => {
    const name = freshDbName()
    await createIndexedDbEventQueue(name).add('user_a', event('a1'), NOW)
    expect(
      ids(await createIndexedDbEventQueue(name).read('user_a', NOW)),
    ).toEqual(['a1'])
  })

  it('una cola dañada o de otro usuario se trata como vacía', async () => {
    const name = freshDbName()
    const queue = createIndexedDbEventQueue(name)
    // Crea la base.
    await queue.read('user_a', NOW)
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name)
      request.onsuccess = () => {
        const db = request.result
        const transaction = db.transaction('colas', 'readwrite')
        transaction
          .objectStore('colas')
          .put({ userId: 'user_a', events: [{ id: 'roto' }, event('a1')] })
        transaction.oncomplete = () => {
          db.close()
          resolve()
        }
        transaction.onerror = () =>
          reject(transaction.error ?? new Error('IndexedDB'))
      }
      request.onerror = () => reject(request.error ?? new Error('IndexedDB'))
    })
    expect(ids(await queue.read('user_a', NOW))).toEqual(['a1'])
    expect(await queue.read('user_b', NOW)).toEqual([])
  })
})
