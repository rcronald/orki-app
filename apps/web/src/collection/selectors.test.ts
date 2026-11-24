import { describe, expect, it, vi } from 'vitest'
import {
  CATTLEYA,
  PHALAENOPSIS,
  plant,
  RHYNCHOLAELIOCATTLEYA,
  speciesNamed,
} from '../test/collection.ts'
import type { CollectionPlant } from './model.ts'
import {
  answerOwnership,
  matchPlantNames,
  ownershipIndexFor,
  type OwnershipExtras,
} from './ownership.ts'
import {
  compareNames,
  countGenera,
  countPlants,
  filterByText,
  groupByGenus,
  plantsByStatus,
  isPlantSort,
  sortByAcquired,
  sortByName,
  sortByNewest,
  sortPlants,
} from './selectors.ts'

const amabilis = plant({
  displayName: 'Phalaenopsis amabilis',
  enteredName: 'phal amabilis',
  nickname: 'La blanca',
  origin: 'Vivero Los Andes',
  createdAt: '2026-11-03T10:00:00+00:00',
})
const intermedia = plant({
  displayName: 'Phalaenopsis × intermedia',
  enteredName: 'Phalaenopsis x intermedia',
  species: {
    id: 'species-intermedia',
    scientificName: 'Phalaenopsis × intermedia',
    type: 'hybrid',
    status: 'imported',
  },
  type: 'hybrid',
  createdAt: '2026-11-05T10:00:00+00:00',
})
// Sin especie: "por validar", con el género que eligió el usuario.
const pending = plant({
  displayName: 'Cattleya rosada de la abuela',
  displayNameIsScientific: false,
  enteredName: 'Cattleya rosada de la abuela',
  species: null,
  genus: CATTLEYA,
  type: 'unknown',
  validation: 'pending',
  origin: 'Feria de Lima',
  createdAt: '2026-11-04T10:00:00+00:00',
})
const rlc = plant({
  displayName: '× Rhyncholaeliocattleya Memoria Helen Brown',
  enteredName: 'Rlc. Memoria Helen Brown',
  genus: RHYNCHOLAELIOCATTLEYA,
  type: 'hybrid',
  createdAt: '2026-11-02T10:00:00+00:00',
})
// Dadas de baja.
const lost = plant({
  displayName: 'Cattleya labiata',
  genus: CATTLEYA,
  status: 'lost',
  createdAt: '2026-11-06T10:00:00+00:00',
})
const gifted = plant({
  displayName: 'Dendrobium nobile',
  genus: { id: 'genus-den', name: 'Dendrobium' },
  status: 'gifted',
  createdAt: '2026-11-07T10:00:00+00:00',
})

const collection = [amabilis, intermedia, pending, rlc, lost, gifted]

const names = (plants: readonly { displayName: string }[]) =>
  plants.map((p) => p.displayName)

describe('plantsByStatus', () => {
  it('por defecto, solo las activas', () => {
    expect(plantsByStatus(collection)).toEqual([
      amabilis,
      intermedia,
      pending,
      rlc,
    ])
  })

  it('con includeInactive, todas', () => {
    expect(plantsByStatus(collection, { includeInactive: true })).toBe(
      collection,
    )
  })
})

describe('contadores', () => {
  it('cuentan solo las activas por defecto', () => {
    expect(countPlants(collection)).toBe(4)
    // Phalaenopsis, Cattleya (la planta sin especie) y × Rhyncholaeliocattleya;
    // Dendrobium solo tiene una regalada.
    expect(countGenera(collection)).toBe(3)
  })

  it('con las dadas de baja', () => {
    expect(countPlants(collection, { includeInactive: true })).toBe(6)
    expect(countGenera(collection, { includeInactive: true })).toBe(4)
  })

  it('colección vacía o solo con bajas', () => {
    expect(countPlants([])).toBe(0)
    expect(countGenera([])).toBe(0)
    expect(countPlants([lost, gifted])).toBe(0)
    expect(countGenera([lost, gifted])).toBe(0)
  })

  it('un género con el mismo nombre pero otro id cuenta aparte', () => {
    // No debería pasar (nombre único en el catálogo), pero el id manda.
    const other = plant({ genus: { id: 'otro', name: 'Phalaenopsis' } })
    expect(countGenera([amabilis, other])).toBe(2)
  })
})

