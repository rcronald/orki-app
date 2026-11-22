import type { CollectionGenus, CollectionPlant } from './model.ts'
import { normalizeSearchText } from './normalize.ts'
import { compareNames } from './selectors.ts'
import {
  allowedTypos,
  boundedPrefixDistance,
  MAX_TOTAL_TYPOS,
} from './similarity.ts'

// "¿Ya la tengo?" sobre la colección en memoria (#122): funciones puras que,
// dado un texto, dicen si el usuario ya tiene esa orquídea, con qué plantas
// coincidió y por qué nombre. No piden nada a la red: con conexión, la
// respuesta se puede mejorar después con el catálogo (#124, withCatalog), pero
// la local sale siempre primero y basta sola.
//
// Qué nombres se comparan de cada planta:
// - el nombre científico de su especie, si está enlazada;
// - el nombre que ingresó el usuario, que es el único de las plantas "por
//   validar" (y, si no empieza por el género, también "género + nombre", para
//   que "Cattleya maxima" encuentre una planta del género Cattleya ingresada
//   como "maxima");
// - los sinónimos y nombres comunes de su especie, cuando la copia local de la
//   caché (#18) los tenga (OwnershipExtras);
// - el género, que responde aparte: cuántos ejemplares hay de él.
// El apodo y el origen no: sirven para filtrar la lista, pero "Sí, la tienes"
// por haber escrito el nombre del vivero sería un falso positivo.
//
// Reglas de la búsqueda, coherentes con search_species() del catálogo (ver
// supabase/README.md, "Búsqueda de especies"):
// - Normalización: la de normalize.ts (tildes, mayúsculas, signo "×", "x"
//   suelta), más el punto final de cada palabra, para las abreviaturas
//   ("Phal." es "phal").
// - Mínimo 2 caracteres normalizados con alguna letra o número y como mucho
//   100 escritos, como el catálogo. Con menos de 3, solo cuenta el comienzo
//   del nombre ("ph" encuentra Phalaenopsis, no cualquier epíteto con "ph").
// - Prefijo por palabras: cada palabra de la búsqueda es el comienzo de la
//   palabra que le toca del nombre, en orden y seguidas ("phal amab" →
//   Phalaenopsis amabilis). A diferencia del catálogo, pueden empezar en
//   cualquier palabra del nombre: "amabilis" encuentra Phalaenopsis amabilis
//   (el catálogo lo encuentra por similitud).
// - Abreviaturas de género: el prefijo ya cubre las que son el comienzo del
//   nombre (Phal., Den., Paph.); las que no lo son (Blc., Dtps.) se expanden
//   si la copia local trae las abreviaturas de sus géneros
//   (genusAbbreviations), como hace el catálogo con la primera palabra.
// - Errores de tipeo: cada palabra tolera los errores de allowedTypos() (0
//   hasta 3 letras, 1 de 4 a 7, 2 desde 8) y toda la búsqueda, 2 como mucho
//   (MAX_TOTAL_TYPOS). Ver similarity.ts.
//
// Cómo se decide la respuesta (outcome):
// - "owned" (Sí, la tienes): algún ejemplar activo coincide exactamente o por
//   prefijo.
// - "similar" (parecidas): ninguno coincide así, pero alguno activo se parece
//   dentro de la tolerancia. Se responde también "Sí, la tienes", mostrando
//   la planta que coincidió para que el usuario juzgue: un "No" equivocado
//   causa una compra duplicada, que es justo lo que la app evita.
// - "not-owned" (Aún no la tienes): ningún ejemplar activo coincide.
// Solo cuentan los ejemplares activos. Los perdidos o regalados que coinciden
// van aparte (pastMatches, "la tuviste") y nunca dan un "Sí".
//
// Si la búsqueda es un género de la colección (su nombre completo, el comienzo
// o con un error de tipeo, o una de sus abreviaturas), la respuesta es por
// género (scope "genus"): cuántos ejemplares activos hay de él.

