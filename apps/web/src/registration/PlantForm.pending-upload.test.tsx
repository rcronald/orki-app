import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollectionPlant } from '../collection/model.ts'
import { localDateString } from '../lib/localDate.ts'
import { uploadPlantPhotos } from '../photos/gallery.ts'
import { createMemoryPlantPhotoRows } from '../photos/memory-photo-rows.ts'
import { createMemoryPhotoStorage } from '../photos/memory-storage.ts'
import { PhotoStorageError } from '../photos/storage.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import { plant } from '../test/collection.ts'
import { processedPhoto } from '../test/photos.ts'
import { plantDraftKey, writePlantDraft } from './draft.ts'
import {
  createMemoryDraftPhotoBackend,
  draftPhotoKey,
  writeDraftPhotos,
  type DraftPhotoBackend,
} from './draft-photo.ts'
import { initialPlantFormValues } from './form-state.ts'
import {
  pendingUploadKey,
  readPendingUpload,
  writePendingUpload,
} from './pending-upload.ts'
import { PlantForm, type PlantFormServices } from './PlantForm.tsx'
import { PENDING_UPLOAD_TEXT } from './texts.ts'

// El registro con fotos por subir (#284): la planta ya está guardada y sus
// fotos se están subiendo (o alguna falló). Salir pide confirmación, lo que
// falta queda en el dispositivo ligado a la planta y se borra al quedar todo
// subido o al seguir sin ellas.

const USER = 'user_ana'
const PLANT_ID = '6f1c2a4e-8b3d-4e5f-9a7b-0c1d2e3f4a5b'
const OTHER_PLANT = '7a2b3c4d-1e2f-4a5b-8c6d-0e1f2a3b4c5d'
const NOW = new Date('2026-11-24T10:00:00')
const VANDA = { id: '20000000-0000-4000-8000-000000000007', name: 'Vanda' }

function Location() {
  return <div data-testid="lugar">{useLocation().pathname}</div>
}

/** Subidas que esperan a que la prueba las suelte, una a una. */
function heldStorage() {
  const storage = createMemoryPhotoStorage()
  const upload = storage.upload.bind(storage)
  const held: { path: string; resolve: () => void }[] = []
  let holding = true
  storage.upload = async (path, blob, options) => {
    if (holding) {
      await new Promise<void>((resolve) => held.push({ path, resolve }))
    }
    return upload(path, blob, options)
  }
  return {
    storage,
    /** Suelta las subidas en espera (y deja de retener las siguientes). */
    releaseAll: () => {
      holding = false
      for (const { resolve } of held.splice(0)) resolve()
    },
    /** Cuántas subidas de archivo hay esperando. */
    waiting: () => held.length,
    /** Rutas de las subidas que esperan. */
    paths: () => held.map(({ path }) => path),
    /** Suelta las subidas que esperan cuya ruta contiene `part`. */
    release: (part: string) => {
      for (const entry of held.filter(({ path }) => path.includes(part))) {
        held.splice(held.indexOf(entry), 1)
        entry.resolve()
      }
    },
  }
}

interface SetupOptions {
  photos?: number
  backend?: DraftPhotoBackend & { entries?: Map<string, unknown> }
  failPath?: (path: string) => boolean
}

