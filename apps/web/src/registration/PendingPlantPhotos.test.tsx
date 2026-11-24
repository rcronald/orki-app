import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollectionPlant } from '../collection/model.ts'
import {
  uploadPlantPhotos,
  type UploadPlantPhotosResult,
} from '../photos/gallery.ts'
import { createMemoryPlantPhotoRows } from '../photos/memory-photo-rows.ts'
import { createMemoryPhotoStorage } from '../photos/memory-storage.ts'
import { plantPhotoPaths } from '../photos/paths.ts'
import { PhotoStorageError } from '../photos/storage.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import { plant } from '../test/collection.ts'
import { processedPhoto } from '../test/photos.ts'
import { createMemoryDraftPhotoBackend } from './draft-photo.ts'
import {
  readPendingUpload,
  writePendingUpload,
  type PendingUploadPhoto,
} from './pending-upload.ts'
import {
  PendingPlantPhotos,
  type PendingPlantPhotosServices,
} from './PendingPlantPhotos.tsx'
import { PENDING_UPLOAD_TEXT } from './texts.ts'

// «Fotos pendientes de subir» en la ficha (#284): las fotos del registro que
// quedaron en el dispositivo se suben (sin pasar de seis) o se descartan.

const USER = 'user_ana'
const PLANT_ID = '6f1c2a4e-8b3d-4e5f-9a7b-0c1d2e3f4a5b'
const NOW = new Date('2026-11-24T10:00:00')
const text = PENDING_UPLOAD_TEXT

function item(version: string, inBloom = false): PendingUploadPhoto {
  return {
    fileName: `${version}.jpg`,
    photo: processedPhoto(),
    version,
    inBloom,
  }
}

interface SetupOptions {
  pending?: PendingUploadPhoto[]
  /** Fotos que ya tiene la planta. */
  stored?: number
  canUpload?: boolean
}

async function setup({
  pending = [item('v-1', true), item('v-2')],
  stored = 0,
  canUpload = true,
}: SetupOptions = {}) {
  const backend = createMemoryDraftPhotoBackend()
  if (pending.length > 0) {
    await writePendingUpload(backend, USER, {
      plantId: PLANT_ID,
      plantName: 'Vanda Pachara Delight',
      plantNameIsScientific: false,
      savedAt: NOW.getTime(),
      photos: pending,
    })
  }
  const shown: CollectionPlant = plant({ id: PLANT_ID })
  const rows = createMemoryPlantPhotoRows()
  rows.plants.set(PLANT_ID, { ...shown, userId: USER })
  for (let index = 0; index < stored; index += 1) {
    const paths = plantPhotoPaths({
      userId: USER,
      plantId: PLANT_ID,
      version: `ya-${String(index)}`,
      photoType: 'image/webp',
      thumbnailType: 'image/webp',
    })
    await rows.insert({
      plantId: PLANT_ID,
      userId: USER,
      ...paths,
      inBloom: false,
      takenAt: null,
      note: null,
      position: index,
    })
  }
  const storage = createMemoryPhotoStorage()
  const services: PendingPlantPhotosServices = {
    listPhotos: () => rows.list(PLANT_ID, USER),
    upload: vi.fn<PendingPlantPhotosServices['upload']>((photos, options) =>
      uploadPlantPhotos(photos, {
        ...options,
        userId: USER,
        plantId: PLANT_ID,
        storage,
        rows,
      }),
    ),
  }
  const onUploaded = vi.fn<(result: UploadPlantPhotosResult) => void>()
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <main>
        <h1>Vanda Pachara Delight</h1>
        <p id="motivo">Sin conexión.</p>
        <PendingPlantPhotos
          plant={shown}
          userId={USER}
          canUpload={canUpload}
          reasonId={canUpload ? undefined : 'motivo'}
          services={services}
          onUploaded={onUploaded}
          backend={backend}
          now={() => NOW}
        />
      </main>
    </MemoryRouter>,
  )
  return { backend, rows, storage, services, onUploaded, user }
}

const section = () => screen.findByRole('region', { name: text.title })
const pendingNow = (
  backend: ReturnType<typeof createMemoryDraftPhotoBackend>,
) => readPendingUpload(backend, USER, { plantId: PLANT_ID, now: NOW })

beforeEach(() => {
  document.documentElement.lang = 'es'
  document.title = 'Vanda Pachara Delight'
})

