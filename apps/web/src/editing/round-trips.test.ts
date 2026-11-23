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
        "viajes": 6,
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
        "viajes": 7,
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
        "viajes": 7,
      }
    `)
    expect(context.rows.plants.get(PLANT_ID)?.photoPath).toBe(
      context.rows.photosOf(PLANT_ID)[0]?.photoPath,
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
        "viajes": 8,
      }
    `)
    expect(onPlantUpdated).toHaveBeenCalledTimes(1)
    expect(
      context.rows.photosOf(PLANT_ID).map((photo) => photo.position),
    ).toEqual([0, 1, 2])
  })
})
