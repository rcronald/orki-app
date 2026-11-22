import { Navigate, Outlet, useLocation } from 'react-router'
import { NoAccessPage } from '../pages/NoAccessPage.tsx'
import { PATHS, signInPathFor } from '../routes/paths.ts'
import { AuthLoading, AuthUnavailable } from './AuthStatus.tsx'
import { useIsCatalogAdmin } from './roles.ts'
import { useOfflineIdentity } from './offline-identity.ts'
import { useAppIdentity } from './useAppIdentity.ts'

/**
 * Rutas que exigen sesión. Sin sesión, redirige al inicio de sesión con la
 * página pedida en `redirect_url` para volver a ella al entrar. Mientras Clerk
 * carga, estado de carga; si no está disponible (sin conexión o fallo), el
 * aviso con la opción de reintentar, en vez de redirigir a una pantalla de
 * acceso que tampoco funcionaría o de quedarse en blanco.
 *
 * Sin Clerk pero con un usuario recordado en este dispositivo (#18, #120),
 * deja pasar: las pantallas muestran su copia local en solo lectura.
 */
export function RequireAuth() {
  const identity = useAppIdentity()
  const { pendingSignOut } = useOfflineIdentity()
  const location = useLocation()

  switch (identity.kind) {
    // También cuando Clerk actualiza la sesión (isLoaded vuelve un momento a
    // false): no es motivo para echar a nadie.
    case 'loading':
      return <AuthLoading />
    case 'unavailable':
      return <AuthUnavailable reason={identity.reason} />
    case 'signed-out': {
      // Acaba de cerrar sesión aquí (quizá sin conexión): al inicio, no a
      // volver a entrar.
      if (pendingSignOut !== null) return <Navigate to={PATHS.home} replace />
      const requested = `${location.pathname}${location.search}${location.hash}`
      return <Navigate to={signInPathFor(requested)} replace />
    }
    case 'signed-in':
    case 'unverified':
      return <Outlet />
  }
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
