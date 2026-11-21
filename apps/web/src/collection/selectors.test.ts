import { describe, expect, it } from 'vitest'
import {
  CATTLEYA,
  PHALAENOPSIS,
  plant,
  RHYNCHOLAELIOCATTLEYA,
} from '../test/collection.ts'
import {
  compareNames,
  countGenera,
  countPlants,
  filterByText,
  groupByGenus,
  plantsByStatus,
  sortByName,
  sortByNewest,
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

  it('una planta editada (otro objeto) se busca con sus datos nuevos', () => {
    expect(filterByText([amabilis], 'rosita')).toEqual([])
    const edited = { ...amabilis, nickname: 'Rosita' }
    expect(filterByText([edited], 'rosita')).toEqual([edited])
  })
})
