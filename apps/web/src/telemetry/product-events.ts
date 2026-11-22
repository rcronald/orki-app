import type { ProductEvent } from './events.ts'
import type { ProductEventsRuntime, ProductEventsSession } from './runtime.ts'

// Punto de entrada de los eventos de producto (#146). Es lo único que
// importan las pantallas: no pesa nada, y la cola y el envío (runtime.ts, con
// IndexedDB y supabase-js) se cargan de forma diferida la primera vez que hay
// algo que hacer.
//
// - ProductEventsSync (dentro de Clerk) dice quién usa la app con
//   setProductEventsSession(); sin eso, nadie: los eventos se descartan y no
//   se carga nada. Así las pruebas que no montan la app no guardan ni envían
//   eventos.
// - recordProductEvent() nunca falla ni espera: guarda el evento a nombre del
//   usuario activo en ese momento y vuelve enseguida.
// - En las pruebas, setProductEventsRuntimeLoader() sustituye la cola y el
//   envío por los que la prueba quiera.

type RuntimeLoader = () => Promise<ProductEventsRuntime>

const defaultLoader: RuntimeLoader = () =>
  import('./runtime.ts').then((module) => module.createProductEventsRuntime())

let loader: RuntimeLoader = defaultLoader
let runtime: Promise<ProductEventsRuntime> | null = null
let session: ProductEventsSession | null = null
// Si ya se dijo quién usa la app (aunque sea nadie): antes, nada que borrar.
let known = false

function withRuntime(use: (runtime: ProductEventsRuntime) => void): void {
  if (runtime === null) {
    // Uno nuevo (también tras un fallo de carga) empieza con la sesión de
    // ahora.
    const pending = loader().then((created) => {
      if (known) created.setSession(session)
      return created
    })
    runtime = pending
    // Si el chunk no llega (sin conexión y sin caché), el siguiente uso lo
    // vuelve a intentar; el evento de ahora se pierde.
    pending.catch(() => {
      if (runtime === pending) runtime = null
    })
  }
  runtime.then(use, () => {})
}

/**
 * Quién usa la app. null: nadie (sin sesión o al cerrarla), y se borran las
 * colas de todos. Llamarla con la misma sesión no hace nada.
 */
export function setProductEventsSession(
  next: ProductEventsSession | null,
): void {
  if (
    known &&
    session?.userId === next?.userId &&
    session?.confirmed === next?.confirmed &&
    session?.online === next?.online
  ) {
    return
  }
  known = true
  session = next === null ? null : { ...next }
  const value = session
  withRuntime((current) => current.setSession(value))
}

/** Guarda un evento del usuario activo y lo envía en cuanto se pueda. */
export function recordProductEvent(event: ProductEvent | null): void {
  if (event === null || session === null) return
  const userId = session.userId
  withRuntime((current) => current.record(userId, event))
}

/** Solo para las pruebas: otra cola y otro envío, y el estado de cero. */
export function setProductEventsRuntimeLoader(
  next: RuntimeLoader | null,
): void {
  loader = next ?? defaultLoader
  runtime = null
  session = null
  known = false
}
