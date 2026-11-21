import { UserButton } from '@clerk/react'
import { Link, useNavigate } from 'react-router'
import { Button } from '../components/ui/Button.tsx'
import { PATHS } from '../routes/paths.ts'
import { AuthLoading, AuthNotice } from './AuthStatus.tsx'
import { markSignedOut } from './offline-identity.ts'
import { useAppIdentity } from './useAppIdentity.ts'
import { useAuthAvailability } from './useAuthAvailability.ts'

// Controles de cuenta de la cabecera. Con sesión: el botón de usuario de Clerk
// (avatar con el menú para administrar la cuenta), el enlace a la pantalla de
// cuenta de Orki (/cuenta, donde se elimina la cuenta) y un botón para salir. Sin
// sesión: enlaces a las pantallas de acceso. Si Clerk no carga, un aviso breve;
// la app pública se sigue viendo igual. Si además se está viendo la copia del
// último usuario (sin conexión, #18), también el botón para salir (sin el
// enlace a /cuenta: eliminar la cuenta necesita la sesión confirmada).
// El perfil de Clerk (menú del avatar > Administrar cuenta) trae su propio
// "Eliminar cuenta" en la sección de peligro (elemento profileSection__danger,
// id "danger" en los tipos de @clerk/shared, dist/types/elementIds.d.ts) en
// cuanto se activa el ajuste del #109. Ese botón borraría solo el usuario de
// Clerk y dejaría las plantas, las fotos y el perfil sin dueño, porque sin la
// cuenta ya no hay token para borrarlos. Se oculta: la cuenta se elimina desde
// /cuenta, que borra antes los datos (#110). Va aquí y no en appearance.ts
// porque ese archivo solo admite variables de tokens.css.
const USER_PROFILE_PROPS = {
  appearance: { elements: { profileSection__danger: { display: 'none' } } },
}

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
          <UserButton userProfileProps={USER_PROFILE_PROPS} />
          <Link to={PATHS.account} className="orki-btn orki-btn--secondary">
            Tu cuenta
          </Link>
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
