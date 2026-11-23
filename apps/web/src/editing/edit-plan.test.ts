import { describe, expect, it, vi } from 'vitest'
import type { CollectionPlant } from '../collection/model.ts'
import { createMemoryPlantPhotoRows } from '../photos/memory-photo-rows.ts'
import { createMemoryPhotoStorage } from '../photos/memory-storage.ts'
import type { StoredPlantPhoto } from '../photos/photo-rows.ts'
import { PhotoStorageError } from '../photos/storage.ts'
import { photoVersionFor, type PhotoFiles } from '../photos/upload.ts'
import type { PlantPatch } from '../registration/form-state.ts'
import { PlantSaveError } from '../registration/save-plant.ts'
import { plant } from '../test/collection.ts'
import { PLANT_ID, processedPhoto, USER_ID } from '../test/photos.ts'
import {
  applyPlantEdit,
  discardUploads,
  PlantEditError,
  type PlannedPhoto,
  type PlannedPhotoDetails,
  type PlantEditEvent,
  type PlantEditPlan,
  type UploadedPhotos,
} from './edit-plan.ts'

const NO_DETAILS: PlannedPhotoDetails = {
  takenAt: null,
  note: null,
  inBloom: false,
}

/** Bucket y filas en memoria con la planta y `count` fotos guardadas. */
function setup(count: number) {
  const storage = createMemoryPhotoStorage()
  const rows = createMemoryPlantPhotoRows()
  rows.plants.set(PLANT_ID, {
    ...plant({ id: PLANT_ID, photoPath: null, thumbnailPath: null }),
    userId: USER_ID,
  })
  for (let position = 0; position < count; position += 1) {
    const id = `foto-${String(position)}`
    const photoPath = `${USER_ID}/${PLANT_ID}/photo-g${String(position)}.webp`
    const thumbnailPath = `${USER_ID}/${PLANT_ID}/thumb-g${String(position)}.webp`
    rows.rows.set(id, {
      id,
      plantId: PLANT_ID,
      userId: USER_ID,
      photoPath,
      thumbnailPath,
      inBloom: false,
      takenAt: null,
      note: null,
      position,
      createdAt: '2026-11-22T12:00:00.000Z',
    })
    for (const path of [photoPath, thumbnailPath]) {
      storage.objects.set(path, {
        blob: new Blob([new Uint8Array(4)]),
        contentType: 'image/webp',
      })
    }
  }
  const updatePlant = vi.fn((_plantId: string, patch: PlantPatch) => {
    const current = rows.plants.get(PLANT_ID)
    if (!current) throw new Error('Sin planta.')
    if (patch.nickname !== undefined) current.nickname = patch.nickname
    const copy: Partial<typeof current> = { ...current }
    delete copy.userId
    return Promise.resolve(copy as CollectionPlant)
  })
  const stored = rows.photosOf(PLANT_ID)
  return { storage, rows, updatePlant, stored }
}

type Context = ReturnType<typeof setup>

function keep(
  photo: StoredPlantPhoto,
  details?: PlannedPhotoDetails,
): PlannedPhoto {
  return {
    kind: 'stored',
    key: `guardada-${photo.id}`,
    stored: photo,
    details: details ?? {
      takenAt: photo.takenAt,
      note: photo.note,
      inBloom: photo.inBloom,
    },
  }
}

let counter = 0
function added(files: PhotoFiles = processedPhoto()): PlannedPhoto & {
  kind: 'new'
} {
  counter += 1
  return {
    kind: 'new',
    key: `nueva-${String(counter)}`,
    files,
    details: NO_DETAILS,
  }
}

function plan(
  photos: PlannedPhoto[],
  removed: StoredPlantPhoto[] = [],
  patch: PlantPatch = {},
): PlantEditPlan {
  return { userId: USER_ID, plantId: PLANT_ID, patch, photos, removed }
}

function apply(
  context: Context,
  editPlan: PlantEditPlan,
  uploaded: UploadedPhotos = new Map(),
  onEvent?: (event: PlantEditEvent) => void,
) {
  return applyPlantEdit(
    editPlan,
    {
      rows: context.rows,
      storage: context.storage,
      updatePlant: context.updatePlant,
    },
    uploaded,
    onEvent,
  )
}

