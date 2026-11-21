import { useAuth } from '@clerk/react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { NoAccessPage } from '../pages/NoAccessPage.tsx'
import { signInPathFor } from '../routes/paths.ts'
import { AuthLoading, AuthUnavailable } from './AuthStatus.tsx'
import { useIsCatalogAdmin } from './roles.ts'
import { useAuthAvailability } from './useAuthAvailability.ts'

/**
 * Rutas que exigen sesión. Sin sesión, redirige al inicio de sesión con la
 * página pedida en `redirect_url` para volver a ella al entrar. Mientras Clerk
 * carga, estado de carga; si no está disponible (sin conexión o fallo), el
 * aviso con la opción de reintentar, en vez de redirigir a una pantalla de
 * acceso que tampoco funcionaría o de quedarse en blanco.
 */
export function RequireAuth() {
  const availability = useAuthAvailability()
  const { isLoaded, isSignedIn } = useAuth()
  const location = useLocation()

  if (availability === 'loading') return <AuthLoading />
  if (availability !== 'ready') return <AuthUnavailable reason={availability} />
  // isLoaded puede volver a false un momento mientras Clerk actualiza la
  // sesión; no es motivo para echar a nadie.
  if (!isLoaded) return <AuthLoading />
  if (!isSignedIn) {
    const requested = `${location.pathname}${location.search}${location.hash}`
    return <Navigate to={signInPathFor(requested)} replace />
  }
  return <Outlet />
}

/**
 * Rutas solo para administradores del catálogo. Va dentro de RequireAuth, así
 * que aquí ya hay sesión. Sin el rol, la pantalla de "no tienes acceso" (no un
 * 404 ni una redirección, que confundirían o harían un bucle).
 *
 * Es comodidad de la interfaz: la protección real es la de la base de datos,
 * con políticas RLS que comprueban el mismo claim (#6).
 */
export function RequireCatalogAdmin() {
  const isAdmin = useIsCatalogAdmin()
  return isAdmin ? <Outlet /> : <NoAccessPage />
}