describe('groupByGenus', () => {
  it('agrupa las activas por género, con contador, ignorando el signo "×" al ordenar', () => {
    const groups = groupByGenus(collection)

    expect(
      groups.map((group) => [
        group.genus.name,
        group.count,
        names(group.plants),
      ]),
    ).toEqual([
      ['Cattleya', 1, ['Cattleya rosada de la abuela']],
      [
        'Phalaenopsis',
        2,
        ['Phalaenopsis amabilis', 'Phalaenopsis × intermedia'],
      ],
      [
        '× Rhyncholaeliocattleya',
        1,
        ['× Rhyncholaeliocattleya Memoria Helen Brown'],
      ],
    ])
    expect(groups[1]?.genus).toBe(PHALAENOPSIS)
  })

  it('con las dadas de baja', () => {
    const groups = groupByGenus(collection, { includeInactive: true })

    expect(groups.map((group) => [group.genus.name, group.count])).toEqual([
      ['Cattleya', 2],
      ['Dendrobium', 1],
      ['Phalaenopsis', 2],
      ['× Rhyncholaeliocattleya', 1],
    ])
    expect(names(groups[0]?.plants ?? [])).toEqual([
      'Cattleya labiata',
      'Cattleya rosada de la abuela',
    ])
  })

  it('sin plantas, sin grupos', () => {
    expect(groupByGenus([])).toEqual([])
    expect(groupByGenus([lost])).toEqual([])
  })

  it('los contadores de los grupos suman el total', () => {
    const total = groupByGenus(collection).reduce((sum, g) => sum + g.count, 0)
    expect(total).toBe(countPlants(collection))
  })
})