/** Un nombre más de una especie: sinónimo o nombre común (copia local, #18). */
export interface SpeciesExtraName {
  name: string
  type: 'synonym' | 'common'
}

/**
 * Lo que la copia local de la caché (#18) sabe además de la colección: los
 * sinónimos y nombres comunes de cada especie (por id de especie) y las
 * abreviaturas de cada género (por id de género, tal como se guardan:
 * "Blc."). Sin ellos se busca igual, con los nombres de las plantas.
 */
export interface OwnershipExtras {
  speciesNames?: ReadonlyMap<string, readonly SpeciesExtraName[]>
  genusAbbreviations?: ReadonlyMap<string, readonly string[]>
}

/** Por qué nombre coincidió una planta. */
export type OwnershipNameKind =
  'scientific' | 'entered' | 'synonym' | 'common' | 'genus'

/**
 * Cómo coincidió: el nombre entero ("exact"), por el comienzo de sus palabras
 * ("prefix") o con errores de tipeo dentro de la tolerancia ("similar").
 */
export type OwnershipMatchQuality = 'exact' | 'prefix' | 'similar'

/** La respuesta: la tengo, parecidas o no la tengo. */
export type OwnershipOutcome = 'owned' | 'similar' | 'not-owned'

export interface OwnershipMatch {
  plant: CollectionPlant
  /** El nombre por el que coincidió, tal como está escrito. */
  matchedName: string
  kind: OwnershipNameKind
  quality: OwnershipMatchQuality
}

export interface OwnershipGenusCount {
  genus: CollectionGenus
  /** Ejemplares activos del género. */
  activeCount: number
}

export interface Ownership {
  /** La búsqueda normalizada a la que responde. */
  key: string
  outcome: OwnershipOutcome
  /** Por especie (o nombre) o por género. */
  scope: 'species' | 'genus'
  /**
   * Ejemplares activos que coinciden: los que cuentan para "Sí, la tienes",
   * en orden alfabético. Con outcome "similar", los parecidos.
   */
  matches: readonly OwnershipMatch[]
  /** Ejemplares perdidos o regalados que coinciden ("la tuviste"). */
  pastMatches: readonly OwnershipMatch[]
  /** Con scope "genus": los géneros buscados y sus ejemplares activos. */
  genera: readonly OwnershipGenusCount[]
}

// Búsqueda preparada ---------------------------------------------------------

/** Caracteres mínimos de la búsqueda normalizada, como en el catálogo. */
export const OWNERSHIP_QUERY_MIN_LENGTH = 2
/** Caracteres máximos de la búsqueda escrita, como en el catálogo. */
export const OWNERSHIP_QUERY_MAX_LENGTH = 100
/** Con menos caracteres normalizados, solo cuenta el comienzo del nombre. */
const ANYWHERE_MIN_LENGTH = 3

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u

/** Palabras normalizadas de un texto, sin el punto final de cada una. */
export function searchWords(text: string): string[] {
  return normalizeSearchText(text)
    .split(' ')
    .map((word) => word.replace(/\.+$/, ''))
    .filter((word) => word !== '')
}

/**
 * Las palabras de la búsqueda, o null si no hay que responder: vacía, de
 * menos de 2 caracteres normalizados o sin ninguna letra ni número, o de más
 * de 100 caracteres.
 */
export function prepareOwnershipQuery(query: string): string[] | null {
  if ([...query.trim()].length > OWNERSHIP_QUERY_MAX_LENGTH) return null
  const words = searchWords(query)
  const joined = words.join(' ')
  if (
    [...joined].length < OWNERSHIP_QUERY_MIN_LENGTH ||
    !LETTER_OR_DIGIT.test(joined)
  ) {
    return null
  }
  return words
}

// Comparación de palabras -------------------------------------------------------

const QUALITY_RANK: Record<OwnershipMatchQuality, number> = {
  exact: 0,
  prefix: 1,
  similar: 2,
}

