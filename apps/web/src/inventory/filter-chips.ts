import {
  DEFAULT_FILTERS,
  type FilterOptions,
  type PlantFilters,
} from '../collection/filters.ts'
import { FLOWER_COLOR_LABEL } from '../collection/labels.ts'
import { FILTERS_TEXT, STATUS_FILTER_LABEL } from './texts.ts'

// Los filtros activos como chips quitables (ActiveFilters en
// InventoryFilters.tsx), en el orden de las opciones: estado, géneros,
// colores y orígenes.

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

/** Los filtros activos como chips, de lo resuelto contra las opciones. */
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
  for (const { genus } of options.genera) {
    if (!filters.genera.includes(genus.id)) continue
    chips.push({
      id: `genero:${genus.id}`,
      group: FILTERS_TEXT.genus,
      label: genus.name,
      without: {
        ...filters,
        genera: filters.genera.filter((id) => id !== genus.id),
      },
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
  return chips
}
