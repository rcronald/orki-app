import { describe, expect, it } from 'vitest'
import {
  CATTLEYA,
  PHALAENOPSIS,
  plant,
  RHYNCHOLAELIOCATTLEYA,
} from '../test/collection.ts'
import { countWork } from '../test/work.ts'
import type { CollectionPlant } from './model.ts'
import {
  applyFilters,
  countActiveFilters,
  DEFAULT_FILTERS,
  filterOptions,
  narrowsStatus,
  originKey,
  plantsWithStatus,
  resolveFilters,
  sameFilters,
  toggleValue,
  type PlantFilters,
} from './filters.ts'
import { filterByText } from './selectors.ts'

const amabilis = plant({
  displayName: 'Phalaenopsis amabilis',
  flowerColor: 'white',
  origin: 'Vivero Moyobamba',
})
const schilleriana = plant({
  displayName: 'Phalaenopsis schilleriana',
  flowerColor: 'pink',
  origin: 'vivero moyobamba ',
})
const maxima = plant({
  displayName: 'Cattleya maxima',
  genus: CATTLEYA,
  flowerColor: 'pink',
  origin: 'Feria de Miraflores',
})
const memoria = plant({
  displayName: '× Rhyncholaeliocattleya Memoria Anna Balmores',
  genus: RHYNCHOLAELIOCATTLEYA,
  flowerColor: null,
  origin: null,
})
const lost = plant({
  displayName: 'Phalaenopsis aphrodite',
  status: 'lost',
  flowerColor: 'white',
  origin: 'Vivero Moyobamba',
})
const gifted = plant({
  displayName: 'Cattleya rex',
  genus: CATTLEYA,
  status: 'gifted',
  origin: 'Mercado de Acho',
})
const ALL = [amabilis, schilleriana, maxima, memoria, lost, gifted]

const filters = (overrides: Partial<PlantFilters>): PlantFilters => ({
  ...DEFAULT_FILTERS,
  ...overrides,
})

const names = (plants: readonly { displayName: string }[]) =>
  plants.map((p) => p.displayName)

describe('originKey', () => {
  it('normaliza mayúsculas, tildes y espacios; vacío o null, sin clave', () => {
    expect(originKey('  Vivero  Moyobamba ')).toBe('vivero moyobamba')
    expect(originKey('Feria de Oxapámpa')).toBe('feria de oxapampa')
    expect(originKey('   ')).toBeNull()
    expect(originKey(null)).toBeNull()
  })
})

describe('filterOptions', () => {
  const options = filterOptions(ALL)

  it('géneros presentes (también los de bajas), en orden alfabético sin el "×"', () => {
    expect(options.genera.map((o) => o.genus.name)).toEqual([
      'Cattleya',
      'Phalaenopsis',
      '× Rhyncholaeliocattleya',
    ])
    expect(options.genera.map((o) => o.count)).toEqual([2, 3, 1])
  })

  it('solo los colores usados, en el orden del enumerado', () => {
    expect(options.colors).toEqual([
      { color: 'white', count: 2 },
      { color: 'pink', count: 2 },
    ])
  })

  it('orígenes agrupados por su clave, de más a menos usados, con la forma más escrita', () => {
    expect(options.origins).toEqual([
      { key: 'vivero moyobamba', label: 'Vivero Moyobamba', count: 3 },
      { key: 'feria de miraflores', label: 'Feria de Miraflores', count: 1 },
      { key: 'mercado de acho', label: 'Mercado de Acho', count: 1 },
    ])
  })

  it('todos los estados del enumerado', () => {
    expect(options.statuses).toEqual(['active', 'lost', 'gifted'])
  })

  it('sin color ni origen registrados, esos grupos quedan vacíos', () => {
    const empty = filterOptions([memoria])
    expect(empty.colors).toEqual([])
    expect(empty.origins).toEqual([])
    expect(filterOptions([]).genera).toEqual([])
  })
})

