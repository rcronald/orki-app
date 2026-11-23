import { describe, expect, it } from 'vitest'
import { createMemoryPhotoStorage } from '../photos/memory-storage.ts'
import { PhotoStorageError } from '../photos/storage.ts'
import { PLANT_ID, processedPhoto, USER_ID } from '../test/photos.ts'
import { PlantLogError } from './entries.ts'
import { createMemoryPlantLogEntries } from './memory-entries.ts'
import {
  deleteLogEntry,
  saveLogEntry,
  SaveLogEntryError,
  type LogEntryDraft,
} from './save.ts'

const KEY = '9b2f7c1e-1111-4222-8333-444455556666'

const DRAFT: LogEntryDraft = {
  type: 'watering',
  title: 'Riego por inmersión',
  description: 'Diez minutos en agua de lluvia.',
  inBloom: null,
}

function setup() {
  const entries = createMemoryPlantLogEntries({ userId: USER_ID })
  entries.plants.set(PLANT_ID, USER_ID)
  const storage = createMemoryPhotoStorage()
  return { entries, storage }
}

const logFolder = `${USER_ID}/${PLANT_ID}/log/`
const logFiles = (storage: ReturnType<typeof createMemoryPhotoStorage>) =>
  [...storage.objects.keys()].filter((path) => path.startsWith(logFolder))

async function failure(promise: Promise<unknown>): Promise<SaveLogEntryError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof SaveLogEntryError) return error
    throw error
  }
  throw new Error('No falló')
}

describe('saveLogEntry', () => {
  it('sin foto, crea el registro con lo escrito y la clave', async () => {
    const { entries, storage } = setup()
    const entry = await saveLogEntry({
      userId: USER_ID,
      plantId: PLANT_ID,
      draft: DRAFT,
      photo: null,
      idempotencyKey: KEY,
      entries,
      storage,
    })
    expect(entry).toMatchObject({
      plantId: PLANT_ID,
      type: 'watering',
      title: 'Riego por inmersión',
      description: 'Diez minutos en agua de lluvia.',
      photoPath: null,
      thumbnailPath: null,
      inBloom: null,
    })
    expect(entries.rows.size).toBe(1)
    expect(storage.objects.size).toBe(0)
  })

  it('con foto, sube la foto y la miniatura a log/ y las cita en el registro', async () => {
    const { entries, storage } = setup()
    const entry = await saveLogEntry({
      userId: USER_ID,
      plantId: PLANT_ID,
      draft: { ...DRAFT, inBloom: true },
      photo: processedPhoto(),
      idempotencyKey: KEY,
      entries,
      storage,
    })
    expect(entry.photoPath).toMatch(
      new RegExp(`^${logFolder}photo-[0-9a-f-]+\\.webp$`),
    )
    expect(entry.thumbnailPath).toMatch(
      new RegExp(`^${logFolder}thumb-[0-9a-f-]+\\.webp$`),
    )
    expect(logFiles(storage).sort()).toEqual(
      [entry.photoPath, entry.thumbnailPath].sort(),
    )
    expect(entry.inBloom).toBe(true)
  })

  it('un reintento tras una respuesta perdida no duplica: un registro y un par de archivos', async () => {
    const { entries, storage } = setup()
    const photo = processedPhoto()
    // El primer intento guarda, pero la respuesta no llega.
    entries.fail = (operation) =>
      operation === 'add'
        ? {
            when: 'after',
            error: new PlantLogError('offline', { uncertain: true }),
          }
        : null
    const first = await failure(
      saveLogEntry({
        userId: USER_ID,
        plantId: PLANT_ID,
        draft: DRAFT,
        photo,
        idempotencyKey: KEY,
        entries,
        storage,
      }),
    )
    expect(first.step).toBe('entry')
    expect(first.uncertain).toBe(true)
    // En la duda, la foto se queda: quizá el registro la cita.
    expect(first.uploaded).not.toBeNull()
    expect(logFiles(storage)).toHaveLength(2)

    entries.fail = undefined
    const entry = await saveLogEntry({
      userId: USER_ID,
      plantId: PLANT_ID,
      draft: DRAFT,
      photo,
      idempotencyKey: KEY,
      entries,
      storage,
      keepUploadOnFailure: true,
    })
    expect(entries.rows.size).toBe(1)
    expect(logFiles(storage)).toHaveLength(2)
    expect(entry.photoPath).toBe(first.uploaded?.photoPath)
  })

  it('si el registro falla con seguridad, borra la foto y el reintento la vuelve a subir a la misma ruta', async () => {
    const { entries, storage } = setup()
    const photo = processedPhoto()
    entries.fail = () => ({
      when: 'before',
      error: new PlantLogError('failed'),
    })
    const first = await failure(
      saveLogEntry({
        userId: USER_ID,
        plantId: PLANT_ID,
        draft: DRAFT,
        photo,
        idempotencyKey: KEY,
        entries,
        storage,
      }),
    )
    expect(first.uncertain).toBe(false)
    expect(first.uploaded).toBeNull()
    expect(logFiles(storage)).toHaveLength(0)
    expect(entries.rows.size).toBe(0)

    entries.fail = undefined
    const entry = await saveLogEntry({
      userId: USER_ID,
      plantId: PLANT_ID,
      draft: DRAFT,
      photo,
      idempotencyKey: KEY,
      entries,
      storage,
    })
    expect(entries.rows.size).toBe(1)
    expect(logFiles(storage).sort()).toEqual(
      [entry.photoPath, entry.thumbnailPath].sort(),
    )
  })

  it('con un intento dudoso antes, un fallo seguro no borra la foto', async () => {
    const { entries, storage } = setup()
    entries.fail = () => ({
      when: 'before',
      error: new PlantLogError('session-ended'),
    })
    const error = await failure(
      saveLogEntry({
        userId: USER_ID,
        plantId: PLANT_ID,
        draft: DRAFT,
        photo: processedPhoto(),
        idempotencyKey: KEY,
        entries,
        storage,
        keepUploadOnFailure: true,
      }),
    )
    expect(error.uploaded).not.toBeNull()
    expect(logFiles(storage)).toHaveLength(2)
  })

  it('si falla la subida, no crea el registro ni deja archivos', async () => {
    const { entries, storage } = setup()
    storage.failUploads = (path) =>
      path.includes('/thumb-') ? new PhotoStorageError('offline') : null
    const error = await failure(
      saveLogEntry({
        userId: USER_ID,
        plantId: PLANT_ID,
        draft: DRAFT,
        photo: processedPhoto(),
        idempotencyKey: KEY,
        entries,
        storage,
      }),
    )
    expect(error.step).toBe('upload')
    expect(error.failure.reason).toBe('offline')
    expect(entries.rows.size).toBe(0)
    expect(storage.objects.size).toBe(0)
  })

  it('la floración observada solo se guarda en el registro', async () => {
    const { entries, storage } = setup()
    const entry = await saveLogEntry({
      userId: USER_ID,
      plantId: PLANT_ID,
      draft: { ...DRAFT, inBloom: false },
      photo: null,
      idempotencyKey: KEY,
      entries,
      storage,
    })
    expect(entry.inBloom).toBe(false)
  })
})