describe('orden', () => {
  it('alfabético por nombre mostrado, sin el signo, tildes ni mayúsculas', () => {
    const plants = [
      plant({ displayName: '× Rhyncholaeliocattleya Hsinying' }),
      plant({ displayName: 'cattleya labiata' }),
      plant({ displayName: 'Ángel de la guarda' }),
      plant({ displayName: 'Phalaenopsis × intermedia' }),
      plant({ displayName: 'Phalaenopsis amabilis' }),
      plant({ displayName: 'Brassavola nodosa' }),
    ]

    expect(names(sortByName(plants))).toEqual([
      'Ángel de la guarda',
      'Brassavola nodosa',
      'cattleya labiata',
      'Phalaenopsis amabilis',
      'Phalaenopsis × intermedia',
      '× Rhyncholaeliocattleya Hsinying',
    ])
  })

  it('con nombres iguales, el orden es estable por id y no cambia la lista original', () => {
    const b = plant({ id: 'b', displayName: 'Vanda coerulea' })
    const a = plant({ id: 'a', displayName: 'vanda Coerulea' })
    const input = [b, a]

    expect(sortByName(input)).toEqual([a, b])
    expect(sortByName([a, b])).toEqual([a, b])
    expect(input).toEqual([b, a])
  })

  it('números dentro del nombre en orden natural', () => {
    const plants = [
      plant({ displayName: 'Plántula 10' }),
      plant({ displayName: 'Plántula 2' }),
    ]
    expect(names(sortByName(plants))).toEqual(['Plántula 2', 'Plántula 10'])
  })

  it('compareNames ignora el signo de híbrido', () => {
    expect(compareNames('× Brassocattleya', 'Brassocattleya')).toBe(0)
    expect(
      compareNames('Phalaenopsis × intermedia', 'Phalaenopsis intermedia'),
    ).toBe(0)
  })

  it('por fecha de alta, las más recientes primero', () => {
    expect(sortByNewest(collection)).toEqual([
      gifted,
      lost,
      intermedia,
      pending,
      amabilis,
      rlc,
    ])
  })

  it('por fecha de alta compara instantes, no texto, y desempata por id', () => {
    const utc = plant({ id: 'b', createdAt: '2026-11-01T12:00:00+00:00' })
    // Mismo instante escrito en otra zona horaria.
    const lima = plant({ id: 'a', createdAt: '2026-11-01T07:00:00-05:00' })
    const later = plant({ id: 'c', createdAt: '2026-11-01T08:00:00-05:00' })

    expect(sortByNewest([utc, lima, later])).toEqual([later, lima, utc])
  })

  it('con el mismo nombre, por identificador en orden natural (#292)', () => {
    const p10 = plant({ id: 'a', code: 'PHA-010' })
    const p2 = plant({ id: 'b', code: 'PHA-002' })
    const old = plant({ id: 'c', code: null })
    const p1000 = plant({ id: 'd', code: 'PHA-1000' })
    expect(sortByName([old, p10, p1000, p2])).toEqual([p2, p10, p1000, old])
  })

  it('por fecha de adquisición, la más reciente primero; el mismo día, la dada de alta más tarde', () => {
    const march = plant({
      acquiredOn: '2026-03-14',
      createdAt: '2026-11-20T10:00:00+00:00',
    })
    const mayEarly = plant({
      acquiredOn: '2026-05-02',
      createdAt: '2026-10-01T10:00:00+00:00',
    })
    const mayLate = plant({
      acquiredOn: '2026-05-02',
      createdAt: '2026-10-02T10:00:00+00:00',
    })
    const lastYear = plant({
      acquiredOn: '2025-12-01',
      createdAt: '2026-11-21T10:00:00+00:00',
    })
    const input = [march, lastYear, mayEarly, mayLate]
    expect(sortByAcquired(input)).toEqual([mayLate, mayEarly, march, lastYear])
    // La fecha de alta no manda: la última dada de alta va al final.
    expect(sortByNewest(input)[0]).toBe(lastYear)
    expect(input).toEqual([march, lastYear, mayEarly, mayLate])
  })

  it('sortPlants con cada orden', () => {
    expect(sortPlants(collection, 'newest')).toEqual(sortByNewest(collection))
    expect(sortPlants(collection, 'name')).toEqual(sortByName(collection))
    expect(sortPlants(collection, 'acquired')).toEqual(
      sortByAcquired(collection),
    )
    expect(isPlantSort('acquired')).toBe(true)
    expect(isPlantSort('precio')).toBe(false)
    expect(isPlantSort(undefined)).toBe(false)
  })

  it('agrupada, cada género en el orden pedido', () => {
    const older = plant({
      displayName: 'Phalaenopsis zeta',
      createdAt: '2026-01-01T10:00:00+00:00',
    })
    const newer = plant({
      displayName: 'Phalaenopsis alfa',
      createdAt: '2026-02-01T10:00:00+00:00',
    })
    const [byName] = groupByGenus([older, newer])
    expect(byName.plants).toEqual([newer, older])
    const [byNewest] = groupByGenus([newer, older], { sort: 'newest' })
    expect(byNewest.plants).toEqual([newer, older])
    const [byNewestReversed] = groupByGenus(
      [{ ...older, createdAt: '2026-03-01T10:00:00+00:00' }, newer],
      { sort: 'newest' },
    )
    expect(byNewestReversed.plants.map((p) => p.displayName)).toEqual([
      'Phalaenopsis zeta',
      'Phalaenopsis alfa',
    ])
  })
})

