import {
  enumValues,
  type FlowerColor,
  type PlantType,
} from '../lib/database.ts'
import type { FormGenus, FormSpecies, PlantFormValues } from './form-state.ts'

// Borradores del registro (#86; varios desde el #296): lo escrito en el
// formulario sobrevive a una recarga de la página, a que el sistema cierre y
// vuelva a abrir la app y a quedarse sin conexión. En iOS, abrir la cámara
// desde la PWA instalada puede descargar la página y recargarla al volver
// (#87).
//
// Dónde: localStorage, no sessionStorage. sessionStorage se pierde cuando el
// sistema termina la app instalada (al reabrirla empieza otra sesión) y es
// justo el caso que hay que cubrir; localStorage persiste. A cambio dura más
// de lo necesario, así que cada borrador caduca (PLANT_DRAFT_MAX_AGE_MS) y se
// borra al guardar con éxito o al descartarlo.
//
// - Una clave por usuario (PLANT_DRAFT_KEY_PREFIX + id de Clerk): los
//   borradores de una cuenta no aparecen al entrar con otra en el mismo
//   dispositivo.
// - Hasta MAX_PLANT_DRAFTS borradores por usuario (#296): el que está en el
//   formulario y otro que la persona dejó para después al registrar otra
//   especie («Registrar <especie>» en vez de «Continuar borrador»). Cada uno
//   se identifica por su id de planta, que es también el de sus fotos
//   (draft-photo.ts). Ninguno se borra sin que la persona lo decida (guardar,
//   «Descartar borrador», «Cancelar» o vaciar el formulario) salvo al caducar;
//   el formulario no deja empezar un tercero (ver draft-choice.ts). Si aun
//   así llega uno más (dos pestañas a la vez), se pierde el más antiguo.
// - Versión de formato en el valor: un valor de otra versión se ignora y se
//   borra. La 1 (un solo borrador, hasta el #296) se lee como una lista de
//   uno; la siguiente escritura lo guarda ya en la 2.
// - Con los valores del formulario va el id de la planta: si un guardado llegó
//   a la base y la recarga se llevó la respuesta, el siguiente intento usa el
//   mismo id y no crea otra planta (ver save-plant.ts).
// - localStorage puede no existir o fallar (navegación privada, datos del
//   sitio bloqueados, cuota llena): todo va en try/catch y, si falla, el
//   formulario funciona igual, solo que sin borrador.

/** Prefijo de la clave; va seguido del id del usuario. */
export const PLANT_DRAFT_KEY_PREFIX = 'orki:registro:borrador:'

/**
 * Versión del formato guardado: la 2 es una lista de borradores (#296); la 1,
 * un solo borrador. Si cambia PlantFormValues, se sube.
 */
export const PLANT_DRAFT_VERSION = 2

/** Formato de un solo borrador, anterior al #296. Se sigue leyendo. */
const SINGLE_DRAFT_VERSION = 1

/** Cuántos borradores se guardan por usuario (#296). */
export const MAX_PLANT_DRAFTS = 2

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

interface StoredDrafts {
  version: typeof PLANT_DRAFT_VERSION
  /** Del más reciente al más antiguo. */
  drafts: PlantDraft[]
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

function isFresh(draft: PlantDraft, now: Date): boolean {
  const age = now.getTime() - draft.savedAt
  // Una fecha futura (reloj cambiado) tampoco vale.
  return age >= 0 && age <= PLANT_DRAFT_MAX_AGE_MS
}

function byRecency(a: PlantDraft, b: PlantDraft): number {
  return b.savedAt - a.savedAt
}

/** Lo guardado, tal cual (también lo caducado); null si no hay o no se entiende. */
function readStored(key: string): PlantDraft[] | null {
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
    return null
  }
  return toDrafts(parsed)
}

function store(userId: string, drafts: readonly PlantDraft[]): boolean {
  const key = plantDraftKey(userId)
  try {
    const target = storage()
    if (!target) return false
    if (drafts.length === 0) {
      target.removeItem(key)
      return true
    }
    const stored: StoredDrafts = {
      version: PLANT_DRAFT_VERSION,
      drafts: [...drafts]
        .sort(byRecency)
        .map(({ plantId, savedAt, values }) => ({
          plantId,
          savedAt,
          values,
        })),
    }
    target.setItem(key, JSON.stringify(stored))
    return true
  } catch {
    return false
  }
}

/**
 * Los borradores del usuario que siguen valiendo, del más reciente al más
 * antiguo; vacío si no hay. Los caducados se borran, y todo el valor si no se
 * entiende (otra versión, tocado a mano).
 */
export function readPlantDrafts(userId: string, now: Date): PlantDraft[] {
  const key = plantDraftKey(userId)
  const stored = readStored(key)
  if (stored === null) {
    // Hay algo que no se entiende, o no hay nada: en los dos casos, fuera.
    remove(key)
    return []
  }
  const fresh = stored.filter((draft) => isFresh(draft, now)).sort(byRecency)
  if (fresh.length !== stored.length) store(userId, fresh)
  return fresh
}

/**
 * Un borrador del usuario: el de `plantId` o, sin él, el más reciente. Null
 * si no hay, caducó o no se entiende (en los dos últimos casos, se borra).
 */
export function readPlantDraft(
  userId: string,
  now: Date,
  plantId?: string,
): PlantDraft | null {
  const drafts = readPlantDrafts(userId, now)
  return (
    (plantId === undefined
      ? drafts[0]
      : drafts.find((draft) => draft.plantId === plantId)) ?? null
  )
}

/**
 * Guarda el borrador, en lugar del que tenga su mismo id de planta. Devuelve
 * false si el almacenamiento no está disponible.
 */
export function writePlantDraft(userId: string, draft: PlantDraft): boolean {
  const others = (readStored(plantDraftKey(userId)) ?? []).filter(
    (other) => other.plantId !== draft.plantId,
  )
  // Defensivo (dos pestañas): si no cabe, se pierde el más antiguo.
  const kept = others.sort(byRecency).slice(0, MAX_PLANT_DRAFTS - 1)
  return store(userId, [draft, ...kept])
}

/**
 * Borra el borrador de `plantId` (al guardar con éxito o al descartarlo) o,
 * sin él, todos los del usuario.
 */
export function clearPlantDraft(userId: string, plantId?: string): void {
  if (plantId === undefined) {
    remove(plantDraftKey(userId))
    return
  }
  const stored = readStored(plantDraftKey(userId))
  if (stored === null) {
    remove(plantDraftKey(userId))
    return
  }
  store(
    userId,
    stored.filter((draft) => draft.plantId !== plantId),
  )
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

/** Los borradores guardados, en la versión 2 o en la 1; null si no se entiende. */
function toDrafts(value: unknown): PlantDraft[] | null {
  if (!isObject(value)) return null
  if (value.version === SINGLE_DRAFT_VERSION) {
    const draft = toDraft(value)
    return draft === null ? null : [draft]
  }
  if (value.version !== PLANT_DRAFT_VERSION || !Array.isArray(value.drafts)) {
    return null
  }
  const drafts: PlantDraft[] = []
  for (const item of value.drafts as unknown[]) {
    const draft = toDraft(item)
    if (draft === null) return null
    if (!drafts.some((other) => other.plantId === draft.plantId)) {
      drafts.push(draft)
    }
  }
  return drafts.sort(byRecency).slice(0, MAX_PLANT_DRAFTS)
}
