import { useClerk } from '@clerk/react'
import { useEffect, useState } from 'react'
import { useOnlineStatus } from '../lib/useOnlineStatus.ts'

/**
 * Estado del acceso para la interfaz:
 * - loading: Clerk todavía está cargando.
 * - ready: Clerk funciona (también si está "degraded", parcialmente operativo).
 * - offline: el navegador no tiene conexión y Clerk no ha cargado.
 * - failed: Clerk no cargó (error o tiempo agotado) aunque hay conexión.
 */
export type AuthAvailability = 'loading' | 'ready' | 'offline' | 'failed'

/**
 * Tiempo máximo que la app espera a Clerk antes de dar el acceso por no
 * disponible. Clerk, por su cuenta, espera 15 s al script antes de pasar a
 * "error"; aquí se corta antes para no dejar a nadie mirando un "cargando".
 * Si Clerk termina cargando después, el estado pasa a ready solo.
 */
export const AUTH_LOAD_TIMEOUT_MS = 10_000

/**
 * Traduce el estado de Clerk (useClerk().status: loading, ready, degraded o
 * error) a lo que la interfaz necesita, con un límite de tiempo para la carga.
 * Sin conexión no espera: navigator.onLine === false es fiable cuando dice que
 * no hay red (lo contrario no lo es, por eso además está el límite de tiempo).
 */
export function useAuthAvailability(
  timeoutMs: number = AUTH_LOAD_TIMEOUT_MS,
): AuthAvailability {
  const { status } = useClerk()
  const [timedOut, setTimedOut] = useState(false)
  const online = useOnlineStatus()

  useEffect(() => {
    if (status !== 'loading') return
    const id = window.setTimeout(() => setTimedOut(true), timeoutMs)
    return () => window.clearTimeout(id)
  }, [status, timeoutMs])

  if (status === 'ready' || status === 'degraded') return 'ready'
  if (!online) return 'offline'
  if (status === 'error' || timedOut) return 'failed'
  return 'loading'
}
