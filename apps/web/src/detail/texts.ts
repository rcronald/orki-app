import type { PlantType } from '../lib/database.ts'

// Textos del detalle de un ejemplar (#16), en un solo sitio.

export const DETAIL_TEXT = {
  back: 'Volver a Mi colección',
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
  missing: 'Sin indicar',
  /** Explica la etiqueta "No identificable". */
  unidentifiable:
    'Revisamos el nombre y no pudimos identificarlo en el catálogo. La planta sigue en tu colección con el nombre que escribiste y la puedes editar como cualquier otra.',
  actionsLabel: 'Acciones',
  edit: 'Editar',
  saved: 'Guardaste los cambios.',
  retire: 'Dar de baja',
  reactivate: 'Reactivar',
  delete: 'Eliminar',
  offline:
    'Sin conexión: editar, dar de baja o eliminar necesitan conexión. Las acciones se activarán solas cuando vuelva.',
  unverified:
    'No se pudo confirmar tu sesión: editar, dar de baja o eliminar necesitan confirmarla con conexión. Ves la copia guardada en este dispositivo.',
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

/** Galería del detalle (#183): fotos, visor, fecha y nota, y orden. */
export const GALLERY_TEXT = {
  title: 'Fotos',
  count: (count: number, max: number) => `${String(count)} de ${String(max)}`,
  choose: 'Elegir la foto que se ve',
  /** Texto alternativo: «Foto principal de Phalaenopsis amabilis, en flor». */
  alt: (label: string, name: string, inBloom: boolean) =>
    `${label} de ${name}${inBloom ? ', en flor' : ''}`,
  open: (alt: string) => `Ver en grande: ${alt}`,
  viewerTitle: (name: string) => `Fotos de ${name}`,
  unavailable: 'Disponible con conexión',
  failed: 'No se pudo cargar la foto',
  loading: 'Cargando la foto…',
  viewerThumbnail:
    'Sin conexión: ves la miniatura. La foto completa se verá con conexión.',
  viewerThumbnailFailed:
    'No se pudo cargar la foto completa: ves la miniatura.',
  onlyMain:
    'Sin conexión: solo está disponible la foto principal. Las demás fotos se verán con conexión.',
  loadFailed: 'No se pudieron cargar las demás fotos.',
  retry: 'Reintentar',
  inBloom: 'En flor',
  takenAt: (date: string) => `Foto del ${date}`,
  manage: 'Añadir o quitar fotos',
  addPhotos: 'Añadir fotos',
  noPhoto: 'Sin foto',
  /** Bajo la foto de referencia de su especie, sin fotos propias (#234). */
  referenceNote:
    'Aún no tienes fotos de esta planta. Esta es una foto de referencia de su especie, no de tu ejemplar.',
  offline:
    'Sin conexión: cambiar la fecha, la nota o el orden necesita conexión.',
  unverified:
    'No se pudo confirmar tu sesión: cambiar las fotos necesita confirmarla con conexión.',
  editDetails: 'Editar fecha y nota',
  makeMain: 'Hacer principal',
  alreadyMain: 'Ya es la foto principal.',
  moveEarlier: 'Mover antes',
  moveLater: 'Mover después',
  firstAlready: 'Ya es la primera.',
  lastAlready: 'Ya es la última.',
  orderBusy: 'Guardando el orden…',
  madeMain: 'Ahora es la foto principal. Tu colección ya la muestra.',
  moved: (place: number, count: number) =>
    `Foto movida al lugar ${String(place)} de ${String(count)}.`,
  formTitle: 'Fecha y nota de la foto',
  dateLabel: 'Fecha de la foto (opcional)',
  noteLabel: 'Nota (opcional)',
  noteCount: (length: number, max: number) =>
    `${String(length)} de ${String(max)} caracteres`,
  inBloomLabel: 'En flor',
  save: 'Guardar',
  saving: 'Guardando…',
  cancel: 'Cancelar',
  saved: 'Guardaste la fecha y la nota de la foto.',
  dateFuture: 'La fecha no puede ser posterior a hoy.',
  dateInvalid: 'Escribe una fecha válida.',
  noteTooLong: (max: number) =>
    `La nota puede tener hasta ${String(max)} caracteres.`,
} as const

/** Por qué no se pudo guardar un cambio de la galería; no se cambió nada. */
export const GALLERY_ERROR_TEXT = {
  offline:
    'Sin conexión: no se guardó el cambio. Vuelve a intentarlo cuando tengas conexión.',
  'session-ended':
    'Tu sesión terminó: no se guardó el cambio. Vuelve a iniciar sesión e inténtalo de nuevo.',
  'not-found':
    'Esta foto ya no está en la planta. Volvimos a cargar sus fotos.',
  changed:
    'Las fotos de la planta cambiaron en otro dispositivo. Volvimos a cargarlas: inténtalo de nuevo.',
  failed:
    'No se pudo guardar el cambio por un error del servidor. Vuelve a intentarlo en unos momentos.',
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
