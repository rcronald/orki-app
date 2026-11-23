import type { CollectionPlant } from '../collection/model.ts'
import { MAX_PLANT_PHOTOS, plantPhotoPaths } from '../photos/paths.ts'
import {
  byPosition,
  type PlantPhotoRowChanges,
  type PlantPhotoRows,
  type StoredPlantPhoto,
} from '../photos/photo-rows.ts'
import {
  PhotoStorageError,
  photoStorageErrorFrom,
  type PhotoStorage,
} from '../photos/storage.ts'
import {
  photoVersionFor,
  removeQuietly,
  uploadPhotoFiles,
  type PhotoFiles,
} from '../photos/upload.ts'
import type { PlantPatch } from '../registration/form-state.ts'
import { plantSaveErrorFrom } from '../registration/save-plant.ts'

// Guardado de la edición de una planta (#266) como un plan que se aplica de
// una vez al pulsar «Guardar cambios». Hasta entonces nada sale de la
// pantalla: las fotos quitadas siguen en la base, las nuevas solo están en
// memoria y el orden, la principal, la fecha y la nota de cada foto son
// estado del formulario. Por eso «Cancelar» no tiene nada que deshacer.
//
// Orden de las operaciones y por qué es seguro:
//
// 0. Leer las filas de plant_photos de la planta. Es la verdad de la que
//    parte cada intento: lo que un intento anterior ya hizo (aunque se
//    perdiera la respuesta) se ve aquí y no se repite.
// 1. Subir los archivos de las fotos nuevas (foto y miniatura), sin crear
//    filas. Es lo que más falla (red, tamaño) y no cambia nada visible: si
//    falla, la base sigue como estaba. Cada foto preparada tiene su versión
//    fija (photoVersionFor), así que reintentar sube a las mismas rutas y
//    Storage responde 409 si ya estaban (se dan por subidas). Una foto cuya
//    ruta ya está en una fila no se vuelve a subir: un fallo a medias de esa
//    subida borraría los archivos que la fila cita (uploadPhotoFiles limpia
//    lo suyo al fallar).
// 2. Guardar los datos de la planta (solo las columnas que cambiaron). Es
//    idempotente: repetir el mismo cambio deja lo mismo. Quien llama recuerda
//    lo ya guardado (evento data-saved) para no volver a enviarlo.
// 3. Borrar las filas de las fotos quitadas (sin sus archivos). Va antes de
//    crear las nuevas porque una planta tiene como mucho seis posiciones
//    (0 a 5): con seis fotos, quitar dos y añadir dos no cabría al revés. Si
//    la fila ya no está (un intento anterior la borró), se sigue.
// 4. Crear las filas de las fotos nuevas, con su fecha, su nota y «en flor»,
//    en posiciones libres. Sus archivos ya existen (paso 1): nunca hay una
//    fila que cite un archivo que no está. Si la ruta ya tiene fila (un
//    intento anterior la creó), no se crea otra: no hay duplicados.
// 5. Cambiar la fecha, la nota y «en flor» de las fotos que se conservan,
//    solo si difieren de lo leído en el paso 0.
// 6. Poner el orden final de una vez (reorder_plant_photos): la primera es
//    la principal y la base la copia a la planta. Si ya está en ese orden, no
//    se envía nada.
// 7. Releer la planta (con la principal y el número de fotos nuevos) para la
//    colección y la tarjeta de «Mi colección».
// 8. Al final, borrar los archivos de las fotos quitadas, cuando ya ninguna
//    fila los cita. Si falla, quedan para el script de limpieza
//    (npm run fotos:huerfanas): un archivo sin fila no lo ve nadie.
//
// Si un paso falla, el plan se detiene con PlantEditError (qué paso, por qué
// y, en la subida, qué fotos). Lo editado sigue en la pantalla y «Reintentar»
// vuelve a aplicar el mismo plan desde el paso 0: lo ya hecho se salta, nada
// se duplica y ninguna foto que se conserva se toca hasta el paso 5. Si la
// persona sale sin reintentar, los archivos subidos en el paso 1 que no
// llegaron a tener fila se borran (discardUploads).

