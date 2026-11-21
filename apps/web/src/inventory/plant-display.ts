import type { CollectionPlant } from '../collection/model.ts'
import type { ValidationStatus } from '../components/ui/StatusBadge.tsx'

// Cómo se muestra una planta de la colección en las listas.

/** Texto alternativo de la foto de una planta: "Foto de Phalaenopsis amabilis". */
export function plantPhotoAlt(plant: CollectionPlant): string {
  return `Foto de ${plant.displayName}`
}

/**
 * Etiqueta de validación: "Validada" solo si la planta está validada; "por
 * validar" y "no identificable" se muestran las dos como "Nombre por validar"
 * (el sistema solo tiene esas dos insignias).
 */
export function plantValidationStatus(
  plant: CollectionPlant,
): ValidationStatus {
  return plant.validation === 'validated' ? 'validated' : 'pending'
}
