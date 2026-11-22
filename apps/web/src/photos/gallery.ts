import type { CollectionPlant } from '../collection/model.ts'
import { MAX_PLANT_PHOTOS, plantPhotoPaths } from './paths.ts'
import {
  appPlantPhotoRows,
  byPosition,
  type PlantPhotoRows,
  type StoredPlantPhoto,
} from './photo-rows.ts'
import {
  appPhotoStorage,
  PhotoStorageError,
  photoStorageErrorFrom,
  type PhotoStorage,
} from './storage.ts'
import {
  photoVersionFor,
  removeQuietly,
  uploadPhotoFiles,
  type PhotoFiles,
  type UploadProgress,
} from './upload.ts'

// Galería de una planta: varias fotos (de 0 a 6) en public.plant_photos (#219,
// parte de #218). Capa de datos para el formulario con galería (#221): subir
// varias fotos ya preparadas, añadir a una planta que ya tiene, quitar una y
// leerlas en orden. No cambia ninguna pantalla; replacePlantPhoto y
// removePlantPhoto (upload.ts) siguen funcionando con el formulario de una
// foto, porque la base copia lo que escriben en plants a la foto principal.
//
// Orden de las operaciones al subir una foto: primero los dos archivos y
// después la fila.
// - Una fila sin archivo sería una foto rota: la base la copiaría a plants si
//   es la principal y la tarjeta del inventario no podría mostrarla. Un
//   archivo sin fila, en cambio, no lo ve nadie y lo encuentra el script de
//   limpieza (npm run fotos:huerfanas), que da por huérfano todo archivo que no
//   citan plant_photos ni plants y que tenga más de 24 horas (así no se lleva
//   una subida en curso, cuya fila aún no existe).
// - Si falla un archivo, se borran los dos (uploadPhotoFiles) y no se crea la
//   fila. Si la base rechaza la fila, se borran los dos archivos. Si no se sabe
//   si la fila llegó (`uncertain`: la red cayó sin respuesta), los archivos se
//   quedan, porque quizá ya los cita; el reintento lo resuelve. Si ese borrado
//   compensatorio falla, el archivo queda sin fila y lo recoge el script.
//
// Reintento sin duplicados: cada foto preparada tiene una versión fija
// (photoVersionFor), así que sus rutas son las mismas en cada intento. Antes
// de subir se leen las filas de la planta: una foto cuya ruta ya está en una
// fila se da por guardada (no se sube ni se crea otra fila); si los archivos
// ya estaban en el bucket, Storage responde 409 y se dan por subidos.
//
// Posiciones: la de cada foto se decide la primera vez que se intenta y se
// recuerda (por la foto preparada, como la versión). Reintentar la vuelve a
// usar si sigue libre, así una foto que falló a mitad de un registro conserva
// su lugar entre las demás. Una foto nueva va a la primera posición libre
// después de la última ocupada; si ya no queda ninguna al final, a la primera
// libre. El máximo se comprueba antes de subir, contando las ya guardadas.

const plannedPositions = new WeakMap<PhotoFiles, number>()

/** Una foto para subir: la foto preparada (los dos Blob) y sus datos. */
export interface NewPlantPhoto {
  files: PhotoFiles
  inBloom?: boolean
  /** Fecha de la foto (AAAA-MM-DD), opcional. */
  takenAt?: string | null
  /** Nota, opcional (no en blanco, hasta 500 caracteres; lo valida la base). */
  note?: string | null
}

/** Resultado de cada foto, en el orden en que se pasaron. */
export type PlantPhotoUploadResult =
  | {
      status: 'uploaded'
      photo: StoredPlantPhoto
      /** true si ya estaba guardada de un intento anterior (no se subió otra vez). */
      reused: boolean
    }
  | { status: 'failed'; error: PhotoStorageError }
  /** No se intentó: se canceló antes de llegar a ella. */
  | { status: 'skipped'; reason: 'aborted' }

