import type { PlantLogErrorReason } from './entries.ts'

// Textos de la bitácora del ejemplar (#267), en un solo sitio.

export const LOG_TEXT = {
  title: 'Bitácora',
  add: 'Añadir registro',
  filterLabel: 'Filtrar por actividad',
  allTypes: 'Todas las actividades',
  loading: 'Cargando la bitácora…',
  emptyTitle: 'Aún no hay registros',
  empty:
    'Anota riegos, abonos y cuidados para seguir la evolución de esta planta. Empieza con «Añadir registro».',
  filterEmpty: (type: string) => `No hay registros de ${type}.`,
  showAll: 'Ver todas',
  loadMore: 'Cargar más',
  loadingMore: 'Cargando…',
  retry: 'Reintentar',
  listLabel: 'Registros de la bitácora',
  showing: (type: string | null) =>
    type === null
      ? 'Se muestran todas las actividades.'
      : `Se muestran los registros de ${type}.`,
  loadedMore: (count: number) =>
    count === 1
      ? 'Se cargó 1 registro más.'
      : `Se cargaron ${String(count)} registros más.`,
  /** Bajo el título de un registro: «Floración observada: sí». */
  bloom: (inBloom: boolean) => `Floración observada: ${inBloom ? 'sí' : 'no'}`,
  photoAlt: (title: string) => `Foto del registro «${title}»`,
  openPhoto: (title: string) => `Ver en grande la foto del registro «${title}»`,
  photoUnavailable: 'Foto no disponible',
  delete: (title: string) => `Eliminar el registro «${title}»`,
  offline:
    'Sin conexión: la bitácora no se guarda en este dispositivo. Para verla, añadir o eliminar registros hace falta conexión.',
  unverified:
    'No se pudo confirmar tu sesión: la bitácora necesita confirmarla con conexión.',
  saved: (title: string) => `Guardaste el registro «${title}».`,
  /** Tras guardar con un filtro que lo escondería: se quita el filtro. */
  filterCleared: (type: string) =>
    `Quitamos el filtro «${type}» para mostrarlo arriba.`,
  deleted: (title: string) => `Eliminaste el registro «${title}».`,
  deleteTitle: '¿Eliminar este registro?',
  deleteDescription: (title: string, withPhoto: boolean) =>
    `Se borrará «${title}» de la bitácora${withPhoto ? ', con su foto' : ''}. No se puede deshacer.`,
  deleteConfirm: 'Eliminar registro',
  deleteBusy: 'Eliminando…',
} as const

/** El formulario «Nuevo registro de bitácora». */
export const LOG_FORM_TEXT = {
  title: 'Nuevo registro de bitácora',
  close: 'Cerrar',
  back: 'Volver a la ficha',
  type: 'Tipo de actividad',
  typeRequired: 'Elige el tipo de actividad.',
  entryTitle: 'Título',
  titleRequired: 'Escribe un título.',
  titleTooLong: (max: number) =>
    `El título puede tener hasta ${String(max)} caracteres.`,
  titleHint: (length: number, max: number) =>
    `${String(length)} de ${String(max)} caracteres`,
  description: 'Descripción (opcional)',
  descriptionTooLong: (max: number) =>
    `La descripción puede tener hasta ${String(max)} caracteres.`,
  count: (length: number, max: number) =>
    `${String(length)} de ${String(max)} caracteres`,
  addPhoto: 'Añadir foto',
  changePhoto: 'Cambiar foto',
  removePhoto: 'Quitar foto',
  preparing: 'Preparando la foto…',
  photoPrepared: 'Foto lista. Se guardará con el registro.',
  photoRemoved: 'Quitaste la foto.',
  photoPreview: 'Foto elegida',
  photoHint: 'Una foto, opcional. No ocupa lugar en la galería de la planta.',
  photoModuleFailed:
    'No se pudo cargar el módulo de fotos. Revisa la conexión.',
  bloom: 'Floración observada',
  bloomUnknown: 'Sin indicar',
  bloomYes: 'Sí',
  bloomNo: 'No',
  automaticDate: 'La fecha y hora se guardan automáticamente.',
  offline:
    'Sin conexión: el registro no se puede guardar ahora. Lo que escribiste sigue aquí; podrás guardarlo cuando vuelva la conexión.',
  cancel: 'Cancelar',
  save: 'Guardar registro',
  saving: 'Guardando…',
  errorsTitle: 'Revisa el formulario:',
  discardTitle: '¿Descartar este registro?',
  discardDescription: 'Perderás lo que escribiste y la foto elegida.',
  discardConfirm: 'Descartar',
  discardStay: 'Seguir escribiendo',
} as const

/** Por qué no se pudo cargar la bitácora. */
export const LOG_LOAD_ERROR_TEXT: Record<PlantLogErrorReason, string> = {
  offline:
    'Sin conexión: no se pudo cargar la bitácora. Vuelve a intentarlo cuando tengas conexión.',
  'session-ended':
    'Tu sesión terminó: vuelve a iniciar sesión para ver la bitácora.',
  'not-found': 'Esta planta ya no está en tu colección.',
  invalid:
    'No se pudo cargar la bitácora por un error del servidor. Vuelve a intentarlo en unos momentos.',
  failed:
    'No se pudo cargar la bitácora por un error del servidor. Vuelve a intentarlo en unos momentos.',
}

/** Por qué no se pudo guardar un registro; lo escrito se conserva. */
export const LOG_SAVE_ERROR_TEXT: Record<PlantLogErrorReason, string> = {
  offline:
    'Sin conexión: no se guardó el registro. Lo que escribiste sigue aquí; vuelve a intentarlo cuando tengas conexión.',
  'session-ended':
    'Tu sesión terminó: no se guardó el registro. Vuelve a iniciar sesión e inténtalo de nuevo.',
  'not-found':
    'No se guardó el registro: esta planta ya no está en tu colección.',
  invalid:
    'No se guardó el registro: revisa el título y la descripción e inténtalo de nuevo.',
  failed:
    'No se guardó el registro por un error del servidor. Lo que escribiste sigue aquí; vuelve a intentarlo.',
}

/** Por qué no se pudo eliminar un registro; no se borró nada. */
export const LOG_DELETE_ERROR_TEXT: Record<PlantLogErrorReason, string> = {
  offline:
    'Sin conexión: no se eliminó el registro. Vuelve a intentarlo cuando tengas conexión.',
  'session-ended':
    'Tu sesión terminó: no se eliminó el registro. Vuelve a iniciar sesión e inténtalo de nuevo.',
  'not-found': 'Este registro ya no existe.',
  invalid:
    'No se eliminó el registro por un error del servidor. Vuelve a intentarlo en unos momentos.',
  failed:
    'No se eliminó el registro por un error del servidor. Vuelve a intentarlo en unos momentos.',
}
