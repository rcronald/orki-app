import {
  DELETION_STEPS,
  stepsBefore,
  type DeletionFailureReason,
  type DeletionStep,
} from './deletion.ts'

// Textos de la pantalla de cuenta y de la eliminación (#110).

/** Palabra que hay que escribir para habilitar la eliminación. */
export const CONFIRMATION_WORD = 'ELIMINAR'

/** ¿Lo escrito es la palabra de confirmación? Sin distinguir mayúsculas. */
export function isConfirmationWord(value: string): boolean {
  return value.trim().toLocaleUpperCase('es') === CONFIRMATION_WORD
}

export const ACCOUNT_TEXT = {
  title: 'Tu cuenta',
  sessionHeading: 'Datos de la sesión',
  emailLabel: 'Correo',
  noEmail: 'Sin correo (entraste con otro método)',
  manageHint:
    'Para cambiar tu correo, tu nombre o tu foto, usa el menú de la cuenta (el botón con tu avatar, arriba).',
  deleteHeading: 'Eliminar tu cuenta',
  deleteIntro:
    'Al eliminar tu cuenta se borran tus plantas con todos sus detalles, sus fotos, tu perfil y tu cuenta de acceso. No se puede deshacer.',
  deleteButton: 'Eliminar mi cuenta',
  offline:
    'Sin conexión: para eliminar la cuenta hace falta conexión. Vuelve cuando la tengas.',
  notAllowed:
    'Orki todavía no permite eliminar la cuenta desde la app. No se ha borrado nada. Para eliminarla, escribe al contacto de la página de privacidad.',
  pendingHeading: 'La eliminación de tu cuenta quedó a medias',
  pendingText:
    'Empezaste a eliminar tu cuenta y no terminó. Puede que parte de tus datos ya se haya borrado. Continúa para terminar, o sigue usando Orki con lo que quede.',
  pendingContinue: 'Continuar la eliminación',
  pendingKeep: 'Seguir usando Orki',
  privacyLink: 'Qué datos guarda Orki (privacidad)',
} as const

export const DIALOG_TEXT = {
  title: '¿Eliminar tu cuenta?',
  intro: 'Se borrará todo lo tuyo en Orki:',
  items: [
    'Tus plantas, con todos sus detalles (nombre, género, tipo, fecha de adquisición, origen, ubicación, apodo, color de la flor y estado).',
    'Las fotos de tus plantas y sus miniaturas.',
    'Tu perfil.',
    'Tu cuenta de acceso: no podrás volver a entrar con ella.',
    'Lo que Orki guarda en este dispositivo: el borrador del registro, las miniaturas y tus preferencias del inventario.',
  ],
  irreversible: 'No se puede deshacer. Nadie podrá recuperar tus datos.',
  confirmLabel: `Para confirmar, escribe ${CONFIRMATION_WORD}`,
  confirmHint: 'Así no se elimina por accidente.',
  confirm: 'Eliminar mi cuenta para siempre',
  cancel: 'Cancelar',
  retry: 'Volver a intentarlo',
  close: 'Cerrar',
  progressHeading: 'Progreso',
  leaveWarning:
    'Se está eliminando tu cuenta. Si sales ahora quedará a medias.',
} as const

export const STEP_LABEL: Record<DeletionStep, string> = {
  photos: 'Borrar tus fotos',
  plants: 'Borrar tus plantas',
  profile: 'Borrar tu perfil',
  account: 'Eliminar tu cuenta de acceso',
}

const STEP_RUNNING: Record<DeletionStep, string> = {
  photos: 'borrando tus fotos…',
  plants: 'borrando tus plantas…',
  profile: 'borrando tu perfil…',
  account: 'eliminando tu cuenta de acceso…',
}

export type StepState = 'pending' | 'running' | 'done' | 'failed'

export const STEP_STATE_TEXT: Record<StepState, string> = {
  pending: 'pendiente',
  running: 'en curso',
  done: 'hecho',
  failed: 'no se pudo',
}

/** "Paso 2 de 4: borrando tus plantas…" */
export function runningText(step: DeletionStep): string {
  const index = DELETION_STEPS.indexOf(step) + 1
  return `Paso ${index} de ${DELETION_STEPS.length}: ${STEP_RUNNING[step]}`
}

const STEP_FAILED: Record<DeletionStep, string> = {
  photos: 'No se pudieron borrar tus fotos.',
  plants: 'No se pudieron borrar tus plantas.',
  profile: 'No se pudo borrar tu perfil.',
  account: 'No se pudo eliminar tu cuenta de acceso.',
}

const REASON_TEXT: Record<DeletionFailureReason, string> = {
  offline: 'No hay conexión.',
  'session-ended':
    'Tu sesión terminó. Vuelve a iniciar sesión y entra en «Tu cuenta» para terminar.',
  'not-allowed': 'Orki todavía no permite eliminar la cuenta desde la app.',
  'reverification-cancelled':
    'Para eliminar la cuenta hay que confirmar que eres tú, y esa confirmación se cerró sin terminar.',
  failed: 'Hubo un fallo al comunicarse con el servidor.',
}

const DONE_TEXT: Record<number, string> = {
  0: 'No se borró nada: tus fotos, tus plantas, tu perfil y tu cuenta siguen igual.',
  1: 'Tus fotos ya se borraron; tus plantas, tu perfil y tu cuenta siguen.',
  2: 'Tus fotos y tus plantas ya se borraron; tu perfil y tu cuenta siguen.',
  3: 'Tus fotos, tus plantas y tu perfil ya se borraron; solo queda tu cuenta de acceso, vacía.',
}

/** Contacto para pedir la eliminación de la cuenta a mano. */
export const CONTACT_TEXT =
  'Para eliminarla, escribe al contacto de la página de privacidad.'

/** Explicación de un fallo: qué falló, por qué, qué quedó y qué hacer. */
export function failureText(
  step: DeletionStep,
  reason: DeletionFailureReason,
): string {
  const done = DONE_TEXT[stepsBefore(step).length]
  const next =
    reason === 'session-ended'
      ? ''
      : reason === 'not-allowed'
        ? CONTACT_TEXT
        : 'Vuelve a intentarlo: se continuará donde se quedó.'
  return [STEP_FAILED[step], REASON_TEXT[reason], done, next]
    .filter(Boolean)
    .join(' ')
}

export const DELETED_NOTICE =
  'Tu cuenta se eliminó. Se borraron tus plantas, sus fotos y tu perfil, y se cerró la sesión.'
