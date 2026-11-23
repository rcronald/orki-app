import { useCallback, useEffect, useRef } from 'react'
import type { CollectionPlant } from '../collection/model.ts'
import { plantRegisteredEvent, type ProductEvent } from './events.ts'
import { recordProductEvent } from './product-events.ts'

// Evento "registro completado" (#146). La duración va desde que se abre el
// formulario hasta que el registro termina: la planta guardada y, si llevaba
// fotos, subidas (o la persona siguió sin las que fallaron). Con foto es si
// la planta quedó con al menos una foto (#221); por validar, si su nombre no
// quedó enlazado a una especie del catálogo. Nada del nombre ni de la planta
// va en el evento.

export interface RegistrationEventOptions {
  /** Si la app está sin conexión o con la sesión sin confirmar. */
  offline: boolean
  /** Para las pruebas; por defecto, recordProductEvent. */
  record?: (event: ProductEvent | null) => void
  /** Reloj en milisegundos; por defecto, performance.now. */
  clock?: () => number
  /** Reloj de pared, para occurred_at. */
  now?: () => Date
}

const performanceNow = () => performance.now()
const deviceNow = () => new Date()

export function useRegistrationEvent({
  offline,
  record = recordProductEvent,
  clock = performanceNow,
  now = deviceNow,
}: RegistrationEventOptions): {
  /**
   * El registro terminó. `hasPhoto`: si quedó con al menos una foto; por
   * defecto, si la planta tiene alguna (photoCount, que cuenta la principal).
   */
  onRegistered: (
    plant: CollectionPlant,
    options?: { hasPhoto?: boolean },
  ) => void
} {
  const latest = useRef({ offline, record, clock, now })
  useEffect(() => {
    latest.current = { offline, record, clock, now }
  })
  const openedAt = useRef<number | null>(null)
  const done = useRef(false)

  useEffect(() => {
    openedAt.current ??= latest.current.clock()
  }, [])

  const onRegistered = useCallback(
    (plant: CollectionPlant, options: { hasPhoto?: boolean } = {}) => {
      if (done.current) return
      done.current = true
      const current = latest.current
      const start = openedAt.current
      if (start === null) return
      current.record(
        plantRegisteredEvent({
          durationMs: current.clock() - start,
          hasPhoto: options.hasPhoto ?? plant.photoCount > 0,
          namePending: plant.validation === 'pending',
          offline: current.offline,
          occurredAt: current.now(),
        }),
      )
    },
    [],
  )

  return { onRegistered }
}
