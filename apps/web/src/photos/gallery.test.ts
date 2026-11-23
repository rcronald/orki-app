import { describe, expect, it, vi } from 'vitest'
import type { CollectionPlant } from '../collection/model.ts'
import { plant } from '../test/collection.ts'
import { PLANT_ID, processedPhoto, USER_ID } from '../test/photos.ts'
import {
  checkPlantPhotoDetails,
  listPlantPhotos,
  orderWithMain,
  orderWithMove,
  removeStoredPlantPhoto,
  reorderPlantPhotos,
  updatePlantPhoto,
  uploadPlantPhotos,
  type NewPlantPhoto,
  type PlantPhotosProgress,
} from './gallery.ts'
import { createMemoryPlantPhotoRows } from './memory-photo-rows.ts'
import { createMemoryPhotoStorage } from './memory-storage.ts'
import { PhotoStorageError } from './storage.ts'
import { photoVersionFor } from './upload.ts'

const OTHER_USER = 'user_otra'

/** Bucket y filas en memoria, con la planta ya creada y sin fotos. */
function setup() {
  const storage = createMemoryPhotoStorage()
  const rows = createMemoryPlantPhotoRows()
  rows.plants.set(PLANT_ID, {
    ...plant({ id: PLANT_ID, photoPath: null, thumbnailPath: null }),
    photoInBloom: false,
    userId: USER_ID,
  })
  return { storage, rows }
}

function newPhotos(count: number): NewPlantPhoto[] {
  return Array.from({ length: count }, () => ({ files: processedPhoto() }))
}

function options(context: ReturnType<typeof setup>) {
  return { userId: USER_ID, plantId: PLANT_ID, ...context }
}

/** Las dos rutas de cada foto, ordenadas. */
function filesOf(photos: { photoPath: string; thumbnailPath: string }[]) {
  return photos
    .flatMap((photo) => [photo.photoPath, photo.thumbnailPath])
    .sort()
}

function bucketPaths(storage: ReturnType<typeof createMemoryPhotoStorage>) {
  return [...storage.objects.keys()].sort()
}