describe('filtro de validación (#141)', () => {
  const pending = plant({
    displayName: 'la naranja del mercado',
    species: null,
    validation: 'pending',
  })
  const unidentifiable = plant({
    displayName: 'regalo de la abuela',
    species: null,
    validation: 'unidentifiable',
  })
  const plants = [amabilis, pending, unidentifiable]

  it('ofrece las validaciones presentes, de la más a la menos resuelta', () => {
    expect(filterOptions(plants).validations).toEqual([
      'validated',
      'pending',
      'unidentifiable',
    ])
    expect(filterOptions([amabilis, unidentifiable]).validations).toEqual([
      'validated',
      'unidentifiable',
    ])
  })

  it('filtra con O dentro del grupo y cuenta como filtro activo', () => {
    expect(
      names(applyFilters(plants, filters({ validations: ['unidentifiable'] }))),
    ).toEqual(['regalo de la abuela'])
    expect(
      names(
        applyFilters(
          plants,
          filters({ validations: ['pending', 'unidentifiable'] }),
        ),
      ),
    ).toEqual(['la naranja del mercado', 'regalo de la abuela'])
    const chosen = filters({ validations: ['unidentifiable'] })
    expect(countActiveFilters(chosen)).toBe(1)
    expect(narrowsStatus(chosen)).toBe(true)
  })

  it('resolveFilters descarta una validación que no está en la colección', () => {
    expect(
      resolveFilters(
        filters({ validations: ['unidentifiable', 'pending'] }),
        filterOptions([amabilis, pending]),
      ).validations,
    ).toEqual(['pending'])
  })
})

describe('resolveFilters', () => {
  const options = filterOptions(ALL)

  it('ignora géneros, colores y orígenes que no están en la colección y quita repetidos', () => {
    const resolved = resolveFilters(
      filters({
        genera: ['no-existe', CATTLEYA.id, CATTLEYA.id],
        colors: ['purple', 'pink'],
        origins: ['otro', 'vivero moyobamba'],
      }),
      options,
    )
    expect(resolved).toEqual(
      filters({
        genera: [CATTLEYA.id],
        colors: ['pink'],
        origins: ['vivero moyobamba'],
      }),
    )
  })

  it('devuelve el mismo objeto si no cambia nada', () => {
    const same = filters({ genera: [PHALAENOPSIS.id] })
    expect(resolveFilters(same, options)).toBe(same)
    expect(resolveFilters(DEFAULT_FILTERS, options)).toBe(DEFAULT_FILTERS)
  })
})

