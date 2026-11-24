import type { PlantPhotoRows, StoredPlantPhoto } from './photo-rows.ts'

// Lo último que esta pestaña sabe de las fotos de cada planta (#285), para
// no volver a leer plant_photos en el recorrido ficha → editar → guardar →
// ficha. Solo en memoria (nada en el dispositivo), por persona y planta, y
// aparte para cada acceso a las filas (cada doble de las pruebas tiene lo
// suyo).
//
// Cuándo se usa y cuándo se vuelve a leer:
// - La ficha lee siempre al abrirse, salvo que lo recordado venga de un
//   guardado de la edición de hace menos de SAVED_FRESH_MS: son las filas
//   que devolvió la base al terminar de escribir. Recargar, «Volver a
//   cargar» y la vuelta de la conexión leen siempre. Sin conexión, la ficha
//   enseña lo recordado aunque sea viejo (como antes, #183).
// - La edición usa lo leído (o guardado) hace menos de EDIT_REUSE_MS; si no,
//   lee. Lo que muestre puede estar desfasado si otro dispositivo cambió algo
//   en ese rato, pero no se pierde nada: el plan de guardado lee las filas
//   al empezar cada intento y concilia con ellas el plan y el formulario.
// - Un guardado bueno recuerda las filas como quedaron; uno que falla olvida
//   lo recordado de esa planta (pudo cambiar a medias). Los cambios de la
//   ficha (fecha, nota, orden) recuerdan lo que devolvió la base.

/** Lo de un guardado sirve a la ficha durante este tiempo. */
export const SAVED_FRESH_MS = 10_000
/** Lo leído sirve a la edición durante este tiempo. */
export const EDIT_REUSE_MS = 60_000

interface Known {
  photos: StoredPlantPhoto[]
  at: number
  source: 'read' | 'saved'
}

let known = new WeakMap<PlantPhotoRows, Map<string, Known>>()

const keyOf = (userId: string, plantId: string) =>
  `${userId}/${plantId.toLowerCase()}`

function entries(rows: PlantPhotoRows): Map<string, Known> {
  let map = known.get(rows)
  if (!map) {
    map = new Map()
    known.set(rows, map)
  }
  return map
}

/** Recuerda las fotos de una planta tal como las dio la base ahora. */
export function rememberPlantPhotos(
  rows: PlantPhotoRows,
  userId: string,
  plantId: string,
  photos: readonly StoredPlantPhoto[],
  source: Known['source'] = 'read',
  now = Date.now(),
): void {
  entries(rows).set(keyOf(userId, plantId), {
    photos: [...photos],
    at: now,
    source,
  })
}

/** Olvida lo recordado de una planta (tras un guardado a medias). */
export function forgetPlantPhotosOf(
  rows: PlantPhotoRows,
  userId: string,
  plantId: string,
): void {
  known.get(rows)?.delete(keyOf(userId, plantId))
}

/** Lo recordado, de cuando sea (para enseñarlo sin conexión). */
export function recalledPlantPhotos(
  rows: PlantPhotoRows,
  userId: string,
  plantId: string,
): StoredPlantPhoto[] | undefined {
  return known.get(rows)?.get(keyOf(userId, plantId))?.photos
}

/** Lo recordado de hace menos de `maxAgeMs` (y, si se pide, de un guardado). */
export function recentPlantPhotos(
  rows: PlantPhotoRows,
  userId: string,
  plantId: string,
  maxAgeMs: number,
  { savedOnly = false, now = Date.now() } = {},
): StoredPlantPhoto[] | null {
  const entry = known.get(rows)?.get(keyOf(userId, plantId))
  if (!entry) return null
  if (savedOnly && entry.source !== 'saved') return null
  const age = now - entry.at
  return age >= 0 && age < maxAgeMs ? [...entry.photos] : null
}

/** Olvida todo (pruebas). */
export function forgetAllPlantPhotos(): void {
  known = new WeakMap()
}
