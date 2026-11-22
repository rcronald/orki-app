import { useCallback, useEffect, useRef } from 'react'
import type { CollectionPlant } from '../collection/model.ts'
import { plantRegisteredEvent, type ProductEvent } from './events.ts'
import { recordProductEvent } from './product-events.ts'

// Evento "registro completado" (#146). La duración va desde que se abre el
// formulario o, en el acceso "Con foto", desde que se elige la primera foto
// (si no se llega a elegir ninguna, desde que se abrió), hasta que el registro
// termina: la planta guardada y, si llevaba foto, subida (o la persona siguió
// sin ella tras un fallo). Con foto es si la planta quedó con foto; por
// validar, si su nombre no quedó enlazado a una especie del catálogo. Nada
// del nombre ni de la planta va en el evento.

export interface RegistrationEventOptions {
  /** Acceso "Con foto" (?foto=1). */
  photoFirst: boolean
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
  photoFirst,
  offline,
  record = recordProductEvent,
  clock = performanceNow,
  now = deviceNow,
}: RegistrationEventOptions): {
  onPhotoChosen: () => void
  onRegistered: (plant: CollectionPlant) => void
} {
  const latest = useRef({ photoFirst, offline, record, clock, now })
  useEffect(() => {
    latest.current = { photoFirst, offline, record, clock, now }
  })
  const openedAt = useRef<number | null>(null)
  const photoAt = useRef<number | null>(null)
  const done = useRef(false)

  useEffect(() => {
    openedAt.current ??= latest.current.clock()
  }, [])

  const onPhotoChosen = useCallback(() => {
    photoAt.current ??= latest.current.clock()
  }, [])

  const onRegistered = useCallback((plant: CollectionPlant) => {
    if (done.current) return
    done.current = true
    const current = latest.current
    const start =
      (current.photoFirst ? photoAt.current : null) ?? openedAt.current
    if (start === null) return
    current.record(
      plantRegisteredEvent({
        durationMs: current.clock() - start,
        hasPhoto: plant.photoPath !== null,
        namePending: plant.validation === 'pending',
        offline: current.offline,
        occurredAt: current.now(),
      }),
    )
  }, [])

  return { onPhotoChosen, onRegistered }
}
