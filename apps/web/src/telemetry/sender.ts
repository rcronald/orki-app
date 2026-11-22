import { getSupabase, type OrkiSupabaseClient } from '../lib/supabase.ts'
import type { ProductEvent } from './events.ts'

// Envío de un lote de eventos con public.record_product_events() (#145):
// como mucho 100 por llamada, idempotente por id (reenviar un lote ya
// guardado no duplica nada). Va con el token de sesión de Clerk que pone
// lib/supabase.ts; quien llama solo envía con la sesión confirmada.
//
// Qué hacer con el resultado:
// - sent: guardados (o ya lo estaban). Se quitan de la cola.
// - rejected: la base rechazó el lote por sus datos (errores de clase 22 o
//   23: un valor fuera de rango, una fecha imposible). Reintentar no lo
//   arregla, así que se descarta (lo que dice la migración).
// - retry: sin conexión, sin token, un 5xx, el cliente sin cargar o
//   cualquier otro fallo. Se queda en la cola y se reintenta más tarde.
//
// Nunca lanza: un fallo de los eventos no se ve ni rompe nada.

/** Tope de eventos por llamada de record_product_events(). */
export const MAX_BATCH_SIZE = 100

export type SendOutcome = 'sent' | 'rejected' | 'retry'

export type SendProductEvents = (
  events: readonly ProductEvent[],
  signal: AbortSignal,
) => Promise<SendOutcome>

type RpcClient = Pick<OrkiSupabaseClient, 'rpc'>

/** Si el error de PostgREST es de los datos del lote (clase 22 o 23). */
export function isDataError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && /^2[23][0-9A-Z]{3}$/.test(code)
}

export function createSupabaseSender(
  getClient: () => Promise<RpcClient> = getSupabase,
): SendProductEvents {
  return async (events, signal) => {
    try {
      const client = await getClient()
      const { error } = await client
        .rpc('record_product_events', {
          events: events.map((event) => ({ ...event })),
        })
        .abortSignal(signal)
      if (error === null) return 'sent'
      return isDataError(error) ? 'rejected' : 'retry'
    } catch {
      return 'retry'
    }
  }
}
