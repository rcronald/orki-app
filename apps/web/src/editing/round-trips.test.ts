import { describe, expect, it, vi } from 'vitest'
import type { CollectionPlant } from '../collection/model.ts'
import { uploadPlantPhotos } from '../photos/gallery.ts'
import { createMemoryPlantPhotoRows } from '../photos/memory-photo-rows.ts'
import { createMemoryPhotoStorage } from '../photos/memory-storage.ts'
import type { PlantPhotoRows, StoredPlantPhoto } from '../photos/photo-rows.ts'
import type { PhotoStorage } from '../photos/storage.ts'
import type { PlantPatch } from '../registration/form-state.ts'
import { plant } from '../test/collection.ts'
import { PLANT_ID, processedPhoto, USER_ID } from '../test/photos.ts'
import { createTripCounter } from '../test/round-trips.ts'
import {
  applyPlantEdit,
  type PlannedPhoto,
  type PlantEditPlan,
} from './edit-plan.ts'

// Cuántas peticiones y cuántos viajes de ida y vuelta en serie hace guardar
// (#285). Los dobles en memoria hacen lo mismo que la base y el bucket; cada
// llamada es una petición HTTP en la app. Objetivo del issue: el caso de
// ejemplo de la edición (2 fotos nuevas, 1 quitada y la nota de una foto
// cambiada) en 6 viajes o menos.

const ROW_METHODS: (keyof PlantPhotoRows)[] = [
  'list',
  'insert',
  'insertMany',
  'remove',
  'removeMany',
  'update',
  'reorder',
  'readPlant',
]
const STORAGE_METHODS: (keyof PhotoStorage)[] = ['upload', 'remove']

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
  const counter = createTripCounter()
  const updatePlant = counter.track(
    'plants.update',
    vi.fn((_plantId: string, patch: PlantPatch) => {
      const current = rows.plants.get(PLANT_ID)
      if (!current) throw new Error('Sin planta.')
      if (patch.nickname !== undefined) current.nickname = patch.nickname
      const copy: Partial<typeof current> = { ...current }
      delete copy.userId
      return Promise.resolve(copy as CollectionPlant)
    }),
  )
  return {
    counter,
    rows,
    storage,
    services: {
      rows: counter.wrap(rows, 'rows', ROW_METHODS),
      storage: counter.wrap(storage, 'storage', STORAGE_METHODS),
      updatePlant,
    },
    stored: rows.photosOf(PLANT_ID),
  }
}

const keep = (photo: StoredPlantPhoto, note = photo.note): PlannedPhoto => ({
  kind: 'stored',
  key: `guardada-${photo.id}`,
  stored: photo,
  details: { takenAt: photo.takenAt, note, inBloom: photo.inBloom },
})

let counter = 0
const added = (): PlannedPhoto => {
  counter += 1
  return {
    kind: 'new',
    key: `nueva-${String(counter)}`,
    files: processedPhoto(),
    details: { takenAt: null, note: null, inBloom: false },
  }
}

/** El caso de ejemplo del issue, con y sin cambios en los datos de la planta. */
function example(patch: PlantPatch, newMain = false) {
  const context = setup(3)
  const [p0, p1, p2] = context.stored
  if (!p0 || !p1 || !p2) throw new Error('Sin fotos.')
  const a = added()
  const b = added()
  const photos = newMain
    ? [a, keep(p0, 'Nueva vara'), keep(p2), b]
    : [keep(p0, 'Nueva vara'), keep(p2), a, b]
  const plan: PlantEditPlan = {
    userId: USER_ID,
    plantId: PLANT_ID,
    patch,
    photos,
    removed: [p1],
  }
  return { context, plan }
}

describe('peticiones y viajes al guardar la edición (#285)', () => {
  it('2 fotos nuevas, 1 quitada y la nota de una foto', async () => {
    const { context, plan } = example({})
    await applyPlantEdit(plan, context.services, new Map())
    const { counter } = context
    expect({
      peticiones: counter.requests.length,
      viajes: counter.trips(),
    }).toMatchInlineSnapshot(`
      {
        "peticiones": 10,
        "viajes": 4,
      }
    `)
    // Lo de siempre: las filas y el bucket como deben.
    expect(context.rows.photosOf(PLANT_ID)).toHaveLength(4)
    expect([...context.storage.objects.keys()].sort()).toEqual(
      context.rows
        .photosOf(PLANT_ID)
        .flatMap((photo) => [photo.photoPath, photo.thumbnailPath])
        .sort(),
    )
  })

  it('lo mismo con un cambio en los datos de la planta', async () => {
    const { context, plan } = example({ nickname: 'La reina' })
    await applyPlantEdit(plan, context.services, new Map())
    const { counter } = context
    expect({
      peticiones: counter.requests.length,
      viajes: counter.trips(),
    }).toMatchInlineSnapshot(`
      {
        "peticiones": 11,
        "viajes": 5,
      }
    `)
  })

  it('con una foto nueva como principal (hace falta el orden)', async () => {
    const { context, plan } = example({}, true)
    await applyPlantEdit(plan, context.services, new Map())
    const { counter } = context
    expect({
      peticiones: counter.requests.length,
      viajes: counter.trips(),
    }).toMatchInlineSnapshot(`
      {
        "peticiones": 11,
        "viajes": 5,
      }
    `)
    expect(context.rows.plants.get(PLANT_ID)?.photoPath).toBe(
      context.rows.photosOf(PLANT_ID)[0]?.photoPath,
    )
  })
})

