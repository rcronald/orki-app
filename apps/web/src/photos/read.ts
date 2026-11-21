import { parsePhotoPath } from './paths.ts'
import { appPhotoStorage, type PhotoStorage } from './storage.ts'

// Lectura de las fotos del bucket privado (#83).
//
// Decisión: descarga autenticada a Blob, guardada por ruta, en lugar de URL
// firmadas.
// - Una URL firmada (createSignedUrls, una petición para muchas rutas) lleva
//   un token que caduca y cambia en cada firma: la caché HTTP del navegador
//   la trata como otra dirección cada vez, y la caché sin conexión del #18
//   no puede usarla como clave. Habría que volver a firmar al caducar y
//   seguiría bajando la imagen otra vez en cada sesión.
// - La ruta, en cambio, es una clave estable y su contenido nunca cambia
//   (lleva la versión; ver paths.ts). Descargando con el token de la sesión
//   (supabase-js download, una petición por imagen, con AbortSignal) y
//   guardando el Blob por ruta, cada miniatura se baja una sola vez por
//   dispositivo: en memoria mientras dura la pestaña y, las miniaturas, en
//   Cache Storage (persistente, legible sin red y desde el service worker).
// - Coste: firmar en lote ahorra la petición de firma por imagen, pero las
//   imágenes se bajan igual una a una. Con la caché por ruta, en la segunda
//   visita no hay ninguna petición. Las descargas van con un tope de
//   concurrencia para no saturar la red del celular con una lista larga.
// - Memoria: cada imagen se muestra con una URL de objeto que se revoca
//   cuando ninguna pantalla la usa (con un margen, para no volver a crearla
//   al desplazarse arriba y abajo).
// - Las fotos grandes (detalle, #16) se piden bajo demanda y solo se guardan
//   en memoria: no ocupan Cache Storage.
//
// Interfaz para las pantallas: PlantImageSource (acquire / release) y los
// hooks de usePlantImage.ts. El #18 puede cambiar la estrategia (por
// ejemplo, que el service worker sirva la caché) pasando otra fuente o otra
// PersistentImageCache, sin tocar las pantallas.

export type PlantImageKind = 'thumbnail' | 'photo'

/** Caché persistente de imágenes por ruta. */
export interface PersistentImageCache {
  get(path: string): Promise<Blob | undefined>
  put(path: string, blob: Blob): Promise<void>
}

export interface PlantImageSource {
  /**
   * Devuelve una URL de objeto de la imagen de esa ruta, descargándola si
   * hace falta. Cada acquire que se resuelve debe ir seguido de un release.
   * Rechaza si la descarga falla (no se guarda el fallo: el siguiente
   * acquire lo intenta otra vez) o con la señal cancelada.
   */
  acquire(
    path: string,
    kind: PlantImageKind,
    options?: { signal?: AbortSignal },
  ): Promise<string>
  /** Suelta una URL obtenida con acquire. */
  release(path: string): void
  /** Revoca todo lo que hay en memoria (cambio de usuario). */
  clear(): void
}

// Cache Storage ---------------------------------------------------------------

/** Prefijo de las cachés de miniaturas; una por usuario. */
export const THUMBNAIL_CACHE_PREFIX = 'orki-miniaturas-v1:'

/** Clave de una ruta: una dirección del propio origen que nadie sirve. */
function cacheKey(path: string): string {
  return new URL(
    `/_orki/plant-photos/${path.split('/').map(encodeURIComponent).join('/')}`,
    location.origin,
  ).href
}

function hasCacheStorage(): boolean {
  return typeof globalThis.caches !== 'undefined'
}

/**
 * Miniaturas en Cache Storage, en una caché por usuario (el primer segmento
 * de la ruta), para poder borrar las de un usuario al cerrar sesión. Si
 * Cache Storage no existe o falla (modo privado, sin espacio), no guarda
 * nada y la lectura sigue por la red.
 */
export function createCacheStorageImageCache(): PersistentImageCache {
  function cacheName(path: string): string | null {
    const parsed = parsePhotoPath(path)
    return parsed ? `${THUMBNAIL_CACHE_PREFIX}${parsed.userId}` : null
  }
  return {
    async get(path) {
      const name = cacheName(path)
      if (!name || !hasCacheStorage()) return undefined
      try {
        const cache = await caches.open(name)
        const response = await cache.match(cacheKey(path))
        return response ? await response.blob() : undefined
      } catch {
        return undefined
      }
    },
    async put(path, blob) {
      const name = cacheName(path)
      if (!name || !hasCacheStorage()) return
      try {
        const cache = await caches.open(name)
        await cache.put(
          cacheKey(path),
          // Los bytes, no el Blob: así vale con cualquier implementación de
          // Response (en las pruebas, la de Node con el Blob de jsdom).
          new Response(await blob.arrayBuffer(), {
            headers: {
              'Content-Type': blob.type,
              'Cache-Control': 'max-age=31536000, immutable',
            },
          }),
        )
      } catch {
        // Sin espacio o sin permiso: se queda solo en memoria.
      }
    },
  }
}

/**
 * Borra de Cache Storage las miniaturas de todos los usuarios salvo
 * `keepUserId` (null: de todos). Se llama al cambiar de usuario o cerrar
 * sesión: otro usuario del mismo dispositivo nunca ve las del anterior.
 */
