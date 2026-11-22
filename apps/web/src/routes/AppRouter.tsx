import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react'
import { Route, Routes } from 'react-router'
import type { AppEnv } from '../config/env.ts'
import { NavigationFocusProvider } from './NavigationFocusProvider.tsx'
import { PATHS } from './paths.ts'

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

// La app con Clerk va en un chunk aparte: el inicial (React, el enrutador, la
// configuración) pinta antes y Clerk con su localización llega después. El
// service worker precachea todos los chunks, así que sin conexión también
// carga, desde la caché.
//
// No va con lazy() y Suspense (#204): React deja al menos 300 ms entre que
// muestra el fallback de un Suspense y que lo sustituye por su contenido
// (FALLBACK_THROTTLE_MS de react-dom), así que la primera pantalla tardaba
// 300 ms más de lo que tarda en llegar el chunk. Aquí el chunk se pide al
// montar y la app se pinta en cuanto llega, con una actualización normal.
// Si no llega, el error sale en el render, como con lazy(), y lo recoge el
// ErrorBoundary de main.tsx.
type AppComponent = ComponentType<AppRouterProps>

let loadedApp: AppComponent | null = null
let appPromise: Promise<AppComponent> | null = null

function loadApp(): Promise<AppComponent> {
  appPromise ??= import('../App.tsx').then((module) => {
    loadedApp = module.default
    return module.default
  })
  return appPromise
}

/** true cuando el chunk de la app ya llegó (loadedApp tiene el componente). */
function useAppLoaded(): boolean {
  const [loaded, setLoaded] = useState(() => loadedApp !== null)
  const [, setError] = useState<unknown>(null)
  useEffect(() => {
    if (loaded) return
    let current = true
    loadApp().then(
      () => {
        if (current) setLoaded(true)
      },
      (error: unknown) => {
        if (current) {
          setError(() => {
            throw error
          })
        }
      },
    )
    return () => {
      current = false
    }
  }, [loaded])
  return loaded
}

// La app del chunk ya cargado. El componente es siempre el mismo (el export
// del módulo), así que React no lo vuelve a montar entre renders.
function AppFromChunk(props: AppRouterProps) {
  const App = loadedApp
  return App === null ? null : <App {...props} />
}

// La app, cuando llega su chunk.
function LoadedApp(props: AppRouterProps) {
  const loaded = useAppLoaded()
  return loaded ? <AppFromChunk {...props} /> : null
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
      <Routes>
        {ShowcasePage && appEnv !== 'prod' && (
          <Route
            path={PATHS.showcase}
            element={
              <Suspense fallback={null}>
                <ShowcasePage />
              </Suspense>
            }
          />
        )}
        <Route
          path="*"
          element={
            <LoadedApp
              appEnv={appEnv}
              clerkPublishableKey={clerkPublishableKey}
            />
          }
        />
      </Routes>
    </NavigationFocusProvider>
  )
}
