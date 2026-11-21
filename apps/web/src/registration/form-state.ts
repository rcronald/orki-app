import type { PlantInsert, PlantType, SpeciesType } from '../lib/database.ts'
import { isCalendarDate } from '../lib/localDate.ts'
import { PLANT_FORM_ERROR_TEXT } from './texts.ts'

// Estado del formulario de registro (#85), sin React: un solo objeto con lo
// que lleva el formulario, un reductor con las acciones que lo cambian, la
// validación y la fila que se envía a la base. PlantForm.tsx lo usa con
// useReducer.
//
// Pensado para crecer sin rehacerlo:
// - #86 (origen, "Más detalles" y borrador): sus campos se añaden a
//   PlantFormValues, a initialPlantFormValues() y a toPlantInsert(); el
//   borrador guarda y restaura PlantFormValues entero (acción "restored").
// - #87 (foto): la foto pendiente es un archivo, no un dato de la fila; vive
//   junto a este estado y se sube después de guardar la planta.
// - #88 (aviso de duplicado): depende solo de `species`.
// - #12 (nombre por validar): isPendingName() dice cuándo se guardará sin
//   especie.

/** Topes de longitud de la base (restricción plants_entered_name_valid). */
export const PLANT_NAME_MAX_LENGTH = 200

/** Un género del catálogo. */
export interface FormGenus {
  id: string
  name: string
}

/** Especie del catálogo elegida en el autocompletado. */
export interface FormSpecies {
  id: string
  scientificName: string
  genus: FormGenus
  type: SpeciesType
}

export interface PlantFormValues {
  /** Texto del campo de nombre, tal como está escrito. */
  name: string
  /**
   * Especie enlazada: la elegida en el autocompletado. Mientras la haya, el
   * género y el tipo son los suyos y no se pueden cambiar. Cambiar el texto
   * del nombre la desenlaza.
   */
  species: FormSpecies | null
  /** Género elegido; null si aún no hay ninguno (por ejemplo, con "Otro" abierto). */
  genus: FormGenus | null
  /** Buscador de géneros ("Otro") abierto. */
  otherGenusOpen: boolean
  type: PlantType | null
  /** Fecha de adquisición, "AAAA-MM-DD" ('' si se borró). */
  acquiredOn: string
}

export type PlantFormField = 'name' | 'genus' | 'type' | 'acquiredOn'

/** Orden de los campos en pantalla: el primero con error recibe el foco. */
export const PLANT_FORM_FIELDS: readonly PlantFormField[] = [
  'name',
  'genus',
  'type',
  'acquiredOn',
]

export type PlantFormErrors = Partial<Record<PlantFormField, string>>

export type PlantFormAction =
  | { type: 'nameChanged'; name: string }
  | { type: 'speciesSelected'; species: FormSpecies }
  | { type: 'genusSelected'; genus: FormGenus }
  | { type: 'otherGenusToggled' }
  | { type: 'typeSelected'; plantType: PlantType }
  | { type: 'acquiredOnChanged'; acquiredOn: string }
  /** Sustituye todo el estado; para restaurar un borrador (#86) o empezar otro registro. */
  | { type: 'restored'; values: PlantFormValues }

/** Formulario vacío con la fecha de adquisición en `today` (fecha local). */
export function initialPlantFormValues(today: string): PlantFormValues {
  return {
    name: '',
    species: null,
    genus: null,
    otherGenusOpen: false,
    type: null,
    acquiredOn: today,
  }
}

export function plantFormReducer(
  state: PlantFormValues,
  action: PlantFormAction,
): PlantFormValues {
  const locked = state.species !== null
  switch (action.type) {
    case 'nameChanged':
      // Cualquier cambio del texto desenlaza la especie; el género y el tipo
      // se quedan como estaban (los de la especie) y vuelven a ser editables.
      return { ...state, name: action.name, species: null }
    case 'speciesSelected':
      return {
        ...state,
        name: action.species.scientificName,
        species: action.species,
        genus: action.species.genus,
        type: action.species.type,
        otherGenusOpen: false,
      }
    case 'genusSelected':
      if (locked) return state
      return { ...state, genus: action.genus, otherGenusOpen: false }
    case 'otherGenusToggled':
      if (locked) return state
      // Abrir "Otro" quita el género elegido: hay que buscar uno. Cerrarlo
      // sin elegir deja el género sin elegir.
      return state.otherGenusOpen
        ? { ...state, otherGenusOpen: false }
        : { ...state, otherGenusOpen: true, genus: null }
    case 'typeSelected':
      if (locked) return state
      return { ...state, type: action.plantType }
    case 'acquiredOnChanged':
      return { ...state, acquiredOn: action.acquiredOn }
    case 'restored':
      return action.values
  }
}

