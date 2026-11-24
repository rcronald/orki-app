import { IDBFactory, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { processedPhoto } from '../test/photos.ts'
import { PLANT_DRAFT_MAX_AGE_MS } from './draft.ts'
import {
  clearDraftPhoto,
  clearDraftPhotos,
  createIndexedDbDraftPhotoBackend,
  createMemoryDraftPhotoBackend,
  draftPhotoKey,
  pruneDraftPhotos,
  readDraftPhoto,
  readDraftPhotoCounts,
  readDraftPhotos,
  writeDraftPhoto,
  writeDraftPhotos,
  type DraftPhoto,
  type DraftPhotoBackend,
  type DraftPhotos,
} from './draft-photo.ts'

const USER = 'user_prueba'
const PLANT = '30000000-0000-4000-8000-000000000001'
const NOW = new Date('2026-11-21T15:00:00Z')
/** La entrada de las fotos del borrador PLANT (#296). */
const KEY = draftPhotoKey(USER, PLANT)

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

  it('con otro id de planta no aparece (es de otro borrador); sin borrador de texto, se borra', async () => {
    const backend = createMemoryDraftPhotoBackend()
    await writeDraftPhoto(backend, USER, draft())
    expect(
      await readDraftPhoto(backend, USER, { plantId: 'otro', now: NOW }),
    ).toBeNull()
    expect([...backend.entries.keys()]).toEqual([KEY])

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
    expect([...backend.entries.keys()]).toEqual([KEY])
  })

  it('lo que no se entiende (otra versión o sin Blob) se borra', async () => {
    const backend = createMemoryDraftPhotoBackend()
    await backend.put(KEY, { ...draft(), version: 99 })
    expect(
      await readDraftPhoto(backend, USER, { plantId: PLANT, now: NOW }),
    ).toBeNull()
    expect(backend.entries.size).toBe(0)

    const broken = draft()
    await backend.put(KEY, {
      version: 1,
      ...broken,
      photo: { ...broken.photo, thumbnail: { type: 'image/webp' } },
    })
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

  it('si IndexedDB rechaza la escritura, no queda ninguna promesa rechazada sin atender', async () => {
    // Como Safari en navegación privada (y WebKit de Playwright), que no
    // guarda Blobs en IndexedDB: la petición falla y la transacción se aborta.
    // Aquí la petición falla porque put se convierte en add y la clave ya
    // existe (ConstraintError), con el mismo efecto.
    const put = vi
      .spyOn(FakeObjectStore.prototype, 'put')
      .mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ) {
        return this.add(value, key)
      })
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    // Con temporizadores falsos, fake-indexeddb no avanza hasta que la prueba
    // adelanta el reloj: al terminar, ya ha corrido todo lo que tenía en
    // cola, también el aborto de la transacción, por cargado que esté el
    // equipo (#311).
    vi.useFakeTimers()
    try {
      const factory = new IDBFactory()
      const backend = createIndexedDbDraftPhotoBackend(() => factory)
      const first = writeDraftPhoto(backend, USER, draft())
      await vi.runAllTimersAsync()
      expect(await first).toBe(true)
      const second = writeDraftPhoto(backend, USER, draft())
      await vi.runAllTimersAsync()
      expect(await second).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
      // Node avisa de un rechazo sin atender al acabar la tarea en la que se
      // produjo: basta con una tarea más, sin esperar ningún tiempo.
      vi.useRealTimers()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      process.off('unhandledRejection', unhandled)
      put.mockRestore()
    }
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

function photos(count: number): DraftPhotos {
  return {
    plantId: PLANT,
    savedAt: NOW.getTime(),
    photos: Array.from({ length: count }, (_, index) => ({
      fileName: `IMG_000${index + 1}.jpg`,
      photo: processedPhoto(index % 2 === 0 ? 'image/webp' : 'image/jpeg'),
    })),
  }
}

describe('varias fotos pendientes del borrador (#219)', () => {
  it('guarda hasta 6 fotos y las recupera en su orden', async () => {
    const backend = createMemoryDraftPhotoBackend()
    expect(await writeDraftPhotos(backend, USER, photos(6))).toBe(true)
    expect(backend.entries.get(KEY)?.version).toBe(2)
    expect(backend.entries.get(KEY)?.plantId).toBe(PLANT)

    const found = await readDraftPhotos(backend, USER, {
      plantId: PLANT,
      now: NOW,
    })
    expect(found?.photos.map((item) => item.fileName)).toEqual([
      'IMG_0001.jpg',
      'IMG_0002.jpg',
      'IMG_0003.jpg',
      'IMG_0004.jpg',
      'IMG_0005.jpg',
      'IMG_0006.jpg',
    ])
    expect(found?.photos[1].photo.photo.type).toBe('image/jpeg')
    // El formulario de una foto ve la primera.
    const single = await readDraftPhoto(backend, USER, {
      plantId: PLANT,
      now: NOW,
    })
    expect(single?.fileName).toBe('IMG_0001.jpg')
  })

  it('más de 6 no se guarda y no cambia lo que había', async () => {
    const backend = createMemoryDraftPhotoBackend()
    await writeDraftPhotos(backend, USER, photos(2))
    expect(await writeDraftPhotos(backend, USER, photos(7))).toBe(false)
    const found = await readDraftPhotos(backend, USER, {
      plantId: PLANT,
      now: NOW,
    })
    expect(found?.photos).toHaveLength(2)

    // Un borrador guardado con 7 (por otra versión de la app) se descarta.
    await backend.put(KEY, { version: 2, ...photos(7) })
    expect(
      await readDraftPhotos(backend, USER, { plantId: PLANT, now: NOW }),
    ).toBeNull()
    expect(backend.entries.size).toBe(0)
  })

  it('sin fotos borra las pendientes', async () => {
    const backend = createMemoryDraftPhotoBackend()
    await writeDraftPhotos(backend, USER, photos(3))
    expect(await writeDraftPhotos(backend, USER, photos(0))).toBe(true)
    expect(backend.entries.size).toBe(0)
  })

  it('caducan a las 24 horas, todas juntas', async () => {
    const backend = createMemoryDraftPhotoBackend()
    await writeDraftPhotos(backend, USER, photos(4))
    const limit = new Date(NOW.getTime() + PLANT_DRAFT_MAX_AGE_MS)
    expect(
      (await readDraftPhotos(backend, USER, { plantId: PLANT, now: limit }))
        ?.photos,
    ).toHaveLength(4)
    const late = new Date(limit.getTime() + 1)
    expect(
      await readDraftPhotos(backend, USER, { plantId: PLANT, now: late }),
    ).toBeNull()
    expect(backend.entries.size).toBe(0)
  })

  it('no aparecen con otra cuenta: al leer se borran las de otros usuarios', async () => {
    const backend = createMemoryDraftPhotoBackend()
    await writeDraftPhotos(backend, 'user_otro', photos(3))
    expect(
      await readDraftPhotos(backend, USER, { plantId: PLANT, now: NOW }),
    ).toBeNull()
    expect(backend.entries.size).toBe(0)
  })

  it('cada borrador tiene las suyas (#296): guardar, leer o borrar las de uno no toca las del otro', async () => {
    const backend = createMemoryDraftPhotoBackend()
    const other = '30000000-0000-4000-8000-000000000002'
    await writeDraftPhotos(backend, USER, photos(2))
    await writeDraftPhotos(backend, USER, { ...photos(3), plantId: other })
    expect(
      (await readDraftPhotos(backend, USER, { plantId: PLANT, now: NOW }))
        ?.photos,
    ).toHaveLength(2)
    expect(
      (await readDraftPhotos(backend, USER, { plantId: other, now: NOW }))
        ?.photos,
    ).toHaveLength(3)
    expect(
      await readDraftPhotoCounts(backend, USER, {
        plantIds: [PLANT, other, 'sin-fotos'],
        now: NOW,
      }),
    ).toEqual(
      new Map([
        [PLANT, 2],
        [other, 3],
        ['sin-fotos', 0],
      ]),
    )

    await clearDraftPhotos(backend, USER, PLANT)
    expect([...backend.entries.keys()]).toEqual([draftPhotoKey(USER, other)])
  })

  it('pruneDraftPhotos deja solo las de los borradores que siguen, sin caducar y de este usuario', async () => {
    const backend = createMemoryDraftPhotoBackend()
    const gone = '30000000-0000-4000-8000-000000000003'
    await writeDraftPhotos(backend, USER, photos(1))
    await writeDraftPhotos(backend, USER, { ...photos(1), plantId: gone })
    await writeDraftPhotos(backend, 'user_otro', photos(1))
    await backend.put(draftPhotoKey(USER, 'roto'), { version: 99 })
    await pruneDraftPhotos(backend, USER, { plantIds: [PLANT], now: NOW })
    expect([...backend.entries.keys()]).toEqual([KEY])

    const late = new Date(NOW.getTime() + PLANT_DRAFT_MAX_AGE_MS + 1)
    await pruneDraftPhotos(backend, USER, { plantIds: [PLANT], now: late })
    expect(backend.entries.size).toBe(0)
  })

  it('un borrador con el formato anterior (versión 1, una foto) se recupera', async () => {
    const backend = createMemoryDraftPhotoBackend()
    // Tal como lo guardaba la app antes del #219: con la clave del usuario,
    // como hasta el #296.
    await backend.put(USER, { version: 1, ...draft() })
    expect(
      await readDraftPhotoCounts(backend, USER, {
        plantIds: [PLANT],
        now: NOW,
      }),
    ).toEqual(new Map([[PLANT, 1]]))
    // Leer otro borrador no la borra; podar sin el suyo, sí (abajo).
    expect(
      await readDraftPhotos(backend, USER, { plantId: 'otra', now: NOW }),
    ).toBeNull()
    expect([...backend.entries.keys()]).toEqual([USER])

    const found = await readDraftPhotos(backend, USER, {
      plantId: PLANT,
      now: NOW,
    })
    expect(found?.photos).toHaveLength(1)
    expect(found?.photos[0].fileName).toBe('IMG_0001.jpg')
    expect(found?.photos[0].photo.thumbnail.blob).toBeInstanceOf(Blob)
    const single = await readDraftPhoto(backend, USER, {
      plantId: PLANT,
      now: NOW,
    })
    expect(single?.fileName).toBe('IMG_0001.jpg')

    // Añadir otra lo guarda ya con el formato nuevo, en la entrada del
    // borrador, y la antigua se borra.
    if (!found) throw new Error('sin borrador')
    await writeDraftPhotos(backend, USER, {
      ...found,
      photos: [...found.photos, ...photos(1).photos],
    })
    expect([...backend.entries.keys()]).toEqual([KEY])
    expect(backend.entries.get(KEY)?.version).toBe(2)

    // Una antigua de un borrador que ya no existe se poda.
    await backend.put(USER, { version: 1, ...draft({ plantId: 'vieja' }) })
    await pruneDraftPhotos(backend, USER, { plantIds: [PLANT], now: NOW })
    expect([...backend.entries.keys()]).toEqual([KEY])
  })

  it('un formato anterior roto, o una foto rota entre varias, se descarta sin error', async () => {
    const backend = createMemoryDraftPhotoBackend()
    await backend.put(KEY, { version: 1, plantId: PLANT, savedAt: 0 })
    await expect(
      readDraftPhotos(backend, USER, { plantId: PLANT, now: NOW }),
    ).resolves.toBeNull()
    expect(backend.entries.size).toBe(0)

    const broken = photos(3)
    await backend.put(KEY, {
      version: 2,
      ...broken,
      photos: [broken.photos[0], { fileName: 'x.jpg', photo: {} }],
    })
    await expect(
      readDraftPhotos(backend, USER, { plantId: PLANT, now: NOW }),
    ).resolves.toBeNull()
    expect(backend.entries.size).toBe(0)
  })

  it('en IndexedDB: una entrada por borrador con las seis fotos en orden', async () => {
    // fake-indexeddb clona con structuredClone de Node, que no conserva el
    // Blob de jsdom: aquí se mira lo guardado, no la lectura completa (que
    // comprueba los Blob). Falta probarlo en iPhone y Android reales (#89).
    const factory = new IDBFactory()
    const first = createIndexedDbDraftPhotoBackend(() => factory)
    const draft = photos(6)
    expect(await writeDraftPhotos(first, USER, draft)).toBe(true)

    // Como al recargar: otro almacén sobre la misma base y el mismo almacén
    // de objetos de la versión 1 (no hay migración de esquema).
    const second = createIndexedDbDraftPhotoBackend(() => factory)
    expect(await second.keys()).toEqual([KEY])
    const stored = (await second.get(KEY)) as {
      version: number
      plantId: string
      photos: { fileName: string }[]
    }
    expect(stored.version).toBe(2)
    expect(stored.plantId).toBe(PLANT)
    expect(stored.photos.map((item) => item.fileName)).toEqual(
      draft.photos.map((item) => item.fileName),
    )

    await clearDraftPhotos(second, USER)
    expect(await second.keys()).toEqual([])
  })
})
