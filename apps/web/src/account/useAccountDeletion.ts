import { useCallback, useContext, useRef, useState } from 'react'
import { CollectionContext } from '../collection/useCollection.ts'
import {
  clearAccountDeletionMarker,
  markAccountDeletionStarted,
} from '../lib/account-deletion-marker.ts'
import {
  deleteAccountAndData,
  stepsBefore,
  type AccountDeletionEffects,
  type DeletionFailureReason,
  type DeletionStep,
} from './deletion.ts'
import { setAccountDeletionPhase } from './deletion-status.ts'
import { clearDeviceDataFor } from './device-cleanup.ts'

export type AccountDeletionState =
  | { status: 'idle' }
  | { status: 'running'; current: DeletionStep; done: DeletionStep[] }
  | {
      status: 'failed'
      step: DeletionStep
      reason: DeletionFailureReason
      done: DeletionStep[]
    }
  | { status: 'done' }

export interface UseAccountDeletionOptions {
  userId: string
  effects: AccountDeletionEffects
  canDeleteAccount: boolean
  /**
   * Se llama con la cuenta ya eliminada y el dispositivo limpio: cierra la
   * sesión y lleva al inicio (AccountPage) o lo que toque en la muestra.
   */
  onDeleted: () => Promise<void> | void
}

export interface AccountDeletionController {
  state: AccountDeletionState
  /** Empieza la eliminación o la reintenta desde el paso que falló. */
  start: () => Promise<void>
  /** Vuelve a idle tras un fallo (cerrar el diálogo). */
  reset: () => void
}

/**
 * Conecta la orquestadora (deletion.ts) con la pantalla: estado para pintar el
 * progreso, sin doble envío, con la marca contra la recreación del perfil y la
 * limpieza del dispositivo.
 *
 * - Antes del primer paso pone la marca de eliminación en curso
 *   (lib/account-deletion-marker.ts): ensureProfile() deja de crear el perfil.
 * - Con los datos ya borrados (tras el perfil), limpia el dispositivo salvo la
 *   marca, y relee la colección si estaba cargada, para que no se vean plantas
 *   que ya no existen si la cuenta de Clerk no se puede eliminar.
 * - Antes del paso de Clerk, fase finishing (deletion-status.ts).
 * - Al terminar: quita la marca, vacía la colección en memoria y llama a
 *   onDeleted.
 */
export function useAccountDeletion({
  userId,
  effects,
  canDeleteAccount,
  onDeleted,
}: UseAccountDeletionOptions): AccountDeletionController {
  const [state, setState] = useState<AccountDeletionState>({ status: 'idle' })
  const collection = useContext(CollectionContext)
  // Evita el doble envío aunque dos pulsaciones lleguen en el mismo pintado.
  const running = useRef(false)
  const lastFailure = useRef<DeletionStep | null>(null)

  const start = useCallback(async () => {
    if (running.current) return
    running.current = true
    const from = lastFailure.current ?? 'photos'
    // Los pasos que ya terminaron en un intento anterior cuentan como hechos.
    const done: DeletionStep[] = stepsBefore(from)
    if (canDeleteAccount) markAccountDeletionStarted(userId)

    const wrapped: AccountDeletionEffects = {
      deletePhotos: (id) => effects.deletePhotos(id),
      deletePlants: (id) => effects.deletePlants(id),
      deleteProfile: async (id) => {
        await effects.deleteProfile(id)
        await clearDeviceDataFor(id, { keepMarker: true })
        const snapshot = collection?.getSnapshot()
        if (snapshot?.userId === id && snapshot.status !== 'idle') {
          collection?.reload()
        }
      },
      deleteAccount: async () => {
        setAccountDeletionPhase('finishing')
        await effects.deleteAccount()
      },
    }

    try {
      const result = await deleteAccountAndData({
        userId,
        effects: wrapped,
        canDeleteAccount,
        from,
        onStepStart: (step) =>
          setState({ status: 'running', current: step, done: [...done] }),
        onStepDone: (step) => {
          done.push(step)
        },
      })
      if (!result.ok) {
        setAccountDeletionPhase('idle')
        // Sin permiso de Clerk de antemano no se borró nada: el reintento
        // empieza desde el principio.
        if (canDeleteAccount) lastFailure.current = result.step
        setState({
          status: 'failed',
          step: result.step,
          reason: result.reason,
          done: [...done],
        })
        return
      }
      lastFailure.current = null
      await clearDeviceDataFor(userId)
      clearAccountDeletionMarker(userId)
      collection?.setUser(null)
      setState({ status: 'done' })
      await onDeleted()
    } finally {
      running.current = false
    }
  }, [canDeleteAccount, collection, effects, onDeleted, userId])

  const reset = useCallback(() => {
    if (running.current) return
    setState({ status: 'idle' })
  }, [])

  return { state, start, reset }
}
