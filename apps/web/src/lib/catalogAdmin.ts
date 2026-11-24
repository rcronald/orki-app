import type {
  Database,
  Json,
  SpeciesHistoryRow,
  SpeciesMatchType,
  SpeciesNameType,
  SpeciesSource,
  SpeciesStatus,
  SpeciesType,
  PlantType,
} from './database.ts'
import { prepareSearchQuery } from './catalogSearch.ts'
import {
  publicPhotoUrl,
  toReferencePicture,
  type ReferencePicture,
} from './referencePhotos.ts'
import { getSupabase, sessionTokenFailure } from './supabase.ts'
import type { OrkiSupabaseClient } from './supabase.ts'

// Lectura del catálogo para el backoffice (issue #99).
//
// Llama a las funciones de la API de la migración
// 20261121100000_listado_del_catalogo_para_el_backoffice.sql (ver
// supabase/README.md, "Listado del catálogo para el backoffice") y lee el
// detalle de una especie de las tablas, que son de lectura pública:
//
// - listCatalogSpecies: el catálogo en orden alfabético, por páginas de clave
//   (después de una especie, antes de otra o la última).
// - searchCatalogSpecies: con texto, por relevancia, por número de página.
// - listCatalogGenera, getCatalogSummary, getSpeciesDetail,
//   countSpeciesPlants y getGenus.
// - getSpeciesHistory: el historial de una especie, de la auditoría (#133,
//   migración 20261121150000_historial_de_especie.sql), por páginas de clave.
// - listProposalGroups y countProposalGroups: la cola de propuestas (#139,
//   migración 20261121180000_cola_de_propuestas.sql), por número de página.
//
// Todas aceptan un AbortSignal y fallan con CatalogAdminError, que dice el
// motivo. Las funciones de listado solo las puede llamar un administrador del
// catálogo: la base responde 42501 a cualquier otro ("forbidden").

/** Filas por página de la tabla. La base admite hasta 100. */
export const CATALOG_PAGE_SIZE = 50

// Tipos ----------------------------------------------------------------------------

type Functions = Database['public']['Functions']
type ListRow = Functions['list_catalog_species']['Returns'][number]
type SearchRow = Functions['search_catalog_species']['Returns'][number]
type GenusRow = Functions['list_catalog_genera']['Returns'][number]
type SummaryRow = Functions['catalog_summary']['Returns'][number]
type HistoryRow = SpeciesHistoryRow

/** Filtros de la tabla de especies; cada uno es opcional. */
export interface CatalogSpeciesFilters {
  status?: SpeciesStatus
  genusId?: string
  type?: SpeciesType
  source?: SpeciesSource
}

/** Una fila de la tabla de especies. */
export interface CatalogSpeciesRow {
  id: ListRow['id']
  scientificName: ListRow['scientific_name']
  genusId: ListRow['genus_id']
  genusName: ListRow['genus_name']
  type: SpeciesType
  status: SpeciesStatus
  source: SpeciesSource
  /**
   * Referencia en la fuente (la clave de COL, por ejemplo), o null. Los tipos
   * generados no saben que las columnas de una función que devuelve una tabla
   * pueden ser nulas, así que se declara aquí.
   */
  sourceRef: ListRow['source_ref'] | null
  synonymCount: number
  commonNameCount: number
  createdAt: string
  updatedAt: string
  /** Con búsqueda: el nombre por el que coincidió y su tipo. */
  matchedName?: SearchRow['matched_name']
  matchedNameType?: SpeciesMatchType
}

/** Una página del listado alfabético. */
export interface CatalogSpeciesListPage {
  rows: CatalogSpeciesRow[]
  /** Especies que cumplen los filtros (0 si no hay ninguna). */
  total: number
  hasPrevious: boolean
  hasNext: boolean
}

/** Una página de la búsqueda o de los géneros, por número. */
export interface NumberedPage<T> {
  rows: T[]
  total: number
  /** Página devuelta: la pedida o, si no existe, la última. */
  page: number
}

