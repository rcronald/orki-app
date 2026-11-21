import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearPlantDraft,
  PLANT_DRAFT_MAX_AGE_MS,
  PLANT_DRAFT_VERSION,
  plantDraftKey,
  readPlantDraft,
  writePlantDraft,
  type PlantDraft,
} from './draft.ts'
import { initialPlantFormValues, type PlantFormValues } from './form-state.ts'

const NOW = new Date('2026-11-21T15:00:00Z')
const VALUES: PlantFormValues = {
  ...initialPlantFormValues('2026-11-21'),
  name: 'Phalaenopsis amabilis',
  species: {
    id: 'species-amabilis',
    scientificName: 'Phalaenopsis amabilis',
    genus: { id: 'genus-phal', name: 'Phalaenopsis' },
    type: 'species',
  },
  genus: { id: 'genus-phal', name: 'Phalaenopsis' },
  type: 'species',
  origin: 'Vivero Sol',
  flowerColor: 'white',
}
const DRAFT: PlantDraft = {
  plantId: 'plant-1',
  values: VALUES,
  savedAt: NOW.getTime(),
}

function later(ms: number): Date {
  return new Date(NOW.getTime() + ms)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('borrador del registro', () => {
  it('guarda y lee el borrador con su id de planta y su versión', () => {
    expect(writePlantDraft('user_a', DRAFT)).toBe(true)
    expect(
      JSON.parse(window.localStorage.getItem(plantDraftKey('user_a')) ?? ''),
    ).toMatchObject({ version: PLANT_DRAFT_VERSION, plantId: 'plant-1' })
    expect(readPlantDraft('user_a', later(1000))).toEqual(DRAFT)
  })

  it('cada usuario tiene su clave', () => {
    writePlantDraft('user_a', DRAFT)
    expect(readPlantDraft('user_b', NOW)).toBeNull()
    expect(plantDraftKey('user_a')).not.toBe(plantDraftKey('user_b'))
  })

  it('caduca a las 24 horas y se borra; una fecha futura tampoco vale', () => {
    writePlantDraft('user_a', DRAFT)
    expect(readPlantDraft('user_a', later(PLANT_DRAFT_MAX_AGE_MS))).toEqual(
      DRAFT,
    )
    expect(readPlantDraft('user_a', later(PLANT_DRAFT_MAX_AGE_MS + 1))).toBe(
      null,
    )
    expect(window.localStorage.getItem(plantDraftKey('user_a'))).toBeNull()

    writePlantDraft('user_a', DRAFT)
    expect(readPlantDraft('user_a', later(-60_000))).toBeNull()
  })

  it.each([
    ['JSON roto', '{"version":1,'],
    ['otra versión', JSON.stringify({ ...DRAFT, version: 2 })],
    [
      'un tipo que no existe',
      JSON.stringify({
        ...DRAFT,
        version: PLANT_DRAFT_VERSION,
        values: { ...VALUES, type: 'orquídea' },
      }),
    ],
    [
      'un color que no existe',
      JSON.stringify({
        ...DRAFT,
        version: PLANT_DRAFT_VERSION,
        values: { ...VALUES, flowerColor: 'verde' },
      }),
    ],
    [
      'una especie incompleta',
      JSON.stringify({
        ...DRAFT,
        version: PLANT_DRAFT_VERSION,
        values: { ...VALUES, species: { id: 'x' } },
      }),
    ],
    [
      'un campo que falta',
      JSON.stringify({
        ...DRAFT,
        version: PLANT_DRAFT_VERSION,
        values: { ...VALUES, origin: undefined },
      }),
    ],
  ])('descarta y borra un borrador con %s', (_title, raw) => {
    window.localStorage.setItem(plantDraftKey('user_a'), raw)
    expect(readPlantDraft('user_a', NOW)).toBeNull()
    expect(window.localStorage.getItem(plantDraftKey('user_a'))).toBeNull()
  })

  it('clearPlantDraft borra solo el del usuario', () => {
    writePlantDraft('user_a', DRAFT)
    writePlantDraft('user_b', DRAFT)
    clearPlantDraft('user_a')
    expect(readPlantDraft('user_a', NOW)).toBeNull()
    expect(readPlantDraft('user_b', NOW)).toEqual(DRAFT)
  })

  it('sin almacenamiento, no falla', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Bloqueado', 'SecurityError')
    })
    expect(writePlantDraft('user_a', DRAFT)).toBe(false)
    expect(readPlantDraft('user_a', NOW)).toBeNull()
    expect(() => clearPlantDraft('user_a')).not.toThrow()
  })

  it('con el almacenamiento lleno o que falla al leer, no falla', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Lleno', 'QuotaExceededError')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Fallo', 'UnknownError')
    })
    expect(writePlantDraft('user_a', DRAFT)).toBe(false)
    expect(readPlantDraft('user_a', NOW)).toBeNull()
  })
})