describe('PendingPlantPhotos (#284)', () => {
  it('sin fotos pendientes no pinta nada', async () => {
    await setup({ pending: [] })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByRole('region', { name: text.title })).toBeNull()
  })

  it('muestra las fotos y las sube a la planta, con «en floración» y sin duplicar', async () => {
    const { backend, rows, onUploaded, user } = await setup()
    const panel = await section()
    expect(panel).toHaveTextContent(text.description(2))
    const list = within(panel).getByRole('list', { name: text.listLabel })
    const images = within(list).getAllByRole('img')
    expect(images).toHaveLength(2)
    expect(images[0]).toHaveAccessibleName('Foto sin subir 1 de 2')
    expect(images[1]).toHaveAccessibleName('Foto sin subir 2 de 2')
    // Con su miniatura, en cuanto está su URL.
    await waitFor(() =>
      expect(within(list).getAllByRole('img')[0]?.tagName).toBe('IMG'),
    )
    await expectNoAxeViolations()

    await user.click(within(panel).getByRole('button', { name: text.upload }))
    const done = await screen.findByText(text.uploaded(2))
    await waitFor(() => expect(done).toHaveFocus())
    expect(screen.queryByRole('region', { name: text.title })).toBeNull()

    const photos = rows.photosOf(PLANT_ID)
    expect(photos.map((photo) => photo.inBloom)).toEqual([true, false])
    // Con la versión de su primer intento: las rutas de entonces.
    expect(photos[0]?.photoPath).toContain('photo-v-1.')
    expect(photos[1]?.photoPath).toContain('photo-v-2.')
    expect(onUploaded).toHaveBeenCalledTimes(1)
    expect(await pendingNow(backend)).toBeNull()
  })

  it('una foto que un intento anterior ya guardó no se sube otra vez', async () => {
    const { backend, rows, services, user } = await setup({ stored: 0 })
    // La fila de v-1 ya llegó (la recarga se llevó la respuesta).
    await rows.insert({
      plantId: PLANT_ID,
      userId: USER,
      ...plantPhotoPaths({
        userId: USER,
        plantId: PLANT_ID,
        version: 'v-1',
        photoType: 'image/webp',
        thumbnailType: 'image/webp',
      }),
      inBloom: true,
      takenAt: null,
      note: null,
      position: 0,
    })
    const panel = await section()
    await user.click(within(panel).getByRole('button', { name: text.upload }))
    await screen.findByText(text.uploaded(2))
    expect(rows.photosOf(PLANT_ID)).toHaveLength(2)
    expect(vi.mocked(services.upload).mock.calls[0]?.[0]).toHaveLength(1)
    expect(await pendingNow(backend)).toBeNull()
  })

  it('no pasa de seis: sube las que caben y las demás siguen pendientes', async () => {
    const { backend, rows, user } = await setup({ stored: 5 })
    const panel = await section()
    await waitFor(() => expect(panel).toHaveTextContent(text.someRoom(1, 2, 6)))
    await user.click(within(panel).getByRole('button', { name: text.upload }))
    await waitFor(async () =>
      expect((await pendingNow(backend))?.photos).toHaveLength(1),
    )
    expect(rows.photosOf(PLANT_ID)).toHaveLength(6)
    expect(within(panel).getByRole('status')).toHaveTextContent(
      text.uploadedSome(1),
    )
    expect((await pendingNow(backend))?.photos[0]?.version).toBe('v-2')
    // Ya no cabe ninguna: subir queda desactivado, con el motivo.
    const upload = within(panel).getByRole('button', { name: text.uploadOne })
    await waitFor(() => expect(upload).toHaveAttribute('aria-disabled', 'true'))
    expect(upload).toHaveAccessibleDescription(text.noRoom(6))
  })

  it('si falla, lo dice, conserva las que faltan y deja reintentar', async () => {
    const { backend, storage, user } = await setup()
    storage.failUploads = (path) =>
      path.includes('v-2') ? new PhotoStorageError('failed') : null
    const panel = await section()
    await user.click(within(panel).getByRole('button', { name: text.upload }))
    const alert = await within(panel).findByRole('alert')
    expect(alert).toHaveTextContent(text.failed(1))
    await waitFor(() => expect(alert).toHaveFocus())
    expect((await pendingNow(backend))?.photos.map((p) => p.version)).toEqual([
      'v-2',
    ])
    expect(panel).toHaveTextContent(text.description(1))

    storage.failUploads = undefined
    await user.click(
      within(panel).getByRole('button', { name: text.uploadOne }),
    )
    await screen.findByText(text.uploaded(1))
    expect(await pendingNow(backend)).toBeNull()
  })

  it('descartar pide confirmación y las borra del dispositivo', async () => {
    const { backend, rows, user } = await setup()
    const panel = await section()
    await user.click(within(panel).getByRole('button', { name: text.discard }))
    const dialog = screen.getByRole('dialog', { name: text.discardTitle })
    expect(
      within(dialog).getByRole('button', { name: text.discardKeep }),
    ).toHaveFocus()
    await user.click(
      within(dialog).getByRole('button', { name: text.discardKeep }),
    )
    expect(await pendingNow(backend)).not.toBeNull()

    await user.click(within(panel).getByRole('button', { name: text.discard }))
    await user.click(
      within(screen.getByRole('dialog', { name: text.discardTitle })).getByRole(
        'button',
        { name: text.discard },
      ),
    )
    const done = await screen.findByText(text.discarded)
    await waitFor(() => expect(done).toHaveFocus())
    expect(await pendingNow(backend)).toBeNull()
    expect(rows.photosOf(PLANT_ID)).toHaveLength(0)
  })

  it('sin conexión se ven y se pueden descartar, pero subir espera con el motivo', async () => {
    const { services, user } = await setup({ canUpload: false })
    const panel = await section()
    const upload = within(panel).getByRole('button', { name: text.upload })
    expect(upload).toHaveAttribute('aria-disabled', 'true')
    expect(upload).toHaveAccessibleDescription('Sin conexión.')
    await user.click(upload)
    expect(services.upload).not.toHaveBeenCalled()
    expect(
      within(panel).getByRole('button', { name: text.discard }),
    ).not.toHaveAttribute('aria-disabled')
  })
})