describe('uploadPlantPhotos', () => {
  it('sin fotos no sube ni escribe nada', async () => {
    const context = setup()
    const upload = vi.spyOn(context.storage, 'upload')
    const insert = vi.spyOn(context.rows, 'insert')
    const onPlantUpdated = vi.fn()

    const result = await uploadPlantPhotos([], {
      ...options(context),
      onPlantUpdated,
    })

    expect(result).toEqual({
      results: [],
      photos: [],
      complete: true,
      plant: null,
    })
    expect(upload).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
    expect(onPlantUpdated).not.toHaveBeenCalled()
  })

  it('una foto: sube los dos archivos, crea la principal y relee la planta', async () => {
    const context = setup()
    const order: string[] = []
    const upload = context.storage.upload.bind(context.storage)
    vi.spyOn(context.storage, 'upload').mockImplementation((path, ...rest) => {
      order.push(path.includes('/thumb-') ? 'subir miniatura' : 'subir foto')
      return upload(path, ...rest)
    })
    const insert = context.rows.insert.bind(context.rows)
    vi.spyOn(context.rows, 'insert').mockImplementation((row) => {
      order.push('crear fila')
      // La fila nunca cita un archivo que no existe.
      expect(context.storage.objects.has(row.photoPath)).toBe(true)
      expect(context.storage.objects.has(row.thumbnailPath)).toBe(true)
      return insert(row)
    })
    const updated: CollectionPlant[] = []
    const [photo] = newPhotos(1)

    const result = await uploadPlantPhotos(
      [
        {
          ...photo,
          inBloom: true,
          takenAt: '2026-11-20',
          note: 'Primera flor',
        },
      ],
      { ...options(context), onPlantUpdated: (p) => updated.push(p) },
    )

    expect(order).toEqual(['subir foto', 'subir miniatura', 'crear fila'])
    expect(result.complete).toBe(true)
    const [only] = result.results
    expect(only).toMatchObject({ status: 'uploaded', reused: false })
    const saved = context.rows.photosOf(PLANT_ID)
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      position: 0,
      inBloom: true,
      takenAt: '2026-11-20',
      note: 'Primera flor',
    })
    const version = photoVersionFor(photo.files)
    expect(saved[0].photoPath).toBe(
      `${USER_ID}/${PLANT_ID}/photo-${version}.webp`,
    )
    expect(bucketPaths(context.storage)).toEqual(filesOf(saved))
    // La base copió la principal a la planta y la colección la recibe.
    expect(updated).toHaveLength(1)
    expect(updated[0].thumbnailPath).toBe(saved[0].thumbnailPath)
    expect(result.plant?.photoPath).toBe(saved[0].photoPath)
  })

  it('seis fotos: en orden, posiciones 0 a 5, con progreso por foto', async () => {
    const context = setup()
    const photos = newPhotos(6)
    const progress: PlantPhotosProgress[] = []

    const result = await uploadPlantPhotos(photos, {
      ...options(context),
      onProgress: (value) => progress.push(value),
    })

    expect(result.complete).toBe(true)
    const saved = context.rows.photosOf(PLANT_ID)
    expect(saved.map((photo) => photo.position)).toEqual([0, 1, 2, 3, 4, 5])
    expect(saved.map((photo) => photo.photoPath)).toEqual(
      photos.map(
        ({ files }) =>
          `${USER_ID}/${PLANT_ID}/photo-${photoVersionFor(files)}.webp`,
      ),
    )
    expect(result.photos).toEqual(saved)
    expect(bucketPaths(context.storage)).toEqual(filesOf(saved))

    const done = progress.filter((value) => value.step === 'done')
    expect(done.map((value) => [value.index, value.completed])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
    ])
    expect(progress.every((value) => value.total === 6)).toBe(true)
    // Cada foto pasa por subir (con el progreso de sus archivos) y guardar.
    expect(
      progress.filter((value) => value.index === 2).map((value) => value.step),
    ).toEqual(['uploading', 'uploading', 'uploading', 'saving', 'done'])
  })

  it('la séptima no cabe: rechaza sin subir nada', async () => {
    const context = setup()
    await uploadPlantPhotos(newPhotos(6), options(context))
    const upload = vi.spyOn(context.storage, 'upload')

    await expect(
      uploadPlantPhotos(newPhotos(1), options(context)),
    ).rejects.toMatchObject({ reason: 'too-many-photos' })
    expect(upload).not.toHaveBeenCalled()
    expect(context.rows.photosOf(PLANT_ID)).toHaveLength(6)

    // También siete de golpe en una planta vacía.
    const empty = setup()
    await expect(
      uploadPlantPhotos(newPhotos(7), options(empty)),
    ).rejects.toMatchObject({ reason: 'too-many-photos' })
    expect(empty.storage.objects.size).toBe(0)
  })

  it('si falla un archivo, esa foto no deja nada y las demás se guardan', async () => {
    const context = setup()
    const photos = newPhotos(3)
    const broken = photoVersionFor(photos[1].files)
    context.storage.failUploads = (path) =>
      path.includes(`thumb-${broken}`)
        ? new PhotoStorageError('too-large')
        : null

    const result = await uploadPlantPhotos(photos, options(context))

    expect(result.complete).toBe(false)
    expect(result.results.map((value) => value.status)).toEqual([
      'uploaded',
      'failed',
      'uploaded',
    ])
    expect(result.results[1]).toMatchObject({
      error: { reason: 'too-large' },
    })
    const saved = context.rows.photosOf(PLANT_ID)
    expect(saved.map((photo) => photo.position)).toEqual([0, 2])
    // Ni la foto de la que falló la miniatura.
    expect(bucketPaths(context.storage)).toEqual(filesOf(saved))
  })

  it('si la base rechaza la fila, borra sus archivos', async () => {
    const context = setup()
    context.rows.failInsert = () => ({
      error: new PhotoStorageError('session-ended'),
    })

    const result = await uploadPlantPhotos(newPhotos(1), options(context))

    expect(result.results[0]).toMatchObject({
      status: 'failed',
      error: { reason: 'session-ended' },
    })
    expect(context.storage.objects.size).toBe(0)
    expect(context.rows.rows.size).toBe(0)
  })

  it('si el borrado de los archivos también falla, quedan para el script de limpieza', async () => {
    const context = setup()
    context.rows.failInsert = () => ({ error: new PhotoStorageError('failed') })
    vi.spyOn(context.storage, 'remove').mockRejectedValue(
      new PhotoStorageError('offline', { uncertain: true }),
    )

    const result = await uploadPlantPhotos(newPhotos(1), options(context))

    expect(result.results[0]).toMatchObject({ status: 'failed' })
    // Dos archivos sin fila: los encuentra findOrphans (orphans.test.ts).
    expect(context.storage.objects.size).toBe(2)
    expect(context.rows.rows.size).toBe(0)
  })

  it('reintentar con las que faltan: no duplica y respeta su posición', async () => {
    const context = setup()
    const photos = newPhotos(3)
    context.rows.failInsert = (row) =>
      row.position === 1
        ? { error: new PhotoStorageError('offline', { uncertain: true }) }
        : null
    const first = await uploadPlantPhotos(photos, options(context))
    expect(first.results.map((value) => value.status)).toEqual([
      'uploaded',
      'failed',
      'uploaded',
    ])
    // Sin respuesta de la base: sus archivos se quedan (la fila quizá existe).
    expect(context.storage.objects.size).toBe(6)

    context.rows.failInsert = undefined
    const retry = await uploadPlantPhotos([photos[1]], options(context))

    expect(retry.complete).toBe(true)
    const saved = context.rows.photosOf(PLANT_ID)
    expect(saved.map((photo) => photo.position)).toEqual([0, 1, 2])
    expect(saved[1].photoPath).toContain(photoVersionFor(photos[1].files))
    expect(bucketPaths(context.storage)).toEqual(filesOf(saved))
  })

  it('reintentar cuando la fila sí llegó (respuesta perdida) no crea otra', async () => {
    const context = setup()
    const photos = newPhotos(2)
    context.rows.failInsert = (row) =>
      row.position === 0
        ? {
            error: new PhotoStorageError('offline', { uncertain: true }),
            applied: true,
          }
        : null
    const first = await uploadPlantPhotos(photos, options(context))
    expect(first.results[0].status).toBe('failed')

    context.rows.failInsert = undefined
    const upload = vi.spyOn(context.storage, 'upload')
    const insert = vi.spyOn(context.rows, 'insert')
    // Se reintenta con todas: la primera ya está y la segunda también.
    const retry = await uploadPlantPhotos(photos, options(context))

    expect(retry.results).toMatchObject([
      { status: 'uploaded', reused: true },
      { status: 'uploaded', reused: true },
    ])
    expect(upload).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
    expect(context.rows.photosOf(PLANT_ID)).toHaveLength(2)
    expect(context.storage.objects.size).toBe(4)
  })

  // Las fotos suben de tres en tres (#285): cancelar corta las que están en
  // curso (las tres) y no empieza las siguientes.
  it('cancelar: deja de esperar, borra lo subido y no intenta las siguientes', async () => {
    const context = setup()
    context.storage.delayMs = 20
    const photos = newPhotos(4)
    const controller = new AbortController()
    const pending = uploadPlantPhotos(photos, {
      ...options(context),
      signal: controller.signal,
      onProgress: (value) => {
        // Cancelar en cuanto la primera queda guardada, con la segunda y la
        // tercera aún en curso y la cuarta sin empezar.
        if (value.index === 0 && value.step === 'done') controller.abort()
      },
    })

    const result = await pending
    expect(result.results.map((value) => value.status)).toEqual([
      'uploaded',
      'failed',
      'failed',
      'skipped',
    ])
    expect(result.results[1]).toMatchObject({ error: { reason: 'aborted' } })
    expect(result.results[2]).toMatchObject({ error: { reason: 'aborted' } })
    // Lo que llegue a subirse de la segunda y la tercera se borra al terminar.
    await vi.waitFor(() => {
      expect(bucketPaths(context.storage)).toEqual(
        filesOf(context.rows.photosOf(PLANT_ID)),
      )
    })
    expect(context.rows.photosOf(PLANT_ID)).toHaveLength(1)

    // El reintento termina el trabajo en sus posiciones.
    context.storage.delayMs = 0
    const retry = await uploadPlantPhotos(photos.slice(1), options(context))
    expect(retry.complete).toBe(true)
    expect(
      context.rows.photosOf(PLANT_ID).map((photo) => photo.position),
    ).toEqual([0, 1, 2, 3])
    expect(bucketPaths(context.storage)).toEqual(
      filesOf(context.rows.photosOf(PLANT_ID)),
    )
  })

  it('cancelar con tres fotos subiendo a la vez: las tres quedan canceladas y sin archivos (#285)', async () => {
    const context = setup()
    context.storage.delayMs = 20
    const photos = newPhotos(3)
    const controller = new AbortController()
    const result = await uploadPlantPhotos(photos, {
      ...options(context),
      signal: controller.signal,
      onProgress: (value) => {
        if (value.index === 2 && value.step === 'uploading') controller.abort()
      },
    })
    expect(
      result.results.map((value) =>
        value.status === 'failed' ? value.error.reason : value.status,
      ),
    ).toEqual(['aborted', 'aborted', 'aborted'])
    await vi.waitFor(() => expect(bucketPaths(context.storage)).toEqual([]))
    expect(context.rows.photosOf(PLANT_ID)).toEqual([])
  })

  it('sube como mucho tres fotos a la vez y crea las filas de una en una (#285)', async () => {
    const context = setup()
    context.storage.delayMs = 5
    let uploading = 0
    let maxUploading = 0
    const upload = context.storage.upload.bind(context.storage)
    vi.spyOn(context.storage, 'upload').mockImplementation(async (...args) => {
      uploading += 1
      maxUploading = Math.max(maxUploading, uploading)
      try {
        await upload(...args)
      } finally {
        uploading -= 1
      }
    })
    let inserting = 0
    let maxInserting = 0
    const insert = context.rows.insert.bind(context.rows)
    vi.spyOn(context.rows, 'insert').mockImplementation(async (row) => {
      inserting += 1
      maxInserting = Math.max(maxInserting, inserting)
      try {
        await new Promise((resolve) => setTimeout(resolve, 5))
        return await insert(row)
      } finally {
        inserting -= 1
      }
    })
    const result = await uploadPlantPhotos(newPhotos(6), options(context))
    expect(result.complete).toBe(true)
    // Tres fotos, cada una con su foto y su miniatura.
    expect(maxUploading).toBe(6)
    expect(maxInserting).toBe(1)
    expect(
      context.rows.photosOf(PLANT_ID).map((photo) => photo.position),
    ).toEqual([0, 1, 2, 3, 4, 5])
    expect(context.rows.plants.get(PLANT_ID)?.photoPath).toBe(
      context.rows.photosOf(PLANT_ID)[0]?.photoPath,
    )
  })

  it('con la señal ya cancelada no lee ni sube nada', async () => {
    const context = setup()
    const list = vi.spyOn(context.rows, 'list')
    await expect(
      uploadPlantPhotos(newPhotos(1), {
        ...options(context),
        signal: AbortSignal.abort(),
      }),
    ).rejects.toMatchObject({ reason: 'aborted' })
    expect(list).not.toHaveBeenCalled()
  })

  it('si no puede leer las fotos de la planta, rechaza sin subir', async () => {
    const context = setup()
    context.rows.failList = () =>
      new PhotoStorageError('offline', { uncertain: true })
    await expect(
      uploadPlantPhotos(newPhotos(1), options(context)),
    ).rejects.toMatchObject({ reason: 'offline' })
    expect(context.storage.objects.size).toBe(0)
  })

  it('añadir a una planta con fotos: van detrás de la última', async () => {
    const context = setup()
    const initial = newPhotos(3)
    await uploadPlantPhotos(initial, options(context))
    // Se quita la segunda: queda un hueco en la posición 1.
    const [, second] = context.rows.photosOf(PLANT_ID)
    await removeStoredPlantPhoto({ ...options(context), photo: second })
    const onPlantUpdated = vi.fn()

    const result = await uploadPlantPhotos(newPhotos(2), {
      ...options(context),
      onPlantUpdated,
    })

    expect(result.photos.map((photo) => photo.position)).toEqual([0, 2, 3, 4])
    // La principal no cambió, pero sí el número de fotos: se relee la planta.
    expect(onPlantUpdated).toHaveBeenCalledOnce()
    expect(onPlantUpdated.mock.calls[0]?.[0]).toMatchObject({ photoCount: 4 })

    // Cuando ya no hay sitio al final, ocupa el hueco.
    await uploadPlantPhotos(newPhotos(1), options(context))
    const last = await uploadPlantPhotos(newPhotos(1), options(context))
    expect(last.photos.map((photo) => photo.position)).toEqual([
      0, 1, 2, 3, 4, 5,
    ])
  })

  it('si otra foto ocupa la posición (23505), usa la siguiente libre', async () => {
    const context = setup()
    const [photo] = newPhotos(1)
    let first = true
    context.rows.failInsert = (row) => {
      if (!first) return null
      first = false
      // Otro dispositivo guarda una foto en esa posición justo antes.
      context.rows.rows.set('ajena', {
        id: 'ajena',
        plantId: PLANT_ID,
        userId: USER_ID,
        photoPath: `${USER_ID}/${PLANT_ID}/photo-ajena.webp`,
        thumbnailPath: `${USER_ID}/${PLANT_ID}/thumb-ajena.webp`,
        inBloom: false,
        takenAt: null,
        note: null,
        position: row.position,
        createdAt: '2026-11-22T12:00:00.000Z',
      })
      return { error: new PhotoStorageError('position-taken') }
    }

    const result = await uploadPlantPhotos([photo], options(context))

    expect(result.results[0]).toMatchObject({ status: 'uploaded' })
    expect(
      context.rows.photosOf(PLANT_ID).map((saved) => saved.position),
    ).toEqual([0, 1])
  })

  it('si la base rechaza por posición y ya no queda sitio, es "too-many-photos" y no deja archivos', async () => {
    const context = setup()
    const [photo] = newPhotos(1)
    await uploadPlantPhotos(newPhotos(5), options(context))
    context.rows.failInsert = (row) => {
      context.rows.rows.set('ajena', {
        id: 'ajena',
        plantId: PLANT_ID,
        userId: USER_ID,
        photoPath: `${USER_ID}/${PLANT_ID}/photo-ajena.webp`,
        thumbnailPath: `${USER_ID}/${PLANT_ID}/thumb-ajena.webp`,
        inBloom: false,
        takenAt: null,
        note: null,
        position: row.position,
        createdAt: '2026-11-22T12:00:00.000Z',
      })
      context.rows.failInsert = undefined
      return { error: new PhotoStorageError('position-taken') }
    }
    const before = bucketPaths(context.storage)

    const result = await uploadPlantPhotos([photo], options(context))

    expect(result.results[0]).toMatchObject({
      status: 'failed',
      error: { reason: 'too-many-photos' },
    })
    expect(bucketPaths(context.storage)).toEqual(before)
  })

  it('la misma foto dos veces en una llamada es un error de quien llama', async () => {
    const context = setup()
    const [photo] = newPhotos(1)
    await expect(
      uploadPlantPhotos([photo, photo], options(context)),
    ).rejects.toThrow('dos veces')
  })
})

