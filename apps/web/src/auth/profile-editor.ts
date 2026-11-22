import { useClerk } from '@clerk/react'
import { useCallback } from 'react'
import { useOnlineStatus } from '../lib/useOnlineStatus.ts'
import { useAppIdentity } from './useAppIdentity.ts'

/**
 * Props del editor de perfil de Clerk (openUserProfile). La apariencia del
 * design system (appearance.ts) llega ya desde <ClerkProvider>; aquí solo se
 * añade una cosa.
 *
 * El perfil de Clerk trae su propio «Eliminar cuenta» en la sección de
 * peligro (elemento profileSection__danger, id "danger" en los tipos de
 * @clerk/shared, dist/types/elementIds.d.ts) en cuanto se activa el ajuste del
 * #109. Ese botón borraría solo el usuario de Clerk y dejaría las plantas, las
 * fotos y el perfil sin dueño, porque sin la cuenta ya no hay token para
 * borrarlos. Se oculta: la cuenta se elimina desde /cuenta, que borra antes
 * los datos (#110). Va aquí y no en appearance.ts porque ese archivo solo
 * admite variables de tokens.css.
 */
export const PROFILE_EDITOR_PROPS = {
  appearance: { elements: { profileSection__danger: { display: 'none' } } },
}

export interface ProfileEditor {
  /**
   * Si se puede abrir ahora: con la sesión confirmada por Clerk, Clerk
   * cargado y conexión. Si no, el botón va deshabilitado con su motivo.
   */
  available: boolean
  /** Abre el editor de perfil de Clerk (modal). Sin `available`, no hace nada. */
  open: () => void
}

/**
 * Punto de entrada al editor de perfil de Clerk (#207, para «Editar perfil»
 * de «Tu cuenta», #214): sustituye a «Administrar cuenta» del menú de Clerk.
 * Al cerrarlo, useUser() ya trae el nombre y la foto nuevos, sin recargar.
 */
export function useProfileEditor(): ProfileEditor {
  const clerk = useClerk()
  const identity = useAppIdentity()
  const online = useOnlineStatus()
  const available =
    identity.kind === 'signed-in' &&
    online &&
    (clerk.status === 'ready' || clerk.status === 'degraded')

  const open = useCallback(() => {
    if (available) clerk.openUserProfile(PROFILE_EDITOR_PROPS)
  }, [available, clerk])

  return { available, open }
}
