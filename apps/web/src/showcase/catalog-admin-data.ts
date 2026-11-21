import type { CatalogAdminSource } from '../backoffice/source.ts'
import {
  CATALOG_PAGE_SIZE,
  CatalogAdminError,
  SPECIES_HISTORY_PAGE_SIZE,
  type AuditRowChange,
  type AuditValues,
  type CatalogAdminFailure,
  type CatalogGenusRow,
  type CatalogGenusDetail,
  type CatalogSpeciesDetail,
  type CatalogSpeciesRow,
  type SpeciesHistoryEntry,
} from '../lib/catalogAdmin.ts'
import {
  cleanCatalogText,
  cleanGenusName,
  CatalogWriteError,
  withFinalDot,
  MAX_BATCH_SPECIES,
  validateSpeciesInput,
  type CatalogWriteProblem,
  type SpeciesInput,
  type WrittenSpecies,
} from '../lib/catalogWrites.ts'
import type { GenusSearchResult } from '../lib/catalogSearch.ts'
import type {
  SpeciesNameType,
  SpeciesSource,
  SpeciesStatus,
  SpeciesType,
} from '../lib/database.ts'

// Catálogo de muestra para ver la pantalla del backoffice (/muestra) sin base
// de datos: unas 150 especies de nueve géneros con nombres reales, sinónimos y
// nombres comunes, y una fuente en memoria con la misma forma que la de
// Supabase (CatalogAdminSource). Pagina como la base (por clave sin texto, por
// número con texto), pero la búsqueda es solo una aproximación: compara por
// prefijo de palabras y, si nada empieza así, por contener el texto; no
// tolera errores de tipeo como la de verdad. Las escrituras cambian el
// catálogo en memoria con las mismas reglas que la base (nombre único sin
// distinguir mayúsculas ni el signo «×», baja solo sin plantas...), hasta que
// se cambia de escenario. Cada escritura deja su entrada en el historial de
// la especie, como la auditoría de la base; la primera especie trae además
// unas entradas de ejemplo (una carga, una edición y una fusión).

interface SampleGenus {
  id: string
  name: string
  abbreviations: string[]
  isQuickAccess: boolean
}

interface SampleName {
  name: string
  type: SpeciesNameType
  language: string | null
}

interface SampleSpecies {
  id: string
  scientificName: string
  genusId: string
  type: SpeciesType
  status: SpeciesStatus
  source: SpeciesSource
  sourceRef: string | null
  names: SampleName[]
  plants: number
}

function uuid(prefix: number, index: number): string {
  const hex = (prefix * 10000 + index).toString(16).padStart(12, '0')
  return `00000000-0000-4000-8000-${hex}`
}

const GENERA: SampleGenus[] = [
  ['Phalaenopsis', ['Phal.'], true],
  ['Cattleya', ['C.'], true],
  ['Dendrobium', ['Den.'], true],
  ['Oncidium', ['Onc.'], true],
  ['Vanda', ['V.'], true],
  ['Masdevallia', ['Masd.'], false],
  ['Paphiopedilum', ['Paph.'], false],
  ['Bulbophyllum', ['Bulb.'], false],
  ['× Rhyncholaeliocattleya', ['Rlc.'], false],
].map(([name, abbreviations, isQuickAccess], index) => ({
  id: uuid(1, index),
  name: name as string,
  abbreviations: abbreviations as string[],
  isQuickAccess: isQuickAccess as boolean,
}))

