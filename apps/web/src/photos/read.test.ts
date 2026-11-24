import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLANT_ID, USER_ID } from '../test/photos.ts'
import { createMemoryPhotoStorage } from './memory-storage.ts'
import {
  createCacheStorageImageCache,
  createPlantImageSource,
  deleteThumbnailCaches,
  THUMBNAIL_CACHE_PREFIX,
  type PersistentImageCache,
} from './read.ts'
import { PhotoStorageError } from './storage.ts'

const THUMB = `${USER_ID}/${PLANT_ID}/thumb-v1.webp`
const PHOTO = `${USER_ID}/${PLANT_ID}/photo-v1.webp`

let urls = 0
const createObjectURL = vi.fn(() => `blob:url-${++urls}`)
const revokeObjectURL = vi.fn()

beforeEach(() => {
  URL.createObjectURL = createObjectURL
  URL.revokeObjectURL = revokeObjectURL
})

afterEach(() => {
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  vi.useRealTimers()
})

function storageWith(...paths: string[]) {
  const storage = createMemoryPhotoStorage()
  for (const path of paths) {
    storage.objects.set(path, {
      blob: new Blob(['x'], { type: 'image/webp' }),
      contentType: 'image/webp',
    })
  }
  return storage
}

function memoryCache(): PersistentImageCache & { blobs: Map<string, Blob> } {
  const blobs = new Map<string, Blob>()
  return {
    blobs,
    get: (path) => Promise.resolve(blobs.get(path)),
    put: (path, blob) => {
      blobs.set(path, blob)
      return Promise.resolve()
    },
  }
}

