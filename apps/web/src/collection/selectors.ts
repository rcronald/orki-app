import type { CollectionGenus, CollectionPlant } from './model.ts'
import { normalizeSearchText } from './normalize.ts'
import type { OwnershipMatch } from './ownership.ts'
import {
  allowedTypos,
  boundedPrefixDistance,
  MAX_TOTAL_TYPOS,
} from './similarity.ts'

// Funciones puras sobre la colección en memoria: qué plantas cuentan, filtro por
// texto, agrupación por género, contadores y orden. No piden nada a la red;
// la colección es de cientos de plantas como mucho y todo se calcula en el
// dispositivo.
//
// Por defecto solo cuentan las plantas activas, como decidió el #14: las que
// están perdidas o regaladas se incluyen con { includeInactive: true } (el
// filtro de estado del #15, la exportación del #17).

export interface StatusOptions {
  /** Incluir también las plantas perdidas o regaladas. Por defecto, no. */
  includeInactive?: boolean
}

/** Las plantas que cuentan: solo las activas, salvo que se pidan todas. */
export function plantsByStatus(
  plants: readonly CollectionPlant[],
  { includeInactive = false }: StatusOptions = {},
): readonly CollectionPlant[] {
  return includeInactive
    ? plants
    : plants.filter((plant) => plant.status === 'active')
}

// Búsqueda por texto -----------------------------------------------------------

// Texto normalizado en el que se busca cada planta. Las plantas son objetos
// inmutables (una edición crea otro), así que se calcula una vez por objeto y
// no en cada pulsación del buscador.
const searchTexts = new WeakMap<CollectionPlant, string>()

function searchTextOf(plant: CollectionPlant): string {
  let text = searchTexts.get(plant)
  if (text === undefined) {
    // Cada campo normalizado por separado y unidos con un salto de línea, que
    // la normalización nunca deja: una palabra de la búsqueda no puede casar
    // con el final de un campo y el principio del siguiente.
    text = [
      plant.displayName,
      plant.enteredName,
      plant.genus.name,
      plant.nickname,
      plant.origin,
    ]
      .filter((field): field is string => field !== null)
      .map(normalizeSearchText)
      .join('\n')
    searchTexts.set(plant, text)
  }
  return text
}

// Las palabras del mismo texto, para la búsqueda con errores de tipeo. Sin el
// punto final de cada una, como en "¿Ya la tengo?" ("Phal." es "phal").
const searchWordLists = new WeakMap<CollectionPlant, readonly string[]>()

function searchWordsOf(plant: CollectionPlant): readonly string[] {
  let words = searchWordLists.get(plant)
  if (words === undefined) {
    words = [
      ...new Set(
        searchTextOf(plant)
          .split(/[ \n]/)
          .map((word) => word.replace(/\.+$/, ''))
          .filter(Boolean),
      ),
    ]
    searchWordLists.set(plant, words)
  }
  return words
}

/**
 * Si la planta coincide tolerando errores de tipeo: cada palabra de la búsqueda
 * aparece tal cual o se parece al comienzo de alguna palabra de la planta,
 * con la misma tolerancia que "¿Ya la tengo?" (allowedTypos() por palabra y
 * MAX_TOTAL_TYPOS en toda la búsqueda; ver similarity.ts).
 */
function matchesWithTypos(
  plant: CollectionPlant,
  words: readonly string[],
): boolean {
  const text = searchTextOf(plant)
  let typos = 0
  for (const word of words) {
    if (text.includes(word)) continue
    const allowed = Math.min(allowedTypos(word.length), MAX_TOTAL_TYPOS - typos)
    if (allowed <= 0) return false
    let best = allowed + 1
    for (const plantWord of searchWordsOf(plant)) {
      const distance = boundedPrefixDistance(word, plantWord, best - 1)
      if (distance < best) best = distance
      // No aparece tal cual, así que menos de un error no puede haber.
      if (best <= 1) break
    }
    if (best > allowed) return false
    typos += best
  }
  return true
}

export interface TextFilterOptions extends StatusOptions {
  /**
   * Las coincidencias de "¿Ya la tengo?" por nombre, por id de planta
   * (matchPlantNames en ownership.ts), o null si no las hay.
   */
  nameMatches?: ReadonlyMap<string, Pick<OwnershipMatch, 'quality'>> | null
}

