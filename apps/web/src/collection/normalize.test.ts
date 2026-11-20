import { describe, expect, it } from 'vitest'
import { normalizeSearchText } from './normalize.ts'

describe('normalizeSearchText', () => {
  it.each([
    // Minúsculas, tildes y diacríticos.
    ['Phalaenopsis Amabilis', 'phalaenopsis amabilis'],
    ['Orquídea MARIPOSA', 'orquidea mariposa'],
    ['Señorita', 'senorita'],
    ['Müller', 'muller'],
    ['Cœlogyne Ørsted', 'coelogyne orsted'],
    // Espacios unificados y recortados.
    ['  Cattleya \t  labiata \n', 'cattleya labiata'],
    ['', ''],
    ['   ', ''],
    // Signo de híbrido "×", pegado o separado.
    ['× Rhyncholaeliocattleya', 'rhyncholaeliocattleya'],
    ['×Rhyncholaeliocattleya', 'rhyncholaeliocattleya'],
    ['Phalaenopsis × intermedia', 'phalaenopsis intermedia'],
    ['Phalaenopsis ×intermedia', 'phalaenopsis intermedia'],
    // "x" suelta como signo, al principio o en medio.
    ['phalaenopsis x intermedia', 'phalaenopsis intermedia'],
    ['Phal X intermedia', 'phal intermedia'],
    ['x Rhyncholaeliocattleya', 'rhyncholaeliocattleya'],
    ['a x x b', 'a b'],
    ['x a', 'a'],
    // La "x" dentro de una palabra o al final no se toca.
    ['Phalaenopsis xanthina', 'phalaenopsis xanthina'],
    ['Laelia anceps', 'laelia anceps'],
    ['phal x', 'phal x'],
    ['x', 'x'],
    ['Maxillaria', 'maxillaria'],
  ])('%j → %j', (input, expected) => {
    expect(normalizeSearchText(input)).toBe(expected)
  })

  it('es idempotente', () => {
    const once = normalizeSearchText(' Phalaenopsis × Íntermedia x ')
    expect(normalizeSearchText(once)).toBe(once)
  })
})
