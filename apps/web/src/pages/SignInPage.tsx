import { SignIn } from '@clerk/react'
import { AuthGate } from '../auth/AuthGate.tsx'
import { AuthLoading } from '../auth/AuthStatus.tsx'
import { SignedOutOnly } from '../auth/SignedOutOnly.tsx'
import { PATHS } from '../routes/paths.ts'
import { AuthPageLayout } from './AuthPageLayout.tsx'
import { useAuthRedirectDestination } from '../auth/useAuthRedirectDestination.ts'

// Inicio de sesión con el componente de Clerk (correo con código y Google,
// según lo configurado en el panel de Clerk). Clerk lleva sus pasos internos
// como subrutas de /iniciar-sesion (routing="path"; la ruta acepta /*) y
// navega con el enrutador gracias a routerPush/routerReplace de AuthProvider.
export function SignInPage() {
  const destination = useAuthRedirectDestination()
  return (
    <AuthPageLayout title="Iniciar sesión">
      <AuthGate>
        <SignedOutOnly destination={destination}>
          <SignIn
            routing="path"
            path={PATHS.signIn}
            forceRedirectUrl={destination}
            signUpForceRedirectUrl={destination}
            fallback={<AuthLoading />}
          />
        </SignedOutOnly>
      </AuthGate>
    </AuthPageLayout>
  )
}