const EPITHETS: Record<string, string[]> = {
  Phalaenopsis: [
    'amabilis',
    'aphrodite',
    'bellina',
    'cornu-cervi',
    'equestris',
    '× intermedia',
    'lueddemanniana',
    'pulcherrima',
    'schilleriana',
    'stuartiana',
    'violacea',
    'gigantea',
    'lobbii',
    'mannii',
    'tetraspis',
    'wilsonii',
  ],
  Cattleya: [
    'labiata',
    'mossiae',
    'purpurata',
    'trianae',
    'warscewiczii',
    'walkeriana',
    'intermedia',
    'aclandiae',
    'dowiana',
    '× elegans',
    'percivaliana',
    'skinneri',
    'aurantiaca',
    'bicolor',
    'guttata',
    'jenmanii',
    'lueddemanniana',
    'maxima',
    'nobilior',
    'schilleriana',
  ],
  Dendrobium: [
    'nobile',
    'aphyllum',
    'chrysotoxum',
    'densiflorum',
    'farmeri',
    'fimbriatum',
    'kingianum',
    'lindleyi',
    'moschatum',
    'parishii',
    'speciosum',
    'thyrsiflorum',
    'anosmum',
    'bigibbum',
    'cuthbertsonii',
    'crumenatum',
    'formosum',
    'harveyanum',
    'lituiflorum',
    'primulinum',
    'secundum',
    'spectabile',
    'victoriae-reginae',
    'wardianum',
    '× delicatum',
  ],
  Oncidium: [
    'sphacelatum',
    'flexuosum',
    'ornithorhynchum',
    'cheirophorum',
    'maculatum',
    'leucochilum',
    'altissimum',
    'baueri',
    'hastatum',
    'tigrinum',
    'cebolleta',
    'excavatum',
  ],
  Vanda: [
    'coerulea',
    'tricolor',
    'sanderiana',
    'tessellata',
    'luzonica',
    'denisoniana',
    'falcata',
    'lamellata',
    'liouvillei',
    'merrillii',
  ],
  Masdevallia: [
    'veitchiana',
    'coccinea',
    'ignea',
    'tovarensis',
    'infracta',
    'caudata',
    'davisii',
    'barlaeana',
    'herradurae',
    'mejiana',
  ],
  Paphiopedilum: [
    'insigne',
    'rothschildianum',
    'callosum',
    'barbatum',
    'fairrieanum',
    'spicerianum',
    'villosum',
    'delenatii',
    'armeniacum',
    'malipoense',
    'micranthum',
    'sukhakulii',
  ],
  Bulbophyllum: [
    'lobbii',
    'medusae',
    'echinolabium',
    'falcatum',
    'fascinator',
    'graveolens',
    'longissimum',
    'phalaenopsis',
    'rothschildianum',
    'wendlandianum',
    'ambrosia',
    'auricomum',
    'barbigerum',
    'blumei',
    'careyanum',
  ],
  '× Rhyncholaeliocattleya': [
    'Memoria Anna Balmores',
    'George King',
    'Hsinying Excell',
    'Owen Holmes',
  ],
}

const SYNONYMS: Record<string, string[]> = {
  'Phalaenopsis pulcherrima': ['Doritis pulcherrima', 'Doritis buyssoniana'],
  'Phalaenopsis amabilis': ['Phalaenopsis grandiflora', 'Epidendrum amabile'],
  'Cattleya purpurata': ['Laelia purpurata', 'Sophronitis purpurata'],
  'Cattleya skinneri': ['Guarianthe skinneri'],
  'Vanda coerulea': ['Vanda coerulea var. alba'],
  'Dendrobium nobile': ['Callista nobilis', 'Dendrobium coerulescens'],
  'Oncidium flexuosum': ['Oncidium haematochilum'],
}

const COMMON_NAMES: Record<string, [string, string][]> = {
  'Phalaenopsis amabilis': [
    ['orquídea mariposa', 'es'],
    ['moth orchid', 'en'],
  ],
  'Cattleya trianae': [['flor de mayo', 'es']],
  'Vanda coerulea': [
    ['vanda azul', 'es'],
    ['blue vanda', 'en'],
  ],
  'Oncidium sphacelatum': [['lluvia de oro', 'es']],
  'Masdevallia veitchiana': [['flor del inca', 'es']],
}

