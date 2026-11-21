import type {
  SpeciesNameType,
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
