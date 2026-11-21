import {
  enumValues,
  type FlowerColor,
  type PlantStatus,
} from '../lib/database.ts'
import type { CollectionGenus, CollectionPlant } from './model.ts'
import { normalizeSearchText } from './normalize.ts'
import { compareNames } from './selectors.ts'

// Filtros del inventario (#15): funciones puras sobre la colección en memoria.
//
// - Estado: uno solo; por defecto "active" (decisión del #14). Es la forma de
//   ver las perdidas o regaladas.
// - Género, color de flor y origen: varios valores a la vez.
// - Entre grupos se combinan con Y y dentro de un grupo con O: "Phalaenopsis o
//   Cattleya, y de color blanco".
// - Un ejemplar sin color no aparece al filtrar por color; uno sin origen, al
//   filtrar por origen.
// - El texto del buscador se aplica después, con filterByText.
//
// Los valores son claves estables, no textos traducidos: el id del género, la
// clave del enumerado del color y del estado y, para el origen (texto libre),
// su forma normalizada con normalizeSearchText ("vivero moyobamba"), de modo
// que "Vivero Moyobamba" y "vivero moyobamba" son el mismo origen.

export interface PlantFilters {
  /** Estado de la planta: uno solo. */
  status: PlantStatus
  /** Ids de género; vacío, sin filtro. */
  genera: readonly string[]
  /** Colores de flor; vacío, sin filtro. */
  colors: readonly FlowerColor[]
  /** Claves de origen (originKey); vacío, sin filtro. */
  origins: readonly string[]
}

export const DEFAULT_FILTERS: PlantFilters = {
  status: 'active',
  genera: [],
  colors: [],
  origins: [],
}

/** Clave de un origen: normalizado; null si queda vacío. */
export function originKey(origin: string | null): string | null {
  if (origin === null) return null
  const key = normalizeSearchText(origin)
  return key === '' ? null : key
}

export interface GenusOption {
  genus: CollectionGenus
  count: number
}

export interface ColorOption {
  color: FlowerColor
  count: number
}

export interface OriginOption {
  key: string
  /** La forma escrita más usada del origen, tal como la escribió el usuario. */
  label: string
  count: number
}

/** Opciones de cada filtro, sacadas de la colección. */
export interface FilterOptions {
  /** Géneros presentes, en orden alfabético (sin tener en cuenta el "×"). */
  genera: readonly GenusOption[]
  /** Colores usados, en el orden del enumerado. */
  colors: readonly ColorOption[]
  /** Orígenes usados, de más a menos plantas y, a igualdad, alfabético. */
  origins: readonly OriginOption[]
  /** Todos los estados del enumerado, en su orden. */
  statuses: readonly PlantStatus[]
}

/**
 * Opciones de los filtros a partir de toda la colección (también las dadas de
 * baja), para que no cambien ni desaparezcan al cambiar de estado: un género
 * elegido sigue en su sitio aunque con ese estado no tenga plantas.
 */
export function filterOptions(
  plants: readonly CollectionPlant[],
): FilterOptions {
  const genera = new Map<string, GenusOption>()
  const colors = new Map<FlowerColor, number>()
  // Por clave de origen: cuántas plantas y cuántas veces cada forma escrita.
  const origins = new Map<
    string,
    { count: number; spellings: Map<string, number> }
  >()

  for (const plant of plants) {
    const genus = genera.get(plant.genus.id)
    if (genus) genus.count += 1
    else genera.set(plant.genus.id, { genus: plant.genus, count: 1 })

    if (plant.flowerColor !== null) {
      colors.set(plant.flowerColor, (colors.get(plant.flowerColor) ?? 0) + 1)
    }

    const key = originKey(plant.origin)
    if (key !== null && plant.origin !== null) {
      const spelling = plant.origin.trim().replace(/\s+/g, ' ')
      const entry = origins.get(key) ?? { count: 0, spellings: new Map() }
      entry.count += 1
      entry.spellings.set(spelling, (entry.spellings.get(spelling) ?? 0) + 1)
      origins.set(key, entry)
    }
  }

  return {
    genera: [...genera.values()].sort(
      (a, b) =>
        compareNames(a.genus.name, b.genus.name) ||
        compareKeys(a.genus.id, b.genus.id),
    ),
    colors: enumValues.flower_color
      .filter((color) => colors.has(color))
      .map((color) => ({ color, count: colors.get(color) ?? 0 })),
    origins: [...origins.entries()]
      .map(([key, { count, spellings }]) => ({
        key,
        label: mostUsedSpelling(spellings),
        count,
      }))
      .sort(
        (a, b) =>
          b.count - a.count ||
          compareNames(a.label, b.label) ||
          compareKeys(a.key, b.key),
      ),
    statuses: enumValues.plant_status,
  }
}