/** Progreso: qué foto, en qué paso, y cuántas van terminadas de cuántas. */
export type PlantPhotosProgress = {
  index: number
  completed: number
  total: number
} & (
  | { step: 'uploading'; files: UploadProgress }
  | { step: 'saving' }
  | { step: 'done'; result: PlantPhotoUploadResult }
)

export interface PlantGalleryOptions {
  /** Dueño: el id de usuario de Clerk. */
  userId: string
  /** plants.id de una planta que ya existe. */
  plantId: string
  storage?: PhotoStorage
  rows?: PlantPhotoRows
  /**
   * Si la foto principal cambia, se vuelve a leer la planta (con la principal
   * ya copiada a sus columnas) y se pasa aquí (useCollection().upsertPlant).
   */
  onPlantUpdated?: (plant: CollectionPlant) => void
}

export interface UploadPlantPhotosOptions extends PlantGalleryOptions {
  /**
   * Cancela: la foto en curso deja de esperarse (lo que llegue a subirse se
   * borra) y las siguientes no se intentan. Una fila que ya salió hacia la
   * base se espera.
   */
  signal?: AbortSignal
  onProgress?: (progress: PlantPhotosProgress) => void
}

export interface UploadPlantPhotosResult {
  /** Uno por foto pasada, en el mismo orden. */
  results: PlantPhotoUploadResult[]
  /** Todas las fotos de la planta tras la operación, en orden. */
  photos: StoredPlantPhoto[]
  /** true si todas quedaron guardadas. */
  complete: boolean
  /** La planta releída si cambió la principal; null si no hizo falta o falló. */
  plant: CollectionPlant | null
}

function pathsOf(files: PhotoFiles, userId: string, plantId: string) {
  return plantPhotoPaths({
    userId,
    plantId,
    version: photoVersionFor(files),
    photoType: files.photo.type,
    thumbnailType: files.thumbnail.type,
  })
}

/** Posición para una foto según la regla de arriba; null si no queda ninguna. */
function choosePosition(
  occupied: ReadonlySet<number>,
  planned: number | undefined,
): number | null {
  if (planned !== undefined && !occupied.has(planned)) return planned
  const last = Math.max(-1, ...occupied)
  for (let position = last + 1; position < MAX_PLANT_PHOTOS; position += 1) {
    if (!occupied.has(position)) return position
  }
  for (let position = 0; position < MAX_PLANT_PHOTOS; position += 1) {
    if (!occupied.has(position)) return position
  }
  return null
}

async function refreshPlant(
  rows: PlantPhotoRows,
  plantId: string,
  userId: string,
  onPlantUpdated: ((plant: CollectionPlant) => void) | undefined,
): Promise<CollectionPlant | null> {
  if (!onPlantUpdated) return null
  try {
    const plant = await rows.readPlant(plantId, userId)
    onPlantUpdated(plant)
    return plant
  } catch {
    // La base ya tiene la principal; la colección la verá en la próxima lectura.
    return null
  }
}

/**
 * Sube varias fotos a una planta que ya existe y crea sus filas en
 * plant_photos, una detrás de otra y en el orden dado. Sirve al registrar
 * (planta sin fotos: posiciones 0, 1, 2...) y al editar (las nuevas van
 * detrás de las que ya tiene). Para reintentar, se vuelve a llamar con las
 * mismas fotos preparadas (todas o solo las que faltan): las ya guardadas no
 * se duplican.
 *
 * Rechaza con PhotoStorageError sin subir nada si no puede leer las fotos de
 * la planta, si se cancela antes de empezar o si las fotos nuevas no caben
 * (`too-many-photos`, contando las ya guardadas). Si no, resuelve siempre con
 * el resultado de cada foto: un fallo no detiene las siguientes (salvo la
 * cancelación) y las ya guardadas se conservan.
 */
