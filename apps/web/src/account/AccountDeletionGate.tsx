import { useAuth } from '@clerk/react'
import { useEffect } from 'react'
import { Navigate, Outlet } from 'react-router'
import { PATHS } from '../routes/paths.ts'
import {
  setAccountDeletionPhase,
  useAccountDeletionPhase,
  type AccountDeletedState,
} from './deletion-status.ts'

/**
 * Ruta de diseño por encima de RequireAuth en /cuenta (ver deletion-status.ts).
 * Con la cuenta eliminada y sin sesión, va al inicio con el aviso; mientras se
 * elimina la cuenta de Clerk y la sesión ya cayó, dice que está terminando en
 * lugar de mandar al inicio de sesión.
 */
export function AccountDeletionGate() {
  const phase = useAccountDeletionPhase()
  const { isLoaded, isSignedIn } = useAuth()
  const signedIn = isLoaded && isSignedIn === true

  // Alguien volvió a entrar (otra cuenta) tras una eliminación: la fase ya no
  // vale.
  useEffect(() => {
    if (phase === 'done' && signedIn) setAccountDeletionPhase('idle')
  }, [phase, signedIn])

  if (phase === 'done' && !signedIn) {
    const state: AccountDeletedState = { accountDeleted: true }
    return <Navigate to={PATHS.home} replace state={state} />
  }
  if (phase === 'finishing' && !signedIn) {
    return (
      <p role="status" className="text-md text-neutral-700">
        Terminando de eliminar tu cuenta…
      </p>
    )
  }
  return <Outlet />
}
