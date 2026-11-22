import { UserButton } from '@clerk/react'
import { Link, useNavigate } from 'react-router'
import { Button } from '../components/ui/Button.tsx'
import { PATHS } from '../routes/paths.ts'
import { AuthLoading, AuthNotice } from './AuthStatus.tsx'
import { markSignedOut } from './offline-identity.ts'
import { useAppIdentity } from './useAppIdentity.ts'
import { useAuthAvailability } from './useAuthAvailability.ts'

// Controles de cuenta de la cabecera. Con sesión: el botón de usuario de Clerk
// (avatar con el menú para administrar la cuenta) y un botón para salir. Sin
// sesión: enlaces a las pantallas de acceso. Si Clerk no carga, un aviso breve;
// la app pública se sigue viendo igual. Si además se está viendo la copia del
// último usuario (sin conexión, #18), también el botón para salir.
export function AccountControls() {
  const availability = useAuthAvailability()
  const identity = useAppIdentity()

  switch (identity.kind) {
    case 'loading':
      return <AuthLoading />
    case 'unavailable':
      return <AuthNotice reason={identity.reason} />
    case 'unverified':
      return (
        <div className="flex flex-wrap items-center gap-space-3">
          <AuthNotice reason={identity.reason} />
          <SignOutHere userId={identity.userId} />
        </div>
      )
    case 'signed-in':
      return (
        <div className="flex items-center gap-space-3">
          <UserButton />
          <SignOutHere userId={identity.userId} />
        </div>
      )
    case 'signed-out':
      // Cerró sesión aquí sin conexión y Clerk aún no lo sabe.
      if (availability === 'offline' || availability === 'failed') {
        return <AuthNotice reason={availability} />
      }
      return (
        <div className="flex flex-wrap items-center gap-space-2">
          <Link to={PATHS.signIn} className="orki-btn orki-btn--secondary">
            Iniciar sesión
          </Link>
          <Link to={PATHS.signUp} className="orki-btn orki-btn--primary">
            Crear cuenta
          </Link>
        </div>
      )
  }
}

/**
 * Cerrar sesión, también sin conexión (#18, #120). Al pulsarlo, la app deja
 * de tratar a este usuario como con sesión (markSignedOut): CollectionProvider
 * borra su copia local y sus miniaturas al momento. A Clerk se lo pide
 * PendingSignOut: enseguida si está disponible y hay conexión, o en cuanto lo
 * esté.
 */
function SignOutHere({ userId }: { userId: string }) {
  const navigate = useNavigate()

  const signOut = () => {
    void navigate(PATHS.home)
    markSignedOut(userId)
  }

  return <Button onClick={signOut}>Cerrar sesión</Button>
}
