import type { CollectionPlant } from '../collection/model.ts'
import { localDateString } from '../lib/localDate.ts'
import { MAX_PLANT_PHOTOS } from './paths.ts'
import {
  byPosition,
  type PlantPhotoRowChanges,
  type PlantPhotoRowInsert,
  type PlantPhotoRows,
  type StoredPlantPhoto,
} from './photo-rows.ts'
import { PhotoStorageError } from './storage.ts'

// plant_photos en memoria, con la misma interfaz que la de PostgREST y las
// reglas de la base que importan a la app (#219): dueño, carpeta de las rutas,
// posición de 0 a 5 y única por planta, nota (no en blanco, hasta 500) y fecha
// (no futura, con un día de margen), copia de la principal a las columnas de
// la planta y número de fotos (photoCount) al releerla. reorder() hace lo
// mismo que la función reorder_plant_photos de la base (#183). Lo usan las
// pruebas (y lo puede usar la página de muestra).
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
  failUpdate:
    | ((
        photoId: string,
        changes: PlantPhotoRowChanges,
      ) => SimulatedRowFailure | null)
    | undefined
  failReorder:
    ((photoIds: readonly string[]) => SimulatedRowFailure | null) | undefined
  failReadPlant: (() => PhotoStorageError | null) | undefined
  // insert y remove pasan por insertMany y removeMany (una fila): los fallos
  // simulados se piden por fila también en lote.
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

/** Las restricciones de la tabla sobre la nota y la fecha (23514). */
function validDetails(row: StoredPlantPhoto): boolean {
  const { note, takenAt } = row
  if (note !== null && (note.trim() === '' || note.length > 500)) return false
  if (takenAt === null) return true
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(takenAt) && takenAt <= localDateString(tomorrow)
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
    failUpdate: undefined,
    failReorder: undefined,
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
      return store.insertMany([photo]).then(([stored]) => {
        if (!stored) throw new PhotoStorageError('failed')
        return stored
      })
    },

    // Una sola sentencia: si una fila no vale, no se crea ninguna.
    insertMany(photos) {
      const failures = photos.map((photo) => store.failInsert?.(photo) ?? null)
      const refused = failures.find((failure) => failure && !failure.applied)
      if (refused) return Promise.reject(refused.error)
      const taken = new Set(
        [...rows.values()].map((row) => `${row.plantId}:${row.position}`),
      )
      for (const photo of photos) {
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
        const key = `${photo.plantId}:${String(photo.position)}`
        if (taken.has(key)) {
          return Promise.reject(new PhotoStorageError('position-taken'))
        }
        taken.add(key)
      }
      const created = photos.map((photo) => {
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
        return stored
      })
      for (const plantId of new Set(photos.map((photo) => photo.plantId))) {
        copyMainPhoto(plantId)
      }
      const late = failures.find((failure) => failure?.applied)
      if (late) return Promise.reject(late.error)
      return Promise.resolve(created.map(plain).sort(byPosition))
    },

    remove(photoId, userId) {
      return store
        .removeMany([photoId], userId)
        .then(([deleted]) => deleted ?? null)
    },

    removeMany(photoIds, userId) {
      const failures = photoIds.map((id) => store.failRemove?.(id) ?? null)
      const refused = failures.find((failure) => failure && !failure.applied)
      if (refused) return Promise.reject(refused.error)
      const deleted: StoredPlantPhoto[] = []
      const touched = new Set<string>()
      for (const photoId of photoIds) {
        const row = rows.get(photoId)
        if (row && row.userId === userId) {
          rows.delete(photoId)
          touched.add(row.plantId)
          deleted.push(plain(row))
        }
      }
      for (const plantId of touched) copyMainPhoto(plantId)
      const late = failures.find((failure) => failure?.applied)
      if (late) return Promise.reject(late.error)
      return Promise.resolve(deleted)
    },

    update(photoId, userId, changes) {
      const failure = store.failUpdate?.(photoId, changes)
      if (failure && !failure.applied) return Promise.reject(failure.error)
      const row = rows.get(photoId)
      if (!row || row.userId !== userId) {
        return Promise.reject(new PhotoStorageError('not-found'))
      }
      const next = { ...row }
      if (changes.takenAt !== undefined) next.takenAt = changes.takenAt
      if (changes.note !== undefined) next.note = changes.note
      if (changes.inBloom !== undefined) next.inBloom = changes.inBloom
      if (!validDetails(next)) {
        return Promise.reject(new PhotoStorageError('failed'))
      }
      rows.set(photoId, next)
      copyMainPhoto(row.plantId)
      if (failure) return Promise.reject(failure.error)
      return Promise.resolve(plain(next))
    },

    reorder(plantId, userId, photoIds) {
      const failure = store.failReorder?.(photoIds)
      if (failure && !failure.applied) return Promise.reject(failure.error)
      const current = photosOf(plantId).filter(
        (photo) => rows.get(photo.id)?.userId === userId,
      )
      const wanted = new Set(photoIds)
      if (
        wanted.size !== photoIds.length ||
        current.length !== photoIds.length ||
        current.some((photo) => !wanted.has(photo.id))
      ) {
        // 22023 de la función: la lista no es la de las fotos de la planta.
        return Promise.reject(new PhotoStorageError('position-taken'))
      }
      // Una sola sentencia: todas las posiciones cambian a la vez.
      photoIds.forEach((id, position) => {
        const row = rows.get(id)
        if (row) rows.set(id, { ...row, position })
      })
      copyMainPhoto(plantId)
      if (failure) return Promise.reject(failure.error)
      return Promise.resolve(photosOf(plantId))
    },

    readPlant(plantId, userId) {
      const failure = store.failReadPlant?.()
      if (failure) return Promise.reject(failure)
      const plant = plants.get(plantId)
      if (!plant || plant.userId !== userId) {
        return Promise.reject(new PhotoStorageError('not-found'))
      }
      // Como photo_count: el número de filas de la planta.
      const copy: Partial<typeof plant> = {
        ...plant,
        photoCount: photosOf(plantId).length,
      }
      delete copy.userId
      return Promise.resolve(copy as CollectionPlant)
    },
  }
  return store
}