describe('rendimiento con colecciones grandes (#292)', () => {
  // Colección sintética: nombres, géneros, ubicaciones e identificadores
  // variados, como una colección real grande.
  const GENERA = [PHALAENOPSIS, CATTLEYA, RHYNCHOLAELIOCATTLEYA]
  const EPITHETS = ['amabilis', 'maxima', 'trianae', 'nobile', 'Memoria Helen']
  function synthetic(count: number): CollectionPlant[] {
    return Array.from({ length: count }, (_, i) => {
      const genus = GENERA[i % GENERA.length]
      const name = `${genus.name} ${EPITHETS[i % EPITHETS.length]} ${String(i)}`
      return plant({
        displayName: name,
        enteredName: name,
        genus,
        code: `${genus.name
          .replace(/[^A-Za-z]/g, '')
          .slice(0, 3)
          .toUpperCase()}-${String(i + 1).padStart(3, '0')}`,
        location: `Estante ${String(i % 20)}`,
        nickname: i % 7 === 0 ? `Apodo ${String(i)}` : null,
        acquiredOn: `202${String(i % 6)}-0${String((i % 9) + 1)}-1${String(i % 10)}`,
        createdAt: new Date(Date.UTC(2026, 0, 1) + i * 3_600_000).toISOString(),
      })
    })
  }

  /**
   * El trabajo de una operación, sin reloj (#311): cuenta cada lectura de un
   * elemento de la lista o de un campo de una planta, y cada consulta a las
   * cachés por planta (WeakMap), que es lo que hace cada comparación al
   * ordenar. Con la máquina cargada el tiempo cambia y esto no; una regresión
   * de complejidad (un bucle dentro de otro, normalizar en cada comparación)
   * lo hace crecer más que la lista.
   */
  function work(
    count: number,
    run: (plants: readonly CollectionPlant[]) => unknown,
    { warm }: { warm?: (plants: readonly CollectionPlant[]) => unknown } = {},
  ): { fields: number; total: number } {
    let fields = 0
    const counting = <T extends object>(target: T): T =>
      new Proxy(target, {
        get(object, key, receiver) {
          fields += 1
          return Reflect.get(object, key, receiver) as unknown
        },
      })
    const plants = counting(synthetic(count).map(counting))
    warm?.(plants)
    fields = 0
    const lookups = vi.spyOn(WeakMap.prototype, 'get')
    try {
      run(plants)
      return { fields, total: fields + lookups.mock.calls.length }
    } finally {
      lookups.mockRestore()
    }
  }

  const OPERATIONS: Record<
    string,
    {
      run: (plants: readonly CollectionPlant[]) => unknown
      warm?: (plants: readonly CollectionPlant[]) => unknown
      /**
       * Lecturas de campos por planta como mucho, si cada una se calcula una
       * vez.
       */
      perPlant?: number
    }
  > = {
    // Por fecha de alta y por nombre, la clave de cada planta se calcula una
    // vez, no en cada comparación (#292). Por fecha de adquisición se lee el
    // campo al comparar: n·log n.
    'ordenar (newest)': {
      run: (plants) => sortPlants(plants, 'newest'),
      perPlant: 3,
    },
    'ordenar (name)': {
      run: (plants) => sortPlants(plants, 'name'),
      perPlant: 3,
    },
    'ordenar (acquired)': { run: (plants) => sortPlants(plants, 'acquired') },
    'agrupar por género': { run: (plants) => groupByGenus(plants) },
    ...Object.fromEntries(
      ['amabilis', 'PHA-013', 'estante 3', 'amabils'].flatMap((query) => {
        const search = (plants: readonly CollectionPlant[]) =>
          filterByText(plants, query)
        // La primera vez (plantas nuevas: sin el texto normalizado en caché)
        // y las siguientes, como al escribir letra a letra, sin volver a leer
        // los campos de cada planta.
        return [
          [`buscar «${query}» (primera)`, { run: search }],
          [`buscar «${query}»`, { run: search, warm: search, perPlant: 3 }],
        ]
      }),
    ),
  }

  it('el trabajo crece con la colección, no con su cuadrado', () => {
    const report: Record<string, string> = {}
    for (const [name, { run, warm, perPlant }] of Object.entries(OPERATIONS)) {
      const small = work(500, run, { warm })
      const large = work(2000, run, { warm })
      report[name] = `${String(small.total)} → ${String(large.total)}`
      // Cuatro veces más plantas: lineal es ×4 y n·log n, ×4,9; cuadrático
      // sería ×16.
      expect(large.total / small.total, name).toBeLessThan(6)
      if (perPlant !== undefined) {
        expect(large.fields / 2000, name).toBeLessThanOrEqual(perPlant)
      }
    }
    // Lo que mide la prueba, para el informe del issue.
    console.info('Trabajo con 500 → 2000 plantas:', JSON.stringify(report))
  })
})

