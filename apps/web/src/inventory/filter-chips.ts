import {
  countActiveFilters,
  DEFAULT_FILTERS,
  type FilterOptions,
  type PlantFilters,
} from '../collection/filters.ts'
import { FLOWER_COLOR_LABEL } from '../collection/labels.ts'
import {
  FILTERS_TEXT,
  STATUS_FILTER_LABEL,
  VALIDATION_FILTER_LABEL,
} from './texts.ts'

// Los filtros activos del panel como chips quitables (ActiveFilters en
// InventoryFilters.tsx), en el orden de las opciones: estado, colores,
// orígenes y validaciones. El género no está: tiene su propia fila de chips
// siempre a la vista (los accesos por género, #208), que ya dice cuál está
// elegido.

export interface ActiveFilterChip {
  /** Clave única: grupo y valor. */
  id: string
  /** Nombre del grupo ("Género"), para el lector de pantalla. */
  group: string
  /** Lo que se ve en el chip ("Phalaenopsis"). */
  label: string
  /** Los filtros sin este valor. */
  without: PlantFilters
}

/** Los filtros activos del panel como chips, de lo resuelto contra las opciones. */
export function activeFilterChips(
  filters: PlantFilters,
  options: FilterOptions,
): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = []
  if (filters.status !== DEFAULT_FILTERS.status) {
    chips.push({
      id: `estado:${filters.status}`,
      group: FILTERS_TEXT.status,
      label: STATUS_FILTER_LABEL[filters.status],
      without: { ...filters, status: DEFAULT_FILTERS.status },
    })
  }
  for (const { color } of options.colors) {
    if (!filters.colors.includes(color)) continue
    chips.push({
      id: `color:${color}`,
      group: FILTERS_TEXT.color,
      label: FLOWER_COLOR_LABEL[color],
      without: {
        ...filters,
        colors: filters.colors.filter((value) => value !== color),
      },
    })
  }
  for (const { key, label } of options.origins) {
    if (!filters.origins.includes(key)) continue
    chips.push({
      id: `origen:${key}`,
      group: FILTERS_TEXT.origin,
      label,
      without: {
        ...filters,
        origins: filters.origins.filter((value) => value !== key),
      },
    })
  }
  for (const validation of options.validations) {
    if (!filters.validations.includes(validation)) continue
    chips.push({
      id: `validacion:${validation}`,
      group: FILTERS_TEXT.validation,
      label: VALIDATION_FILTER_LABEL[validation],
      without: {
        ...filters,
        validations: filters.validations.filter(
          (value) => value !== validation,
        ),
      },
    })
  }
  return chips
}

/** Los filtros sin los del panel: conserva solo el género elegido. */
export function withoutPanelFilters(filters: PlantFilters): PlantFilters {
  return { ...DEFAULT_FILTERS, genera: filters.genera }
}

/** Cuántos filtros del panel hay activos (todos menos el género). */
export function countPanelFilters(filters: PlantFilters): number {
  return countActiveFilters(filters) - filters.genera.length
}
