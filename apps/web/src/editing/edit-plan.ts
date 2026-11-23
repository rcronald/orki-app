import type { CollectionPlant } from '../collection/model.ts'
import { MAX_PLANT_PHOTOS, plantPhotoPaths } from '../photos/paths.ts'
import {
  byPosition,
  type PlantPhotoRowChanges,
  type PlantPhotoRowInsert,
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
import {
  PlantSaveError,
  plantSaveErrorFrom,
} from '../registration/save-plant.ts'

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
//    perdiera la respuesta) se ve aquí y no se repite. El plan se concilia
//    con ellas (#279):
//    - Una foto guardada del plan que ya no tiene fila (la borró un intento
//      anterior o otro dispositivo) sale del plan, y sus archivos se borran
//      al final; si es que la planta ya no existe, el plan se detiene con
//      plantGone.
//    - Una foto nueva que un intento anterior subió (está en `uploaded`) y
//      que ya no está en el plan se trata como quitada: su fila, si la
//      tiene, se borra en el paso 3, y sus archivos, al final.
//    - Una fila que el plan no conoce (añadida desde otro dispositivo) se
//      conserva, detrás de las del plan.
//    Quien llama recibe las filas leídas (evento rows-read) para conciliar
//    también su formulario.
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
// 3. Borrar las filas de las fotos quitadas (sin sus archivos), todas en una
//    petición (id=in.(...)). Va antes de crear las nuevas porque una planta
//    tiene como mucho seis posiciones (0 a 5): con seis fotos, quitar dos y
//    añadir dos no cabría al revés. Si la fila ya no está (un intento
//    anterior la borró), se sigue.
// 4. Crear las filas de las fotos nuevas, con su fecha, su nota y «en flor»,
//    en posiciones libres, todas en una petición (una sola sentencia: todas o
//    ninguna). Sus archivos ya existen (paso 1): nunca hay una fila que cite
//    un archivo que no está. Si la ruta ya tiene fila (un intento anterior la
//    creó), no se crea otra: no hay duplicados.
// 5. Cambiar la fecha, la nota y «en flor» de las fotos que ya tienen fila,
//    solo si difieren de lo leído en el paso 0. PostgREST no deja poner un
//    valor distinto en cada fila de un PATCH (y un upsert escribiría
//    plant_id, user_id y las rutas, que la API no deja cambiar), así que va
//    una petición por foto; las que solo cambian la fecha o la nota salen a
//    la vez que el paso 3 (o el 4, si no hay nada que quitar).
// 6. Poner el orden final de una vez (reorder_plant_photos): la primera es
//    la principal y la base la copia a la planta. Si ya está en ese orden, no
//    se envía nada.
// 7. Releer la planta (con la principal y el número de fotos nuevos) para la
//    colección y la tarjeta de «Mi colección», a la vez que el paso 8.
// 8. Al final, borrar los archivos que ya no cita ninguna fila: los de las
//    fotos quitadas y los subidos que no llegaron a tener fila (una foto
//    nueva que se quitó entre dos intentos). Si falla, quedan para el script
//    de limpieza (npm run fotos:huerfanas): un archivo sin fila no lo ve
//    nadie.
//
// Escrituras a la vez (#285): dos sentencias que disparan sync_plant sobre
// la misma planta no pueden ir a la vez. El disparador lee la principal con
// la foto de su propia sentencia y escribe plants después; si otra
// transacción cambia plant_photos entre tanto, la que confirma la última
// puede dejar en plants una principal vieja (incluso la de una foto quitada,
// cuyos archivos se borran en el paso 8). Por eso el borrado, la inserción,
// los cambios de «en flor» y el orden van uno detrás de otro, y solo salen a
// la vez las fechas y notas (que no disparan sync_plant) y, al final, la
// relectura de la planta con el borrado de archivos.
//
// Si un paso falla, el plan se detiene con PlantEditError (qué paso, por qué
// y, en la subida, qué fotos). Lo editado sigue en la pantalla y «Reintentar»
// vuelve a aplicar el plan desde el paso 0: lo ya hecho se salta, nada se
// duplica y ninguna foto que se conserva se toca hasta el paso 5. Si la
// persona sale sin reintentar, los archivos subidos en el paso 1 que no
// llegaron a tener fila se borran (discardUploads), pero solo cuando el
// intento en curso, si lo hay, ya terminó: mientras siga vivo puede crear la
// fila que los cita, y borrarlos dejaría la foto (y quizá la principal de la
// planta) apuntando a archivos que no existen.

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
  /** Las filas de la planta al empezar el intento (paso 0). */
  | { type: 'rows-read'; rows: readonly StoredPlantPhoto[] }
  /** Se borró la fila de una foto quitada (paso 3): ya no se puede deshacer. */
  | { type: 'row-removed'; id: string }

/** Un paso del plan falló; lo anterior quedó hecho. */
export class PlantEditError extends Error {
  readonly step: PlantEditStep
  /** En la subida: las fotos (key) que no se subieron. */
  readonly failedKeys: readonly string[]
  /** La planta ya no existe (se eliminó): reintentar no sirve. */
  readonly plantGone: boolean

  constructor(
    step: PlantEditStep,
    cause: unknown,
    failedKeys: readonly string[] = [],
    options: { plantGone?: boolean } = {},
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause })
    this.name = 'PlantEditError'
    this.step = step
    this.failedKeys = failedKeys
    this.plantGone = options.plantGone ?? false
  }
}