describe('filterByText', () => {
  it('búsqueda vacía: todas las activas', () => {
    expect(filterByText(collection, '')).toEqual(plantsByStatus(collection))
    expect(filterByText(collection, '   ')).toEqual(plantsByStatus(collection))
  })

  it.each([
    ['nombre mostrado', 'amabilis', [amabilis]],
    ['sin mayúsculas ni tildes', 'PHALÁENOPSIS', [amabilis, intermedia]],
    ['varias palabras en cualquier campo', 'phal amab', [amabilis]],
    ['nombre ingresado', 'abuela', [pending]],
    ['nombre ingresado de una planta enlazada', 'rlc', [rlc]],
    ['género', 'cattleya', [pending, rlc]],
    ['apodo', 'blanca', [amabilis]],
    ['origen', 'feria', [pending]],
    ['palabras en campos distintos', 'amabilis andes', [amabilis]],
    ['híbrido escrito con "x"', 'phalaenopsis x intermedia', [intermedia]],
    ['híbrido escrito con "×"', 'Phalaenopsis × intermedia', [intermedia]],
    ['híbrido sin el signo', 'phalaenopsis intermedia', [intermedia]],
    ['género híbrido sin el signo', 'rhyncholaeliocattleya', [rlc]],
    ['sin coincidencias', 'vanda', []],
    ['una palabra que no está', 'amabilis vanda', []],
  ])('%s: "%s"', (_case, query, expected) => {
    expect(filterByText(collection, query)).toEqual(expected)
  })

  it('una palabra no casa a caballo entre dos campos', () => {
    // displayName termina en "amabilis" y el ingresado empieza por "phal".
    expect(filterByText(collection, 'amabilisphal')).toEqual([])
  })

  it('por defecto no encuentra las dadas de baja; con includeInactive, sí', () => {
    expect(filterByText(collection, 'labiata')).toEqual([])
    expect(
      filterByText(collection, 'labiata', { includeInactive: true }),
    ).toEqual([lost])
    expect(
      filterByText(collection, 'dendrobium', { includeInactive: true }),
    ).toEqual([gifted])
  })

  describe('con errores de tipeo', () => {
    it.each([
      ['una letra de menos', 'amabils', [amabilis]],
      ['dos letras vecinas cambiadas', 'amabiils', [amabilis]],
      [
        'dos errores en una palabra larga',
        'phalenopsis intermdia',
        [intermedia],
      ],
      ['la palabra a medio escribir', 'amabli', [amabilis]],
      ['en el apodo o el origen', 'blamca', [amabilis]],
      ['abreviatura con punto', 'Rlc. Memoria Hellen', [rlc]],
      ['más errores de los tolerados', 'phalenopsis amabls intermdia', []],
      ['palabras cortas, sin tolerancia', 'fal', []],
      ['otra especie parecida no cuenta', 'lobata', []],
    ])('%s: "%s"', (_case, query, expected) => {
      expect(filterByText(collection, query)).toEqual(expected)
    })

    it('solo se toleran si ninguna planta coincide sin errores', () => {
      const nobilis = {
        ...amabilis,
        id: 'nobilis',
        displayName: 'Laelia nobilis',
      }
      const nobile = { ...gifted, id: 'nobile', status: 'active' as const }
      // "nobile" está tal cual en una; "nobilis" se le parece, pero no sale.
      expect(filterByText([nobilis, nobile], 'nobile')).toEqual([nobile])
      expect(filterByText([nobilis, nobile], 'nobili')).toEqual([nobilis])
      expect(filterByText([nobilis, nobile], 'nobole')).toEqual([nobile])
    })

    it('respeta el filtro de estado', () => {
      expect(filterByText(collection, 'labiatta')).toEqual([])
      expect(
        filterByText(collection, 'labiatta', { includeInactive: true }),
      ).toEqual([lost])
    })
  })

  it('una planta editada (otro objeto) se busca con sus datos nuevos', () => {
    expect(filterByText([amabilis], 'rosita')).toEqual([])
    const edited = { ...amabilis, nickname: 'Rosita' }
    expect(filterByText([edited], 'rosita')).toEqual([edited])
  })
})