function mostUsedSpelling(spellings: Map<string, number>): string {
  let best = ''
  let bestCount = -1
  for (const [spelling, count] of spellings) {
    if (
      count > bestCount ||
      (count === bestCount && compareKeys(spelling, best) < 0)
    ) {
      best = spelling
      bestCount = count
    }
  }
  return best
}

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

/**
 * Deja solo los valores que existen en las opciones (un género o un origen
 * que ya no está en la colección, o un valor inventado en la URL, se ignora),
 * sin repetidos y en el orden de las opciones. Es lo que hay que pasar a
 * applyFilters y lo que cuenta como filtros activos.
 */
export function resolveFilters(
  filters: PlantFilters,
  options: FilterOptions,
): PlantFilters {
  const genera = new Set(filters.genera)
  const colors = new Set(filters.colors)
  const origins = new Set(filters.origins)
  const resolved: PlantFilters = {
    status: options.statuses.includes(filters.status)
      ? filters.status
      : DEFAULT_FILTERS.status,
    genera: options.genera
      .map((option) => option.genus.id)
      .filter((id) => genera.has(id)),
    colors: options.colors
      .map((option) => option.color)
      .filter((color) => colors.has(color)),
    origins: options.origins
      .map((option) => option.key)
      .filter((key) => origins.has(key)),
  }
  return sameFilters(resolved, filters) ? filters : resolved
}

/** Si dos juegos de filtros son iguales, sin tener en cuenta el orden. */
export function sameFilters(a: PlantFilters, b: PlantFilters): boolean {
  return (
    a.status === b.status &&
    sameSet(a.genera, b.genera) &&
    sameSet(a.colors, b.colors) &&
    sameSet(a.origins, b.origins)
  )
}

function sameSet<T>(a: readonly T[], b: readonly T[]): boolean {
  const left = unique(a)
  const right = new Set(b)
  return left.length === right.size && left.every((value) => right.has(value))
}

/** Las plantas con el estado elegido: el total del que se dice "N de M". */
export function plantsWithStatus(
  plants: readonly CollectionPlant[],
  status: PlantStatus,
): readonly CollectionPlant[] {
  return plants.filter((plant) => plant.status === status)
}

/**
 * Aplica los filtros (ya pasados por resolveFilters): estado, y género, color
 * y origen con O dentro de cada grupo e Y entre grupos. Conserva el orden de
 * entrada.
 */
export function applyFilters(
  plants: readonly CollectionPlant[],
  filters: PlantFilters,
): readonly CollectionPlant[] {
  const genera = new Set(filters.genera)
  const colors = new Set<FlowerColor>(filters.colors)
  const origins = new Set(filters.origins)
  return plants.filter((plant) => {
    if (plant.status !== filters.status) return false
    if (genera.size > 0 && !genera.has(plant.genus.id)) return false
    if (
      colors.size > 0 &&
      (plant.flowerColor === null || !colors.has(plant.flowerColor))
    ) {
      return false
    }
    if (origins.size > 0) {
      const key = originKey(plant.origin)
      if (key === null || !origins.has(key)) return false
    }
    return true
  })
}

/**
 * Cuántos filtros hay activos: cada valor elegido de género, color y origen
 * cuenta uno, y el estado cuenta uno si no es el de por defecto.
 */
export function countActiveFilters(filters: PlantFilters): number {
  return (
    filters.genera.length +
    filters.colors.length +
    filters.origins.length +
    (filters.status === DEFAULT_FILTERS.status ? 0 : 1)
  )
}

/**
 * Si los filtros reducen el conjunto de su estado: algún género, color u
 * origen elegido. El estado solo cambia de qué conjunto se habla.
 */
export function narrowsStatus(filters: PlantFilters): boolean {
  return (
    filters.genera.length > 0 ||
    filters.colors.length > 0 ||
    filters.origins.length > 0
  )
}

/** Alterna un valor en una lista de selección múltiple. */
export function toggleValue<T>(values: readonly T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((current) => current !== value)
    : [...values, value]
}
