import type { ProductEvent } from './events.ts'
import { createIndexedDbEventQueue, type EventQueueStorage } from './queue.ts'
import {
  createSupabaseSender,
  MAX_BATCH_SIZE,
  type SendProductEvents,
} from './sender.ts'

// La parte de los eventos de producto que guarda y envía (#146). Se carga de
// forma diferida desde product-events.ts la primera vez que hace falta, así
// que no suma nada al arranque.
//
// Reglas (las mismas del modo sin conexión, docs/sin-conexion.md):
// - Cada evento va a la cola del usuario que lo generó, y solo si es el
//   activo. Sin usuario, el evento se descarta: no tiene dueño.
// - Solo se envía con la sesión confirmada por Clerk y conexión. Con la
//   sesión sin confirmar (sin Clerk) no se pide nada a la red: no hay token, y
//   la petición saldría como anónima.
// - Al cerrar sesión se borran todas las colas; al entrar otra cuenta, las de
//   las demás. Un envío en curso se cancela y su resultado ya no toca la cola
//   (que es de otra cuenta), así que nada de un usuario se envía con otra.
// - Un fallo que se puede reintentar deja la cola como estaba y se vuelve a
//   intentar más tarde, con esperas crecientes, o antes si vuelve la red o la
//   sesión. Nada de esto se ve en la interfaz ni lanza errores.

export interface ProductEventsSession {
  /** Id de Clerk del usuario cuya colección se ve. */
  userId: string
  /** Si Clerk confirmó la sesión (con la sesión sin confirmar no se envía). */
  confirmed: boolean
  /** Si el navegador dice tener conexión. */
  online: boolean
}

export interface ProductEventsRuntime {
  /** Quién usa la app; null sin sesión (borra todas las colas). */
  setSession(session: ProductEventsSession | null): void
  /** Guarda el evento en la cola de `userId` si es el activo, y lo envía si se puede. */
  record(userId: string, event: ProductEvent): void
  /** Envía lo pendiente si se puede. Se resuelve al terminar (nunca falla). */
  flush(): Promise<void>
  /**
   * Se resuelve cuando terminan las operaciones de la cola ya pedidas (por
   * ejemplo, el borrado de setSession(null)) y el envío en curso, si lo hay.
   * Nunca falla. Lo usa la eliminación de la cuenta (#110) antes de borrar el
   * perfil.
   */
  settle(): Promise<void>
}

/** Esperas entre reintentos tras un fallo: 30 s, 1 min, 2 min… hasta 15 min. */
export const RETRY_BASE_MS = 30_000
export const RETRY_MAX_MS = 15 * 60_000

export interface ProductEventsRuntimeOptions {
  storage?: EventQueueStorage
  send?: SendProductEvents
  now?: () => Date
}

export function createProductEventsRuntime({
  storage = createIndexedDbEventQueue(),
  send = createSupabaseSender(),
  now = () => new Date(),
}: ProductEventsRuntimeOptions = {}): ProductEventsRuntime {
  let session: ProductEventsSession | null = null
  // Las operaciones de la cola, en orden: borrar las colas de otra cuenta
  // termina antes de que se escriba el evento siguiente.
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = chain.then(operation)
    chain = next.catch(() => {})
    return next
  }
  let flushing: Promise<void> | null = null
  let again = false
  let controller: AbortController | null = null
  let failures = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  const canSend = (current: ProductEventsSession | null) =>
    current !== null && current.confirmed && current.online

  function scheduleRetry() {
    clearTimeout(retryTimer)
    const wait = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** failures)
    failures += 1
    retryTimer = setTimeout(() => void flush(), wait)
  }

  async function sendPending(owner: string): Promise<void> {
    for (;;) {
      if (session?.userId !== owner || !canSend(session)) return
      const pending = await serial(() => storage.read(owner, now()))
      if (pending.length === 0) {
        failures = 0
        return
      }
      const batch = pending.slice(0, MAX_BATCH_SIZE)
      const current = new AbortController()
      controller = current
      const outcome = await send(batch, current.signal)
      if (controller === current) controller = null
      // Otra cuenta o sin sesión: su cola ya no es esta.
      if (current.signal.aborted || session?.userId !== owner) return
      if (outcome === 'retry') {
        scheduleRetry()
        return
      }
      failures = 0
      clearTimeout(retryTimer)
      await serial(() =>
        storage.remove(
          owner,
          batch.map((event) => event.id),
        ),
      )
    }
  }

  function flush(): Promise<void> {
    if (flushing !== null) {
      // Lo que llegue durante un envío sale en la vuelta siguiente.
      again = true
      return flushing
    }
    const run = async () => {
      do {
        again = false
        const owner = session?.userId
        if (owner === undefined || !canSend(session)) return
        try {
          await sendPending(owner)
        } catch {
          // La cola no se pudo leer o escribir: se reintenta más tarde.
          scheduleRetry()
          return
        }
      } while (again)
    }
    flushing = run().finally(() => {
      flushing = null
    })
    return flushing
  }

  return {
    setSession(next) {
      const previous = session
      session = next
      if (previous?.userId !== next?.userId) {
        controller?.abort()
        controller = null
        clearTimeout(retryTimer)
        failures = 0
        const keep = next?.userId ?? null
        void serial(() => storage.deleteExcept(keep))
      }
      // Al confirmarse la sesión, al volver la red o con otra cuenta.
      if (
        canSend(next) &&
        (!canSend(previous) || previous?.userId !== next?.userId)
      ) {
        void flush()
      }
    },

    record(userId, event) {
      if (session?.userId !== userId) return
      void serial(() => storage.add(userId, event, now())).then(
        () => {
          if (canSend(session)) void flush()
        },
        () => {},
      )
    },

    flush,

    async settle() {
      // Lo que se pida mientras se espera también cuenta.
      for (;;) {
        const pendingChain = chain
        const pendingFlush = flushing
        await pendingChain.catch(() => {})
        await pendingFlush?.catch(() => {})
        if (pendingChain === chain && pendingFlush === flushing) return
      }
    },
  }
}
