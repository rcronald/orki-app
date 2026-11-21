import {
  DEFAULT_FILTERS,
  originKey,
  type PlantFilters,
} from '../collection/filters.ts'
import {
  enumValues,
  type FlowerColor,
  type PlantStatus,
} from '../lib/database.ts'

// Los filtros del inventario en la dirección de la página, junto a la búsqueda
// (?q=). Nombres de parámetro en español y valores estables, no traducidos:
//
//   /coleccion?q=phal&estado=lost&genero=<id>&genero=<id>&color=white&origen=vivero%20sol
//
// - estado: clave del enumerado plant_status; sin él (o con "active"), activas.
// - genero: id del género, uno por parámetro repetido.
// - color: clave del enumerado flower_color, repetido.
// - origen: el origen normalizado (minúsculas, sin tildes), repetido. Va
//   repetido y no separado por comas porque un origen puede llevar comas.
//
// Al leer se ignoran los valores que no se entienden (un color o un estado
// inventado, vacíos, repetidos); los géneros y orígenes que no están en la
// colección los descarta después resolveFilters. Al escribir, el estado por
// defecto no se escribe, para que /coleccion siga siendo /coleccion.

export const FILTER_PARAMS = {
  status: 'estado',
  genus: 'genero',
  color: 'color',
  origin: 'origen',
} as const

const STATUSES: readonly string[] = enumValues.plant_status
const COLORS: readonly string[] = enumValues.flower_color

function isStatus(value: string | null): value is PlantStatus {
  return value !== null && STATUSES.includes(value)
}

function isColor(value: string): value is FlowerColor {
  return COLORS.includes(value)
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

/** Lee los filtros de la URL; lo que no se entiende, se ignora. */
export function readFilters(params: URLSearchParams): PlantFilters {
  const status = params.get(FILTER_PARAMS.status)
  return {
    status: isStatus(status) ? status : DEFAULT_FILTERS.status,
    genera: unique(
      params
        .getAll(FILTER_PARAMS.genus)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
    colors: unique(params.getAll(FILTER_PARAMS.color).filter(isColor)),
    origins: unique(
      params
        .getAll(FILTER_PARAMS.origin)
        .map(originKey)
        .filter((key): key is string => key !== null),
    ),
  }
}

/**
 * Devuelve una copia de `params` con los filtros escritos: conserva los demás
 * parámetros (la búsqueda) y sustituye los de filtro.
 */
export function writeFilters(
  params: URLSearchParams,
  filters: PlantFilters,
): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const name of Object.values(FILTER_PARAMS)) next.delete(name)
  if (filters.status !== DEFAULT_FILTERS.status) {
    next.set(FILTER_PARAMS.status, filters.status)
  }
  for (const id of filters.genera) next.append(FILTER_PARAMS.genus, id)
  for (const color of filters.colors) next.append(FILTER_PARAMS.color, color)
  for (const key of filters.origins) next.append(FILTER_PARAMS.origin, key)
  return next
}
