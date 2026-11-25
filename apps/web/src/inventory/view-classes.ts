import type { InventoryView } from './preferences.ts'

// Clases de cada vista, compartidas con la lista para que el esqueleto ocupe
// lo mismo que las tarjetas. Cuadrícula: dos por fila en el celular, tres
// desde 768 px (#208) y cuatro desde 1200 px (#292: con 100 plantas o más, la
// página mide un cuarto menos). Lista: una fila por planta, dos columnas en
// escritorio.
//
// Tres columnas solo hasta 1199 px (md:max-[1199px]:): Tailwind pone la regla
// de min-[1200px] antes que la de md, y si se solaparan ganaría md.
export const VIEW_CLASSES: Record<InventoryView, string> = {
  list: 'grid grid-cols-1 gap-space-3 lg:grid-cols-2',
  grid: 'grid grid-cols-2 gap-space-3 md:max-[1199px]:grid-cols-3 min-[1200px]:grid-cols-4',
}