/**
 * Qué página del listado alfabético se pide: la primera, la que va después de
 * una especie (la última de la página actual), la que va antes de otra (la
 * primera de la página actual) o la última.
 */
export type CatalogListCursor =
  | { kind: 'first' }
  | { kind: 'after'; id: string }
  | { kind: 'before'; id: string }
  | { kind: 'last' }

export interface CatalogGenusRow {
  id: GenusRow['id']
  name: GenusRow['name']
  isQuickAccess: GenusRow['is_quick_access']
  abbreviations: GenusRow['abbreviations']
  speciesCount: number
}

export interface CatalogSummary {
  genusCount: number
  speciesCount: number
  hybridCount: number
  synonymCount: number
  commonNameCount: number
  byStatus: Record<SpeciesStatus, number>
  bySource: Record<SpeciesSource, number>
}

/** Un nombre alternativo de una especie. */
export interface CatalogSpeciesName {
  id: string
  name: string
  type: SpeciesNameType
  language: string | null
}

/** Detalle de una especie, leído de las tablas. */
export interface CatalogSpeciesDetail {
  id: string
  scientificName: string
  genusId: string
  genusName: string
  type: SpeciesType
  status: SpeciesStatus
  source: SpeciesSource
  sourceRef: string | null
  createdAt: string
  updatedAt: string
  /** Sinónimos y nombres comunes, en orden alfabético. */
  names: CatalogSpeciesName[]
  /** La foto de referencia (#234), con su crédito, o null si no tiene. */
  referencePhoto: ReferencePicture | null
}

/** Entradas por página del historial de una especie. La base admite hasta 100. */
export const SPECIES_HISTORY_PAGE_SIZE = 20

/** Valores de una fila en la auditoría: columna → valor. */
export type AuditValues = Record<string, Json | undefined>

/** Un cambio de fila de la auditoría: alta, edición o baja. */
export interface AuditRowChange {
  /** species o species_names. */
  table: string
  rowId: string
  action: 'insert' | 'update' | 'delete'
  /** Baja: la fila entera; edición: lo que cambió; alta: null. */
  oldValues: AuditValues | null
  /** Alta: la fila entera; edición: lo que cambió; baja: null. */
  newValues: AuditValues | null
}

/** Una entrada del historial: todo lo que hizo una acción sobre la especie. */
export interface SpeciesHistoryEntry {
  /** Clave de la entrada (para pedir la página siguiente). */
  id: number
  actionId: string
  /** Id de usuario de Clerk o identificador de una carga por script. */
  actor: string
  /** Acción con sentido propio (merge_species...), o null si son solo cambios de fila. */
  action: HistoryRow['action'] | null
  details: AuditValues | null
  createdAt: string
  /** Cambios de la especie y de sus nombres, en orden. */
  changes: AuditRowChange[]
  /** Cambios de la misma acción en otras filas del catálogo. */
  otherChangeCount: number
  /** Nombre de cada género que aparece en los cambios, por id. */
  genusNames: Record<string, string>
}

export interface SpeciesHistoryPage {
  entries: SpeciesHistoryEntry[]
  /** Si hay entradas más antiguas que pedir. */
  hasMore: boolean
}

export interface RequestOptions {
  /** Cancela la petición; la promesa se rechaza con CatalogAdminError('aborted'). */
  signal?: AbortSignal
}

// Errores ----------------------------------------------------------------------

/**
 * Por qué falló una lectura:
 * - aborted: se canceló (no es un fallo que mostrar).
 * - offline: sin conexión.
 * - session-ended: la sesión terminó o Supabase no acepta el token.
 * - forbidden: la base dice que quien llama no es administrador del catálogo.
 * - failed: cualquier otro fallo del servidor o de la red.
 */
export type CatalogAdminFailure =
  'aborted' | 'offline' | 'session-ended' | 'forbidden' | 'failed'

