import { describe, expect, it } from 'vitest'
import {
  CATTLEYA,
  PHALAENOPSIS,
  plant,
  RHYNCHOLAELIOCATTLEYA,
} from '../test/collection.ts'
import type { CollectionPlant } from './model.ts'
import {
  answerOwnership,
  buildOwnershipIndex,
  looksLikeAbbreviation,
  matchWords,
  prepareOwnershipQuery,
  type OwnershipExtras,
} from './ownership.ts'

const MASDEVALLIA = { id: 'genus-masd', name: 'Masdevallia' }
const MAXILLARIA = { id: 'genus-max', name: 'Maxillaria' }
const DENDROBIUM = { id: 'genus-den', name: 'Dendrobium' }

function species(
  id: string,
  scientificName: string,
  type: 'species' | 'hybrid' = 'species',
) {
  return { id, scientificName, type, status: 'validated' as const }
}

// Una colección realista: varias especies, ejemplares repetidos, un nombre por
// validar, híbridos con "×" y plantas perdidas o regaladas.
const amabilis1 = plant({ nickname: 'La blanca', origin: 'Vivero Los Andes' })
const amabilis2 = plant()
const maxima = plant({
  displayName: 'Cattleya maxima',
  enteredName: 'Cattleya maxima',
  species: species('species-maxima', 'Cattleya maxima'),
  genus: CATTLEYA,
})
const labiataLost = plant({
  displayName: 'Cattleya labiata',
  enteredName: 'Cattleya labiata',
  species: species('species-labiata', 'Cattleya labiata'),
  genus: CATTLEYA,
  status: 'lost',
})
// Por validar e ingresada solo con el epíteto.
const trianae = plant({
  displayName: 'trianae',
  displayNameIsScientific: false,
  enteredName: 'trianae',
  species: null,
  genus: CATTLEYA,
  validation: 'pending',
})
const rlc = plant({
  displayName: '× Rhyncholaeliocattleya Memoria Anna Balmores',
  enteredName: 'Rlc. Memoria Anna Balmores',
  species: species(
    'species-rlc',
    '× Rhyncholaeliocattleya Memoria Anna Balmores',
    'hybrid',
  ),
  genus: RHYNCHOLAELIOCATTLEYA,
  type: 'hybrid',
})
const intermediaGifted = plant({
  displayName: 'Phalaenopsis × intermedia',
  enteredName: 'Phalaenopsis × intermedia',
  species: species('species-intermedia', 'Phalaenopsis × intermedia', 'hybrid'),
  status: 'gifted',
})
const tenuifolia = plant({
  displayName: 'Maxillaria tenuifolia',
  displayNameIsScientific: false,
  enteredName: 'Maxillaria tenuifólia',
  species: null,
  genus: MAXILLARIA,
  validation: 'pending',
})
const nobile = plant({
  displayName: 'Dendrobium nobile',
  enteredName: 'Den. nobile',
  species: species('species-nobile', 'Dendrobium nobile'),
  genus: DENDROBIUM,
})
const veitchianaLost = plant({
  displayName: 'Masdevallia veitchiana',
  enteredName: 'Masdevallia veitchiana',
  species: species('species-veitchiana', 'Masdevallia veitchiana'),
  genus: MASDEVALLIA,
  status: 'lost',
})

const COLLECTION: readonly CollectionPlant[] = [
  amabilis1,
  amabilis2,
  maxima,
  labiataLost,
  trianae,
  rlc,
  intermediaGifted,
  tenuifolia,
  nobile,
  veitchianaLost,
]

const EXTRAS: OwnershipExtras = {
  speciesNames: new Map([
    [
      'species-amabilis',
      [
        { name: 'Phalaenopsis grandiflora', type: 'synonym' as const },
        { name: 'Orquídea luna', type: 'common' as const },
      ],
    ],
  ]),
  genusAbbreviations: new Map([['genus-rlc', ['Rlc.']]]),
}

const index = buildOwnershipIndex(COLLECTION)
const indexWithExtras = buildOwnershipIndex(COLLECTION, EXTRAS)

function ask(query: string, withExtras = false) {
  const answer = answerOwnership(withExtras ? indexWithExtras : index, query)
  if (answer === null) throw new Error(`Sin respuesta para «${query}»`)
  return answer
}

const ids = (matches: readonly { plant: CollectionPlant }[]) =>
  matches.map((match) => match.plant.id)

