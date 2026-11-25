// Qué se vuelve a leer tras una escritura del backoffice (#285). Cada lectura
// de la pantalla tiene su revisión (useRemoteData la vuelve a pedir cuando
// cambia, mostrando mientras tanto lo de antes). Una escritura sube las de lo
// que cambia; por defecto, todas.

export type CatalogArea =
  /** El resumen (catalog_summary): especies, sinónimos, nombres comunes… */
  | 'summary'
  /** El número de la pestaña de propuestas. */
  | 'proposals'
  /** La tabla de especies (listado o búsqueda, que también mira los nombres). */
  | 'speciesTable'
  /** El nombre del género del filtro de la tabla. */
  | 'genusFilter'
  /** El detalle de la especie abierta (con sus nombres y su foto). */
  | 'speciesDetail'
  /** Cuántas plantas de usuarios tiene enlazadas la especie abierta. */
  | 'plantCount'
  /** El historial de la especie abierta. */
  | 'history'
  /** La pestaña de géneros (lista y panel). */
  | 'genera'

export type CatalogRevisions = Readonly<Record<CatalogArea, number>>

export const ALL_CATALOG_AREAS: readonly CatalogArea[] = [
  'summary',
  'proposals',
  'speciesTable',
  'genusFilter',
  'speciesDetail',
  'plantCount',
  'history',
  'genera',
]

/**
 * Añadir, cambiar o quitar un sinónimo o un nombre común: cambian los
 * recuentos del resumen y de la fila de la tabla (y lo que encuentra la
 * búsqueda), el detalle y el historial. No cambian las propuestas, el género
 * del filtro, las plantas enlazadas ni los géneros.
 */
export const NAME_CHANGE_AREAS: readonly CatalogArea[] = [
  'summary',
  'speciesTable',
  'speciesDetail',
  'history',
]

export const INITIAL_CATALOG_REVISIONS: CatalogRevisions = {
  summary: 0,
  proposals: 0,
  speciesTable: 0,
  genusFilter: 0,
  speciesDetail: 0,
  plantCount: 0,
  history: 0,
  genera: 0,
}

/** Las revisiones con las de `areas` una más arriba. */
export function bumpRevisions(
  revisions: CatalogRevisions,
  areas: readonly CatalogArea[] = ALL_CATALOG_AREAS,
): CatalogRevisions {
  const next = { ...revisions }
  for (const area of areas) next[area] += 1
  return next
}

/** Una revisión que cambia cuando cambia cualquiera de `areas`. */
export function revisionOf(
  revisions: CatalogRevisions,
  areas: readonly CatalogArea[],
): number {
  return areas.reduce((total, area) => total + revisions[area], 0)
}

/** Lo que se avisa tras una escritura: el mensaje y qué cambió. */
export type CatalogChanged = (
  message: string,
  areas?: readonly CatalogArea[],
) => void
