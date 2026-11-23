import type { PlantType } from '../lib/database.ts'

// Textos del detalle de un ejemplar (#16) y de su ficha (#265), en un solo
// sitio.

export const DETAIL_TEXT = {
  /** Nombre accesible del enlace de regreso: «Volver a» + backShort. */
  back: 'Volver a Mi colección',
  backPrefix: 'Volver a',
  /** Lo que se ve en el enlace de regreso (#265). */
  backShort: 'Mi colección',
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
  /** Tipo en la línea bajo el nombre (para el lector; «Tipo» es del panel). */
  typeShort: 'Tipo de planta',
  validation: 'Nombre',
  status: 'Estado',
  /** Identificador del ejemplar (#264): «CAT-012». */
  code: 'Identificador',
  acquiredOn: 'Fecha de adquisición',
  origin: 'Origen',
  location: 'Ubicación',
  nickname: 'Apodo',
  flowerColor: 'Color de la flor',
  missing: 'Sin indicar',
  /** Acceso discreto a la edición si faltan datos opcionales (#265). */
  complete: 'Completar datos',
  /** Enlace a la ficha de su especie en el catálogo (#265). */
  catalog: 'Ver la especie en el catálogo',
  /** Explica la etiqueta "No identificable". */
  unidentifiable:
    'Revisamos el nombre y no pudimos identificarlo en el catálogo. La planta sigue en tu colección con el nombre que escribiste y la puedes editar como cualquier otra.',
  /** «Gestionar planta» (#265): dar de baja y eliminar, plegado al final. */
  actionsLabel: 'Gestionar planta',
  edit: 'Editar planta',
  retireHint:
    'Si la perdiste o la regalaste: se conserva con sus datos y deja de contar en tu colección activa.',
  reactivateHint: 'Vuelve a contar en tu colección activa.',
  deleteHint:
    'Para registros creados por error: se borra para siempre con sus fotos y su bitácora.',
  saved: 'Guardaste los cambios.',
  retire: 'Dar de baja',
  reactivate: 'Reactivar',
  delete: 'Eliminar planta',
  offline:
    'Sin conexión: editar la planta o sus notas, darla de baja o eliminarla necesitan conexión. Se activarán solas cuando vuelva.',
  unverified:
    'No se pudo confirmar tu sesión: editar la planta o sus notas, darla de baja o eliminarla necesitan confirmarla con conexión. Ves la copia guardada en este dispositivo.',
  inactive: (status: string) =>
    `Dada de baja: ${status.toLocaleLowerCase('es')}. No cuenta en tu colección activa; la ves con el filtro de estado. Puedes reactivarla en «Gestionar planta».`,
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
    'Se borrarán sus datos y sus notas, todas sus fotos y todos los registros de su bitácora. No se puede deshacer. Si la perdiste o la regalaste, mejor dala de baja: así la conservas.',
  deleteConfirm: 'Eliminar definitivamente',
  deleteBusy: 'Eliminando…',
  deleted: 'Eliminaste de tu colección',
  deletedPhotosLeft:
    'Su foto no se pudo borrar ahora; se limpiará más adelante.',
} as const

/** Notas de la planta en la ficha (#265), editables en el sitio. */
export const NOTES_TEXT = {
  title: 'Notas',
  /** «Editar» y, para el lector, «Editar notas». */
  edit: 'Editar',
  editHidden: 'notas',
  add: 'Añadir notas',
  empty: 'Aún no has escrito notas sobre esta planta.',
  count: (length: number, max: number) =>
    `${String(length)} de ${String(max)} caracteres`,
  tooLong: (max: number) =>
    `Las notas pueden tener hasta ${String(max)} caracteres.`,
  save: 'Guardar',
  saving: 'Guardando…',
  cancel: 'Cancelar',
  saved: 'Guardaste las notas.',
  removed: 'Quitaste las notas.',
} as const

/** Galería del detalle (#183): fotos, visor, fecha y nota, y orden. */
export const GALLERY_TEXT = {
  title: 'Fotos',
  /** Posición de la foto que se ve, sobre su esquina (#265): «1 de 3». */
  position: (place: number, count: number) =>
    `${String(place)} de ${String(count)}`,
  positionHidden: 'Foto ',
  previous: 'Foto anterior',
  next: 'Foto siguiente',
  /** Despliega «Hacer principal», «Mover antes» y «Mover después» (#265). */
  order: 'Ordenar fotos',
  empty: 'Aún no tienes fotos de esta planta.',
  referenceTitle: 'Así es su especie',
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
