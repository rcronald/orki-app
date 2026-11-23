import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { lazy } from 'react'
import { Route } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PhotoStorageError } from '../photos/storage.ts'
import { PATHS } from '../routes/paths.ts'
import { resetFakeClerk, setFakeClerk } from '../test/clerk-mock.tsx'
import { plant } from '../test/collection.ts'
import { memoryRowsFor, renderPlantRoutes } from '../test/plant-routes.tsx'

vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))
// Sin red: ni la foto de referencia ni los géneros de acceso rápido.
vi.mock('../lib/referencePhotos.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/referencePhotos.ts')>()),
  getSpeciesReferencePhoto: () => Promise.resolve(null),
}))
vi.mock('../registration/quick-genera.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../registration/quick-genera.ts')>()),
  loadQuickAccessGenera: () => Promise.resolve([]),
}))

const EditPlantPage = lazy(() => import('./EditPlantPage.tsx'))

// Cuántas veces se leen las fotos de una planta (plant_photos) en el recorrido
// ficha → editar → guardar → ficha (#285). Objetivo del issue: una lectura,
// la de la ficha, más la del plan de guardado, que es su garantía (cada
// intento parte del estado real de la base).

const USER = 'user_prueba'
const ID = '6f1c2a4e-8b3d-4e5f-9a7b-0c1d2e3f4a5b'
const path = (kind: 'photo' | 'thumb', n: number) =>
  `${USER}/${ID}/${kind}-${String(n)}.webp`

const SUBJECT = plant({
  id: ID,
  photoPath: path('photo', 1),
  thumbnailPath: path('thumb', 1),
})

beforeEach(() => {
  document.documentElement.lang = 'es'
  resetFakeClerk()
  setFakeClerk({ signedIn: true, userId: USER })
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

describe('lecturas de plant_photos entre la ficha, la edición y el guardado (#285)', () => {
  it('ficha → editar → guardar → ficha', async () => {
    const rows = memoryRowsFor([SUBJECT], USER, {
      [ID]: [{ photoPath: path('photo', 2), thumbnailPath: path('thumb', 2) }],
    })
    const list = vi.spyOn(rows, 'list')
    const user = userEvent.setup()
    await renderPlantRoutes({
      entries: [`/coleccion/${ID}`],
      plants: [SUBJECT],
      photoRows: rows,
      extraRoutes: <Route path={PATHS.editPlant} element={<EditPlantPage />} />,
    })
    await act(async () => {
      await Promise.resolve()
    })
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))

    await user.click(await screen.findByRole('link', { name: 'Editar planta' }))
    const manage = await screen.findByRole('button', {
      name: 'Gestionar fotos',
    })
    await user.click(manage)
    const manager = screen.getByRole('region', { name: 'Gestionar fotos' })
    await user.type(
      within(
        within(manager).getByRole('group', { name: 'Foto principal' }),
      ).getByLabelText('Nota'),
      'Primera vara',
    )
    await user.click(screen.getByRole('button', { name: 'Listo' }))
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    // De vuelta en la ficha, con la nota guardada.
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        `/coleccion/${ID}`,
      ),
    )
    await screen.findByText('Primera vara')
    expect(rows.photosOf(ID)[0]?.note).toBe('Primera vara')
    // Antes del #285, cuatro: la ficha, la edición, el plan y la ficha otra
    // vez. Ahora, la de la ficha y la del plan.
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('si el guardado falla, al volver a la ficha se leen otra vez', async () => {
    const rows = memoryRowsFor([SUBJECT], USER)
    const list = vi.spyOn(rows, 'list')
    const user = userEvent.setup()
    await renderPlantRoutes({
      entries: [`/coleccion/${ID}`],
      plants: [SUBJECT],
      photoRows: rows,
      extraRoutes: <Route path={PATHS.editPlant} element={<EditPlantPage />} />,
    })
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    await user.click(await screen.findByRole('link', { name: 'Editar planta' }))
    await user.click(
      await screen.findByRole('button', { name: 'Gestionar fotos' }),
    )
    const manager = screen.getByRole('region', { name: 'Gestionar fotos' })
    await user.type(
      within(
        within(manager).getByRole('group', { name: 'Foto principal' }),
      ).getByLabelText('Nota'),
      'Primera vara',
    )
    await user.click(screen.getByRole('button', { name: 'Listo' }))
    rows.failUpdate = () => ({ error: new PhotoStorageError('offline') })
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await screen.findByRole('alert')
    expect(list).toHaveBeenCalledTimes(2)

    // Sale sin guardar: la ficha no se fía de lo recordado.
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    await user.click(
      within(
        screen.getByRole('dialog', { name: '¿Salir sin guardar?' }),
      ).getByRole('button', { name: 'Salir sin guardar' }),
    )
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        `/coleccion/${ID}`,
      ),
    )
    // La ficha lee otra vez (discardUploads no lee: no hay nada que borrar).
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3))
  })
})