export const CATALOG_ADMIN_ERROR_TEXT: Record<CatalogAdminFailure, string> = {
  aborted: 'Consulta cancelada.',
  offline:
    'Sin conexión: no se pudo consultar el catálogo. Revisa la señal o el wifi y vuelve a intentarlo.',
  'session-ended':
    'Tu sesión terminó. Vuelve a iniciar sesión para consultar el catálogo.',
  forbidden:
    'Tu cuenta no tiene permiso de administrador del catálogo. Si acabas de recibirlo, cierra la sesión y vuelve a entrar.',
  failed:
    'No se pudo consultar el catálogo. Vuelve a intentarlo en unos momentos.',
}

export class CatalogAdminError extends Error {
  readonly reason: CatalogAdminFailure

  constructor(reason: CatalogAdminFailure, options?: { cause?: unknown }) {
    super(CATALOG_ADMIN_ERROR_TEXT[reason], options)
    this.name = 'CatalogAdminError'
    this.reason = reason
  }
}

/** Motivo de un error; cualquier error que no sea CatalogAdminError es 'failed'. */
export function catalogAdminFailure(error: unknown): CatalogAdminFailure {
  return error instanceof CatalogAdminError ? error.reason : 'failed'
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new CatalogAdminError('aborted')
}

/**
 * Clasifica el `error` de postgrest-js: cancelada, sin token de sesión, sin
 * respuesta (estado 0), token rechazado (401), sin permiso (código 42501 de
 * Postgres) o fallo. También la usan las escrituras (catalogWrites.ts).
 */
export function toAdminError(
  error: unknown,
  status: number,
  signal: AbortSignal | undefined,
): CatalogAdminError {
  if (signal?.aborted) return new CatalogAdminError('aborted', { cause: error })
  const tokenFailure = sessionTokenFailure(error)
  if (tokenFailure === 'offline' || tokenFailure === 'session-ended') {
    return new CatalogAdminError(tokenFailure, { cause: error })
  }
  if (status === 0) {
    return new CatalogAdminError(isOffline() ? 'offline' : 'failed', {
      cause: error,
    })
  }
  if (status === 401) {
    return new CatalogAdminError('session-ended', { cause: error })
  }
  const code = (error as { code?: unknown } | null)?.code
  if (code === '42501') {
    return new CatalogAdminError('forbidden', { cause: error })
  }
  return new CatalogAdminError('failed', { cause: error })
}

/** El cliente de Supabase, o CatalogAdminError si no se puede cargar. */
export async function loadClient(
  signal: AbortSignal | undefined,
): Promise<OrkiSupabaseClient> {
  throwIfAborted(signal)
  try {
    const supabase = await getSupabase()
    throwIfAborted(signal)
    return supabase
  } catch (error) {
    if (error instanceof CatalogAdminError) throw error
    throwIfAborted(signal)
    throw new CatalogAdminError(isOffline() ? 'offline' : 'failed', {
      cause: error,
    })
  }
}

/** Añade la señal de cancelación a la consulta, si la hay. */
function withSignal<B extends { abortSignal(signal: AbortSignal): B }>(
  builder: B,
  signal: AbortSignal | undefined,
): B {
  return signal ? builder.abortSignal(signal) : builder
}

interface Response<T> {
  data: T | null
  error: unknown
  status: number
}

/** Espera la respuesta y devuelve sus datos, o lanza CatalogAdminError. */
async function settle<T>(
  request: PromiseLike<Response<T>>,
  signal: AbortSignal | undefined,
): Promise<T | null> {
  let response: Response<T>
  try {
    response = await request
  } catch (error) {
    throw toAdminError(error, 0, signal)
  }
  if (response.error) {
    throw toAdminError(response.error, response.status, signal)
  }
  throwIfAborted(signal)
  return response.data
}

// Conversión -------------------------------------------------------------------

