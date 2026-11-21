import { describe, expect, it } from 'vitest'
import { PLANT_NAME_MAX_LENGTH } from './form-state.ts'
import {
  newPlantPathWithName,
  prefilledName,
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
