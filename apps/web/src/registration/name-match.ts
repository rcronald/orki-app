import { normalizeSearchText } from '../collection/normalize.ts'
import {
  SEARCH_DEFAULT_RESULTS,
  type GenusSearchResult,
  type SpeciesSearchResult,
} from '../lib/catalogSearch.ts'
import type { FormGenus, FormSpecies } from './form-state.ts'

// Coincidencia exacta del nombre con el catálogo (#280).
//
// search_species tolera errores de tipeo y devuelve también lo que solo se
// parece, sin decir si la coincidencia fue exacta. Aquí se decide, en el
// cliente, comparando lo escrito con lo que devolvió, normalizado como en la
// base (normalizeSearchText: sin tildes ni mayúsculas, espacios unificados y
// sin el signo de híbrido, «×» o «x»). Nunca se enlaza por parecido: un enlace
// equivocado es peor que un nombre por validar.
//
// La regla:
//
// - Lo escrito es el nombre aceptado (scientific_name) de UNA sola especie de
//   lo devuelto, y no es nombre (aceptado, sinónimo o común) de ninguna otra:
//   se enlaza sola ('link'), como si se hubiera elegido.
// - Es un sinónimo o un nombre común de una sola especie: no se enlaza sin que
//   se vea, porque el nombre cambiaría. Se ofrece ('offer'), destacada en la
//   lista (Enter la elige) y con «Elegir <nombre aceptado>» bajo el campo.
// - Coincide con varias (homónimos, o aceptado en una y sinónimo en otra): no
//   se elige ninguna; se muestran todas ('several').
// - Solo se parece (error de tipeo, abreviatura de género, una palabra de
//   más o de menos): nada ('none'); la lista lo ofrece como siempre.
// - El estado de la especie (importada, validada u observada) no cuenta: es lo
//   mismo que ya deja elegir el autocompletado.
//
// La lista llega cortada (10 resultados). Si viene llena y la última todavía
// empieza por lo escrito, palabra a palabra (las clases 1 y 2 del orden de la
// base, donde está toda coincidencia exacta), podría quedar fuera otra
// especie con el mismo nombre: entonces no se enlaza sola, se ofrece. Lo que
// la lista no deja ver: una especie que coincidió por su nombre aceptado
// (que empieza por lo escrito sin ser igual) y que además tiene un sinónimo
// idéntico a lo escrito; ahí haría falta que la base dijera qué nombres
// coinciden exactamente.

export type NameMatch =
  | { kind: 'none' }
  | { kind: 'link'; result: SpeciesSearchResult }
  | {
      kind: 'offer'
      result: SpeciesSearchResult
      /** Por qué nombre coincidió: el aceptado (si no se puede asegurar que es la única), un sinónimo o un nombre común. */
      by: 'scientific' | 'synonym' | 'common'
    }
  | { kind: 'several'; results: readonly SpeciesSearchResult[] }

const NO_MATCH: NameMatch = { kind: 'none' }

/** Si `name` empieza por `query` palabra a palabra (los dos ya normalizados). */
function startsByWords(name: string, query: string): boolean {
  const names = name.split(' ')
  const words = query.split(' ')
  return (
    words.length <= names.length &&
    words.every((word, index) => names[index]?.startsWith(word) === true)
  )
}

/**
 * La coincidencia exacta de `query` (lo escrito) entre los `results` de
 * search_species para esa misma consulta. `maxResults` es cuántos se pidieron.
 */
export function exactNameMatch(
  query: string,
  results: readonly SpeciesSearchResult[],
  maxResults = SEARCH_DEFAULT_RESULTS,
): NameMatch {
  const typed = normalizeSearchText(query)
  if (typed === '') return NO_MATCH
  const exact = results.filter(
    (result, index) =>
      results.findIndex((other) => other.id === result.id) === index &&
      (normalizeSearchText(result.scientificName) === typed ||
        normalizeSearchText(result.matchedName) === typed),
  )
  const [first] = exact
  if (first === undefined) return NO_MATCH
  if (exact.length > 1) return { kind: 'several', results: exact }
  if (normalizeSearchText(first.scientificName) !== typed) {
    return {
      kind: 'offer',
      result: first,
      by: first.matchedNameType === 'common' ? 'common' : 'synonym',
    }
  }
  const last = results.at(-1)
  const complete =
    results.length < maxResults ||
    last === undefined ||
    !startsByWords(normalizeSearchText(last.matchedName), typed)
  return complete
    ? { kind: 'link', result: first }
    : { kind: 'offer', result: first, by: 'scientific' }
}

/** La especie de un resultado, como la guarda el formulario. */
export function formSpeciesOf(result: SpeciesSearchResult): FormSpecies {
  return {
    id: result.id,
    scientificName: result.scientificName,
    genus: { id: result.genusId, name: result.genusName },
    type: result.type,
  }
}

// Género deducido de un nombre libre (#280) --------------------------------
//
// «Cattleya Mini Purple» marca de antemano Cattleya; «Blc. Toshie Aoki», el
// género de esa abreviatura. Solo si la primera palabra es, entera, el nombre
// de un género o una de sus abreviaturas (sin mayúsculas, tildes ni el punto
// final), y de uno solo: «Catt» no marca nada.

/** La palabra del nombre que podría ser el género: la primera, sin «×» ni «x» delante. */
export function genusWordOf(name: string): string {
  const words = name
    .replace(/×/g, ' × ')
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '')
  const index = words.findIndex(
    (word, position) =>
      word !== '×' &&
      !(word.toLowerCase() === 'x' && position < words.length - 1),
  )
  return index === -1 ? '' : (words[index] ?? '')
}

function withoutFinalDot(text: string): string {
  return normalizeSearchText(text).replace(/\.+$/, '')
}

/** El género que nombra `word` entre los `results` de search_genera, si es uno solo. */
export function deducedGenus(
  word: string,
  results: readonly GenusSearchResult[],
): FormGenus | null {
  const typed = withoutFinalDot(word)
  if (typed === '') return null
  const found = results.filter(
    (result, index) =>
      results.findIndex((other) => other.id === result.id) === index &&
      (withoutFinalDot(result.name) === typed ||
        (result.matchedAbbreviation !== null &&
          withoutFinalDot(result.matchedAbbreviation) === typed)),
  )
  const [genus] = found
  return found.length === 1 && genus ? { id: genus.id, name: genus.name } : null
}
