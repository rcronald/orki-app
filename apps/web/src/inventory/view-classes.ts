import type { InventoryView } from './preferences.ts'

// Clases de cada vista, compartidas con la lista para que el esqueleto ocupe
// lo mismo que las tarjetas. Cuadrícula: dos por fila en el celular y tres en
// escritorio (#208). Lista: una fila por planta, dos columnas en escritorio.
export const VIEW_CLASSES: Record<InventoryView, string> = {
  list: 'grid grid-cols-1 gap-space-3 lg:grid-cols-2',
  grid: 'grid grid-cols-2 gap-space-3 md:grid-cols-3',
}
