import { afterEach, describe, expect, it, vi } from 'vitest'
import { plant } from '../test/collection.ts'
import { USER_ID } from '../test/photos.ts'
import { createMemoryPhotoStorage } from './memory-storage.ts'
import type { PersistentImageCache } from './read.ts'
import {
  canDownloadThumbnails,
  syncThumbnails,
  thumbnailPathsOf,
} from './thumbnail-sync.ts'

function plantId(n: number) {
  return `6f1c2a4e-8b3d-4e5f-9a7b-${String(n).padStart(12, '0')}`
}
function thumb(n: number, version = 'v1', user = USER_ID) {
  return `${user}/${plantId(n)}/thumb-${version}.webp`
}

function storageWith(paths: string[]) {
  const storage = createMemoryPhotoStorage()
  for (const path of paths) {
    storage.objects.set(path, {
      blob: new Blob(['x'], { type: 'image/webp' }),
      contentType: 'image/webp',
    })
  }
  return storage
}

function memoryCache(initial: string[] = []) {
  const blobs = new Map<string, Blob>(
    initial.map((path) => [path, new Blob(['y'])]),
  )
  const cache: PersistentImageCache & { blobs: Map<string, Blob> } = {
    blobs,
    get: (path) => Promise.resolve(blobs.get(path)),
    put: (path, blob) => {
      blobs.set(path, blob)
      return Promise.resolve()
    },
    has: (path) => Promise.resolve(blobs.has(path)),
    prune: (userId, keep) => {
      for (const path of [...blobs.keys()]) {
        if (path.startsWith(`${userId}/`) && !keep.has(path)) {
          blobs.delete(path)
        }
      }
      return Promise.resolve()
    },
  }
  return cache
}

const plantsWith = (...paths: (string | null)[]) =>
  paths.map((path) => plant({ thumbnailPath: path }))

const signal = () => new AbortController().signal

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('miniaturas sin conexión', () => {
  it('descarga las que faltan y no vuelve a bajar las que ya están', async () => {
    const paths = [thumb(1), thumb(2), thumb(3)]
    const storage = storageWith(paths)
    const download = vi.spyOn(storage, 'download')
    const cache = memoryCache([thumb(2)])

    const result = await syncThumbnails({
      userId: USER_ID,
      plants: plantsWith(...paths, null),
      signal: signal(),
      storage,
      cache,
      canDownload: () => true,
    })
    expect(result).toEqual({ downloaded: 2, missing: 0 })
    expect(download).toHaveBeenCalledTimes(2)
    expect([...cache.blobs.keys()].sort()).toEqual([...paths].sort())

    download.mockClear()
    await syncThumbnails({
      userId: USER_ID,
      plants: plantsWith(...paths),
      signal: signal(),
      storage,
      cache,
      canDownload: () => true,
    })
    expect(download).not.toHaveBeenCalled()
  })

  it('no baja más de dos a la vez', async () => {
    const paths = Array.from({ length: 7 }, (_, index) => thumb(index + 1))
    const storage = storageWith(paths)
    let active = 0
    let peak = 0
    const original = storage.download.bind(storage)
    vi.spyOn(storage, 'download').mockImplementation(async (path) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active -= 1
      return original(path)
    })
    await syncThumbnails({
      userId: USER_ID,
      plants: plantsWith(...paths),
      signal: signal(),
      storage,
      cache: memoryCache(),
      canDownload: () => true,
    })
    expect(peak).toBe(2)
  })

  it('borra las de plantas eliminadas o con la foto reemplazada, solo del usuario', async () => {
    const ajena = thumb(9, 'v1', 'user_otro')
    const cache = memoryCache([thumb(1, 'v1'), thumb(2), ajena])
    await syncThumbnails({
      userId: USER_ID,
      // La planta 1 tiene foto nueva (v2) y la 2 ya no existe.
      plants: plantsWith(thumb(1, 'v2')),
      signal: signal(),
      storage: storageWith([thumb(1, 'v2')]),
      cache,
      canDownload: () => true,
    })
    expect([...cache.blobs.keys()].sort()).toEqual(
      [thumb(1, 'v2'), ajena].sort(),
    )
  })

  it('sin conexión o con ahorro de datos, limpia pero no descarga', async () => {
    const storage = storageWith([thumb(1)])
    const download = vi.spyOn(storage, 'download')
    const cache = memoryCache([thumb(5)])
    const result = await syncThumbnails({
      userId: USER_ID,
      plants: plantsWith(thumb(1)),
      signal: signal(),
      storage,
      cache,
      canDownload: () => false,
    })
    expect(download).not.toHaveBeenCalled()
    expect(result).toEqual({ downloaded: 0, missing: 1 })
    expect(cache.blobs.size).toBe(0)
  })

  it('un fallo deja esa miniatura para la próxima vez y sigue con las demás', async () => {
    const storage = storageWith([thumb(2)])
    const cache = memoryCache()
    const result = await syncThumbnails({
      userId: USER_ID,
      plants: plantsWith(thumb(1), thumb(2)),
      signal: signal(),
      storage,
      cache,
      canDownload: () => true,
    })
    expect(result).toEqual({ downloaded: 1, missing: 1 })
    expect(cache.blobs.has(thumb(2))).toBe(true)
  })

  it('cancelada, no descarga nada más', async () => {
    const storage = storageWith([thumb(1), thumb(2)])
    const download = vi.spyOn(storage, 'download')
    const controller = new AbortController()
    controller.abort()
    await syncThumbnails({
      userId: USER_ID,
      plants: plantsWith(thumb(1), thumb(2)),
      signal: controller.signal,
      storage,
      cache: memoryCache(),
      canDownload: () => true,
    })
    expect(download).not.toHaveBeenCalled()
  })

  it('ignora las rutas de otro usuario o que no siguen la convención', () => {
    expect([
      ...thumbnailPathsOf(
        USER_ID,
        plantsWith(thumb(1), thumb(2, 'v1', 'user_otro'), 'basura', null),
      ),
    ]).toEqual([thumb(1)])
  })

  it('canDownloadThumbnails respeta la conexión y el ahorro de datos', () => {
    expect(canDownloadThumbnails()).toBe(true)
    vi.stubGlobal('navigator', { onLine: false })
    expect(canDownloadThumbnails()).toBe(false)
    vi.stubGlobal('navigator', { onLine: true, connection: { saveData: true } })
    expect(canDownloadThumbnails()).toBe(false)
  })
})
