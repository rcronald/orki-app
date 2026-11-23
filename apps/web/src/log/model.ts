import type { IconName } from '../components/ui/Icon.tsx'
import {
  enumValues,
  type PlantLogEntry,
  type PlantLogEntryType,
} from '../lib/database.ts'

// Registros de la bitácora de una planta (#264, #267) con los nombres de la
// app. La tabla es public.plant_log_entries; ver «Bitácora» en
// supabase/README.md.

/** Un registro de la bitácora. */
export interface LogEntry {
  id: string
  plantId: string
  type: PlantLogEntryType
  title: string
  description: string | null
  /** Rutas en <usuario>/<planta>/log/; las dos o ninguna. */
  photoPath: string | null
  thumbnailPath: string | null
  /** Floración observada: true, false o null (sin indicar). */
  inBloom: boolean | null
  /**
   * Cuándo se guardó, tal como lo devuelve la base (con microsegundos). Es
   * también el cursor de la página siguiente: no se convierte a Date.
   */
  createdAt: string
}

type LogEntryRow = Pick<
  PlantLogEntry,
  | 'id'
  | 'plant_id'
  | 'type'
  | 'title'
  | 'description'
  | 'photo_path'
  | 'thumbnail_path'
  | 'in_bloom'
  | 'created_at'
>

export function toLogEntry(row: LogEntryRow): LogEntry {
  return {
    id: row.id,
    plantId: row.plant_id,
    type: row.type,
    title: row.title,
    description: row.description,
    photoPath: row.photo_path,
    thumbnailPath: row.thumbnail_path,
    inBloom: row.in_bloom,
    createdAt: row.created_at,
  }
}

/** Tipos de actividad en el orden de la base (el de la maqueta). */
export const LOG_ENTRY_TYPES: readonly PlantLogEntryType[] =
  enumValues.plant_log_entry_type

/** Nombre de cada tipo de actividad. */
export const LOG_TYPE_LABEL = {
  watering: 'Riego',
  nutrition: 'Nutrición',
  preventive_maintenance: 'Mantenimiento preventivo',
  preventive_health: 'Sanidad preventiva',
} as const satisfies Record<PlantLogEntryType, string>

/** Icono de cada tipo de actividad, como en la maqueta. */
export const LOG_TYPE_ICON = {
  watering: 'droplets',
  nutrition: 'flask-conical',
  preventive_maintenance: 'scissors',
  preventive_health: 'shield',
} as const satisfies Record<PlantLogEntryType, IconName>

/** Lo más largo que admite la base (char_length, en caracteres). */
export const MAX_LOG_TITLE_LENGTH = 120
export const MAX_LOG_DESCRIPTION_LENGTH = 2000

/** Caracteres como los cuenta la base (puntos de código), sin los espacios de los lados. */
export function logTextLength(text: string): number {
  return [...text.trim()].length
}

/** Lo escrito sin espacios a los lados; null si queda vacío. */
export function normalizeLogText(text: string): string | null {
  const trimmed = text.trim()
  return trimmed === '' ? null : trimmed
}

const DATE_TIME = new Intl.DateTimeFormat('es', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

/**
 * Fecha y hora de un registro en el horario del dispositivo, en formato
 * corto como la maqueta: «23 nov 2026, 7:40». Si no es una fecha válida, se
 * devuelve tal cual.
 */
export function formatLogDateTime(createdAt: string): string {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return createdAt
  // Algunos motores abrevian el mes con punto («nov.»): la maqueta va sin él.
  return DATE_TIME.format(date).replace(/(\p{L})\.(?=\s)/u, '$1')
}
