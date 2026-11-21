import { describe, expect, it, vi } from 'vitest'
import { fakeRecords, PLANT_ID, USER_ID } from '../test/photos.ts'
import { deletePlantPhotoFolder, deletePlantWithPhotos } from './delete.ts'
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
})
