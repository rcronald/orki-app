import type { CollectionPlant } from '../collection/model.ts'
import { parsePhotoPath } from './paths.ts'
import { appThumbnailCache, type PersistentImageCache } from './read.ts'
import { appPhotoStorage, type PhotoStorage } from './storage.ts'

// Miniaturas sin conexión (#18, #119). La lista solo pide la miniatura de las
// tarjetas que están en pantalla o cerca (usePlantThumbnail), así que sin
// esto, en modo avión faltarían las de las plantas que el usuario no llegó a
// ver. Con la colección completa en memoria:
//
// 1. Limpieza: borra de la caché del usuario (Cache Storage, una por usuario;
//    ver read.ts) las miniaturas que ya no son de ninguna planta suya: plantas
//    eliminadas o con la foto reemplazada (la ruta lleva la versión, así que
//    una foto nueva es otra ruta).
// 2. Descarga en segundo plano de las que faltan, con conexión:
//    - de dos en dos (MAX_CONCURRENT), para no competir con las que la
//      pantalla está pidiendo;
//    - solo las que faltan (has()): cada miniatura se baja una vez por
//      dispositivo;
//    - nada si el navegador pide ahorrar datos (navigator.connection.saveData,
//      Chrome en Android) o está sin conexión. Las miniaturas pesan como
//      mucho 30 kB (photos/process.ts): unos 3 MB para 100 plantas y 9 MB
//      para 300 en el peor caso; ver docs/sin-conexion.md.
// 3. Sin red se sirven desde esa caché, como siempre (createPlantImageSource
//    mira la caché antes de descargar). Si alguna falta, la tarjeta pone el
//    marcador neutro del sistema.
//
// Se cancela con la señal (cambio de usuario, colección nueva) y nunca
// rechaza: un fallo deja esa miniatura para la próxima vez.

/** Descargas a la vez como mucho. */
export const MAX_CONCURRENT = 2

export interface ThumbnailSyncOptions {
  userId: string
  plants: readonly CollectionPlant[]
  signal: AbortSignal
  storage?: PhotoStorage
  cache?: PersistentImageCache
  /** Si se puede descargar ahora; por defecto, con conexión y sin ahorro de datos. */
  canDownload?: () => boolean
  maxConcurrent?: number
}

export interface ThumbnailSyncResult {
  /** Miniaturas descargadas en esta pasada. */
  downloaded: number
  /** Las que siguen faltando (fallo, sin conexión o ahorro de datos). */
  missing: number
}

interface NetworkInformationLike {
  saveData?: boolean
}

/** Con conexión y sin que el usuario haya pedido ahorrar datos. */
export function canDownloadThumbnails(): boolean {
  if (typeof navigator === 'undefined') return false
  if (navigator.onLine === false) return false
  const connection = (navigator as { connection?: NetworkInformationLike })
    .connection
  return connection?.saveData !== true
}

/** Las rutas de miniatura de las plantas que son de `userId`. */
export function thumbnailPathsOf(
  userId: string,
  plants: readonly CollectionPlant[],
): Set<string> {
  const paths = new Set<string>()
  for (const plant of plants) {
    const path = plant.thumbnailPath
    if (path !== null && parsePhotoPath(path)?.userId === userId) {
      paths.add(path)
    }
  }
  return paths
}

export async function syncThumbnails({
  userId,
  plants,
  signal,
  storage = appPhotoStorage(),
  cache = appThumbnailCache(),
  canDownload = canDownloadThumbnails,
  maxConcurrent = MAX_CONCURRENT,
}: ThumbnailSyncOptions): Promise<ThumbnailSyncResult> {
  const paths = thumbnailPathsOf(userId, plants)
  try {
    await cache.prune?.(userId, paths)
  } catch {
    // La limpieza es opcional: se vuelve a intentar en la próxima pasada.
  }

  const missing: string[] = []
  for (const path of paths) {
    if (signal.aborted) return { downloaded: 0, missing: paths.size }
    const stored = cache.has
      ? await cache.has(path).catch(() => false)
      : (await cache.get(path).catch(() => undefined)) !== undefined
    if (!stored) missing.push(path)
  }

  let downloaded = 0
  let next = 0
  async function worker() {
    while (next < missing.length) {
      if (signal.aborted || !canDownload()) return
      const path = missing[next]
      next += 1
      if (path === undefined) return
      try {
        // Quizá la pantalla la bajó mientras tanto.
        if (await cache.has?.(path)) continue
        const blob = await storage.download(path, { signal })
        if (signal.aborted) return
        await cache.put(path, blob)
        downloaded += 1
      } catch {
        // Esta queda para la próxima pasada.
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, maxConcurrent) }, () => worker()),
  )
  return { downloaded, missing: missing.length - downloaded }
}