describe('listPlantPhotos', () => {
  it('devuelve las fotos de la planta en orden, la principal primero', async () => {
    const context = setup()
    await uploadPlantPhotos(newPhotos(3), options(context))
    // Se reordenan a mano (lo hará la galería del detalle, #183).
    const ids = context.rows.photosOf(PLANT_ID).map((photo) => photo.id)
    const positions = [4, 0, 2]
    ids.forEach((id, index) => {
      const row = context.rows.rows.get(id)
      if (row) row.position = positions[index]
    })

    const photos = await listPlantPhotos({
      userId: USER_ID,
      plantId: PLANT_ID.toUpperCase(),
      rows: context.rows,
    })

    expect(photos.map((photo) => photo.id)).toEqual([ids[1], ids[2], ids[0]])
    expect(photos.map((photo) => photo.position)).toEqual([0, 2, 4])
  })

  it('sin fotos devuelve una lista vacía, y no ve las de otra cuenta', async () => {
    const context = setup()
    await uploadPlantPhotos(newPhotos(1), options(context))
    expect(
      await listPlantPhotos({
        userId: OTHER_USER,
        plantId: PLANT_ID,
        rows: context.rows,
      }),
    ).toEqual([])
  })
})

describe('removeStoredPlantPhoto', () => {
  it('quitar la principal: borra la fila, promueve la siguiente y después borra sus archivos', async () => {
    const context = setup()
    await uploadPlantPhotos(newPhotos(3), options(context))
    const [main, next] = context.rows.photosOf(PLANT_ID)
    const order: string[] = []
    const remove = context.rows.remove.bind(context.rows)
    vi.spyOn(context.rows, 'remove').mockImplementation((...args) => {
      order.push('borrar fila')
      expect(context.storage.objects.has(main.photoPath)).toBe(true)
      return remove(...args)
    })
    const removeFiles = context.storage.remove.bind(context.storage)
    vi.spyOn(context.storage, 'remove').mockImplementation((paths) => {
      order.push('borrar archivos')
      return removeFiles(paths)
    })
    const updated: CollectionPlant[] = []

    const result = await removeStoredPlantPhoto({
      ...options(context),
      photo: main,
      onPlantUpdated: (value) => {
        order.push('reflejar')
        updated.push(value)
      },
    })

    expect(order).toEqual(['borrar fila', 'reflejar', 'borrar archivos'])
    expect(result).toMatchObject({ photosDeleted: true, leftovers: [] })
    const left = context.rows.photosOf(PLANT_ID)
    expect(left.map((photo) => photo.id)).not.toContain(main.id)
    expect(left[0].id).toBe(next.id)
    // La tarjeta del inventario pasa a mostrar la siguiente.
    expect(updated[0].photoPath).toBe(next.photoPath)
    expect(context.storage.objects.has(main.photoPath)).toBe(false)
    expect(context.storage.objects.has(main.thumbnailPath)).toBe(false)
    expect(bucketPaths(context.storage)).toEqual(filesOf(left))
  })

  it('quitar la única foto deja la planta sin foto', async () => {
    const context = setup()
    await uploadPlantPhotos(newPhotos(1), options(context))
    const [only] = context.rows.photosOf(PLANT_ID)
    const updated = vi.fn()
    await removeStoredPlantPhoto({
      ...options(context),
      photo: only,
      onPlantUpdated: updated,
    })
    expect(updated).toHaveBeenCalledWith(
      expect.objectContaining({ photoPath: null, thumbnailPath: null }),
    )
    expect(context.storage.objects.size).toBe(0)
  })

  it('si falla el borrado de la fila, no toca los archivos', async () => {
    const context = setup()
    await uploadPlantPhotos(newPhotos(1), options(context))
    const [only] = context.rows.photosOf(PLANT_ID)
    context.rows.failRemove = () => ({
      error: new PhotoStorageError('offline'),
    })
    await expect(
      removeStoredPlantPhoto({ ...options(context), photo: only }),
    ).rejects.toMatchObject({ reason: 'offline' })
    expect(context.storage.objects.size).toBe(2)
    expect(context.rows.photosOf(PLANT_ID)).toHaveLength(1)
  })

  it('si fallan los archivos, la fila ya no existe y lo dice', async () => {
    const context = setup()
    await uploadPlantPhotos(newPhotos(2), options(context))
    const [, second] = context.rows.photosOf(PLANT_ID)
    vi.spyOn(context.storage, 'remove').mockRejectedValue(
      new PhotoStorageError('offline', { uncertain: true }),
    )
    const result = await removeStoredPlantPhoto({
      ...options(context),
      photo: second,
    })
    expect(result.photosDeleted).toBe(false)
    expect(result.leftovers.sort()).toEqual(filesOf([second]))
    expect(context.rows.photosOf(PLANT_ID)).toHaveLength(1)
  })

  it('reintentar cuando la fila ya se borró (respuesta perdida) termina con los archivos', async () => {
    const context = setup()
    await uploadPlantPhotos(newPhotos(1), options(context))
    const [only] = context.rows.photosOf(PLANT_ID)
    context.rows.failRemove = () => ({
      error: new PhotoStorageError('offline', { uncertain: true }),
      applied: true,
    })
    await expect(
      removeStoredPlantPhoto({ ...options(context), photo: only }),
    ).rejects.toMatchObject({ reason: 'offline' })
    expect(context.storage.objects.size).toBe(2)

    context.rows.failRemove = undefined
    const result = await removeStoredPlantPhoto({
      ...options(context),
      photo: only,
    })
    expect(result.photosDeleted).toBe(true)
    expect(context.storage.objects.size).toBe(0)
  })
})

