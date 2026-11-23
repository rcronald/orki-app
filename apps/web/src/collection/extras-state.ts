import type { CollectionPlant } from './model.ts'
import type { OwnershipExtras } from './ownership.ts'

// Si los sinónimos, nombres comunes y abreviaturas (los "extras" de "¿Ya la
// tengo?", extras-source.ts) están completos para la colección que se ve
// (#274).
//
// Los extras se piden aparte de las plantas y después de ellas (#243), así
// que puede haber plantas cuyos extras aún no están: durante la lectura, si
// la lectura falló, o con una planta registrada o cambiada después de la
// última lectura (save() de la copia no pide extras). Un "Aún no la tienes"
// con extras incompletos no es seguro: la planta podría estar con otro
// nombre.
//
// Para saberlo, junto a los extras se guarda su cobertura: de qué especies y
// géneros se pidieron (una especie sin sinónimos no aparece en los extras,
// así que la ausencia no basta). Los extras están completos para unas plantas
// si la cobertura incluye la especie (si la tienen) y el género de cada una.

/** Especies y géneros cuyos extras se leyeron de la red. */
export interface ExtrasCoverage {
  speciesIds: ReadonlySet<string>
  genusIds: ReadonlySet<string>
}

/**
 * La lectura de extras:
 * - idle: no hay ninguna en curso y la última, si la hubo, salió bien.
 * - loading: en curso.
 * - failed: la última falló (red caída, servidor).
 */
export type ExtrasRequest = 'idle' | 'loading' | 'failed'

/**
 * Lo que se puede decir de los extras de unas plantas:
 * - complete: están todos. Un "no" es seguro.
 * - pending: faltan algunos y se están pidiendo; se resolverá solo.
 * - failed: faltan algunos y la última lectura falló.
 * - outdated: faltan algunos y no se han pedido: la copia es de antes (sin
 *   conexión, sesión sin confirmar) o de una versión anterior de la app,
 *   que no guardaba la cobertura.
 */
export type ExtrasState = 'complete' | 'pending' | 'failed' | 'outdated'

export const NO_COVERAGE: ExtrasCoverage = {
  speciesIds: new Set(),
  genusIds: new Set(),
}

/** La cobertura de unos extras pedidos para estas plantas. */
export function coverageOf(plants: readonly CollectionPlant[]): ExtrasCoverage {
  const speciesIds = new Set<string>()
  const genusIds = new Set<string>()
  for (const plant of plants) {
    if (plant.species !== null) speciesIds.add(plant.species.id)
    genusIds.add(plant.genus.id)
  }
  return { speciesIds, genusIds }
}

function isCovered(plant: CollectionPlant, coverage: ExtrasCoverage): boolean {
  return (
    coverage.genusIds.has(plant.genus.id) &&
    (plant.species === null || coverage.speciesIds.has(plant.species.id))
  )
}

/** Las plantas cuyos extras faltan en la cobertura. */
export function uncoveredPlants(
  plants: readonly CollectionPlant[],
  coverage: ExtrasCoverage,
): CollectionPlant[] {
  return plants.filter((plant) => !isCovered(plant, coverage))
}

/** Une dos coberturas. */
export function mergeCoverage(
  a: ExtrasCoverage,
  b: ExtrasCoverage,
): ExtrasCoverage {
  return {
    speciesIds: new Set([...a.speciesIds, ...b.speciesIds]),
    genusIds: new Set([...a.genusIds, ...b.genusIds]),
  }
}

/**
 * Los extras de antes con los recién leídos para `coverage`: de las especies
 * y géneros pedidos manda lo nuevo (también si ya no tienen ninguno).
 */
export function mergeExtras(
  before: OwnershipExtras,
  fetched: OwnershipExtras,
  coverage: ExtrasCoverage,
): OwnershipExtras {
  const speciesNames = new Map(before.speciesNames)
  for (const id of coverage.speciesIds) {
    const names = fetched.speciesNames?.get(id)
    if (names === undefined) speciesNames.delete(id)
    else speciesNames.set(id, names)
  }
  const genusAbbreviations = new Map(before.genusAbbreviations)
  for (const id of coverage.genusIds) {
    const abbreviations = fetched.genusAbbreviations?.get(id)
    if (abbreviations === undefined) genusAbbreviations.delete(id)
    else genusAbbreviations.set(id, abbreviations)
  }
  return { speciesNames, genusAbbreviations }
}

/**
 * El estado de los extras para estas plantas, con la cobertura de los que hay
 * (null: desconocida, como en una copia de una versión anterior) y la lectura
 * en curso o la última.
 */
export function extrasStateOf(
  plants: readonly CollectionPlant[],
  coverage: ExtrasCoverage | null,
  request: ExtrasRequest,
): ExtrasState {
  const missing =
    coverage === null
      ? plants.length > 0
      : plants.some((plant) => !isCovered(plant, coverage))
  if (!missing) return 'complete'
  if (request === 'loading') return 'pending'
  if (request === 'failed') return 'failed'
  return 'outdated'
}
