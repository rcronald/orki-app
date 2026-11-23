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
  speciesPreview: 'Así es esta especie',
  /** Qué pasará con un nombre que no está en el catálogo (#12). */
  namePendingHint:
    'No está en el catálogo: quedará en tu inventario como «Nombre por validar» y un administrador confirmará el nombre.',
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
  submit: 'Registrar orquídea',
  submitting: 'Registrando…',
  cancel: 'Cancelar',
  retry: 'Reintentar',
  signIn: 'Iniciar sesión',
  confirmDiscard:
    '¿Salir sin registrar? Se perderá lo que escribiste en el formulario.',
  offline:
    'Sin conexión. Registrar una orquídea necesita conexión: el formulario se activará solo cuando vuelva.',
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
