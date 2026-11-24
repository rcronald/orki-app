import { normalizeSearchText } from '../collection/normalize.ts'
import { MAX_PLANT_DRAFTS, type PlantDraft } from './draft.ts'
import { normalizePlantName, type FormSpecies } from './form-state.ts'
import { PLANT_FORM_TEXT } from './texts.ts'

// Con qué empieza el registro cuando hay borradores guardados (#296).
//
// Lo que llega al abrirlo (la especie de «Registrar esta especie» en la ficha
// del catálogo o el nombre de ?nombre=, desde «¿Ya la tengo?») no sustituye
// en silencio a un borrador, ni el borrador a lo que llega:
//
// - Sin nada que llegue: el borrador más reciente, como siempre (con el aviso
//   de que se recuperó y, si hay otro, la opción de continuar ese).
// - Llega lo mismo que tiene un borrador (la misma especie o el mismo nombre,
//   sin tildes, mayúsculas ni espacios de más): ese borrador, sin preguntar.
// - Llega otra cosa y no hay borradores: el formulario con lo que llega.
// - Llega otra cosa y hay borradores: se pregunta («Continuar borrador» o
//   «Registrar <especie>»). Registrar lo que llega no borra ningún borrador:
//   queda guardado para retomarlo después. Con MAX_PLANT_DRAFTS borradores ya
//   guardados no se empieza otro: antes hay que continuar o descartar uno.

/** Lo que llega al abrir el registro. */
export interface RegistrationStart {
  /** La especie elegida en la ficha del catálogo, o null. */
  species: FormSpecies | null
  /** El nombre de ?nombre= (o el de la especie), o ''. */
  name: string
}

export type StartDecision =
  /** El formulario con este borrador, o con lo que llega si es null. */
  | { kind: 'form'; draft: PlantDraft | null }
  /** Preguntar entre los borradores y lo que llega. */
  | { kind: 'choice' }

/** El nombre de lo que llega: el de la especie o el escrito. */
export function startName(start: RegistrationStart): string {
  return start.species?.scientificName ?? start.name
}

/** Si el borrador es del mismo registro que lo que llega. */
export function isSameRegistration(
  draft: PlantDraft,
  start: RegistrationStart,
): boolean {
  if (
    start.species !== null &&
    draft.values.species !== null &&
    draft.values.species.id === start.species.id
  ) {
    return true
  }
  const incoming = normalizeSearchText(startName(start))
  return incoming !== '' && normalizeSearchText(draft.values.name) === incoming
}

/**
 * Con qué empieza el registro. `drafts`, del más reciente al más antiguo
 * (readPlantDrafts).
 */
export function decideStart(
  drafts: readonly PlantDraft[],
  start: RegistrationStart,
): StartDecision {
  const [latest] = drafts
  if (latest === undefined) return { kind: 'form', draft: null }
  if (normalizeSearchText(startName(start)) === '') {
    return { kind: 'form', draft: latest }
  }
  const same = drafts.find((draft) => isSameRegistration(draft, start))
  if (same !== undefined) return { kind: 'form', draft: same }
  return { kind: 'choice' }
}

/** Si ya no cabe otro borrador: para empezar otro hay que descartar uno. */
export function draftsFull(drafts: readonly PlantDraft[]): boolean {
  return drafts.length >= MAX_PLANT_DRAFTS
}

/** El nombre de un borrador, como texto: el escrito, o «sin nombre». */
export function draftName(draft: PlantDraft): string {
  const name = normalizePlantName(draft.values.name)
  return name === '' ? PLANT_FORM_TEXT.draftUnnamed : name
}
