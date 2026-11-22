import type { CollectionPlant } from '../collection/model.ts'
import type { ValidationStatus } from '../components/ui/StatusBadge.tsx'
import { plantValidationStatus } from './plant-display.ts'

// Lo que el registro (#85) deja en el estado de la navegación al volver al
// inventario, para el aviso de confirmación. La planta ya está en la
// colección (upsertPlant); aquí solo va lo que dice el aviso.

export interface RegisteredPlant {
  id: string
  name: string
  /** Si el nombre es científico del catálogo (para la cursiva). */
  scientific: boolean
  /**
   * Etiqueta de validación (#12). Opcional: el estado de la navegación
   * sobrevive a una recarga y puede venir de una versión sin ella.
   */
  status?: ValidationStatus
}

interface RegisteredPlantState {
  registeredPlant: RegisteredPlant
}

/** Estado de navegación con la planta recién registrada. */
export function registeredPlantState(
  plant: CollectionPlant,
): RegisteredPlantState {
  return {
    registeredPlant: {
      id: plant.id,
      name: plant.displayName,
      scientific: plant.displayNameIsScientific,
      status: plantValidationStatus(plant),
    },
  }
}

/** La planta recién registrada del estado de navegación, o null. */
export function readRegisteredPlant(state: unknown): RegisteredPlant | null {
  if (typeof state !== 'object' || state === null) return null
  const value = (state as Partial<RegisteredPlantState>).registeredPlant
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.scientific !== 'boolean'
  ) {
    return null
  }
  const status =
    value.status === 'validated' ||
    value.status === 'pending' ||
    value.status === 'unidentifiable'
      ? value.status
      : undefined
  return {
    id: value.id,
    name: value.name,
    scientific: value.scientific,
    ...(status && { status }),
  }
}