describe('checkPlantPhotoDetails', () => {
  const today = '2026-11-22'

  it('normaliza: sin fecha ni nota, null; la nota sin espacios a los lados', () => {
    expect(
      checkPlantPhotoDetails(
        { takenAt: '', note: '   ', inBloom: false },
        today,
      ),
    ).toEqual({
      details: { takenAt: null, note: null, inBloom: false },
      problems: {},
    })
    expect(
      checkPlantPhotoDetails(
        { takenAt: '2026-11-22', note: '  Primera vara \n', inBloom: true },
        today,
      ).details,
    ).toEqual({ takenAt: '2026-11-22', note: 'Primera vara', inBloom: true })
  })

  it('una fecha posterior a hoy o que no existe, y una nota de más de 500', () => {
    expect(
      checkPlantPhotoDetails(
        { takenAt: '2026-11-23', note: 'a'.repeat(501), inBloom: false },
        today,
      ).problems,
    ).toEqual({ takenAt: 'future', note: 'too-long' })
    expect(
      checkPlantPhotoDetails(
        { takenAt: '2026-02-30', note: '', inBloom: false },
        today,
      ).problems,
    ).toEqual({ takenAt: 'invalid' })
  })

  it('cuenta los caracteres como la base, no las unidades de UTF-16', () => {
    // 500 emojis: 1000 unidades de UTF-16, pero 500 caracteres.
    expect(
      checkPlantPhotoDetails(
        { takenAt: '', note: '🌸'.repeat(500), inBloom: false },
        today,
      ).problems,
    ).toEqual({})
  })
})

