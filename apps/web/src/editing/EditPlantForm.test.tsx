import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollectionPlant } from '../collection/model.ts'
import { PhotoProcessingError } from '../photos/errors.ts'
import { createMemoryPlantPhotoRows } from '../photos/memory-photo-rows.ts'
import { createMemoryPhotoStorage } from '../photos/memory-storage.ts'
import type { ProcessedPhoto } from '../photos/process.ts'
import { PhotoStorageError } from '../photos/storage.ts'
import { PlantImagesContext } from '../photos/usePlantImage.ts'
import type { PlantPatch } from '../registration/form-state.ts'
import { PlantSaveError } from '../registration/save-plant.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import { plant } from '../test/collection.ts'
import { processedPhoto, USER_ID } from '../test/photos.ts'
import { fakeImageSource } from '../test/plant-routes.tsx'
import { EditPlantForm, type EditPlantServices } from './EditPlantForm.tsx'

// jsdom no tiene canvas: la preparación de la foto es un doble.
const processPhoto = vi.hoisted(() =>
  vi.fn<
    (file: Blob, options: { signal?: AbortSignal }) => Promise<ProcessedPhoto>
  >(),
)
vi.mock('../photos/load.ts', () => ({
  loadPhotoProcessing: () =>
    Promise.resolve({ processPhoto, PhotoProcessingError }),
}))

const PLANT_ID = '6f1c2a4e-8b3d-4e5f-9a7b-0c1d2e3f4a5b'
const GENUS = { id: 'genero-cattleya', name: 'Cattleya' }

function cattleya(notes: string | null = null): CollectionPlant {
  return plant({
    code: 'CAT-002',
    notes,
    id: PLANT_ID,
    displayName: 'Cattleya maxima',
    displayNameIsScientific: false,
    enteredName: 'Cattleya maxima',
    species: null,
    genus: GENUS,
    type: 'species',
    validation: 'pending',
    acquiredOn: '2026-05-02',
    origin: null,
    location: 'Invernadero',
    nickname: null,
    flowerColor: null,
    photoPath: null,
    thumbnailPath: null,
  })
}