describe('prepareOwnershipQuery', () => {
  it.each(['', '   ', 'p', '-', '--', '...', 'x a'])(
    'no responde a «%s»',
    (query) => {
      expect(prepareOwnershipQuery(query)).toBeNull()
    },
  )

  it('no responde a más de 100 caracteres', () => {
    expect(prepareOwnershipQuery('a'.repeat(101))).toBeNull()
    expect(prepareOwnershipQuery('a'.repeat(100))).not.toBeNull()
  })

  it('normaliza como el catálogo y quita el punto de las abreviaturas', () => {
    expect(prepareOwnershipQuery('  Phal.  AMÁB ')).toEqual(['phal', 'amab'])
    expect(prepareOwnershipQuery('Phalaenopsis × intermedia')).toEqual([
      'phalaenopsis',
      'intermedia',
    ])
    expect(prepareOwnershipQuery('phalaenopsis x intermedia')).toEqual([
      'phalaenopsis',
      'intermedia',
    ])
  })
})

describe('matchWords', () => {
  it('exacto, por prefijo y parecido', () => {
    const name = ['phalaenopsis', 'amabilis']
    expect(matchWords(['phalaenopsis', 'amabilis'], name)).toBe('exact')
    expect(matchWords(['phal', 'amab'], name)).toBe('prefix')
    expect(matchWords(['amabilis'], name)).toBe('prefix')
    expect(matchWords(['phalenopsis', 'amabils'], name)).toBe('similar')
  })

  it('las palabras van en orden y seguidas', () => {
    expect(
      matchWords(['amabilis', 'phalaenopsis'], ['phalaenopsis', 'amabilis']),
    ).toBeNull()
  })

  it('sin `anywhere`, solo desde la primera palabra', () => {
    expect(
      matchWords(['amabilis'], ['phalaenopsis', 'amabilis'], false),
    ).toBeNull()
  })
})

describe('looksLikeAbbreviation', () => {
  it.each([
    ['blc', 'Brassolaeliocattleya', true],
    ['dtps', 'Doritaenopsis', true],
    ['rlc', '× Rhyncholaeliocattleya', true],
    ['phal', 'Phalaenopsis', true],
    ['cal', 'Phalaenopsis', false],
    ['c', 'Cattleya', false],
  ])('%s en %s: %s', (word, genus, expected) => {
    expect(looksLikeAbbreviation(word, genus)).toBe(expected)
  })
})

describe('answerOwnership: la tienes', () => {
  it.each([
    'Phalaenopsis amabilis',
    'phalaenopsis amabilis',
    'PHALÁENOPSIS AMABILIS',
    'phal amab',
    'Phal. amab',
    'amabilis',
    'Phalaenopsis ama',
  ])('«%s» encuentra los dos ejemplares de Phalaenopsis amabilis', (query) => {
    const answer = ask(query)
    expect(answer.outcome).toBe('owned')
    expect(answer.scope).toBe('species')
    expect(ids(answer.matches).sort()).toEqual(
      [amabilis1.id, amabilis2.id].sort(),
    )
  })

  it('el exacto se marca como exacto y dice por qué nombre', () => {
    const [first] = ask('Phalaenopsis amabilis').matches
    expect(first.quality).toBe('exact')
    expect(first.kind).toBe('scientific')
    expect(first.matchedName).toBe('Phalaenopsis amabilis')
  })

  it('un híbrido con "×" se encuentra con o sin el signo', () => {
    for (const query of [
      '× Rhyncholaeliocattleya Memoria Anna Balmores',
      'Rhyncholaeliocattleya memoria',
      'x Rhyncholaeliocattleya Memoria Anna Balmores',
      'memoria anna',
    ]) {
      const answer = ask(query)
      expect(answer.outcome, query).toBe('owned')
      expect(ids(answer.matches), query).toEqual([rlc.id])
    }
  })

  it('una planta por validar se compara por el nombre ingresado', () => {
    const answer = ask('Maxillaria tenuifolia')
    expect(answer.outcome).toBe('owned')
    expect(answer.matches[0].plant).toBe(tenuifolia)
    expect(answer.matches[0].kind).toBe('entered')
    expect(answer.matches[0].matchedName).toBe('Maxillaria tenuifólia')
  })

  it('una planta por validar ingresada solo con el epíteto se encuentra con su género', () => {
    const answer = ask('Cattleya trianae')
    expect(answer.outcome).toBe('owned')
    expect(ids(answer.matches)).toEqual([trianae.id])
  })

  it('el nombre ingresado también cuenta en las validadas ("Den. nobile")', () => {
    expect(ids(ask('Den. nobile').matches)).toEqual([nobile.id])
    expect(ids(ask('Dendrobium nobile').matches)).toEqual([nobile.id])
  })

  it('con la copia local, por sinónimo y por nombre común', () => {
    const synonym = ask('Phalaenopsis grandiflora', true)
    expect(synonym.outcome).toBe('owned')
    expect(synonym.matches).toHaveLength(2)
    expect(synonym.matches[0].kind).toBe('synonym')
    expect(synonym.matches[0].matchedName).toBe('Phalaenopsis grandiflora')

    const common = ask('orquidea luna', true)
    expect(common.outcome).toBe('owned')
    expect(common.matches[0].kind).toBe('common')
  })

  it('con la copia local, una abreviatura que no es el comienzo del género', () => {
    expect(ask('Rlc. Memoria', true).outcome).toBe('owned')
    // Sin la abreviatura en la copia, "rlc" no es el comienzo del nombre.
    expect(ask('Rlc. Memoria').outcome).toBe('owned') // por el nombre ingresado
  })
})

