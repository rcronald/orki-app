import { ClerkProvider } from '@clerk/react'
import { esMX } from '@clerk/localizations/es-MX'
import type { ReactNode } from 'react'
import { clerkAppearance } from './appearance.ts'
import { SIGN_IN_PATH, SIGN_UP_PATH } from './paths.ts'

interface AuthProviderProps {
  /** Clave publicable de Clerk ya validada por parseEnv. */
  publishableKey: string
  children: ReactNode
}

// Proveedor de Clerk de la app: clave del ambiente, textos en español y
// apariencia del design system. Se usa la localización es-MX porque es la de
// vocabulario latinoamericano ("Agregar", "Ingresa"); las cadenas que Clerk aún
// no ha traducido salen en inglés.
//
// ClerkProvider no bloquea el renderizado: sus hijos se pintan enseguida y
// Clerk carga en segundo plano su script desde su CDN. Mientras tanto, y si no
// llega a cargar (sin conexión), la app pública se sigue viendo; ver
// useAuthAvailability.ts.
export function AuthProvider({ publishableKey, children }: AuthProviderProps) {
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      localization={esMX}
      appearance={clerkAppearance}
      signInUrl={SIGN_IN_PATH}
      signUpUrl={SIGN_UP_PATH}
      afterSignOutUrl="/"
    >
      {children}
    </ClerkProvider>
  )
}
