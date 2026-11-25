import { offlineOr } from '../lib/connection.ts'
import {
  COLLECTION_PLANT_SELECT,
  toCollectionPlant,
  withMainPhotoOnly,
  type CollectionPlant,
} from '../collection/model.ts'
import { getSupabase, type OrkiSupabaseClient } from '../lib/supabase.ts'
import {
  PLANT_UPDATE_ERROR_TEXT,
  PlantSaveError,
  toPlantSaveError,
} from '../registration/save-plant.ts'

// Notas de la planta en la ficha (#265): plants.notes (#264), texto libre de
// hasta 2000 caracteres, con sus saltos de línea. La base rechaza unas notas
// en blanco (plants_notes_valid): «sin notas» es null.

/** Lo más largo que admite la base (char_length, en caracteres). */
export const MAX_PLANT_NOTES_LENGTH = 2000

/** Lo escrito, sin espacios ni saltos al principio y al final; null si queda vacío. */
export function normalizePlantNotes(text: string): string | null {
  const trimmed = text.trim()
  return trimmed === '' ? null : trimmed
}

/** Caracteres como los cuenta la base (puntos de código, no UTF-16). */
export function plantNotesLength(text: string): number {
  return [...text.trim()].length
}

interface UpdatePlantNotesOptions {
  /** Cliente de Supabase; por defecto, el compartido de la app. */
  getClient?: () => Promise<OrkiSupabaseClient>
}

/**
 * Guarda las notas y devuelve la planta releída, como updatePlant() del
 * registro (mismos errores, PlantSaveError con los textos de la edición):
 *
 *   PATCH /rest/v1/plants?id=eq.<id>&user_id=eq.<usuario>&select=<COLLECTION_PLANT_SELECT>
 *   { notes: "…" | null }
 *
 * Va aparte para no tocar el formulario de edición (#266), que añade las
 * notas a sus propios campos.
 */
export async function updatePlantNotes(
  plantId: string,
  userId: string,
  notes: string | null,
  { getClient = getSupabase }: UpdatePlantNotesOptions = {},
): Promise<CollectionPlant> {
  let supabase: OrkiSupabaseClient
  try {
    supabase = await getClient()
  } catch (error) {
    const reason = offlineOr('failed')
    throw new PlantSaveError(reason, {
      cause: error,
      message: PLANT_UPDATE_ERROR_TEXT[reason],
    })
  }
  const { data, error, status } = await withMainPhotoOnly(
    supabase
      .from('plants')
      .update({ notes })
      .eq('id', plantId)
      .eq('user_id', userId)
      .select(COLLECTION_PLANT_SELECT),
  ).single()
  if (error) throw toPlantSaveError(error, status, PLANT_UPDATE_ERROR_TEXT)
  return toCollectionPlant(data)
}
