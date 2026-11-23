import { describe, expect, it, vi } from 'vitest'
import { PLANT_ID, processedPhoto, USER_ID } from '../test/photos.ts'
import { createMemoryPhotoStorage } from './memory-storage.ts'
import { PhotoStorageError } from './storage.ts'
import {
  photoVersionFor,
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