/**
 * Nombre como se guarda: sin espacios en los extremos y con los de dentro
 * reducidos a uno.
 */
export function normalizePlantName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

/** Longitud en caracteres (puntos de código), como char_length en Postgres. */
function characterCount(text: string): number {
  return [...text].length
}

/** Si se guardará sin especie del catálogo, como "nombre por validar" (#12). */
export function isPendingName(values: PlantFormValues): boolean {
  return values.species === null && normalizePlantName(values.name) !== ''
}

/** Si hay algo que se perdería al salir sin guardar. */
export function isPlantFormDirty(
  values: PlantFormValues,
  initial: PlantFormValues,
): boolean {
  return (
    values.name.trim() !== '' ||
    values.genus !== null ||
    values.otherGenusOpen ||
    values.type !== null ||
    values.acquiredOn !== initial.acquiredOn
  )
}

/**
 * Errores del formulario, por campo. `today` es la fecha local de hoy: la de
 * adquisición no puede ser posterior.
 */
export function validatePlantForm(
  values: PlantFormValues,
  today: string,
): PlantFormErrors {
  const errors: PlantFormErrors = {}
  const name = normalizePlantName(values.name)
  if (name === '') errors.name = PLANT_FORM_ERROR_TEXT.nameMissing
  else if (characterCount(name) > PLANT_NAME_MAX_LENGTH) {
    errors.name = PLANT_FORM_ERROR_TEXT.nameTooLong
  }

  if (values.genus === null) {
    errors.genus = values.otherGenusOpen
      ? PLANT_FORM_ERROR_TEXT.genusNotFound
      : PLANT_FORM_ERROR_TEXT.genusMissing
  }

  if (values.type === null) errors.type = PLANT_FORM_ERROR_TEXT.typeMissing

  if (values.acquiredOn === '') {
    errors.acquiredOn = PLANT_FORM_ERROR_TEXT.dateMissing
  } else if (!isCalendarDate(values.acquiredOn)) {
    errors.acquiredOn = PLANT_FORM_ERROR_TEXT.dateInvalid
  } else if (values.acquiredOn > today) {
    // Las dos van en "AAAA-MM-DD": el orden del texto es el de las fechas.
    errors.acquiredOn = PLANT_FORM_ERROR_TEXT.dateFuture
  }
  return errors
}

/**
 * Lo que se inserta en plants. Nunca lleva `validation` (el usuario no puede
 * escribirla; la pone la base) ni `user_id` (la base toma el del token).
 */
export type NewPlantInsert = Required<
  Pick<PlantInsert, 'id' | 'entered_name' | 'genus_id' | 'type' | 'acquired_on'>
> &
  Pick<PlantInsert, 'species_id'>

/**
 * Fila para insertar a partir de un formulario ya validado. `id` lo genera la
 * app para que reintentar un guardado no cree dos plantas (ver save-plant.ts).
 *
 * Con especie, el género y el tipo los vuelve a poner el disparador de la base
 * con los de la especie; se envían igual porque las columnas son obligatorias.
 */
export function toPlantInsert(
  values: PlantFormValues,
  id: string,
): NewPlantInsert {
  if (values.genus === null || values.type === null) {
    throw new Error('El formulario no está completo: valídalo antes.')
  }
  const insert: NewPlantInsert = {
    id,
    entered_name: normalizePlantName(values.name),
    genus_id: values.genus.id,
    type: values.type,
    acquired_on: values.acquiredOn,
  }
  if (values.species !== null) insert.species_id = values.species.id
  return insert
}