describe('updatePlantPhoto', () => {
  it('guarda la fecha y la nota de una foto que no es la principal sin releer la planta', async () => {
    const context = setup()
    await uploadPlantPhotos(newPhotos(2), options(context))
    const [, second] = context.rows.photosOf(PLANT_ID)
    const readPlant = vi.spyOn(context.rows, 'readPlant')
    const onPlantUpdated = vi.fn()

    const result = await updatePlantPhoto({
      ...options(context),
      photo: second,
      main: false,
      changes: { takenAt: '2026-11-20', note: '  Vara nueva  ', inBloom: true },
      onPlantUpdated,
    })

    expect(result.photo).toMatchObject({
      id: second.id,
      takenAt: '2026-11-20',
      note: 'Vara nueva',
      inBloom: true,
      position: second.position,
    })
    expect(result.plant).toBeNull()
    expect(readPlant).not.toHaveBeenCalled()
    expect(onPlantUpdated).not.toHaveBeenCalled()
    expect(context.rows.photosOf(PLANT_ID)[1].note).toBe('Vara nueva')
  })

  it('«en floración» de la principal pasa a la planta y se relee', async () => {
    const context = setup()
    await uploadPlantPhotos(newPhotos(2), options(context))
    const [main] = context.rows.photosOf(PLANT_ID)
    const onPlantUpdated = vi.fn()

    const result = await updatePlantPhoto({
      ...options(context),
      photo: main,
      main: true,
      changes: { inBloom: true },
      onPlantUpdated,
    })

    expect(result.plant?.photoInBloom).toBe(true)
    expect(onPlantUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ id: PLANT_ID, photoInBloom: true }),
    )
  })

  it('una nota vacía se guarda como null; lo que no cumple las reglas no se envía', async () => {
    const context = setup()
    await uploadPlantPhotos(
      [{ files: processedPhoto(), note: 'Antes' }],
      options(context),
    )
    const [main] = context.rows.photosOf(PLANT_ID)
    const update = vi.spyOn(context.rows, 'update')

    const cleared = await updatePlantPhoto({
      ...options(context),
      photo: main,
      main: true,
      changes: { note: '   ' },
    })
    expect(cleared.photo.note).toBeNull()

    update.mockClear()
    await expect(
      updatePlantPhoto({
        ...options(context),
        photo: main,
        main: true,
        changes: { note: 'x'.repeat(501) },
      }),
    ).rejects.toMatchObject({ reason: 'failed' })
    await expect(
      updatePlantPhoto({
        ...options(context),
        photo: main,
        main: true,
        changes: { takenAt: '2999-01-01' },
      }),
    ).rejects.toMatchObject({ reason: 'failed' })
    expect(update).not.toHaveBeenCalled()
  })

  it('una foto que ya no existe es «not-found»; sin conexión, «offline»', async () => {
    const context = setup()
    await uploadPlantPhotos(newPhotos(1), options(context))
    const [main] = context.rows.photosOf(PLANT_ID)
    await expect(
      updatePlantPhoto({
        ...options(context),
        photo: { id: 'no-existe', inBloom: false },
        main: false,
        changes: { note: 'Hola' },
      }),
    ).rejects.toMatchObject({ reason: 'not-found' })

    context.rows.failUpdate = () => ({
      error: new PhotoStorageError('offline', { uncertain: true }),
    })
    await expect(
      updatePlantPhoto({
        ...options(context),
        photo: main,
        main: true,
        changes: { note: 'Hola' },
      }),
    ).rejects.toMatchObject({ reason: 'offline' })
    expect(context.rows.photosOf(PLANT_ID)[0].note).toBeNull()
  })

  it('otra cuenta no puede cambiar la foto', async () => {
    const context = setup()
    await uploadPlantPhotos(newPhotos(1), options(context))
    const [main] = context.rows.photosOf(PLANT_ID)
    await expect(
      updatePlantPhoto({
        ...options(context),
        userId: OTHER_USER,
        photo: main,
        main: true,
        changes: { note: 'Ajena' },
      }),
    ).rejects.toMatchObject({ reason: 'not-found' })
  })
})

