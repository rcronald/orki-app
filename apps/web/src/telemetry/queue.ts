import { isProductEvent, type ProductEvent } from './events.ts'

// Cola local de eventos de producto (#146), en IndexedDB y por usuario.
//
// - Un registro por id de Clerk con sus eventos pendientes, en orden de
//   llegada. Solo se escribe y se envía la cola del usuario activo, y al
//   cerrar sesión o entrar otra cuenta se borran las demás (deleteExcept),
//   como la copia local de la colección (collection/local-copy.ts).
// - Tope de MAX_QUEUED_EVENTS: al pasarlo se descartan los más antiguos.
// - Se descartan los de más de MAX_EVENT_AGE_MS: la base rechaza los de más
//   de 30 días (y con uno así, el lote entero). Con un día de margen para el
//   reloj del dispositivo.
// - Todo con try/catch: sin IndexedDB (algunos modos privados) o con un
//   fallo, la cola queda en memoria mientras dure la pestaña.

/** Tope de eventos pendientes por usuario. */
export const MAX_QUEUED_EVENTS = 500

/** Edad máxima de un evento pendiente: 29 días. */
export const MAX_EVENT_AGE_MS = 29 * 24 * 60 * 60 * 1000

/** Base de datos de IndexedDB de la cola. */
export const EVENT_QUEUE_DB = 'orki-eventos'
const STORE = 'colas'
const DB_VERSION = 1

export interface EventQueueStorage {
  /** Añade un evento a la cola del usuario. */
  add(userId: string, event: ProductEvent, now: Date): Promise<void>
  /** Los eventos pendientes del usuario, sin los caducados, del más antiguo al más nuevo. */
  read(userId: string, now: Date): Promise<ProductEvent[]>
  /** Quita de la cola del usuario los eventos con estos ids (enviados o rechazados). */
  remove(userId: string, ids: readonly string[]): Promise<void>
  /** Borra las colas de todos los usuarios salvo `keepUserId` (null: todas). */
  deleteExcept(keepUserId: string | null): Promise<void>
}

interface StoredQueue {
  userId: string
  events: ProductEvent[]
}

/** Sin los caducados (o con la fecha imposible) ni los mal formados, y con el tope. */
export function pruneEvents(
  events: readonly unknown[],
  now: Date,
): ProductEvent[] {
  const oldest = now.getTime() - MAX_EVENT_AGE_MS
  const valid = events.filter(
    (event): event is ProductEvent =>
      isProductEvent(event) && Date.parse(event.occurred_at) >= oldest,
  )
  return valid.slice(Math.max(0, valid.length - MAX_QUEUED_EVENTS))
}

function eventsOf(value: unknown, userId: string): unknown[] {
  if (typeof value !== 'object' || value === null) return []
  const stored = value as Partial<StoredQueue>
  if (stored.userId !== userId || !Array.isArray(stored.events)) return []
  return stored.events
}

function withEvent(
  events: readonly unknown[],
  event: ProductEvent,
  now: Date,
): ProductEvent[] {
  // El mismo id no se repite (no debería pasar: se genera al crearlo).
  const others = events.filter(
    (queued) => !isProductEvent(queued) || queued.id !== event.id,
  )
  return pruneEvents([...others, event], now)
}

// IndexedDB -------------------------------------------------------------------

function hasIndexedDb(): boolean {
  return typeof globalThis.indexedDB !== 'undefined'
}

function promised<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB'))
  })
}

/**
 * Cola en IndexedDB; sin IndexedDB, o si falla, en memoria. Cada operación
 * abre la base y la cierra al terminar; leer y reescribir una cola va en una
 * sola transacción, así que dos escrituras seguidas no se pisan.
 */
