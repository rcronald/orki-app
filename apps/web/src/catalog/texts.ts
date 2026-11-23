import type { SpeciesSource, SpeciesType } from '../lib/database.ts'

// Textos del catálogo público (#232).

const NUMBER = new Intl.NumberFormat('es')

/** 1234 → «1234»; 32464 → «32 464» (separador de miles del español). */
export function formatCount(value: number): string {
  return NUMBER.format(value)
}

/** «1 especie», «120 especies». */
export function speciesCountText(count: number): string {
  return count === 1 ? '1 especie' : `${formatCount(count)} especies`
}

/** «1 género», «755 géneros». */
export function generaCountText(count: number): string {
  return count === 1 ? '1 género' : `${formatCount(count)} géneros`
}

export const SPECIES_TYPE_LABEL: Record<SpeciesType, string> = {
  species: 'Especie',
  hybrid: 'Híbrido',
}

/** Fuente de la especie, para la ficha. */
export const SPECIES_SOURCE_LABEL: Record<SpeciesSource, string> = {
  col: 'Catalogue of Life',
  gbif: 'GBIF',
  curated: 'Lista curada de orqui.app',
  user_proposal: 'Propuesta de un usuario, validada por el administrador',
}

/** "1 ejemplar con ese nombre, pendiente de validar", en plural si son más. */
function unlinkedSpecimens(count: number, allPending: boolean): string {
  const one = count === 1
  const state = allPending
    ? one
      ? 'pendiente de validar'
      : 'pendientes de validar'
    : 'sin validar'
  return `${one ? '1 ejemplar' : `${count} ejemplares`} con ese nombre, ${state}`
}

export const CATALOG_TEXT = {
  title: 'Catálogo',
  lead: 'Busca una orquídea por su nombre científico, un sinónimo o su nombre común, o explóralas por género.',
  searchLabel: 'Buscar en el catálogo',
  searchPlaceholder: 'Nombre científico, sinónimo o nombre común',
  searchHint: 'Escribe al menos 2 letras.',
  searching: 'Buscando…',
  noResults: (query: string) => `No hay especies que coincidan con «${query}».`,
  noResultsHint:
    'Revisa cómo está escrito o prueba con el género, un sinónimo o el nombre común.',
  results: (count: number) =>
    count === 1 ? '1 especie encontrada.' : `${count} especies encontradas.`,
  moreResults: (count: number) =>
    `Se muestran las ${count} primeras coincidencias: escribe más para afinar la búsqueda.`,
  resultsTitle: 'Resultados',
  generaTitle: 'Géneros',
  lettersLabel: 'Géneros por letra',
  otherLetter: 'Otros',
  loadingGenera: 'Cargando los géneros…',
  noGenera: 'El catálogo todavía no tiene géneros.',
  generaOfLetter: (letter: string, count: number) =>
    `${count === 1 ? '1 género' : `${formatCount(count)} géneros`} con ${letter}.`,
  back: 'Volver al catálogo',
  genusSpeciesTitle: 'Especies',
  loadingGenus: 'Cargando las especies del género…',
  genusNotFound: 'Género no encontrado',
  genusNotFoundText:
    'Este género no está en el catálogo o no tiene especies que se puedan consultar.',
  page: (page: number, pageCount: number) => `Página ${page} de ${pageCount}`,
  pagesLabel: 'Páginas',
  previous: 'Anterior',
  next: 'Siguiente',
  loadingSpecies: 'Cargando la ficha…',
  speciesNotFound: 'Especie no encontrada',
  speciesNotFoundText:
    'Esta especie no está en el catálogo o no se puede consultar.',
  classification: 'Clasificación',
  genus: 'Género',
  type: 'Tipo',
  synonyms: 'Sinónimos',
  noSynonyms: 'No tiene sinónimos en el catálogo.',
  synonymsShown: (shown: number, total: number) =>
    `Se muestran ${formatCount(shown)} de sus ${formatCount(total)} sinónimos.`,
  commonNames: 'Nombres comunes',
  noCommonNames: 'No tiene nombres comunes en el catálogo.',
  commonNamesShown: (shown: number, total: number) =>
    `Se muestran ${formatCount(shown)} de sus ${formatCount(total)} nombres comunes.`,
  source: 'Fuente',
  viewInCol: 'Ver el taxón en el Catalogue of Life',
  curatedSource:
    'Los híbridos de vivero salen de una lista curada por el responsable de orqui.app, con los nombres con los que se venden.',
  proposalSource:
    'La propuso una persona al registrar su planta y la validó el administrador del catálogo.',
  credits: 'Créditos y fuentes',
  retry: 'Reintentar',
  failedTitle: 'No se pudo cargar el catálogo',
  failedText: 'Vuelve a intentarlo en unos momentos.',
  offlineTitle: 'Sin conexión',
  offlineText:
    'El catálogo no está guardado en este dispositivo: para buscar y abrir fichas hace falta conexión. Lo que ya abriste en esta visita se sigue viendo.',
  owned: 'La tienes',
  ownedDetail: (count: number) =>
    count === 1
      ? '1 ejemplar en tu colección'
      : `${count} ejemplares en tu colección`,
  viewInCollection: 'Ver en mi colección',
  /**
   * Sin ejemplares enlazados, pero con alguno sin validar con su nombre
   * (#296): puede ser esta especie. «pendiente de validar» si todos están por
   * validar; «sin validar» si alguno es no identificable.
   */
  maybeOwned: 'Podrías tenerla',
  unlinkedDetail: (count: number, allPending: boolean) =>
    `Tienes ${unlinkedSpecimens(count, allPending)}.`,
  unlinkedAlso: (count: number, allPending: boolean) =>
    `Además, tienes ${unlinkedSpecimens(count, allPending)}.`,
  unlinkedHint: 'Compruébalo antes de comprarla o de registrarla otra vez.',
  viewSpecimen: 'Ver el ejemplar',
  viewSpecimens: 'Ver los ejemplares',
  notOwned: 'Aún no la tienes',
  /** Ninguno activo, pero sí perdidos o regalados (como «¿Ya la tengo?»). */
  hadIt: 'No, pero la tuviste',
  checkingCollection: 'Comprobando tu colección…',
  register: 'Registrar esta especie',
  registerOffline:
    'Para registrarla necesitas conexión y la sesión confirmada.',
} as const

const LANGUAGE_NAMES =
  typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['es'], { type: 'language' })
    : null

/** «es» → «español»; una etiqueta que no se reconoce, tal cual. */
export function languageName(tag: string): string {
  try {
    return LANGUAGE_NAMES?.of(tag) ?? tag
  } catch {
    return tag
  }
}
