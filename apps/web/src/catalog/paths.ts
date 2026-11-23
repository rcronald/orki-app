import { PATHS } from '../routes/paths.ts'

// Direcciones del catálogo público (#232). Todas cuelgan de /catalogo y se
// pueden compartir y recargar (Vercel y el service worker responden cualquier
// ruta con index.html):
//
// - /catalogo: el buscador y los géneros. ?q= es lo buscado y ?letra= la
//   letra del índice de géneros (a–z, o «otros» para los que no empiezan por
//   una letra).
// - /catalogo/genero/<id>: las especies de un género; ?pagina= desde la 2.
// - /catalogo/especie/<id>: la ficha de una especie.
//
// Va aparte de routes/paths.ts para no sumar nada al chunk inicial: solo lo
// usa el chunk del catálogo.

export const CATALOG_PARAMS = {
  query: 'q',
  letter: 'letra',
  page: 'pagina',
} as const

/** Subrutas dentro de /catalogo (CatalogRoutes). */
export const CATALOG_ROUTES = {
  genus: 'genero/:genusId',
  species: 'especie/:speciesId',
} as const

/** /catalogo, con la letra del índice si no es la primera. */
export function catalogHomePath(letter?: string | null): string {
  if (!letter) return PATHS.catalog
  return `${PATHS.catalog}?${new URLSearchParams({ [CATALOG_PARAMS.letter]: letter }).toString()}`
}

/** /catalogo/genero/<id>, con ?pagina= desde la 2. */
export function catalogGenusPath(genusId: string, page = 1): string {
  const path = `${PATHS.catalog}/genero/${encodeURIComponent(genusId)}`
  return page > 1 ? `${path}?${CATALOG_PARAMS.page}=${page}` : path
}

/** /catalogo/especie/<id>. */
export function catalogSpeciesPath(speciesId: string): string {
  return `${PATHS.catalog}/especie/${encodeURIComponent(speciesId)}`
}

/** La página de la dirección: un entero de 1 en adelante; si no, 1. */
export function readPage(search: URLSearchParams): number {
  const value = search.get(CATALOG_PARAMS.page)
  if (value === null || !/^\d{1,6}$/.test(value)) return 1
  return Math.max(1, Number(value))
}
