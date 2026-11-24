import { describe, expect, it } from 'vitest'
import { processedPhoto } from '../test/photos.ts'
import {
  clearDraftPhoto,
  createMemoryDraftPhotoBackend,
  draftPhotoKey,
  pruneDraftPhotos,
  readDraftPhotoCounts,
  readDraftPhotos,
  writeDraftPhotos,
} from './draft-photo.ts'
import {
  clearPendingUpload,
  listPendingUploads,
  PENDING_UPLOAD_MAX_AGE_MS,
  pendingUploadKey,
  planPendingUpload,
  readPendingUpload,
  writePendingUpload,
  type PendingUpload,
  type PendingUploadPhoto,
} from './pending-upload.ts'

const USER = 'user_ana'
const OTHER = 'user_bruno'
const PLANT = '6f1c2a4e-8b3d-4e5f-9a7b-0c1d2e3f4a5b'
const PLANT_B = '7a2b3c4d-1e2f-4a5b-8c6d-0e1f2a3b4c5d'
const NOW = new Date('2026-11-24T10:00:00.000Z')

function item(version: string, inBloom = false): PendingUploadPhoto {
  return {
    fileName: `${version}.jpg`,
    photo: processedPhoto(),
    version,
    inBloom,
  }
}

function upload(overrides: Partial<PendingUpload> = {}): PendingUpload {
  return {
    plantId: PLANT,
    plantName: 'Vanda Pachara Delight',
    plantNameIsScientific: false,
    savedAt: NOW.getTime(),
    photos: [item('v-1', true), item('v-2')],
    ...overrides,
  }
}

