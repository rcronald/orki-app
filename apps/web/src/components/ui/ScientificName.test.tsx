import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ScientificName } from './ScientificName.tsx'
import { scientificNameParts } from './scientific-name.ts'

/** Tramos como "i:texto" (cursiva) o "r:texto" (redonda). */
function parts(name: string) {
  return scientificNameParts(name).map(
    (part) => `${part.italic ? 'i' : 'r'}:${part.text}`,
  )
}

describe('scientificNameParts', () => {
  it('una especie va entera en cursiva', () => {
    expect(parts('Phalaenopsis amabilis')).toEqual(['i:Phalaenopsis amabilis'])
    expect(parts('Masdevallia')).toEqual(['i:Masdevallia'])
  })

  it('el signo de un híbrido natural va en redonda y el epíteto en cursiva', () => {
    expect(parts('Phalaenopsis × intermedia')).toEqual([
      'i:Phalaenopsis ',
      'r:× ',
      'i:intermedia',
    ])
    expect(parts('Phalaenopsis x intermedia')).toEqual([
      'i:Phalaenopsis ',
      'r:x ',
      'i:intermedia',
    ])
  })

  it('el signo de un género híbrido va en redonda, también pegado', () => {
    expect(parts('× Rhyncholaeliocattleya')).toEqual([
      'r:× ',
      'i:Rhyncholaeliocattleya',
    ])
    expect(parts('×Brassocattleya')).toEqual(['r:×', 'i:Brassocattleya'])
  })

  it('el grex y el cultivar van en redonda', () => {
    expect(parts('Phalaenopsis Sogo Yukidian')).toEqual([
      'i:Phalaenopsis ',
      'r:Sogo Yukidian',
    ])
    expect(parts('× Rhyncholaeliocattleya Memoria Anna Balmores')).toEqual([
      'r:× ',
      'i:Rhyncholaeliocattleya ',
      'r:Memoria Anna Balmores',
    ])
    expect(parts("Oncidium Sharry Baby 'Sweet Fragrance'")).toEqual([
      'i:Oncidium ',
      "r:Sharry Baby 'Sweet Fragrance'",
    ])
    expect(parts("Cattleya maxima 'Alba'")).toEqual([
      'i:Cattleya maxima ',
      "r:'Alba'",
    ])
  })

  it('las abreviaturas de rango van en redonda', () => {
    expect(parts('Cattleya trianae var. alba')).toEqual([
      'i:Cattleya trianae ',
      'r:var. ',
      'i:alba',
    ])
  })

  it('conserva el texto exacto', () => {
    const name = '  × Rhyncholaeliocattleya  Memoria '
    expect(
      scientificNameParts(name)
        .map((part) => part.text)
        .join(''),
    ).toBe(name)
  })
})

describe('ScientificName', () => {
  it('pinta cada tramo con su inclinación y el texto entero', () => {
    const { container } = render(
      <p>
        <ScientificName name="Phalaenopsis × intermedia" />
      </p>,
    )

    expect(container.textContent).toBe('Phalaenopsis × intermedia')
    expect(
      [...container.querySelectorAll('span')].map((span) => span.className),
    ).toEqual(['italic', 'not-italic font-body', 'italic'])
  })
})
