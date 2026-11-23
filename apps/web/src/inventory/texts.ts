import type { PlantSort } from '../collection/selectors.ts'
import type { CollectionErrorReason } from '../collection/source.ts'
import type { PlantStatus, PlantValidation } from '../lib/database.ts'

// Textos de la pantalla de inventario: los que llevan número, en singular o
// plural, y los de error según el motivo que da la capa de datos.

// Calificativo de cada estado tras "orquídea": las activas no lo llevan, como
// en la cabecera de siempre ("12 orquídeas").
const STATUS_SUFFIX: Record<PlantStatus, [singular: string, plural: string]> = {
  active: ['', ''],
  lost: [' perdida', ' perdidas'],
  gifted: [' regalada', ' regaladas'],
}

/** "1 orquídea", "12 orquídeas", "3 orquídeas perdidas". */
export function plantCountText(
  count: number,
  status: PlantStatus = 'active',
): string {
  const [singular, plural] = STATUS_SUFFIX[status]
  return count === 1 ? `1 orquídea${singular}` : `${count} orquídeas${plural}`
}

export function genusCountText(count: number): string {
  return count === 1 ? '1 género' : `${count} géneros`
}

export function specimenCountText(count: number): string {
  return count === 1 ? '1 ejemplar' : `${count} ejemplares`
}

/**
 * Contador de la cabecera de «Mi colección» (#208): ejemplares activos y sus
 * géneros, «18 ejemplares · 5 géneros». No cambia al buscar ni al filtrar:
 * cuántas coinciden lo dice la línea bajo el buscador.
 */
export function collectionSummaryText(plants: number, genera: number): string {
  return `${specimenCountText(plants)} · ${genusCountText(genera)}`
}

/**
 * Lo que se anuncia bajo el buscador al buscar o filtrar: cuántas coinciden
 * del total con el estado elegido.
 */
export function matchCountText(
  matches: number,
  total: number,
  status: PlantStatus = 'active',
  narrowed = true,
): string {
  if (total === 0) return `No tienes orquídeas${STATUS_SUFFIX[status][1]}.`
  if (!narrowed) return `${plantCountText(total, status)}.`
  if (matches === 0)
    return `Ninguna de tus ${plantCountText(total, status)} coincide.`
  const of = `${matches} de ${plantCountText(total, status)}`
  return matches === 1 ? `${of} coincide.` : `${of} coinciden.`
}

/** Estado de la planta en el filtro, en plural. */
export const STATUS_FILTER_LABEL: Record<PlantStatus, string> = {
  active: 'Activas',
  lost: 'Perdidas',
  gifted: 'Regaladas',
}

/** Validación del nombre en los filtros, en plural. */
export const VALIDATION_FILTER_LABEL: Record<PlantValidation, string> = {
  validated: 'Validadas',
  pending: 'Por validar',
  unidentifiable: 'No identificables',
}

/** Acciones de la cabecera de «Mi colección» (#208). */
export const COLLECTION_ACTIONS_TEXT = {
  register: 'Registrar orquídea',
  ownershipCheck: '¿Ya la tengo?',
} as const

/** Buscador único de «Mi colección» (#208). */
export const SEARCH_TEXT = {
  label: 'Buscar en mi colección',
  /**
   * Corto para que quepa entero a 360 px (#292): el de antes, «Nombre,
   * género, apodo u origen», se cortaba. El género, el apodo y el origen se
   * siguen buscando; lo nuevo es el identificador y la ubicación.
   */
  placeholder: 'Nombre, código o ubicación',
  /** El mismo texto que el botón de «sin coincidencias». */
  clear: 'Limpiar la búsqueda',
} as const

/** «Ordenar» de «Mi colección» (#292). */
export const SORT_TEXT = {
  label: 'Ordenar',
  options: {
    newest: 'Más recientes',
    name: 'Nombre (A–Z)',
    acquired: 'Fecha de adquisición',
  } satisfies Record<PlantSort, string>,
} as const

export const FILTERS_TEXT = {
  toggle: 'Filtros',
  activeCount: (count: number) =>
    count === 1 ? '1 activo' : `${count} activos`,
  panelLabel: 'Filtros de la colección',
  status: 'Estado',
  genus: 'Género',
  color: 'Color de la flor',
  origin: 'Origen',
  validation: 'Nombre',
  arrange: 'Organizar',
  grouped: 'Agrupar por género',
  allGenera: 'Todos',
  showMore: (count: number) => `Ver ${count} más`,
  showLess: 'Ver menos',
  done: 'Listo',
  clearAll: 'Quitar filtros',
  activeLabel: 'Filtros activos',
  remove: (group: string, label: string) =>
    `Quitar el filtro ${group}: ${label}`,
} as const