describe('fotos por subir de una planta ya registrada (#284)', () => {
  it('se guardan y se leen con su orden, su versión y «en floración»', async () => {
    const backend = createMemoryDraftPhotoBackend()
    expect(await writePendingUpload(backend, USER, upload())).toBe(true)
    expect([...backend.entries.keys()]).toEqual([`${USER}/subir:${PLANT}`])

    const found = await readPendingUpload(backend, USER, {
      plantId: PLANT,
      now: NOW,
    })
    expect(found?.plantName).toBe('Vanda Pachara Delight')
    expect(
      found?.photos.map(({ version, inBloom, fileName }) => ({
        version,
        inBloom,
        fileName,
      })),
    ).toEqual([
      { version: 'v-1', inBloom: true, fileName: 'v-1.jpg' },
      { version: 'v-2', inBloom: false, fileName: 'v-2.jpg' },
    ])
    expect(found?.photos[0]?.photo.thumbnail.blob).toBeInstanceOf(Blob)
  })

  it('la clave no distingue mayúsculas en el id de la planta', async () => {
    const backend = createMemoryDraftPhotoBackend()
    await writePendingUpload(
      backend,
      USER,
      upload({ plantId: PLANT.toUpperCase() }),
    )
    expect(pendingUploadKey(USER, PLANT.toUpperCase())).toBe(
      pendingUploadKey(USER, PLANT),
    )
    expect(
      await readPendingUpload(backend, USER, { plantId: PLANT, now: NOW }),
    ).not.toBeNull()
  })

  it('sin fotos, escribir las borra; clearPendingUpload también', async () => {
    const backend = createMemoryDraftPhotoBackend()
    await writePendingUpload(backend, USER, upload())
    await writePendingUpload(backend, USER, upload({ photos: [] }))
    expect(backend.entries.size).toBe(0)

    await writePendingUpload(backend, USER, upload())
    await clearPendingUpload(backend, USER, PLANT)
    expect(backend.entries.size).toBe(0)
  })

  it('no guarda más de seis', async () => {
    const backend = createMemoryDraftPhotoBackend()
    const seven = Array.from({ length: 7 }, (_, index) =>
      item(`v-${String(index)}`),
    )
    expect(
      await writePendingUpload(backend, USER, upload({ photos: seven })),
    ).toBe(false)
    expect(backend.entries.size).toBe(0)
  })

  it('caducan a los siete días de la última escritura', async () => {
    const backend = createMemoryDraftPhotoBackend()
    await writePendingUpload(backend, USER, upload())
    const limit = new Date(NOW.getTime() + PENDING_UPLOAD_MAX_AGE_MS)
    expect(
      await readPendingUpload(backend, USER, { plantId: PLANT, now: limit }),
    ).not.toBeNull()
    const late = new Date(limit.getTime() + 1)
    expect(
      await readPendingUpload(backend, USER, { plantId: PLANT, now: late }),
    ).toBeNull()
    expect(backend.entries.size).toBe(0)
  })

  it('lo que no se entiende se borra al leer', async () => {
    const backend = createMemoryDraftPhotoBackend()
    const key = pendingUploadKey(USER, PLANT)
    await backend.put(key, { format: 'fotos-por-subir', version: 9 })
    expect(
      await readPendingUpload(backend, USER, { plantId: PLANT, now: NOW }),
    ).toBeNull()
    expect(backend.entries.has(key)).toBe(false)

    // Una foto sin versión válida invalida la entrada entera.
    await writePendingUpload(backend, USER, upload())
    const stored = backend.entries.get(key) as { photos: { version: string }[] }
    stored.photos[1] = { ...stored.photos[1], version: 'NO VALE' }
    expect(
      await readPendingUpload(backend, USER, { plantId: PLANT, now: NOW }),
    ).toBeNull()
  })

  it('al leer con otra cuenta se borran las de la anterior', async () => {
    const backend = createMemoryDraftPhotoBackend()
    await writePendingUpload(backend, USER, upload())
    expect(
      await readPendingUpload(backend, OTHER, { plantId: PLANT, now: NOW }),
    ).toBeNull()
    expect(backend.entries.size).toBe(0)
  })

  it('listPendingUploads da las del usuario, de la más reciente a la más antigua', async () => {
    const backend = createMemoryDraftPhotoBackend()
    await writePendingUpload(
      backend,
      USER,
      upload({ savedAt: NOW.getTime() - 10 }),
    )
    await writePendingUpload(
      backend,
      USER,
      upload({ plantId: PLANT_B, plantName: 'Cattleya maxima' }),
    )
    // Un borrador con fotos no es una planta con fotos por subir.
    await writeDraftPhotos(backend, USER, {
      plantId: 'borrador',
      savedAt: NOW.getTime(),
      photos: [{ fileName: 'a.jpg', photo: processedPhoto() }],
    })
    await writePendingUpload(backend, OTHER, upload())

    const found = await listPendingUploads(backend, USER, { now: NOW })
    expect(found.map((entry) => entry.plantName)).toEqual([
      'Cattleya maxima',
      'Vanda Pachara Delight',
    ])
    // Las de la otra cuenta ya no están.
    expect(
      [...backend.entries.keys()].some((key) => key.startsWith(OTHER)),
    ).toBe(false)
  })

  it('conviven con los borradores: limpiar los borradores no las toca', async () => {
    const backend = createMemoryDraftPhotoBackend()
    await writePendingUpload(backend, USER, upload())
    await writeDraftPhotos(backend, USER, {
      plantId: 'borrador',
      savedAt: NOW.getTime(),
      photos: [{ fileName: 'a.jpg', photo: processedPhoto() }],
    })

    // Al abrir el registro sin borradores, las de borradores sobran; estas no.
    await pruneDraftPhotos(backend, USER, { plantIds: [], now: NOW })
    expect([...backend.entries.keys()]).toEqual([pendingUploadKey(USER, PLANT)])

    // Ni cuentan como fotos de un borrador.
    const counts = await readDraftPhotoCounts(backend, USER, {
      plantIds: [PLANT],
      now: NOW,
    })
    expect(counts.get(PLANT)).toBe(0)

    // Ni se borran al leer sin borrador.
    expect(
      await readDraftPhotos(backend, USER, { plantId: null, now: NOW }),
    ).toBeNull()
    expect(backend.entries.has(pendingUploadKey(USER, PLANT))).toBe(true)
    expect(backend.entries.has(draftPhotoKey(USER, PLANT))).toBe(false)
  })

  it('la limpieza al eliminar la cuenta (clearDraftPhoto) las borra', async () => {
    const backend = createMemoryDraftPhotoBackend()
    await writePendingUpload(backend, USER, upload())
    await writePendingUpload(backend, OTHER, upload())
    await clearDraftPhoto(backend, USER)
    expect([...backend.entries.keys()]).toEqual([
      pendingUploadKey(OTHER, PLANT),
    ])
  })

  it('sin almacenamiento, leer da nada y escribir da false', async () => {
    const failing = {
      get: () => Promise.reject(new Error('IndexedDB')),
      put: () => Promise.reject(new Error('IndexedDB')),
      delete: () => Promise.reject(new Error('IndexedDB')),
      keys: () => Promise.reject(new Error('IndexedDB')),
    }
    expect(await writePendingUpload(failing, USER, upload())).toBe(false)
    expect(
      await readPendingUpload(failing, USER, { plantId: PLANT, now: NOW }),
    ).toBeNull()
    expect(await listPendingUploads(failing, USER, { now: NOW })).toEqual([])
    await expect(clearPendingUpload(failing, USER, PLANT)).resolves.toBe(
      undefined,
    )
  })
})

describe('planPendingUpload', () => {
  const pathOf = (photo: PendingUploadPhoto) => `ruta/${photo.version}`
  const photos = ['a', 'b', 'c'].map((version) => item(version))

  it('sin fotos en la planta, sube todas', () => {
    const plan = planPendingUpload(photos, [], pathOf)
    expect(plan.upload).toEqual(photos)
    expect(plan.stored).toEqual([])
    expect(plan.leftOut).toEqual([])
  })

  it('las que ya están en una fila no se suben otra vez ni ocupan sitio de más', () => {
    const plan = planPendingUpload(photos, ['ruta/b', 'otra', 'otra-2'], pathOf)
    expect(plan.stored.map((photo) => photo.version)).toEqual(['b'])
    expect(plan.upload.map((photo) => photo.version)).toEqual(['a', 'c'])
  })

  it('no pasa de seis: solo las que caben, en orden', () => {
    const five = ['1', '2', '3', '4', '5'].map((name) => `otra-${name}`)
    const plan = planPendingUpload(photos, five, pathOf)
    expect(plan.upload.map((photo) => photo.version)).toEqual(['a'])
    expect(plan.leftOut.map((photo) => photo.version)).toEqual(['b', 'c'])

    const six = [...five, 'otra-6']
    const full = planPendingUpload(photos, six, pathOf)
    expect(full.upload).toEqual([])
    expect(full.leftOut).toEqual(photos)
  })
})