describe('createPlantImageSource', () => {
  it('descarga una vez por ruta y comparte la URL', async () => {
    const storage = storageWith(THUMB)
    const download = vi.spyOn(storage, 'download')
    const source = createPlantImageSource({ storage, thumbnailCache: null })

    const [first, second] = await Promise.all([
      source.acquire(THUMB, 'thumbnail'),
      source.acquire(THUMB, 'thumbnail'),
    ])
    expect(first).toBe(second)
    expect(await source.acquire(THUMB, 'thumbnail')).toBe(first)
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('guarda las miniaturas en la caché persistente por ruta y las lee de ahí', async () => {
    const cache = memoryCache()
    const storage = storageWith(THUMB)
    const download = vi.spyOn(storage, 'download')

    await createPlantImageSource({ storage, thumbnailCache: cache }).acquire(
      THUMB,
      'thumbnail',
    )
    expect(cache.blobs.has(THUMB)).toBe(true)

    // Otra sesión (otra fuente, memoria vacía): sin red.
    await createPlantImageSource({ storage, thumbnailCache: cache }).acquire(
      THUMB,
      'thumbnail',
    )
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('la foto grande se pide bajo demanda y no ocupa la caché persistente', async () => {
    const cache = memoryCache()
    const storage = storageWith(PHOTO)
    const source = createPlantImageSource({ storage, thumbnailCache: cache })
    await source.acquire(PHOTO, 'photo')
    expect(cache.blobs.size).toBe(0)
  })

  it('no guarda los fallos: el siguiente intento vuelve a descargar', async () => {
    const storage = storageWith(THUMB)
    const download = vi
      .spyOn(storage, 'download')
      .mockRejectedValueOnce(new PhotoStorageError('offline'))
    const source = createPlantImageSource({ storage, thumbnailCache: null })

    await expect(source.acquire(THUMB, 'thumbnail')).rejects.toMatchObject({
      reason: 'offline',
    })
    await expect(source.acquire(THUMB, 'thumbnail')).resolves.toMatch(/^blob:/)
    expect(download).toHaveBeenCalledTimes(2)
  })

  it('revoca la URL un rato después de que nadie la use', async () => {
    vi.useFakeTimers()
    const source = createPlantImageSource({
      storage: storageWith(THUMB),
      thumbnailCache: null,
      releaseDelayMs: 1000,
    })
    const url = await source.acquire(THUMB, 'thumbnail')
    source.release(THUMB)
    vi.advanceTimersByTime(500)
    // Vuelve a pedirse antes del plazo: la misma URL, sin revocar.
    expect(await source.acquire(THUMB, 'thumbnail')).toBe(url)
    source.release(THUMB)
    vi.advanceTimersByTime(1000)
    expect(revokeObjectURL).toHaveBeenCalledWith(url)
  })

  it('limita las descargas a la vez', async () => {
    // Con temporizadores falsos, las descargas siguen en curso hasta que la
    // prueba adelanta el reloj: todas las que vayan a empezar a la vez lo han
    // hecho antes, por cargado que esté el equipo (#295).
    vi.useFakeTimers()
    const paths = Array.from(
      { length: 5 },
      (_, index) => `${USER_ID}/${PLANT_ID}/thumb-v${index}.webp`,
    )
    const storage = storageWith(...paths)
    let running = 0
    let peak = 0
    const original = storage.download.bind(storage)
    vi.spyOn(storage, 'download').mockImplementation(async (path) => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running -= 1
      return original(path)
    })
    const source = createPlantImageSource({
      storage,
      thumbnailCache: null,
      maxConcurrent: 2,
    })
    const pending = Promise.all(
      paths.map((path) => source.acquire(path, 'thumbnail')),
    )
    await vi.runAllTimersAsync()
    await pending
    expect(peak).toBe(2)
  })

  it('una petición cancelada rechaza y no retiene la imagen', async () => {
    const source = createPlantImageSource({
      storage: storageWith(THUMB),
      thumbnailCache: null,
    })
    await expect(
      source.acquire(THUMB, 'thumbnail', { signal: AbortSignal.abort() }),
    ).rejects.toBeDefined()
  })

  it('clear revoca todo lo que hay en memoria', async () => {
    const source = createPlantImageSource({
      storage: storageWith(THUMB),
      thumbnailCache: null,
    })
    const url = await source.acquire(THUMB, 'thumbnail')
    source.clear()
    expect(revokeObjectURL).toHaveBeenCalledWith(url)
  })
})

describe('Cache Storage', () => {
  // Doble mínimo de CacheStorage: cachés con nombre y respuestas por URL.
  function fakeCaches() {
    const stores = new Map<string, Map<string, Response>>()
    const api = {
      stores,
      open: (name: string) => {
        let store = stores.get(name)
        if (!store) {
          store = new Map()
          stores.set(name, store)
        }
        const current = store
        return Promise.resolve({
          match: (key: string) => Promise.resolve(current.get(key)?.clone()),
          put: (key: string, response: Response) => {
            current.set(key, response)
            return Promise.resolve()
          },
          keys: () =>
            Promise.resolve([...current.keys()].map((key) => new Request(key))),
          delete: (request: Request) =>
            Promise.resolve(current.delete(request.url)),
        })
      },
      has: (name: string) => Promise.resolve(stores.has(name)),
      keys: () => Promise.resolve([...stores.keys()]),
      delete: (name: string) => Promise.resolve(stores.delete(name)),
    }
    vi.stubGlobal('caches', api)
    return api
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('guarda cada miniatura con una clave estable por ruta, en la caché de su usuario', async () => {
    const api = fakeCaches()
    const cache = createCacheStorageImageCache()
    await cache.put(THUMB, new Blob(['abc'], { type: 'image/webp' }))

    const store = api.stores.get(`${THUMBNAIL_CACHE_PREFIX}${USER_ID}`)
    expect([...(store?.keys() ?? [])]).toEqual([
      `${location.origin}/_orki/plant-photos/${THUMB}`,
    ])
    const blob = await cache.get(THUMB)
    expect(await blob?.text()).toBe('abc')
    expect(await cache.get(`${USER_ID}/${PLANT_ID}/thumb-otra.webp`)).toBe(
      undefined,
    )
  })

  it('al cambiar de usuario borra las miniaturas de los demás', async () => {
    const api = fakeCaches()
    await api.open(`${THUMBNAIL_CACHE_PREFIX}user_a`)
    await api.open(`${THUMBNAIL_CACHE_PREFIX}user_b`)
    await api.open('workbox-precache-v2')

    await deleteThumbnailCaches('user_b')
    expect([...api.stores.keys()].sort()).toEqual([
      `${THUMBNAIL_CACHE_PREFIX}user_b`,
      'workbox-precache-v2',
    ])
    await deleteThumbnailCaches(null)
    expect([...api.stores.keys()]).toEqual(['workbox-precache-v2'])
  })

  it('sin Cache Storage no falla', async () => {
    const cache = createCacheStorageImageCache()
    await expect(cache.put(THUMB, new Blob())).resolves.toBeUndefined()
    await expect(cache.get(THUMB)).resolves.toBeUndefined()
    await expect(cache.has?.(THUMB)).resolves.toBe(false)
    await expect(cache.prune?.(USER_ID, new Set())).resolves.toBeUndefined()
  })

  it('has() dice si una miniatura está guardada sin leerla', async () => {
    fakeCaches()
    const cache = createCacheStorageImageCache()
    expect(await cache.has?.(THUMB)).toBe(false)
    await cache.put(THUMB, new Blob(['abc'], { type: 'image/webp' }))
    expect(await cache.has?.(THUMB)).toBe(true)
  })

  it('prune() borra las miniaturas del usuario que ya no son de ninguna planta', async () => {
    const api = fakeCaches()
    const cache = createCacheStorageImageCache()
    const replaced = `${USER_ID}/${PLANT_ID}/thumb-v0.webp`
    await cache.put(THUMB, new Blob(['a']))
    await cache.put(replaced, new Blob(['b']))

    await cache.prune?.(USER_ID, new Set([THUMB]))
    const store = api.stores.get(`${THUMBNAIL_CACHE_PREFIX}${USER_ID}`)
    expect([...(store?.keys() ?? [])]).toEqual([
      `${location.origin}/_orki/plant-photos/${THUMB}`,
    ])
    // Sin caché de ese usuario no crea ninguna.
    await cache.prune?.('user_sin_cache', new Set())
    expect(api.stores.has(`${THUMBNAIL_CACHE_PREFIX}user_sin_cache`)).toBe(
      false,
    )
  })
})
