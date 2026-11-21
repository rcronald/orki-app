import { describe, expect, it } from 'vitest'
import { plant } from '../test/collection.ts'
import {
  readRegisteredPlant,
  registeredPlantState,
} from './registered-plant.ts'

describe('registered-plant', () => {
  it('lleva la etiqueta de validación; "no identificable" se ve como por validar', () => {
    expect(
      readRegisteredPlant(registeredPlantState(plant({ id: 'a' }))),
    ).toEqual({
      id: 'a',
      name: 'Phalaenopsis amabilis',
      scientific: true,
      status: 'validated',
    })
    expect(
      readRegisteredPlant(
        registeredPlantState(
          plant({
            displayName: 'regalo de la abuela',
            displayNameIsScientific: false,
            species: null,
            validation: 'unidentifiable',
          }),
        ),
      )?.status,
    ).toBe('pending')
  })

  it('acepta un estado sin etiqueta (de una versión anterior) y descarta lo que no entiende', () => {
    expect(
      readRegisteredPlant({
        registeredPlant: { id: 'a', name: 'x', scientific: false },
      }),
    ).toEqual({ id: 'a', name: 'x', scientific: false })
    expect(
      readRegisteredPlant({
        registeredPlant: {
          id: 'a',
          name: 'x',
          scientific: false,
          status: 'otra',
        },
      }),
    ).toEqual({ id: 'a', name: 'x', scientific: false })
    expect(readRegisteredPlant({ registeredPlant: { id: 'a' } })).toBeNull()
    expect(readRegisteredPlant(null)).toBeNull()
  })
})
