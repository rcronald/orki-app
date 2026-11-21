import { SignUp } from '@clerk/react'
import { AuthGate } from '../auth/AuthGate.tsx'
import { AuthLoading } from '../auth/AuthStatus.tsx'
import { SignedOutOnly } from '../auth/SignedOutOnly.tsx'
import { PATHS } from '../routes/paths.ts'
import { AuthPageLayout } from './AuthPageLayout.tsx'
import { useAuthRedirectDestination } from '../auth/useAuthRedirectDestination.ts'

// Registro de cuenta con el componente de Clerk. Como en SignInPage, los pasos
// internos son subrutas de /registro y la vuelta sale de redirect_url.
export function SignUpPage() {
  const destination = useAuthRedirectDestination()
  return (
    <AuthPageLayout title="Crear cuenta">
      <AuthGate>
        <SignedOutOnly destination={destination}>
          <SignUp
            routing="path"
            path={PATHS.signUp}
            forceRedirectUrl={destination}
            signInForceRedirectUrl={destination}
            fallback={<AuthLoading />}
          />
        </SignedOutOnly>
      </AuthGate>
    </AuthPageLayout>
  )
}