export function createIndexedDbEventQueue(
  dbName: string = EVENT_QUEUE_DB,
): EventQueueStorage {
  const memory = createMemoryEventQueue()

  async function open(): Promise<IDBDatabase> {
    const request = indexedDB.open(dbName, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'userId' })
      }
    }
    return promised(request)
  }

  /** Lee la cola del usuario y, si `change` devuelve otra, la guarda. */
  async function update(
    userId: string,
    change: (events: unknown[]) => ProductEvent[] | null,
  ): Promise<ProductEvent[]> {
    const db = await open()
    try {
      return await new Promise<ProductEvent[]>((resolve, reject) => {
        const transaction = db.transaction(STORE, 'readwrite')
        const store = transaction.objectStore(STORE)
        let result: ProductEvent[] = []
        const request = store.get(userId)
        request.onsuccess = () => {
          const current = eventsOf(request.result, userId)
          const next = change(current)
          result = next ?? (current as ProductEvent[])
          if (next === null) return
          if (next.length === 0) store.delete(userId)
          else store.put({ userId, events: next } satisfies StoredQueue)
        }
        transaction.oncomplete = () => resolve(result)
        transaction.onerror = () =>
          reject(transaction.error ?? new Error('IndexedDB'))
        transaction.onabort = () =>
          reject(
            transaction.error ?? new Error('IndexedDB: transacción abortada'),
          )
      })
    } finally {
      db.close()
    }
  }

  return {
    async add(userId, event, now) {
      if (!hasIndexedDb()) return memory.add(userId, event, now)
      try {
        await update(userId, (events) => withEvent(events, event, now))
      } catch {
        await memory.add(userId, event, now)
      }
    },

    async read(userId, now) {
      const fromMemory = await memory.read(userId, now)
      if (!hasIndexedDb()) return fromMemory
      try {
        const stored = await update(userId, (events) => {
          const pruned = pruneEvents(events, now)
          return pruned.length === events.length ? null : pruned
        })
        const ids = new Set(stored.map((event) => event.id))
        return [...stored, ...fromMemory.filter((event) => !ids.has(event.id))]
      } catch {
        return fromMemory
      }
    },

    async remove(userId, ids) {
      await memory.remove(userId, ids)
      if (!hasIndexedDb()) return
      const removed = new Set(ids)
      try {
        await update(userId, (events) => {
          const kept = events.filter(
            (event) => !isProductEvent(event) || !removed.has(event.id),
          )
          return kept.length === events.length ? null : (kept as ProductEvent[])
        })
      } catch {
        // Si no se pudo quitar, se reenvía: la base ignora los ids repetidos.
      }
    },

    async deleteExcept(keepUserId) {
      await memory.deleteExcept(keepUserId)
      if (!hasIndexedDb()) return
      try {
        const db = await open()
        try {
          await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction(STORE, 'readwrite')
            // Con un cursor y en sus callbacks: la transacción sigue activa
            // entre una petición y la siguiente en todos los navegadores.
            const request = transaction.objectStore(STORE).openCursor()
            request.onsuccess = () => {
              const cursor = request.result
              if (cursor === null) return
              if (cursor.key !== keepUserId) cursor.delete()
              cursor.continue()
            }
            transaction.oncomplete = () => resolve()
            transaction.onerror = () =>
              reject(transaction.error ?? new Error('IndexedDB'))
            transaction.onabort = () =>
              reject(transaction.error ?? new Error('IndexedDB'))
          })
        } finally {
          db.close()
        }
      } catch {
        // Sin IndexedDB utilizable no hay nada que borrar.
      }
    },
  }
}

/** Cola en memoria: la de reserva sin IndexedDB y la de las pruebas. */
export function createMemoryEventQueue(): EventQueueStorage & {
  readonly queues: Map<string, ProductEvent[]>
} {
  const queues = new Map<string, ProductEvent[]>()
  return {
    queues,
    add(userId, event, now) {
      queues.set(userId, withEvent(queues.get(userId) ?? [], event, now))
      return Promise.resolve()
    },
    read(userId, now) {
      const events = pruneEvents(queues.get(userId) ?? [], now)
      if (events.length === 0) queues.delete(userId)
      else queues.set(userId, events)
      return Promise.resolve([...events])
    },
    remove(userId, ids) {
      const removed = new Set(ids)
      const kept = (queues.get(userId) ?? []).filter(
        (event) => !removed.has(event.id),
      )
      if (kept.length === 0) queues.delete(userId)
      else queues.set(userId, kept)
      return Promise.resolve()
    },
    deleteExcept(keepUserId) {
      for (const key of [...queues.keys()]) {
        if (key !== keepUserId) queues.delete(key)
      }
      return Promise.resolve()
    },
  }
}