function toSpeciesRow(row: ListRow | SearchRow): CatalogSpeciesRow {
  const base: CatalogSpeciesRow = {
    id: row.id,
    scientificName: row.scientific_name,
    genusId: row.genus_id,
    genusName: row.genus_name,
    type: row.type,
    status: row.status,
    source: row.source,
    sourceRef: row.source_ref,
    synonymCount: row.synonym_count,
    commonNameCount: row.common_name_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
  if ('matched_name' in row) {
    base.matchedName = row.matched_name
    base.matchedNameType = row.matched_name_type
  }
  return base
}

function filterArgs(filters: CatalogSpeciesFilters) {
  return {
    ...(filters.status && { filter_status: filters.status }),
    ...(filters.genusId && { filter_genus_id: filters.genusId }),
    ...(filters.type && { filter_type: filters.type }),
    ...(filters.source && { filter_source: filters.source }),
  }
}

// Consultas --------------------------------------------------------------------

export interface ListSpeciesOptions extends RequestOptions {
  filters?: CatalogSpeciesFilters
  cursor?: CatalogListCursor
  pageSize?: number
}

/** Una página del catálogo en orden alfabético, con los filtros y el total. */
export async function listCatalogSpecies({
  filters = {},
  cursor = { kind: 'first' },
  pageSize = CATALOG_PAGE_SIZE,
  signal,
}: ListSpeciesOptions = {}): Promise<CatalogSpeciesListPage> {
  const supabase = await loadClient(signal)
  const request = withSignal(
    supabase.rpc('list_catalog_species', {
      ...filterArgs(filters),
      page_size: pageSize,
      ...(cursor.kind === 'after' && { after_id: cursor.id }),
      ...(cursor.kind === 'before' && { before_id: cursor.id }),
      ...(cursor.kind === 'last' && { last_page: true }),
    }),
    signal,
  )
  const data = (await settle(request, signal)) ?? []
  const first = data[0]
  return {
    rows: data.map(toSpeciesRow),
    total: first?.total_count ?? 0,
    hasPrevious: first?.has_previous ?? false,
    hasNext: first?.has_next ?? false,
  }
}

export interface SearchSpeciesOptions extends RequestOptions {
  filters?: CatalogSpeciesFilters
  page?: number
  pageSize?: number
}

/**
 * Busca en el catálogo con la tolerancia del autocompletado, con filtros, por
 * relevancia y por número de página. Con una consulta fuera de los límites de
 * la base (menos de 2 caracteres o más de 100) devuelve una página vacía sin
 * hacer ninguna petición.
 */
export async function searchCatalogSpecies(
  query: string,
  {
    filters = {},
    page = 1,
    pageSize = CATALOG_PAGE_SIZE,
    signal,
  }: SearchSpeciesOptions = {},
): Promise<NumberedPage<CatalogSpeciesRow>> {
  throwIfAborted(signal)
  const prepared = prepareSearchQuery(query)
  if (prepared === null) return { rows: [], total: 0, page: 1 }
  const supabase = await loadClient(signal)
  const request = withSignal(
    supabase.rpc('search_catalog_species', {
      query: prepared,
      ...filterArgs(filters),
      page_size: pageSize,
      page_number: page,
    }),
    signal,
  )
  const data = (await settle(request, signal)) ?? []
  const first = data[0]
  return {
    rows: data.map(toSpeciesRow),
    total: first?.total_count ?? 0,
    page: first?.current_page ?? 1,
  }
}

export interface ListGeneraOptions extends RequestOptions {
  query?: string
  quickAccessOnly?: boolean
  page?: number
  pageSize?: number
}

/** Una página de géneros con sus abreviaturas y su número de especies. */
export async function listCatalogGenera({
  query = '',
  quickAccessOnly = false,
  page = 1,
  pageSize = CATALOG_PAGE_SIZE,
  signal,
}: ListGeneraOptions = {}): Promise<NumberedPage<CatalogGenusRow>> {
  const supabase = await loadClient(signal)
  const trimmed = query.trim()
  const request = withSignal(
    supabase.rpc('list_catalog_genera', {
      ...(trimmed !== '' && { query: trimmed.slice(0, 100) }),
      quick_access_only: quickAccessOnly,
      page_size: pageSize,
      page_number: page,
    }),
    signal,
  )
  const data = (await settle(request, signal)) ?? []
  const first = data[0]
  return {
    rows: data.map((row) => ({
      id: row.id,
      name: row.name,
      isQuickAccess: row.is_quick_access,
      abbreviations: row.abbreviations,
      speciesCount: row.species_count,
    })),
    total: first?.total_count ?? 0,
    page: first?.current_page ?? 1,
  }
}

function toSummary(row: SummaryRow): CatalogSummary {
  return {
    genusCount: row.genus_count,
    speciesCount: row.species_count,
    hybridCount: row.hybrid_count,
    synonymCount: row.synonym_count,
    commonNameCount: row.common_name_count,
    byStatus: {
      imported: row.imported_count,
      validated: row.validated_count,
      observed: row.observed_count,
    },
    bySource: {
      col: row.col_source_count,
      curated: row.curated_source_count,
      user_proposal: row.user_proposal_source_count,
      gbif: row.gbif_source_count,
    },
  }
}

/** Recuentos del catálogo para el resumen. */
export async function getCatalogSummary({
  signal,
}: RequestOptions = {}): Promise<CatalogSummary> {
  const supabase = await loadClient(signal)
  const request = withSignal(supabase.rpc('catalog_summary'), signal)
  const data = await settle(request, signal)
  const row = data?.[0]
  if (!row) throw new CatalogAdminError('failed')
  return toSummary(row)
}

// La foto de referencia (#234) va embebida: PostgREST ve species_photos como
// uno a uno (species_id es única) y devuelve un objeto o null. Mismas columnas
// que SPECIES_PHOTO_SELECT (lib/referencePhotos.ts), escritas aquí para que
// el cliente tipado infiera la forma.
const DETAIL_SELECT =
  'id, scientific_name, genus_id, type, status, source, source_ref, created_at, updated_at, genera(name), species_names(id, name, type, language), species_photos(medium_path, medium_width, medium_height, thumbnail_path, thumbnail_width, thumbnail_height, author_name, license, source, source_url, is_modified)'

/**
 * Detalle de una especie, con sus sinónimos y nombres comunes; null si no
 * existe.
 */
export async function getSpeciesDetail(
  id: string,
  { signal }: RequestOptions = {},
): Promise<CatalogSpeciesDetail | null> {
  const supabase = await loadClient(signal)
  const request = withSignal(
    supabase.from('species').select(DETAIL_SELECT).eq('id', id),
    signal,
  ).maybeSingle()
  const row = await settle(request, signal)
  if (!row) return null
  const collator = new Intl.Collator('es')
  return {
    id: row.id,
    scientificName: row.scientific_name,
    genusId: row.genus_id,
    genusName: row.genera.name,
    type: row.type,
    status: row.status,
    source: row.source,
    sourceRef: row.source_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    names: row.species_names
      .map((name) => ({
        id: name.id,
        name: name.name,
        type: name.type,
        language: name.language,
      }))
      .sort((a, b) => collator.compare(a.name, b.name)),
    referencePhoto: toReferencePicture(
      row.species_photos,
      publicPhotoUrl(supabase),
    ),
  }
}

/**
 * Cuántas plantas de usuarios tienen enlazada la especie (de cualquier dueño y
 * estado). Solo el número: la función de la base no devuelve nada más.
 */
export async function countSpeciesPlants(
  id: string,
  { signal }: RequestOptions = {},
): Promise<number> {
  const supabase = await loadClient(signal)
  const request = withSignal(
    supabase.rpc('count_species_plants', { target_species_id: id }),
    signal,
  )
  const data = await settle(request, signal)
  return data ?? 0
}

/** Detalle de un género para editarlo: sus abreviaturas (con id) y especies. */
export interface CatalogGenusDetail {
  id: string
  name: string
  isQuickAccess: boolean
  /** En orden alfabético. */
  abbreviations: { id: string; abbreviation: string }[]
  speciesCount: number
}

/**
 * Detalle de un género, leído de las tablas (de lectura pública): nombre,
 * acceso rápido, abreviaturas y número de especies. null si no existe.
 */
export async function getGenusDetail(
  id: string,
  { signal }: RequestOptions = {},
): Promise<CatalogGenusDetail | null> {
  const supabase = await loadClient(signal)
  const genusRequest = withSignal(
    supabase
      .from('genera')
      .select(
        'id, name, is_quick_access, genus_abbreviations(id, abbreviation)',
      )
      .eq('id', id),
    signal,
  ).maybeSingle()
  const countRequest = withSignal(
    supabase
      .from('species')
      .select('id', { count: 'exact', head: true })
      .eq('genus_id', id),
    signal,
  )
  const [row, count] = await Promise.all([
    settle(genusRequest, signal),
    (async () => {
      let response: Awaited<typeof countRequest>
      try {
        response = await countRequest
      } catch (error) {
        throw toAdminError(error, 0, signal)
      }
      if (response.error) {
        throw toAdminError(response.error, response.status, signal)
      }
      return response.count ?? 0
    })(),
  ])
  if (!row) return null
  const collator = new Intl.Collator('es')
  return {
    id: row.id,
    name: row.name,
    isQuickAccess: row.is_quick_access,
    abbreviations: row.genus_abbreviations
      .map((item) => ({ id: item.id, abbreviation: item.abbreviation }))
      .sort((a, b) => collator.compare(a.abbreviation, b.abbreviation)),
    speciesCount: count,
  }
}

/** Nombre de un género por su id (para el filtro de la URL); null si no existe. */
export async function getGenus(
  id: string,
  { signal }: RequestOptions = {},
): Promise<{ id: string; name: string } | null> {
  const supabase = await loadClient(signal)
  const request = withSignal(
    supabase.from('genera').select('id, name').eq('id', id),
    signal,
  ).maybeSingle()
  return settle(request, signal)
}

// Historial ----------------------------------------------------------------------

function asObject(value: Json | undefined): AuditValues | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value
    : null
}

