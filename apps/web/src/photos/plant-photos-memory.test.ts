import { afterEach, describe, expect, it } from 'vitest'
import { PLANT_ID, USER_ID } from '../test/photos.ts'
import { createMemoryPlantPhotoRows } from './memory-photo-rows.ts'
import type { StoredPlantPhoto } from './photo-rows.ts'
import {
  EDIT_REUSE_MS,
  forgetAllPlantPhotos,
  forgetPlantPhotosOf,
  recalledPlantPhotos,
  recentPlantPhotos,
  rememberPlantPhotos,
  SAVED_FRESH_MS,
} from './plant-photos-memory.ts'

const PHOTO: StoredPlantPhoto = {
  id: 'foto-0',
  plantId: PLANT_ID,
  photoPath: `${USER_ID}/${PLANT_ID}/photo-a.webp`,
  thumbnailPath: `${USER_ID}/${PLANT_ID}/thumb-a.webp`,
  inBloom: false,
  takenAt: null,
  note: null,
  position: 0,
  createdAt: '2026-11-22T12:00:00.000Z',
}

afterEach(() => forgetAllPlantPhotos())

describe('lo recordado de las fotos de una planta (#285)', () => {
  it('lo leído sirve a la edición un rato y a la ficha nunca', () => {
    const rows = createMemoryPlantPhotoRows()
    rememberPlantPhotos(rows, USER_ID, PLANT_ID, [PHOTO], 'read', 1_000)
    const at = (now: number, savedOnly = false) =>
      recentPlantPhotos(rows, USER_ID, PLANT_ID, EDIT_REUSE_MS, {
        now,
        savedOnly,
      })
    expect(at(1_000 + EDIT_REUSE_MS - 1)).toEqual([PHOTO])
    expect(at(1_000 + EDIT_REUSE_MS)).toBeNull()
    expect(at(2_000, true)).toBeNull()
  })

  it('lo de un guardado sirve a la ficha solo unos segundos', () => {
    const rows = createMemoryPlantPhotoRows()
    rememberPlantPhotos(rows, USER_ID, PLANT_ID, [PHOTO], 'saved', 1_000)
    const at = (now: number) =>
      recentPlantPhotos(rows, USER_ID, PLANT_ID, SAVED_FRESH_MS, {
        now,
        savedOnly: true,
      })
    expect(at(1_000 + SAVED_FRESH_MS - 1)).toEqual([PHOTO])
    expect(at(1_000 + SAVED_FRESH_MS)).toBeNull()
    // Sin conexión, la ficha lo enseña aunque sea viejo.
    expect(recalledPlantPhotos(rows, USER_ID, PLANT_ID)).toEqual([PHOTO])
  })

  it('es de cada persona, de cada planta y de cada acceso a las filas, y se olvida', () => {
    const rows = createMemoryPlantPhotoRows()
    const other = createMemoryPlantPhotoRows()
    rememberPlantPhotos(rows, USER_ID, PLANT_ID.toUpperCase(), [PHOTO])
    expect(recalledPlantPhotos(rows, USER_ID, PLANT_ID)).toEqual([PHOTO])
    expect(recalledPlantPhotos(rows, 'user_otra', PLANT_ID)).toBeUndefined()
    expect(recalledPlantPhotos(other, USER_ID, PLANT_ID)).toBeUndefined()
    forgetPlantPhotosOf(rows, USER_ID, PLANT_ID)
    expect(recalledPlantPhotos(rows, USER_ID, PLANT_ID)).toBeUndefined()
  })
})
