import type { CollectionPlant } from '../collection/model.ts'
import { normalizeSearchText } from '../collection/normalize.ts'

// Sugerencias del campo de origen (#86): los orígenes que el usuario ya usó,
// sacados de su colección en memoria (todas sus plantas, también las dadas de
// baja: la tienda sigue siendo suya). No hay consulta propia: la pantalla de
// registro ya carga la colección para sumar la planta nueva al guardar.
//
// - "Vivero Sol", "vivero sol" y "Vivéro  Sol" son el mismo origen: se
//   agrupan por el texto normalizado (sin mayúsculas, tildes ni espacios
//   sobrantes, como el buscador del inventario) y se muestra la forma escrita
//   en el registro más reciente.
// - Orden: primero los más usados; a igual uso, el usado más recientemente
//   (por fecha de alta del registro).
// - Filtro: cada palabra de lo escrito tiene que aparecer en el origen, sin
//   distinguir mayúsculas ni tildes ("sol viv" encuentra "Vivero Sol").

/** Número máximo de sugerencias en la lista. */
export const ORIGIN_SUGGESTION_LIMIT = 6

export interface OriginSuggestion {
  /** Texto normalizado; sirve de id estable. */
  key: string
  /** Cómo se escribió la última vez. */
  label: string
  /** En cuántas plantas aparece. */
  count: number
}

interface Group extends OriginSuggestion {
  lastUsed: number
}

/** Los orígenes distintos del usuario, de más a menos usado. */
export function knownOrigins(
  plants: readonly CollectionPlant[],
): OriginSuggestion[] {
  const groups = new Map<string, Group>()
  for (const plant of plants) {
    const label = plant.origin?.trim().replace(/\s+/g, ' ')
    if (!label) continue
    const key = normalizeSearchText(label)
    if (key === '') continue
    const used = Date.parse(plant.createdAt) || 0
    const group = groups.get(key)
    if (!group) {
      groups.set(key, { key, label, count: 1, lastUsed: used })
      continue
    }
    group.count += 1
    if (used > group.lastUsed) {
      group.lastUsed = used
      group.label = label
    }
  }
  return [...groups.values()]
    .sort(
      (a, b) =>
        b.count - a.count ||
        b.lastUsed - a.lastUsed ||
        a.label.localeCompare(b.label, 'es'),
    )
    .map(({ key, label, count }) => ({ key, label, count }))
}

/**
 * Las sugerencias para lo escrito, como mucho ORIGIN_SUGGESTION_LIMIT. Sin
 * texto, ninguna (la lista se abre al escribir). Si lo escrito ya es
 * exactamente un origen conocido, ese no se repite.
 */
export function suggestOrigins(
  origins: readonly OriginSuggestion[],
  query: string,
): OriginSuggestion[] {
  const words = normalizeSearchText(query).split(' ').filter(Boolean)
  if (words.length === 0) return []
  const typed = query.trim().replace(/\s+/g, ' ')
  return origins
    .filter(
      (origin) =>
        origin.label !== typed &&
        words.every((word) => origin.key.includes(word)),
    )
    .slice(0, ORIGIN_SUGGESTION_LIMIT)
}
