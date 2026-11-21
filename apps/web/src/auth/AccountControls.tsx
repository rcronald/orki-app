import { Show, SignOutButton, UserButton } from '@clerk/react'
import { Link } from 'react-router'
import { Button } from '../components/ui/Button.tsx'
import { PATHS } from '../routes/paths.ts'
import { AuthLoading, AuthNotice } from './AuthStatus.tsx'
import { useAuthAvailability } from './useAuthAvailability.ts'

// Controles de cuenta de la cabecera. Con sesión: el botón de usuario de Clerk
// (avatar con el menú para administrar la cuenta), el enlace a la pantalla de
// cuenta de Orki (/cuenta, donde se elimina la cuenta) y un botón para salir. Sin
// sesión: enlaces a las pantallas de acceso. Si Clerk no carga, un aviso breve;
// la app pública se sigue viendo igual.
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

  if (availability === 'loading') return <AuthLoading />
  if (availability !== 'ready') return <AuthNotice reason={availability} />

  return (
    <>
      <Show when="signed-in">
        <div className="flex items-center gap-space-3">
          <UserButton userProfileProps={USER_PROFILE_PROPS} />
          <Link to={PATHS.account} className="orki-btn orki-btn--secondary">
            Tu cuenta
          </Link>
          <SignOutButton>
            <Button>Cerrar sesión</Button>
          </SignOutButton>
        </div>
      </Show>
      <Show when="signed-out">
        <div className="flex flex-wrap items-center gap-space-2">
          <Link to={PATHS.signIn} className="orki-btn orki-btn--secondary">
            Iniciar sesión
          </Link>
          <Link to={PATHS.signUp} className="orki-btn orki-btn--primary">
            Crear cuenta
          </Link>
        </div>
      </Show>
    </>
  )
}