function setup(photoCount: number, notes: string | null = null) {
  const rows = createMemoryPlantPhotoRows()
  const storage = createMemoryPhotoStorage()
  const current = cattleya(notes)
  rows.plants.set(PLANT_ID, { ...current, userId: USER_ID })
  for (let position = 0; position < photoCount; position += 1) {
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
  const updatePlant = vi.fn((_id: string, patch: PlantPatch) =>
    Promise.resolve({
      ...current,
      ...(patch.nickname ? { nickname: patch.nickname } : {}),
    }),
  )
  const services: EditPlantServices = {
    searchSpecies: () => Promise.resolve([]),
    searchGenera: () => Promise.resolve([]),
    loadQuickGenera: () => Promise.resolve([GENUS]),
    rows,
    storage,
    updatePlant,
  }
  const onSaved = vi.fn()
  const onCancel = vi.fn()
  const onPlantStored = vi.fn()

  function Location() {
    const location = useLocation()
    return <div data-testid="location">{location.pathname}</div>
  }
  let setShown: (plant: CollectionPlant) => void = () => undefined
  function Harness() {
    const cancelRef = useRef<(() => void) | null>(null)
    // La planta de la colección puede cambiar (llega la lectura de la red).
    const [shown, setter] = useState(current)
    setShown = setter
    return (
      <main>
        <EditPlantForm
          plant={shown}
          userId={USER_ID}
          services={services}
          online
          knownPlants={[current]}
          onPlantStored={onPlantStored}
          onSaved={onSaved}
          onCancel={onCancel}
          cancelRef={cancelRef}
          now={() => new Date('2026-11-23T12:00:00')}
        />
      </main>
    )
  }
  const images = fakeImageSource()
  const user = userEvent.setup()
  const { unmount } = render(
    <PlantImagesContext value={images.source}>
      <MemoryRouter initialEntries={['/coleccion/x/editar']}>
        <Location />
        <Routes>
          <Route path="/coleccion/x/editar" element={<Harness />} />
          <Route path="*" element={<p>Otra página</p>} />
        </Routes>
      </MemoryRouter>
    </PlantImagesContext>,
  )
  return {
    rows,
    storage,
    updatePlant,
    onSaved,
    onCancel,
    onPlantStored,
    user,
    unmount,
    showPlant: (next: CollectionPlant) => {
      act(() => setShown(next))
    },
  }
}

const gallery = () => screen.getByRole('region', { name: /^Fotos/ })
const manager = () => screen.getByRole('region', { name: 'Gestionar fotos' })
const submit = () => screen.getByRole('button', { name: 'Guardar cambios' })

async function loaded(count: number) {
  await waitFor(() =>
    expect(within(gallery()).getByText(`${String(count)} de 6`)).toBeVisible(),
  )
}

async function choosePhotos(
  user: ReturnType<typeof userEvent.setup>,
  count: number,
) {
  const input = document.querySelector<HTMLInputElement>(
    'input[type="file"][multiple]',
  )
  if (!input) throw new Error('Sin campo de archivos.')
  await user.upload(
    input,
    Array.from(
      { length: count },
      (_, index) =>
        new File([new Uint8Array(10)], `IMG_${String(index)}.jpg`, {
          type: 'image/jpeg',
        }),
    ),
  )
  await waitFor(() =>
    expect(document.querySelector('.orki-gallery__item--preparing')).toBeNull(),
  )
}

beforeEach(() => {
  document.documentElement.lang = 'es'
  document.title = 'Editar planta'
  processPhoto.mockReset()
  processPhoto.mockImplementation(() => Promise.resolve(processedPhoto()))
  URL.createObjectURL = vi.fn(
    (blob: Blob) => `blob:prueba-${String(blob.size)}`,
  )
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('EditPlantForm', () => {
  it('muestra los datos a la vista, la ubicación con su valor y las fotos guardadas', async () => {
    setup(3)
    await loaded(3)
    expect(screen.getByRole('combobox', { name: 'Ubicación' })).toHaveValue(
      'Invernadero',
    )
    expect(
      screen.getByRole('button', { name: /Más detalles/ }),
    ).toHaveAttribute('aria-expanded', 'false')
    expect(
      within(gallery()).getByRole('button', { name: 'Añadir fotos' }),
    ).toBeVisible()
    expect(
      within(gallery()).getByRole('button', { name: 'Gestionar fotos' }),
    ).toBeVisible()
    await expectNoAxeViolations()
  })

  it('con notas, «Más detalles» se abre sola y las notas cuentan sus caracteres', async () => {
    setup(0, 'Riego cada cinco días.')
    await loaded(0)
    expect(
      screen.getByRole('button', { name: /Más detalles/ }),
    ).toHaveAttribute('aria-expanded', 'true')
    const notes = screen.getByLabelText('Notas')
    expect(notes).toHaveValue('Riego cada cinco días.')
    expect(notes).toHaveAccessibleDescription(
      'Lo que quieras recordar de esta planta. 22 de 2000 caracteres',
    )
  })

  it('sin cambios, «Guardar cambios» sale sin escribir nada', async () => {
    const { user, onSaved, updatePlant } = setup(1)
    await loaded(1)
    await user.click(submit())
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith(expect.anything(), {
        changed: false,
      }),
    )
    expect(updatePlant).not.toHaveBeenCalled()
  })

  it('una copia sin notas no las pisa: si llegan después, el campo las muestra y no se envían', async () => {
    const { user, updatePlant, onSaved, showPlant } = setup(0, null)
    await loaded(0)
    expect(screen.getByLabelText('Notas')).toHaveValue('')
    showPlant(cattleya('Riego cada cinco días.'))
    expect(screen.getByLabelText('Notas')).toHaveValue('Riego cada cinco días.')
    await user.type(
      screen.getByRole('combobox', { name: 'Ubicación' }),
      ' alto',
    )
    await user.click(submit())
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(updatePlant).toHaveBeenCalledWith(PLANT_ID, {
      location: 'Invernadero alto',
    })
  })

  it('sin tocar las notas, guardar otro cambio no envía notes', async () => {
    const { user, updatePlant, onSaved } = setup(0, null)
    await loaded(0)
    await user.type(
      screen.getByRole('combobox', { name: 'Ubicación' }),
      ' alto',
    )
    await user.click(submit())
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(updatePlant.mock.calls[0]?.[1]).not.toHaveProperty('notes')
  })

  it('vaciar las notas las guarda como null', async () => {
    const { user, updatePlant, onSaved } = setup(0, 'Algo')
    await loaded(0)
    await user.clear(screen.getByLabelText('Notas'))
    await user.type(screen.getByLabelText('Notas'), '   ')
    await user.click(submit())
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(updatePlant).toHaveBeenCalledWith(PLANT_ID, { notes: null })
  })

  it('unas notas de más de 2000 caracteres no se guardan y el foco va a ellas', async () => {
    const { user, updatePlant } = setup(0, 'x'.repeat(2001))
    await loaded(0)
    await user.click(submit())
    const notes = screen.getByLabelText('Notas')
    expect(notes).toHaveFocus()
    expect(notes).toHaveAccessibleDescription(
      /Las notas pueden tener hasta 2000 caracteres\./,
    )
    expect(updatePlant).not.toHaveBeenCalled()
  })

  it('Cancelar sin cambios sale sin preguntar', async () => {
    const first = setup(1)
    await loaded(1)
    await first.user.click(screen.getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(first.onCancel).toHaveBeenCalled())
  })

  it('con cambios, Cancelar pregunta antes de salir', async () => {
    const { user, onCancel } = setup(1)
    await loaded(1)
    await user.type(
      screen.getByRole('combobox', { name: 'Ubicación' }),
      ' alto',
    )
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    const dialog = screen.getByRole('dialog', { name: '¿Salir sin guardar?' })
    expect(
      within(dialog).getByRole('button', { name: 'Seguir editando' }),
    ).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onCancel).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    await user.click(screen.getByRole('button', { name: 'Salir sin guardar' }))
    await waitFor(() => expect(onCancel).toHaveBeenCalled())
  })

  it('un enlace de la app con cambios pregunta; al confirmar, navega', async () => {
    const { user } = setup(0)
    await loaded(0)
    // Un enlace cualquiera de la app, fuera del formulario.
    const link = document.createElement('a')
    link.href = '/coleccion'
    link.textContent = 'Mi colección'
    document.body.append(link)
    await user.type(screen.getByRole('combobox', { name: 'Ubicación' }), 'x')
    await user.click(link)
    expect(
      screen.getByRole('dialog', { name: '¿Salir sin guardar?' }),
    ).toBeVisible()
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/coleccion/x/editar',
    )
    await user.click(screen.getByRole('button', { name: 'Salir sin guardar' }))
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/coleccion$/),
    )
    link.remove()
  })

  it('gestionar fotos: hacer principal, mover y quitar solo cambian el formulario hasta guardar', async () => {
    const { user, rows, onSaved } = setup(3)
    await loaded(3)
    const before = rows.photosOf(PLANT_ID).map((photo) => photo.id)
    await user.click(screen.getByRole('button', { name: 'Gestionar fotos' }))
    expect(
      within(manager()).getByRole('heading', { name: 'Gestionar fotos' }),
    ).toHaveFocus()

    const third = within(manager()).getByRole('group', { name: 'Foto 3 de 3' })
    await user.click(
      within(third).getByRole('button', { name: 'Hacer principal' }),
    )
    const main = within(manager()).getByRole('group', {
      name: 'Foto principal',
    })
    expect(
      within(main).getByRole('button', { name: 'Hacer principal' }),
    ).toHaveFocus()
    expect(
      within(main).getByRole('button', { name: 'Hacer principal' }),
    ).toHaveAccessibleDescription('Ya es la principal.')

    const second = within(manager()).getByRole('group', { name: 'Foto 2 de 3' })
    await user.click(within(second).getByRole('button', { name: 'Quitar' }))
    expect(within(manager()).getByText('2 de 6')).toBeVisible()
    expect(
      screen.getByText('Una foto guardada se quitará al guardar los cambios.'),
    ).toBeVisible()
    // Nada salió todavía.
    expect(rows.photosOf(PLANT_ID).map((photo) => photo.id)).toEqual(before)

    await user.click(screen.getByRole('button', { name: 'Listo' }))
    expect(
      screen.getByRole('button', { name: 'Gestionar fotos' }),
    ).toHaveFocus()
    await user.click(submit())
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith(expect.anything(), {
        changed: true,
      }),
    )
    expect(rows.photosOf(PLANT_ID).map((photo) => photo.id)).toEqual([
      'foto-2',
      'foto-1',
    ])
  })

  it('una fecha futura en una foto abre la gestión y lleva el foco a ella', async () => {
    const { user, rows, updatePlant } = setup(1)
    await loaded(1)
    await user.click(screen.getByRole('button', { name: 'Gestionar fotos' }))
    const date = within(manager()).getByLabelText('Fecha de la foto')
    await user.type(date, '2030-01-01')
    await user.click(screen.getByRole('button', { name: 'Listo' }))
    await user.click(submit())
    const again = within(manager()).getByLabelText('Fecha de la foto')
    expect(again).toHaveFocus()
    expect(again).toHaveAccessibleDescription(
      'La fecha no puede ser posterior a hoy.',
    )
    expect(updatePlant).not.toHaveBeenCalled()
    expect(rows.photosOf(PLANT_ID)[0]?.takenAt).toBeNull()
  })

  it('con seis fotos, «Añadir fotos» se desactiva y dice por qué', async () => {
    const { user } = setup(4)
    await loaded(4)
    await choosePhotos(user, 3)
    expect(within(gallery()).getByText('6 de 6')).toBeVisible()
    const add = within(gallery()).getByRole('button', { name: 'Añadir fotos' })
    expect(add).toHaveAttribute('aria-disabled', 'true')
    expect(add).toHaveAccessibleDescription(
      'Ya tienes 6 fotos. Quita una para añadir otra.',
    )
  })

  it('si falla una subida, lo dice, no toca la base y «Reintentar» termina sin duplicar', async () => {
    const { user, rows, storage, onSaved } = setup(1)
    await loaded(1)
    await choosePhotos(user, 1)
    let fails = true
    storage.failUploads = () =>
      fails ? new PhotoStorageError('offline') : null
    await user.click(submit())
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('No se pudo subir la foto 2 de 2.')
    expect(alert).toHaveTextContent('Aún no se guardó ningún cambio')
    expect(
      within(alert).getByRole('button', { name: 'Reintentar' }),
    ).toHaveFocus()
    expect(rows.photosOf(PLANT_ID)).toHaveLength(1)

    fails = false
    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(rows.photosOf(PLANT_ID)).toHaveLength(2)
    expect([...storage.objects.keys()]).toHaveLength(4)
  })

  it('si falla el guardado de los datos, se conserva lo escrito y avisa de lo ya guardado', async () => {
    const { user, updatePlant, onSaved, rows } = setup(2)
    await loaded(2)
    updatePlant.mockRejectedValueOnce(new PlantSaveError('offline'))
    rows.failReorder = () => ({ error: new PhotoStorageError('offline') })
    await user.click(screen.getByRole('button', { name: /Más detalles/ }))
    await user.type(screen.getByLabelText('Apodo'), 'La morada')
    await user.click(screen.getByRole('button', { name: 'Gestionar fotos' }))
    await user.click(
      within(
        within(manager()).getByRole('group', { name: 'Foto 2 de 2' }),
      ).getByRole('button', { name: 'Hacer principal' }),
    )
    await user.click(submit())
    let alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Aún no se guardó ningún cambio')
    expect(screen.getByLabelText('Apodo')).toHaveValue('La morada')

    // Ahora los datos se guardan, pero el orden falla: ya hay algo guardado.
    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }))
    alert = await screen.findByRole('alert')
    await waitFor(() =>
      expect(alert).toHaveTextContent('Parte de los cambios ya quedó guardada'),
    )
    expect(alert).toHaveTextContent(
      'No se pudieron guardar los cambios de las fotos.',
    )

    rows.failReorder = undefined
    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    // Los datos se enviaron una sola vez con éxito (no se reenvían).
    expect(updatePlant).toHaveBeenCalledTimes(2)
    expect(rows.photosOf(PLANT_ID)[0]?.id).toBe('foto-1')
  })
})

