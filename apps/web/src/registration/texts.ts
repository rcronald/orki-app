// Textos del registro de una planta, en un solo sitio.

/** Errores de validación junto a cada campo. */
export const PLANT_FORM_ERROR_TEXT = {
  nameMissing: 'Escribe el nombre de la orquídea.',
  nameTooLong: 'El nombre no puede pasar de 200 caracteres.',
  genusMissing: 'Elige el género.',
  genusNotFound: 'Busca y elige un género del catálogo.',
  typeMissing: 'Elige el tipo.',
  dateMissing: 'Indica la fecha de adquisición.',
  dateInvalid: 'Escribe una fecha válida.',
  dateFuture: 'La fecha no puede ser posterior a hoy.',
  textTooLong: 'No puede pasar de 120 caracteres.',
} as const

/** «1 foto», «3 fotos». */
export function photoCount(count: number): string {
  return count === 1 ? '1 foto' : `${String(count)} fotos`
}

/** «la foto principal», «la foto principal y la foto 3». */
function photoList(labels: readonly string[]): string {
  const items = labels.map((label) => `la ${label.toLowerCase()}`)
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} y ${items.at(-1) ?? ''}`
}

export const PLANT_FORM_TEXT = {
  title: 'Registrar una orquídea',
  back: 'Volver a Mi colección',
  nameLabel: 'Nombre',
  nameHint: 'Busca por nombre científico, sinónimo o nombre común.',
  /** Insignia bajo el nombre con una especie del catálogo elegida (#221). */
  nameMatch: 'Coincidencia en el catálogo',
  /** Título de la foto de referencia de la especie elegida (#234). */
  speciesPreview: 'Así es su especie',
  /** Qué pasará con un nombre que no está en el catálogo (#12). */
  namePendingHint:
    'No está en el catálogo: quedará en tu colección como «Nombre por validar» y el equipo del catálogo confirmará el nombre.',
  /**
   * Lo escrito coincide entero con un nombre del catálogo que no se enlaza
   * solo (#280): un sinónimo o un nombre común (va antes del nombre
   * aceptado), o el aceptado cuando no se puede asegurar que es el único.
   * Termina con nameOfferAfter.
   */
  nameOfferSynonym: ' es un sinónimo de ',
  nameOfferCommon: ' es un nombre común de ',
  nameOfferScientific: 'Coincide con ',
  nameOfferAfter:
    ' en el catálogo. Si la eliges, se guarda con ese nombre; si no, quedará como «Nombre por validar».',
  /** Varias especies del catálogo con el nombre escrito (#280). */
  nameSeveral: (count: number) =>
    `Hay ${String(count)} especies del catálogo con este nombre. Elige la tuya; si no, quedará como «Nombre por validar».`,
  /** Botón que elige una especie ofrecida bajo el nombre (#280). */
  nameChoose: 'Elegir',
  /** Por qué nombre coincidió, en el botón de una de varias especies. */
  nameChooseSynonym: (name: string) => `(sinónimo: ${name})`,
  nameChooseCommon: (name: string) => `(nombre común: ${name})`,
  nameChooseHybrid: '(híbrido)',
  /** Anuncio al enlazar una especie, sola o elegida (#280); solo para el lector. */
  nameLinked: (scientificName: string) =>
    `Enlazada con ${scientificName}, del catálogo.`,
  /**
   * Aviso de la galería con un nombre por validar (#12, #210, #221): sin
   * fotos, las recomienda (sin exigirlas); con fotos, avisa de quién podrá
   * verlas. Los dos siguen con «Más en Privacidad» (pendingPhotoMore y
   * privacyLink).
   */
  pendingPhotoHint:
    'Te recomendamos añadir fotos: el equipo del catálogo podrá verlas para validar el nombre.',
  pendingPhotoNotice: (count: number) =>
    count === 1
      ? 'Como el nombre queda por validar, el equipo del catálogo podrá ver esta foto para identificarla.'
      : 'Como el nombre queda por validar, el equipo del catálogo podrá ver estas fotos para identificarla.',
  pendingPhotoMore: 'Más en',
  privacyLink: 'Privacidad',
  photosTitle: 'Fotos',
  photoInBloom: 'La foto principal es en floración',
  photosPreparing: 'Preparando las fotos…',
  /** Estado de una foto cuya subida se canceló o falló. */
  photoCancelled: 'Cancelada',
  photoNotUploaded: 'No se subió',
  /** Anuncio al elegir fotos (role="status"). */
  photosAdding: (count: number) =>
    count === 1 ? 'Preparando la foto…' : `Preparando ${photoCount(count)}…`,
  /** Algunas no cabían: se añadieron las que caben (#221). */
  photosLeftOut: (accepted: number, leftOut: number, max: number) =>
    `${accepted === 0 ? 'No se añadió ninguna' : `Se ${accepted === 1 ? 'añadió' : 'añadieron'} ${photoCount(accepted)}`}; ${leftOut === 1 ? '1 quedó fuera' : `${String(leftOut)} quedaron fuera`}: el máximo es ${String(max)}.`,
  photoAdded: (count: number, max: number) =>
    `Foto añadida: ${String(count)} de ${String(max)}.`,
  photoRemoved: (count: number, max: number, wasMain: boolean) =>
    `Foto quitada: quedan ${String(count)} de ${String(max)}.${wasMain && count > 0 ? ' La siguiente pasa a ser la principal.' : ''}`,
  photoPrepareFailed: (fileName: string, message: string) =>
    `No se pudo preparar «${fileName}». ${message}`,
  /** Lo que ya quedó guardado antes de subir las fotos. */
  savedPrefix: 'Tu orquídea quedó registrada',
  photosUploading: (prefix: string, done: number, total: number) =>
    `${prefix}. Subiendo las fotos… (${String(done)} de ${String(total)})`,
  photosUploadingButton: 'Subiendo las fotos…',
  photosFailed: (prefix: string, labels: readonly string[]) =>
    labels.length === 1
      ? `${prefix}, pero no se pudo subir ${photoList(labels)}.`
      : `${prefix}, pero no se pudieron subir ${photoCount(labels.length)}: ${photoList(labels)}.`,
  photosCancelled: (prefix: string) =>
    `${prefix}, pero se canceló la subida de las fotos.`,
  photosRetryHint:
    'Puedes reintentar solo las que fallaron (las demás ya están guardadas) o continuar sin ellas.',
  photosRetry: 'Reintentar fotos',
  photosUploadCancel: 'Cancelar subida',
  photosContinueWithout: 'Continuar sin ellas',
  photosContinue: 'Continuar',
  freeNameAction: (name: string) => `No la encuentro: guardarla como «${name}»`,
  /** Aviso de duplicado (#88), antes y después del nombre científico. */
  duplicateBefore: (count: number) =>
    `Ya tienes ${String(count)} ${count === 1 ? 'ejemplar' : 'ejemplares'} de `,
  duplicateAfter: '. Puedes registrar otro igualmente.',
  genusLabel: 'Género',
  otherGenus: 'Otro',
  otherGenusSearchLabel: 'Buscar otro género',
  otherGenusHint: 'Por nombre o abreviatura, como «Phal.».',
  quickGeneraLoading: 'Cargando géneros…',
  quickGeneraError:
    'No se pudieron cargar los géneros frecuentes. Puedes buscarlo con «Otro».',
  quickGeneraOffline:
    'Sin conexión: no se pudieron cargar los géneros frecuentes.',
  quickGeneraRetry: 'Volver a cargar los géneros',
  typeLabel: 'Tipo',
  lockedHint: 'Lo marca la especie elegida. Para cambiarlo, cambia el nombre.',
  dateLabel: 'Fecha de adquisición',
  originLabel: 'Origen',
  originHint: 'Tienda, vivero, intercambio… Opcional.',
  detailsTitle: 'Más detalles',
  optional: '(opcional)',
  locationLabel: 'Ubicación',
  locationHint: 'Dónde está en casa, como «Ventana de la sala». Opcional.',
  nicknameLabel: 'Apodo',
  nicknameHint: 'Un nombre o etiqueta tuya. Opcional.',
  flowerColorLabel: 'Color de la flor',
  draftRestored: 'Recuperamos lo que estabas escribiendo.',
  draftDiscard: 'Descartar borrador',
  /**
   * Otro borrador guardado mientras se registra uno (#296): «Tu borrador de
   * Cattleya maxima (2 fotos) sigue guardado.», con «Continuar ese borrador».
   */
  otherDraftBefore: 'Tu borrador de ',
  otherDraftAfter: ' sigue guardado.',
  otherDraftContinue: 'Continuar ese borrador',
  /** Un borrador sin nombre (solo fotos u otros datos). */
  draftUnnamed: 'sin nombre',
  /** « (2 fotos)» tras el nombre de un borrador; nada sin fotos. */
  draftPhotos: (count: number) =>
    count === 0 ? '' : ` (${photoCount(count)})`,
  /**
   * Elegir entre un borrador y lo que llega de la ficha del catálogo o de
   * «¿Ya la tengo?» (#296).
   */
  choiceTitle: '¿Qué quieres registrar?',
  choiceOneBefore: 'Tienes un borrador guardado de ',
  choiceOneMiddle: '. Puedes continuarlo o registrar ',
  choiceOneAfter: '; el borrador se conserva hasta que lo descartes.',
  choiceFullBefore: 'Tienes dos borradores guardados. Para registrar ',
  choiceFullAfter: ', continúa uno o descarta uno de ellos.',
  choiceContinue: 'Continuar borrador',
  choiceRegister: (name: string) => `Registrar ${name}`,
  choiceRegisterHint: 'Tu borrador queda guardado para retomarlo después.',
  choiceRegisterFull:
    'Ya tienes dos borradores guardados: descarta uno para empezar otro.',
  choiceDiscard: (name: string) => `Descartar el borrador de ${name}`,
  /** Anuncio al descartar un borrador desde la elección. */
  choiceDiscarded: (name: string) => `Borrador de ${name} descartado.`,
  submit: 'Registrar orquídea',
  submitting: 'Registrando…',
  cancel: 'Cancelar',
  retry: 'Reintentar',
  signIn: 'Iniciar sesión',
  confirmDiscard:
    '¿Salir sin registrar? Se perderá lo que escribiste en el formulario.',
  /** Sin una sesión identificada en el dispositivo: no hay borrador posible. */
  offline:
    'Sin conexión. Registrar una orquídea necesita conexión: el formulario se activará solo cuando vuelva.',
  /**
   * Sin conexión (o con la sesión sin confirmar) y con la sesión identificada
   * en el dispositivo (#296): se sigue completando el borrador y el envío
   * espera. Empieza con offlineTitle o unverifiedTitle.
   */
  offlineTitle: 'Sin conexión.',
  unverifiedTitle: 'Sesión sin confirmar.',
  draftSavedHere: (when: string) =>
    `Borrador guardado en este dispositivo. Podrás registrarla cuando ${when}.`,
  draftWillSaveHere: (when: string) =>
    `Lo que completes se guarda en este dispositivo. Podrás registrarla cuando ${when}.`,
  draftNotSavedHere: (when: string) =>
    `No pudimos guardar el borrador en este dispositivo: no cierres esta pantalla. Podrás registrarla cuando ${when}.`,
  whenOnline: 'vuelva la conexión',
  whenVerified: 'se confirme tu sesión',
  /** Bajo el nombre, sin conexión (#296). */
  nameOfflineHint:
    'Sin conexión no podemos buscar en el catálogo; al volver se comprobará el nombre.',
} as const

/**
 * Fotos que quedaron por subir al registrar una planta (#284): el aviso al
 * salir del registro con fotos sin subir, «Fotos pendientes de subir» en la
 * ficha y el aviso del registro que lleva a ella.
 */
export const PENDING_UPLOAD_TEXT = {
  leaveTitle: '¿Salir con fotos sin subir?',
  leaveKept:
    'Tu orquídea ya quedó registrada. Las fotos que faltan se quedan en este dispositivo y podrás subirlas al abrir la planta.',
  leaveLost:
    'Tu orquídea ya quedó registrada, pero no pudimos guardar en este dispositivo las fotos que faltan: si sales, se perderán.',
  leaveConfirm: 'Salir sin subirlas',
  leaveStay: 'Seguir aquí',

  title: 'Fotos pendientes de subir',
  description: (count: number) =>
    count === 1
      ? 'Al registrar esta planta, 1 foto no llegó a subirse. Sigue guardada en este dispositivo.'
      : `Al registrar esta planta, ${String(count)} fotos no llegaron a subirse. Siguen guardadas en este dispositivo.`,
  listLabel: 'Fotos sin subir',
  photoLabel: (index: number, total: number) =>
    `Foto sin subir ${String(index + 1)} de ${String(total)}`,
  /** La planta ya tiene seis: no cabe ninguna. */
  noRoom: (max: number) =>
    `La planta ya tiene ${String(max)} fotos, el máximo. Para subir estas, quita alguna desde «Editar planta» o descártalas.`,
  /** Caben solo algunas. */
  someRoom: (room: number, count: number, max: number) =>
    `Caben ${String(room)} de estas ${String(count)}: el máximo es ${String(max)} por planta. Las demás seguirán aquí.`,
  upload: 'Subir fotos',
  uploadOne: 'Subir foto',
  uploadingButton: 'Subiendo…',
  uploading: (done: number, total: number) =>
    `Subiendo las fotos… (${String(done)} de ${String(total)})`,
  uploadCancel: 'Cancelar subida',
  discard: 'Descartar fotos',
  discardOne: 'Descartar foto',
  discardTitle: '¿Descartar las fotos sin subir?',
  discardDescription:
    'Se borrarán de este dispositivo y no se añadirán a la planta. No se puede deshacer.',
  discardKeep: 'Conservarlas',
  uploaded: (count: number) =>
    count === 1
      ? 'Se subió la foto pendiente.'
      : `Se subieron las ${String(count)} fotos pendientes.`,
  /** Se subieron las que cabían; las demás siguen pendientes. */
  uploadedSome: (count: number) =>
    count === 1 ? 'Se subió 1 foto.' : `Se subieron ${String(count)} fotos.`,
  discarded: 'Descartaste las fotos sin subir.',
  failed: (count: number) =>
    count === 1
      ? 'No se pudo subir 1 foto.'
      : `No se pudieron subir ${String(count)} fotos.`,
  cancelled: 'Se canceló la subida.',
  retryHint:
    'Siguen guardadas en este dispositivo: puedes volver a intentarlo.',
  /** El registro avisa de las de otra planta: «Quedaron 2 fotos sin subir de X.». */
  noticeBefore: (count: number) =>
    count === 1
      ? 'Quedó 1 foto sin subir de '
      : `Quedaron ${String(count)} fotos sin subir de `,
  noticeAfter: '.',
  noticeAction: 'Abrir la planta para subirlas',
} as const

/** Avisos propios de la edición. */
export const PLANT_EDIT_NOTICE_TEXT = {
  /** Al cambiar el nombre de una planta enlazada por uno que no es del catálogo. */
  unlinkBefore: 'Al guardar, la planta dejará de estar enlazada a ',
  unlinkAfter: ' y volverá a «Nombre por validar».',
  /**
   * La edición no guarda borrador: el enlace a Privacidad del aviso de la
   * galería se abre en otra pestaña para no perder los cambios (#210).
   */
  privacyNewTab: '(se abre en otra pestaña)',
} as const

// Etiquetas de los chips de color de flor y de tipo: viven en
// collection/labels.ts, compartidas con el inventario y la exportación.
export { FLOWER_COLOR_LABEL, PLANT_TYPE_LABEL } from '../collection/labels.ts'