function better(
  a: OwnershipMatchQuality,
  b: OwnershipMatchQuality,
): OwnershipMatchQuality {
  return QUALITY_RANK[a] <= QUALITY_RANK[b] ? a : b
}

/**
 * Cómo coinciden las palabras de la búsqueda con las de un nombre, o null si
 * no coinciden. `anywhere`: si pueden empezar en cualquier palabra del nombre
 * o solo en la primera.
 */
export function matchWords(
  query: readonly string[],
  name: readonly string[],
  anywhere = true,
): OwnershipMatchQuality | null {
  if (query.length === 0 || query.length > name.length) return null
  const lastStart = anywhere ? name.length - query.length : 0
  let best: OwnershipMatchQuality | null = null
  for (let start = 0; start <= lastStart; start += 1) {
    const quality = matchAt(query, name, start)
    if (quality !== null) {
      best = best === null ? quality : better(best, quality)
      if (best === 'exact') break
    }
  }
  return best
}

function matchAt(
  query: readonly string[],
  name: readonly string[],
  start: number,
): OwnershipMatchQuality | null {
  let typos = 0
  let allEqual = true
  for (let i = 0; i < query.length; i += 1) {
    const queryWord = query[i]
    const nameWord = name[start + i]
    if (queryWord === nameWord) continue
    allEqual = false
    if (nameWord.startsWith(queryWord)) continue
    const allowed = Math.min(
      allowedTypos(queryWord.length),
      MAX_TOTAL_TYPOS - typos,
    )
    if (allowed <= 0) return null
    const distance = boundedPrefixDistance(queryWord, nameWord, allowed)
    if (distance > allowed) return null
    typos += distance
  }
  if (typos > 0) return 'similar'
  return allEqual && start === 0 && query.length === name.length
    ? 'exact'
    : 'prefix'
}

/**
 * Si la primera palabra puede ser una abreviatura del género `genusWords`:
 * empieza por la misma letra y sus letras están en el nombre, en orden
 * ("blc" en "brassolaeliocattleya", "dtps" en "doritaenopsis"). Sirve para
 * aceptar lo que el catálogo encontró al expandir una abreviatura (#124).
 */
export function looksLikeAbbreviation(
  word: string,
  genusName: string,
): boolean {
  const genus = searchWords(genusName).join('')
  if (word.length < 2 || genus === '' || word[0] !== genus[0]) return false
  let position = 0
  for (const letter of word) {
    position = genus.indexOf(letter, position)
    if (position === -1) return false
    position += 1
  }
  return true
}

// Índice -------------------------------------------------------------------

interface NameRef {
  plant: CollectionPlant
  matchedName: string
  kind: OwnershipNameKind
}

interface NameEntry {
  words: readonly string[]
  refs: NameRef[]
}

interface GenusEntry {
  genus: CollectionGenus
  words: readonly string[]
  /** Abreviaturas normalizadas, sin el punto. */
  abbreviations: readonly string[]
  plants: CollectionPlant[]
}

/** La colección preparada para responder rápido; se crea con buildOwnershipIndex. */
export interface OwnershipIndex {
  readonly names: ReadonlyMap<string, NameEntry>
  readonly genera: readonly GenusEntry[]
  /** Plantas enlazadas a cada especie, por id de especie (#124). */
  readonly bySpecies: ReadonlyMap<string, readonly CollectionPlant[]>
}

// Por qué nombre se prefiere decir que coincidió, si una planta coincide por
// varios con la misma calidad.
const KIND_RANK: Record<OwnershipNameKind, number> = {
  scientific: 0,
  entered: 1,
  synonym: 2,
  common: 3,
  genus: 4,
}

/**
 * Prepara la colección (todas las plantas, también las dadas de baja) para
 * responder. Normaliza cada nombre una vez y agrupa las plantas que lo
 * comparten: con muchas plantas de pocas especies, se compara cada nombre una
 * sola vez. Hay que volver a crearlo cuando cambian las plantas.
 */