/** Fecha, nota y «en flor» de una foto, ya normalizadas. */
export interface PlannedPhotoDetails {
  /** AAAA-MM-DD o null. */
  takenAt: string | null
  /** Sin espacios a los lados; null si queda vacía. */
  note: string | null
  inBloom: boolean
}

/** Una foto del resultado final, en su orden (la primera, la principal). */
export type PlannedPhoto =
  | {
      kind: 'stored'
      key: string
      /** La foto tal como se leyó al abrir la edición. */
      stored: StoredPlantPhoto
      details: PlannedPhotoDetails
    }
  | {
      kind: 'new'
      key: string
      /** La foto preparada: su versión (y sus rutas) es fija. */
      files: PhotoFiles
      details: PlannedPhotoDetails
    }

export interface PlantEditPlan {
  userId: string
  plantId: string
  /** Columnas de plants que cambiaron; vacío si ninguna. */
  patch: PlantPatch
  /** Todas las fotos que quedan, en el orden final. */
  photos: readonly PlannedPhoto[]
  /** Fotos guardadas que se quitan. */
  removed: readonly StoredPlantPhoto[]
}

export interface PlantEditServices {
  rows: PlantPhotoRows
  storage: PhotoStorage
  /** Guarda las columnas que cambiaron; rechaza con PlantSaveError. */
  updatePlant: (plantId: string, patch: PlantPatch) => Promise<CollectionPlant>
}

export type PlantEditStep =
  'read' | 'upload' | 'data' | 'remove' | 'insert' | 'details' | 'order'

export type PlantEditEvent =
  /** Una foto nueva subiendo (progress de 0 a 1). */
  | { type: 'upload-progress'; key: string; progress: number }
  /** Los archivos de una foto nueva están en Storage. */
  | { type: 'uploaded'; key: string }
  | { type: 'upload-failed'; key: string; error: PhotoStorageError }
  /** Los datos de la planta quedaron guardados. */
  | { type: 'data-saved'; plant: CollectionPlant }
  /** Algo cambió ya en plant_photos (para avisar de un guardado a medias). */
  | { type: 'photos-written' }

/** Un paso del plan falló; lo anterior quedó hecho. */
export class PlantEditError extends Error {
  readonly step: PlantEditStep
  /** En la subida: las fotos (key) que no se subieron. */
  readonly failedKeys: readonly string[]

  constructor(
    step: PlantEditStep,
    cause: unknown,
    failedKeys: readonly string[] = [],
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause })
    this.name = 'PlantEditError'
    this.step = step
    this.failedKeys = failedKeys
  }
}

export interface PlantEditResult {
  /** La planta como quedó (releída o la de guardar los datos); null si no cambió nada de ella ni se pudo releer. */
  plant: CollectionPlant | null
  /** Las fotos de la planta como quedaron, en orden. */
  photos: StoredPlantPhoto[]
  /** Archivos de las fotos quitadas que no se pudieron borrar. */
  leftovers: string[]
}

/** Lo que se recuerda entre intentos: los archivos ya subidos de cada foto. */
export type UploadedPhotos = Map<
  PhotoFiles,
  { photoPath: string; thumbnailPath: string }
>

function pathsOf(files: PhotoFiles, userId: string, plantId: string) {
  return plantPhotoPaths({
    userId,
    plantId,
    version: photoVersionFor(files),
    photoType: files.photo.type,
    thumbnailType: files.thumbnail.type,
  })
}

/** Lo que hay que cambiar de una fila para que tenga `details`. */
export function detailChanges(
  row: Pick<StoredPlantPhoto, 'takenAt' | 'note' | 'inBloom'>,
  details: PlannedPhotoDetails,
): PlantPhotoRowChanges {
  const changes: PlantPhotoRowChanges = {}
  if (row.takenAt !== details.takenAt) changes.takenAt = details.takenAt
  if (row.note !== details.note) changes.note = details.note
  if (row.inBloom !== details.inBloom) changes.inBloom = details.inBloom
  return changes
}

