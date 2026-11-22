import type { CollectionPlant } from '../collection/model.ts'
import { MAX_PLANT_PHOTOS } from './paths.ts'
import {
  byPosition,
  type PlantPhotoRowInsert,
  type PlantPhotoRows,
  type StoredPlantPhoto,
} from './photo-rows.ts'
import { PhotoStorageError } from './storage.ts'

// plant_photos en memoria, con la misma interfaz que la de PostgREST y las
// reglas de la base que importan a la app (#219): dueño, carpeta de las rutas,
// posición de 0 a 5 y única por planta, y copia de la principal a las columnas
// de la planta. Lo usan las pruebas (y lo puede usar la página de muestra).
// Puede fallar a voluntad, también "después de aplicar" (la red cae con la
// fila ya guardada).

/** Un fallo simulado: el error y si la operación llegó a aplicarse. */
export interface SimulatedRowFailure {
  error: PhotoStorageError
  /** true: se guarda (o se borra) igualmente y después falla, como un `uncertain`. */
  applied?: boolean
}

export interface MemoryPlantPhotoRows extends PlantPhotoRows {
  /** Filas guardadas, por id. */
  readonly rows: Map<string, StoredPlantPhoto & { userId: string }>
  /** Plantas, por id: la principal se copia a photoPath, thumbnailPath y photoInBloom. */
  readonly plants: Map<string, CollectionPlant & { userId: string }>
  failList: (() => PhotoStorageError | null) | undefined
  failInsert:
    ((row: PlantPhotoRowInsert) => SimulatedRowFailure | null) | undefined
  failRemove: ((photoId: string) => SimulatedRowFailure | null) | undefined
  failReadPlant: (() => PhotoStorageError | null) | undefined
  /** Fotos de una planta en orden (para las comprobaciones de las pruebas). */
  photosOf(plantId: string): StoredPlantPhoto[]
}

function inFolder(path: string, userId: string, plantId: string): boolean {
  const folder = `${userId}/${plantId}/`
  return (
    path.startsWith(folder) &&
    path.length > folder.length &&
    !path.slice(folder.length).includes('/')
  )
}

function plain(row: StoredPlantPhoto & { userId: string }): StoredPlantPhoto {
  const photo: Partial<typeof row> = { ...row }
  delete photo.userId
  return photo as StoredPlantPhoto
}

export function createMemoryPlantPhotoRows(): MemoryPlantPhotoRows {
  const rows = new Map<string, StoredPlantPhoto & { userId: string }>()
  const plants = new Map<string, CollectionPlant & { userId: string }>()
  let clock = Date.parse('2026-11-22T12:00:00.000Z')

  function photosOf(plantId: string): StoredPlantPhoto[] {
    return [...rows.values()]
      .filter((row) => row.plantId === plantId)
      .sort(byPosition)
      .map(plain)
  }

  /** Lo que hace el disparador sync_plant: la principal pasa a la planta. */
  function copyMainPhoto(plantId: string) {
    const plant = plants.get(plantId)
    if (!plant) return
    const [main] = photosOf(plantId)
    plant.photoPath = main?.photoPath ?? null
    plant.thumbnailPath = main?.thumbnailPath ?? null
    plant.photoInBloom = main?.inBloom ?? false
  }

  const store: MemoryPlantPhotoRows = {
    rows,
    plants,
    failList: undefined,
    failInsert: undefined,
    failRemove: undefined,
    failReadPlant: undefined,
    photosOf,

    list(plantId, userId) {
      const failure = store.failList?.()
      if (failure) return Promise.reject(failure)
      return Promise.resolve(
        photosOf(plantId).filter(
          (photo) => rows.get(photo.id)?.userId === userId,
        ),
      )
    },

    insert(photo) {
      const failure = store.failInsert?.(photo)
      if (failure && !failure.applied) return Promise.reject(failure.error)
      const plant = plants.get(photo.plantId)
      if (plants.size > 0 && (!plant || plant.userId !== photo.userId)) {
        return Promise.reject(new PhotoStorageError('not-found'))
      }
      if (
        !Number.isInteger(photo.position) ||
        photo.position < 0 ||
        photo.position >= MAX_PLANT_PHOTOS ||
        !inFolder(photo.photoPath, photo.userId, photo.plantId) ||
        !inFolder(photo.thumbnailPath, photo.userId, photo.plantId)
      ) {
        // 23514: restricción de la tabla.
        return Promise.reject(new PhotoStorageError('failed'))
      }
      if (
        photosOf(photo.plantId).some((row) => row.position === photo.position)
      ) {
        return Promise.reject(new PhotoStorageError('position-taken'))
      }
      clock += 1000
      const stored: StoredPlantPhoto & { userId: string } = {
        id: crypto.randomUUID(),
        plantId: photo.plantId,
        userId: photo.userId,
        photoPath: photo.photoPath,
        thumbnailPath: photo.thumbnailPath,
        inBloom: photo.inBloom,
        takenAt: photo.takenAt,
        note: photo.note,
        position: photo.position,
        createdAt: new Date(clock).toISOString(),
      }
      rows.set(stored.id, stored)
      copyMainPhoto(photo.plantId)
      if (failure) return Promise.reject(failure.error)
      return Promise.resolve(plain(stored))
    },

    remove(photoId, userId) {
      const failure = store.failRemove?.(photoId)
      if (failure && !failure.applied) return Promise.reject(failure.error)
      const row = rows.get(photoId)
      let deleted: StoredPlantPhoto | null = null
      if (row && row.userId === userId) {
        rows.delete(photoId)
        copyMainPhoto(row.plantId)
        deleted = plain(row)
      }
      if (failure) return Promise.reject(failure.error)
      return Promise.resolve(deleted)
    },

    readPlant(plantId, userId) {
      const failure = store.failReadPlant?.()
      if (failure) return Promise.reject(failure)
      const plant = plants.get(plantId)
      if (!plant || plant.userId !== userId) {
        return Promise.reject(new PhotoStorageError('not-found'))
      }
      const copy: Partial<typeof plant> = { ...plant }
      delete copy.userId
      return Promise.resolve(copy as CollectionPlant)
    },
  }
  return store
}
