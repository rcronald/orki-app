import type { CollectionPlant } from '../src/collection/model.ts'
import {
  CollectionLoadError,
  type CollectionSource,
} from '../src/collection/source.ts'

// Sustituto de src/collection/supabase-source.ts en el build de medición
// (medicion/vite.config.ts): lee las plantas de /medicion/coleccion.json con
// una sola petición, en lugar de consultar Supabase. Exporta el mismo nombre
// que el original para que CollectionProvider lo use sin cambios.

export const supabaseCollectionSource: CollectionSource = {
  async load({ signal }) {
    const respuesta = await fetch('/medicion/coleccion.json', { signal })
    if (!respuesta.ok) throw new CollectionLoadError('failed')
    return (await respuesta.json()) as CollectionPlant[]
  },
}
