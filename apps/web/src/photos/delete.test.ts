import { describe, expect, it, vi } from 'vitest'
import {
  fakeRecords,
  PLANT_ID,
  processedPhoto,
  USER_ID,
} from '../test/photos.ts'
import { plant } from '../test/collection.ts'
import { deletePlantPhotoFolder, deletePlantWithPhotos } from './delete.ts'
import { uploadPlantPhotos } from './gallery.ts'
import { createMemoryPlantPhotoRows } from './memory-photo-rows.ts'
import { createMemoryPhotoStorage } from './memory-storage.ts'
import { PhotoStorageError } from './storage.ts'

const OTHER_PLANT = '11111111-2222-4333-8444-555555555555'

function storageWithFolder() {
  const storage = createMemoryPhotoStorage()
  for (const path of [
    `${USER_ID}/${PLANT_ID}/photo-v2.webp`,
    `${USER_ID}/${PLANT_ID}/thumb-v2.webp`,
    // Resto de una subida anterior que falló.
    `${USER_ID}/${PLANT_ID}/photo-v1.webp`,
    `${USER_ID}/${OTHER_PLANT}/photo-v1.webp`,
  ]) {
    storage.objects.set(path, { blob: new Blob(), contentType: 'image/webp' })
  }
  return storage
}

describe('deletePlantPhotoFolder', () => {
  it('borra toda la carpeta de la planta y nada más', async () => {
    const storage = storageWithFolder()
    const deleted = await deletePlantPhotoFolder({
      userId: USER_ID,
      plantId: PLANT_ID,
      storage,
    })
    expect(deleted).toHaveLength(3)
    expect([...storage.objects.keys()]).toEqual([
      `${USER_ID}/${OTHER_PLANT}/photo-v1.webp`,
    ])
  })

  it('borra también las fotos de la bitácora, en la subcarpeta log/ (#267)', async () => {
    const storage = storageWithFolder()
    const log = [
      `${USER_ID}/${PLANT_ID}/log/photo-r1.webp`,
      `${USER_ID}/${PLANT_ID}/log/thumb-r1.webp`,
    ]
    for (const path of [
      ...log,
      `${USER_ID}/${OTHER_PLANT}/log/photo-r2.webp`,
    ]) {
      storage.objects.set(path, { blob: new Blob(), contentType: 'image/webp' })
    }
    // Como Storage, listar la carpeta de la planta no devuelve lo de log/.
    expect(await storage.list(`${USER_ID}/${PLANT_ID}/`)).toHaveLength(3)

    const deleted = await deletePlantPhotoFolder({
      userId: USER_ID,
      plantId: PLANT_ID,
      storage,
    })

    expect(deleted).toHaveLength(5)
    expect(deleted).toEqual(expect.arrayContaining(log))
    expect([...storage.objects.keys()].sort()).toEqual([
      `${USER_ID}/${OTHER_PLANT}/log/photo-r2.webp`,
      `${USER_ID}/${OTHER_PLANT}/photo-v1.webp`,
    ])
  })
})

describe('deletePlantWithPhotos', () => {
  it('borra la planta, la quita de la colección y después sus archivos', async () => {
    const storage = storageWithFolder()
    const records = fakeRecords()
    const order: string[] = []
    records.deletePlant.mockImplementation(() => {
      order.push('borrar planta')
      expect(storage.objects.size).toBe(4)
      return Promise.resolve()
    })
    const remove = vi.spyOn(storage, 'remove')
    const result = await deletePlantWithPhotos({
      userId: USER_ID,
      plantId: PLANT_ID,
      storage,
      records,
      onPlantRemoved: (id) => order.push(`quitar ${id}`),
    })
    expect(order).toEqual(['borrar planta', `quitar ${PLANT_ID}`])
    expect(remove).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ photosDeleted: true })
    expect(storage.objects.size).toBe(1)
  })

  it('si la planta no se borra, no toca los archivos', async () => {
    const storage = storageWithFolder()
    const records = fakeRecords()
    records.deletePlant.mockRejectedValue(new PhotoStorageError('offline'))
    const onPlantRemoved = vi.fn()
    await expect(
      deletePlantWithPhotos({
        userId: USER_ID,
        plantId: PLANT_ID,
        storage,
        records,
        onPlantRemoved,
      }),
    ).rejects.toMatchObject({ reason: 'offline' })
    expect(storage.objects.size).toBe(4)
    expect(onPlantRemoved).not.toHaveBeenCalled()
  })

  it('si fallan los archivos, la planta queda borrada y lo dice', async () => {
    const storage = storageWithFolder()
    vi.spyOn(storage, 'remove').mockRejectedValue(
      new PhotoStorageError('offline'),
    )
    const result = await deletePlantWithPhotos({
      userId: USER_ID,
      plantId: PLANT_ID,
      storage,
      records: fakeRecords(),
    })
    expect(result).toEqual({ photosDeleted: false })
  })

  it('con varias fotos: la cascada borra sus filas y la carpeta, todos sus archivos', async () => {
    const storage = createMemoryPhotoStorage()
    const rows = createMemoryPlantPhotoRows()
    rows.plants.set(PLANT_ID, {
      ...plant({ id: PLANT_ID, photoPath: null, thumbnailPath: null }),
      userId: USER_ID,
    })
    const photos = Array.from({ length: 6 }, () => ({
      files: processedPhoto(),
    }))
    await uploadPlantPhotos(photos, {
      userId: USER_ID,
      plantId: PLANT_ID,
      storage,
      rows,
    })
    // Una foto de otra planta del mismo usuario no se toca.
    const other = `${USER_ID}/${OTHER_PLANT}/photo-v1.webp`
    storage.objects.set(other, { blob: new Blob(), contentType: 'image/webp' })
    expect(storage.objects.size).toBe(13)

    const records = fakeRecords()
    records.deletePlant.mockImplementation((plantId) => {
      // Lo que hace la base: on delete cascade de plant_photos.plant_id.
      for (const [id, row] of rows.rows) {
        if (row.plantId === plantId) rows.rows.delete(id)
      }
      rows.plants.delete(plantId)
      return Promise.resolve()
    })
    const result = await deletePlantWithPhotos({
      userId: USER_ID,
      plantId: PLANT_ID,
      storage,
      records,
    })

    expect(result).toEqual({ photosDeleted: true })
    expect(rows.rows.size).toBe(0)
    expect([...storage.objects.keys()]).toEqual([other])
  })
})