/**
 * Filtra por texto sobre el nombre mostrado, el nombre ingresado, el género, el
 * apodo y el origen, sin distinguir mayúsculas, tildes ni el signo de híbrido
 * (ver normalize.ts). Cada palabra de la búsqueda tiene que aparecer en alguno
 * de esos campos, en cualquier posición: "phal amab" encuentra "Phalaenopsis
 * amabilis" y "amabilis vivero" la encuentra si su origen es "Vivero Sol". Una
 * búsqueda vacía (o que se queda vacía al normalizar) no filtra por texto.
 *
 * Con nameMatches, coinciden también las plantas que "¿Ya la tengo?" encuentra
 * por sus nombres, entre ellos los sinónimos y nombres comunes de su especie
 * ("orquídea luna" encuentra Phalaenopsis amabilis): lo que el panel da por
 * "Sí, la tienes" está en la lista. Las exactas o por prefijo cuentan como
 * coincidencias sin errores; las parecidas ("similar"), como las que toleran
 * errores de tipeo.
 *
 * Si ninguna planta coincide sin errores, se toleran los errores de tipeo
 * ("phalenopsis amabils" encuentra "Phalaenopsis amabilis"), para que la lista
 * no quede vacía cuando "¿Ya la tengo?" responde que hay una parecida. Como
 * allí, las coincidencias con errores solo se muestran cuando no hay ninguna
 * sin ellos.
 */
export function filterByText(
  plants: readonly CollectionPlant[],
  query: string,
  { nameMatches, ...options }: TextFilterOptions = {},
): readonly CollectionPlant[] {
  const candidates = plantsByStatus(plants, options)
  const words = normalizeSearchText(query).split(' ').filter(Boolean)
  if (words.length === 0) return candidates
  const byName = (plant: CollectionPlant) => nameMatches?.get(plant.id)?.quality
  const matches = candidates.filter((plant) => {
    const quality = byName(plant)
    if (quality !== undefined && quality !== 'similar') return true
    const text = searchTextOf(plant)
    return words.every((word) => text.includes(word))
  })
  if (matches.length > 0) return matches
  const typoWords = words
    .map((word) => word.replace(/\.+$/, ''))
    .filter(Boolean)
  if (typoWords.length === 0) return matches
  return candidates.filter(
    (plant) =>
      byName(plant) !== undefined || matchesWithTypos(plant, typoWords),
  )
}

// Orden ------------------------------------------------------------------------

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true })

/** Clave de orden de un nombre: sin el signo de híbrido, tildes ni mayúsculas. */
function sortKey(name: string): string {
  return normalizeSearchText(name)
}

/** Compara dos nombres para ordenarlos alfabéticamente ignorando el signo "×". */
export function compareNames(a: string, b: string): number {
  return collator.compare(sortKey(a), sortKey(b))
}

/**
 * Orden alfabético por nombre mostrado, ignorando el signo de híbrido, las
 * tildes y las mayúsculas ("× Rhyncholaeliocattleya" va con la R). Empates:
 * por id, para que el orden sea siempre el mismo.
 */
export function sortByName(
  plants: readonly CollectionPlant[],
): CollectionPlant[] {
  return plants.toSorted(
    (a, b) =>
      compareNames(a.displayName, b.displayName) || compareIds(a.id, b.id),
  )
}

/** Las más recientes primero, por fecha de alta. Empates: por id. */
export function sortByNewest(
  plants: readonly CollectionPlant[],
): CollectionPlant[] {
  return plants.toSorted(
    (a, b) =>
      Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
      compareIds(a.id, b.id),
  )
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// Agrupación y contadores ------------------------------------------------------

export interface GenusGroup {
  genus: CollectionGenus
  /** Plantas del género, en orden alfabético por nombre mostrado. */
  plants: CollectionPlant[]
  /** Número de plantas del grupo. */
  count: number
}

/**
 * Agrupa por género (el de la planta: el de su especie o, sin especie, el que
 * eligió el usuario). Los grupos van en orden alfabético por nombre del género,
 * ignorando el signo de híbrido, y las plantas de cada grupo por nombre
 * mostrado. Solo activas por defecto.
 */
export function groupByGenus(
  plants: readonly CollectionPlant[],
  options?: StatusOptions,
): GenusGroup[] {
  const groups = new Map<string, GenusGroup>()
  for (const plant of sortByName(plantsByStatus(plants, options))) {
    const group = groups.get(plant.genus.id)
    if (group) {
      group.plants.push(plant)
      group.count += 1
    } else {
      groups.set(plant.genus.id, {
        genus: plant.genus,
        plants: [plant],
        count: 1,
      })
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      compareNames(a.genus.name, b.genus.name) ||
      compareIds(a.genus.id, b.genus.id),
  )
}

/** Número de plantas (solo activas por defecto). */
export function countPlants(
  plants: readonly CollectionPlant[],
  options?: StatusOptions,
): number {
  return plantsByStatus(plants, options).length
}

/** Número de géneros distintos entre las plantas (solo activas por defecto). */
export function countGenera(
  plants: readonly CollectionPlant[],
  options?: StatusOptions,
): number {
  return new Set(plantsByStatus(plants, options).map((plant) => plant.genus.id))
    .size
}
