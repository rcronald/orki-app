import { SignIn } from '@clerk/react'
import { AuthGate } from '../auth/AuthGate.tsx'
import { AuthLoading } from '../auth/AuthStatus.tsx'
import { AuthPageLayout } from './AuthPageLayout.tsx'

// Inicio de sesión con el componente de Clerk (correo con código y Google,
// según lo configurado en el panel de Clerk). Sin enrutador, Clerk lleva sus
// pasos internos en el hash de la URL (routing="hash"); con el enrutador del
// issue #57 podrá pasar a routing="path".
export function SignInPage() {
  return (
    <AuthPageLayout title="Iniciar sesión">
      <AuthGate>
        <SignIn routing="hash" fallback={<AuthLoading />} />
      </AuthGate>
    </AuthPageLayout>
  )
}
