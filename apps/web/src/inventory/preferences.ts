import { useCallback, useState } from 'react'
import { isPlantSort, type PlantSort } from '../collection/selectors.ts'

// Preferencias de la pantalla de inventario, recordadas en este dispositivo
// (localStorage): cómo se ve la colección, si se agrupa por género y en qué
// orden va (#292). No van a la base de datos: en otro celular cada uno elige
// la suya. Tampoco a la dirección, a diferencia de la búsqueda y los
// filtros: no cambian qué plantas se ven, solo cómo.
//
// localStorage puede no existir o fallar (navegación privada de Safari, datos
// del sitio bloqueados, cuota llena): cada lectura y escritura va en try/catch
// y, si falla, la preferencia vive solo en memoria mientras la pantalla está
// abierta.

export type InventoryView = 'list' | 'grid'

export interface InventoryPreferences {
  /** Lista (una por fila, miniatura a la izquierda) o cuadrícula. */
  view: InventoryView
  /** Agrupar por género (los géneros en orden alfabético). */
  grouped: boolean
  /** Orden de las plantas (dentro de cada género si se agrupa). */
  sort: PlantSort
}

/**
 * Clave en localStorage. Si cambia la forma del valor, cambia la versión.
 * Añadir un campo no la cambia: lo que falta se lee por defecto, así que el
 * orden (#292) se añadió sin perder la vista que cada uno ya había elegido.
 */
export const PREFERENCES_KEY = 'orki:inventario:preferencias:v1'

// Sin preferencia guardada, cuadrícula (la vista de la maqueta del #208).
export const DEFAULT_PREFERENCES: InventoryPreferences = {
  view: 'grid',
  grouped: false,
  sort: 'newest',
}

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Lee las preferencias guardadas; lo que falte o no se entienda, por defecto. */
export function readPreferences(): InventoryPreferences {
  let raw: string | null
  try {
    raw = storage()?.getItem(PREFERENCES_KEY) ?? null
  } catch {
    return DEFAULT_PREFERENCES
  }
  if (raw === null) return DEFAULT_PREFERENCES

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return DEFAULT_PREFERENCES
  }
  if (typeof value !== 'object' || value === null) return DEFAULT_PREFERENCES
  const view = 'view' in value ? value.view : undefined
  const grouped = 'grouped' in value ? value.grouped : undefined
  const sort = 'sort' in value ? value.sort : undefined
  return {
    view: view === 'list' || view === 'grid' ? view : DEFAULT_PREFERENCES.view,
    grouped:
      typeof grouped === 'boolean' ? grouped : DEFAULT_PREFERENCES.grouped,
    sort: isPlantSort(sort) ? sort : DEFAULT_PREFERENCES.sort,
  }
}

/** Guarda las preferencias; si no se puede, no pasa nada. */
export function writePreferences(preferences: InventoryPreferences): void {
  try {
    storage()?.setItem(PREFERENCES_KEY, JSON.stringify(preferences))
  } catch {
    // Sin almacenamiento: la preferencia dura lo que la pantalla.
  }
}

/** Preferencias del inventario con sus cambios, guardados al momento. */
export function useInventoryPreferences(): [
  InventoryPreferences,
  (change: Partial<InventoryPreferences>) => void,
] {
  const [preferences, setPreferences] = useState(readPreferences)
  const update = useCallback((change: Partial<InventoryPreferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...change }
      writePreferences(next)
      return next
    })
  }, [])
  return [preferences, update]
}
