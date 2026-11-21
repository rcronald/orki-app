import type { PlantType } from '../lib/database.ts'

// Textos del detalle de un ejemplar (#16), en un solo sitio.

export const DETAIL_TEXT = {
  back: 'Volver a mi colección',
  loadingTitle: 'Cargando la planta…',
  loading: 'Cargando los datos de la planta…',
  errorTitle: 'No se pudo cargar la planta',
  notFoundTitle: 'Planta no encontrada',
  notFound:
    'Esta planta no está en tu colección. Puede que la dirección esté mal o que se haya eliminado.',
  dataLabel: 'Datos de la planta',
  enteredName: 'Nombre ingresado',
  genus: 'Género',
  type: 'Tipo',
  validation: 'Nombre',
  status: 'Estado',
  acquiredOn: 'Fecha de adquisición',
  origin: 'Origen',
  location: 'Ubicación',
  nickname: 'Apodo',
  flowerColor: 'Color de la flor',
  photoInBloom: 'Foto en floración',
  yes: 'Sí',
  no: 'No',
  missing: 'Sin indicar',
  /** Explica la etiqueta "Nombre por validar" de una planta no identificable. */
  unidentifiable:
    'No se pudo confirmar el nombre de esta planta con el catálogo: queda con el nombre que escribiste.',
  photoAlt: (name: string) => `Foto de ${name}`,
  photoLoading: (name: string) => `Foto de ${name}: cargando`,
  photoFailed: (name: string) => `Foto de ${name}: no se pudo cargar`,
  noPhoto: 'Sin foto',
  actionsLabel: 'Acciones',
  edit: 'Editar',
  saved: 'Guardaste los cambios.',
  retire: 'Dar de baja',
  reactivate: 'Reactivar',
  delete: 'Eliminar',
  offline:
    'Sin conexión: editar, dar de baja o eliminar necesitan conexión. Las acciones se activarán solas cuando vuelva.',
  inactive: (status: string) =>
    `Dada de baja: ${status.toLocaleLowerCase('es')}. No cuenta en tu colección activa; la ves con el filtro de estado.`,
  retireTitle: 'Dar de baja esta planta',
  retireDescription:
    'La planta se conserva con sus datos y su foto, pero deja de contar en tu colección activa. La verás con el filtro de estado y podrás reactivarla cuando quieras.',
  retireReason: 'Motivo',
  retireLost: 'Se perdió',
  retireGifted: 'La regalé',
  retireConfirm: 'Dar de baja',
  retireBusy: 'Dando de baja…',
  reactivateBusy: 'Reactivando…',
  retired: (status: string) =>
    `Diste de baja la planta: ${status.toLocaleLowerCase('es')}. Ya no cuenta en tu colección activa.`,
  reactivated: 'Reactivaste la planta: vuelve a contar en tu colección.',
  deleteTitle: '¿Eliminar esta planta para siempre?',
  deleteDescription:
    'Se borrarán sus datos, su foto y su miniatura. No se puede deshacer. Si la perdiste o la regalaste, mejor dala de baja: así la conservas.',
  deleteConfirm: 'Eliminar definitivamente',
  deleteBusy: 'Eliminando…',
  deleted: 'Eliminaste de tu colección',
  deletedPhotosLeft:
    'Su foto no se pudo borrar ahora; se limpiará más adelante.',
} as const

/** Por qué no se pudo eliminar la planta; nada se borró. */
export const DELETE_ERROR_TEXT = {
  offline:
    'Sin conexión: no se pudo eliminar la planta. Vuelve a intentarlo cuando tengas conexión.',
  'session-ended':
    'Tu sesión terminó: no se pudo eliminar la planta. Vuelve a iniciar sesión e inténtalo de nuevo.',
  failed:
    'No se pudo eliminar la planta por un error del servidor. Vuelve a intentarlo en unos momentos.',
} as const

/** Tipo de la planta en el detalle; "No sé" del registro se lee "Sin determinar". */
export const DETAIL_TYPE_LABEL = {
  species: 'Especie',
  hybrid: 'Híbrido',
  unknown: 'Sin determinar',
} as const satisfies Record<PlantType, string>
