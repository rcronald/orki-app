import { useCallback, useEffect, useRef } from 'react'
import type {
  OnOwnershipMeasure,
  OwnershipMeasurement,
} from '../inventory/ownership-measure.ts'
import { haveItSearchEvent, type ProductEvent } from './events.ts'
import { recordProductEvent } from './product-events.ts'

// Cuándo cuenta una búsqueda de "¿Ya la tengo?" (#146). La pantalla
// «¿Ya la tengo?» (#209, useOwnershipAnswer) mide cada respuesta que pinta (inventory/ownership-measure.ts), y mientras se
// escribe pinta varias. Para no enviar un evento por pulsación, se envía uno
// por búsqueda, con la primera respuesta que el usuario tuvo delante:
//
// - la primera que se queda STABLE_ANSWER_MS en pantalla sin cambiar (la
//   persona dejó de escribir y la leyó), o
// - la que había al salir de la pantalla (tocó un ejemplar, "Registrarla con
//   este nombre", otra pestaña de la app) o al ocultarse la app, aunque no
//   llegara a ese tiempo.
//
// No cuentan: una respuesta que cambia antes de ese tiempo (se sigue
// escribiendo), una búsqueda que se vacía antes (un error de tipeo que se
// borra), lo que llega después del evento en la misma búsqueda (la mejora del
// catálogo, seguir escribiendo) ni una búsqueda que ya venía en la URL al
// abrir la pantalla (al volver del detalle: nadie empezó a escribir).
//
// La duración es la de esa respuesta: desde la primera letra hasta que se
// pintó. Solo números y valores cerrados: nunca el texto buscado.

/** Tiempo que una respuesta debe quedarse en pantalla para contar. */
export const STABLE_ANSWER_MS = 2_000

interface Pending {
  measurement: OwnershipMeasurement
  offline: boolean
  shownAt: Date
  timer: ReturnType<typeof setTimeout>
}

export interface HaveItSearchEventsOptions {
  /**
   * Si hay algo escrito en el buscador. Al vaciarlo, la búsqueda termina: si
   * su respuesta aún no contaba, ya no cuenta.
   */
  searching: boolean
  /**
   * Si la app está en modo sin conexión (sin red o con la sesión sin
   * confirmar, useReadOnly): el evento va marcado como generado sin conexión.
   */
  offline: boolean
  /** Para las pruebas; por defecto, recordProductEvent. */
  record?: (event: ProductEvent | null) => void
  /** Reloj de pared, para occurred_at. Por defecto, la hora del dispositivo. */
  now?: () => Date
}

const deviceNow = () => new Date()

/** El onMeasure de useOwnershipAnswer que envía el evento de cada búsqueda. */
export function useHaveItSearchEvents({
  searching,
  offline,
  record = recordProductEvent,
  now = deviceNow,
}: HaveItSearchEventsOptions): OnOwnershipMeasure {
  const latest = useRef({ offline, record, now })
  useEffect(() => {
    latest.current = { offline, record, now }
  })
  const pending = useRef<Pending | null>(null)
  // La última búsqueda que ya envió su evento.
  const counted = useRef<number | null>(null)

  const commit = useCallback(() => {
    const current = pending.current
    if (current === null) return
    clearTimeout(current.timer)
    pending.current = null
    counted.current = current.measurement.searchId
    latest.current.record(
      haveItSearchEvent({
        durationMs: current.measurement.durationMs,
        outcome: current.measurement.outcome,
        offline: current.offline,
        occurredAt: current.shownAt,
      }),
    )
  }, [])

  const drop = useCallback(() => {
    if (pending.current !== null) clearTimeout(pending.current.timer)
    pending.current = null
  }, [])

  useEffect(() => {
    if (!searching) drop()
  }, [searching, drop])

  // Al salir de la pantalla o al ocultarse la app, cuenta lo que se veía.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') commit()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      commit()
    }
  }, [commit])

  return useCallback(
    (measurement: OwnershipMeasurement) => {
      const { searchId } = measurement
      // Otra búsqueda: la anterior se vació antes de tiempo y no cuenta.
      if (
        pending.current !== null &&
        pending.current.measurement.searchId !== searchId
      ) {
        drop()
      }
      if (!measurement.startedByTyping || counted.current === searchId) return
      if (pending.current !== null) clearTimeout(pending.current.timer)
      const { offline: appOffline, now: clock } = latest.current
      pending.current = {
        measurement,
        offline: appOffline || !measurement.online,
        shownAt: clock(),
        timer: setTimeout(commit, STABLE_ANSWER_MS),
      }
    },
    [commit, drop],
  )
}
