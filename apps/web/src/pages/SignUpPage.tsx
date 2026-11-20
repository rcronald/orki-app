import { SignUp } from '@clerk/react'
import { AuthGate } from '../auth/AuthGate.tsx'
import { AuthLoading } from '../auth/AuthStatus.tsx'
import { AuthPageLayout } from './AuthPageLayout.tsx'

// Registro con el componente de Clerk. Como en SignInPage, los pasos internos
// van en el hash de la URL hasta que llegue el enrutador (issue #57).
export function SignUpPage() {
  return (
    <AuthPageLayout title="Crear cuenta">
      <AuthGate>
        <SignUp routing="hash" fallback={<AuthLoading />} />
      </AuthGate>
    </AuthPageLayout>
  )
}
