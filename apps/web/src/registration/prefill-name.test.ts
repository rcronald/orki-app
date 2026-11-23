import { describe, expect, it } from 'vitest'
import { PLANT_NAME_MAX_LENGTH } from './form-state.ts'
import {
  newPlantLinkForSpecies,
  newPlantPathWithName,
  prefilledName,
  prefilledSpecies,
  PREFILL_NAME_PARAM,
} from './prefill-name.ts'

describe('registro con el nombre escrito', () => {
  it('la dirección lleva el nombre limpio, y vuelve igual', () => {
    const path = newPlantPathWithName('  Phal.   amabilis × ')
    expect(path).toBe('/coleccion/nueva?nombre=Phal.+amabilis+%C3%97')
    const search = new URLSearchParams(path.split('?')[1])
    expect(prefilledName(search)).toBe('Phal. amabilis ×')
  })

  it('sin nombre, la dirección de siempre y ningún nombre', () => {
    expect(newPlantPathWithName('   ')).toBe('/coleccion/nueva')
    expect(prefilledName(new URLSearchParams())).toBe('')
  })

  it('recorta al tope del campo de nombre', () => {
    const long = 'a'.repeat(PLANT_NAME_MAX_LENGTH + 50)
    const search = new URLSearchParams({ [PREFILL_NAME_PARAM]: long })
    expect(prefilledName(search)).toHaveLength(PLANT_NAME_MAX_LENGTH)
  })
})

describe('registro con la especie del catálogo (#232)', () => {
  const species = {
    id: 'especie-1',
    scientificName: 'Cattleya  purpurata',
    genus: { id: 'genero-1', name: 'Cattleya' },
    type: 'species' as const,
  }

  it('el enlace lleva el nombre en la dirección y la especie en el estado', () => {
    const link = newPlantLinkForSpecies(species)
    expect(link.to).toBe('/coleccion/nueva?nombre=Cattleya+purpurata')
    const name = prefilledName(new URLSearchParams(link.to.split('?')[1]))
    expect(prefilledSpecies(link.state, name)).toEqual(species)
  })

  it('sin estado, con otro nombre o con un estado mal formado, ninguna', () => {
    const { state } = newPlantLinkForSpecies(species)
    expect(prefilledSpecies(null, 'Cattleya purpurata')).toBeNull()
    expect(prefilledSpecies(state, 'Cattleya maxima')).toBeNull()
    expect(
      prefilledSpecies(
        { catalogSpecies: { ...species, type: 'unknown' } },
        'Cattleya purpurata',
      ),
    ).toBeNull()
    expect(
      prefilledSpecies(
        { catalogSpecies: { ...species, genus: null } },
        'Cattleya purpurata',
      ),
    ).toBeNull()
  })
})
