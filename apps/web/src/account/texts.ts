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
  back: 'Volver a Mi colección',
  profileHeading: 'Perfil',
  editProfile: 'Editar perfil',
  profileLoading: 'Cargando tu perfil…',
  profileOffline:
    'Sin conexión: para editar tu perfil hace falta conexión. Vuelve cuando la tengas.',
  profileUnavailable: {
    offline:
      'Sin conexión: tus datos de perfil se verán, y podrás editarlos, cuando vuelva la conexión.',
    unverified:
      'No se pudo confirmar tu sesión: el servicio de acceso no responde. Tus datos de perfil se verán, y podrás editarlos, cuando se confirme.',
  },
  dataHeading: 'Datos y privacidad',
  exportTitle: 'Exportar inventario a CSV',
  exportDescription: 'El archivo CSV no incluye las fotos.',
  exportLoading: 'Cargando tu colección para exportarla…',
  exportRetry: 'Volver a cargar la colección',
  privacyTitle: 'Aviso de privacidad',
  privacyDescription: 'Consulta qué datos guardamos y quién puede verlos.',
  deleteHeading: 'Eliminar cuenta',
  deleteSummary:
    'Se eliminarán tu cuenta, tus plantas y sus fotos. Esta acción es irreversible.',
  deleteButton: 'Eliminar mi cuenta',
  signOut: 'Cerrar sesión',
  loadingAccount: 'Cargando tu cuenta…',
  offline:
    'Sin conexión: para eliminar la cuenta hace falta conexión. Vuelve cuando la tengas.',
  unverified:
    'No se pudo confirmar tu sesión: el servicio de acceso no responde. Para eliminar la cuenta hace falta conexión y la sesión confirmada. Vuelve cuando la tengas.',
  notAllowed:
    'Todavía no se puede eliminar la cuenta desde orqui.app. No se ha borrado nada. Para eliminarla, escribe al contacto de la página de privacidad.',
  pendingHeading: 'La eliminación de tu cuenta quedó a medias',
  pendingText:
    'Empezaste a eliminar tu cuenta y no terminó. Puede que parte de tus datos ya se haya borrado. Continúa para terminar, o sigue usando orqui.app con lo que quede.',
  pendingContinue: 'Continuar la eliminación',
  pendingKeep: 'Seguir usando orqui.app',
} as const

export const DIALOG_TEXT = {
  title: '¿Eliminar tu cuenta?',
  intro: 'Se borrará todo lo tuyo en orqui.app:',
  items: [
    'Tus plantas, con todos sus detalles (identificador, nombre, género, tipo, fecha de adquisición, origen, ubicación, apodo, color de la flor, estado y notas).',
    'Las fotos de tus plantas y sus miniaturas, con su orden, la fecha de la foto, su nota y si la planta estaba en floración.',
    'La bitácora de tus plantas: todos sus registros, con su tipo de actividad, su título, su descripción, su foto y si observaste floración.',
    'Tu perfil y tus eventos de uso (cuándo registraste una planta y cuándo buscaste si ya la tenías).',
    'Tu cuenta de acceso: no podrás volver a entrar con ella.',
    'Lo que orqui.app guarda en este dispositivo: la copia de tu inventario para usarlo sin conexión, las miniaturas, los eventos de uso pendientes de enviar, el borrador del registro y tus preferencias del inventario.',
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
  'not-allowed': 'Todavía no se puede eliminar la cuenta desde orqui.app.',
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
  'Tu cuenta se eliminó. Se borraron tus plantas, sus fotos, tu perfil y tus eventos de uso, y se cerró la sesión.'
