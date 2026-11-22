import type { OwnershipOutcome } from '../collection/ownership.ts'
import type { Enums } from '../lib/database.types.ts'

// Eventos de producto (#146, parte de #24): la forma exacta que espera
// public.record_product_events() (migración 20261121170000_eventos_de_producto.sql,
// #145). Con ellos se miden los objetivos de la Fase 1: registrar una
// orquídea en menos de 1 minuto y responder "¿Ya la tengo?" en menos de 5
// segundos (docs/indicadores-de-eventos.sql).
//
// Solo valores de forma fija: un uuid, dos enumerados, un entero, booleanos y
// una fecha. Nunca el texto buscado, nombres de plantas, correo ni nombre; el
// usuario lo pone la base con el token (no va en el evento).
//
// La base rechaza el lote entero si un evento incumple sus restricciones, así
// que aquí se descarta antes lo que no las cumpliría: duraciones negativas o
// de más de 24 horas, y (en la cola, queue.ts) los eventos de más de 29 días.

export type ProductEventType = Enums<'product_event_type'>
export type ProductEventResult = Enums<'product_event_result'>

/** Un evento tal como se guarda en la cola y se envía. */
export interface ProductEvent {
  /** Generado al crear el evento: evita duplicados al reenviar. */
  id: string
  type: ProductEventType
  /** Solo en have_it_search. */
  result: ProductEventResult | null
  /** Milisegundos, entero de 0 a 24 horas. */
  duration_ms: number
  /** Solo en plant_registered: si quedó registrada con foto. */
  has_photo: boolean | null
  /** Solo en plant_registered: si el nombre quedó por validar. */
  name_pending: boolean | null
  /** Si se generó con la app sin conexión (o con la sesión sin confirmar). */
  generated_offline: boolean
  /** Cuándo ocurrió, según el reloj del dispositivo (ISO 8601). */
  occurred_at: string
}

/** Tope de duration_ms de la base: 24 horas. */
export const MAX_EVENT_DURATION_MS = 86_400_000

const RESULT: Record<OwnershipOutcome, ProductEventResult> = {
  owned: 'owned',
  similar: 'similar',
  'not-owned': 'not_owned',
}

/** Entero de 0 a 24 horas, o null si la medida no sirve. */
function durationOf(ms: number): number | null {
  if (!Number.isFinite(ms)) return null
  const rounded = Math.max(0, Math.round(ms))
  return rounded > MAX_EVENT_DURATION_MS ? null : rounded
}

interface CommonInput {
  durationMs: number
  /** Si la app estaba sin conexión o con la sesión sin confirmar. */
  offline: boolean
  occurredAt: Date
  /** Para las pruebas; por defecto, crypto.randomUUID(). */
  id?: string
}

/**
 * Registro completado: desde que se abre el formulario hasta que la planta
 * queda guardada (con sus fotos, si las lleva). null si la duración no
 * cabe en la base (un formulario abierto de un día para otro).
 */
export function plantRegisteredEvent(
  input: CommonInput & { hasPhoto: boolean; namePending: boolean },
): ProductEvent | null {
  const duration = durationOf(input.durationMs)
  if (duration === null) return null
  return {
    id: input.id ?? crypto.randomUUID(),
    type: 'plant_registered',
    result: null,
    duration_ms: duration,
    has_photo: input.hasPhoto,
    name_pending: input.namePending,
    generated_offline: input.offline,
    occurred_at: input.occurredAt.toISOString(),
  }
}

/**
 * Búsqueda "¿Ya la tengo?": desde que se empieza a escribir hasta que se
 * muestra la respuesta, y cuál fue. null si la duración no cabe en la base.
 */
export function haveItSearchEvent(
  input: CommonInput & { outcome: OwnershipOutcome },
): ProductEvent | null {
  const duration = durationOf(input.durationMs)
  if (duration === null) return null
  return {
    id: input.id ?? crypto.randomUUID(),
    type: 'have_it_search',
    result: RESULT[input.outcome],
    duration_ms: duration,
    has_photo: null,
    name_pending: null,
    generated_offline: input.offline,
    occurred_at: input.occurredAt.toISOString(),
  }
}

/** Si `value` es un evento bien formado (lo leído de la cola puede no serlo). */
export function isProductEvent(value: unknown): value is ProductEvent {
  if (typeof value !== 'object' || value === null) return false
  const event = value as Partial<ProductEvent>
  if (typeof event.id !== 'string' || event.id === '') return false
  if (typeof event.duration_ms !== 'number') return false
  if (!Number.isInteger(event.duration_ms)) return false
  if (event.duration_ms < 0 || event.duration_ms > MAX_EVENT_DURATION_MS) {
    return false
  }
  if (typeof event.generated_offline !== 'boolean') return false
  if (typeof event.occurred_at !== 'string') return false
  if (Number.isNaN(Date.parse(event.occurred_at))) return false
  if (event.type === 'plant_registered') {
    return (
      event.result === null &&
      typeof event.has_photo === 'boolean' &&
      typeof event.name_pending === 'boolean'
    )
  }
  if (event.type === 'have_it_search') {
    return (
      (event.result === 'owned' ||
        event.result === 'not_owned' ||
        event.result === 'similar') &&
      event.has_photo === null &&
      event.name_pending === null
    )
  }
  return false
}
