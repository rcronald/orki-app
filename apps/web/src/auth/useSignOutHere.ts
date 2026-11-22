import { useCallback } from 'react'
import { useNavigate } from 'react-router'
import { PATHS } from '../routes/paths.ts'
import { markSignedOut } from './offline-identity.ts'
import { identityUserId, useAppIdentity } from './useAppIdentity.ts'

/**
 * Cerrar sesión con el cierre propio de la app, también sin conexión (#18,
 * #120; ver docs/sin-conexion.md). Va al inicio y la app deja de tratar a
 * este usuario como con sesión (markSignedOut): CollectionProvider borra su
 * copia local y sus miniaturas al momento. A Clerk se lo pide
 * PendingSignOut: enseguida si está disponible y hay conexión, o en cuanto
 * lo esté. Lo usan el menú «Tu cuenta» (#207) y la pantalla de cuenta (#214).
 */
export function useSignOutHere(): () => void {
  const navigate = useNavigate()
  const userId = identityUserId(useAppIdentity())

  return useCallback(() => {
    void navigate(PATHS.home)
    markSignedOut(userId)
  }, [navigate, userId])
}