export function buildOwnershipIndex(
  plants: readonly CollectionPlant[],
  extras: OwnershipExtras = {},
): OwnershipIndex {
  const names = new Map<string, NameEntry>()
  const genera = new Map<string, GenusEntry>()
  const bySpecies = new Map<string, CollectionPlant[]>()

  const add = (
    plant: CollectionPlant,
    name: string,
    kind: OwnershipNameKind,
  ) => {
    const words = searchWords(name)
    if (words.length === 0) return
    const key = words.join(' ')
    const entry = names.get(key) ?? { words, refs: [] }
    if (!names.has(key)) names.set(key, entry)
    // Cada planta, una vez por nombre: con el tipo de nombre preferido.
    const existing = entry.refs.find((ref) => ref.plant === plant)
    if (existing === undefined) {
      entry.refs.push({ plant, matchedName: name, kind })
    } else if (KIND_RANK[kind] < KIND_RANK[existing.kind]) {
      existing.kind = kind
      existing.matchedName = name
    }
  }

  for (const plant of plants) {
    if (plant.species !== null) {
      const linked = bySpecies.get(plant.species.id)
      if (linked) linked.push(plant)
      else bySpecies.set(plant.species.id, [plant])
      add(plant, plant.species.scientificName, 'scientific')
      for (const extra of extras.speciesNames?.get(plant.species.id) ?? []) {
        add(plant, extra.name, extra.type)
      }
    }
    add(plant, plant.enteredName, 'entered')
    const genusWords = searchWords(plant.genus.name)
    const enteredWords = searchWords(plant.enteredName)
    if (
      plant.species === null &&
      enteredWords.length > 0 &&
      genusWords.length > 0 &&
      enteredWords[0] !== genusWords[0]
    ) {
      add(plant, `${plant.genus.name} ${plant.enteredName}`, 'entered')
    }

    const genus = genera.get(plant.genus.id)
    if (genus) genus.plants.push(plant)
    else {
      genera.set(plant.genus.id, {
        genus: plant.genus,
        words: genusWords,
        abbreviations: (extras.genusAbbreviations?.get(plant.genus.id) ?? [])
          .map((abbreviation) => searchWords(abbreviation).join(' '))
          .filter((abbreviation) => abbreviation !== ''),
        plants: [plant],
      })
    }
  }

  return { names, genera: [...genera.values()], bySpecies }
}

// Respuesta ----------------------------------------------------------------

function isActive(plant: CollectionPlant): boolean {
  return plant.status === 'active'
}

function compareMatches(a: OwnershipMatch, b: OwnershipMatch): number {
  return (
    QUALITY_RANK[a.quality] - QUALITY_RANK[b.quality] ||
    compareNames(a.plant.displayName, b.plant.displayName) ||
    (a.plant.id < b.plant.id ? -1 : a.plant.id > b.plant.id ? 1 : 0)
  )
}

function isStrong(match: OwnershipMatch): boolean {
  return match.quality !== 'similar'
}

/**
 * Decide la respuesta a partir de todas las coincidencias (una por planta):
 * los activos fuertes dan "owned"; si no hay, los activos parecidos dan
 * "similar"; si tampoco, "not-owned". Los dados de baja van a pastMatches con
 * el mismo criterio: los fuertes si hay alguno, si no los parecidos.
 */
export function decideOwnership(
  key: string,
  all: Iterable<OwnershipMatch>,
  scope: Ownership['scope'] = 'species',
  genera: readonly OwnershipGenusCount[] = [],
): Ownership {
  const sorted = [...all].sort(compareMatches)
  const active = sorted.filter((match) => isActive(match.plant))
  const past = sorted.filter((match) => !isActive(match.plant))
  const activeStrong = active.filter(isStrong)
  const pastStrong = past.filter(isStrong)
  const outcome: OwnershipOutcome =
    activeStrong.length > 0
      ? 'owned'
      : active.length > 0
        ? 'similar'
        : 'not-owned'
  return {
    key,
    outcome,
    scope,
    matches: activeStrong.length > 0 ? activeStrong : active,
    pastMatches: pastStrong.length > 0 ? pastStrong : past,
    genera,
  }
}

