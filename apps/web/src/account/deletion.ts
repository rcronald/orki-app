// Eliminación de la cuenta desde la app (#110, parte de #26), sin backend.
//
// Función orquestadora pura: no sabe de Supabase, de Clerk ni de React. Recibe
// los efectos (borrar fotos, plantas, perfil y cuenta) y los ejecuta en orden.
// Así cada fallo se prueba con dobles (deletion.test.ts).
//
// Orden (#26): 1) fotos del bucket; 2) plantas; 3) perfil; 4) cuenta de Clerk.
// - Los datos van antes que la cuenta: una vez borrada la cuenta de Clerk, su
//   token deja de servir y la app ya no puede borrar nada en Supabase (no hay
//   clave de servicio ni backend). Al revés quedarían datos sin dueño.
// - Las fotos antes que las plantas (lo pide el #26): si fallara el borrado
//   de las plantas después de borrar las fotos, las plantas seguirían
//   apuntando a archivos que ya no existen (se ven con el marcador neutro) y
//   el reintento las borra. Las fotos se borran listando la carpeta entera
//   del usuario en el bucket, no a partir de las rutas de las plantas, así
//   que el orden no hace falta para encontrarlas: también se llevan los
//   restos de subidas anteriores y las carpetas de plantas ya borradas.
// - No hay clave foránea entre plants y profiles (migración
//   20261119233441_crear_inventario_plantas.sql), así que el orden entre
//   plantas y perfil no lo impone la base: el perfil va después porque es la
//   fila que dice "este usuario existe en Orki".
//
// Si un paso falla, los siguientes no se ejecutan y se devuelve qué paso
// falló y por qué. Todos los pasos son idempotentes (borrar lo que ya no está
// no da error), así que reintentar termina el trabajo, desde el paso que
// falló o desde el principio.

export const DELETION_STEPS = [
  'photos',
  'plants',
  'profile',
  'account',
] as const

export type DeletionStep = (typeof DELETION_STEPS)[number]

/**
 * Por qué falló un paso:
 * - offline: sin conexión.
 * - session-ended: la sesión terminó; hay que volver a entrar.
 * - not-allowed: Clerk no permite que el usuario elimine su cuenta (el
 *   ajuste del panel no está activado, #109).
 * - reverification-cancelled: Clerk pidió confirmar la identidad y la
 *   persona cerró la ventana sin hacerlo.
 * - failed: cualquier otro fallo.
 */
export type DeletionFailureReason =
  | 'offline'
  | 'session-ended'
  | 'not-allowed'
  | 'reverification-cancelled'
  | 'failed'

/** Error con motivo que pueden lanzar los efectos. */
export class AccountDeletionError extends Error {
  readonly reason: DeletionFailureReason

  constructor(reason: DeletionFailureReason, options?: { cause?: unknown }) {
    super(`No se pudo completar el paso (${reason}).`, options)
    this.name = 'AccountDeletionError'
    this.reason = reason
  }
}

/** Lo que hace cada paso. Todos deben ser idempotentes. */
export interface AccountDeletionEffects {
  /** Borra todos los archivos de la carpeta del usuario en el bucket. */
  deletePhotos(userId: string): Promise<void>
  /** Borra todas las plantas del usuario. */
  deletePlants(userId: string): Promise<void>
  /** Borra el perfil del usuario. */
  deleteProfile(userId: string): Promise<void>
  /** Elimina la cuenta en Clerk (la del usuario con sesión). */
  deleteAccount(): Promise<void>
}

export type DeletionResult =
  | { ok: true }
  | {
      ok: false
      /** Paso que falló; los anteriores terminaron y los siguientes no se ejecutaron. */
      step: DeletionStep
      reason: DeletionFailureReason
      error: unknown
    }

export interface DeleteAccountOptions {
  userId: string
  effects: AccountDeletionEffects
  /**
   * Si Clerk deja eliminar la cuenta (user.deleteSelfEnabled). Con false no
   * se borra nada: falla enseguida en el paso de la cuenta con not-allowed,
   * para no dejar una cuenta vacía que la persona no puede cerrar.
   */
  canDeleteAccount: boolean
  /** Paso por el que empezar (un reintento); por defecto, el primero. */
  from?: DeletionStep
  /** Avisa al empezar cada paso. */
  onStepStart?: (step: DeletionStep) => void
  /** Avisa al terminar bien cada paso. */
  onStepDone?: (step: DeletionStep) => void
}

/** Motivo de un error cualquiera; lo desconocido cuenta como failed. */
export function deletionReasonOf(error: unknown): DeletionFailureReason {
  if (error instanceof AccountDeletionError) return error.reason
  return 'failed'
}

/** Ejecuta la eliminación en orden; se detiene en el primer fallo. */
export async function deleteAccountAndData({
  userId,
  effects,
  canDeleteAccount,
  from = 'photos',
  onStepStart,
  onStepDone,
}: DeleteAccountOptions): Promise<DeletionResult> {
  if (!canDeleteAccount) {
    return {
      ok: false,
      step: 'account',
      reason: 'not-allowed',
      error: new AccountDeletionError('not-allowed'),
    }
  }
  const run: Record<DeletionStep, () => Promise<void>> = {
    photos: () => effects.deletePhotos(userId),
    plants: () => effects.deletePlants(userId),
    profile: () => effects.deleteProfile(userId),
    account: () => effects.deleteAccount(),
  }
  const start = DELETION_STEPS.indexOf(from)
  for (const step of DELETION_STEPS.slice(start)) {
    onStepStart?.(step)
    try {
      await run[step]()
    } catch (error) {
      return { ok: false, step, reason: deletionReasonOf(error), error }
    }
    onStepDone?.(step)
  }
  return { ok: true }
}

/** Pasos que ya terminaron cuando falla `step`. */
export function stepsBefore(step: DeletionStep): DeletionStep[] {
  return DELETION_STEPS.slice(0, DELETION_STEPS.indexOf(step))
}