describe('deleteLogEntry', () => {
  async function withEntry(photo: boolean) {
    const services = setup()
    const entry = await saveLogEntry({
      userId: USER_ID,
      plantId: PLANT_ID,
      draft: DRAFT,
      photo: photo ? processedPhoto() : null,
      idempotencyKey: KEY,
      ...services,
    })
    return { ...services, entry }
  }

  it('borra el registro y después su foto', async () => {
    const { entries, storage, entry } = await withEntry(true)
    expect(logFiles(storage)).toHaveLength(2)
    const result = await deleteLogEntry({
      userId: USER_ID,
      entry,
      entries,
      storage,
    })
    expect(result).toEqual({ photoDeleted: true })
    expect(entries.rows.size).toBe(0)
    expect(storage.objects.size).toBe(0)
  })

  it('sin foto, solo borra el registro', async () => {
    const { entries, storage, entry } = await withEntry(false)
    await deleteLogEntry({ userId: USER_ID, entry, entries, storage })
    expect(entries.rows.size).toBe(0)
  })

  it('si no se puede borrar el registro, no toca la foto', async () => {
    const { entries, storage, entry } = await withEntry(true)
    entries.fail = () => ({
      when: 'before',
      error: new PlantLogError('offline'),
    })
    await expect(
      deleteLogEntry({ userId: USER_ID, entry, entries, storage }),
    ).rejects.toMatchObject({ reason: 'offline' })
    expect(entries.rows.size).toBe(1)
    expect(logFiles(storage)).toHaveLength(2)
  })

  it('si la foto no se puede borrar, el registro queda borrado sin error', async () => {
    const { entries, storage, entry } = await withEntry(true)
    storage.remove = () => Promise.reject(new PhotoStorageError('offline'))
    const result = await deleteLogEntry({
      userId: USER_ID,
      entry,
      entries,
      storage,
    })
    expect(result).toEqual({ photoDeleted: false })
    expect(entries.rows.size).toBe(0)
  })

  it('un registro que ya no existía cuenta como borrado (reintento)', async () => {
    const { entries, storage, entry } = await withEntry(false)
    entries.rows.clear()
    await expect(
      deleteLogEntry({ userId: USER_ID, entry, entries, storage }),
    ).resolves.toEqual({ photoDeleted: true })
  })
})