type Context = ReturnType<typeof setup>

/**
 * El invariante del guardado (#279): el bucket tiene exactamente los archivos
 * que citan las filas y la principal de la planta apunta a un archivo que
 * existe.
 */
function expectConsistent({ rows, storage }: Context) {
  const cited = rows
    .photosOf(PLANT_ID)
    .flatMap((photo) => [photo.photoPath, photo.thumbnailPath])
    .sort()
  expect([...storage.objects.keys()].sort()).toEqual(cited)
  const current = rows.plants.get(PLANT_ID)
  for (const path of [current?.photoPath, current?.thumbnailPath]) {
    if (path) expect(storage.objects.has(path)).toBe(true)
  }
}

/** Retiene la creación de filas hasta que la prueba la suelte. */
function holdInserts(rows: Context['rows']) {
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const insertRow = rows.insert.bind(rows)
  const insert = vi.spyOn(rows, 'insert').mockImplementation(async (row) => {
    await gate
    return insertRow(row)
  })
  return { insert, release }
}

/** Un enlace cualquiera de la app, fuera del formulario. */
function appLink() {
  const link = document.createElement('a')
  link.href = '/coleccion'
  link.textContent = 'Mi colección'
  document.body.append(link)
  return link
}

const photoGroup = (name: string) =>
  within(manager()).getByRole('group', { name })

