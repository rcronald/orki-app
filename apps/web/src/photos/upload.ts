import {
  newPhotoVersion,
  plantPhotoPaths,
  type PlantPhotoPaths,
  type PlantPhotoType,
} from './paths.ts'
import {
  appPhotoStorage,
  PhotoStorageError,
  photoStorageErrorFrom,
  type PhotoStorage,
} from './storage.ts'

// Subida de la foto y la miniatura de una planta (#82). La usa la galería
// (gallery.ts, #219), que crea la fila de cada foto después de subir sus dos
// archivos. Las antiguas replacePlantPhoto y removePlantPhoto (una sola foto
// por planta) se retiraron con el formulario con galería (#221).
//
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
