import { useAuth } from '@clerk/react'
import { ClerkOfflineError } from '@clerk/react/errors'
import { useEffect } from 'react'
import {
  SessionTokenError,
  setSessionTokenSource,
  type SessionTokenSource,
} from '../lib/supabase.ts'

/**
 * Conecta la sesión de Clerk con el cliente de Supabase (ver lib/supabase.ts).
 * No pinta nada. Va dentro de <ClerkProvider>, antes del resto de la app, así
 * que su efecto corre antes que los de las páginas.
 *
 * - Clerk cargado y con sesión: registra una fuente que pide el token con
 *   getToken() de useAuth(). Clerk lo guarda en caché y lo renueva solo.
 * - Sin sesión, Clerk sin cargar o al desmontarse: quita la fuente y las
 *   peticiones vuelven a ir como anon. Al cerrar sesión, useAuth() cambia y la
 *   fuente desaparece, así que la petición siguiente ya no lleva el token.
 *
 * Fallos de getToken() (Core 3): sin conexión lanza ClerkOfflineError, que
 * aquí pasa a SessionTokenError('offline'); cualquier otro error, a 'failed';
 * y si devuelve null (la sesión caducó o se cerró en otra pestaña y Clerk aún
 * no lo ha propagado a la interfaz), lib/supabase.ts lo trata como
 * 'session-ended'.
 * https://clerk.com/docs/react/reference/hooks/use-auth
 * https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3
 */
export function SupabaseSessionBridge() {
  const { isLoaded, isSignedIn, getToken } = useAuth()

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return setSessionTokenSource(null)
    const source: SessionTokenSource = async () => {
      try {
        return await getToken()
      } catch (error) {
        if (ClerkOfflineError.is(error)) {
          throw new SessionTokenError('offline', { cause: error })
        }
        throw new SessionTokenError('failed', { cause: error })
      }
    }
    return setSessionTokenSource(source)
  }, [isLoaded, isSignedIn, getToken])

  return null
}