function toChange(value: Json): AuditRowChange | null {
  const item = asObject(value)
  const action = item?.action
  if (
    item === null ||
    typeof item.table_name !== 'string' ||
    typeof item.row_id !== 'string' ||
    (action !== 'insert' && action !== 'update' && action !== 'delete')
  ) {
    return null
  }
  return {
    table: item.table_name,
    rowId: item.row_id,
    action,
    oldValues: asObject(item.old_values),
    newValues: asObject(item.new_values),
  }
}

function toHistoryEntry(row: HistoryRow): SpeciesHistoryEntry {
  const genusNames: Record<string, string> = {}
  for (const [id, name] of Object.entries(asObject(row.genus_names) ?? {})) {
    if (typeof name === 'string') genusNames[id] = name
  }
  return {
    id: row.entry_id,
    actionId: row.action_id,
    actor: row.actor,
    action: row.action,
    details: asObject(row.details),
    createdAt: row.created_at,
    changes: (Array.isArray(row.changes) ? row.changes : [])
      .map(toChange)
      .filter((change): change is AuditRowChange => change !== null),
    otherChangeCount: row.other_change_count,
    genusNames,
  }
}

export interface SpeciesHistoryOptions extends RequestOptions {
  /** Entradas más antiguas que esta (la última de la página anterior). */
  before?: number
  pageSize?: number
}

