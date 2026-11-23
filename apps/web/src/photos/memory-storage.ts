import { PhotoStorageError, type PhotoStorage } from './storage.ts'

// Bucket en memoria con la misma interfaz que el de Supabase. Lo usan la
// página de muestra (subida simulada, sin sesión ni configuración) y las
// pruebas. Puede tardar y fallar a voluntad.

export interface MemoryPhotoStorage extends PhotoStorage {
  /** Objetos guardados, por ruta. */
  readonly objects: Map<string, { blob: Blob; contentType: string }>
  /**
   * Si está definida, se llama con la ruta de cada subida: si devuelve un
   * error, esa subida falla con él; con null, sube.
   */
  failUploads: ((path: string) => PhotoStorageError | null) | undefined
  /** Milisegundos que tarda cada operación. */
  delayMs: number
}

function wait(ms: number) {
  return ms > 0
    ? new Promise<void>((resolve) => setTimeout(resolve, ms))
    : Promise.resolve()
}

export function createMemoryPhotoStorage(delayMs = 0): MemoryPhotoStorage {
  const objects = new Map<string, { blob: Blob; contentType: string }>()
  const storage: MemoryPhotoStorage = {
    objects,
    failUploads: undefined,
    delayMs,
    async upload(path, blob, { contentType }) {
      await wait(storage.delayMs)
      const failure = storage.failUploads?.(path)
      if (failure) throw failure
      objects.set(path, { blob, contentType })
    },
    async remove(paths) {
      await wait(storage.delayMs)
      for (const path of paths) objects.delete(path)
    },
    // Como Storage: solo el primer nivel de la carpeta (los archivos de una
    // subcarpeta, como log/, no salen; ver storage.ts).
    async list(folder) {
      await wait(storage.delayMs)
      const prefix = folder.endsWith('/') ? folder : `${folder}/`
      return [...objects.keys()].filter(
        (path) =>
          path.startsWith(prefix) && !path.slice(prefix.length).includes('/'),
      )
    },
    async download(path, options = {}) {
      await wait(storage.delayMs)
      if (options.signal?.aborted) throw new PhotoStorageError('aborted')
      const object = objects.get(path)
      if (!object) throw new PhotoStorageError('not-found')
      return object.blob
    },
  }
  return storage
}