describe('applyFilters', () => {
  it('por defecto, solo las activas', () => {
    expect(applyFilters(ALL, DEFAULT_FILTERS)).toEqual([
      amabilis,
      schilleriana,
      maxima,
      memoria,
    ])
  })

  it('el estado elige uno: perdidas o regaladas', () => {
    expect(applyFilters(ALL, filters({ status: 'lost' }))).toEqual([lost])
    expect(applyFilters(ALL, filters({ status: 'gifted' }))).toEqual([gifted])
  })

  it('género: varios valores se suman (O)', () => {
    expect(
      names(applyFilters(ALL, filters({ genera: [CATTLEYA.id] }))),
    ).toEqual(['Cattleya maxima'])
    expect(
      names(
        applyFilters(
          ALL,
          filters({ genera: [CATTLEYA.id, RHYNCHOLAELIOCATTLEYA.id] }),
        ),
      ),
    ).toEqual([
      'Cattleya maxima',
      '× Rhyncholaeliocattleya Memoria Anna Balmores',
    ])
  })

  it('color: los ejemplares sin color no aparecen', () => {
    expect(applyFilters(ALL, filters({ colors: ['pink'] }))).toEqual([
      schilleriana,
      maxima,
    ])
    expect(applyFilters(ALL, filters({ colors: ['white', 'pink'] }))).toEqual([
      amabilis,
      schilleriana,
      maxima,
    ])
  })

  it('origen: por su clave, sin mayúsculas ni espacios; sin origen no aparece', () => {
    expect(
      applyFilters(ALL, filters({ origins: ['vivero moyobamba'] })),
    ).toEqual([amabilis, schilleriana])
  })

  it('entre grupos se combinan con Y', () => {
    expect(
      applyFilters(
        ALL,
        filters({ genera: [PHALAENOPSIS.id], colors: ['pink'] }),
      ),
    ).toEqual([schilleriana])
    expect(
      applyFilters(
        ALL,
        filters({
          genera: [PHALAENOPSIS.id],
          colors: ['white'],
          status: 'lost',
          origins: ['vivero moyobamba'],
        }),
      ),
    ).toEqual([lost])
    expect(
      applyFilters(
        ALL,
        filters({ genera: [CATTLEYA.id], origins: ['vivero moyobamba'] }),
      ),
    ).toEqual([])
  })

  it('se combina con el buscador de texto', () => {
    const byColor = applyFilters(ALL, filters({ colors: ['pink'] }))
    expect(
      filterByText(byColor, 'cattleya', { includeInactive: true }),
    ).toEqual([maxima])
    const byStatus = applyFilters(ALL, filters({ status: 'lost' }))
    expect(
      filterByText(byStatus, 'aphrodite', { includeInactive: true }),
    ).toEqual([lost])
  })

  it('el trabajo crece con la colección, no con su cuadrado', () => {
    // Antes medía milisegundos con 300 plantas y fallaba con la máquina
    // cargada (#311). Ahora cuenta el trabajo (countWork) con 500 y 2000
    // plantas; los orígenes distintos crecen con la colección (uno cada 25).
    const many = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        plant({
          genus: index % 2 ? CATTLEYA : PHALAENOPSIS,
          flowerColor: index % 3 ? 'white' : null,
          origin: `Vivero ${String(index % (count / 25))}`,
        }),
      )
    const chosen = filters({
      genera: [CATTLEYA.id],
      colors: ['white'],
      origins: ['vivero 1', 'vivero 3'],
    })
    const operations: Record<
      string,
      (plants: readonly CollectionPlant[]) => unknown
    > = {
      'opciones de los filtros': (plants) => filterOptions(plants),
      'resolver y aplicar los filtros': (plants) =>
        applyFilters(plants, resolveFilters(chosen, filterOptions(plants))),
    }
    for (const [name, run] of Object.entries(operations)) {
      const small = countWork(many(500), run)
      const large = countWork(many(2000), run)
      // Cuatro veces más plantas: lineal es ×4 y n·log n, ×4,9; cuadrático
      // sería ×16.
      expect(large.total / small.total, name).toBeLessThan(6)
    }

    const plants = many(2000)
    const options = filterOptions(plants)
    expect(options.origins).toHaveLength(80)
    const result = applyFilters(plants, resolveFilters(chosen, options))
    expect(result.length).toBeGreaterThan(0)
  })
})

describe('contadores y utilidades', () => {
  it('plantsWithStatus da el total del que se dice "N de M"', () => {
    expect(plantsWithStatus(ALL, 'active')).toHaveLength(4)
    expect(plantsWithStatus(ALL, 'gifted')).toEqual([gifted])
  })

  it('countActiveFilters cuenta cada valor y el estado si no es el de por defecto', () => {
    expect(countActiveFilters(DEFAULT_FILTERS)).toBe(0)
    expect(
      countActiveFilters(
        filters({
          status: 'lost',
          genera: ['a', 'b'],
          colors: ['white'],
          origins: ['x'],
        }),
      ),
    ).toBe(5)
  })

  it('narrowsStatus: solo género, color u origen reducen el conjunto del estado', () => {
    expect(narrowsStatus(filters({ status: 'lost' }))).toBe(false)
    expect(narrowsStatus(filters({ colors: ['white'] }))).toBe(true)
  })

  it('sameFilters no tiene en cuenta el orden', () => {
    expect(
      sameFilters(
        filters({ genera: ['a', 'b'] }),
        filters({ genera: ['b', 'a'] }),
      ),
    ).toBe(true)
    expect(sameFilters(filters({ genera: ['a'] }), DEFAULT_FILTERS)).toBe(false)
  })

  it('toggleValue añade o quita un valor', () => {
    expect(toggleValue(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleValue(['a', 'b'], 'a')).toEqual(['b'])
  })
})