/** Primera posición libre después de la última ocupada; si no, la primera libre. */
function freePosition(occupied: ReadonlySet<number>): number | null {
  const last = Math.max(-1, ...occupied)
  for (let position = last + 1; position < MAX_PLANT_PHOTOS; position += 1) {
    if (!occupied.has(position)) return position
  }
  for (let position = 0; position < MAX_PLANT_PHOTOS; position += 1) {
    if (!occupied.has(position)) return position
  }
  return null
}

/**
 * Aplica el plan en el orden de arriba. Resuelve con la planta y las fotos
 * como quedaron; rechaza con PlantEditError en el primer paso que falle (en
 * la subida, después de intentar todas las fotos). Para reintentar, se vuelve
 * a llamar con el mismo `uploaded`.
 */
export async function applyPlantEdit(
  plan: PlantEditPlan,
  services: PlantEditServices,
  uploaded: UploadedPhotos,
  onEvent: (event: PlantEditEvent) => void = () => undefined,
): Promise<PlantEditResult> {
  const { userId } = plan
  const { rows: rowsApi, storage } = services
  const plantId = plan.plantId.toLowerCase()
  const newPhotos = plan.photos.filter(
    (photo): photo is Extract<PlannedPhoto, { kind: 'new' }> =>
      photo.kind === 'new',
  )

  // 0. Lo que hay ahora.
  let rows: StoredPlantPhoto[]
  try {
    rows = await rowsApi.list(plantId, userId)
  } catch (error) {
    throw new PlantEditError('read', photoStorageErrorFrom(error))
  }
  const rowWithPath = (path: string) =>
    rows.find((row) => row.photoPath === path)

  // 1. Archivos de las fotos nuevas.
  const failedKeys: string[] = []
  let firstUploadError: PhotoStorageError | null = null
  for (const photo of newPhotos) {
    const expected = pathsOf(photo.files, userId, plantId)
    if (uploaded.has(photo.files) || rowWithPath(expected.photoPath)) {
      uploaded.set(photo.files, expected)
      onEvent({ type: 'uploaded', key: photo.key })
      continue
    }
    try {
      const paths = await uploadPhotoFiles(photo.files, {
        userId,
        plantId,
        storage,
        onProgress: ({ bytesDone, bytesTotal }) =>
          onEvent({
            type: 'upload-progress',
            key: photo.key,
            progress: bytesTotal > 0 ? bytesDone / bytesTotal : 0,
          }),
      })
      uploaded.set(photo.files, paths)
      onEvent({ type: 'uploaded', key: photo.key })
    } catch (error) {
      const failure = photoStorageErrorFrom(error)
      firstUploadError ??= failure
      failedKeys.push(photo.key)
      onEvent({ type: 'upload-failed', key: photo.key, error: failure })
    }
  }
  if (firstUploadError !== null) {
    throw new PlantEditError('upload', firstUploadError, failedKeys)
  }

  // 2. Datos de la planta.
  let plant: CollectionPlant | null = null
  if (Object.keys(plan.patch).length > 0) {
    try {
      plant = await services.updatePlant(plantId, plan.patch)
    } catch (error) {
      throw new PlantEditError('data', plantSaveErrorFrom(error))
    }
    onEvent({ type: 'data-saved', plant })
  }

  let photosWritten = false
  const written = () => {
    if (!photosWritten) onEvent({ type: 'photos-written' })
    photosWritten = true
  }

  // 3. Filas de las fotos quitadas (los archivos, al final).
  for (const removed of plan.removed) {
    if (!rows.some((row) => row.id === removed.id)) continue
    try {
      await rowsApi.remove(removed.id, userId)
    } catch (error) {
      throw new PlantEditError('remove', photoStorageErrorFrom(error))
    }
    rows = rows.filter((row) => row.id !== removed.id)
    written()
  }

  // 4. Filas de las fotos nuevas.
  for (const photo of newPhotos) {
    const paths =
      uploaded.get(photo.files) ?? pathsOf(photo.files, userId, plantId)
    if (rowWithPath(paths.photoPath)) continue
    const position = freePosition(new Set(rows.map((row) => row.position)))
    if (position === null) {
      throw new PlantEditError(
        'insert',
        new PhotoStorageError('too-many-photos'),
      )
    }
    let row: StoredPlantPhoto
    try {
      row = await rowsApi.insert({
        plantId,
        userId,
        photoPath: paths.photoPath,
        thumbnailPath: paths.thumbnailPath,
        inBloom: photo.details.inBloom,
        takenAt: photo.details.takenAt,
        note: photo.details.note,
        position,
      })
    } catch (error) {
      const failure = photoStorageErrorFrom(error)
      throw new PlantEditError(
        'insert',
        failure.reason === 'position-taken'
          ? new PhotoStorageError('too-many-photos', { cause: error })
          : failure,
      )
    }
    rows = [...rows, row].sort(byPosition)
    written()
  }

  // Cada foto del plan con su fila.
  const rowOf = (photo: PlannedPhoto): StoredPlantPhoto | undefined =>
    photo.kind === 'stored'
      ? rows.find((row) => row.id === photo.stored.id)
      : rowWithPath(
          (uploaded.get(photo.files) ?? pathsOf(photo.files, userId, plantId))
            .photoPath,
        )

  // 5. Fecha, nota y «en flor».
  for (const photo of plan.photos) {
    const row = rowOf(photo)
    if (!row) {
      throw new PlantEditError('details', new PhotoStorageError('not-found'))
    }
    const changes = detailChanges(row, photo.details)
    if (Object.keys(changes).length === 0) continue
    let updated: StoredPlantPhoto
    try {
      updated = await rowsApi.update(row.id, userId, changes)
    } catch (error) {
      throw new PlantEditError('details', photoStorageErrorFrom(error))
    }
    rows = rows.map((item) => (item.id === updated.id ? updated : item))
    written()
  }

  // 6. El orden final (la primera es la principal).
  const order = plan.photos.map((photo) => rowOf(photo)?.id ?? '')
  const current = [...rows].sort(byPosition).map((row) => row.id)
  if (current.length !== order.length) {
    // Otra foto se añadió desde otro dispositivo: el orden no cubriría todas.
    throw new PlantEditError('order', new PhotoStorageError('position-taken'))
  }
  if (order.some((id, index) => id !== current[index])) {
    try {
      rows = await rowsApi.reorder(plantId, userId, order)
    } catch (error) {
      throw new PlantEditError('order', photoStorageErrorFrom(error))
    }
    written()
  }

  // 7. La planta con la principal y el número de fotos nuevos.
  if (photosWritten) {
    try {
      plant = await rowsApi.readPlant(plantId, userId)
    } catch {
      // La base ya tiene la principal; la colección la verá en la próxima
      // lectura.
    }
  }

  // 8. Los archivos de las fotos quitadas.
  const leftovers = await removeQuietly(
    storage,
    plan.removed.flatMap((photo) => [photo.photoPath, photo.thumbnailPath]),
  )

  return { plant, photos: [...rows].sort(byPosition), leftovers }
}

/**
 * Borra los archivos subidos que no llegaron a tener fila (la persona salió
 * sin reintentar tras un fallo). Lee las filas para no tocar ninguno que una
 * fila cite; si no puede leerlas, no borra nada (los recogerá la limpieza).
 */
export async function discardUploads(
  uploaded: UploadedPhotos,
  { userId, plantId }: { userId: string; plantId: string },
  services: Pick<PlantEditServices, 'rows' | 'storage'>,
): Promise<void> {
  if (uploaded.size === 0) return
  let rows: StoredPlantPhoto[]
  try {
    rows = await services.rows.list(plantId.toLowerCase(), userId)
  } catch {
    return
  }
  const cited = new Set(
    rows.flatMap((row) => [row.photoPath, row.thumbnailPath]),
  )
  const paths = [...uploaded.values()]
    .flatMap((paths) => [paths.photoPath, paths.thumbnailPath])
    .filter((path) => !cited.has(path))
  uploaded.clear()
  await removeQuietly(services.storage, paths)
}
