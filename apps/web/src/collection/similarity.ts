// Similitud entre palabras para "¿Ya la tengo?" (#122), calculada en el
// dispositivo.
//
// El catálogo tolera los errores de tipeo con los trigramas de pg_trgm, que sin
// conexión no están. Aquí se usa una distancia de edición acotada (la de
// Damerau-Levenshtein restringida, u "optimal string alignment"): cuenta cuántas
// letras hay que poner, quitar, cambiar o intercambiar con la vecina para pasar
// de una palabra a otra. Es la medida que corresponde a "un error de una o dos
// letras" y, con el tope, cuesta muy poco: se deja de calcular en cuanto se
// pasa de él.
//
// Las palabras llegan ya normalizadas (normalize.ts): sin tildes, en minúsculas
// y sin el signo de híbrido.

/**
 * Distancia de edición entre `a` y `b` (inserción, borrado, sustitución o
 * intercambio de dos letras vecinas, cada uno cuenta 1), o `max + 1` si pasa
 * de `max`. Compara unidades UTF-16: tras normalizar, los nombres de
 * orquídeas son letras latinas sin tildes.
 */
export function boundedEditDistance(a: string, b: string, max: number): number {
  if (a === b) return 0
  const over = max + 1
  if (Math.abs(a.length - b.length) > max) return over
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  // Tres filas: la anterior a la anterior (para el intercambio), la anterior
  // y la actual.
  let beforePrevious: number[] = []
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let value = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, beforePrevious[j - 2] + 1)
      }
      current.push(value)
      if (value < rowMin) rowMin = value
    }
    // Ninguna celda de esta fila está dentro del tope: las siguientes
    // tampoco lo estarán.
    if (rowMin > max) return over
    beforePrevious = previous
    previous = current
  }
  const distance = previous[b.length]
  return distance > max ? over : distance
}

/**
 * Distancia de `query` al comienzo de `word` más parecido: la menor distancia
 * entre `query` y los prefijos de `word` de longitud cercana a la suya (de
 * `query.length - max` a `query.length + max`). Sirve para la palabra que aún
 * se está escribiendo, o para una escrita a medias: "amabl" está a 0 de
 * "amabilis" y "amabli", a 1. Devuelve `max + 1` si pasa del tope.
 */
export function boundedPrefixDistance(
  query: string,
  word: string,
  max: number,
): number {
  const over = max + 1
  if (word.startsWith(query)) return 0
  const shortest = Math.max(1, query.length - max)
  const longest = Math.min(word.length, query.length + max)
  let best = over
  for (let length = shortest; length <= longest; length += 1) {
    const distance = boundedEditDistance(
      query,
      word.slice(0, length),
      Math.min(max, best - 1),
    )
    if (distance < best) best = distance
    if (best === 0) break
  }
  return best
}

/**
 * Errores que se toleran en una palabra de la búsqueda, según su longitud:
 * ninguno hasta 3 letras ("onc" no debe encontrar "one"), uno de 4 a 7
 * ("labiata" no debe encontrar "lobata", que es otra especie) y dos desde 8
 * ("phalenopsis" sigue encontrando "phalaenopsis").
 */
export function allowedTypos(length: number): number {
  if (length <= 3) return 0
  if (length <= 7) return 1
  return 2
}

/** Errores que se toleran en toda la búsqueda, sumando sus palabras. */
export const MAX_TOTAL_TYPOS = 2
