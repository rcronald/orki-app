import { Route, Routes } from 'react-router'
import { AuthProvider } from './auth/AuthProvider.tsx'
import { RequireAuth, RequireCatalogAdmin } from './auth/RouteGuards.tsx'
import { AppShell } from './components/AppShell.tsx'
import { CatalogAdminPage } from './pages/CatalogAdminPage.tsx'
import { CatalogPage } from './pages/CatalogPage.tsx'
import { CollectionPage } from './pages/CollectionPage.tsx'
import { HomePage } from './pages/HomePage.tsx'
import { NewPlantPage } from './pages/NewPlantPage.tsx'
import { NotFoundPage } from './pages/NotFoundPage.tsx'
import { SignInPage } from './pages/SignInPage.tsx'
import { SignUpPage } from './pages/SignUpPage.tsx'
import { PATHS } from './routes/paths.ts'

interface AppProps {
  /** Clave publicable de Clerk ya validada por parseEnv. */
  clerkPublishableKey: string
}

// La app con Clerk: mapa de rutas de la Fase 1. AppRouter carga este módulo de
// forma diferida, así Clerk y su localización van en un chunk aparte del
// inicial (ver AppRouter.tsx). Las páginas son pequeñas y van aquí mismo: un
// chunk por página añadiría peticiones sin ahorrar nada.
//
// Las rutas de acceso terminan en /* porque Clerk (routing="path") monta sus
// pasos como subrutas: /iniciar-sesion/factor-one, /iniciar-sesion/sso-callback.
function App({ clerkPublishableKey }: AppProps) {
  return (
    <AuthProvider publishableKey={clerkPublishableKey}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path={PATHS.catalog} element={<CatalogPage />} />
          <Route element={<RequireAuth />}>
            <Route path={PATHS.collection} element={<CollectionPage />} />
            <Route path={PATHS.newPlant} element={<NewPlantPage />} />
            <Route element={<RequireCatalogAdmin />}>
              <Route path={PATHS.catalogAdmin} element={<CatalogAdminPage />} />
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