export async function uploadPlantPhotos(
  photos: readonly NewPlantPhoto[],
  {
    userId,
    plantId: rawPlantId,
    storage = appPhotoStorage(),
    rows = appPlantPhotoRows(),
    signal,
    onProgress,
    onPlantUpdated,
  }: UploadPlantPhotosOptions,
): Promise<UploadPlantPhotosResult> {
  const plantId = rawPlantId.toLowerCase()
  if (signal?.aborted) {
    throw new PhotoStorageError('aborted', { cause: signal.reason })
  }
  const before = await rows.list(plantId, userId)
  const saved = [...before]
  const mainBefore = before[0]?.id ?? null

  const results: (PlantPhotoUploadResult | undefined)[] = photos.map(
    () => undefined,
  )
  let completed = 0
  const finish = (index: number, result: PlantPhotoUploadResult) => {
    results[index] = result
    completed += 1
    onProgress?.({
      index,
      completed,
      total: photos.length,
      step: 'done',
      result,
    })
  }

  // Las ya guardadas (reintento): su ruta está en una fila.
  const pending: number[] = []
  if (new Set(photos.map(({ files }) => files)).size !== photos.length) {
    // Error de quien llama: subiría dos filas con los mismos archivos.
    throw new Error('La misma foto preparada aparece dos veces.')
  }
  photos.forEach(({ files }, index) => {
    const { photoPath } = pathsOf(files, userId, plantId)
    const existing = saved.find((photo) => photo.photoPath === photoPath)
    if (existing) {
      finish(index, { status: 'uploaded', photo: existing, reused: true })
    } else {
      pending.push(index)
    }
  })
  if (saved.length + pending.length > MAX_PLANT_PHOTOS) {
    throw new PhotoStorageError('too-many-photos')
  }

  // Posiciones de todas las pendientes, antes de subir ninguna.
  const occupied = new Set(saved.map((photo) => photo.position))
  for (const index of pending) {
    const { files } = photos[index]
    const position = choosePosition(occupied, plannedPositions.get(files))
    // Siempre hay sitio: se comprobó el máximo arriba.
    if (position === null) throw new PhotoStorageError('too-many-photos')
    occupied.add(position)
    plannedPositions.set(files, position)
  }

  const uploadOne = async (
    photo: NewPlantPhoto,
    index: number,
  ): Promise<PlantPhotoUploadResult> => {
    const { files } = photo
    let paths
    try {
      paths = await uploadPhotoFiles(files, {
        userId,
        plantId,
        storage,
        signal,
        onProgress: (progress) =>
          onProgress?.({
            index,
            completed,
            total: photos.length,
            step: 'uploading',
            files: progress,
          }),
      })
    } catch (error) {
      return { status: 'failed', error: photoStorageErrorFrom(error) }
    }
    const fresh = [paths.photoPath, paths.thumbnailPath]
    if (signal?.aborted) {
      await removeQuietly(storage, fresh)
      return {
        status: 'failed',
        error: new PhotoStorageError('aborted', { cause: signal.reason }),
      }
    }
    onProgress?.({ index, completed, total: photos.length, step: 'saving' })

    const insert = (position: number) =>
      rows.insert({
        plantId,
        userId,
        photoPath: paths.photoPath,
        thumbnailPath: paths.thumbnailPath,
        inBloom: photo.inBloom ?? false,
        takenAt: photo.takenAt ?? null,
        note: photo.note ?? null,
        position,
      })

    let position = plannedPositions.get(files) ?? 0
    for (let attempt = 0; ; attempt += 1) {
      try {
        const stored = await insert(position)
        return { status: 'uploaded', photo: stored, reused: false }
      } catch (error) {
        const failure = photoStorageErrorFrom(error)
        if (failure.reason === 'position-taken' && attempt === 0) {
          // Otra foto (otro dispositivo) ocupó la posición: se busca otra.
          let current: StoredPlantPhoto[]
          try {
            current = await rows.list(plantId, userId)
          } catch (listError) {
            await removeQuietly(storage, fresh)
            return { status: 'failed', error: photoStorageErrorFrom(listError) }
          }
          const taken = new Set(current.map((row) => row.position))
          for (const other of pending) {
            const planned = plannedPositions.get(photos[other].files)
            if (other > index && planned !== undefined) taken.add(planned)
          }
          const next = choosePosition(taken, undefined)
          if (next !== null) {
            position = next
            plannedPositions.set(files, next)
            continue
          }
          await removeQuietly(storage, fresh)
          return {
            status: 'failed',
            error: new PhotoStorageError('too-many-photos', { cause: error }),
          }
        }
        // Sin respuesta, la fila quizá existe y cita los archivos: se quedan.
        if (!failure.uncertain) await removeQuietly(storage, fresh)
        const reason =
          failure.reason === 'position-taken' ? 'too-many-photos' : null
        return {
          status: 'failed',
          error: reason
            ? new PhotoStorageError(reason, { cause: error })
            : failure,
        }
      }
    }
  }

  let cancelled = false
  for (const index of pending) {
    if (cancelled || signal?.aborted) {
      cancelled = true
      finish(index, { status: 'skipped', reason: 'aborted' })
      continue
    }
    const result = await uploadOne(photos[index], index)
    if (result.status === 'uploaded') {
      saved.push(result.photo)
      saved.sort(byPosition)
    }
    if (result.status === 'failed' && result.error.reason === 'aborted') {
      cancelled = true
    }
    finish(index, result)
  }

  const finalResults = results as PlantPhotoUploadResult[]
  const mainAfter = saved[0]?.id ?? null
  const plant =
    mainAfter !== mainBefore
      ? await refreshPlant(rows, plantId, userId, onPlantUpdated)
      : null
  return {
    results: finalResults,
    photos: saved,
    complete: finalResults.every((result) => result.status === 'uploaded'),
    plant,
  }
}

