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
} as const

export const PLANT_FORM_TEXT = {
  title: 'Registrar una orquídea',
  nameLabel: 'Nombre',
  nameHint: 'Busca por nombre científico, sinónimo o nombre común.',
  nameLinkedHint: 'Especie del catálogo.',
  namePendingHint:
    'Sin especie del catálogo: se guardará con este nombre, por validar.',
  freeNameAction: (name: string) => `No la encuentro: guardarla como «${name}»`,
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

/** Etiquetas de los chips de tipo (enumerado plant_type). */
export const PLANT_TYPE_LABEL = {
  species: 'Especie',
  hybrid: 'Híbrido',
  unknown: 'No sé',
} as const
