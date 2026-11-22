import type { CollectionPlant } from '../collection/model.ts'
import type { ValidationStatus } from '../components/ui/StatusBadge.tsx'

// Cómo se muestra una planta de la colección en las listas.

/** Texto alternativo de la foto de una planta: "Foto de Phalaenopsis amabilis". */
export function plantPhotoAlt(plant: CollectionPlant): string {
  return `Foto de ${plant.displayName}`
}

/**
 * Etiqueta de validación: "Validada", "Nombre por validar" o, si la cola de
 * propuestas no pudo identificarla (#141), "No identificable".
 */
export function plantValidationStatus(
  plant: CollectionPlant,
): ValidationStatus {
  return plant.validation
}