/** Añade una coincidencia, quedándose con la mejor de cada planta. */
export function addMatch(
  best: Map<string, OwnershipMatch>,
  match: OwnershipMatch,
): void {
  const current = best.get(match.plant.id)
  if (
    current === undefined ||
    QUALITY_RANK[match.quality] < QUALITY_RANK[current.quality] ||
    (match.quality === current.quality &&
      KIND_RANK[match.kind] < KIND_RANK[current.kind])
  ) {
    best.set(match.plant.id, match)
  }
}

/**
 * Las formas en que se busca: la escrita y, si su primera palabra es una
 * abreviatura conocida de un género de la colección, la expandida.
 */
function queryForms(
  words: readonly string[],
  index: OwnershipIndex,
): (readonly string[])[] {
  const forms: (readonly string[])[] = [words]
  for (const genus of index.genera) {
    if (genus.abbreviations.includes(words[0]) && genus.words.length > 0) {
      forms.push([...genus.words, ...words.slice(1)])
    }
  }
  return forms
}

/**
 * Responde "¿Ya la tengo?" para `query` sobre la colección indexada, o null
 * si la búsqueda no basta para responder (ver prepareOwnershipQuery).
 */
export function answerOwnership(
  index: OwnershipIndex,
  query: string,
): Ownership | null {
  const words = prepareOwnershipQuery(query)
  if (words === null) return null
  const key = words.join(' ')
  const anywhere = [...key].length >= ANYWHERE_MIN_LENGTH
  const forms = queryForms(words, index)

  // Por género: la búsqueda entera es un género de la colección o una de sus
  // abreviaturas. Ganan los géneros que mejor coinciden.
  const genusMatches: { entry: GenusEntry; quality: OwnershipMatchQuality }[] =
    []
  for (const entry of index.genera) {
    let quality: OwnershipMatchQuality | null = entry.abbreviations.includes(
      key,
    )
      ? 'exact'
      : null
    if (quality === null && words.length === entry.words.length) {
      quality = matchWords(words, entry.words, false)
    }
    if (quality !== null) genusMatches.push({ entry, quality })
  }
  if (genusMatches.length > 0) {
    const bestRank = Math.min(
      ...genusMatches.map(({ quality }) => QUALITY_RANK[quality]),
    )
    const chosen = genusMatches
      .filter(({ quality }) => QUALITY_RANK[quality] === bestRank)
      .sort((a, b) => compareNames(a.entry.genus.name, b.entry.genus.name))
    const all: OwnershipMatch[] = chosen.flatMap(({ entry, quality }) =>
      entry.plants.map((plant) => ({
        plant,
        matchedName: entry.genus.name,
        kind: 'genus' as const,
        quality,
      })),
    )
    return decideOwnership(
      key,
      all,
      'genus',
      chosen.map(({ entry }) => ({
        genus: entry.genus,
        activeCount: entry.plants.filter(isActive).length,
      })),
    )
  }

  const best = new Map<string, OwnershipMatch>()
  for (const entry of index.names.values()) {
    let quality: OwnershipMatchQuality | null = null
    for (const form of forms) {
      const formQuality = matchWords(form, entry.words, anywhere)
      if (formQuality !== null) {
        quality = quality === null ? formQuality : better(quality, formQuality)
      }
    }
    if (quality === null) continue
    for (const ref of entry.refs) {
      addMatch(best, {
        plant: ref.plant,
        matchedName: ref.matchedName,
        kind: ref.kind,
        quality,
      })
    }
  }
  return decideOwnership(key, best.values())
}

// Con el catálogo (#124) ------------------------------------------------------

