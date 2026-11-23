import type { CollectionPlant } from '../collection/model.ts'
import type { ReadOnlyReason } from '../collection/useReadOnly.ts'

export interface PlantLogSectionProps {
  plant: CollectionPlant
  /** null si se puede escribir; si no, por qué no (#18). */
  readOnly: ReadOnlyReason | null
}

/**
 * Punto de montaje de la bitácora del ejemplar en la ficha (#265).
 *
 * La ficha lo pinta a todo el ancho, entre «Datos de la planta» y «Notas»
 * (arriba) y «Gestionar planta» (al final), como en la maqueta del #263. Hoy
 * no pinta nada: la bitácora (lista, filtro y «Añadir registro») la construye
 * el #267 aquí dentro, con su propio h2 «Bitácora», sin tocar la ficha. Sin
 * conexión no se guarda en el dispositivo (decisión del refinamiento del
 * #263), así que con `readOnly` tendrá que decirlo.
 */
export function PlantLogSection(props: PlantLogSectionProps) {
  void props
  return null
}
