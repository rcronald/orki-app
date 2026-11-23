import { PATHS } from '../routes/paths.ts'
import type { FormSpecies } from './form-state.ts'

// Registro con el nombre ya escrito (#123): "Aún no la tienes" lleva a
// /coleccion/nueva?nombre=<lo buscado>, y el formulario empieza con ese
// nombre en el campo, como si se hubiera escrito ahí. Va aparte de paths.ts
// para no sumar nada al chunk inicial.

export const PREFILL_NAME_PARAM = 'nombre'

/** Mismo tope que el campo de nombre (PLANT_NAME_MAX_LENGTH en form-state.ts). */
const PREFILL_NAME_MAX_LENGTH = 200

function cleanName(name: string): string {
  return [...name.trim().replace(/\s+/g, ' ')]
    .slice(0, PREFILL_NAME_MAX_LENGTH)
    .join('')
    .trim()
}

/** Dirección del registro con `name` ya escrito; sin nombre, la de siempre. */
export function newPlantPathWithName(name: string): string {
  const clean = cleanName(name)
  if (clean === '') return PATHS.newPlant
  return `${PATHS.newPlant}?${new URLSearchParams({ [PREFILL_NAME_PARAM]: clean }).toString()}`
}

/** El nombre que trae la dirección del registro, limpio, o '' si no trae. */
export function prefilledName(search: URLSearchParams): string {
  return cleanName(search.get(PREFILL_NAME_PARAM) ?? '')
}

// Registro con la especie ya elegida (#232): «Registrar esta especie», en la
// ficha del catálogo, abre /coleccion/nueva?nombre=<nombre científico> con la
// especie en el estado de la navegación. El formulario empieza con ella
// enlazada, como si se hubiera elegido en el autocompletado. La dirección
// sola (compartida, o sin el estado) abre el registro con el nombre escrito,
// como desde «¿Ya la tengo?».

interface CatalogSpeciesState {
  catalogSpecies: FormSpecies
}

/** Enlace al registro con `species` elegida: <Link to={…} state={…}>. */
export function newPlantLinkForSpecies(species: FormSpecies): {
  to: string
  state: CatalogSpeciesState
} {
  return {
    to: newPlantPathWithName(species.scientificName),
    state: { catalogSpecies: species },
  }
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/**
 * La especie que trae el estado de la navegación, si tiene la forma esperada y
 * su nombre es el de la dirección (`name`, de prefilledName); si no, null.
 */
export function prefilledSpecies(
  state: unknown,
  name: string,
): FormSpecies | null {
  if (typeof state !== 'object' || state === null) return null
  const species = (state as { catalogSpecies?: unknown }).catalogSpecies
  if (typeof species !== 'object' || species === null) return null
  const { id, scientificName, genus, type } = species as Record<string, unknown>
  if (!isText(id) || !isText(scientificName)) return null
  if (type !== 'species' && type !== 'hybrid') return null
  if (typeof genus !== 'object' || genus === null) return null
  const { id: genusId, name: genusName } = genus as Record<string, unknown>
  if (!isText(genusId) || !isText(genusName)) return null
  if (cleanName(scientificName) !== name) return null
  return {
    id,
    scientificName,
    genus: { id: genusId, name: genusName },
    type,
  }
}