function buildSpecies(): SampleSpecies[] {
  const all: SampleSpecies[] = []
  let index = 0
  for (const genus of GENERA) {
    for (const epithet of EPITHETS[genus.name] ?? []) {
      index += 1
      const scientificName = `${genus.name} ${epithet}`
      const grex = /^[A-Z]/.test(epithet)
      const hybrid =
        grex || epithet.startsWith('×') || genus.name.startsWith('×')
      const status: SpeciesStatus =
        index % 11 === 0
          ? 'observed'
          : index % 7 === 0
            ? 'validated'
            : 'imported'
      const source: SpeciesSource = grex
        ? 'curated'
        : index % 23 === 0
          ? 'user_proposal'
          : index % 31 === 0
            ? 'gbif'
            : 'col'
      all.push({
        id: uuid(2, index),
        scientificName,
        genusId: genus.id,
        type: hybrid ? 'hybrid' : 'species',
        status,
        source,
        sourceRef:
          source === 'col'
            ? `4F${(index * 37).toString(36).toUpperCase()}`
            : source === 'gbif'
              ? String(2828000 + index)
              : null,
        names: [
          ...(SYNONYMS[scientificName] ?? []).map((name) => ({
            name,
            type: 'synonym' as const,
            language: null,
          })),
          ...(COMMON_NAMES[scientificName] ?? []).map(([name, language]) => ({
            name,
            type: 'common' as const,
            language,
          })),
        ],
        plants: index % 5 === 0 ? (index % 4) + 1 : 0,
      })
    }
  }
  return all
}

/** Texto para comparar y ordenar, como normalize_search_text() en la base. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/×/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^| )x(?= )/g, '')
    .trim()
}

function compareKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function startsByWords(name: string, query: string): boolean {
  const words = normalize(name).split(' ')
  const parts = query.split(' ')
  let position = 0
  return parts.every((part, index) => {
    if (index === 0) {
      if (!words[0]?.startsWith(part)) return false
      position = 1
      return true
    }
    while (position < words.length) {
      const word = words[position]
      position += 1
      if (word?.startsWith(part)) return true
    }
    return false
  })
}

let nextId = 0

function nameId(speciesId: string, index: number): string {
  return `${speciesId}-n${index}`
}

function abbreviationId(genusId: string, index: number): string {
  return `${genusId}-a${index}`
}

/** Id de usuario de Clerk inventado para el historial de muestra. */
const SAMPLE_ADMIN = 'user_2NxbVd1QeR5ZkT9mFh3LpA7sW8c'

/** Valores de una fila como los guarda la auditoría: solo los distintos. */
function diff(
  before: AuditValues,
  after: AuditValues,
): [AuditValues, AuditValues] | null {
  const oldValues: AuditValues = {}
  const newValues: AuditValues = {}
  for (const key of Object.keys(after)) {
    if (before[key] !== after[key]) {
      oldValues[key] = before[key] ?? null
      newValues[key] = after[key] ?? null
    }
  }
  return Object.keys(newValues).length === 0 ? null : [oldValues, newValues]
}

function speciesValues(item: SampleSpecies): AuditValues {
  return {
    id: item.id,
    scientific_name: item.scientificName,
    genus_id: item.genusId,
    type: item.type,
    status: item.status,
    source: item.source,
    source_ref: item.sourceRef,
  }
}

function nameValues(speciesId: string, name: SampleName): AuditValues {
  return {
    species_id: speciesId,
    name: name.name,
    type: name.type,
    language: name.language,
  }
}

const CREATED_AT = '2026-11-20T14:37:00Z'
const UPDATED_AT = '2026-11-21T08:15:00Z'

function toRow(
  species: SampleSpecies,
  match?: SampleName | null,
): CatalogSpeciesRow {
  const genus = GENERA.find((candidate) => candidate.id === species.genusId)
  return {
    id: species.id,
    scientificName: species.scientificName,
    genusId: species.genusId,
    genusName: genus?.name ?? '',
    type: species.type,
    status: species.status,
    source: species.source,
    sourceRef: species.sourceRef,
    synonymCount: species.names.filter((name) => name.type === 'synonym')
      .length,
    commonNameCount: species.names.filter((name) => name.type === 'common')
      .length,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...(match !== undefined && {
      matchedName: match?.name ?? species.scientificName,
      matchedNameType: match?.type ?? 'scientific',
    }),
  }
}

export type SampleScenario =
  'ejemplo' | 'cargando' | 'vacio' | 'sin-conexion' | 'fallo'

/**
 * Fuente en memoria para la muestra. Cada respuesta tarda `delayMs` (para ver
 * el estado de carga); "cargando" no responde nunca y los escenarios de error
 * fallan con ese motivo.
 */
