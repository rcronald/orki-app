import { AccountDeletionError, type DeletionFailureReason } from './deletion.ts'

// Eliminación de la cuenta en Clerk desde el navegador: user.delete().
//
// Comprobado el 21 de noviembre de 2026:
// - Tipos de @clerk/shared 4.48 (dist/types/user.d.ts), que usa @clerk/react
//   6.19: UserResource.delete(): Promise<void> ("Deletes the current user") y
//   UserResource.deleteSelfEnabled ("Indicates whether the user can delete
//   their own account"), que refleja el ajuste del panel de Clerk "Allow
//   users to delete their accounts" (delete_self en la configuración de la
//   instancia, dist/types/userSettings.d.ts). Lo activa una persona (#109).
//   Referencia: https://clerk.com/docs/react/reference/objects/user
// - Reverificación: la guía https://clerk.com/docs/guides/secure/reverification
//   incluye "Delete account" entre las acciones que por defecto piden volver a
//   verificar la identidad (estrategia más fuerte disponible, ventana de 10
//   minutos). Con los componentes de Clerk se resuelve sola; con la API, la
//   llamada se envuelve en useReverification() (dist/react/hooks/
//   useReverification.d.ts), que abre la ventana de Clerk y repite la llamada
//   al verificar. Si la persona la cierra, rechaza con un ClerkRuntimeError de
//   código "reverification_cancelled" (isReverificationCancelledError en
//   @clerk/shared/error).
// - Qué hace el propio <UserProfile> de Clerk (packages/ui, DeleteUserForm):
//   useReverification(() => user.delete()) y después setActive({ session:
//   null, redirectUrl }). La app hace lo mismo: tras borrar, cierra la sesión
//   con setActive({ session: null }) y navega ella al inicio.
// - Sin comprobar (no está en la documentación y no se probó contra una
//   instancia real): el código exacto del error cuando el ajuste está
//   desactivado. Se supone una respuesta 403 de la API de Clerk
//   (ClerkAPIResponseError con status 403). Por eso, además, la app mira
//   deleteSelfEnabled antes de borrar nada.

interface ClerkErrorLike {
  name?: unknown
  code?: unknown
  status?: unknown
  message?: unknown
  errors?: { code?: unknown }[]
}

/** Motivo de un error de user.delete() (o de su reverificación). */
export function clerkDeletionReason(error: unknown): DeletionFailureReason {
  if (typeof error !== 'object' || error === null) return 'failed'
  const value = error as ClerkErrorLike
  const code = typeof value.code === 'string' ? value.code : ''
  const apiCode =
    typeof value.errors?.[0]?.code === 'string' ? value.errors[0].code : ''
  if (
    code === 'reverification_cancelled' ||
    apiCode === 'session_reverification_required'
  ) {
    return 'reverification-cancelled'
  }
  if (value.name === 'ClerkOfflineError' || navigator.onLine === false) {
    return 'offline'
  }
  const message = typeof value.message === 'string' ? value.message : ''
  if (
    `${message}${String(value.name)}`.toLowerCase().includes('networkerror')
  ) {
    return 'offline'
  }
  if (value.status === 401) return 'session-ended'
  if (value.status === 403) return 'not-allowed'
  return 'failed'
}

/** Llama a `deleteUser` y traduce su fallo a AccountDeletionError. */
export async function deleteClerkAccount(
  deleteUser: () => Promise<unknown>,
): Promise<void> {
  try {
    await deleteUser()
  } catch (error) {
    throw new AccountDeletionError(clerkDeletionReason(error), {
      cause: error,
    })
  }
}
