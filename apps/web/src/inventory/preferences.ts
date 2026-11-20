import { useCallback, useState } from 'react'

// Preferencias de la pantalla de inventario, recordadas en este dispositivo
// (localStorage): cómo se ve la colección y si se agrupa por género. No van a
// la base de datos: en otro celular cada uno elige la suya.
//
// localStorage puede no existir o fallar (navegación privada de Safari, datos
// del sitio bloqueados, cuota llena): cada lectura y escritura va en try/catch
// y, si falla, la preferencia vive solo en memoria mientras la pantalla está
// abierta.

export type InventoryView = 'list' | 'grid'

export interface InventoryPreferences {
  /** Lista (una por fila, miniatura a la izquierda) o cuadrícula. */
  view: InventoryView
  /** Agrupar por género; sin agrupar, las más recientes primero. */
  grouped: boolean
}

/** Clave en localStorage. Si cambia la forma del valor, cambia la versión. */
export const PREFERENCES_KEY = 'orki:inventario:preferencias:v1'

export const DEFAULT_PREFERENCES: InventoryPreferences = {
  view: 'list',
  grouped: false,
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
  return {
    view: view === 'list' || view === 'grid' ? view : DEFAULT_PREFERENCES.view,
    grouped:
      typeof grouped === 'boolean' ? grouped : DEFAULT_PREFERENCES.grouped,
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
