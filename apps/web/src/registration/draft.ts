import {
  enumValues,
  type FlowerColor,
  type PlantType,
} from '../lib/database.ts'
import type { FormGenus, FormSpecies, PlantFormValues } from './form-state.ts'

// Borrador del registro (#86): lo escrito en el formulario sobrevive a una
// recarga de la página o a que el sistema cierre y vuelva a abrir la app. En
// iOS, abrir la cámara desde la PWA instalada puede descargar la página y
// recargarla al volver (#87).
//
// Dónde: localStorage, no sessionStorage. sessionStorage se pierde cuando el
// sistema termina la app instalada (al reabrirla empieza otra sesión) y es
// justo el caso que hay que cubrir; localStorage persiste. A cambio dura más
// de lo necesario, así que el borrador caduca (PLANT_DRAFT_MAX_AGE_MS) y se
// borra al guardar con éxito o al descartar.
//
// - Una clave por usuario (PLANT_DRAFT_KEY_PREFIX + id de Clerk): el borrador
//   de una cuenta no aparece al entrar con otra en el mismo dispositivo.
// - Versión de formato en el valor: un borrador de otra versión se ignora y
//   se borra.
// - Con los valores del formulario va el id de la planta: si un guardado llegó
//   a la base y la recarga se llevó la respuesta, el siguiente intento usa el
//   mismo id y no crea otra planta (ver save-plant.ts).
// - localStorage puede no existir o fallar (navegación privada, datos del
//   sitio bloqueados, cuota llena): todo va en try/catch y, si falla, el
//   formulario funciona igual, solo que sin borrador.

/** Prefijo de la clave; va seguido del id del usuario. */
export const PLANT_DRAFT_KEY_PREFIX = 'orki:registro:borrador:'

/** Versión del formato guardado. Si cambia PlantFormValues, se sube. */
export const PLANT_DRAFT_VERSION = 1

/**
 * Caducidad desde el último cambio: 24 horas. Cubre de sobra una recarga a
 * mitad de registro; un borrador olvidado no reaparece días después.
 */
export const PLANT_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000

export interface PlantDraft {
  /** Id de la planta que se usará al guardar. */
  plantId: string
  values: PlantFormValues
  /** Último cambio, en milisegundos desde la época. */
  savedAt: number
}

interface StoredDraft {
  version: number
  plantId: string
  savedAt: number
  values: PlantFormValues
}

export function plantDraftKey(userId: string): string {
  return `${PLANT_DRAFT_KEY_PREFIX}${userId}`
}

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function remove(key: string): void {
  try {
    storage()?.removeItem(key)
  } catch {
    // Sin almacenamiento no hay nada que borrar.
  }
}

/**
 * El borrador del usuario, o null si no hay, caducó o no se entiende (en los
 * dos últimos casos, además, se borra).
 */
export function readPlantDraft(userId: string, now: Date): PlantDraft | null {
  const key = plantDraftKey(userId)
  let raw: string | null
  try {
    raw = storage()?.getItem(key) ?? null
  } catch {
    return null
  }
  if (raw === null) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    remove(key)
    return null
  }
  const draft = toDraft(parsed)
  const age = draft ? now.getTime() - draft.savedAt : Number.NaN
  // Una fecha futura (reloj cambiado) tampoco vale.
  if (draft === null || !(age >= 0 && age <= PLANT_DRAFT_MAX_AGE_MS)) {
    remove(key)
    return null
  }
  return draft
}

/** Guarda el borrador. Devuelve false si el almacenamiento no está disponible. */
export function writePlantDraft(userId: string, draft: PlantDraft): boolean {
  const stored: StoredDraft = {
    version: PLANT_DRAFT_VERSION,
    plantId: draft.plantId,
    savedAt: draft.savedAt,
    values: draft.values,
  }
  try {
    const target = storage()
    if (!target) return false
    target.setItem(plantDraftKey(userId), JSON.stringify(stored))
    return true
  } catch {
    return false
  }
}

/** Borra el borrador del usuario (al guardar con éxito o al descartar). */
export function clearPlantDraft(userId: string): void {
  remove(plantDraftKey(userId))
}

// Lectura defensiva ------------------------------------------------------------
// Lo guardado puede venir de otra versión de la app o estar tocado a mano: se
// comprueba campo a campo y, ante cualquier duda, se descarta entero.

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

const PLANT_TYPES: readonly string[] = enumValues.plant_type
const SPECIES_TYPES: readonly string[] = enumValues.species_type
const FLOWER_COLORS: readonly string[] = enumValues.flower_color

function toGenus(value: unknown): FormGenus | null {
  if (!isObject(value) || !isString(value.id) || !isString(value.name)) {
    return null
  }
  return { id: value.id, name: value.name }
}

function toSpecies(value: unknown): FormSpecies | null {
  if (
    !isObject(value) ||
    !isString(value.id) ||
    !isString(value.scientificName) ||
    !isString(value.type) ||
    !SPECIES_TYPES.includes(value.type)
  ) {
    return null
  }
  const genus = toGenus(value.genus)
  if (genus === null) return null
  return {
    id: value.id,
    scientificName: value.scientificName,
    genus,
    type: value.type as FormSpecies['type'],
  }
}

function toValues(value: unknown): PlantFormValues | null {
  if (!isObject(value)) return null
  const {
    name,
    species,
    genus,
    otherGenusOpen,
    type,
    acquiredOn,
    origin,
    location,
    nickname,
    flowerColor,
    photoInBloom,
  } = value
  if (
    !isString(name) ||
    !isString(acquiredOn) ||
    !isString(origin) ||
    !isString(location) ||
    !isString(nickname) ||
    typeof otherGenusOpen !== 'boolean' ||
    typeof photoInBloom !== 'boolean' ||
    (type !== null && !(isString(type) && PLANT_TYPES.includes(type))) ||
    (flowerColor !== null &&
      !(isString(flowerColor) && FLOWER_COLORS.includes(flowerColor)))
  ) {
    return null
  }
  const parsedSpecies = species === null ? null : toSpecies(species)
  const parsedGenus = genus === null ? null : toGenus(genus)
  if (
    (species !== null && parsedSpecies === null) ||
    (genus !== null && parsedGenus === null)
  ) {
    return null
  }
  return {
    name,
    species: parsedSpecies,
    genus: parsedGenus,
    otherGenusOpen,
    type: type as PlantType | null,
    acquiredOn,
    origin,
    location,
    nickname,
    flowerColor: flowerColor as FlowerColor | null,
    photoInBloom,
  }
}

function toDraft(value: unknown): PlantDraft | null {
  if (
    !isObject(value) ||
    value.version !== PLANT_DRAFT_VERSION ||
    !isString(value.plantId) ||
    value.plantId === '' ||
    typeof value.savedAt !== 'number' ||
    !Number.isFinite(value.savedAt)
  ) {
    return null
  }
  const values = toValues(value.values)
  if (values === null) return null
  return { plantId: value.plantId, savedAt: value.savedAt, values }
}
