import { ClerkProvider } from '@clerk/react'
import { esMX } from '@clerk/localizations/es-MX'
import { useCallback, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { internalPathOf, PATHS } from '../routes/paths.ts'
import { clerkAppearance } from './appearance.ts'
import { ProfileBootstrap } from './ProfileBootstrap.tsx'
import { SupabaseSessionBridge } from './SupabaseSessionBridge.tsx'

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
//
// Va dentro del enrutador: routerPush y routerReplace hacen que Clerk navegue
// con React Router (pasos de <SignIn>/<SignUp>, vuelta tras entrar, salida)
// sin recargar la página. Un destino de otro origen se abre con una carga
// normal.
// https://clerk.com/docs/react/guides/development/declarative-mode
//
// SupabaseSessionBridge pasa el token de sesión al cliente de Supabase; va
// antes de los hijos para que su efecto corra antes que los de las páginas.
// ProfileBootstrap va justo después: crea el perfil en el primer ingreso, ya
// con la fuente del token registrada.
export function AuthProvider({ publishableKey, children }: AuthProviderProps) {
  const navigate = useNavigate()
  const routerPush = useCallback(
    (to: string) => navigateTo(navigate, to, false),
    [navigate],
  )
  const routerReplace = useCallback(
    (to: string) => navigateTo(navigate, to, true),
    [navigate],
  )

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      localization={esMX}
      appearance={clerkAppearance}
      signInUrl={PATHS.signIn}
      signUpUrl={PATHS.signUp}
      afterSignOutUrl={PATHS.home}
      routerPush={routerPush}
      routerReplace={routerReplace}
    >
      <SupabaseSessionBridge />
      <ProfileBootstrap />
      {children}
    </ClerkProvider>
  )
}

function navigateTo(
  navigate: ReturnType<typeof useNavigate>,
  to: string,
  replace: boolean,
) {
  const path = internalPathOf(to)
  if (path === null) {
    if (replace) window.location.replace(to)
    else window.location.assign(to)
    return
  }
  return navigate(path, { replace })
}
