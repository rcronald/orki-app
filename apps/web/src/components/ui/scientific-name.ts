// Qué partes de un nombre científico van en cursiva.
//
// Sigue las convenciones de nomenclatura botánica (ICN) y de registro de
// híbridos de orquídeas (ICNCP, registro de la RHS):
//
// - El género y los epítetos de especie, subespecie o variedad van en cursiva:
//   "Phalaenopsis amabilis".
// - El signo de híbrido "×" nunca va en cursiva, esté delante de un género
//   híbrido ("× Rhyncholaeliocattleya") o de un epíteto de híbrido natural
//   ("Phalaenopsis × intermedia").
//   Una "x" suelta entre palabras se trata igual: es el signo escrito con el
//   teclado.
// - Las abreviaturas de rango ("var.", "subsp.", "f.") van en redonda.
// - El nombre de un grex (híbrido artificial registrado) va en redonda y con
//   mayúscula inicial: "Phalaenopsis Sogo Yukidian", "× Rhyncholaeliocattleya
//   Memoria Anna Balmores". Lo mismo el cultivar, entre comillas: "'Alba'".
//   Como los epítetos de especie van siempre en minúscula, la primera palabra
//   después del género que empieza por mayúscula o comilla marca el comienzo
//   del grex o del cultivar, y desde ahí todo va en redonda.
//
// El nombre se muestra tal como está guardado: no se añade ni se quita el
// signo "×".

export interface NamePart {
  text: string
  italic: boolean
}

const HYBRID_SIGN = '×'
const QUOTES = new Set(["'", '‘', '’', '"', '“', '”'])

/** Divide un nombre científico en tramos en cursiva y en redonda. */
export function scientificNameParts(name: string): NamePart[] {
  const parts: NamePart[] = []
  const push = (text: string, italic: boolean) => {
    if (text === '') return
    const last = parts.at(-1)
    // Los espacios toman el estilo del tramo anterior: así se unen tramos.
    if (last && (last.italic === italic || text.trim() === '')) {
      last.text += text
    } else {
      parts.push({ text, italic })
    }
  }

  let seenGenus = false
  let roman = false
  // Palabras y espacios por separado, para conservar el texto exacto.
  for (const token of name.split(/(\s+)/)) {
    if (token === '' || /^\s+$/.test(token)) {
      push(token, parts.at(-1)?.italic ?? false)
      continue
    }
    let word = token
    // "×Brassocattleya" escrito junto: el signo va aparte, en redonda.
    if (word.startsWith(HYBRID_SIGN)) {
      push(HYBRID_SIGN, false)
      word = word.slice(HYBRID_SIGN.length)
      if (word === '') continue
    }
    if (!seenGenus) {
      seenGenus = true
      push(word, true)
      continue
    }
    const first = word.charAt(0)
    if (!roman && (QUOTES.has(first) || isUpperCase(first))) roman = true
    // Una "x" suelta es el signo de híbrido escrito con el teclado.
    const isSign = word === 'x' || word === HYBRID_SIGN
    const isRank = word.endsWith('.')
    push(word, !roman && !isSign && !isRank)
  }
  return parts
}

function isUpperCase(char: string): boolean {
  return char !== char.toLowerCase() && char === char.toUpperCase()
}
