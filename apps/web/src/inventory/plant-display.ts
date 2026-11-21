import type { CollectionPlant } from '../collection/model.ts'
import type { SpecimenPhoto } from '../components/ui/SpecimenCard.tsx'
import type { ValidationStatus } from '../components/ui/StatusBadge.tsx'

// Cómo se muestra una planta de la colección en las listas.

/**
 * Miniatura de la planta para las listas. Punto de entrada de las fotos del
 * #10: el bucket privado aún no existe, así que de momento ninguna planta
 * tiene una dirección que mostrar y la tarjeta usa siempre el marcador "Sin
 * foto", aunque la fila traiga thumbnailPath. Cuando exista, esta función
 * devolverá la dirección (firmada o descargada) de plant.thumbnailPath con su
 * texto alternativo; la tarjeta ya la carga de forma diferida (loading="lazy").
 */
export function plantThumbnail(
  plant: CollectionPlant,
): SpecimenPhoto | undefined {
  void plant
  return undefined
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