/** Si un error dice que algo (la planta, una fila) no existe. */
function isNotFound(error: unknown): boolean {
  return (
    (error instanceof PhotoStorageError || error instanceof PlantSaveError) &&
    error.reason === 'not-found'
  )
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

type NewPlannedPhoto = Extract<PlannedPhoto, { kind: 'new' }>
type StoredPlannedPhoto = Extract<PlannedPhoto, { kind: 'stored' }>

const filesOf = (photo: { photoPath: string; thumbnailPath: string }) => [
  photo.photoPath,
  photo.thumbnailPath,
]

/**
 * El intento en curso de cada `uploaded`: mientras siga vivo, discardUploads
 * no borra nada (el intento aún puede crear la fila que cita los archivos).
 */
const liveAttempts = new WeakMap<UploadedPhotos, Promise<unknown>>()

/**
 * Aplica el plan en el orden de arriba. Resuelve con la planta y las fotos
 * como quedaron; rechaza con PlantEditError en el primer paso que falle (en
 * la subida, después de intentar todas las fotos). Para reintentar, se vuelve
 * a llamar con el mismo `uploaded` (y el plan que haya entonces en la
 * pantalla: se concilia con las filas en el paso 0). Al salir bien, `uploaded`
 * queda vacío: lo subido o tiene fila o se borró.
 */
export function applyPlantEdit(
  plan: PlantEditPlan,
  services: PlantEditServices,
  uploaded: UploadedPhotos,
  onEvent: (event: PlantEditEvent) => void = () => undefined,
): Promise<PlantEditResult> {
  const attempt = runPlantEdit(plan, services, uploaded, onEvent)
  liveAttempts.set(uploaded, attempt)
  const settle = () => {
    if (liveAttempts.get(uploaded) === attempt) liveAttempts.delete(uploaded)
  }
  attempt.then(settle, settle)
  return attempt
}

async function runPlantEdit(
  plan: PlantEditPlan,
  services: PlantEditServices,
  uploaded: UploadedPhotos,
  onEvent: (event: PlantEditEvent) => void,
): Promise<PlantEditResult> {
  const { userId } = plan
  const { rows: rowsApi, storage } = services
  const plantId = plan.plantId.toLowerCase()

  /** Si la planta ya no existe. Se pregunta solo tras un «no existe». */
  const plantIsGone = async () => {
    try {
      await rowsApi.readPlant(plantId, userId)
      return false
    } catch (error) {
      return isNotFound(error)
    }
  }
  /** El error de un paso; si dice «no existe», se mira si es la planta. */
  const failure = async (
    step: PlantEditStep,
    cause: unknown,
  ): Promise<PlantEditError> =>
    new PlantEditError(step, cause, [], {
      plantGone: isNotFound(cause) && (await plantIsGone()),
    })

  // 0. Lo que hay ahora.
  let rows: StoredPlantPhoto[]
  try {
    rows = await rowsApi.list(plantId, userId)
  } catch (error) {
    throw await failure('read', photoStorageErrorFrom(error))
  }
  onEvent({ type: 'rows-read', rows: [...rows] })
  const rowWithPath = (path: string) =>
    rows.find((row) => row.photoPath === path)

  // Conciliar el plan con las filas leídas.
  const missing = plan.photos.filter(
    (photo): photo is StoredPlannedPhoto =>
      photo.kind === 'stored' &&
      !rows.some((row) => row.id === photo.stored.id),
  )
  if (missing.length > 0 && (await plantIsGone())) {
    throw new PlantEditError('read', new PhotoStorageError('not-found'), [], {
      plantGone: true,
    })
  }
  const photos = plan.photos.filter(
    (photo) => photo.kind === 'new' || !missing.includes(photo),
  )
  const newPhotos = photos.filter(
    (photo): photo is NewPlannedPhoto => photo.kind === 'new',
  )
  const planned = new Set(newPhotos.map((photo) => photo.files))
  // Las fotos quitadas: las guardadas del plan y las nuevas que un intento
  // anterior subió (y quizá dejó con fila) y que ya no están en el plan.
  const removals = [
    ...plan.removed.map((photo) => photo.id),
    ...[...uploaded].flatMap(([files, paths]) => {
      const row = planned.has(files) ? undefined : rowWithPath(paths.photoPath)
      return row ? [row.id] : []
    }),
  ]

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
      const failed = photoStorageErrorFrom(error)
      firstUploadError ??= failed
      failedKeys.push(photo.key)
      onEvent({ type: 'upload-failed', key: photo.key, error: failed })
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
      throw await failure('data', plantSaveErrorFrom(error))
    }
    onEvent({ type: 'data-saved', plant })
  }

  let photosWritten = false
  const written = () => {
    if (!photosWritten) onEvent({ type: 'photos-written' })
    photosWritten = true
  }

  // Cada foto del plan con su fila.
  const rowOf = (photo: PlannedPhoto): StoredPlantPhoto | undefined =>
    photo.kind === 'stored'
      ? rows.find((row) => row.id === photo.stored.id)
      : rowWithPath(
          (uploaded.get(photo.files) ?? pathsOf(photo.files, userId, plantId))
            .photoPath,
        )

  // 5 (antes de escribir): la fecha, la nota y «en flor» que cambian en las
  // filas que ya existen. Las que no tocan «en flor» no disparan la copia de
  // la principal a la planta (sync_plant solo mira posición, rutas e
  // in_bloom), así que pueden ir a la vez que el borrado o la inserción; las
  // que lo tocan van después, de una en una (ver «Escrituras a la vez»).
  const detailUpdates = photos.flatMap((photo) => {
    const row = rowOf(photo)
    if (!row) return []
    const changes = detailChanges(row, photo.details)
    return Object.keys(changes).length === 0 ? [] : [{ row, changes }]
  })
  const quietUpdates = detailUpdates.filter(
    ({ changes }) => changes.inBloom === undefined,
  )
  const bloomUpdates = detailUpdates.filter(
    ({ changes }) => changes.inBloom !== undefined,
  )
  const runUpdate = async ({
    row,
    changes,
  }: (typeof detailUpdates)[number]) => {
    const updated = await rowsApi.update(row.id, userId, changes)
    rows = rows.map((item) => (item.id === updated.id ? updated : item))
    written()
  }
  /** Las de fecha y nota, en el primer viaje que escriba (o solas). */
  let pendingQuiet: typeof quietUpdates | null = quietUpdates
  const withQuiet = () => {
    const tasks = (pendingQuiet ?? []).map(runUpdate)
    pendingQuiet = null
    return tasks
  }
  /**
   * El primer fallo de una fecha o una nota: se lanza después de crear las
   * filas nuevas, como si el paso 5 fuera detrás del 4 (lo de antes queda
   * hecho, igual que sin ir a la vez).
   */
  let detailsFailure: unknown = null
  /** Espera un viaje: lanza el fallo de su paso y aparta el de las notas. */
  const settle = async (
    step: PlantEditStep,
    main: Promise<unknown> | null,
    others: Promise<unknown>[],
    mapError: (error: unknown) => unknown = photoStorageErrorFrom,
  ) => {
    const [mainResult, ...otherResults] = await Promise.allSettled([
      main ?? Promise.resolve(),
      ...others,
    ])
    const rejected = otherResults.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    if (rejected) detailsFailure ??= rejected.reason
    if (mainResult?.status === 'rejected') {
      throw await failure(step, mapError(mainResult.reason))
    }
  }

  // 3. Filas de las fotos quitadas, en una sola petición (los archivos, al
  // final).
  const toRemove = removals.filter((id) => rows.some((row) => row.id === id))
  if (toRemove.length > 0) {
    const removing = rowsApi.removeMany(toRemove, userId).then(() => {
      rows = rows.filter((row) => !toRemove.includes(row.id))
      written()
      for (const id of toRemove) onEvent({ type: 'row-removed', id })
    })
    await settle('remove', removing, withQuiet())
  }

  // 4. Filas de las fotos nuevas, en una sola petición (todas o ninguna).
  const occupied = new Set(rows.map((row) => row.position))
  const inserts: PlantPhotoRowInsert[] = []
  for (const photo of newPhotos) {
    const paths =
      uploaded.get(photo.files) ?? pathsOf(photo.files, userId, plantId)
    if (rowWithPath(paths.photoPath)) continue
    const position = freePosition(occupied)
    if (position === null) {
      throw new PlantEditError(
        'insert',
        new PhotoStorageError('too-many-photos'),
      )
    }
    occupied.add(position)
    inserts.push({
      plantId,
      userId,
      photoPath: paths.photoPath,
      thumbnailPath: paths.thumbnailPath,
      inBloom: photo.details.inBloom,
      takenAt: photo.details.takenAt,
      note: photo.details.note,
      position,
    })
  }
  const inserting =
    inserts.length > 0
      ? rowsApi.insertMany(inserts).then((created) => {
          rows = [...rows, ...created].sort(byPosition)
          written()
        })
      : null
  await settle('insert', inserting, withQuiet(), (error) => {
    const failed = photoStorageErrorFrom(error)
    return failed.reason === 'position-taken'
      ? new PhotoStorageError('too-many-photos', { cause: error })
      : failed
  })

  // 5. Fecha, nota y «en flor»: cada foto del plan tiene ya su fila; las que
  // cambian «en flor», de una en una.
  if (detailsFailure !== null) {
    throw await failure('details', photoStorageErrorFrom(detailsFailure))
  }
  if (photos.some((photo) => !rowOf(photo))) {
    // La fila desapareció durante el intento (otro dispositivo): el
    // reintento lo concilia, salvo que se haya ido la planta entera.
    const gone = await plantIsGone()
    throw new PlantEditError(
      'details',
      new PhotoStorageError(gone ? 'not-found' : 'failed'),
      [],
      { plantGone: gone },
    )
  }
  for (const update of bloomUpdates) {
    try {
      await runUpdate(update)
    } catch (error) {
      throw await failure('details', photoStorageErrorFrom(error))
    }
  }

  // 6. El orden final (la primera es la principal). Las filas que el plan no
  // conoce (de otro dispositivo) se conservan, detrás.
  const sorted = [...rows].sort(byPosition)
  const mine = photos.map((photo) => rowOf(photo)?.id ?? '')
  const order = [
    ...mine,
    ...sorted.map((row) => row.id).filter((id) => !mine.includes(id)),
  ]
  const current = sorted.map((row) => row.id)
  if (current.length !== order.length) {
    // Otra foto se añadió o se quitó durante el intento: el reintento lo
    // concilia.
    throw new PlantEditError('order', new PhotoStorageError('position-taken'))
  }
  if (order.some((id, index) => id !== current[index])) {
    try {
      rows = await rowsApi.reorder(plantId, userId, order)
    } catch (error) {
      throw await failure('order', photoStorageErrorFrom(error))
    }
    written()
  }

  // 7 y 8, a la vez: las filas ya son las finales.
  // 7. La planta con la principal y el número de fotos nuevos. La respuesta
  // del paso 2 no sirve: salió antes de escribir las fotos, y la principal
  // y photo_count los pone la base desde plant_photos.
  const reading = photosWritten
    ? rowsApi.readPlant(plantId, userId).catch(() => null)
    : Promise.resolve(null)
  // 8. Los archivos que ya no cita ninguna fila: los de las fotos quitadas
  // (también las que quitó un intento anterior u otro dispositivo) y los
  // subidos sin fila (fotos nuevas que se quitaron entre dos intentos).
  const cited = new Set(rows.flatMap(filesOf))
  const unused = new Set(
    [
      ...plan.removed.flatMap(filesOf),
      ...missing.flatMap((photo) => filesOf(photo.stored)),
      ...[...uploaded.values()].flatMap(filesOf),
    ].filter((path) => !cited.has(path)),
  )
  uploaded.clear()
  const [reread, leftovers] = await Promise.all([
    reading,
    removeQuietly(storage, [...unused]),
  ])
  // Si la relectura falla, la base ya tiene la principal; la colección la
  // verá en la próxima lectura.
  if (reread) plant = reread

  return { plant, photos: [...rows].sort(byPosition), leftovers }
}