/**
 * Historial de una especie (sus cambios, los de sus nombres y las acciones
 * que la tienen como objetivo), de lo más reciente a lo más antiguo. Solo
 * para administradores del catálogo.
 */
export async function getSpeciesHistory(
  id: string,
  {
    before,
    pageSize = SPECIES_HISTORY_PAGE_SIZE,
    signal,
  }: SpeciesHistoryOptions = {},
): Promise<SpeciesHistoryPage> {
  const supabase = await loadClient(signal)
  const request = withSignal(
    supabase.rpc('species_history', {
      target_species_id: id,
      page_size: pageSize,
      ...(before !== undefined && { before_entry_id: before }),
    }),
    signal,
  )
  const data = (await settle(request, signal)) ?? []
  return {
    entries: data.map(toHistoryEntry),
    hasMore: data[0]?.has_more ?? false,
  }
}

// Cola de propuestas (#139) -------------------------------------------------------

/** Grupos por página de la cola. La base admite hasta 100. */
export const PROPOSAL_PAGE_SIZE = 20

type ProposalRow = Functions['list_proposal_groups']['Returns'][number]

/**
 * Una foto de una propuesta, como rutas del bucket. Las rutas llevan el id del
 * usuario: solo sirven para pedir la imagen y nunca se muestran ni se
 * registran.
 */
