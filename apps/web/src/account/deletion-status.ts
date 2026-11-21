import { useSyncExternalStore } from 'react'

// Fase global de la eliminación de la cuenta, para AccountDeletionGate.
//
// Al borrar la cuenta de Clerk la sesión desaparece, y RequireAuth mandaría
// al inicio de sesión desde /cuenta antes de que la pantalla pudiera ir al
// inicio con su mensaje. Con esta fase, la ruta sabe que la sesión se está
// cerrando a propósito:
// - finishing: se está eliminando la cuenta de Clerk; si la sesión cae, no se
//   redirige al inicio de sesión.
// - done: la cuenta se eliminó; se va al inicio con el aviso.

export type AccountDeletionPhase = 'idle' | 'finishing' | 'done'

let phase: AccountDeletionPhase = 'idle'
const listeners = new Set<() => void>()

export function setAccountDeletionPhase(next: AccountDeletionPhase): void {
  if (next === phase) return
  phase = next
  for (const listener of listeners) listener()
}

export function getAccountDeletionPhase(): AccountDeletionPhase {
  return phase
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useAccountDeletionPhase(): AccountDeletionPhase {
  return useSyncExternalStore(subscribe, getAccountDeletionPhase, () => 'idle')
}

/** Estado de navegación con el que se llega al inicio tras eliminar la cuenta. */
export interface AccountDeletedState {
  accountDeleted: true
}

export function isAccountDeletedState(
  state: unknown,
): state is AccountDeletedState {
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as { accountDeleted?: unknown }).accountDeleted === true
  )
}
