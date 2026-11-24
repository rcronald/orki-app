import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearPlantDraft,
  MAX_PLANT_DRAFTS,
  PLANT_DRAFT_MAX_AGE_MS,
  PLANT_DRAFT_VERSION,
  plantDraftKey,
  readPlantDraft,
  readPlantDrafts,
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
    ).toMatchObject({
      version: PLANT_DRAFT_VERSION,
      drafts: [{ plantId: 'plant-1' }],
    })
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
    ['otra versión', JSON.stringify({ ...DRAFT, version: 99 })],
    [
      'una lista que no es una lista',
      JSON.stringify({ version: PLANT_DRAFT_VERSION, drafts: DRAFT }),
    ],
    [
      'un borrador roto en la lista',
      JSON.stringify({
        version: PLANT_DRAFT_VERSION,
        drafts: [DRAFT, { ...DRAFT, plantId: '' }],
      }),
    ],
    [
      'un tipo que no existe',
      JSON.stringify({
        ...DRAFT,
        version: 1,
        values: { ...VALUES, type: 'orquídea' },
      }),
    ],
    [
      'un color que no existe',
      JSON.stringify({
        ...DRAFT,
        version: 1,
        values: { ...VALUES, flowerColor: 'verde' },
      }),
    ],
    [
      'una especie incompleta',
      JSON.stringify({
        ...DRAFT,
        version: 1,
        values: { ...VALUES, species: { id: 'x' } },
      }),
    ],
    [
      'un campo que falta',
      JSON.stringify({
        ...DRAFT,
        version: 1,
        values: { ...VALUES, origin: undefined },
      }),
    ],
  ])('descarta y borra un borrador con %s', (_title, raw) => {
    window.localStorage.setItem(plantDraftKey('user_a'), raw)
    expect(readPlantDraft('user_a', NOW)).toBeNull()
    expect(window.localStorage.getItem(plantDraftKey('user_a'))).toBeNull()
  })

  it('lee el formato de un solo borrador (versión 1, anterior al #296) y la siguiente escritura lo pasa a la lista', () => {
    window.localStorage.setItem(
      plantDraftKey('user_a'),
      JSON.stringify({ version: 1, ...DRAFT }),
    )
    expect(readPlantDrafts('user_a', NOW)).toEqual([DRAFT])
    const other = { ...DRAFT, plantId: 'plant-2', savedAt: NOW.getTime() + 1 }
    writePlantDraft('user_a', other)
    expect(
      JSON.parse(window.localStorage.getItem(plantDraftKey('user_a')) ?? ''),
    ).toMatchObject({ version: PLANT_DRAFT_VERSION })
    expect(readPlantDrafts('user_a', later(1000))).toEqual([other, DRAFT])
  })

  it('guarda varios borradores (#296), del más reciente al más antiguo; cada uno se lee y se borra por su id', () => {
    const second = { ...DRAFT, plantId: 'plant-2', savedAt: NOW.getTime() + 5 }
    writePlantDraft('user_a', DRAFT)
    writePlantDraft('user_a', second)
    expect(readPlantDrafts('user_a', later(1000))).toEqual([second, DRAFT])
    expect(readPlantDraft('user_a', later(1000))).toEqual(second)
    expect(readPlantDraft('user_a', later(1000), 'plant-1')).toEqual(DRAFT)

    // Reescribir uno lo sustituye, no lo duplica.
    const edited = { ...DRAFT, savedAt: NOW.getTime() + 10 }
    writePlantDraft('user_a', edited)
    expect(readPlantDrafts('user_a', later(1000))).toEqual([edited, second])

    clearPlantDraft('user_a', 'plant-2')
    expect(readPlantDrafts('user_a', later(1000))).toEqual([edited])
    clearPlantDraft('user_a', 'plant-1')
    expect(window.localStorage.getItem(plantDraftKey('user_a'))).toBeNull()
  })

  it('cada borrador caduca por su cuenta', () => {
    const recent = {
      ...DRAFT,
      plantId: 'plant-2',
      savedAt: NOW.getTime() + 60 * 60 * 1000,
    }
    writePlantDraft('user_a', DRAFT)
    writePlantDraft('user_a', recent)
    expect(
      readPlantDrafts('user_a', later(PLANT_DRAFT_MAX_AGE_MS + 1)),
    ).toEqual([recent])
    // El caducado ya no está guardado.
    expect(
      (
        JSON.parse(
          window.localStorage.getItem(plantDraftKey('user_a')) ?? '',
        ) as { drafts: unknown[] }
      ).drafts,
    ).toHaveLength(1)
  })

  it(`guarda como mucho ${String(MAX_PLANT_DRAFTS)}: si llega otro (dos pestañas), se pierde el más antiguo`, () => {
    const drafts = Array.from({ length: MAX_PLANT_DRAFTS + 1 }, (_, i) => ({
      ...DRAFT,
      plantId: `plant-${String(i)}`,
      savedAt: NOW.getTime() + i,
    }))
    for (const draft of drafts) writePlantDraft('user_a', draft)
    expect(
      readPlantDrafts('user_a', later(1000)).map((draft) => draft.plantId),
    ).toEqual(
      drafts
        .slice(1)
        .reverse()
        .map((draft) => draft.plantId),
    )
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