export interface ProposalPhoto {
  photoPath: string
  thumbnailPath: string
}

/** Clave de un grupo: el nombre normalizado y el género. */
export interface ProposalGroupKey {
  nameKey: string
  genusId: string
}

/** Un grupo de la cola: plantas por validar con el mismo nombre y género. */
export interface ProposalGroup extends ProposalGroupKey {
  /** La forma más frecuente del nombre, tal como se escribió. */
  proposedName: string
  genusName: string
  /** El tipo más frecuente de sus plantas. */
  type: PlantType
  plantCount: number
  /**
   * Hasta seis fotos de las plantas del grupo (#184): primero la principal de
   * cada planta, de la más reciente a la más antigua; después la segunda de
   * cada una, y así.
   */
  photos: ProposalPhoto[]
}

/** Clave estable de un grupo, para las listas y los conjuntos. */
export function proposalGroupId(key: ProposalGroupKey): string {
  return `${key.genusId}:${key.nameKey}`
}

function toProposalPhotos(value: Json): ProposalPhoto[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item))
      return []
    const { photo_path: photo, thumbnail_path: thumbnail } = item
    return typeof photo === 'string' && typeof thumbnail === 'string'
      ? [{ photoPath: photo, thumbnailPath: thumbnail }]
      : []
  })
}

function toProposalGroup(row: ProposalRow): ProposalGroup {
  return {
    nameKey: row.name_key,
    genusId: row.genus_id,
    genusName: row.genus_name,
    proposedName: row.proposed_name,
    type: row.type,
    plantCount: row.plant_count,
    photos: toProposalPhotos(row.photos),
  }
}

export interface ListProposalsOptions extends RequestOptions {
  /** Desde 1. */
  page?: number
  pageSize?: number
}

/**
 * Una página de la cola, del grupo con más plantas al que tiene menos. Si la
 * página pedida ya no existe (se resolvieron grupos), devuelve la última.
 * Solo para administradores del catálogo.
 */
export async function listProposalGroups({
  page = 1,
  pageSize = PROPOSAL_PAGE_SIZE,
  signal,
}: ListProposalsOptions = {}): Promise<NumberedPage<ProposalGroup>> {
  const supabase = await loadClient(signal)
  const fetchPage = async (number: number) => {
    const request = withSignal(
      supabase.rpc('list_proposal_groups', {
        page_size: pageSize,
        page_offset: (number - 1) * pageSize,
      }),
      signal,
    )
    return (await settle(request, signal)) ?? []
  }
  const requested = Math.max(1, Math.floor(page))
  let rows = await fetchPage(requested)
  let shown = requested
  if (rows.length === 0 && requested > 1) {
    // Sin filas no se sabe el total: se pide la primera para saberlo.
    const first = await fetchPage(1)
    const total = first[0]?.total_count ?? 0
    const last = Math.max(1, Math.ceil(total / pageSize))
    rows = last === 1 ? first : await fetchPage(last)
    shown = last
  }
  return {
    rows: rows.map(toProposalGroup),
    total: rows[0]?.total_count ?? 0,
    page: shown,
  }
}

/** Cuántos grupos hay en la cola. Solo para administradores del catálogo. */
export async function countProposalGroups({
  signal,
}: RequestOptions = {}): Promise<number> {
  const supabase = await loadClient(signal)
  const request = withSignal(supabase.rpc('count_proposal_groups'), signal)
  return (await settle(request, signal)) ?? 0
}
