import type {
  SpeciesSource,
  SpeciesStatus,
  SpeciesType,
} from '../lib/database.ts'
import type {
  CatalogListCursor,
  CatalogSpeciesFilters,
} from '../lib/catalogAdmin.ts'
import { SOURCE_OPTIONS, STATUS_OPTIONS, TYPE_OPTIONS } from './texts.ts'

// Estado de la pantalla del catálogo, guardado en la URL para que recargar o
// compartir el enlace muestre lo mismo:
//
//   /administracion/catalogo?pestana=generos
//     &q=phal&estado=validated&genero=<id>&tipo=hybrid&fuente=col
//     &pagina=3&desde=<id> | &antes=<id> | &ultima=1
//     &especie=<id>
//     &gq=den&rapido=1&gpagina=2
//
// - pestana: especies (por defecto, no se escribe) o generos.
// - Especies: texto (q), filtros (estado, genero, tipo, fuente) con los
//   valores de la base, página (pagina) y, sin texto, dónde empieza la página
//   del listado alfabético, que se pagina por clave: después de una especie
//   (desde), antes de otra (antes) o la última (ultima). Con texto, la página
//   es solo el número. especie es el detalle abierto.
// - Géneros: texto (gq), solo acceso rápido (rapido) y página (gpagina).
//
// Un valor que no se reconoce (un estado inventado, un id que no es un uuid,
// una página no numérica) se ignora, como si no estuviera.

export type CatalogAdminTab = 'especies' | 'generos'

export interface SpeciesViewState {
  query: string
  filters: CatalogSpeciesFilters
  /** Número de página que se muestra (desde 1). */
  page: number
  /** Sin texto: qué página del listado alfabético. */
  cursor: CatalogListCursor
  /** Especie con el detalle abierto. */
  detailId: string | null
}

export interface GeneraViewState {
  query: string
  quickAccessOnly: boolean
  page: number
}

export interface CatalogAdminState {
  tab: CatalogAdminTab
  species: SpeciesViewState
  genera: GeneraViewState
}

export const INITIAL_CATALOG_ADMIN_STATE: CatalogAdminState = {
  tab: 'especies',
  species: {
    query: '',
    filters: {},
    page: 1,
    cursor: { kind: 'first' },
    detailId: null,
  },
  genera: { query: '', quickAccessOnly: false, page: 1 },
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function uuidParam(params: URLSearchParams, name: string): string | null {
  const value = params.get(name)
  return value !== null && UUID.test(value) ? value.toLowerCase() : null
}

function pageParam(params: URLSearchParams, name: string): number {
  const value = Number(params.get(name))
  return Number.isInteger(value) && value >= 1 ? value : 1
}

function oneOf<T extends string>(
  value: string | null,
  options: readonly T[],
): T | undefined {
  return options.find((option) => option === value)
}

export function parseCatalogAdminState(
  params: URLSearchParams,
): CatalogAdminState {
  const after = uuidParam(params, 'desde')
  const before = uuidParam(params, 'antes')
  const cursor: CatalogListCursor = after
    ? { kind: 'after', id: after }
    : before
      ? { kind: 'before', id: before }
      : params.get('ultima') === '1'
        ? { kind: 'last' }
        : { kind: 'first' }
  const filters: CatalogSpeciesFilters = {}
  const status = oneOf<SpeciesStatus>(params.get('estado'), STATUS_OPTIONS)
  if (status) filters.status = status
  const genusId = uuidParam(params, 'genero')
  if (genusId) filters.genusId = genusId
  const type = oneOf<SpeciesType>(params.get('tipo'), TYPE_OPTIONS)
  if (type) filters.type = type
  const source = oneOf<SpeciesSource>(params.get('fuente'), SOURCE_OPTIONS)
  if (source) filters.source = source

  return {
    tab: params.get('pestana') === 'generos' ? 'generos' : 'especies',
    species: {
      query: params.get('q') ?? '',
      filters,
      page:
        cursor.kind === 'first' && !params.get('q')
          ? 1
          : pageParam(params, 'pagina'),
      cursor,
      detailId: uuidParam(params, 'especie'),
    },
    genera: {
      query: params.get('gq') ?? '',
      quickAccessOnly: params.get('rapido') === '1',
      page: pageParam(params, 'gpagina'),
    },
  }
}

/** Parámetros de la URL para un estado; los valores por defecto no se escriben. */
export function catalogAdminSearchParams(
  state: CatalogAdminState,
): URLSearchParams {
  const params = new URLSearchParams()
  if (state.tab !== 'especies') params.set('pestana', state.tab)

  const { species, genera } = state
  if (species.query !== '') params.set('q', species.query)
  if (species.filters.status) params.set('estado', species.filters.status)
  if (species.filters.genusId) params.set('genero', species.filters.genusId)
  if (species.filters.type) params.set('tipo', species.filters.type)
  if (species.filters.source) params.set('fuente', species.filters.source)
  if (species.page > 1) params.set('pagina', String(species.page))
  if (species.cursor.kind === 'after') params.set('desde', species.cursor.id)
  if (species.cursor.kind === 'before') params.set('antes', species.cursor.id)
  if (species.cursor.kind === 'last') params.set('ultima', '1')
  if (species.detailId) params.set('especie', species.detailId)

  if (genera.query !== '') params.set('gq', genera.query)
  if (genera.quickAccessOnly) params.set('rapido', '1')
  if (genera.page > 1) params.set('gpagina', String(genera.page))
  return params
}

/** Hay algún filtro o texto en la tabla de especies. */
export function hasSpeciesCriteria(species: SpeciesViewState): boolean {
  return (
    species.query.trim() !== '' ||
    Object.values(species.filters).some((value) => value !== undefined)
  )
}

/** La tabla de especies en su primera página, con otro texto o filtros. */
export function withSpeciesCriteria(
  species: SpeciesViewState,
  changes: Partial<Pick<SpeciesViewState, 'query' | 'filters'>>,
): SpeciesViewState {
  return {
    ...species,
    ...changes,
    page: 1,
    cursor: { kind: 'first' },
  }
}