/**
 * Al salir sin terminar de guardar: borra los archivos subidos que no
 * llegaron a tener fila y los de las fotos quitadas (`removed`) cuya fila ya
 * borró un intento. Si hay un intento en curso con el mismo `uploaded`,
 * espera a que termine: hasta entonces puede crear la fila que cita esos
 * archivos. Lee las filas para no tocar ninguno que una fila cite (una foto
 * quitada que aún tiene su fila la conserva entera); si no puede leerlas, no
 * borra nada (los recogerá la limpieza).
 */
export async function discardUploads(
  uploaded: UploadedPhotos,
  { userId, plantId }: { userId: string; plantId: string },
  services: Pick<PlantEditServices, 'rows' | 'storage'>,
  removed: readonly StoredPlantPhoto[] = [],
): Promise<void> {
  await liveAttempts.get(uploaded)?.then(
    () => undefined,
    () => undefined,
  )
  if (uploaded.size === 0 && removed.length === 0) return
  let rows: StoredPlantPhoto[]
  try {
    rows = await services.rows.list(plantId.toLowerCase(), userId)
  } catch {
    return
  }
  const cited = new Set(rows.flatMap(filesOf))
  const paths = [...uploaded.values(), ...removed]
    .flatMap(filesOf)
    .filter((path) => !cited.has(path))
  uploaded.clear()
  await removeQuietly(services.storage, paths)
}
