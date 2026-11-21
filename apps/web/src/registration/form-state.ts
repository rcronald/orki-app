import type { CollectionPlant } from '../collection/model.ts'
import type {
  FlowerColor,
  PlantInsert,
  PlantType,
  PlantUpdate,
  SpeciesType,
} from '../lib/database.ts'
import { isCalendarDate } from '../lib/localDate.ts'
import { PLANT_FORM_ERROR_TEXT } from './texts.ts'

// Estado del formulario de registro (#85), sin React: un solo objeto con lo
// que lleva el formulario, un reductor con las acciones que lo cambian, la
// validación y la fila que se envía a la base. PlantForm.tsx lo usa con
// useReducer.
//
// Pensado para crecer sin rehacerlo:
// - #86 (origen, "Más detalles" y borrador): origen, ubicación, apodo, color
//   de flor y "foto en floración" están en PlantFormValues; el borrador
//   (draft.ts) guarda PlantFormValues entero y PlantForm lo usa como estado
//   inicial al montarse; "restored" sirve para descartarlo y empezar de cero.
// - #87 (foto): la foto pendiente es un archivo, no un dato de la fila; vive
//   junto a este estado y se sube después de guardar la planta. Con ella se
//   muestra la casilla de `photoInBloom`, que ya viaja en la fila y el borrador.
// - #88 (aviso de duplicado): depende solo de `species`.
// - #12 (nombre por validar): isPendingName() dice cuándo se guardará sin
//   especie.

/** Topes de longitud de la base (restricción plants_entered_name_valid). */
export const PLANT_NAME_MAX_LENGTH = 200

/**
 * Tope de origen, ubicación y apodo (restricciones plants_origin_valid,
 * plants_location_valid y plants_nickname_valid).
 */
export const PLANT_TEXT_MAX_LENGTH = 120

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
  /** Tienda, vivero o intercambio, tal como está escrito ('' si no hay). */
  origin: string
  /** "Más detalles": dónde está en casa ('' si no hay). */
  location: string
  /** "Más detalles": apodo o etiqueta ('' si no hay). */
  nickname: string
  /** "Más detalles": color de la flor; null si no se indica. */
  flowerColor: FlowerColor | null
  /**
   * Si la foto es en floración. Sin foto no tiene sentido: la casilla llega
   * con la foto (#87); hasta entonces es siempre false.
   */
  photoInBloom: boolean
}

export type PlantFormField =
  'name' | 'genus' | 'type' | 'acquiredOn' | 'origin' | 'location' | 'nickname'

/** Orden de los campos en pantalla: el primero con error recibe el foco. */
export const PLANT_FORM_FIELDS: readonly PlantFormField[] = [
  'name',
  'genus',
  'type',
  'acquiredOn',
  'origin',
  'location',
  'nickname',
]

/** Campos que van dentro de la sección plegable "Más detalles". */
export const PLANT_DETAIL_FIELDS: readonly PlantFormField[] = [
  'location',
  'nickname',
]

/** Campos de texto opcionales con tope de PLANT_TEXT_MAX_LENGTH. */
export type PlantOptionalTextField = 'origin' | 'location' | 'nickname'

export type PlantFormErrors = Partial<Record<PlantFormField, string>>

