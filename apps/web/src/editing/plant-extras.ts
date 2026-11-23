import { useEffect, useState } from 'react'
import {
  getSupabase,
  sessionTokenFailure,
  type OrkiSupabaseClient,
} from '../lib/supabase.ts'

// Identificador y notas de la planta (#264) para la edición (#266). La
// colección en memoria aún no los lleva (los añade la ficha, #265); la
// edición los lee aparte, con una consulta pequeña por clave, al abrirse.
//
//   GET /rest/v1/plants?select=code,notes&id=eq.<id>&user_id=eq.<usuario>

/** Tope de las notas (restricción de plants.notes). */
export const PLANT_NOTES_MAX_LENGTH = 2000

export interface PlantExtras {
  /** «CAT-012»: lo pone la base al crear la planta y no cambia. */
  code: string | null
  /** Notas libres; null si no hay. */
  notes: string | null
}

export type PlantExtrasLoad =
  | { status: 'loading' }
  | { status: 'ready'; extras: PlantExtras }
  | { status: 'error' }

/** Lee el identificador y las notas; rechaza si no puede. */
export async function readPlantExtras(
  plantId: string,
  userId: string,
  getClient: () => Promise<OrkiSupabaseClient> = getSupabase,
): Promise<PlantExtras> {
  const client = await getClient()
  const { data, error } = await client
    .from('plants')
    .select('code, notes')
    .eq('id', plantId)
    .eq('user_id', userId)
    .single()
  if (error) {
    throw new Error('No se pudieron leer las notas de la planta.', {
      cause: sessionTokenFailure(error) ?? error,
    })
  }
  return { code: data.code, notes: data.notes }
}

// Estable entre pintados: es dependencia del efecto que lee.
const readDefault = (plantId: string, userId: string) =>
  readPlantExtras(plantId, userId)

/**
 * El identificador y las notas de una planta, leídos al montarse y con
 * «Volver a cargar». Se vuelve a pedir al recuperar la conexión si falló.
 */
export function usePlantExtras(
  plantId: string | null,
  userId: string | null,
  read: (plantId: string, userId: string) => Promise<PlantExtras> = readDefault,
): [PlantExtrasLoad, () => void] {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{
    key: string
    load: PlantExtrasLoad
  } | null>(null)
  const key = plantId && userId ? `${userId}/${plantId}/${String(attempt)}` : ''

  useEffect(() => {
    if (!plantId || !userId) return
    let active = true
    read(plantId, userId).then(
      (extras) => {
        if (active) setResult({ key, load: { status: 'ready', extras } })
      },
      () => {
        if (active) setResult({ key, load: { status: 'error' } })
      },
    )
    return () => {
      active = false
    }
  }, [plantId, userId, read, key])

  const load: PlantExtrasLoad =
    result?.key === key ? result.load : { status: 'loading' }
  const failed = load.status === 'error'
  useEffect(() => {
    if (!failed) return
    const retry = () => setAttempt((value) => value + 1)
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [failed])

  return [load, () => setAttempt((value) => value + 1)]
}
