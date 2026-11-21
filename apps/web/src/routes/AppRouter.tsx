import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router'
import type { AppEnv } from '../config/env.ts'
import { NavigationFocusProvider } from './NavigationFocusProvider.tsx'
import { PATHS } from './paths.ts'

// La app con Clerk va en un chunk aparte: el inicial (React, el enrutador, la
// configuración) pinta antes y Clerk con su localización llega después. El
// service worker precachea todos los chunks, así que sin conexión también
// carga, desde la caché.
const App = lazy(() => import('../App.tsx'))

// Página interna de muestra del design system (/muestra), solo fuera de
// producción. La comparación con import.meta.env.VITE_APP_ENV es estática: en
// un build con VITE_APP_ENV=prod Vite la sustituye por false, el import
// dinámico desaparece y el código de la muestra no entra en el bundle. Además,
// la ruta solo se registra si el ambiente ya validado no es prod; si no, cae
// en "no encontrado".
const ShowcasePage =
  import.meta.env.VITE_APP_ENV === 'prod'
    ? null
    : lazy(() => import('../showcase/ShowcasePage.tsx'))

interface AppRouterProps {
  appEnv: AppEnv
  clerkPublishableKey: string
}

// Primer nivel de rutas; va dentro de un enrutador (BrowserRouter en main.tsx,
// MemoryRouter en las pruebas). Todo lo que no es la muestra pasa a App, que
// tiene el mapa de rutas de la app.
//
// La muestra queda fuera de Clerk a propósito: no necesita sesión, así no
// descarga el script de Clerk ni depende de que cargue, y sirve para revisar
// el design system aunque Clerk falle o no haya conexión.
export function AppRouter({ appEnv, clerkPublishableKey }: AppRouterProps) {
  return (
    <NavigationFocusProvider>
      <Suspense fallback={null}>
        <Routes>
          {ShowcasePage && appEnv !== 'prod' && (
            <Route path={PATHS.showcase} element={<ShowcasePage />} />
          )}
          <Route
            path="*"
            element={
              <App appEnv={appEnv} clerkPublishableKey={clerkPublishableKey} />
            }
          />
        </Routes>
      </Suspense>
    </NavigationFocusProvider>
  )
}
