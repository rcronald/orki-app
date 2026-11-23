import { describe, expect, it } from 'vitest'
import type { CollectionPlant } from '../collection/model.ts'
import { unlinkedPlantsNamed } from '../collection/ownership.ts'
import { CATTLEYA, PHALAENOPSIS, plant } from '../test/collection.ts'
import { speciesOwnershipOf, unlinkedLink } from './species-ownership.ts'

// La ficha de una especie y los ejemplares sin validar (#296): qué plantas
// sin especie corresponden a la especie, con el criterio de «¿Ya la tengo?».

const AMABILIS = {
  id: 'species-amabilis',
  scientificName: 'Phalaenopsis amabilis',
  synonyms: ['Phalaenopsis grandiflora', 'Epidendrum amabile'],
}

function unlinked(
  enteredName: string,
  overrides: Partial<CollectionPlant> = {},
): CollectionPlant {
  return plant({
    displayName: enteredName,
    displayNameIsScientific: false,
    enteredName,
    species: null,
    validation: 'pending',
    ...overrides,
  })
}

const namesOf = (plants: readonly CollectionPlant[]) =>
  unlinkedPlantsNamed(plants, AMABILIS).map(({ plant }) => plant.enteredName)

describe('unlinkedPlantsNamed', () => {
  it('por el nombre aceptado, escrito de cualquier forma', () => {
    expect(
      namesOf([
        unlinked('Phalaenopsis amabilis'),
        unlinked('phalaenopsis  AMABILIS'),
        unlinked("Phalaenopsis amabilis 'Blanca'"),
      ]),
    ).toHaveLength(3)
  })

  it('por un sinónimo de la ficha, aunque sea de otro género', () => {
    expect(
      namesOf([
        unlinked('Phalaenopsis grandiflora'),
        unlinked('Epidendrum amabile', {
          genus: { id: 'genus-epi', name: 'Epidendrum' },
        }),
      ]),
    ).toEqual(['Epidendrum amabile', 'Phalaenopsis grandiflora'])
  })

  it('por la abreviatura del género y por el epíteto en su género', () => {
    expect(
      namesOf([unlinked('Phal. amabilis'), unlinked('amabilis')]),
    ).toHaveLength(2)
  })

  it('con un error de tipeo, como parecida', () => {
    const [match] = unlinkedPlantsNamed(
      [unlinked('Phalaenopsis amabilsi')],
      AMABILIS,
    )
    expect(match?.quality).toBe('similar')
  })

  it('no por el género solo, otra especie, otro género ni un nombre común', () => {
    expect(
      namesOf([
        unlinked('Phal.'),
        unlinked('Phalaenopsis'),
        unlinked('Phalaenopsis schilleriana'),
        unlinked('amabilis', { genus: CATTLEYA }),
        unlinked('Orquídea luna'),
      ]),
    ).toEqual([])
  })

  it('no cuenta las enlazadas (se cuentan por su especie); sí las dadas de baja', () => {
    expect(
      namesOf([
        plant({ enteredName: 'Phalaenopsis amabilis' }),
        unlinked('Phalaenopsis amabilis', { status: 'lost' }),
      ]),
    ).toEqual(['Phalaenopsis amabilis'])
  })
})

describe('speciesOwnershipOf', () => {
  it('separa enlazadas, sin validar y dadas de baja; solo las activas cuentan', () => {
    const linked = plant()
    const pending = unlinked('Phal. amabilis')
    const result = speciesOwnershipOf(
      [
        linked,
        { ...linked, id: 'regalada', status: 'gifted' },
        pending,
        unlinked('amabilis', { status: 'lost' }),
        unlinked('Cattleya maxima', { genus: CATTLEYA }),
      ],
      AMABILIS,
    )
    expect(result.linked).toEqual([linked])
    expect(result.unlinked).toEqual([pending])
    expect(result.lost).toBe(1)
    expect(result.gifted).toBe(1)
  })
})

describe('unlinkedLink', () => {
  it('con uno, a su ficha', () => {
    const only = unlinked('Phalaenopsis amabilis', { id: 'planta-1' })
    expect(unlinkedLink([only], AMABILIS.scientificName)).toBe(
      '/coleccion/planta-1',
    )
  })

  it('con varios, al inventario con una búsqueda que los encuentra a todos', () => {
    expect(
      unlinkedLink(
        [unlinked('Phalaenopsis amabilis'), unlinked('amabilis')],
        AMABILIS.scientificName,
      ),
    ).toBe('/coleccion?q=Phalaenopsis+amabilis&validacion=pending')
    // «Phal. amabilis» no sale buscando el nombre entero, sí buscándolo a él.
    expect(
      unlinkedLink(
        [unlinked('Phal. amabilis'), unlinked('Phal. amabilis')],
        AMABILIS.scientificName,
      ),
    ).toBe('/coleccion?q=Phal.+amabilis&validacion=pending')
  })

  it('si ninguna búsqueda los encuentra a todos, solo el filtro de validación', () => {
    expect(
      unlinkedLink(
        [
          unlinked('Phal. amabilis'),
          unlinked('Phalaenopsis grandiflora', {
            validation: 'unidentifiable',
            genus: PHALAENOPSIS,
          }),
        ],
        AMABILIS.scientificName,
      ),
    ).toBe('/coleccion?validacion=pending&validacion=unidentifiable')
  })
})