describe('lo que sale a la vez al guardar la edición (#285)', () => {
  it('nunca dos escrituras que copian la principal a la planta a la vez, y como mucho tres fotos subiendo', async () => {
    const context = setup(6)
    const [p0, p1, p2, p3, p4, p5] = context.stored
    if (!p0 || !p1 || !p2 || !p3 || !p4 || !p5) throw new Error('Sin fotos.')
    const photos = [added(), added(), added(), added()]
    const [a, b, c, d] = photos
    if (!a || !b || !c || !d) throw new Error('Sin fotos nuevas.')
    // Quitar cuatro y añadir cuatro (con seis no caben a la vez), cambiar
    // «en flor» de dos y la nota de otra, y la nueva como principal.
    const bloom = (photo: StoredPlantPhoto): PlannedPhoto => ({
      ...keep(photo),
      details: { takenAt: null, note: null, inBloom: true },
    })
    const plan: PlantEditPlan = {
      userId: USER_ID,
      plantId: PLANT_ID,
      patch: {},
      photos: [a, bloom(p0), bloom(p1), b, c, d],
      removed: [p2, p3, p4, p5],
    }
    let syncing = 0
    let maxSyncing = 0
    let uploading = 0
    let maxUploading = 0
    const slow =
      <A extends unknown[], R>(
        fn: (...args: A) => Promise<R>,
        fires: (...args: NoInfer<A>) => boolean,
      ) =>
      async (...args: A): Promise<R> => {
        const counts = fires(...args)
        if (counts) syncing += 1
        maxSyncing = Math.max(maxSyncing, syncing)
        try {
          await new Promise((resolve) => setTimeout(resolve, 5))
          return await fn(...args)
        } finally {
          if (counts) syncing -= 1
        }
      }
    const rows = context.rows
    const services = {
      ...context.services,
      rows: {
        ...context.services.rows,
        list: rows.list.bind(rows),
        readPlant: rows.readPlant.bind(rows),
        insertMany: slow(rows.insertMany.bind(rows), () => true),
        removeMany: slow(rows.removeMany.bind(rows), () => true),
        reorder: slow(rows.reorder.bind(rows), () => true),
        update: slow(
          rows.update.bind(rows),
          (_id, _user, changes) => changes.inBloom !== undefined,
        ),
      },
      storage: {
        ...context.storage,
        remove: context.storage.remove.bind(context.storage),
        upload: async (...args: Parameters<PhotoStorage['upload']>) => {
          uploading += 1
          maxUploading = Math.max(maxUploading, uploading)
          try {
            await new Promise((resolve) => setTimeout(resolve, 5))
            await context.storage.upload(...args)
          } finally {
            uploading -= 1
          }
        },
      },
    }
    await applyPlantEdit(plan, services, new Map())
    expect(maxSyncing).toBe(1)
    expect(maxUploading).toBe(6)
    const result = rows.photosOf(PLANT_ID)
    expect(result).toHaveLength(6)
    expect(result.slice(1, 3).map((photo) => photo.inBloom)).toEqual([
      true,
      true,
    ])
    expect(rows.plants.get(PLANT_ID)?.photoPath).toBe(result[0]?.photoPath)
    expect([...context.storage.objects.keys()].sort()).toEqual(
      result.flatMap((photo) => [photo.photoPath, photo.thumbnailPath]).sort(),
    )
  })
})

describe('peticiones y viajes al registrar con fotos (#285)', () => {
  it('3 fotos en una planta recién creada', async () => {
    const context = setup(0)
    const onPlantUpdated = vi.fn()
    const result = await uploadPlantPhotos(
      [0, 1, 2].map(() => ({ files: processedPhoto() })),
      {
        userId: USER_ID,
        plantId: PLANT_ID,
        storage: context.services.storage,
        rows: context.services.rows,
        onPlantUpdated,
      },
    )
    expect(result.complete).toBe(true)
    const { counter } = context
    expect({
      peticiones: counter.requests.length,
      viajes: counter.trips(),
      lecturasDeFotos: counter.count('rows.list'),
    }).toMatchInlineSnapshot(`
      {
        "lecturasDeFotos": 1,
        "peticiones": 11,
        "viajes": 6,
      }
    `)
    expect(onPlantUpdated).toHaveBeenCalledTimes(1)
    expect(
      context.rows.photosOf(PLANT_ID).map((photo) => photo.position),
    ).toEqual([0, 1, 2])
  })
})
