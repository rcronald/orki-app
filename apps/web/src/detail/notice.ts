// Aviso de lo último que se hizo con una planta (#16), para la pantalla a la
// que se vuelve: "Guardaste los cambios" en el detalle tras editar, o
// "Eliminaste…" en el inventario tras borrar.
//
// Se vuelve con "atrás" en el historial (ver navigation.ts), y una vuelta
// atrás no lleva estado de navegación nuevo: por eso el aviso espera aquí, en
// memoria, a que lo recoja la pantalla de destino. Dura hasta que se recoge o
// se deja otro; una recarga lo pierde, como cualquier aviso.

export type PlantNotice =
  /** Se guardaron los cambios de la planta (en su detalle). */
  | { kind: 'saved'; plantId: string }
  /** Se eliminó la planta (en el inventario). */
  | {
      kind: 'deleted'
      plantId: string
      name: string
      scientific: boolean
      /** false si sus fotos no se pudieron borrar (quedan para la limpieza). */
      photosDeleted: boolean
    }

let pending: PlantNotice | null = null

/** Deja un aviso para la próxima pantalla. */
export function leavePlantNotice(notice: PlantNotice): void {
  pending = notice
}

/** El aviso pendiente, sin recogerlo (para un estado inicial de React). */
export function peekPlantNotice(): PlantNotice | null {
  return pending
}

/** Recoge el aviso: no se vuelve a mostrar. */
export function clearPlantNotice(notice: PlantNotice): void {
  if (pending === notice) pending = null
}
