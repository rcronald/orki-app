import { useAuth } from '@clerk/react'
import { useEffect } from 'react'
import { ensureProfile } from '../lib/profile.ts'

/**
 * Crea el perfil del usuario en el primer ingreso (ver lib/profile.ts). No
 * pinta nada ni bloquea la interfaz: la petición sale en segundo plano y la
 * app no espera su resultado.
 *
 * Va dentro de <ClerkProvider>, justo después de SupabaseSessionBridge: su
 * efecto corre después del de este, así que la fuente del token ya está
 * registrada cuando sale la petición.
 *
 * - Con sesión: lo intenta una vez por usuario. El efecto depende solo del id,
 *   así que no se repite al volver a pintar ni al navegar; si cambia el
 *   usuario, se intenta para el nuevo.
 * - Sin sesión o mientras Clerk carga: no hace nada.
 * - Si falla (sin conexión, error de red o del servidor), no se muestra nada.
 *   Se vuelve a intentar cuando el navegador recupera la conexión, en el
 *   siguiente ingreso o al recargar. Si ya salió bien, esos reintentos no
 *   hacen ninguna petición.
 */
export function ProfileBootstrap() {
  const { isLoaded, isSignedIn, userId } = useAuth()
  const activeUserId = isLoaded && isSignedIn && userId ? userId : null

  useEffect(() => {
    if (activeUserId === null) return
    const ensure = () => {
      void ensureProfile(activeUserId)
    }
    ensure()
    window.addEventListener('online', ensure)
    return () => window.removeEventListener('online', ensure)
  }, [activeUserId])

  return null
}
