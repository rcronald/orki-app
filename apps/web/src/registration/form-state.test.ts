import { describe, expect, it } from 'vitest'
import {
  initialPlantFormValues,
  isPendingName,
  isPlantFormDirty,
  plantFormReducer,
  toPlantInsert,
  validatePlantForm,
  type FormSpecies,
  type PlantFormValues,
} from './form-state.ts'
import { PLANT_FORM_ERROR_TEXT } from './texts.ts'

const TODAY = '2026-11-21'
const PHAL = { id: 'genus-phal', name: 'Phalaenopsis' }
const CATT = { id: 'genus-catt', name: 'Cattleya' }
const AMABILIS: FormSpecies = {
  id: 'species-amabilis',
  scientificName: 'Phalaenopsis amabilis',
  genus: PHAL,
  type: 'species',
}

function filled(overrides: Partial<PlantFormValues> = {}): PlantFormValues {
  return {
    ...initialPlantFormValues(TODAY),
    name: 'Phalaenopsis amabilis',
    genus: PHAL,
    type: 'species',
    ...overrides,
  }
}

describe('plantFormReducer', () => {
  it('elegir una especie pone su nombre, su género y su tipo', () => {
    const state = plantFormReducer(
      { ...initialPlantFormValues(TODAY), name: 'phal amab', type: 'unknown' },
      { type: 'speciesSelected', species: AMABILIS },
    )
    expect(state).toMatchObject({
      name: 'Phalaenopsis amabilis',
      species: AMABILIS,
      genus: PHAL,
      type: 'species',
    })
  })

  it('con una especie elegida, el género y el tipo no cambian', () => {
    let state = plantFormReducer(initialPlantFormValues(TODAY), {
      type: 'speciesSelected',
      species: AMABILIS,
    })
    state = plantFormReducer(state, { type: 'genusSelected', genus: CATT })
    state = plantFormReducer(state, {
      type: 'typeSelected',
      plantType: 'hybrid',
    })
    state = plantFormReducer(state, { type: 'otherGenusToggled' })
    expect(state).toMatchObject({
      genus: PHAL,
      type: 'species',
      otherGenusOpen: false,
    })
  })

  it('cambiar el nombre desenlaza la especie y conserva género y tipo', () => {
    let state = plantFormReducer(initialPlantFormValues(TODAY), {
      type: 'speciesSelected',
      species: AMABILIS,
    })
    state = plantFormReducer(state, {
      type: 'nameChanged',
      name: 'Phalaenopsis amabili',
    })
    expect(state).toMatchObject({ species: null, genus: PHAL, type: 'species' })
    state = plantFormReducer(state, { type: 'genusSelected', genus: CATT })
    expect(state.genus).toBe(CATT)
  })

  it('abrir "Otro" quita el género elegido; elegir uno lo cierra', () => {
    let state = filled()
    state = plantFormReducer(state, { type: 'otherGenusToggled' })
    expect(state).toMatchObject({ otherGenusOpen: true, genus: null })
    state = plantFormReducer(state, { type: 'genusSelected', genus: CATT })
    expect(state).toMatchObject({ otherGenusOpen: false, genus: CATT })
  })
})

describe('validatePlantForm', () => {
  it('un formulario completo no tiene errores', () => {
    expect(validatePlantForm(filled(), TODAY)).toEqual({})
  })

  it('exige los cuatro campos', () => {
    expect(
      validatePlantForm({ ...initialPlantFormValues(''), name: '   ' }, TODAY),
    ).toEqual({
      name: PLANT_FORM_ERROR_TEXT.nameMissing,
      genus: PLANT_FORM_ERROR_TEXT.genusMissing,
      type: PLANT_FORM_ERROR_TEXT.typeMissing,
      acquiredOn: PLANT_FORM_ERROR_TEXT.dateMissing,
    })
  })

  it('con "Otro" abierto pide buscar un género', () => {
    expect(
      validatePlantForm(filled({ genus: null, otherGenusOpen: true }), TODAY)
        .genus,
    ).toBe(PLANT_FORM_ERROR_TEXT.genusNotFound)
  })

  it('el nombre tiene un tope de 200 caracteres, contados sin espacios sobrantes', () => {
    const name200 = 'a'.repeat(200)
    expect(
      validatePlantForm(filled({ name: `  ${name200}  ` }), TODAY),
    ).toEqual({})
    expect(validatePlantForm(filled({ name: `${name200}b` }), TODAY).name).toBe(
      PLANT_FORM_ERROR_TEXT.nameTooLong,
    )
    // Cuenta caracteres, no unidades de UTF-16.
    expect(
      validatePlantForm(filled({ name: '🌸'.repeat(200) }), TODAY),
    ).toEqual({})
  })

  it('rechaza fechas futuras y fechas que no existen', () => {
    expect(
      validatePlantForm(filled({ acquiredOn: '2026-11-22' }), TODAY).acquiredOn,
    ).toBe(PLANT_FORM_ERROR_TEXT.dateFuture)
    expect(
      validatePlantForm(filled({ acquiredOn: '2026-02-30' }), TODAY).acquiredOn,
    ).toBe(PLANT_FORM_ERROR_TEXT.dateInvalid)
    expect(validatePlantForm(filled({ acquiredOn: TODAY }), TODAY)).toEqual({})
    expect(
      validatePlantForm(filled({ acquiredOn: '2019-05-01' }), TODAY),
    ).toEqual({})
  })
})

describe('toPlantInsert', () => {
  it('con especie envía species_id y nunca validation ni user_id', () => {
    const values = plantFormReducer(initialPlantFormValues(TODAY), {
      type: 'speciesSelected',
      species: AMABILIS,
    })
    expect(toPlantInsert(values, 'id-1')).toEqual({
      id: 'id-1',
      entered_name: 'Phalaenopsis amabilis',
      genus_id: PHAL.id,
      type: 'species',
      acquired_on: TODAY,
      species_id: AMABILIS.id,
    })
  })

  it('sin especie, el nombre libre va limpio y sin species_id', () => {
    const insert = toPlantInsert(
      filled({ name: '  La   naranja del mercado ', type: 'unknown' }),
      'id-2',
    )
    expect(insert).toEqual({
      id: 'id-2',
      entered_name: 'La naranja del mercado',
      genus_id: PHAL.id,
      type: 'unknown',
      acquired_on: TODAY,
    })
    expect(insert).not.toHaveProperty('validation')
    expect(insert).not.toHaveProperty('user_id')
  })
})

describe('isPendingName e isPlantFormDirty', () => {
  it('un nombre sin especie queda por validar', () => {
    expect(isPendingName(filled())).toBe(true)
    expect(isPendingName(filled({ species: AMABILIS }))).toBe(false)
    expect(isPendingName(filled({ name: '  ' }))).toBe(false)
  })

  it('el formulario recién abierto no tiene cambios', () => {
    const initial = initialPlantFormValues(TODAY)
    expect(isPlantFormDirty(initial, initial)).toBe(false)
    expect(isPlantFormDirty({ ...initial, name: ' ' }, initial)).toBe(false)
    expect(isPlantFormDirty({ ...initial, type: 'hybrid' }, initial)).toBe(true)
    expect(
      isPlantFormDirty({ ...initial, acquiredOn: '2026-11-01' }, initial),
    ).toBe(true)
  })
})
