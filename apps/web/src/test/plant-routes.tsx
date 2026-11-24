/* eslint-disable react-refresh/only-export-components -- ayudas solo para pruebas */
import { act, render } from '@testing-library/react'
import { Suspense, type ReactNode } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { vi } from 'vitest'
import { CollectionProvider } from '../collection/CollectionProvider.tsx'
import type { CollectionPlant } from '../collection/model.ts'
import { CollectionPage } from '../pages/CollectionPage.tsx'
import { forgetPlantGalleries } from '../detail/usePlantGallery.ts'
import { createMemoryPlantLogEntries } from '../log/memory-entries.ts'
import {
  PlantLogServicesContext,
  type PlantLogServices,
} from '../log/services.ts'
import PlantDetailPage from '../pages/PlantDetailPage.tsx'
import { createMemoryPhotoStorage } from '../photos/memory-storage.ts'
import {
  createMemoryPlantPhotoRows,
  type MemoryPlantPhotoRows,
} from '../photos/memory-photo-rows.ts'
import type { PlantPhotoRows } from '../photos/photo-rows.ts'
import type { PlantImageSource } from '../photos/read.ts'
import { PlantImagesContext } from '../photos/usePlantImage.ts'
import { PlantPhotoRowsContext } from '../photos/usePlantPhotoRows.ts'
import { NavigationFocusProvider } from '../routes/NavigationFocusProvider.tsx'
import { PATHS } from '../routes/paths.ts'
import {
  fakeCollectionSource,
  type FakeCollectionSource,
} from './collection-source.ts'

// Las pantallas de una planta (#16) con el inventario, como en App.tsx: la
// colección con una fuente controlada y las fotos con una fuente de prueba
// que devuelve "blob:<ruta>". La ruta actual (con su búsqueda) queda en
// data-testid="location". Las fotos de cada planta (plant_photos, #183) salen
// por defecto de un doble en memoria con la principal de cada planta en la
// posición 0, como la copia de la migración.

/**
 * plant_photos en memoria con las plantas dadas: cada una con foto tiene su
 * principal; `extra` añade más fotos por id de planta (con sus rutas).
 */
export function memoryRowsFor(
  plants: readonly CollectionPlant[],
  userId: string,
  extra: Record<
    string,
    {
      photoPath: string
      thumbnailPath: string
      inBloom?: boolean
      takenAt?: string | null
      note?: string | null
    }[]
  > = {},
): MemoryPlantPhotoRows {
  const rows = createMemoryPlantPhotoRows()
  for (const plant of plants) {
    rows.plants.set(plant.id, { ...plant, userId })
    const photos = [
      ...(plant.photoPath !== null && plant.thumbnailPath !== null
        ? [
            {
              photoPath: plant.photoPath,
              thumbnailPath: plant.thumbnailPath,
              inBloom: plant.photoInBloom,
            },
          ]
        : []),
      ...(extra[plant.id] ?? []),
    ]
    photos.forEach((photo, position) => {
      const id = `${plant.id.slice(0, 8)}-foto-${String(position)}`
      rows.rows.set(id, {
        id,
        plantId: plant.id,
        userId,
        photoPath: photo.photoPath,
        thumbnailPath: photo.thumbnailPath,
        inBloom: photo.inBloom ?? false,
        takenAt: photo.takenAt ?? null,
        note: photo.note ?? null,
        position,
        createdAt: '2026-11-22T12:00:00.000Z',
      })
    })
  }
  return rows
}

export function fakeImageSource() {
  const acquire = vi.fn<PlantImageSource['acquire']>((path) =>
    Promise.resolve(`blob:${path}`),
  )
  const release = vi.fn<PlantImageSource['release']>()
  const source: PlantImageSource = { acquire, release, clear: vi.fn() }
  return { source, acquire, release }
}

function LocationProbe() {
  const location = useLocation()
  return (
    <div data-testid="location">{`${location.pathname}${location.search}`}</div>
  )
}

export interface PlantRoutesOptions {
  /** Entradas del historial; la última es la actual. */
  entries: string[]
  /** Colección que llega enseguida; null deja la lectura pendiente. */
  plants?: readonly CollectionPlant[] | null
  source?: FakeCollectionSource
  images?: PlantImageSource
  /** Rutas de más (la edición, #115). */
  extraRoutes?: ReactNode
  /**
   * Filas de plant_photos del detalle; por defecto, memoryRowsFor(plants) de
   * user_prueba. null usa las de la app (Supabase, con fetch simulado).
   */
  photoRows?: PlantPhotoRows | null
  /** Bitácora (#267); por defecto, vacía y en memoria. */
  log?: PlantLogServices
}

/** Bitácora vacía en memoria con las plantas dadas, de `userId`. */
export function memoryLogFor(
  plants: readonly CollectionPlant[],
  userId = 'user_prueba',
): PlantLogServices & {
  entries: ReturnType<typeof createMemoryPlantLogEntries>
  storage: ReturnType<typeof createMemoryPhotoStorage>
} {
  const entries = createMemoryPlantLogEntries({ userId })
  for (const plant of plants) entries.plants.set(plant.id, userId)
  return { entries, storage: createMemoryPhotoStorage() }
}

export async function renderPlantRoutes({
  entries,
  plants = [],
  source = fakeCollectionSource(),
  images = fakeImageSource().source,
  extraRoutes,
  photoRows = memoryRowsFor(plants ?? [], 'user_prueba'),
  log = memoryLogFor(plants ?? []),
}: PlantRoutesOptions) {
  forgetPlantGalleries()
  const view = render(
    <MemoryRouter initialEntries={entries}>
      <NavigationFocusProvider>
        <CollectionProvider source={source}>
          <PlantImagesContext value={images}>
            <PlantPhotoRowsContext value={photoRows}>
              <PlantLogServicesContext value={log}>
                <main>
                  <Suspense fallback={null}>
                    <Routes>
                      <Route
                        path={PATHS.collection}
                        element={<CollectionPage />}
                      />
                      <Route
                        path={PATHS.plantDetail}
                        element={<PlantDetailPage />}
                      />
                      {extraRoutes}
                    </Routes>
                  </Suspense>
                </main>
              </PlantLogServicesContext>
            </PlantPhotoRowsContext>
            <LocationProbe />
          </PlantImagesContext>
        </CollectionProvider>
      </NavigationFocusProvider>
    </MemoryRouter>,
  )
  if (plants !== null) await source.respond(plants)
  else await act(() => Promise.resolve())
  return { ...view, source }
}