describe('guardado a prueba de salidas, reintentos y huérfanos (#279)', () => {
  it('a) durante el guardado, un enlace no ofrece «Salir sin guardar» y el guardado termina', async () => {
    const context = setup(0)
    const { user, rows, onSaved } = context
    await loaded(0)
    await choosePhotos(user, 1)
    const { insert, release } = holdInserts(rows)
    await user.click(submit())
    await waitFor(() => expect(insert).toHaveBeenCalled())

    const link = appLink()
    await user.click(link)
    expect(
      screen.queryByRole('button', { name: 'Salir sin guardar' }),
    ).toBeNull()
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/coleccion/x/editar',
    )
    const busy = screen.getByRole('dialog', {
      name: 'Se están guardando los cambios',
    })
    expect(busy).toHaveAccessibleDescription(
      'Espera a que termine: si sales a mitad, el guardado puede quedar incompleto. Al terminar volverás a la ficha.',
    )
    expect(
      within(busy).getByRole('button', { name: 'Entendido' }),
    ).toHaveFocus()

    release()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(rows.photosOf(PLANT_ID)).toHaveLength(1)
    expectConsistent(context)
    link.remove()
  })

  it('a) el aviso de esperar se cierra si el guardado falla y no vuelve en el reintento', async () => {
    const context = setup(0)
    const { user, rows, onSaved } = context
    await loaded(0)
    await choosePhotos(user, 1)
    const { insert, release } = holdInserts(rows)
    rows.failInsert = () => ({ error: new PhotoStorageError('offline') })
    await user.click(submit())
    await waitFor(() => expect(insert).toHaveBeenCalled())
    const link = appLink()
    await user.click(link)
    expect(
      screen.getByRole('dialog', { name: 'Se están guardando los cambios' }),
    ).toBeVisible()

    release()
    const alert = await screen.findByRole('alert')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(
      within(alert).getByRole('button', { name: 'Reintentar' }),
    ).toHaveFocus()

    rows.failInsert = undefined
    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expectConsistent(context)
    link.remove()
  })

  it('salir tras un guardado a medias borra lo que ninguna fila cita', async () => {
    const context = setup(2)
    const { user, rows, onCancel, unmount } = context
    await loaded(2)
    await choosePhotos(user, 1)
    await user.click(screen.getByRole('button', { name: 'Gestionar fotos' }))
    await user.click(
      within(photoGroup('Foto principal')).getByRole('button', {
        name: 'Quitar',
      }),
    )
    await user.type(
      within(photoGroup('Foto principal')).getByLabelText('Nota'),
      'Nueva vara',
    )
    await user.click(screen.getByRole('button', { name: 'Listo' }))
    rows.failUpdate = () => ({ error: new PhotoStorageError('offline') })
    await user.click(submit())
    await screen.findByRole('alert')
    // La fila de la quitada ya no está y la nueva ya tiene la suya.
    expect(rows.photosOf(PLANT_ID).map((photo) => photo.id)).not.toContain(
      'foto-0',
    )

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    const dialog = screen.getByRole('dialog', { name: '¿Salir sin guardar?' })
    expect(dialog).toHaveTextContent('Parte de los cambios ya quedó guardada')
    await user.click(
      within(dialog).getByRole('button', { name: 'Salir sin guardar' }),
    )
    await waitFor(() => expect(onCancel).toHaveBeenCalled())
    // La página sale de la edición: el formulario se desmonta.
    unmount()
    await waitFor(() => expectConsistent(context))
    expect(rows.photosOf(PLANT_ID)).toHaveLength(2)
  })

  it('a) si el formulario se desmonta durante el guardado, no navega ni deja filas sin archivo', async () => {
    const context = setup(1)
    const { user, rows, onSaved, unmount } = context
    await loaded(1)
    await choosePhotos(user, 1)
    const { insert, release } = holdInserts(rows)
    await user.click(submit())
    await waitFor(() => expect(insert).toHaveBeenCalled())

    unmount()
    release()
    await waitFor(() => expect(rows.photosOf(PLANT_ID)).toHaveLength(2))
    // Lo que quede por hacer (borrar lo que sobra) ya terminó.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(onSaved).not.toHaveBeenCalled()
    expectConsistent(context)
  })

  it('b) quitar una foto nueva que ya tiene fila tras un fallo del orden: «Reintentar» termina', async () => {
    const context = setup(1)
    const { user, rows, onSaved } = context
    await loaded(1)
    await choosePhotos(user, 1)
    await user.click(screen.getByRole('button', { name: 'Gestionar fotos' }))
    await user.click(
      within(photoGroup('Foto 2 de 2')).getByRole('button', {
        name: 'Hacer principal',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Listo' }))
    rows.failReorder = () => ({ error: new PhotoStorageError('offline') })
    await user.click(submit())
    const alert = await screen.findByRole('alert')
    expect(rows.photosOf(PLANT_ID)).toHaveLength(2)

    rows.failReorder = undefined
    await user.click(screen.getByRole('button', { name: 'Gestionar fotos' }))
    await user.click(
      within(photoGroup('Foto principal')).getByRole('button', {
        name: 'Quitar',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Listo' }))
    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(rows.photosOf(PLANT_ID).map((photo) => photo.id)).toEqual(['foto-0'])
    expectConsistent(context)
  })

  it('b) tras borrar la fila de una foto quitada, no se ofrece «Deshacer» y «Reintentar» termina', async () => {
    const context = setup(2)
    const { user, rows, onSaved } = context
    await loaded(2)
    await user.click(screen.getByRole('button', { name: 'Gestionar fotos' }))
    await user.click(
      within(photoGroup('Foto principal')).getByRole('button', {
        name: 'Quitar',
      }),
    )
    await user.type(
      within(photoGroup('Foto principal')).getByLabelText('Nota'),
      'Nueva vara',
    )
    await user.click(screen.getByRole('button', { name: 'Listo' }))
    rows.failUpdate = () => ({ error: new PhotoStorageError('offline') })
    await user.click(submit())
    const alert = await screen.findByRole('alert')
    expect(rows.photosOf(PLANT_ID).map((photo) => photo.id)).toEqual(['foto-1'])
    // La fila ya no está: no hay nada que deshacer.
    expect(screen.queryByRole('button', { name: 'Deshacer' })).toBeNull()

    rows.failUpdate = undefined
    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(rows.photosOf(PLANT_ID)[0]?.note).toBe('Nueva vara')
    expectConsistent(context)
  })

  it('c) una foto subida que se quita antes de reintentar no queda huérfana', async () => {
    const context = setup(1)
    const { user, rows, updatePlant, onSaved } = context
    await loaded(1)
    await choosePhotos(user, 1)
    await user.click(screen.getByRole('button', { name: /Más detalles/ }))
    await user.type(screen.getByLabelText('Apodo'), 'La morada')
    updatePlant.mockRejectedValueOnce(new PlantSaveError('offline'))
    await user.click(submit())
    const alert = await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: 'Gestionar fotos' }))
    await user.click(
      within(photoGroup('Foto 2 de 2')).getByRole('button', { name: 'Quitar' }),
    )
    await user.click(screen.getByRole('button', { name: 'Listo' }))
    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(rows.photosOf(PLANT_ID).map((photo) => photo.id)).toEqual(['foto-0'])
    expectConsistent(context)
  })

  it('si la planta ya no existe, lo dice y lleva a «Mi colección» en vez de reintentar', async () => {
    const { user, rows, updatePlant } = setup(1)
    await loaded(1)
    await user.click(screen.getByRole('button', { name: /Más detalles/ }))
    await user.type(screen.getByLabelText('Apodo'), 'La morada')
    rows.plants.delete(PLANT_ID)
    rows.rows.clear()
    updatePlant.mockRejectedValue(new PlantSaveError('not-found'))
    await user.click(submit())
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'Esta orquídea ya no está en tu colección: puede que se haya eliminado desde otro dispositivo.',
    )
    expect(
      within(alert).queryByRole('button', { name: 'Reintentar' }),
    ).toBeNull()
    const go = within(alert).getByRole('link', { name: 'Ir a Mi colección' })
    expect(go).toHaveFocus()
    await user.click(go)
    // Sin preguntar: no hay nada que guardar.
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/coleccion$/),
    )
  })
})
