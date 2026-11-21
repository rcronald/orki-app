import type { CollectionErrorReason } from '../collection/source.ts'

// Textos de la pantalla de inventario: los que llevan número, en singular o
// plural, y los de error según el motivo que da la capa de datos.

export function plantCountText(count: number): string {
  return count === 1 ? '1 orquídea' : `${count} orquídeas`
}

export function genusCountText(count: number): string {
  return count === 1 ? '1 género' : `${count} géneros`
}

/** Cuántas de las orquídeas activas coinciden con la búsqueda. */
export function matchCountText(matches: number, total: number): string {
  if (matches === 0) return 'Ninguna orquídea coincide con la búsqueda.'
  const of = `${matches} de ${plantCountText(total)}`
  return matches === 1 ? `${of} coincide.` : `${of} coinciden.`
}

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
