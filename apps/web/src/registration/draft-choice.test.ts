import { describe, expect, it } from 'vitest'
import type { PlantDraft } from './draft.ts'
import { decideStart, draftsFull, isSameRegistration } from './draft-choice.ts'
import { initialPlantFormValues, type FormSpecies } from './form-state.ts'

const VANDA: FormSpecies = {
  id: 'especie-vanda',
  scientificName: 'Vanda coerulea',
  genus: { id: 'genero-vanda', name: 'Vanda' },
  type: 'species',
}
const CATTLEYA: FormSpecies = {
  id: 'especie-cattleya',
  scientificName: 'Cattleya maxima',
  genus: { id: 'genero-cattleya', name: 'Cattleya' },
  type: 'species',
}

function draft(
  plantId: string,
  name: string,
  species: FormSpecies | null = null,
): PlantDraft {
  return {
    plantId,
    savedAt: 0,
    values: { ...initialPlantFormValues('2026-11-23'), name, species },
  }
}

const fromCatalog = { species: VANDA, name: 'Vanda coerulea' }
const fromHaveIt = { species: null, name: 'Vanda coerulea' }
const nothing = { species: null, name: '' }

describe('con qué empieza el registro (#296)', () => {
  it('sin borradores, con lo que llega (o vacío)', () => {
    expect(decideStart([], fromCatalog)).toEqual({ kind: 'form', draft: null })
    expect(decideStart([], nothing)).toEqual({ kind: 'form', draft: null })
  })

  it('sin nada que llegue, el borrador más reciente', () => {
    const latest = draft('a', 'Cattleya maxima')
    expect(decideStart([latest, draft('b', 'Stanhopea')], nothing)).toEqual({
      kind: 'form',
      draft: latest,
    })
  })

  it('con un borrador de otra cosa, se pregunta: desde la ficha del catálogo y desde «¿Ya la tengo?»', () => {
    const cattleya = [draft('a', 'Cattleya maxima', CATTLEYA)]
    expect(decideStart(cattleya, fromCatalog)).toEqual({ kind: 'choice' })
    expect(decideStart(cattleya, fromHaveIt)).toEqual({ kind: 'choice' })
    // También un borrador sin nombre (solo fotos u otros datos).
    expect(decideStart([draft('b', '')], fromHaveIt)).toEqual({
      kind: 'choice',
    })
  })

  it('con un borrador de la misma especie o del mismo nombre normalizado, ese borrador sin preguntar', () => {
    const linked = draft('a', 'Vanda coerulea', VANDA)
    const typed = draft('b', '  VANDA   coerulea ')
    expect(decideStart([linked], fromCatalog)).toEqual({
      kind: 'form',
      draft: linked,
    })
    expect(decideStart([typed], fromCatalog)).toEqual({
      kind: 'form',
      draft: typed,
    })
    // El que coincide, aunque no sea el más reciente.
    expect(
      decideStart([draft('c', 'Cattleya maxima'), typed], fromHaveIt),
    ).toEqual({ kind: 'form', draft: typed })
  })

  it('la misma especie aunque el texto del borrador cambiara, y nombres sin tildes', () => {
    expect(
      isSameRegistration(draft('a', 'Vanda azul', VANDA), fromCatalog),
    ).toBe(true)
    expect(
      isSameRegistration(draft('b', 'Oncidium Ruth Fujimoto'), {
        species: null,
        name: 'oncídium ruth fujimoto',
      }),
    ).toBe(true)
    expect(isSameRegistration(draft('c', ''), nothing)).toBe(false)
  })

  it('con dos borradores ya no cabe otro', () => {
    expect(draftsFull([draft('a', 'x')])).toBe(false)
    expect(draftsFull([draft('a', 'x'), draft('b', 'y')])).toBe(true)
  })
})
