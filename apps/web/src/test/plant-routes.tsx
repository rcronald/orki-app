/* eslint-disable react-refresh/only-export-components -- ayudas solo para pruebas */
import { act, render } from '@testing-library/react'
import { Suspense, type ReactNode } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { vi } from 'vitest'
import { CollectionProvider } from '../collection/CollectionProvider.tsx'
import type { CollectionPlant } from '../collection/model.ts'
import { CollectionPage } from '../pages/CollectionPage.tsx'
import PlantDetailPage from '../pages/PlantDetailPage.tsx'
import type { PlantImageSource } from '../photos/read.ts'
import { PlantImagesContext } from '../photos/usePlantImage.ts'
import { NavigationFocusProvider } from '../routes/NavigationFocusProvider.tsx'
import { PATHS } from '../routes/paths.ts'
import {
  fakeCollectionSource,
  type FakeCollectionSource,
} from './collection-source.ts'

// Las pantallas de una planta (#16) con el inventario, como en App.tsx: la
// colección con una fuente controlada y las fotos con una fuente de prueba
// que devuelve "blob:<ruta>". La ruta actual (con su búsqueda) queda en
// data-testid="location".

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
}

export async function renderPlantRoutes({
  entries,
  plants = [],
  source = fakeCollectionSource(),
  images = fakeImageSource().source,
  extraRoutes,
}: PlantRoutesOptions) {
  const view = render(
    <MemoryRouter initialEntries={entries}>
      <NavigationFocusProvider>
        <CollectionProvider source={source}>
          <PlantImagesContext value={images}>
            <main>
              <Suspense fallback={null}>
                <Routes>
                  <Route path={PATHS.collection} element={<CollectionPage />} />
                  <Route
                    path={PATHS.plantDetail}
                    element={<PlantDetailPage />}
                  />
                  {extraRoutes}
                </Routes>
              </Suspense>
            </main>
            <LocationProbe />
          </PlantImagesContext>
        </CollectionProvider>
      </NavigationFocusProvider>
    </MemoryRouter>,
  )
  await act(async () => {
    if (plants !== null) source.last().resolve(plants)
    await Promise.resolve()
  })
  return { ...view, source }
}
