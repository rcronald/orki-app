import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router'
import { AccountDeletionGate } from './account/AccountDeletionGate.tsx'
import { AuthProvider } from './auth/AuthProvider.tsx'
import { AccountPage } from './pages/AccountPage.tsx'
import { RequireAuth, RequireCatalogAdmin } from './auth/RouteGuards.tsx'
import { AppShell } from './components/AppShell.tsx'
import { CatalogPage } from './pages/CatalogPage.tsx'
import { CollectionPage } from './pages/CollectionPage.tsx'
import { HomePage } from './pages/HomePage.tsx'
import { NotFoundPage } from './pages/NotFoundPage.tsx'
import { SignInPage } from './pages/SignInPage.tsx'
import { SignUpPage } from './pages/SignUpPage.tsx'
import type { AppEnv } from './config/env.ts'
import { PATHS } from './routes/paths.ts'

// Panel de diagnóstico de la identidad (/diagnostico), solo fuera de
// producción. Misma técnica que la muestra (ver routes/AppRouter.tsx): con
// VITE_APP_ENV=prod la comparación es estática, Vite la sustituye por false y
// el import dinámico desaparece del build; además, la ruta solo se registra si
// el ambiente ya validado no es prod. Va dentro de Clerk porque muestra el
// usuario según Clerk, pero no exige sesión.
const IdentityDiagnosticsPage =
  import.meta.env.VITE_APP_ENV === 'prod'
    ? null
    : lazy(() => import('./diagnostics/IdentityDiagnosticsPage.tsx'))

// Registro de una planta (#85): el formulario y su lógica van en un chunk
// propio que se descarga al abrir /coleccion/nueva, así no engordan el de la
// app ni el inicial. El service worker lo precachea como los demás.
const NewPlantPage = lazy(() => import('./pages/NewPlantPage.tsx'))

// Detalle de un ejemplar (#16), en su propio chunk como el registro: la
// lista no lo necesita hasta que se toca una tarjeta.
const PlantDetailPage = lazy(() => import('./pages/PlantDetailPage.tsx'))

// Edición de un ejemplar (#16): comparte con el registro el formulario, que
// Vite deja en un chunk común a los dos.
const EditPlantPage = lazy(() => import('./pages/EditPlantPage.tsx'))

// Backoffice del catálogo (/administracion/catalogo, #99): solo para
// administradores, así que va en su propio chunk y no lo descarga nadie más.
const CatalogAdminPage = lazy(() => import('./backoffice/CatalogAdminPage.tsx'))

// La pantalla de cuenta (/cuenta, #110) va en este mismo chunk, sin carga
// diferida: usa Clerk, y una página diferida que importa @clerk/react hace que
// el empaquetador saque Clerk a un chunk compartido, lo que añade entradas de
// precarga al chunk inicial. Probado con el build: diferida, el inicial crecía
// unos 100 bytes; aquí, solo lo que ocupa su ruta en PATHS.

interface AppProps {
  /** Ambiente ya validado por parseEnv. */
  appEnv: AppEnv
  /** Clave publicable de Clerk ya validada por parseEnv. */
  clerkPublishableKey: string
}

// La app con Clerk: mapa de rutas de la Fase 1. AppRouter carga este módulo de
// forma diferida, así Clerk y su localización van en un chunk aparte del
// inicial (ver AppRouter.tsx). Las páginas pequeñas van aquí mismo: un chunk
// por página añadiría peticiones sin ahorrar nada. El registro, más grande,
// va aparte.
//
// Las rutas de acceso terminan en /* porque Clerk (routing="path") monta sus
// pasos como subrutas: /iniciar-sesion/factor-one, /iniciar-sesion/sso-callback.
function App({ appEnv, clerkPublishableKey }: AppProps) {
  return (
    <AuthProvider publishableKey={clerkPublishableKey}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path={PATHS.catalog} element={<CatalogPage />} />
          {IdentityDiagnosticsPage && appEnv !== 'prod' && (
            <Route
              path={PATHS.identityDiagnostics}
              element={
                <Suspense fallback={null}>
                  <IdentityDiagnosticsPage />
                </Suspense>
              }
            />
          )}
          {/* AccountDeletionGate va por encima de RequireAuth: al eliminar la
              cuenta la sesión cae y, en vez del inicio de sesión, se va al
              inicio con el aviso (ver account/deletion-status.ts). */}
          <Route element={<AccountDeletionGate />}>
            <Route element={<RequireAuth />}>
              <Route path={PATHS.account} element={<AccountPage />} />
            </Route>
          </Route>
          <Route element={<RequireAuth />}>
            <Route path={PATHS.collection} element={<CollectionPage />} />
            <Route
              path={PATHS.newPlant}
              element={
                <Suspense fallback={null}>
                  <NewPlantPage />
                </Suspense>
              }
            />
            {/* "nueva" es una ruta fija: gana a :plantId sin importar el orden. */}
            <Route
              path={PATHS.plantDetail}
              element={
                <Suspense fallback={null}>
                  <PlantDetailPage />
                </Suspense>
              }
            />
            <Route
              path={PATHS.editPlant}
              element={
                <Suspense fallback={null}>
                  <EditPlantPage />
                </Suspense>
              }
            />
            <Route element={<RequireCatalogAdmin />}>
              <Route
                path={PATHS.catalogAdmin}
                element={
                  <Suspense
                    fallback={
                      <p role="status" className="text-md text-neutral-700">
                        Cargando el catálogo…
                      </p>
                    }
                  >
                    <CatalogAdminPage />
                  </Suspense>
                }
              />
            </Route>
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route path={`${PATHS.signIn}/*`} element={<SignInPage />} />
        <Route path={`${PATHS.signUp}/*`} element={<SignUpPage />} />
      </Routes>
    </AuthProvider>
  )
}

export default App