export type PlantFormAction =
  | { type: 'nameChanged'; name: string }
  | { type: 'speciesSelected'; species: FormSpecies }
  | { type: 'genusSelected'; genus: FormGenus }
  | { type: 'otherGenusToggled' }
  | { type: 'typeSelected'; plantType: PlantType }
  | { type: 'acquiredOnChanged'; acquiredOn: string }
  | { type: 'textChanged'; field: PlantOptionalTextField; value: string }
  /** Elegir el color ya elegido lo quita: el campo es opcional. */
  | { type: 'flowerColorToggled'; flowerColor: FlowerColor }
  | { type: 'photoInBloomChanged'; photoInBloom: boolean }
  /** Sustituye todo el estado; por ejemplo, al descartar el borrador (#86). */
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
    origin: '',
    location: '',
    nickname: '',
    flowerColor: null,
    photoInBloom: false,
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
    case 'textChanged':
      return { ...state, [action.field]: action.value }
    case 'flowerColorToggled':
      return {
        ...state,
        flowerColor:
          state.flowerColor === action.flowerColor ? null : action.flowerColor,
      }
    case 'photoInBloomChanged':
      return { ...state, photoInBloom: action.photoInBloom }
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
    values.acquiredOn !== initial.acquiredOn ||
    values.origin.trim() !== '' ||
    values.location.trim() !== '' ||
    values.nickname.trim() !== '' ||
    values.flowerColor !== null ||
    values.photoInBloom
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

  // Opcionales: vacíos no dan error (se guardan como null). El campo ya corta
  // en 120 unidades de UTF-16, que nunca son más de 120 caracteres; esto cubre
  // lo que llega por otra vía (un borrador restaurado).
  for (const field of ['origin', 'location', 'nickname'] as const) {
    if (
      characterCount(normalizePlantName(values[field])) > PLANT_TEXT_MAX_LENGTH
    ) {
      errors[field] = PLANT_FORM_ERROR_TEXT.textTooLong
    }
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
  Pick<
    PlantInsert,
    | 'species_id'
    | 'origin'
    | 'location'
    | 'nickname'
    | 'flower_color'
    | 'photo_in_bloom'
  >

/**
 * Fila para insertar a partir de un formulario ya validado. `id` lo genera la
 * app para que reintentar un guardado no cree dos plantas (ver save-plant.ts).
 *
 * Con especie, el género y el tipo los vuelve a poner el disparador de la base
 * con los de la especie; se envían igual porque las columnas son obligatorias.
 *
 * Los opcionales solo van si tienen valor (sin espacios sobrantes): vacíos,
 * la base los deja en null (o false), que es "sin dato".
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
  const origin = normalizePlantName(values.origin)
  if (origin !== '') insert.origin = origin
  const location = normalizePlantName(values.location)
  if (location !== '') insert.location = location
  const nickname = normalizePlantName(values.nickname)
  if (nickname !== '') insert.nickname = nickname
  if (values.flowerColor !== null) insert.flower_color = values.flowerColor
  if (values.photoInBloom) insert.photo_in_bloom = true
  return insert
}

// Edición (#16) ------------------------------------------------------------
//
// El mismo formulario edita una planta ya guardada: se precarga con sus datos
// (plantFormValuesFrom, que entra con la acción "restored" o como estado
// inicial) y al guardar se envía solo lo que cambió (plantPatch).

/** Formulario con los datos de una planta de la colección, para editarla. */
export function plantFormValuesFrom(plant: CollectionPlant): PlantFormValues {
  return {
    // Enlazada, el campo muestra el nombre de la especie, como al elegirla en
    // el registro; si no, el que escribió la persona.
    name: plant.species?.scientificName ?? plant.enteredName,
    species: plant.species
      ? {
          id: plant.species.id,
          scientificName: plant.species.scientificName,
          genus: { id: plant.genus.id, name: plant.genus.name },
          type: plant.species.type,
        }
      : null,
    genus: { id: plant.genus.id, name: plant.genus.name },
    otherGenusOpen: false,
    type: plant.type,
    acquiredOn: plant.acquiredOn,
    origin: plant.origin ?? '',
    location: plant.location ?? '',
    nickname: plant.nickname ?? '',
    flowerColor: plant.flowerColor,
    photoInBloom: plant.photoInBloom,
  }
}

/**
 * Columnas que la edición puede cambiar. Como en la inserción, nunca lleva
 * `validation` ni `user_id`: al quitar la especie, el disparador de la base
 * devuelve la planta a "por validar" (y con especie, pone su género y su tipo).
 */
export type PlantPatch = Partial<
  Pick<
    PlantUpdate,
    | 'entered_name'
    | 'species_id'
    | 'genus_id'
    | 'type'
    | 'acquired_on'
    | 'origin'
    | 'location'
    | 'nickname'
    | 'flower_color'
    | 'photo_in_bloom'
  >
>

type PlantPatchColumn = keyof PlantPatch

/** Todas las columnas editables de un formulario ya validado; vacío es null. */
function toPlantColumns(
  values: PlantFormValues,
): Required<{ [Column in PlantPatchColumn]: PlantPatch[Column] }> {
  const optional = (text: string) => {
    const normalized = normalizePlantName(text)
    return normalized === '' ? null : normalized
  }
  return {
    entered_name: normalizePlantName(values.name),
    species_id: values.species?.id ?? null,
    genus_id: values.genus?.id,
    type: values.type ?? undefined,
    acquired_on: values.acquiredOn,
    origin: optional(values.origin),
    location: optional(values.location),
    nickname: optional(values.nickname),
    flower_color: values.flowerColor,
    photo_in_bloom: values.photoInBloom,
  }
}

const PATCH_COLUMNS: readonly PlantPatchColumn[] = [
  'entered_name',
  'species_id',
  'genus_id',
  'type',
  'acquired_on',
  'origin',
  'location',
  'nickname',
  'flower_color',
  'photo_in_bloom',
]

/**
 * Lo que cambió entre el formulario con el que se abrió la edición (`initial`)
 * y el actual, como actualización parcial de plants. Vacío si no cambió nada.
 * Cambiar solo el apodo envía solo el apodo: ni la especie ni la foto.
 */
export function plantPatch(
  values: PlantFormValues,
  initial: PlantFormValues,
): PlantPatch {
  const next = toPlantColumns(values)
  const before = toPlantColumns(initial)
  const patch: PlantPatch = {}
  for (const column of PATCH_COLUMNS) {
    if (next[column] !== before[column] && next[column] !== undefined) {
      Object.assign(patch, { [column]: next[column] })
    }
  }
  return patch
}

/**
 * Si se quitará el enlace con una especie al guardar: la planta estaba
 * enlazada y el nombre ya no lo está. La base la devolverá a "por validar".
 */
export function unlinksSpecies(
  values: PlantFormValues,
  initial: PlantFormValues,
): boolean {
  return initial.species !== null && values.species === null
}
