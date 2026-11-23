// Índice alfabético de los géneros (#232).
//
// La letra de un género es la primera de su nombre sin el signo de híbrido ni
// tildes, como el orden de la base (los nothogéneros, guardados como
// «× Rhyncholaeliocattleya», van con la R). Un nombre que no empieza por una
// letra de la «a» a la «z» va en «otros».

export const OTHER_LETTER = 'otros'

/** Letra del índice de un género: «a»…«z» u OTHER_LETTER. */
export function genusLetter(name: string): string {
  const first = name
    .replace(/^\s*(?:×|x(?=\s))\s*/iu, '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .charAt(0)
    .toLowerCase()
  return /^[a-z]$/.test(first) ? first : OTHER_LETTER
}

/** Las letras que tienen algún género, en orden, con «otros» al final. */
export function lettersOf(names: readonly string[]): string[] {
  const letters = new Set(names.map(genusLetter))
  return [...letters].sort((a, b) => {
    if (a === OTHER_LETTER) return 1
    if (b === OTHER_LETTER) return -1
    return a < b ? -1 : a > b ? 1 : 0
  })
}

/** La letra de la dirección si es una del índice; si no, la primera. */
export function activeLetter(
  requested: string | null,
  letters: readonly string[],
): string | null {
  const wanted = requested?.trim().toLowerCase() ?? ''
  return letters.includes(wanted) ? wanted : (letters[0] ?? null)
}
