import type { CollectionPlant } from '../collection/model.ts'
import {
  newPhotoVersion,
  plantPhotoPaths,
  type PlantPhotoPaths,
  type PlantPhotoType,
} from './paths.ts'
import { appPlantPhotoRecords, type PlantPhotoRecords } from './plant-record.ts'
import {
  appPhotoStorage,
  PhotoStorageError,
  photoStorageErrorFrom,
  type PhotoStorage,
} from './storage.ts'

// Subida de la foto y la miniatura de una planta (#82) y ciclo completo de
// reemplazar o quitar la foto de una planta que ya existe.
//
// Regla de orden: la planta nunca apunta a un archivo que no existe.
//   Reemplazar: 1) subir los dos archivos nuevos (si falla uno, se borra el
//   otro); 2) apuntar la planta a ellos; 3) reflejarlo en la colección;
//   4) borrar los anteriores.
//   Quitar: 1) poner las rutas de la planta a null; 2) reflejarlo; 3) borrar
//   los archivos.
// Si algo falla, lo peor que queda es un archivo sin planta (un huérfano),
// que el script de limpieza encuentra (scripts/fotos-huerfanas.mjs), nunca
// una planta con la foto rota.

/** Lo que hace falta subir: la foto y la miniatura ya preparadas (ProcessedPhoto). */
export interface PhotoFiles {
  photo: { blob: Blob; type: PlantPhotoType }
  thumbnail: { blob: Blob; type: PlantPhotoType }
}

/** Progreso de una subida: archivos y bytes terminados de los dos. */
export interface UploadProgress {
  filesDone: number
  filesTotal: number
  bytesDone: number
  bytesTotal: number
}

// Una versión por foto preparada: reintentar con el mismo objeto sube a las
// mismas rutas, y si un intento anterior llegó a guardar un archivo aunque se
// perdiera la respuesta, Storage responde 409 y se da por subido (storage.ts).
const versions = new WeakMap<PhotoFiles, string>()

/** Versión de las rutas de esta foto (la misma en cada reintento). */
export function photoVersionFor(files: PhotoFiles): string {
  let version = versions.get(files)
  if (version === undefined) {
    version = newPhotoVersion()
    versions.set(files, version)
  }
  return version
}

function abortedError(signal: AbortSignal): PhotoStorageError {
  return new PhotoStorageError('aborted', { cause: signal.reason })
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw abortedError(signal)
}

/** Espera `promise` o rechaza con "aborted" en cuanto se cancele. */
function untilAborted<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return promise
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortedError(signal))
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(photoStorageErrorFrom(error))
      },
    )
  })
}

/** Borra sin fallar; devuelve las rutas que no se pudieron borrar. */
export async function removeQuietly(
  storage: PhotoStorage,
  paths: readonly string[],
): Promise<string[]> {
  if (paths.length === 0) return []
  try {
    await storage.remove(paths)
    return []
  } catch {
    return [...paths]
  }
}

export interface UploadPhotoFilesOptions {
  /** Dueño: el id de usuario de Clerk (primer segmento de la ruta). */
  userId: string
  /** plants.id; puede generarse antes de insertar la planta. */
  plantId: string
  storage?: PhotoStorage
  /**
   * Cancela. supabase-js no deja abortar una subida en curso: se deja de
   * esperar enseguida y lo que llegue a subirse se borra al terminar.
   */
  signal?: AbortSignal
  onProgress?: (progress: UploadProgress) => void
  /** Versión de las rutas; por defecto, photoVersionFor(files). */
  version?: string
}

/**
 * Sube la foto y la miniatura a la vez, con la convención de rutas, su tipo
 * de contenido y caché de un año. Devuelve las rutas para guardarlas en la
 * planta. Si falla o se cancela, borra lo que se haya subido (también lo que
 * quizá llegó aunque no hubo respuesta) y rechaza con PhotoStorageError.
 */
export async function uploadPhotoFiles(
  files: PhotoFiles,
  {
    userId,
    plantId,
    storage = appPhotoStorage(),
    signal,
    onProgress,
    version = photoVersionFor(files),
  }: UploadPhotoFilesOptions,
): Promise<PlantPhotoPaths> {
  throwIfAborted(signal)
  const paths = plantPhotoPaths({
    userId,
    plantId,
    version,
    photoType: files.photo.type,
    thumbnailType: files.thumbnail.type,
  })
  const parts = [
    { path: paths.photoPath, ...files.photo },
    { path: paths.thumbnailPath, ...files.thumbnail },
  ]
  const progress: UploadProgress = {
    filesDone: 0,
    filesTotal: parts.length,
    bytesDone: 0,
    bytesTotal: parts.reduce((total, part) => total + part.blob.size, 0),
  }
  onProgress?.({ ...progress })

  const settled = Promise.allSettled(
    parts.map(async (part) => {
      await storage.upload(part.path, part.blob, { contentType: part.type })
      progress.filesDone += 1
      progress.bytesDone += part.blob.size
      if (!signal?.aborted) onProgress?.({ ...progress })
    }),
  )
  const allPaths = parts.map((part) => part.path)

  let results: PromiseSettledResult<void>[]
  try {
    results = await untilAborted(settled, signal)
  } catch (error) {
    // Cancelada: cuando terminen las subidas en curso, se borra todo. El
    // reintento usará otra versión, para que este borrado tardío no se lleve
    // sus archivos.
    if (versions.get(files) === version) versions.delete(files)
    void settled.then(() => removeQuietly(storage, allPaths))
    throw error
  }

  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  )
  if (failure) {
    // Borrar las dos rutas: la que subió y la que quizá subió sin respuesta
    // (borrar una ruta que no existe no da error).
    await removeQuietly(storage, allPaths)
    throw photoStorageErrorFrom(failure.reason)
  }
  return paths
}