export async function deleteThumbnailCaches(
  keepUserId: string | null,
): Promise<void> {
  if (!hasCacheStorage()) return
  try {
    const keep =
      keepUserId === null ? null : `${THUMBNAIL_CACHE_PREFIX}${keepUserId}`
    const names = await caches.keys()
    await Promise.all(
      names
        .filter((name) => name.startsWith(THUMBNAIL_CACHE_PREFIX))
        .filter((name) => name !== keep)
        .map((name) => caches.delete(name)),
    )
  } catch {
    // Sin Cache Storage utilizable no hay nada que borrar.
  }
}

// Fuente con memoria, caché persistente y tope de descargas -------------------

interface Entry {
  promise: Promise<string>
  url: string | undefined
  refs: number
  timer: ReturnType<typeof setTimeout> | undefined
}

export interface PlantImageSourceOptions {
  storage?: PhotoStorage
  /** Caché de miniaturas; null para no persistir. */
  thumbnailCache?: PersistentImageCache | null
  /** Descargas a la vez como mucho. */
  maxConcurrent?: number
  /** Espera antes de revocar una URL que nadie usa, en milisegundos. */
  releaseDelayMs?: number
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Cancelado', 'AbortError')
}

/** Espera `promise` o rechaza en cuanto se cancele (la descarga sigue). */
function untilAborted<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

export function createPlantImageSource({
  storage = appPhotoStorage(),
  thumbnailCache = createCacheStorageImageCache(),
  maxConcurrent = 6,
  releaseDelayMs = 30_000,
}: PlantImageSourceOptions = {}): PlantImageSource {
  const entries = new Map<string, Entry>()
  let active = 0
  const queue: (() => void)[] = []

  async function limited<T>(run: () => Promise<T>): Promise<T> {
    if (active >= maxConcurrent) {
      await new Promise<void>((resolve) => queue.push(resolve))
    }
    active += 1
    try {
      return await run()
    } finally {
      active -= 1
      queue.shift()?.()
    }
  }

  async function fetchBlob(path: string, kind: PlantImageKind): Promise<Blob> {
    const persist = kind === 'thumbnail' ? thumbnailCache : null
    const cached = await persist?.get(path)
    if (cached) return cached
    const blob = await limited(() => storage.download(path))
    if (persist) void persist.put(path, blob)
    return blob
  }

  /** Revoca la URL tras el margen si nadie la vuelve a pedir. */
  function scheduleDrop(path: string, entry: Entry) {
    if (entry.refs > 0 || entry.url === undefined) return
    if (entry.timer !== undefined) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      entry.timer = undefined
      if (entry.refs === 0) drop(path, entry)
    }, releaseDelayMs)
  }

  function drop(path: string, entry: Entry) {
    if (entries.get(path) !== entry) return
    entries.delete(path)
    if (entry.url) URL.revokeObjectURL(entry.url)
  }

  return {
    acquire(path, kind, options = {}) {
      let entry = entries.get(path)
      if (!entry) {
        const created: Entry = {
          promise: Promise.resolve(''),
          url: undefined,
          refs: 0,
          timer: undefined,
        }
        created.promise = fetchBlob(path, kind).then(
          (blob) => {
            const url = URL.createObjectURL(blob)
            if (entries.get(path) === created) {
              created.url = url
              // Quizá ya nadie la espera (se canceló mientras bajaba).
              scheduleDrop(path, created)
            } else {
              // Se limpió mientras se descargaba.
              URL.revokeObjectURL(url)
            }
            return url
          },
          (error: unknown) => {
            // No se guarda el fallo: el próximo acquire reintenta.
            if (entries.get(path) === created) entries.delete(path)
            throw error
          },
        )
        entries.set(path, created)
        entry = created
      }
      const current = entry
      current.refs += 1
      if (current.timer !== undefined) {
        clearTimeout(current.timer)
        current.timer = undefined
      }
      return untilAborted(current.promise, options.signal).catch(
        (error: unknown) => {
          // Cancelado o fallido: esta llamada no retiene la imagen.
          current.refs = Math.max(0, current.refs - 1)
          scheduleDrop(path, current)
          throw error
        },
      )
    },

    release(path) {
      const entry = entries.get(path)
      if (!entry || entry.refs === 0) return
      entry.refs -= 1
      scheduleDrop(path, entry)
    },

    clear() {
      for (const [path, entry] of entries) {
        if (entry.timer !== undefined) clearTimeout(entry.timer)
        drop(path, entry)
      }
    },
  }
}

let shared: PlantImageSource | undefined

/** Fuente de la app (bucket real y Cache Storage), creada al pedirla. */
export function appPlantImageSource(): PlantImageSource {
  shared ??= createPlantImageSource()
  return shared
}

/**
 * Olvida las imágenes de otros usuarios: vacía la memoria de la fuente de la
 * app y borra de Cache Storage las miniaturas que no son de `userId`. Lo
 * llama CollectionProvider al cambiar de usuario y al cerrar sesión.
 */
export function forgetPlantImagesExcept(userId: string | null): void {
  shared?.clear()
  void deleteThumbnailCaches(userId)
}
