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

export const PLANT_FORM_TEXT = {
  title: 'Registrar una orquídea',
  nameLabel: 'Nombre',
  nameHint: 'Busca por nombre científico, sinónimo o nombre común.',
  nameLinkedHint: 'Especie del catálogo.',
  /** Qué pasará con un nombre que no está en el catálogo (#12). */
  namePendingHint:
    'No está en el catálogo: quedará en tu inventario como «Nombre por validar» y un administrador confirmará el nombre.',
  /**
   * Recomendación de foto para un nombre por validar (#12). La muestra el
   * campo de foto (#87), sin exigirla.
   */
  pendingPhotoHint:
    'Te recomendamos añadir una foto: ayuda al administrador a confirmar el nombre.',
  photoLabel: 'Foto',
  photoHint: 'Opcional.',
  /** Ayuda del campo de foto al entrar desde la cámara (?foto=1). */
  photoFirstHint: 'Empieza por la foto; después completa los datos.',
  photoInBloom: 'La foto es en floración',
  photoPreparing: 'Preparando la foto…',
  photoUploading: 'Tu orquídea quedó registrada. Subiendo la foto…',
  photoUploadProgress: (done: number, total: number) =>
    `Tu orquídea quedó registrada. Subiendo la foto… (${String(done)} de ${String(total)} archivos)`,
  photoUploadingButton: 'Subiendo la foto…',
  photoUploadFailed:
    'Tu orquídea quedó registrada, pero no se pudo subir la foto.',
  photoUploadCancelled:
    'Tu orquídea quedó registrada, pero sin foto: se canceló la subida.',
  photoUploadRetryHint:
    'Puedes volver a intentarlo con la misma foto o continuar sin ella.',
  photoUploadRetry: 'Reintentar subida',
  photoUploadCancel: 'Cancelar subida',
  photoContinueWithout: 'Continuar sin foto',
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

// Etiquetas de los chips de color de flor y de tipo: viven en
// collection/labels.ts, compartidas con el inventario y la exportación.
export { FLOWER_COLOR_LABEL, PLANT_TYPE_LABEL } from '../collection/labels.ts'
