import type { PlantFormField, PlantFormValues } from './form-state.ts'

// Orden y agrupación de los campos de la planta, el mismo en el registro
// (PlantForm) y en la edición (EditPlantForm), definido solo aquí (#334).
//
// A la vista van el nombre, el género, el tipo y, en una fila, la fecha de
// adquisición con PLACE_FIELDS.beside. En «Más detalles» van
// PLACE_FIELDS.inDetails, el apodo y el color de la flor; después, lo propio
// de cada formulario: «La foto principal es en floración» en el registro y
// «Notas» en la edición.
//
// Para llevar la ubicación a la vista y el origen a «Más detalles», basta con
// intercambiar los dos valores de PLACE_FIELDS: el orden del foco, la
// apertura de «Más detalles» con un error y lo que pintan los dos
// formularios salen de aquí.

/** Los dos campos de lugar, con las sugerencias de los que ya usaste. */
export type PlaceField = 'origin' | 'location'

export const PLACE_FIELDS: {
  /** A la vista, junto a la fecha de adquisición. */
  readonly beside: PlaceField
  /** El primero de «Más detalles». */
  readonly inDetails: PlaceField
} = {
  beside: 'origin',
  inDetails: 'location',
}

/** Campos de «Más detalles» que pueden tener un error. */
export const PLANT_DETAIL_FIELDS: readonly PlantFormField[] = [
  PLACE_FIELDS.inDetails,
  'nickname',
]

/** Orden de los campos en pantalla: el primero con error recibe el foco. */
export const PLANT_FORM_FIELDS: readonly PlantFormField[] = [
  'name',
  'genus',
  'type',
  'acquiredOn',
  PLACE_FIELDS.beside,
  ...PLANT_DETAIL_FIELDS,
]

/**
 * Si hay algo escrito en los campos comunes de «Más detalles» (para abrirla
 * al empezar). Cada formulario añade lo suyo: la floración o las notas.
 */
export function hasDetailValues(values: PlantFormValues): boolean {
  return (
    values[PLACE_FIELDS.inDetails].trim() !== '' ||
    values.nickname.trim() !== '' ||
    values.flowerColor !== null
  )
}
