import { describe, expect, it, vi } from 'vitest'
import {
  fakeRecords,
  PLANT_ID,
  processedPhoto,
  USER_ID,
} from '../test/photos.ts'
import { createMemoryPhotoStorage } from './memory-storage.ts'
import { PhotoStorageError } from './storage.ts'
import {
  photoVersionFor,
  removePlantPhoto,
  replacePlantPhoto,
  uploadPhotoFiles,
  type UploadProgress,
} from './upload.ts'

const PATH_PATTERN = new RegExp(
  `^${USER_ID}/${PLANT_ID}/(photo|thumb)-[0-9a-f-]{36}\\.webp$`,
)

describe('uploadPhotoFiles', () => {
  it('sube foto y miniatura con la convención de rutas y su tipo', async () => {
    const storage = createMemoryPhotoStorage()
    const upload = vi.spyOn(storage, 'upload')
    const files = processedPhoto()
    const progress: UploadProgress[] = []

    const paths = await uploadPhotoFiles(files, {
      userId: USER_ID,
      plantId: PLANT_ID.toUpperCase(),
      storage,
      onProgress: (value) => progress.push(value),
    })

    const version = photoVersionFor(files)
    expect(paths).toEqual({
      photoPath: `${USER_ID}/${PLANT_ID}/photo-${version}.webp`,
      thumbnailPath: `${USER_ID}/${PLANT_ID}/thumb-${version}.webp`,
    })
    expect(paths.photoPath).toMatch(PATH_PATTERN)
    expect(upload).toHaveBeenCalledWith(paths.photoPath, files.photo.blob, {
      contentType: 'image/webp',
    })
    expect(upload).toHaveBeenCalledWith(
      paths.thumbnailPath,
      files.thumbnail.blob,
      { contentType: 'image/webp' },
    )
    expect(progress.at(0)).toMatchObject({ filesDone: 0, filesTotal: 2 })
    expect(progress.at(-1)).toEqual({
      filesDone: 2,
      filesTotal: 2,
      bytesDone: 182_400 + 18_200,
      bytesTotal: 182_400 + 18_200,
    })
  })

  it('JPEG va con extensión jpg', async () => {
    const storage = createMemoryPhotoStorage()
    const paths = await uploadPhotoFiles(processedPhoto('image/jpeg'), {
      userId: USER_ID,
      plantId: PLANT_ID,
      storage,
    })
    expect(paths.photoPath).toMatch(/\/photo-[^/]+\.jpg$/)
    expect(storage.objects.get(paths.thumbnailPath)?.contentType).toBe(
      'image/jpeg',
    )
  })

  it('si falla la miniatura, borra la foto ya subida y da el motivo', async () => {
    const storage = createMemoryPhotoStorage()
    storage.failUploads = (path) =>
      path.includes('/thumb-') ? new PhotoStorageError('too-large') : null
    const remove = vi.spyOn(storage, 'remove')

    await expect(
      uploadPhotoFiles(processedPhoto(), {
        userId: USER_ID,
        plantId: PLANT_ID,
        storage,
      }),
    ).rejects.toMatchObject({ reason: 'too-large' })
    expect(storage.objects.size).toBe(0)
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('reintentar con la misma foto usa las mismas rutas', async () => {
    const storage = createMemoryPhotoStorage()
    const files = processedPhoto()
    storage.failUploads = () =>
      new PhotoStorageError('offline', { uncertain: true })
    const first = uploadPhotoFiles(files, {
      userId: USER_ID,
      plantId: PLANT_ID,
      storage,
    })
    await expect(first).rejects.toMatchObject({ reason: 'offline' })

    storage.failUploads = undefined
    const paths = await uploadPhotoFiles(files, {
      userId: USER_ID,
      plantId: PLANT_ID,
      storage,
    })
    expect(paths.photoPath).toContain(photoVersionFor(files))
    expect([...storage.objects.keys()].sort()).toEqual(
      [paths.photoPath, paths.thumbnailPath].sort(),
    )
  })

  it('cancelar rechaza enseguida y borra lo que llegue a subirse', async () => {
    const storage = createMemoryPhotoStorage(20)
    const files = processedPhoto()
    const version = photoVersionFor(files)
    const controller = new AbortController()
    const pending = uploadPhotoFiles(files, {
      userId: USER_ID,
      plantId: PLANT_ID,
      storage,
      signal: controller.signal,
    })
    controller.abort()

    await expect(pending).rejects.toMatchObject({ reason: 'aborted' })
    // Las subidas terminan después y se borran.
    await vi.waitFor(() => {
      expect(storage.objects.size).toBe(0)
    })
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(storage.objects.size).toBe(0)
    // El reintento usará otra versión, que el borrado tardío no toca.
    expect(photoVersionFor(files)).not.toBe(version)
  })

  it('con la señal ya cancelada no sube nada', async () => {
    const storage = createMemoryPhotoStorage()
    const upload = vi.spyOn(storage, 'upload')
    await expect(
      uploadPhotoFiles(processedPhoto(), {
        userId: USER_ID,
        plantId: PLANT_ID,
        storage,
        signal: AbortSignal.abort(),
      }),
    ).rejects.toMatchObject({ reason: 'aborted' })
    expect(upload).not.toHaveBeenCalled()
  })
})

const OLD = {
  photoPath: `${USER_ID}/${PLANT_ID}/photo-vieja.webp`,
  thumbnailPath: `${USER_ID}/${PLANT_ID}/thumb-vieja.webp`,
}

function storageWithOldPhoto() {
  const storage = createMemoryPhotoStorage()
  for (const path of [OLD.photoPath, OLD.thumbnailPath]) {
    storage.objects.set(path, { blob: new Blob(), contentType: 'image/webp' })
  }
  return storage
}

const target = { id: PLANT_ID, ...OLD }

describe('replacePlantPhoto', () => {
  it('sube, apunta la planta, la refleja y después borra la anterior', async () => {
    const storage = storageWithOldPhoto()
    const records = fakeRecords()
    const order: string[] = []
    vi.spyOn(storage, 'upload').mockImplementation((path) => {
      order.push(`subir ${path.includes('/thumb-') ? 'miniatura' : 'foto'}`)
      storage.objects.set(path, { blob: new Blob(), contentType: 'image/webp' })
      return Promise.resolve()
    })
    records.setPhotoPaths.mockImplementation((_id, _user, paths) => {
      order.push('apuntar planta')
      // En ese momento los archivos nuevos ya existen.
      expect(storage.objects.has(paths!.photoPath)).toBe(true)
      return Promise.resolve({
        ...target,
        photoPath: paths!.photoPath,
        thumbnailPath: paths!.thumbnailPath,
      } as never)
    })
    const remove = vi.spyOn(storage, 'remove').mockImplementation((paths) => {
      order.push('borrar anterior')
      for (const path of paths) storage.objects.delete(path)
      return Promise.resolve()
    })
    const onPlantUpdated = vi.fn(() => order.push('reflejar'))

    const { plant, leftovers } = await replacePlantPhoto(processedPhoto(), {
      userId: USER_ID,
      plant: target,
      storage,
      records,
      onPlantUpdated,
    })

    expect(order).toEqual([
      'subir foto',
      'subir miniatura',
      'apuntar planta',
      'reflejar',
      'borrar anterior',
    ])
    expect(remove).toHaveBeenCalledWith([OLD.photoPath, OLD.thumbnailPath])
    expect(leftovers).toEqual([])
    expect([...storage.objects.keys()].sort()).toEqual(
      [plant.photoPath, plant.thumbnailPath].sort(),
    )
  })

  it('si la base rechaza el cambio, borra lo nuevo y conserva lo anterior', async () => {
    const storage = storageWithOldPhoto()
    const records = fakeRecords()
    records.setPhotoPaths.mockRejectedValue(
      new PhotoStorageError('session-ended'),
    )

    await expect(
      replacePlantPhoto(processedPhoto(), {
        userId: USER_ID,
        plant: target,
        storage,
        records,
      }),
    ).rejects.toMatchObject({ reason: 'session-ended' })
    expect([...storage.objects.keys()].sort()).toEqual(
      [OLD.photoPath, OLD.thumbnailPath].sort(),
    )
  })

  it('si no se sabe si la base cambió, no borra nada y el reintento termina', async () => {
    const storage = storageWithOldPhoto()
    const records = fakeRecords()
    const files = processedPhoto()
    records.setPhotoPaths.mockRejectedValueOnce(
      new PhotoStorageError('offline', { uncertain: true }),
    )

    await expect(
      replacePlantPhoto(files, {
        userId: USER_ID,
        plant: target,
        storage,
        records,
      }),
    ).rejects.toMatchObject({ reason: 'offline' })
    // Ni lo nuevo (la planta quizá ya apunta ahí) ni lo anterior.
    expect(storage.objects.size).toBe(4)

    const { plant } = await replacePlantPhoto(files, {
      userId: USER_ID,
      plant: target,
      storage,
      records,
    })
    expect([...storage.objects.keys()].sort()).toEqual(
      [plant.photoPath, plant.thumbnailPath].sort(),
    )
  })

  it('si el borrado de la anterior falla, termina igual y la devuelve como resto', async () => {
    const storage = storageWithOldPhoto()
    vi.spyOn(storage, 'remove').mockRejectedValue(
      new PhotoStorageError('offline', { uncertain: true }),
    )
    const result = await replacePlantPhoto(processedPhoto(), {
      userId: USER_ID,
      plant: target,
      storage,
      records: fakeRecords(),
    })
    expect(result.leftovers).toEqual([OLD.photoPath, OLD.thumbnailPath])
  })

  it('una planta sin foto no borra nada', async () => {
    const storage = createMemoryPhotoStorage()
    const remove = vi.spyOn(storage, 'remove')
    await replacePlantPhoto(processedPhoto(), {
      userId: USER_ID,
      plant: { id: PLANT_ID, photoPath: null, thumbnailPath: null },
      storage,
      records: fakeRecords(),
    })
    expect(remove).not.toHaveBeenCalled()
    expect(storage.objects.size).toBe(2)
  })
})

describe('removePlantPhoto', () => {
  it('primero deja la planta sin foto y después borra los archivos', async () => {
    const storage = storageWithOldPhoto()
    const records = fakeRecords()
    const order: string[] = []
    records.setPhotoPaths.mockImplementation((id, _user, paths) => {
      order.push(paths === null ? 'apuntar a ninguna' : 'apuntar')
      expect(storage.objects.size).toBe(2)
      return fakeRecords().setPhotoPaths(id, USER_ID, null)
    })
    vi.spyOn(storage, 'remove').mockImplementation(() => {
      order.push('borrar')
      storage.objects.clear()
      return Promise.resolve()
    })

    const { plant } = await removePlantPhoto({
      userId: USER_ID,
      plant: target,
      storage,
      records,
      onPlantUpdated: () => order.push('reflejar'),
    })
    expect(order).toEqual(['apuntar a ninguna', 'reflejar', 'borrar'])
    expect(plant.photoPath).toBeNull()
    expect(storage.objects.size).toBe(0)
  })

  it('si la base falla, no borra los archivos', async () => {
    const storage = storageWithOldPhoto()
    const records = fakeRecords()
    records.setPhotoPaths.mockRejectedValue(new PhotoStorageError('failed'))
    await expect(
      removePlantPhoto({ userId: USER_ID, plant: target, storage, records }),
    ).rejects.toMatchObject({ reason: 'failed' })
    expect(storage.objects.size).toBe(2)
  })
})