describe('answerOwnership: errores de tipeo (parecidas)', () => {
  it.each([
    'Phalenopsis amabilis', // falta una letra
    'Phalaenopsis amabils', // falta una letra
    'Phalaenopsis amabilsi', // dos letras intercambiadas
    'Phalenopsis amabils', // dos errores
    'Phalaenopsis amabolis', // una cambiada
    'Phalaenopsis amabl', // a medias y con un error
  ])('«%s» responde con las parecidas', (query) => {
    const answer = ask(query)
    expect(answer.outcome).toBe('similar')
    expect(ids(answer.matches).sort()).toEqual(
      [amabilis1.id, amabilis2.id].sort(),
    )
    expect(answer.matches.every((match) => match.quality === 'similar')).toBe(
      true,
    )
  })

  it('con tres errores ya no coincide', () => {
    expect(ask('Phalenopsys amabils').outcome).toBe('not-owned')
  })

  it('si alguna coincide bien, las parecidas no se listan', () => {
    // "Cattleya maxim" es prefijo de maxima; nada más se parece.
    const answer = ask('Cattleya maxim')
    expect(answer.outcome).toBe('owned')
    expect(ids(answer.matches)).toEqual([maxima.id])
  })
})

describe('answerOwnership: por género', () => {
  it('cuenta solo los ejemplares activos del género', () => {
    const answer = ask('Cattleya')
    expect(answer.scope).toBe('genus')
    expect(answer.outcome).toBe('owned')
    expect(answer.genera).toEqual([{ genus: CATTLEYA, activeCount: 2 }])
    expect(ids(answer.matches).sort()).toEqual([maxima.id, trianae.id].sort())
    expect(ids(answer.pastMatches)).toEqual([labiataLost.id])
  })

  it('por el comienzo del nombre, con un error o sin el signo "×"', () => {
    expect(ask('Phal').genera).toEqual([
      { genus: PHALAENOPSIS, activeCount: 2 },
    ])
    expect(ask('ph').genera).toEqual([{ genus: PHALAENOPSIS, activeCount: 2 }])
    const typo = ask('Catleya')
    expect(typo.scope).toBe('genus')
    expect(typo.outcome).toBe('similar')
    expect(ask('rhyncholaeliocattleya').genera).toEqual([
      { genus: RHYNCHOLAELIOCATTLEYA, activeCount: 1 },
    ])
    expect(ask('×Rhyncholaeliocattleya').scope).toBe('genus')
  })

  it('por abreviatura, con la copia local', () => {
    const answer = ask('Rlc.', true)
    expect(answer.scope).toBe('genus')
    expect(answer.genera).toEqual([
      { genus: RHYNCHOLAELIOCATTLEYA, activeCount: 1 },
    ])
  })

  it('un género con todas sus plantas dadas de baja no la tienes', () => {
    const answer = ask('Masdevallia')
    expect(answer.scope).toBe('genus')
    expect(answer.outcome).toBe('not-owned')
    expect(answer.genera).toEqual([{ genus: MASDEVALLIA, activeCount: 0 }])
    expect(ids(answer.pastMatches)).toEqual([veitchianaLost.id])
  })

  it('dos letras que empiezan dos géneros devuelven los dos', () => {
    const answer = ask('ma')
    expect(answer.genera.map(({ genus }) => genus.name)).toEqual([
      'Masdevallia',
      'Maxillaria',
    ])
    expect(answer.outcome).toBe('owned')
  })
})

