import { PATHS } from '../routes/paths.ts'

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
