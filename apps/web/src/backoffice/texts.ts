import type {
  PlantType,
  SpeciesNameType,
  SpeciesPhotoRejectionReason,
  SpeciesSource,
  SpeciesStatus,
  SpeciesType,
} from '../lib/database.ts'
import type { CatalogAdminFailure } from '../lib/catalogAdmin.ts'

// Textos del backoffice del catálogo: nombres de los valores de cada
// enumerado, números con su palabra en singular o plural y errores.

export const STATUS_LABEL: Record<SpeciesStatus, string> = {
  imported: 'Importada',
  validated: 'Validada',
  observed: 'Observada',
}

/** En plural, para el resumen. */
export const STATUS_PLURAL_LABEL: Record<SpeciesStatus, string> = {
  imported: 'Importadas',
  validated: 'Validadas',
  observed: 'Observadas',
}

export const TYPE_LABEL: Record<SpeciesType, string> = {
  species: 'Especie',
  hybrid: 'Híbrido',
}

export const SOURCE_LABEL: Record<SpeciesSource, string> = {
  col: 'Catalogue of Life',
  curated: 'Lista curada',
  user_proposal: 'Propuesta de usuario',
  gbif: 'GBIF',
}

export const NAME_TYPE_LABEL: Record<SpeciesNameType, string> = {
  synonym: 'Sinónimo',
  common: 'Nombre común',
}

/** Orden en que se ofrecen los filtros (no el de la base). */
export const STATUS_OPTIONS: readonly SpeciesStatus[] = [
  'imported',
  'validated',
  'observed',
]
export const TYPE_OPTIONS: readonly SpeciesType[] = ['species', 'hybrid']
export const SOURCE_OPTIONS: readonly SpeciesSource[] = [
  'col',
  'curated',
  'user_proposal',
  'gbif',
]

const numberFormat = new Intl.NumberFormat('es')

/** Número con separador de miles, como en el resto de la app en español. */
export function formatCount(value: number): string {
  return numberFormat.format(value)
}

function countText(count: number, singular: string, plural: string): string {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`
}

export function speciesCountText(count: number): string {
  return countText(count, 'especie', 'especies')
}

export function genusCountText(count: number): string {
  return countText(count, 'género', 'géneros')
}

export function plantCountText(count: number): string {
  if (count === 0) return 'Ninguna planta de usuarios la tiene enlazada.'
  return count === 1
    ? '1 planta de usuarios la tiene enlazada.'
    : `${formatCount(count)} plantas de usuarios la tienen enlazada.`
}

// Cola de propuestas ------------------------------------------------------------

/** Tipo de las plantas de una propuesta (el usuario puede no saberlo). */
export const PLANT_TYPE_LABEL: Record<PlantType, string> = {
  species: 'Especie',
  hybrid: 'Híbrido',
  unknown: 'Tipo sin indicar',
}

/** "3 plantas". */
export function proposalPlantCountText(count: number): string {
  return countText(count, 'planta', 'plantas')
}

/** "12 grupos". */
export function proposalGroupCountText(count: number): string {
  return countText(count, 'grupo', 'grupos')
}

/** "Página 3 de 650". */
export function pageText(page: number, pageCount: number): string {
  return `Página ${formatCount(page)} de ${formatCount(pageCount)}`
}

const dateFormat = new Intl.DateTimeFormat('es', {
  dateStyle: 'long',
  timeStyle: 'short',
})

/** Fecha y hora en la zona del navegador, por ejemplo "20 de noviembre de 2026, 14:37". */
export function formatDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : dateFormat.format(date)
}

/** Error sin datos que mostrar: título por motivo (el texto lo da la capa de datos). */
export const LOAD_ERROR_TITLE: Record<
  Exclude<CatalogAdminFailure, 'aborted'>,
  string
> = {
  offline: 'Sin conexión',
  'session-ended': 'Tu sesión terminó',
  forbidden: 'Sin permiso de administrador',
  failed: 'No se pudo consultar el catálogo',
}

// Historial de una especie (auditoría) ---------------------------------------

/** Acciones con sentido propio de la auditoría, en palabras. */
const AUDIT_ACTION_LABEL: Partial<Record<string, string>> = {
  merge_species: 'Fusión de especies',
  validate_plant: 'Validación de una propuesta',
  catalog_import: 'Carga del catálogo',
  link_proposal_group: 'Propuesta de usuarios enlazada',
  create_species_from_proposal: 'Alta desde una propuesta de usuarios',
  mark_proposal_unidentifiable: 'Propuesta marcada como no identificable',
  retire_species_photo: 'Foto de referencia retirada',
}

/** Por qué se retiró una foto de referencia (#234), en palabras. */
export const PHOTO_REJECTION_REASON_LABEL: Record<
  SpeciesPhotoRejectionReason,
  string
> = {
  misidentified: 'Mal identificada',
  inappropriate: 'Inapropiada',
  author_request: 'A petición del autor',
  other: 'Otro motivo',
}

/** Una acción con sentido propio en palabras; una desconocida, con su nombre. */
export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABEL[action] ?? `Acción «${action.replaceAll('_', ' ')}»`
}

type RowAction = 'insert' | 'update' | 'delete'

const GENERIC_ROW_CHANGE_LABEL: Record<RowAction, string> = {
  insert: 'Alta',
  update: 'Edición',
  delete: 'Baja',
}

const ROW_CHANGE_LABEL: Partial<Record<string, Record<RowAction, string>>> = {
  species: GENERIC_ROW_CHANGE_LABEL,
  species_names: {
    insert: 'Nombre añadido',
    update: 'Nombre editado',
    delete: 'Nombre quitado',
  },
}

/** Un cambio de fila en palabras: "Alta", "Nombre añadido"... */
export function rowChangeLabel(table: string, action: RowAction): string {
  return (ROW_CHANGE_LABEL[table] ?? GENERIC_ROW_CHANGE_LABEL)[action]
}

/**
 * Columnas de cada tabla que se muestran en el historial, en orden y con su
 * etiqueta. Las demás (id, fechas, la especie de un nombre) no se muestran.
 */
export const AUDIT_FIELD_LABEL: Partial<
  Record<string, readonly (readonly [string, string])[]>
> = {
  species: [
    ['scientific_name', 'Nombre científico'],
    ['genus_id', 'Género'],
    ['type', 'Tipo'],
    ['status', 'Estado'],
    ['source', 'Fuente'],
    ['source_ref', 'Referencia'],
  ],
  species_names: [
    ['name', 'Nombre'],
    ['type', 'Tipo de nombre'],
    ['language', 'Idioma'],
  ],
}

/**
 * Quién hizo un cambio: un id de usuario de Clerk, abreviado
 * ("user_2Nxb…sW8c"), o "carga" con el identificador de una carga por script.
 */
export function actorText(actor: string): string {
  if (actor.startsWith('user_')) {
    const id = actor.slice('user_'.length)
    return id.length > 10 ? `user_${id.slice(0, 4)}…${id.slice(-4)}` : actor
  }
  return `carga «${actor}»`
}

export function changeCountText(count: number): string {
  return countText(count, 'cambio', 'cambios')
}