describe('answerOwnership: dadas de baja ("la tuviste")', () => {
  it('una planta perdida no da un "Sí"', () => {
    const answer = ask('Cattleya labiata')
    expect(answer.outcome).toBe('not-owned')
    expect(answer.matches).toEqual([])
    expect(ids(answer.pastMatches)).toEqual([labiataLost.id])
  })

  it('una planta regalada, con el "×" escrito de cualquier forma', () => {
    for (const query of [
      'Phalaenopsis × intermedia',
      'Phalaenopsis x intermedia',
      'phal intermedia',
    ]) {
      const answer = ask(query)
      expect(answer.outcome, query).toBe('not-owned')
      expect(ids(answer.pastMatches), query).toEqual([intermediaGifted.id])
    }
  })
})

describe('answerOwnership: falsos positivos', () => {
  it.each([
    'Cattleya lobata', // otra especie, a dos letras de labiata
    'Vivero Los Andes', // el origen no cuenta
    'La blanca', // el apodo tampoco
    'Phalaenopsis aphrodite', // mismo género, otro epíteto
    'Masdevallia coccinea',
    'no', // dos letras: solo el comienzo del nombre, no "nobile"
    'Oncidium',
    'one',
  ])('«%s» no la tienes', (query) => {
    const answer = ask(query)
    expect(answer.outcome).toBe('not-owned')
    expect(answer.matches).toEqual([])
  })

  it('«Cattleya lobata» no menciona la labiata perdida', () => {
    expect(ask('Cattleya lobata').pastMatches).toEqual([])
  })
})

describe('answerOwnership: rendimiento', () => {
  // Generador con semilla: la misma colección en cada ejecución.
  function random(seed: number) {
    let state = seed
    return () => {
      state = (state * 1103515245 + 12345) % 2147483648
      return state / 2147483648
    }
  }

  function bigCollection(count: number): CollectionPlant[] {
    const next = random(42)
    const letters = 'abcdefghilmnoprstuv'
    const word = (length: number) =>
      Array.from(
        { length },
        () => letters[Math.floor(next() * letters.length)],
      ).join('')
    const genera = Array.from({ length: 60 }, (_, i) => ({
      id: `genus-${i}`,
      name: word(6 + (i % 6)).replace(/^./, (c) => c.toUpperCase()),
    }))
    const speciesList = Array.from({ length: 600 }, (_, i) => {
      const genus = genera[i % genera.length]
      return {
        genus,
        name: `${genus.name} ${word(5 + (i % 7))}`,
        id: `species-${i}`,
      }
    })
    return Array.from({ length: count }, (_, i) => {
      const chosen = speciesList[Math.floor(next() * speciesList.length)]
      const pending = i % 10 === 0
      return plant({
        displayName: pending ? `${chosen.genus.name} ${word(7)}` : chosen.name,
        displayNameIsScientific: !pending,
        enteredName: pending ? `${chosen.genus.name} ${word(7)}` : chosen.name,
        species: pending ? null : species(chosen.id, chosen.name),
        genus: chosen.genus,
        status: i % 15 === 0 ? 'lost' : 'active',
      })
    })
  }

  function median(values: number[]): number {
    const sorted = values.toSorted((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }

  it.each([300, 1500])(
    'con %i plantas responde en pocos milisegundos',
    (count) => {
      const plants = bigCollection(count)
      const queries = [
        plants[7].displayName, // exacto
        plants[11].displayName.slice(0, 8), // a medias
        plants[3].displayName.replace(/(.)(.)$/, '$2$1'), // dos letras intercambiadas
        'zzzz qqqq', // nada
        plants[5].genus.name, // género
        'ab',
      ]
      const index = buildOwnershipIndex(plants)
      // Calentamiento: la primera vuelta compila las funciones.
      for (const query of queries) answerOwnership(index, query)

      const times: number[] = []
      for (let round = 0; round < 15; round += 1) {
        for (const query of queries) {
          const start = performance.now()
          answerOwnership(index, query)
          times.push(performance.now() - start)
        }
      }
      // El objetivo real es de pocos milisegundos (1 o 2 en un portátil); el
      // margen es para el CI y los equipos cargados.
      expect(median(times)).toBeLessThan(count <= 300 ? 10 : 25)

      const buildStart = performance.now()
      buildOwnershipIndex(plants)
      expect(performance.now() - buildStart).toBeLessThan(200)
    },
  )
})
