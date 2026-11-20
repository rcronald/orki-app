// Normalización del texto para buscar dentro de la colección.
//
// Sigue la misma regla que public.normalize_search_text() del catálogo (búsqueda
// del #7, migración 20261120210000_ajustes_de_busqueda.sql), para que el
// buscador del inventario tolere lo mismo que el del catálogo:
//
//   1. Cada signo de híbrido "×" se sustituye por un espacio.
//   2. Se quitan las tildes y diacríticos (á → a, ü → u, ñ → n) y se pasa a
//      minúsculas.
//   3. Los espacios (incluidos tabuladores y saltos de línea) se unifican en uno
//      y se recortan los extremos.
//   4. Se quita la "x" que es una palabra entera seguida de otra palabra, al
//      principio o en medio: es el signo de híbrido escrito con el teclado
//      ("Phalaenopsis x intermedia"). La "x" dentro de una palabra ("xanthina")
//      o al final ("phal x", que puede ser el comienzo de un epíteto) se queda.
//
// Diferencia conocida con Postgres: unaccent también transcribe algunas letras
// sin descomponer (ø, æ, œ, ß, ł, đ...). Aquí se cubren las de LETTERS; el resto
// se queda como está, lo que solo afecta a nombres que ninguna orquídea del
// catálogo usa hoy.

const HYBRID_SIGN = /×/g
const COMBINING_MARKS = /\p{M}/gu
const SPACES = /\s+/g
const HYBRID_X = /(^| )x(?= )/g

/** Letras que unaccent transcribe y que la descomposición Unicode no separa. */
const LETTERS: Readonly<Record<string, string>> = {
  ø: 'o',
  æ: 'ae',
  œ: 'oe',
  ß: 'ss',
  ł: 'l',
  đ: 'd',
}
const SPECIAL_LETTERS = new RegExp(`[${Object.keys(LETTERS).join('')}]`, 'g')

/** Texto normalizado para comparar: ver la regla al principio del módulo. */
export function normalizeSearchText(value: string): string {
  const unaccented = value
    .replace(HYBRID_SIGN, ' ')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(SPECIAL_LETTERS, (letter) => LETTERS[letter] ?? letter)
  return unaccented.replace(SPACES, ' ').trim().replace(HYBRID_X, '').trim()
}
