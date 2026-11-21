import type { CollectionPlant } from '../collection/model.ts'

// Lo que el registro (#85) deja en el estado de la navegación al volver al
// inventario, para el aviso de confirmación. La planta ya está en la
// colección (upsertPlant); aquí solo va lo que dice el aviso.

export interface RegisteredPlant {
  id: string
  name: string
  /** Si el nombre es científico del catálogo (para la cursiva). */
  scientific: boolean
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
  return value
}