describe('filterByText por identificador y ubicación (#292)', () => {
  const pha1 = plant({ code: 'PHA-001', location: 'Ventana de la sala' })
  const pha12 = plant({ code: 'PHA-012', location: 'Balcón' })
  const pha120 = plant({ code: 'PHA-120' })
  const cat12 = plant({
    displayName: 'Cattleya maxima',
    enteredName: 'Cattleya maxima',
    genus: CATTLEYA,
    code: 'CAT-012',
    location: 'Invernadero, mesa 2',
  })
  const cat1000 = plant({
    displayName: 'Cattleya trianae',
    enteredName: 'Cattleya trianae',
    genus: CATTLEYA,
    code: 'CAT-1000',
  })
  // Una copia sin conexión guardada antes del #265: sin identificador.
  const old = plant({ code: null, nickname: 'Plántula 12' })
  const plants = [pha1, pha12, pha120, cat12, cat1000, old]

  it.each([
    ['tal cual', 'CAT-012', [cat12]],
    ['en minúsculas y sin los ceros', 'cat-12', [cat12]],
    ['con un espacio', 'cat 12', [cat12]],
    ['sin separador', 'CAT012', [cat12]],
    ['con los ceros y espacios de más', '  cat  012 ', [cat12]],
    ['de cuatro cifras', 'cat-1000', [cat1000]],
    ['otro prefijo, el mismo número', 'PHA-012', [pha12]],
    ['el número entero, no el comienzo', 'pha 1', [pha1]],
    ['varios, cualquiera de ellos', 'PHA-001 CAT-012', [pha1, cat12]],
    ['con más palabras, que tienen que estar', 'cat 12 maxima', [cat12]],
    ['con una palabra que no está', 'cat 12 trianae', []],
    ['a medio escribir, el prefijo con su guion', 'cat-', [cat12, cat1000]],
  ])('%s: "%s"', (_case, query, expected) => {
    expect(filterByText(plants, query)).toEqual(expected)
  })

  it('un número suelto no busca en los identificadores', () => {
    // Solo el apodo de la planta sin identificador lleva un 12.
    expect(filterByText(plants, '12')).toEqual([old])
    expect(filterByText(plants, '001')).toEqual([])
    // Tres letras sin número son texto: el género.
    expect(filterByText(plants, 'cat')).toEqual([cat12, cat1000])
  })

  it('un identificador que nadie tiene se busca como texto, como antes', () => {
    expect(filterByText(plants, 'DEN-001')).toEqual([])
    // Ninguna es PHA-002: «pha» y «2» como texto, en el género y el apodo.
    expect(filterByText(plants, 'pha 2')).toEqual([old])
  })

  it('una planta sin identificador no coincide por identificador', () => {
    expect(filterByText([old], 'PHA-001')).toEqual([])
  })

  it('si no hay ese identificador, la búsqueda vale como texto', () => {
    const grex = plant({ displayName: 'Vanda Abc 12', code: 'VAN-003' })
    expect(filterByText([grex, pha1], 'abc 12')).toEqual([grex])
  })

  it.each([
    ['una palabra', 'balcon', [pha12]],
    ['sin tildes ni mayúsculas', 'VENTANA de la SALA', [pha1]],
    ['con números', 'mesa 2', [cat12]],
    ['junto al nombre', 'maxima invernadero', [cat12]],
  ])('por ubicación, %s: "%s"', (_case, query, expected) => {
    expect(filterByText(plants, query)).toEqual(expected)
  })

  it('«¿Ya la tengo?» no da por tenida una planta por su identificador ni por su ubicación', () => {
    const index = ownershipIndexFor(plants)
    for (const query of [
      'CAT-012',
      'cat 12',
      'PHA001',
      'Balcón',
      'invernadero',
    ]) {
      expect(matchPlantNames(index, query)?.size ?? 0, query).toBe(0)
      expect(answerOwnership(index, query)?.outcome, query).toBe('not-owned')
    }
    // Por el nombre sigue respondiendo como siempre.
    expect(answerOwnership(index, 'Cattleya maxima')?.outcome).toBe('owned')
  })
})

