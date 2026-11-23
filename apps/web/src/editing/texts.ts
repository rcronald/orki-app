// Textos de la edición de una planta (#266), en un solo sitio. Los campos que
// comparte con el registro (nombre, género, tipo, fecha, origen, ubicación,
// apodo y color) siguen en registration/texts.ts.

/** «la foto principal», «la foto principal y la foto 3 de 4». */
function photoList(labels: readonly string[]): string {
  const items = labels.map((label) => `la ${label.toLowerCase()}`)
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} y ${items.at(-1) ?? ''}`
}

const count = (value: number, max: number) =>
  `${String(value)} de ${String(max)}`

export const EDIT_TEXT = {
  title: 'Editar planta',
  back: 'Volver a la ficha',
  /** Antes del identificador, solo para el lector de pantalla. */
  codePrefix: 'Identificador:',
  submit: 'Guardar cambios',
  submitting: 'Guardando…',
  photosPreparing: 'Preparando las fotos…',
  cancel: 'Cancelar',
  retry: 'Reintentar',
  signIn: 'Iniciar sesión',
  offline:
    'Sin conexión. Editar una planta necesita conexión: el formulario se activará solo cuando vuelva.',
  duplicateAfter: '. Puedes guardarla igualmente.',
  detailsTitle: 'Más detalles',
  optional: '(opcional)',

  notesLabel: 'Notas',
  notesHint: 'Lo que quieras recordar de esta planta.',
  notesCount: (length: number, max: number) =>
    `${count(length, max)} caracteres`,
  notesTooLong: (max: number) =>
    `Las notas pueden tener hasta ${String(max)} caracteres.`,

  photosTitle: 'Fotos',
  addPhotos: 'Añadir fotos',
  managePhotos: 'Gestionar fotos',
  manageDone: 'Listo',
  manageHelp:
    'Ordena las fotos, elige la principal, añade su fecha y una nota o quita las que sobran. Nada se guarda hasta «Guardar cambios».',
  manageList: 'Fotos de la planta',
  newPhoto: 'Nueva',
  makeMain: 'Hacer principal',
  moveEarlier: 'Mover antes',
  moveLater: 'Mover después',
  remove: 'Quitar',
  alreadyMain: 'Ya es la principal.',
  firstAlready: 'Ya es la primera.',
  lastAlready: 'Ya es la última.',
  photoDate: 'Fecha de la foto',
  photoNote: 'Nota',
  photoNoteCount: (length: number, max: number) =>
    `${count(length, max)} caracteres`,
  inBloom: 'En flor',
  photoDateFuture: 'La fecha no puede ser posterior a hoy.',
  photoDateInvalid: 'Escribe una fecha válida.',
  photoNoteTooLong: (max: number) =>
    `La nota puede tener hasta ${String(max)} caracteres.`,

  /** Anuncios de la galería (role="status"). */
  photoAdded: (total: number, max: number) =>
    `Foto añadida: ${count(total, max)}. Se guardará al guardar los cambios.`,
  photosAdding: (added: number) =>
    added === 1 ? 'Preparando la foto…' : `Preparando ${String(added)} fotos…`,
  photosLeftOut: (accepted: number, leftOut: number, max: number) =>
    `${accepted === 0 ? 'No se añadió ninguna' : `Se ${accepted === 1 ? 'añadió 1 foto' : `añadieron ${String(accepted)} fotos`}`}; ${leftOut === 1 ? '1 quedó fuera' : `${String(leftOut)} quedaron fuera`}: el máximo es ${String(max)}.`,
  photoPrepareFailed: (fileName: string, message: string) =>
    `No se pudo preparar «${fileName}». ${message}`,
  photoRemoved: (left: number, max: number, wasMain: boolean) =>
    `Foto quitada: quedan ${count(left, max)}.${wasMain && left > 0 ? ' La siguiente pasa a ser la principal.' : ''} Se quitará al guardar los cambios.`,
  photoRestored: 'Foto recuperada.',
  madeMain: 'Ahora es la foto principal. Se guardará al guardar los cambios.',
  moved: (place: number, total: number) =>
    `Foto movida al lugar ${count(place, total)}.`,
  removedPending: (removed: number) =>
    removed === 1
      ? 'Una foto guardada se quitará al guardar los cambios.'
      : `${String(removed)} fotos guardadas se quitarán al guardar los cambios.`,
  undoRemove: 'Deshacer',
  photosLoading: 'Cargando las fotos de la planta…',
  photosLoadFailed: 'No se pudieron cargar las fotos de la planta.',
  photosLoadRetry: 'Volver a cargar las fotos',

  /** Estado de una foto nueva en la miniatura al guardar. */
  photoNotUploaded: 'No se subió',

  /** Errores del guardado (#266): qué falló y qué quedó guardado. */
  uploadFailed: (labels: readonly string[]) =>
    labels.length === 1
      ? `No se pudo subir ${photoList(labels)}.`
      : `No se pudieron subir ${String(labels.length)} fotos: ${photoList(labels)}.`,
  readFailed: 'No se pudieron leer las fotos de la planta.',
  photosFailed: 'No se pudieron guardar los cambios de las fotos.',
  nothingSaved: 'Aún no se guardó ningún cambio: lo que editaste sigue aquí.',
  partlySaved:
    'Parte de los cambios ya quedó guardada. Lo que editaste sigue aquí; al reintentar se completa el resto, sin repetir nada.',
  /** La planta se eliminó (desde otro dispositivo): no hay nada que reintentar. */
  plantGone:
    'Esta orquídea ya no está en tu colección: puede que se haya eliminado desde otro dispositivo.',
  goToCollection: 'Ir a Mi colección',
} as const

/** Diálogo de cambios sin guardar. */
export const EDIT_LEAVE_TEXT = {
  title: '¿Salir sin guardar?',
  description: 'Perderás los cambios que hiciste en esta planta.',
  partial:
    'Parte de los cambios ya quedó guardada al intentar guardar y no se deshará.',
  confirm: 'Salir sin guardar',
  stay: 'Seguir editando',
  /** Se intenta salir durante el guardado (#279). */
  busyTitle: 'Se están guardando los cambios',
  busyDescription:
    'Espera a que termine: si sales a mitad, el guardado puede quedar incompleto. Al terminar volverás a la ficha.',
  busyOk: 'Entendido',
} as const
