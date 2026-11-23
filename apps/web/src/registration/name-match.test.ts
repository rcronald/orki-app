import { describe, expect, it } from 'vitest'
import type {
  GenusSearchResult,
  SpeciesSearchResult,
} from '../lib/catalogSearch.ts'
import { deducedGenus, exactNameMatch, genusWordOf } from './name-match.ts'

function species(
  id: string,
  scientificName: string,
  matched: Partial<
    Pick<SpeciesSearchResult, 'matchedName' | 'matchedNameType' | 'type'>
  > = {},
): SpeciesSearchResult {
  return {
    id,
    scientificName,
    genusId: `g-${scientificName.split(' ')[0] ?? ''}`,
    genusName: scientificName.split(' ')[0] ?? '',
    type: 'species',
    status: 'validated',
    matchedName: scientificName,
    matchedNameType: 'scientific',
    ...matched,
  }
}

const AMABILIS = species('1', 'Phalaenopsis amabilis')
const APHRODITE = species('2', 'Phalaenopsis aphrodite')
const INTERMEDIA = species('3', 'Phalaenopsis × intermedia', { type: 'hybrid' })
const PURPURATA = species('4', 'Cattleya purpurata', {
  matchedName: 'Laelia purpurata',
  matchedNameType: 'synonym',
})
const LAELIA_PURPURATA = species('5', 'Laelia purpurata')
const WAKANKI = species('6', 'Masdevallia veitchiana', {
  matchedName: 'Wakanki',
  matchedNameType: 'common',
})

describe('exactNameMatch (#280)', () => {
  it('el nombre aceptado de una sola especie la enlaza', () => {
    expect(
      exactNameMatch('Phalaenopsis amabilis', [AMABILIS, APHRODITE]),
    ).toEqual({ kind: 'link', result: AMABILIS })
  })

  it('sin tildes ni mayúsculas, con espacios de más y con o sin «×»', () => {
    for (const typed of [
      '  PHALÁENOPSIS   amabilis ',
      'phalaenopsis amabilis',
    ]) {
      expect(exactNameMatch(typed, [AMABILIS])).toMatchObject({ kind: 'link' })
    }
    for (const typed of [
      'Phalaenopsis × intermedia',
      'Phalaenopsis x intermedia',
      'phalaenopsis ×intermedia',
      'Phalaenopsis intermedia',
    ]) {
      expect(exactNameMatch(typed, [INTERMEDIA])).toEqual({
        kind: 'link',
        result: INTERMEDIA,
      })
    }
  })

  it('un parecido, un prefijo o la abreviatura del género no son exactos', () => {
    expect(exactNameMatch('Phalaenopsis amabilys', [AMABILIS])).toEqual({
      kind: 'none',
    })
    expect(exactNameMatch('Phalaenopsis amab', [AMABILIS])).toEqual({
      kind: 'none',
    })
    expect(exactNameMatch('Phal. amabilis', [AMABILIS])).toEqual({
      kind: 'none',
    })
    expect(exactNameMatch('Phalaenopsis amabilis alba', [AMABILIS])).toEqual({
      kind: 'none',
    })
    expect(exactNameMatch('', [AMABILIS])).toEqual({ kind: 'none' })
  })

  it('un sinónimo o un nombre común se ofrecen, no se enlazan', () => {
    expect(exactNameMatch('laelia purpurata', [PURPURATA])).toEqual({
      kind: 'offer',
      result: PURPURATA,
      by: 'synonym',
    })
    expect(exactNameMatch('Wakanki', [WAKANKI])).toEqual({
      kind: 'offer',
      result: WAKANKI,
      by: 'common',
    })
  })

  it('varias especies con ese nombre (aceptado en una, sinónimo en otra, u homónimos): ninguna', () => {
    expect(
      exactNameMatch('Laelia purpurata', [LAELIA_PURPURATA, PURPURATA]),
    ).toEqual({ kind: 'several', results: [LAELIA_PURPURATA, PURPURATA] })
    const homonym = species('7', 'Phalaenopsis amabilis', { type: 'hybrid' })
    expect(
      exactNameMatch('Phalaenopsis amabilis', [AMABILIS, homonym]),
    ).toMatchObject({ kind: 'several' })
    // La misma especie dos veces cuenta una.
    expect(
      exactNameMatch('Phalaenopsis amabilis', [AMABILIS, AMABILIS]),
    ).toMatchObject({ kind: 'link' })
  })

  it('con la lista llena y aún con nombres que empiezan por lo escrito, podría faltar otra: se ofrece', () => {
    const varieties = Array.from({ length: 9 }, (_, index) =>
      species(
        `v${String(index)}`,
        `Phalaenopsis amabilis var. ${String(index)}`,
      ),
    )
    expect(
      exactNameMatch('Phalaenopsis amabilis', [AMABILIS, ...varieties]),
    ).toEqual({ kind: 'offer', result: AMABILIS, by: 'scientific' })
    // Con menos de las pedidas, la lista está completa.
    expect(
      exactNameMatch('Phalaenopsis amabilis', [
        AMABILIS,
        ...varieties.slice(1),
      ]),
    ).toMatchObject({ kind: 'link' })
    // Llena, pero la última ya solo se parece: lo exacto iba antes.
    expect(
      exactNameMatch('Phalaenopsis amabilis', [
        AMABILIS,
        ...varieties.slice(1),
        APHRODITE,
      ]),
    ).toMatchObject({ kind: 'link' })
  })
})

function genus(
  id: string,
  name: string,
  matchedAbbreviation: string | null = null,
): GenusSearchResult {
  return { id, name, isQuickAccess: false, matchedAbbreviation }
}

describe('género deducido de un nombre libre (#280)', () => {
  it('la palabra del género es la primera, sin «×» ni «x» delante', () => {
    expect(genusWordOf('  Cattleya Mini Purple ')).toBe('Cattleya')
    expect(genusWordOf('× Brassocattleya Binosa')).toBe('Brassocattleya')
    expect(genusWordOf('×Brassocattleya Binosa')).toBe('Brassocattleya')
    expect(genusWordOf('x Brassocattleya Binosa')).toBe('Brassocattleya')
    expect(genusWordOf('Blc. Toshie Aoki')).toBe('Blc.')
    expect(genusWordOf('')).toBe('')
  })

  it('el nombre del género o su abreviatura, enteros y de uno solo', () => {
    const cattleya = genus('c', 'Cattleya')
    const blc = genus('b', '× Brassolaeliocattleya', 'Blc.')
    expect(deducedGenus('cattleya', [cattleya])).toEqual({
      id: 'c',
      name: 'Cattleya',
    })
    expect(deducedGenus('Blc.', [blc])).toEqual({
      id: 'b',
      name: '× Brassolaeliocattleya',
    })
    expect(deducedGenus('BLC', [blc])).toMatchObject({ id: 'b' })
    expect(deducedGenus('Brassolaeliocattleya', [blc])).toMatchObject({
      id: 'b',
    })
    // Solo el comienzo, o un parecido, no.
    expect(deducedGenus('Catt', [cattleya])).toBeNull()
    expect(deducedGenus('Catleya', [cattleya])).toBeNull()
    // Dos géneros con esa palabra: ninguno.
    expect(
      deducedGenus('Cal.', [
        genus('1', 'Calanthe', 'Cal.'),
        genus('2', 'Caladenia', 'Cal.'),
      ]),
    ).toBeNull()
  })
})
