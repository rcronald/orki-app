import { Show, SignOutButton, UserButton } from '@clerk/react'
import { Button } from '../components/ui/Button.tsx'
import { AuthLoading, AuthNotice } from './AuthStatus.tsx'
import { SIGN_IN_PATH, SIGN_UP_PATH } from './paths.ts'
import { useAuthAvailability } from './useAuthAvailability.ts'

// Controles de cuenta de la cabecera. Con sesión: el botón de usuario de Clerk
// (avatar con el menú para administrar la cuenta) y un botón para salir. Sin
// sesión: enlaces a las pantallas de acceso. Si Clerk no carga, un aviso breve;
// la app pública se sigue viendo igual.
export function AccountControls() {
  const availability = useAuthAvailability()

  if (availability === 'loading') return <AuthLoading />
  if (availability !== 'ready') return <AuthNotice reason={availability} />

  return (
    <>
      <Show when="signed-in">
        <div className="flex items-center gap-space-3">
          <UserButton />
          <SignOutButton>
            <Button>Cerrar sesión</Button>
          </SignOutButton>
        </div>
      </Show>
      <Show when="signed-out">
        <div className="flex flex-wrap items-center gap-space-2">
          <a href={SIGN_IN_PATH} className="orki-btn orki-btn--secondary">
            Iniciar sesión
          </a>
          <a href={SIGN_UP_PATH} className="orki-btn orki-btn--primary">
            Crear cuenta
          </a>
        </div>
      </Show>
    </>
  )
}