async function setup({
  photos = 2,
  backend = createMemoryDraftPhotoBackend(),
  failPath,
}: SetupOptions = {}) {
  // Un borrador completo con sus fotos: al abrir el registro, se recupera.
  writePlantDraft(USER, {
    plantId: PLANT_ID,
    savedAt: NOW.getTime(),
    values: {
      ...initialPlantFormValues(localDateString(NOW)),
      name: 'Vanda Pachara Delight',
      genus: VANDA,
      type: 'hybrid',
      photoInBloom: true,
    },
  })
  await writeDraftPhotos(backend, USER, {
    plantId: PLANT_ID,
    savedAt: NOW.getTime(),
    photos: Array.from({ length: photos }, (_, index) => ({
      fileName: `foto-${String(index + 1)}.jpg`,
      photo: processedPhoto(),
    })),
  })

  const rows = createMemoryPlantPhotoRows()
  const held = heldStorage()
  if (failPath) {
    held.storage.failUploads = (path) =>
      failPath(path) ? new PhotoStorageError('failed') : null
  }
  const savePlant = vi.fn((insert: { id: string }) => {
    const saved: CollectionPlant = plant({
      id: insert.id,
      displayName: 'Vanda Pachara Delight',
      displayNameIsScientific: false,
      species: null,
    })
    rows.plants.set(insert.id, { ...saved, userId: USER })
    return Promise.resolve(saved)
  })
  const services: PlantFormServices = {
    searchSpecies: () => Promise.resolve([]),
    searchGenera: () => Promise.resolve([]),
    loadQuickGenera: () => Promise.resolve([VANDA]),
    savePlant,
    uploadPhotos: (list, options) =>
      uploadPlantPhotos(list, {
        ...options,
        storage: held.storage,
        rows,
      }),
  }
  const onSaved = vi.fn()
  const user = userEvent.setup()
  const view = render(
    <MemoryRouter initialEntries={['/coleccion/nueva']}>
      <Location />
      <Routes>
        <Route
          path="/coleccion/nueva"
          element={
            <main>
              <h1>Registrar una orquídea</h1>
              <Link to="/coleccion">Mi colección</Link>
              <PlantForm
                services={services}
                online
                draftUserId={USER}
                photoDraftBackend={backend}
                now={() => NOW}
                camera="hide"
                onSaved={onSaved}
                onCancel={() => undefined}
              />
            </main>
          }
        />
        <Route path="*" element={<p>Otra página</p>} />
      </Routes>
    </MemoryRouter>,
  )
  // Las fotos del borrador llegan después (IndexedDB es asíncrono).
  await waitFor(() =>
    expect(
      within(screen.getByRole('region', { name: /^Fotos/ })).getAllByRole(
        'img',
      ),
    ).toHaveLength(photos),
  )
  return { ...held, rows, backend, user, onSaved, savePlant, view }
}

const submit = () => screen.getByRole('button', { name: 'Registrar orquídea' })
const place = () => screen.getByTestId('lugar').textContent

