// De dónde se llegó al detalle o a la edición de una planta (#16), en el
// estado de la navegación de React Router (sobrevive a una recarga, como la
// entrada del historial).
//
// Volver al inventario desde el detalle es "atrás" en el historial cuando se
// llegó desde él: así la entrada del inventario recupera su búsqueda y sus
// filtros (en la URL) y su posición de desplazamiento (scroll-memory.ts, que
// solo restaura al volver con atrás). Si se abrió el detalle directamente
// (un enlace, la pantalla de inicio de la app instalada), no hay a dónde
// volver: se va al inventario con un enlace normal.

export interface PlantNavigationState {
  /** Se llegó al detalle desde una tarjeta del inventario. */
  fromInventory?: boolean
  /** Se llegó a la edición desde el detalle. */
  fromDetail?: boolean
}

/** Estado con el que la tarjeta del inventario abre el detalle. */
export const FROM_INVENTORY: PlantNavigationState = { fromInventory: true }

/** Estado con el que el detalle abre la edición. */
export const FROM_DETAIL: PlantNavigationState = { fromDetail: true }

/** Si el estado de la navegación dice que se llegó desde el inventario. */
export function cameFromInventory(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    'fromInventory' in state &&
    state.fromInventory === true
  )
}

/** Si el estado de la navegación dice que se llegó desde el detalle. */
export function cameFromDetail(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    'fromDetail' in state &&
    state.fromDetail === true
  )
}
