import type { CollectionErrorReason } from '../collection/source.ts'
import type { PlantStatus } from '../lib/database.ts'

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

/**
 * Contador de cabecera: cuántas se ven. Con búsqueda o filtros que reducen la
 * lista, "N de M", donde M es el total de la colección con el estado elegido
 * (las activas, por defecto).
 */
export function shownCountText(
  shown: number,
  total: number,
  status: PlantStatus,
  narrowed: boolean,
): string {
  return narrowed
    ? `${shown} de ${plantCountText(total, status)}`
    : plantCountText(total, status)
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

export const FILTERS_TEXT = {
  toggle: 'Filtros',
  activeCount: (count: number) =>
    count === 1 ? '1 activo' : `${count} activos`,
  panelLabel: 'Filtros de la colección',
  status: 'Estado',
  genus: 'Género',
  color: 'Color de la flor',
  origin: 'Origen',
  showMore: (count: number) => `Ver ${count} más`,
  showLess: 'Ver menos',
  done: 'Listo',
  clearAll: 'Quitar filtros',
  activeLabel: 'Filtros activos',
  remove: (group: string, label: string) =>
    `Quitar el filtro ${group}: ${label}`,
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