beforeEach(() => {
  document.documentElement.lang = 'es'
  document.title = 'Registrar una orquídea'
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('registro con fotos por subir (#284)', () => {
  it('al guardar la planta, sus fotos pasan del borrador a las «por subir» y se borran al quedar todas subidas', async () => {
    const { backend, user, onSaved, rows, waiting, releaseAll } = await setup()
    await user.click(submit())

    // Subiendo: el borrador ya no está, las fotos sí, ligadas a la planta.
    await waitFor(() => expect(waiting()).toBeGreaterThan(0))
    expect(window.localStorage.getItem(plantDraftKey(USER))).toBeNull()
    const memory = backend as ReturnType<typeof createMemoryDraftPhotoBackend>
    expect(memory.entries.has(draftPhotoKey(USER, PLANT_ID))).toBe(false)
    const pending = await readPendingUpload(backend, USER, {
      plantId: PLANT_ID,
      now: NOW,
    })
    expect(pending?.plantName).toBe('Vanda Pachara Delight')
    expect(pending?.photos.map((photo) => photo.inBloom)).toEqual([true, false])

    act(() => releaseAll())
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(rows.photosOf(PLANT_ID)).toHaveLength(2)
    expect(memory.entries.has(pendingUploadKey(USER, PLANT_ID))).toBe(false)
  })

  it('salir por un enlace mientras suben pide confirmación; «Seguir aquí» se queda', async () => {
    const { user, onSaved, waiting, releaseAll } = await setup()
    await user.click(submit())
    await waitFor(() => expect(waiting()).toBeGreaterThan(0))

    await user.click(screen.getByRole('link', { name: 'Mi colección' }))
    const dialog = screen.getByRole('dialog', {
      name: PENDING_UPLOAD_TEXT.leaveTitle,
    })
    expect(dialog).toHaveAccessibleDescription(PENDING_UPLOAD_TEXT.leaveKept)
    // La acción segura tiene el foco.
    expect(
      within(dialog).getByRole('button', {
        name: PENDING_UPLOAD_TEXT.leaveStay,
      }),
    ).toHaveFocus()
    await expectNoAxeViolations()
    await user.click(
      within(dialog).getByRole('button', {
        name: PENDING_UPLOAD_TEXT.leaveStay,
      }),
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(place()).toBe('/coleccion/nueva')

    act(() => releaseAll())
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
  })

  it('cerrar o recargar la pestaña mientras suben pide el aviso del navegador', async () => {
    const { user, waiting, releaseAll, onSaved } = await setup()
    const unload = () => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }
    expect(unload()).toBe(false)
    await user.click(submit())
    await waitFor(() => expect(waiting()).toBeGreaterThan(0))
    await waitFor(() => expect(unload()).toBe(true))

    act(() => releaseAll())
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(unload()).toBe(false)
  })

  it('si se sale igual, lo que no se subió queda en el dispositivo para esa planta', async () => {
    const { backend, user, waiting, paths, release, onSaved, rows } =
      await setup({ photos: 3 })
    await user.click(submit())
    // Las tres a la vez (de tres en tres), con sus dos archivos cada una.
    await waitFor(() => expect(waiting()).toBe(6))
    // La primera termina: sus dos archivos y su fila.
    const version = /photo-([^.]+)\./.exec(paths()[0] ?? '')?.[1] ?? ''
    act(() => release(version))
    await waitFor(() => expect(rows.photosOf(PLANT_ID)).toHaveLength(1))
    await waitFor(async () =>
      expect(
        (
          await readPendingUpload(backend, USER, {
            plantId: PLANT_ID,
            now: NOW,
          })
        )?.photos,
      ).toHaveLength(2),
    )

    await user.click(screen.getByRole('link', { name: 'Mi colección' }))
    await user.click(
      screen.getByRole('button', { name: PENDING_UPLOAD_TEXT.leaveConfirm }),
    )
    await waitFor(() => expect(place()).toBe('/coleccion'))
    expect(onSaved).not.toHaveBeenCalled()

    const kept = await readPendingUpload(backend, USER, {
      plantId: PLANT_ID,
      now: NOW,
    })
    expect(kept?.photos.map((photo) => photo.fileName)).toEqual([
      'foto-2.jpg',
      'foto-3.jpg',
    ])
  })

  it('si una falla y la persona sigue sin ella, no se ofrece después', async () => {
    let first = ''
    const { backend, user, onSaved, releaseAll } = await setup({
      failPath: (path) => {
        first ||= path.replace(/.*\/(?:photo|thumb)-/, '').replace(/\..*/, '')
        return path.includes(first)
      },
    })
    releaseAll()
    await user.click(submit())
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('no se pudo subir')
    const pending = await readPendingUpload(backend, USER, {
      plantId: PLANT_ID,
      now: NOW,
    })
    expect(pending?.photos).toHaveLength(1)

    await user.click(
      screen.getByRole('button', { name: 'Continuar sin ellas' }),
    )
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(
      await readPendingUpload(backend, USER, { plantId: PLANT_ID, now: NOW }),
    ).toBeNull()
  })

  it('sin almacenamiento en el dispositivo, el aviso dice que se perderán', async () => {
    const memory = createMemoryDraftPhotoBackend()
    const backend: DraftPhotoBackend = {
      ...memory,
      // Las fotos por subir no se pueden guardar (Safari en privado).
      put: (key, value) =>
        key.includes('/subir:')
          ? Promise.reject(new Error('IndexedDB'))
          : memory.put(key, value),
    }
    const { user, waiting, releaseAll, onSaved } = await setup({ backend })
    await user.click(submit())
    await waitFor(() => expect(waiting()).toBeGreaterThan(0))
    await user.click(screen.getByRole('link', { name: 'Mi colección' }))
    expect(
      screen.getByRole('dialog', { name: PENDING_UPLOAD_TEXT.leaveTitle }),
    ).toHaveAccessibleDescription(PENDING_UPLOAD_TEXT.leaveLost)
    await user.click(
      screen.getByRole('button', { name: PENDING_UPLOAD_TEXT.leaveStay }),
    )
    act(() => releaseAll())
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('al abrir el registro, avisa de las fotos sin subir de otra planta con un enlace a su ficha', async () => {
    const backend = createMemoryDraftPhotoBackend()
    await writePendingUpload(backend, USER, {
      plantId: OTHER_PLANT,
      plantName: 'Cattleya maxima',
      plantNameIsScientific: true,
      savedAt: NOW.getTime(),
      photos: [
        {
          fileName: 'a.jpg',
          photo: processedPhoto(),
          version: 'v-1',
          inBloom: false,
        },
        {
          fileName: 'b.jpg',
          photo: processedPhoto(),
          version: 'v-2',
          inBloom: false,
        },
      ],
    })
    const { releaseAll } = await setup({ backend })
    releaseAll()
    const link = await screen.findByRole('link', {
      name: PENDING_UPLOAD_TEXT.noticeAction,
    })
    expect(link).toHaveAttribute('href', `/coleccion/${OTHER_PLANT}`)
    expect(link).toHaveAccessibleDescription(
      'Quedaron 2 fotos sin subir de Cattleya maxima.',
    )
    await expectNoAxeViolations()
  })
})