/** Planta tal como la necesita el ciclo de la foto. */
export type PlantPhotoTarget = Pick<
  CollectionPlant,
  'id' | 'photoPath' | 'thumbnailPath'
>

export interface PlantPhotoChangeOptions {
  userId: string
  plant: PlantPhotoTarget
  storage?: PhotoStorage
  records?: PlantPhotoRecords
  signal?: AbortSignal
  /** Refleja la planta actualizada (useCollection().upsertPlant). */
  onPlantUpdated?: (plant: CollectionPlant) => void
}

export interface PlantPhotoChangeResult {
  /** La planta ya actualizada en la base. */
  plant: CollectionPlant
  /**
   * Archivos anteriores que no se pudieron borrar (sin conexión al final). La
   * operación está hecha igualmente; quedan para el script de limpieza.
   */
  leftovers: string[]
}

function previousPaths(
  plant: PlantPhotoTarget,
  keep: PlantPhotoPaths | null,
): string[] {
  const kept = new Set([keep?.photoPath, keep?.thumbnailPath])
  return [plant.photoPath, plant.thumbnailPath].filter(
    (path): path is string => path !== null && path !== '' && !kept.has(path),
  )
}

/**
 * Pone una foto nueva a una planta que ya existe (también la primera, tras
 * registrarla): sube, apunta la planta, lo refleja en la colección y borra
 * la foto anterior. Para reintentar, se vuelve a llamar con el mismo `files`:
 * no hay que elegir ni preparar la foto otra vez.
 *
 * Si falla al apuntar la planta:
 * - con un rechazo seguro (la base respondió que no), se borran los archivos
 *   nuevos y la planta sigue con su foto anterior;
 * - si no se sabe (`uncertain`: la red cayó sin respuesta), los archivos
 *   nuevos se quedan, porque la planta quizá ya apunta a ellos. Reintentar
 *   termina el trabajo; si nadie reintenta, serán huérfanos para el script.
 * La cancelación vale hasta que sale la escritura en la base.
 */
export async function replacePlantPhoto(
  files: PhotoFiles,
  {
    userId,
    plant,
    storage = appPhotoStorage(),
    records = appPlantPhotoRecords(),
    signal,
    onProgress,
    onPlantUpdated,
  }: PlantPhotoChangeOptions & {
    onProgress?: (progress: UploadProgress) => void
  },
): Promise<PlantPhotoChangeResult> {
  const paths = await uploadPhotoFiles(files, {
    userId,
    plantId: plant.id,
    storage,
    signal,
    onProgress,
  })
  const fresh = [paths.photoPath, paths.thumbnailPath]
  if (signal?.aborted) {
    await removeQuietly(storage, fresh)
    throw abortedError(signal)
  }

  let updated: CollectionPlant
  try {
    updated = await records.setPhotoPaths(plant.id, userId, paths)
  } catch (error) {
    const failure = photoStorageErrorFrom(error)
    if (!failure.uncertain) await removeQuietly(storage, fresh)
    throw failure
  }
  onPlantUpdated?.(updated)
  const leftovers = await removeQuietly(storage, previousPaths(plant, paths))
  return { plant: updated, leftovers }
}

/**
 * Quita la foto de una planta: primero la planta deja de apuntar a ella y
 * después se borran los archivos. Si el borrado falla, la planta ya está sin
 * foto y los archivos quedan para el script de limpieza.
 */
export async function removePlantPhoto({
  userId,
  plant,
  storage = appPhotoStorage(),
  records = appPlantPhotoRecords(),
  signal,
  onPlantUpdated,
}: PlantPhotoChangeOptions): Promise<PlantPhotoChangeResult> {
  throwIfAborted(signal)
  const updated = await records.setPhotoPaths(plant.id, userId, null)
  onPlantUpdated?.(updated)
  const leftovers = await removeQuietly(storage, previousPaths(plant, null))
  return { plant: updated, leftovers }
}
