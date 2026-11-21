import { describe, expect, it } from 'vitest'
import {
  allowedTypos,
  boundedEditDistance,
  boundedPrefixDistance,
} from './similarity.ts'

describe('boundedEditDistance', () => {
  it.each([
    ['amabilis', 'amabilis', 0],
    ['amabilis', 'amabils', 1], // falta una letra
    ['amabilis', 'amabiliss', 1], // sobra una
    ['amabilis', 'amabolis', 1], // una cambiada
    ['amabilis', 'amabilsi', 1], // dos vecinas intercambiadas
    ['phalaenopsis', 'phalenopsis', 1],
    ['phalaenopsis', 'phalenopsys', 2],
    ['', 'abc', 3],
    ['abc', '', 3],
  ])('%s → %s: %i', (a, b, expected) => {
    expect(boundedEditDistance(a, b, 3)).toBe(expected)
  })

  it('devuelve el tope más uno en cuanto se pasa de él', () => {
    expect(boundedEditDistance('cattleya', 'catasetum', 2)).toBe(3)
    expect(boundedEditDistance('abcdef', 'a', 2)).toBe(3)
    expect(boundedEditDistance('labiata', 'lobata', 1)).toBe(2)
  })
})

describe('boundedPrefixDistance', () => {
  it('una palabra a medias está a 0 de la entera', () => {
    expect(boundedPrefixDistance('amab', 'amabilis', 1)).toBe(0)
  })

  it('una palabra a medias con un error', () => {
    expect(boundedPrefixDistance('amabl', 'amabilis', 1)).toBe(1)
    expect(boundedPrefixDistance('phla', 'phalaenopsis', 1)).toBe(1)
  })

  it('compara también con la palabra entera, aunque sea más corta', () => {
    expect(boundedPrefixDistance('amabiliss', 'amabilis', 2)).toBe(1)
  })

  it('pasa del tope si no se parece', () => {
    expect(boundedPrefixDistance('maxima', 'maculata', 1)).toBe(2)
  })
})

describe('allowedTypos', () => {
  it.each([
    [2, 0],
    [3, 0],
    [4, 1],
    [7, 1],
    [8, 2],
    [14, 2],
  ])('%i letras: %i', (length, expected) => {
    expect(allowedTypos(length)).toBe(expected)
  })
})
