import { useAuth } from '@clerk/react'

/**
 * Claim del token de sesión de Clerk con el rol de la app. No es `role`: ese
 * nombre lo reserva Supabase para elegir el rol de Postgres y debe valer
 * `authenticated`. Se configura en el panel de Clerk (Sessions > Customize
 * session token) con `{ "app_role": "{{user.public_metadata.role}}" }`.
 */
export const APP_ROLE_CLAIM = 'app_role'

/**
 * Valor del rol de administrador del catálogo, en `public_metadata.role` del
 * usuario en Clerk y, por tanto, en el claim `app_role`. Es el mismo valor que
 * asigna a mano quien administra Clerk (#55) y que comprueban las políticas
 * RLS de la base de datos (#6). Si cambia, cambia en los tres sitios.
 */
export const CATALOG_ADMIN_ROLE = 'catalog_admin'

/** Si los claims del token de sesión traen el rol de administrador. */
export function hasCatalogAdminRole(
  claims: Record<string, unknown> | null | undefined,
): boolean {
  return claims?.[APP_ROLE_CLAIM] === CATALOG_ADMIN_ROLE
}

/**
 * Si la persona con sesión administra el catálogo, leído de los claims del
 * token de sesión que ya tiene Clerk (sin peticiones extra). Sin sesión o con
 * Clerk cargando, false.
 *
 * Es solo comodidad de la interfaz (ocultar el enlace y la pantalla): el token
 * está en el navegador y la interfaz se puede manipular. La protección real
 * son las políticas RLS de la base de datos (#6), que leen el mismo claim del
 * token verificado por Supabase.
 */
export function useIsCatalogAdmin(): boolean {
  const { isLoaded, isSignedIn, sessionClaims } = useAuth()
  return Boolean(isLoaded && isSignedIn && hasCatalogAdminRole(sessionClaims))
}