/** Lee las fotos de una planta en orden (la principal primero). */
export function listPlantPhotos({
  userId,
  plantId,
  rows = appPlantPhotoRows(),
}: Pick<PlantGalleryOptions, 'userId' | 'plantId' | 'rows'>): Promise<
  StoredPlantPhoto[]
> {
  return rows.list(plantId.toLowerCase(), userId)
}

export interface RemoveStoredPlantPhotoOptions extends PlantGalleryOptions {
  /** La foto que se quita, tal como se leyó. */
  photo: Pick<StoredPlantPhoto, 'id' | 'photoPath' | 'thumbnailPath'>
}

export interface RemoveStoredPlantPhotoResult {
  /**
   * false si la fila se borró pero sus archivos no (sin conexión al final):
   * quedan para el script de limpieza.
   */
  photosDeleted: boolean
  /** Rutas que no se pudieron borrar. */
  leftovers: string[]
  /** La planta releída (con la principal nueva); null sin onPlantUpdated o si falló. */
  plant: CollectionPlant | null
}

/**
 * Quita una foto guardada: 1) borra su fila (si era la principal, la base
 * promueve la siguiente y la copia a plants); 2) relee la planta para la
 * colección (onPlantUpdated); 3) borra sus dos archivos. Si falla 1, no se
 * toca nada y rechaza con PhotoStorageError. Si la fila ya no existía (un
 * intento anterior llegó sin respuesta), sigue con los archivos. Si falla 3,
 * la foto ya no está en la planta y devuelve photosDeleted: false.
 */
export async function removeStoredPlantPhoto({
  userId,
  plantId,
  photo,
  storage = appPhotoStorage(),
  rows = appPlantPhotoRows(),
  onPlantUpdated,
}: RemoveStoredPlantPhotoOptions): Promise<RemoveStoredPlantPhotoResult> {
  const deleted = await rows.remove(photo.id, userId)
  const plant = await refreshPlant(
    rows,
    plantId.toLowerCase(),
    userId,
    onPlantUpdated,
  )
  // Las rutas de la fila borrada (por si cambiaron desde que se leyó) y las
  // que se pasaron.
  const paths = [
    ...new Set(
      [
        deleted?.photoPath,
        deleted?.thumbnailPath,
        photo.photoPath,
        photo.thumbnailPath,
      ].filter(
        (path): path is string => typeof path === 'string' && path !== '',
      ),
    ),
  ]
  const leftovers = await removeQuietly(storage, paths)
  return { photosDeleted: leftovers.length === 0, leftovers, plant }
}
