import { useSearchParams } from 'react-router'
import { PATHS, REDIRECT_PARAM, safeRedirectPath } from '../routes/paths.ts'

/**
 * Página a la que volver tras entrar o crear la cuenta, leída de
 * `redirect_url` (la pone RequireAuth). Se pasa a Clerk como forceRedirectUrl,
 * que tiene prioridad sobre el `redirect_url` de la dirección, así que manda la
 * ruta ya validada:
 * - sin `redirect_url`: undefined, y Clerk usa su destino por defecto (/);
 * - con una ruta interna: esa ruta;
 * - con un destino externo o mal formado: el inicio, nunca el destino.
 *
 * Clerk además valida por su cuenta los destinos contra
 * allowedRedirectOrigins (por defecto, el origen de la app y el dominio de la
 * instancia).
 */
export function useAuthRedirectDestination(): string | undefined {
  const [searchParams] = useSearchParams()
  const requested = searchParams.get(REDIRECT_PARAM)
  if (requested === null) return undefined
  return safeRedirectPath(requested) ?? PATHS.home
}