/**
 * Una especie que devolvió la búsqueda del catálogo (search_species, #7), con
 * el nombre por el que coincidió. Es un subconjunto de SpeciesSearchResult
 * (lib/catalogSearch.ts), para no atar la colección al cliente de la red.
 */
export interface CatalogSpeciesMatch {
  id: string
  scientificName: string
  genusName: string
  matchedName: string
  matchedNameType: 'scientific' | 'synonym' | 'common'
}

/**
 * Cómo coincide `query` con una especie del catálogo, con las mismas reglas
 * que la búsqueda local: por el nombre por el que coincidió en el catálogo o
 * por su nombre científico. Si la primera palabra puede ser una abreviatura
 * de su género (el catálogo las expande: "Blc." → Brassolaeliocattleya), se
 * prueba también con el género escrito entero. Null si no coincide: el
 * catálogo encuentra por similitud cosas más lejanas (umbral 0,3) de las que
 * aquí se aceptan, y una respuesta "Sí" no puede basarse en ellas.
 */
export function catalogMatchQuality(
  query: string,
  species: CatalogSpeciesMatch,
): OwnershipMatchQuality | null {
  const words = prepareOwnershipQuery(query)
  if (words === null) return null
  const anywhere = [...words.join(' ')].length >= ANYWHERE_MIN_LENGTH
  const forms: (readonly string[])[] = [words]
  if (looksLikeAbbreviation(words[0], species.genusName)) {
    forms.push([...searchWords(species.genusName), ...words.slice(1)])
  }
  let best: OwnershipMatchQuality | null = null
  for (const name of new Set([species.matchedName, species.scientificName])) {
    const nameWords = searchWords(name)
    for (const form of forms) {
      const quality = matchWords(form, nameWords, anywhere)
      if (quality !== null)
        best = best === null ? quality : better(best, quality)
    }
  }
  return best
}

/** La respuesta local mejorada con el catálogo. */
export interface CatalogOwnership {
  ownership: Ownership
  /** Si el catálogo añadió o mejoró alguna coincidencia. */
  improved: boolean
  /**
   * Nombre científico del catálogo para "Aún no la tienes", si lo escrito
   * corresponde a una sola especie (sin errores de tipeo); null si no.
   */
  catalogName: string | null
}

/**
 * Mejora la respuesta local con las especies que encontró el catálogo (#124):
 * un sinónimo o un nombre común de una especie que el usuario tiene enlazada
 * en alguna planta responde "Sí". Solo añade coincidencias, nunca quita: un
 * "Sí" local sigue siendo "Sí" y las parecidas solo pueden pasar a "Sí" por
 * una coincidencia más fuerte. Las respuestas por género no se tocan.
 */
export function withCatalog(
  local: Ownership,
  index: OwnershipIndex,
  query: string,
  results: readonly CatalogSpeciesMatch[],
): CatalogOwnership {
  if (local.scope === 'genus' || results.length === 0) {
    return { ownership: local, improved: false, catalogName: null }
  }
  const best = new Map<string, OwnershipMatch>()
  for (const match of [...local.matches, ...local.pastMatches]) {
    best.set(match.plant.id, match)
  }
  const strongSpecies: CatalogSpeciesMatch[] = []
  let improved = false
  for (const species of results) {
    const quality = catalogMatchQuality(query, species)
    if (quality === null) continue
    if (quality !== 'similar') strongSpecies.push(species)
    for (const plant of index.bySpecies.get(species.id) ?? []) {
      const before = best.get(plant.id)
      addMatch(best, {
        plant,
        matchedName: species.matchedName,
        kind: species.matchedNameType,
        quality,
      })
      if (best.get(plant.id) !== before) improved = true
    }
  }
  const ownership = improved ? decideOwnership(local.key, best.values()) : local
  const catalogName =
    ownership.outcome === 'not-owned' && strongSpecies.length === 1
      ? strongSpecies[0].scientificName
      : null
  return { ownership, improved, catalogName }
}