describe('filterByText con los nombres de "¿Ya la tengo?"', () => {
  // Plantas con su especie enlazada, como las da toCollectionPlant: el nombre
  // mostrado es el científico de la especie.
  const linked = (
    scientificName: string,
    overrides: Partial<CollectionPlant> = {},
  ) =>
    plant({
      displayName: scientificName,
      enteredName: scientificName,
      species: speciesNamed(scientificName),
      ...overrides,
    })
  const luna = linked('Phalaenopsis amabilis')
  const mayo = linked('Cattleya trianae', { genus: CATTLEYA })
  const java = linked('Phalaenopsis javanica', { nickname: 'Luna chica' })
  const lina = linked('Cattleya lueddemanniana', { genus: CATTLEYA })
  const lostLuna = linked('Phalaenopsis aphrodite', { status: 'lost' })
  const plants = [luna, mayo, java, lina, lostLuna]

  const names = (
    entries: Record<string, [string, 'synonym' | 'common'][]>,
  ): OwnershipExtras => ({
    speciesNames: new Map(
      Object.entries(entries).map(([scientificName, list]) => [
        speciesNamed(scientificName).id,
        list.map(([name, type]) => ({ name, type })),
      ]),
    ),
  })
  const EXTRAS = names({
    'Phalaenopsis amabilis': [
      ['Phalaenopsis grandiflora', 'synonym'],
      ['Orquídea luna', 'common'],
    ],
    'Cattleya trianae': [['Flor de mayo', 'common']],
    'Cattleya lueddemanniana': [['Lina', 'common']],
    'Phalaenopsis aphrodite': [['Luna de Filipinas', 'common']],
  })

  const search = (
    query: string,
    extras: OwnershipExtras | undefined = EXTRAS,
    includeInactive = false,
  ) =>
    filterByText(plants, query, {
      includeInactive,
      nameMatches: matchPlantNames(ownershipIndexFor(plants, extras), query),
    })

  it.each([
    ['un sinónimo', 'grandiflora', [luna]],
    ['un sinónimo con el género abreviado', 'Phal. grandiflora', [luna]],
    ['un nombre común', 'Orquídea luna', [luna]],
    ['un nombre común sin tildes, a medio escribir', 'flor de ma', [mayo]],
  ])('encuentra la planta por %s: "%s"', (_case, query, expected) => {
    expect(search(query)).toEqual(expected)
  })

  it('sin extras (aún no cargan o no hay), como antes', () => {
    expect(search('grandiflora', {})).toEqual([])
    expect(search('orquidea luna', undefined)).toEqual([luna])
    expect(search('orquidea luna', {})).toEqual([])
    expect(filterByText(plants, 'orquidea luna')).toEqual([])
    expect(
      filterByText(plants, 'orquidea luna', { nameMatches: null }),
    ).toEqual([])
    // Lo demás no cambia.
    expect(search('javanica', {})).toEqual([java])
  })

  it('mezcla coincidencias directas con las de sus nombres, en el orden de la lista', () => {
    // "luna": el apodo de una y el nombre común de otra; la perdida, solo
    // con su estado.
    expect(search('luna')).toEqual([luna, java])
    expect(search('luna', EXTRAS, true)).toEqual([luna, java, lostLuna])
  })

  describe('con errores de tipeo, como el panel', () => {
    it('un nombre común con un error encuentra la planta', () => {
      expect(search('orquidea lunna')).toEqual([luna])
      expect(search('flor de maio')).toEqual([mayo])
    })

    it('las parecidas solo salen si ninguna coincide sin errores', () => {
      // "lina" es tal cual el nombre común de una; "luna" se le parece.
      expect(search('lina')).toEqual([lina])
      // "lena" no coincide tal cual con ninguna: salen las parecidas.
      expect(search('lena')).toEqual([luna, java, lina])
    })
  })

  it('lo que el panel da por "la tienes" está en la lista', () => {
    const active = plants.filter((p) => p.status === 'active')
    for (const query of [
      'grandiflora',
      'orquidea luna',
      'orquidea lunna',
      'flor de mayo',
      'luna',
      'lina',
      'lena',
      'phal amab',
      'Phal. grandiflora',
    ]) {
      const index = ownershipIndexFor(plants, EXTRAS)
      const ownership = answerOwnership(index, query)
      const listed = filterByText(active, query, {
        nameMatches: matchPlantNames(index, query),
      })
      for (const match of ownership?.matches ?? []) {
        expect(listed, query).toContain(match.plant)
      }
    }
  })

  it('el índice se crea una vez por plantas y extras', () => {
    expect(ownershipIndexFor(plants, EXTRAS)).toBe(
      ownershipIndexFor(plants, EXTRAS),
    )
    expect(ownershipIndexFor(plants)).toBe(ownershipIndexFor(plants, undefined))
    expect(ownershipIndexFor(plants, {})).not.toBe(
      ownershipIndexFor(plants, EXTRAS),
    )
  })

  it('búsquedas que no bastan para el panel no añaden nada', () => {
    expect(matchPlantNames(ownershipIndexFor(plants, EXTRAS), 'l')).toBeNull()
    expect(search('l')).toEqual(filterByText(plants, 'l'))
  })
})
