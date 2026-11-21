import { describe, expect, it, vi } from 'vitest'
import { processedPhoto } from '../test/photos.ts'
import { PLANT_DRAFT_MAX_AGE_MS } from './draft.ts'
import {
  clearDraftPhoto,
  createIndexedDbDraftPhotoBackend,
  createMemoryDraftPhotoBackend,
  readDraftPhoto,
  writeDraftPhoto,
  type DraftPhoto,
  type DraftPhotoBackend,
} from './draft-photo.ts'

const USER = 'user_prueba'
const PLANT = '30000000-0000-4000-8000-000000000001'
const NOW = new Date('2026-11-21T15:00:00Z')

function draft(overrides: Partial<DraftPhoto> = {}): DraftPhoto {
  return {
    plantId: PLANT,
    savedAt: NOW.getTime(),
    fileName: 'IMG_0001.jpg',
    photo: processedPhoto(),
    ...overrides,
  }
}

describe('foto pendiente del borrador', () => {
  it('se guarda y se recupera con el id de planta del borrador', async () => {
    const backend = createMemoryDraftPhotoBackend()
    expect(await writeDraftPhoto(backend, USER, draft())).toBe(true)
    const found = await readDraftPhoto(backend, USER, {
      plantId: PLANT,
      now: NOW,
    })
    expect(found?.plantId).toBe(PLANT)
    expect(found?.fileName).toBe('IMG_0001.jpg')
    expect(found?.photo.photo.blob).toBeInstanceOf(Blob)
  })

  it('con otro id de planta o sin borrador de texto, se borra', async () => {
    const backend = createMemoryDraftPhotoBackend()
    await writeDraftPhoto(backend, USER, draft())
    expect(
      await readDraftPhoto(backend, USER, { plantId: 'otro', now: NOW }),
    ).toBeNull()
    expect(backend.entries.size).toBe(0)

    await writeDraftPhoto(backend, USER, draft())
    expect(
      await readDraftPhoto(backend, USER, { plantId: null, now: NOW }),
    ).toBeNull()
    expect(backend.entries.size).toBe(0)
  })

  it('caduca a las 24 horas (y una fecha futura tampoco vale)', async () => {
    const backend = createMemoryDraftPhotoBackend()
    await writeDraftPhoto(backend, USER, draft())
    const limit = new Date(NOW.getTime() + PLANT_DRAFT_MAX_AGE_MS)
    expect(
      await readDraftPhoto(backend, USER, { plantId: PLANT, now: limit }),
    ).not.toBeNull()
    const late = new Date(limit.getTime() + 1)
    expect(
      await readDraftPhoto(backend, USER, { plantId: PLANT, now: late }),
    ).toBeNull()
    expect(backend.entries.size).toBe(0)

    await writeDraftPhoto(backend, USER, draft({ savedAt: NOW.getTime() + 1 }))
    expect(
      await readDraftPhoto(backend, USER, { plantId: PLANT, now: NOW }),
    ).toBeNull()
  })

  it('al leer borra las fotos de otros usuarios', async () => {
    const backend = createMemoryDraftPhotoBackend()
    await writeDraftPhoto(backend, 'user_otro', draft())
    await writeDraftPhoto(backend, USER, draft())
    await readDraftPhoto(backend, USER, { plantId: PLANT, now: NOW })
    expect([...backend.entries.keys()]).toEqual([USER])
  })

  it('lo que no se entiende (otra versión o sin Blob) se borra', async () => {
    const backend = createMemoryDraftPhotoBackend()
    await backend.put(USER, { ...draft(), version: 99 } as never)
    expect(
      await readDraftPhoto(backend, USER, { plantId: PLANT, now: NOW }),
    ).toBeNull()
    expect(backend.entries.size).toBe(0)

    const broken = draft()
    await backend.put(USER, {
      version: 1,
      ...broken,
      photo: { ...broken.photo, thumbnail: { type: 'image/webp' } },
    } as never)
    expect(
      await readDraftPhoto(backend, USER, { plantId: PLANT, now: NOW }),
    ).toBeNull()
    expect(backend.entries.size).toBe(0)
  })

  it('si el almacenamiento falla, no hay foto y nada lanza', async () => {
    const failing: DraftPhotoBackend = {
      get: vi.fn(() => Promise.reject(new Error('fallo'))),
      put: vi.fn(() => Promise.reject(new Error('lleno'))),
      delete: vi.fn(() => Promise.reject(new Error('fallo'))),
      keys: vi.fn(() => Promise.reject(new Error('fallo'))),
    }
    expect(await writeDraftPhoto(failing, USER, draft())).toBe(false)
    expect(
      await readDraftPhoto(failing, USER, { plantId: PLANT, now: NOW }),
    ).toBeNull()
    await expect(clearDraftPhoto(failing, USER)).resolves.toBeUndefined()
  })

  it('sin IndexedDB (navegador antiguo o bloqueado) funciona como "sin foto"', async () => {
    const backend = createIndexedDbDraftPhotoBackend(() => undefined)
    expect(await writeDraftPhoto(backend, USER, draft())).toBe(false)
    expect(
      await readDraftPhoto(backend, USER, { plantId: PLANT, now: NOW }),
    ).toBeNull()
    await expect(clearDraftPhoto(backend, USER)).resolves.toBeUndefined()
  })
})
