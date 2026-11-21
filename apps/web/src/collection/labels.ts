import type {
  FlowerColor,
  PlantStatus,
  PlantType,
  PlantValidation,
} from '../lib/database.ts'

// Textos en español de los enumerados de una planta, compartidos por el
// registro (#11), los filtros del inventario (#15) y la exportación (#17). La
// base de datos guarda las claves en inglés; la interfaz muestra estos textos.
// registration/texts.ts los reexporta para no romper sus importaciones.

/** Etiquetas de los chips de color de flor (enumerado flower_color). */
export const FLOWER_COLOR_LABEL = {
  white: 'Blanco',
  pink: 'Rosado',
  purple: 'Morado',
  yellow: 'Amarillo',
  orange: 'Naranja',
  bicolor: 'Bicolor',
} as const satisfies Record<FlowerColor, string>

/** Etiquetas de los chips de tipo (enumerado plant_type). */
export const PLANT_TYPE_LABEL = {
  species: 'Especie',
  hybrid: 'Híbrido',
  unknown: 'No sé',
} as const satisfies Record<PlantType, string>

/** Estado de una planta, en singular (enumerado plant_status). */
export const PLANT_STATUS_LABEL = {
  active: 'Activa',
  lost: 'Perdida',
  gifted: 'Regalada',
} as const satisfies Record<PlantStatus, string>

/** Estado de validación del nombre (enumerado plant_validation). */
export const PLANT_VALIDATION_LABEL = {
  validated: 'Validada',
  pending: 'Por validar',
  unidentifiable: 'No identificable',
} as const satisfies Record<PlantValidation, string>