/** Exportación del inventario a CSV (#17). */
export const EXPORT_TEXT = {
  title: 'Exportar tu inventario',
  hint: 'Un archivo CSV con todas tus plantas, también las perdidas y regaladas, sin importar los filtros. Se abre en Excel o Google Sheets.',
  action: 'Exportar a CSV',
  done: (fileName: string, count: number) =>
    `Listo: ${fileName}, con ${count === 1 ? '1 planta' : `${count} plantas`}.`,
  failed: 'No se pudo crear el archivo. Vuelve a intentarlo.',
} as const

/** Error sin datos que mostrar: título y explicación. */
export const LOAD_ERROR_TEXT: Record<
  CollectionErrorReason,
  { title: string; text: string }
> = {
  offline: {
    title: 'Sin conexión',
    text: 'No se pudo cargar tu colección porque no hay conexión. Revisa la señal o el wifi y vuelve a intentarlo.',
  },
  'session-ended': {
    title: 'Tu sesión terminó',
    text: 'Vuelve a iniciar sesión para ver tu colección.',
  },
  failed: {
    title: 'No se pudo cargar tu colección',
    text: 'Algo falló al leerla. Vuelve a intentarlo en un momento.',
  },
}

/** Recarga fallida con datos en pantalla: se siguen viendo los anteriores. */
export const RELOAD_ERROR_TEXT: Record<CollectionErrorReason, string> = {
  offline:
    'Sin conexión: no se pudo actualizar tu colección. Ves la última copia cargada.',
  'session-ended':
    'Tu sesión terminó: no se pudo actualizar tu colección. Ves la última copia cargada.',
  failed: 'No se pudo actualizar tu colección. Ves la última copia cargada.',
}

/** "¿Ya la tengo?" (#19): lo que acompaña a OwnershipAnswer bajo el buscador. */
export const OWNERSHIP_TEXT = {
  /** Solo coincide con errores de tipeo: se responde "Sí" para que juzgue. */
  similar: 'No coincide exactamente: revisa si es la misma.',
  /** La respuesta no tiene en cuenta los filtros de la lista. */
  wholeCollection: 'La respuesta es sobre toda tu colección, sin los filtros.',
  matchesLabel: 'Ejemplares que coinciden',
  pastLabel: 'Ejemplares que tuviste',
  more: (count: number) => (count === 1 ? 'Y 1 más.' : `Y ${count} más.`),
  /** Por qué nombre coincidió, si no es el que se muestra. */
  matchedBy: {
    entered: (name: string) => `Por el nombre ingresado: ${name}`,
    synonym: (name: string) => `Sinónimo: ${name}`,
    common: (name: string) => `Nombre común: ${name}`,
  },
  register: 'Registrarla con este nombre',
  registerAnyway: 'No es la misma: registrarla',
} as const

const PAST_STATUS: Record<
  'lost' | 'gifted',
  [singular: string, plural: string]
> = {
  lost: ['perdido', 'perdidos'],
  gifted: ['regalado', 'regalados'],
}

function specimens(count: number, status: 'lost' | 'gifted'): string {
  const [singular, plural] = PAST_STATUS[status]
  return count === 1
    ? `1 ejemplar ${singular}`
    : `${count} ejemplares ${plural}`
}

/**
 * Nota aparte de los ejemplares dados de baja que coinciden: "La tuviste: 1
 * ejemplar perdido." si no tiene ninguno activo; "Además, tuviste…" si sí.
 * Null si no hay ninguno.
 */
export function pastSpecimensText(
  lost: number,
  gifted: number,
  ownedNow: boolean,
): string | null {
  const parts = [
    lost > 0 ? specimens(lost, 'lost') : null,
    gifted > 0 ? specimens(gifted, 'gifted') : null,
  ].filter((part): part is string => part !== null)
  if (parts.length === 0) return null
  const list = parts.join(' y ')
  return ownedNow ? `Además, tuviste ${list}.` : `La tuviste: ${list}.`
}

/** Varios nombres en una frase: "A", "A y B", "A, B y C". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
}