/** Rutas de las filas de la planta, en orden. */
const rowPaths = (context: Context) =>
  context.rows.photosOf(PLANT_ID).map((photo) => photo.photoPath)

/** Todas las rutas del bucket, ordenadas. */
const bucket = (context: Context) => [...context.storage.objects.keys()].sort()

/** Las rutas que deberían quedar en el bucket: las de las filas. */
const cited = (context: Context) =>
  context.rows
    .photosOf(PLANT_ID)
    .flatMap((photo) => [photo.photoPath, photo.thumbnailPath])
    .sort()

describe('applyPlantEdit', () => {
  it('sin cambios no escribe nada', async () => {
    const context = setup(2)
    const [first, second] = context.stored
    if (!first || !second) throw new Error('Sin fotos.')
    const spies = [
      vi.spyOn(context.rows, 'insert'),
      vi.spyOn(context.rows, 'remove'),
      vi.spyOn(context.rows, 'update'),
      vi.spyOn(context.rows, 'reorder'),
      vi.spyOn(context.storage, 'upload'),
      vi.spyOn(context.storage, 'remove'),
    ]
    const result = await apply(context, plan([keep(first), keep(second)]))
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    expect(context.updatePlant).not.toHaveBeenCalled()
    expect(result.plant).toBeNull()
    expect(result.photos.map((photo) => photo.id)).toEqual([
      first.id,
      second.id,
    ])
  })

  it('quitar la principal y añadir dos: la siguiente pasa a ser la principal y los archivos quitados se borran al final', async () => {
    const context = setup(2)
    const [first, second] = context.stored
    if (!first || !second) throw new Error('Sin fotos.')
    const a = added()
    const b = added()
    const calls: string[] = []
    const removeRow = context.rows.remove.bind(context.rows)
    vi.spyOn(context.rows, 'remove').mockImplementation((...args) => {
      calls.push('fila quitada')
      return removeRow(...args)
    })
    const removeFiles = context.storage.remove.bind(context.storage)
    vi.spyOn(context.storage, 'remove').mockImplementation((paths) => {
      calls.push('archivos borrados')
      return removeFiles(paths)
    })

    const result = await apply(context, plan([keep(second), a, b], [first]))

    expect(calls).toEqual(['fila quitada', 'archivos borrados'])
    const photos = context.rows.photosOf(PLANT_ID)
    expect(photos).toHaveLength(3)
    expect(photos[0]?.id).toBe(second.id)
    expect(context.rows.plants.get(PLANT_ID)?.photoPath).toBe(second.photoPath)
    // Sin huérfanos ni archivos perdidos: el bucket es lo que citan las filas.
    expect(bucket(context)).toEqual(cited(context))
    expect(result.plant?.photoPath).toBe(second.photoPath)
    expect(result.plant?.photoCount).toBe(3)
    expect(result.leftovers).toEqual([])
  })

  it('con seis fotos, quitar dos y añadir dos cabe (las filas se quitan antes de crear las nuevas)', async () => {
    const context = setup(6)
    const [p0, p1, p2, p3, p4, p5] = context.stored
    if (!p0 || !p1 || !p2 || !p3 || !p4 || !p5) throw new Error('Sin fotos.')
    const a = added()
    const b = added()
    await apply(
      context,
      plan([a, keep(p1), keep(p3), b, keep(p4), keep(p5)], [p0, p2]),
    )
    const photos = context.rows.photosOf(PLANT_ID)
    expect(photos).toHaveLength(6)
    expect(photos.map((photo) => photo.id).slice(1, 3)).toEqual([p1.id, p3.id])
    expect(photos[4]?.id).toBe(p4.id)
    // La nueva es la principal.
    expect(context.rows.plants.get(PLANT_ID)?.photoPath).toBe(
      photos[0]?.photoPath,
    )
    expect(photos[0]?.photoPath).toMatch(/\/photo-[^/]+\.webp$/)
    expect(bucket(context)).toEqual(cited(context))
  })

  it('cambia el orden, la principal, la fecha, la nota y «en flor» de una vez', async () => {
    const context = setup(3)
    const [p0, p1, p2] = context.stored
    if (!p0 || !p1 || !p2) throw new Error('Sin fotos.')
    const reorder = vi.spyOn(context.rows, 'reorder')
    await apply(
      context,
      plan([
        keep(p2, {
          takenAt: '2026-10-05',
          note: 'Primera vara',
          inBloom: true,
        }),
        keep(p0),
        keep(p1),
      ]),
    )
    expect(reorder).toHaveBeenCalledTimes(1)
    const photos = context.rows.photosOf(PLANT_ID)
    expect(photos.map((photo) => photo.id)).toEqual([p2.id, p0.id, p1.id])
    expect(photos[0]).toMatchObject({
      takenAt: '2026-10-05',
      note: 'Primera vara',
      inBloom: true,
    })
    expect(context.rows.plants.get(PLANT_ID)).toMatchObject({
      photoPath: p2.photoPath,
      photoInBloom: true,
    })
  })

  it('las fotos nuevas llevan su fecha y su nota en la fila', async () => {
    const context = setup(0)
    const photo = added()
    photo.details = {
      takenAt: '2026-11-01',
      note: 'Recién llegada',
      inBloom: false,
    }
    await apply(context, plan([photo]))
    expect(context.rows.photosOf(PLANT_ID)[0]).toMatchObject({
      takenAt: '2026-11-01',
      note: 'Recién llegada',
      position: 0,
    })
  })

  it('si falla una subida, no cambia nada en la base y el reintento no duplica archivos', async () => {
    const context = setup(1)
    const [p0] = context.stored
    if (!p0) throw new Error('Sin fotos.')
    const a = added()
    const b = added()
    // Falla la foto de la segunda nueva, solo la primera vez.
    let fails = true
    const version = photoVersionFor(b.files)
    context.storage.failUploads = (path) =>
      fails && path.includes(`photo-${version}`)
        ? new PhotoStorageError('offline')
        : null
    const uploaded: UploadedPhotos = new Map()
    const events: PlantEditEvent[] = []
    const editPlan = plan([keep(p0), a, b], [], { nickname: 'La reina' })

    const failure = await apply(context, editPlan, uploaded, (event) =>
      events.push(event),
    ).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(PlantEditError)
    expect(failure).toMatchObject({ step: 'upload', failedKeys: [b.key] })
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'upload-failed', key: b.key }),
    )
    // La base no cambió: ni datos ni filas.
    expect(context.updatePlant).not.toHaveBeenCalled()
    expect(rowPaths(context)).toEqual([p0.photoPath])
    expect(uploaded.has(a.files)).toBe(true)

    fails = false
    const upload = vi.spyOn(context.storage, 'upload')
    await apply(context, editPlan, uploaded)
    // Solo se subió la que faltaba (sus dos archivos).
    expect(upload).toHaveBeenCalledTimes(2)
    expect(context.rows.photosOf(PLANT_ID)).toHaveLength(3)
    expect(context.updatePlant).toHaveBeenCalledTimes(1)
    expect(bucket(context)).toEqual(cited(context))
  })

  it('si falla el guardado de los datos, el reintento no vuelve a subir las fotos', async () => {
    const context = setup(0)
    const a = added()
    context.updatePlant.mockRejectedValueOnce(new PlantSaveError('offline'))
    const uploaded: UploadedPhotos = new Map()
    const editPlan = plan([a], [], { nickname: 'La reina' })

    await expect(apply(context, editPlan, uploaded)).rejects.toMatchObject({
      step: 'data',
    })
    expect(context.rows.photosOf(PLANT_ID)).toEqual([])
    expect(bucket(context)).toHaveLength(2)

    const upload = vi.spyOn(context.storage, 'upload')
    const result = await apply(context, editPlan, uploaded)
    expect(upload).not.toHaveBeenCalled()
    expect(context.rows.photosOf(PLANT_ID)).toHaveLength(1)
    expect(result.plant?.nickname).toBe('La reina')
    expect(bucket(context)).toEqual(cited(context))
  })

  it('una fila que llegó sin respuesta no se crea dos veces al reintentar', async () => {
    const context = setup(0)
    const a = added()
    context.rows.failInsert = () => ({
      error: new PhotoStorageError('offline', { uncertain: true }),
      applied: true,
    })
    const uploaded: UploadedPhotos = new Map()
    await expect(apply(context, plan([a]), uploaded)).rejects.toMatchObject({
      step: 'insert',
    })
    expect(context.rows.photosOf(PLANT_ID)).toHaveLength(1)

    context.rows.failInsert = undefined
    const insert = vi.spyOn(context.rows, 'insert')
    await apply(context, plan([a]), uploaded)
    expect(insert).not.toHaveBeenCalled()
    expect(context.rows.photosOf(PLANT_ID)).toHaveLength(1)
    expect(bucket(context)).toEqual(cited(context))
  })

  it('si falla el orden, las fotos guardadas siguen y el reintento lo completa', async () => {
    const context = setup(2)
    const [p0, p1] = context.stored
    if (!p0 || !p1) throw new Error('Sin fotos.')
    context.rows.failReorder = () => ({
      error: new PhotoStorageError('failed'),
    })
    const editPlan = plan([keep(p1), keep(p0)])
    await expect(apply(context, editPlan)).rejects.toMatchObject({
      step: 'order',
    })
    expect(context.rows.photosOf(PLANT_ID).map((photo) => photo.id)).toEqual([
      p0.id,
      p1.id,
    ])
    context.rows.failReorder = undefined
    await apply(context, editPlan)
    expect(context.rows.photosOf(PLANT_ID).map((photo) => photo.id)).toEqual([
      p1.id,
      p0.id,
    ])
    expect(bucket(context)).toEqual(cited(context))
  })

  it('si falla el borrado de una fila, la foto sigue entera y sus archivos no se tocan', async () => {
    const context = setup(2)
    const [p0, p1] = context.stored
    if (!p0 || !p1) throw new Error('Sin fotos.')
    context.rows.failRemove = () => ({
      error: new PhotoStorageError('offline'),
    })
    await expect(apply(context, plan([keep(p1)], [p0]))).rejects.toMatchObject({
      step: 'remove',
    })
    expect(context.rows.photosOf(PLANT_ID)).toHaveLength(2)
    expect(bucket(context)).toEqual(cited(context))
  })

  it('si los archivos quitados no se pueden borrar, quedan como restos y el guardado termina', async () => {
    const context = setup(2)
    const [p0, p1] = context.stored
    if (!p0 || !p1) throw new Error('Sin fotos.')
    vi.spyOn(context.storage, 'remove').mockRejectedValue(
      new PhotoStorageError('offline'),
    )
    const result = await apply(context, plan([keep(p1)], [p0]))
    expect(result.leftovers).toEqual([p0.photoPath, p0.thumbnailPath])
    expect(context.rows.photosOf(PLANT_ID).map((photo) => photo.id)).toEqual([
      p1.id,
    ])
  })
})

describe('discardUploads', () => {
  it('borra los archivos subidos que no tienen fila y deja los que una fila cita', async () => {
    const context = setup(0)
    const a = added()
    const b = added()
    // a llega a tener fila; b se queda subida sin fila (falló su fila).
    let inserts = 0
    context.rows.failInsert = () => {
      inserts += 1
      return inserts === 2 ? { error: new PhotoStorageError('failed') } : null
    }
    const uploaded: UploadedPhotos = new Map()
    await expect(apply(context, plan([a, b]), uploaded)).rejects.toMatchObject({
      step: 'insert',
    })
    expect(bucket(context)).toHaveLength(4)

    await discardUploads(
      uploaded,
      { userId: USER_ID, plantId: PLANT_ID },
      context,
    )
    expect(bucket(context)).toEqual(cited(context))
    expect(uploaded.size).toBe(0)
  })
})