describe('orden de las fotos', () => {
  const photos = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('orderWithMain pone la elegida primero y conserva el resto', () => {
    expect(orderWithMain(photos, 'c')).toEqual(['c', 'a', 'b'])
    expect(orderWithMain(photos, 'a')).toEqual(['a', 'b', 'c'])
    expect(orderWithMain(photos, 'z')).toEqual(['a', 'b', 'c'])
  })

  it('orderWithMove la cambia con la vecina; en un extremo no cambia nada', () => {
    expect(orderWithMove(photos, 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(orderWithMove(photos, 'b', 1)).toEqual(['a', 'c', 'b'])
    expect(orderWithMove(photos, 'a', -1)).toEqual(['a', 'b', 'c'])
    expect(orderWithMove(photos, 'c', 1)).toEqual(['a', 'b', 'c'])
  })
})

describe('reorderPlantPhotos', () => {
  it('con 6 fotos (sin posiciones libres) cambia la principal de una vez y relee la planta', async () => {
    const context = setup()
    await uploadPlantPhotos(newPhotos(6), options(context))
    const before = context.rows.photosOf(PLANT_ID)
    const last = before[5]
    const reorder = vi.spyOn(context.rows, 'reorder')
    const onPlantUpdated = vi.fn()

    const result = await reorderPlantPhotos({
      ...options(context),
      photos: before,
      order: orderWithMain(before, last.id),
      onPlantUpdated,
    })

    // Una sola escritura: nunca una galería a medias.
    expect(reorder).toHaveBeenCalledTimes(1)
    expect(result.photos.map((photo) => photo.id)).toEqual([
      last.id,
      ...before.slice(0, 5).map((photo) => photo.id),
    ])
    expect(result.photos.map((photo) => photo.position)).toEqual([
      0, 1, 2, 3, 4, 5,
    ])
    // La tarjeta del inventario pasa a mostrar la nueva principal.
    expect(result.plant).toMatchObject({
      photoPath: last.photoPath,
      thumbnailPath: last.thumbnailPath,
    })
    expect(onPlantUpdated).toHaveBeenCalledWith(result.plant)
  })

  it('mover una que no es la principal no relee la planta', async () => {
    const context = setup()
    await uploadPlantPhotos(newPhotos(3), options(context))
    const before = context.rows.photosOf(PLANT_ID)
    const onPlantUpdated = vi.fn()
    const result = await reorderPlantPhotos({
      ...options(context),
      photos: before,
      order: orderWithMove(before, before[1].id, 1),
      onPlantUpdated,
    })
    expect(result.photos.map((photo) => photo.id)).toEqual([
      before[0].id,
      before[2].id,
      before[1].id,
    ])
    expect(result.plant).toBeNull()
    expect(onPlantUpdated).not.toHaveBeenCalled()
  })

  it('el mismo orden no envía nada', async () => {
    const context = setup()
    await uploadPlantPhotos(newPhotos(2), options(context))
    const before = context.rows.photosOf(PLANT_ID)
    const reorder = vi.spyOn(context.rows, 'reorder')
    const result = await reorderPlantPhotos({
      ...options(context),
      photos: before,
      order: orderWithMove(before, before[0].id, -1),
    })
    expect(reorder).not.toHaveBeenCalled()
    expect(result.photos).toEqual(before)
  })

  it('si otra foto se añadió entre tanto, rechaza con «position-taken» y no cambia nada', async () => {
    const context = setup()
    await uploadPlantPhotos(newPhotos(2), options(context))
    const before = context.rows.photosOf(PLANT_ID)
    await uploadPlantPhotos(newPhotos(1), options(context))

    await expect(
      reorderPlantPhotos({
        ...options(context),
        photos: before,
        order: orderWithMain(before, before[1].id),
      }),
    ).rejects.toMatchObject({ reason: 'position-taken' })
    expect(context.rows.photosOf(PLANT_ID)[0].id).toBe(before[0].id)
  })

  it('sin conexión rechaza con «offline» y el orden queda como estaba', async () => {
    const context = setup()
    await uploadPlantPhotos(newPhotos(2), options(context))
    const before = context.rows.photosOf(PLANT_ID)
    context.rows.failReorder = () => ({
      error: new PhotoStorageError('offline', { uncertain: true }),
    })
    await expect(
      reorderPlantPhotos({
        ...options(context),
        photos: before,
        order: orderWithMain(before, before[1].id),
      }),
    ).rejects.toMatchObject({ reason: 'offline' })
    expect(context.rows.photosOf(PLANT_ID)).toEqual(before)
  })

  it('un orden con otras fotos es un error de quien llama', async () => {
    const context = setup()
    await uploadPlantPhotos(newPhotos(2), options(context))
    const before = context.rows.photosOf(PLANT_ID)
    await expect(
      reorderPlantPhotos({
        ...options(context),
        photos: before,
        order: [before[0].id, before[0].id],
      }),
    ).rejects.toThrow('El orden nuevo no tiene las mismas fotos.')
  })
})
