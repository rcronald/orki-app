import { describe, expect, it } from 'vitest'
import { plant } from '../test/collection.ts'
import {
  coverageOf,
  extrasStateOf,
  mergeCoverage,
  mergeExtras,
  NO_COVERAGE,
  uncoveredPlants,
} from './extras-state.ts'

const AMABILIS = plant({ id: 'amabilis' })
const POR_VALIDAR = plant({
  id: 'por-validar',
  species: null,
  genus: { id: 'genus-rlc', name: 'Rhyncholaeliocattleya' },
})

describe('estado de los extras (#274)', () => {
  it('completos si la cobertura incluye la especie y el género de cada planta', () => {
    const coverage = coverageOf([AMABILIS])
    expect(extrasStateOf([AMABILIS], coverage, 'idle')).toBe('complete')
    // Completos también mientras se vuelven a pedir: son los de esas plantas.
    expect(extrasStateOf([AMABILIS], coverage, 'loading')).toBe('complete')
    // Una planta sin especie solo necesita su género.
    expect(uncoveredPlants([AMABILIS, POR_VALIDAR], coverage)).toEqual([
      POR_VALIDAR,
    ])
    expect(
      extrasStateOf(
        [POR_VALIDAR],
        { speciesIds: new Set(), genusIds: new Set(['genus-rlc']) },
        'idle',
      ),
    ).toBe('complete')
  })

  it('si falta alguno: pendientes, fallidos o sin pedir', () => {
    const coverage = coverageOf([AMABILIS])
    const plants = [AMABILIS, POR_VALIDAR]
    expect(extrasStateOf(plants, coverage, 'loading')).toBe('pending')
    expect(extrasStateOf(plants, coverage, 'failed')).toBe('failed')
    expect(extrasStateOf(plants, coverage, 'idle')).toBe('outdated')
  })

  it('con la cobertura desconocida (copia anterior), nunca completos salvo sin plantas', () => {
    expect(extrasStateOf([AMABILIS], null, 'idle')).toBe('outdated')
    expect(extrasStateOf([], null, 'idle')).toBe('complete')
    expect(extrasStateOf([AMABILIS], NO_COVERAGE, 'loading')).toBe('pending')
  })

  it('al unir, de lo pedido manda lo nuevo, también si ya no tiene ninguno', () => {
    const before = {
      speciesNames: new Map([
        ['species-amabilis', [{ name: 'Vieja', type: 'common' as const }]],
        ['species-otra', [{ name: 'Otra', type: 'common' as const }]],
      ]),
      genusAbbreviations: new Map([['genus-phal', ['Phal.']]]),
    }
    const merged = mergeExtras(
      before,
      { genusAbbreviations: new Map([['genus-rlc', ['Rlc.']]]) },
      coverageOf([AMABILIS, POR_VALIDAR]),
    )
    expect(merged.speciesNames?.has('species-amabilis')).toBe(false)
    expect(merged.speciesNames?.get('species-otra')).toEqual([
      { name: 'Otra', type: 'common' },
    ])
    expect(merged.genusAbbreviations?.get('genus-rlc')).toEqual(['Rlc.'])
    expect(merged.genusAbbreviations?.has('genus-phal')).toBe(false)
    expect(
      mergeCoverage(coverageOf([AMABILIS]), coverageOf([POR_VALIDAR])),
    ).toEqual(coverageOf([AMABILIS, POR_VALIDAR]))
  })
})