export function createSampleCatalogSource(
  scenario: SampleScenario,
  delayMs = 400,
): CatalogAdminSource {
  const species: SampleSpecies[] = scenario === 'vacio' ? [] : buildSpecies()
  const genera: SampleGenus[] =
    scenario === 'vacio' ? [] : GENERA.map((genus) => ({ ...genus }))
  const sorted = () =>
    [...species].sort(
      (a, b) =>
        compareKey(normalize(a.scientificName), normalize(b.scientificName)) ||
        compareKey(a.id, b.id),
    )

  // Historial: una entrada por escritura, de la especie a la que se refiere.
  const history: { speciesId: string; entry: SpeciesHistoryEntry }[] = []
  const record = (
    speciesId: string,
    changes: AuditRowChange[],
    extra: Partial<SpeciesHistoryEntry> = {},
  ) => {
    const id = history.length + 1
    history.push({
      speciesId,
      entry: {
        id,
        actionId: `accion-de-muestra-${id}`,
        actor: SAMPLE_ADMIN,
        action: null,
        details: null,
        createdAt: new Date().toISOString(),
        changes,
        otherChangeCount: 0,
        genusNames: Object.fromEntries(
          genera.map((genus) => [genus.id, genus.name]),
        ),
        ...extra,
      },
    })
  }
  const firstSpecies = species[0]
  if (firstSpecies) {
    record(firstSpecies.id, [], {
      actor: 'carga-col26.10',
      action: 'catalog_import',
      createdAt: '2026-11-19T10:02:00Z',
    })
    record(
      firstSpecies.id,
      [
        {
          table: 'species',
          rowId: firstSpecies.id,
          action: 'update',
          // Una errata corregida.
          oldValues: {
            scientific_name: firstSpecies.scientificName.replace(/s$/, ''),
          },
          newValues: { scientific_name: firstSpecies.scientificName },
        },
      ],
      { createdAt: '2026-11-20T16:40:00Z' },
    )
    record(
      firstSpecies.id,
      [
        {
          table: 'species_names',
          rowId: `${firstSpecies.id}-fusion`,
          action: 'insert',
          oldValues: null,
          newValues: {
            species_id: firstSpecies.id,
            name: `${firstSpecies.scientificName} var. ficticia`,
            type: 'synonym',
            language: null,
          },
        },
      ],
      {
        action: 'merge_species',
        otherChangeCount: 2,
        createdAt: '2026-11-21T08:15:00Z',
      },
    )
  }

  const reject = (
    problem: CatalogWriteProblem,
    details?: ConstructorParameters<typeof CatalogWriteError>[1],
  ): never => {
    throw new CatalogWriteError(problem, details)
  }
  const findSpecies = (id: string) =>
    species.find((item) => item.id === id) ?? reject('species-not-found')
  const checkSpecies = (input: SpeciesInput, exceptId: string | null) => {
    const invalid = validateSpeciesInput(input)
    if (invalid) throw invalid
    const name = cleanCatalogText(input.scientificName)
    if (!genera.some((genus) => genus.id === input.genusId))
      reject('genus-not-found')
    const others = species.filter((item) => item.id !== exceptId)
    const same = others.find(
      (item) => item.scientificName.toLowerCase() === name.toLowerCase(),
    )
    if (same) reject('duplicate-name', { existingName: same.scientificName })
    const similar = others.find(
      (item) => normalize(item.scientificName) === normalize(name),
    )
    if (similar)
      reject('similar-name', { existingName: similar.scientificName })
    return name
  }
  // Nombres y abreviaturas no tienen id propio en la muestra: se identifican
  // por su posición, que la pantalla vuelve a leer tras cada cambio.
  const findName = (id: string): [SampleSpecies, number] => {
    for (const item of species) {
      const index = item.names.findIndex(
        (_, position) => nameId(item.id, position) === id,
      )
      if (index !== -1) return [item, index]
    }
    return reject('name-not-found')
  }
  const checkName = (
    item: SampleSpecies,
    value: string,
    exceptIndex: number | null,
  ) => {
    const name = cleanCatalogText(value)
    if (name === '') reject('name-required')
    if (name.toLowerCase() === item.scientificName.toLowerCase())
      reject('name-is-scientific-name')
    const others = item.names.filter((_, index) => index !== exceptIndex)
    const same = others.find(
      (other) => other.name.toLowerCase() === name.toLowerCase(),
    )
    if (same)
      reject('duplicate-alternative-name', {
        existingName: same.name,
        existingType: same.type,
      })
    const similar = others.find(
      (other) => normalize(other.name) === normalize(name),
    )
    if (similar)
      reject('similar-alternative-name', { existingName: similar.name })
    return name
  }
  const findGenus = (id: string) =>
    genera.find((genus) => genus.id === id) ?? reject('genus-not-found')
  const checkGenus = (value: string, exceptId: string | null) => {
    const name = cleanGenusName(value)
    if (name === '') reject('name-required')
    if (!/^(× )?[^\s×]+$/.test(name)) reject('invalid-genus-name')
    const others = genera.filter((genus) => genus.id !== exceptId)
    const same = others.find(
      (genus) => genus.name.toLowerCase() === name.toLowerCase(),
    )
    if (same) reject('duplicate-genus', { existingName: same.name })
    const similar = others.find(
      (genus) => normalize(genus.name) === normalize(name),
    )
    if (similar) reject('similar-genus', { existingName: similar.name })
    return name
  }
  const findAbbreviation = (id: string): [SampleGenus, number] => {
    for (const genus of genera) {
      const index = genus.abbreviations.findIndex(
        (_, position) => abbreviationId(genus.id, position) === id,
      )
      if (index !== -1) return [genus, index]
    }
    return reject('abbreviation-not-found')
  }
  const checkAbbreviation = (value: string, exceptId: string | null) => {
    const text = withFinalDot(value)
    if (text === '') reject('name-required')
    if (!/^[^\s.]+\.$/.test(text)) reject('invalid-abbreviation')
    const key = normalize(text).replace(/\.$/, '')
    for (const genus of genera) {
      genus.abbreviations.forEach((abbreviation, index) => {
        if (
          abbreviationId(genus.id, index) !== exceptId &&
          normalize(abbreviation).replace(/\.$/, '') === key
        )
          reject('abbreviation-taken', {
            genusName: genus.name,
            genusId: genus.id,
            existingAbbreviation: abbreviation,
          })
      })
    }
    return text
  }
  const written = (item: SampleSpecies): WrittenSpecies => ({
    id: item.id,
    scientificName: item.scientificName,
    genusId: item.genusId,
    type: item.type,
    status: item.status,
    source: item.source,
    sourceRef: item.sourceRef,
  })

  function respond<T>(signal: AbortSignal | undefined, value: () => T) {
    return new Promise<T>((resolve, reject) => {
      if (scenario === 'cargando') return
      const fail = (reason: CatalogAdminFailure) =>
        reject(new CatalogAdminError(reason))
      const timer = setTimeout(() => {
        if (scenario === 'sin-conexion') fail('offline')
        else if (scenario === 'fallo') fail('failed')
        else {
          try {
            resolve(value())
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)))
          }
        }
      }, delayMs)
      signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        fail('aborted')
      })
    })
  }

  const matches = (
    filters: Parameters<CatalogAdminSource['listSpecies']>[0],
  ) => {
    const f = filters?.filters ?? {}
    return (item: SampleSpecies) =>
      (!f.status || item.status === f.status) &&
      (!f.genusId || item.genusId === f.genusId) &&
      (!f.type || item.type === f.type) &&
      (!f.source || item.source === f.source)
  }

  return {
    listSpecies: (options = {}) =>
      respond(options.signal, () => {
        const list = sorted().filter(matches(options))
        const size = options.pageSize ?? CATALOG_PAGE_SIZE
        const cursor = options.cursor ?? { kind: 'first' }
        let start = 0
        let end = size
        if (cursor.kind === 'after') {
          const at = list.findIndex((item) => item.id === cursor.id)
          start = at + 1
          end = start + size
        } else if (cursor.kind === 'before') {
          const at = list.findIndex((item) => item.id === cursor.id)
          end = at === -1 ? size : at
          start = Math.max(end - size, 0)
        } else if (cursor.kind === 'last') {
          end = list.length
          start =
            list.length === 0
              ? 0
              : list.length - (((list.length - 1) % size) + 1)
        }
        const page = list.slice(start, end)
        return {
          rows: page.map((item) => toRow(item)),
          total: page.length === 0 ? 0 : list.length,
          hasPrevious: start > 0,
          hasNext: end < list.length,
        }
      }),
    searchSpecies: (query, options = {}) =>
      respond(options.signal, () => {
        const text = normalize(query)
        const filter = matches(options)
        const found: { item: SampleSpecies; match: SampleName | null }[] = []
        for (const item of sorted().filter(filter)) {
          if (startsByWords(item.scientificName, text)) {
            found.push({ item, match: null })
          }
        }
        for (const item of sorted().filter(filter)) {
          if (found.some((entry) => entry.item === item)) continue
          const name = item.names.find((candidate) =>
            startsByWords(candidate.name, text),
          )
          if (name) found.push({ item, match: name })
        }
        if (found.length === 0) {
          for (const item of sorted().filter(filter)) {
            if (normalize(item.scientificName).includes(text)) {
              found.push({ item, match: null })
            }
          }
        }
        const size = options.pageSize ?? CATALOG_PAGE_SIZE
        const pageCount = Math.max(Math.ceil(found.length / size), 1)
        const page = Math.min(Math.max(options.page ?? 1, 1), pageCount)
        return {
          rows: found
            .slice((page - 1) * size, page * size)
            .map(({ item, match }) => toRow(item, match)),
          total: found.length,
          page,
        }
      }),
    listGenera: (options = {}) =>
      respond(options.signal, () => {
        const text = normalize(options.query ?? '')
        const list = [...genera]
          .sort((a, b) => compareKey(normalize(a.name), normalize(b.name)))
          .filter(
            (genus) =>
              (!options.quickAccessOnly || genus.isQuickAccess) &&
              (text === '' ||
                normalize(genus.name).includes(text) ||
                genus.abbreviations.some(
                  (abbreviation) =>
                    normalize(abbreviation).replace(/\.$/, '') ===
                    text.replace(/\.$/, ''),
                )),
          )
        const size = options.pageSize ?? CATALOG_PAGE_SIZE
        const pageCount = Math.max(Math.ceil(list.length / size), 1)
        const page = Math.min(Math.max(options.page ?? 1, 1), pageCount)
        return {
          rows: list
            .slice((page - 1) * size, page * size)
            .map((genus): CatalogGenusRow => ({
              id: genus.id,
              name: genus.name,
              isQuickAccess: genus.isQuickAccess,
              abbreviations: genus.abbreviations,
              speciesCount: species.filter((item) => item.genusId === genus.id)
                .length,
            })),
          total: list.length,
          page,
        }
      }),
    summary: (options = {}) =>
      respond(options.signal, () => {
        const count = (test: (item: SampleSpecies) => boolean) =>
          species.filter(test).length
        const names = species.flatMap((item) => item.names)
        return {
          genusCount: genera.length,
          speciesCount: count((item) => item.type === 'species'),
          hybridCount: count((item) => item.type === 'hybrid'),
          synonymCount: names.filter((name) => name.type === 'synonym').length,
          commonNameCount: names.filter((name) => name.type === 'common')
            .length,
          byStatus: {
            imported: count((item) => item.status === 'imported'),
            validated: count((item) => item.status === 'validated'),
            observed: count((item) => item.status === 'observed'),
          },
          bySource: {
            col: count((item) => item.source === 'col'),
            curated: count((item) => item.source === 'curated'),
            user_proposal: count((item) => item.source === 'user_proposal'),
            gbif: count((item) => item.source === 'gbif'),
          },
        }
      }),
    speciesDetail: (id, options = {}) =>
      respond(options.signal, (): CatalogSpeciesDetail | null => {
        const item = species.find((candidate) => candidate.id === id)
        if (!item) return null
        const row = toRow(item)
        return {
          id: row.id,
          scientificName: row.scientificName,
          genusId: row.genusId,
          genusName: row.genusName,
          type: row.type,
          status: row.status,
          source: row.source,
          sourceRef: row.sourceRef,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          names: item.names.map((name, index) => ({
            id: nameId(item.id, index),
            ...name,
          })),
        }
      }),
    plantCount: (id, options = {}) =>
      respond(
        options.signal,
        () => species.find((item) => item.id === id)?.plants ?? 0,
      ),
    speciesHistory: (id, options = {}) =>
      respond(options.signal, () => {
        const size = options.pageSize ?? SPECIES_HISTORY_PAGE_SIZE
        const before = options.before
        const list = history
          .filter(
            (item) =>
              item.speciesId === id &&
              (before === undefined || item.entry.id < before),
          )
          .map((item) => item.entry)
          .sort((a, b) => b.id - a.id)
        return { entries: list.slice(0, size), hasMore: list.length > size }
      }),
    genus: (id, options = {}) =>
      respond(options.signal, () => {
        const genus = genera.find((candidate) => candidate.id === id)
        return genus ? { id: genus.id, name: genus.name } : null
      }),
    searchGenera: (query, options = {}) =>
      respond(options.signal, () => {
        const text = normalize(query).replace(/\.$/, '')
        return genera
          .filter(
            (genus) =>
              normalize(genus.name).startsWith(text) ||
              genus.abbreviations.some(
                (abbreviation) =>
                  normalize(abbreviation).replace(/\.$/, '') === text,
              ),
          )
          .map((genus): GenusSearchResult => ({
            id: genus.id,
            name: genus.name,
            isQuickAccess: genus.isQuickAccess,
            matchedAbbreviation:
              genus.abbreviations.find(
                (abbreviation) =>
                  normalize(abbreviation).replace(/\.$/, '') === text,
              ) ?? null,
          }))
      }),
    genusDetail: (id, options = {}) =>
      respond(options.signal, (): CatalogGenusDetail | null => {
        const genus = genera.find((candidate) => candidate.id === id)
        if (!genus) return null
        return {
          id: genus.id,
          name: genus.name,
          isQuickAccess: genus.isQuickAccess,
          abbreviations: genus.abbreviations.map((abbreviation, index) => ({
            id: abbreviationId(genus.id, index),
            abbreviation,
          })),
          speciesCount: species.filter((item) => item.genusId === genus.id)
            .length,
        }
      }),
    addName: (speciesId, input) =>
      respond(undefined, () => {
        const item = findSpecies(speciesId)
        const name = checkName(item, input.name, null)
        const entry: SampleName = {
          name,
          type: input.type,
          language:
            input.type === 'common' ? input.language?.trim() || null : null,
        }
        item.names.push(entry)
        record(item.id, [
          {
            table: 'species_names',
            rowId: nameId(item.id, item.names.length - 1),
            action: 'insert',
            oldValues: null,
            newValues: nameValues(item.id, entry),
          },
        ])
        return {
          id: nameId(item.id, item.names.length - 1),
          speciesId: item.id,
          ...entry,
        }
      }),
    updateName: (id, input) =>
      respond(undefined, () => {
        const [item, index] = findName(id)
        const name = checkName(item, input.name, index)
        const entry: SampleName = {
          name,
          type: input.type,
          language:
            input.type === 'common' ? input.language?.trim() || null : null,
        }
        const before = item.names[index]
        const changed = before
          ? diff(nameValues(item.id, before), nameValues(item.id, entry))
          : null
        item.names[index] = entry
        if (changed)
          record(item.id, [
            {
              table: 'species_names',
              rowId: id,
              action: 'update',
              oldValues: changed[0],
              newValues: changed[1],
            },
          ])
        return { id, speciesId: item.id, ...entry }
      }),
    deleteName: (id) =>
      respond(undefined, () => {
        const [item, index] = findName(id)
        const [removed] = item.names.splice(index, 1)
        if (removed)
          record(item.id, [
            {
              table: 'species_names',
              rowId: id,
              action: 'delete',
              oldValues: nameValues(item.id, removed),
              newValues: null,
            },
          ])
      }),
    createGenus: (input) =>
      respond(undefined, () => {
        const name = checkGenus(input.name, null)
        nextId += 1
        const genus: SampleGenus = {
          id: uuid(4, nextId),
          name,
          abbreviations: [],
          isQuickAccess: input.isQuickAccess,
        }
        genera.push(genus)
        return { id: genus.id, name, isQuickAccess: genus.isQuickAccess }
      }),
    updateGenus: (id, input) =>
      respond(undefined, () => {
        const genus = findGenus(id)
        const name = cleanGenusName(input.name)
        if (name !== genus.name) checkGenus(name, id)
        genus.name = name
        genus.isQuickAccess = input.isQuickAccess
        return { id, name, isQuickAccess: genus.isQuickAccess }
      }),
    deleteGenus: (id) =>
      respond(undefined, () => {
        const genus = findGenus(id)
        const count = species.filter((item) => item.genusId === id).length
        if (count > 0) reject('genus-has-species', { speciesCount: count })
        genera.splice(genera.indexOf(genus), 1)
      }),
    addAbbreviation: (genusId, abbreviation) =>
      respond(undefined, () => {
        const genus = findGenus(genusId)
        const text = checkAbbreviation(abbreviation, null)
        genus.abbreviations.push(text)
        return {
          id: abbreviationId(genus.id, genus.abbreviations.length - 1),
          genusId,
          abbreviation: text,
        }
      }),
    updateAbbreviation: (id, abbreviation) =>
      respond(undefined, () => {
        const [genus, index] = findAbbreviation(id)
        const text = checkAbbreviation(abbreviation, id)
        genus.abbreviations[index] = text
        return { id, genusId: genus.id, abbreviation: text }
      }),
    deleteAbbreviation: (id) =>
      respond(undefined, () => {
        const [genus, index] = findAbbreviation(id)
        genus.abbreviations.splice(index, 1)
      }),
    createSpecies: (input) =>
      respond(undefined, () => {
        const name = checkSpecies(input, null)
        if (input.status === 'imported') reject('invalid-status')
        nextId += 1
        const item: SampleSpecies = {
          id: uuid(3, nextId),
          scientificName: name,
          genusId: input.genusId ?? '',
          type: input.type,
          status: input.status,
          source: 'curated',
          sourceRef: null,
          names: [],
          plants: 0,
        }
        species.push(item)
        record(item.id, [
          {
            table: 'species',
            rowId: item.id,
            action: 'insert',
            oldValues: null,
            newValues: speciesValues(item),
          },
        ])
        return written(item)
      }),
    updateSpecies: (id, input) =>
      respond(undefined, () => {
        const item = findSpecies(id)
        const name = cleanCatalogText(input.scientificName)
        if (name !== item.scientificName) checkSpecies(input, id)
        else {
          const invalid = validateSpeciesInput(input)
          if (invalid) throw invalid
        }
        const before = speciesValues(item)
        const changed =
          name !== item.scientificName ||
          input.genusId !== item.genusId ||
          input.type !== item.type
        item.scientificName = name
        item.genusId = input.genusId ?? item.genusId
        item.type = input.type
        // Como el disparador de la base: una importada editada pasa a validada.
        item.status =
          changed && item.status === 'imported' && input.status === 'imported'
            ? 'validated'
            : input.status
        const values = diff(before, speciesValues(item))
        if (values)
          record(item.id, [
            {
              table: 'species',
              rowId: item.id,
              action: 'update',
              oldValues: values[0],
              newValues: values[1],
            },
          ])
        return written(item)
      }),
    setSpeciesStatus: (ids, status) =>
      respond(undefined, () => {
        const unique = [...new Set(ids)]
        if (unique.length === 0) reject('no-species')
        if (unique.length > MAX_BATCH_SPECIES)
          reject('too-many-species', { max: MAX_BATCH_SPECIES })
        const items = species.filter((item) => unique.includes(item.id))
        if (items.length < unique.length)
          reject('species-not-found', {
            missingCount: unique.length - items.length,
          })
        const changing = items.filter((item) => item.status !== status)
        for (const item of changing) {
          record(
            item.id,
            [
              {
                table: 'species',
                rowId: item.id,
                action: 'update',
                oldValues: { status: item.status },
                newValues: { status },
              },
            ],
            { otherChangeCount: changing.length - 1 },
          )
          item.status = status
        }
        return changing.length
      }),
    deleteSpecies: (id) =>
      respond(undefined, () => {
        const item = findSpecies(id)
        if (item.plants > 0)
          reject('species-has-plants', { plantCount: item.plants })
        record(item.id, [
          {
            table: 'species',
            rowId: item.id,
            action: 'delete',
            oldValues: speciesValues(item),
            newValues: null,
          },
        ])
        species.splice(species.indexOf(item), 1)
      }),
  }
}
