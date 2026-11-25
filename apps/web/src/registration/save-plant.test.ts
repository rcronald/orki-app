import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COLLECTION_PLANT_SELECT } from '../collection/model.ts'
import {
  initSupabase,
  SessionTokenError,
  setSessionTokenSource,
} from '../lib/supabase.ts'
import { plantRow } from '../test/collection.ts'
import { CONFIG } from '../test/supabase-plants.ts'
import {
  insertPlant,
  PLANT_INVALID_TEXT,
  PLANT_SAVE_ERROR_TEXT,
  PlantSaveError,
  plantSaveErrorFrom,
  toPlantSaveError,
  updatePlant,
} from './save-plant.ts'

describe('toPlantSaveError', () => {
  it('sin respuesta (estado 0) es sin conexión; 401, sesión terminada', () => {
    expect(
      toPlantSaveError({ message: 'TypeError: Failed to fetch' }, 0).reason,
    ).toBe('offline')
    expect(toPlantSaveError({ code: 'PGRST303' }, 401).reason).toBe(
      'session-ended',
    )
  })

  it('reconoce que faltó el token de sesión, como lo devuelve postgrest-js', () => {
    const error = {
      message: `SessionTokenError: ${new SessionTokenError('offline').message}`,
    }
    expect(toPlantSaveError(error, 0).reason).toBe('offline')
  })

  it.each([
    [
      '23514',
      'new row for relation "plants" violates check constraint "plants_entered_name_valid"',
      PLANT_INVALID_TEXT.name,
    ],
    [
      '23514',
      'new row for relation "plants" violates check constraint "plants_acquired_on_not_future"',
      PLANT_INVALID_TEXT.futureDate,
    ],
    [
      '23503',
      'insert or update on table "plants" violates foreign key constraint "plants_species_id_fkey"',
      PLANT_INVALID_TEXT.species,
    ],
    [
      '23503',
      'insert or update on table "plants" violates foreign key constraint "plants_genus_id_fkey"',
      PLANT_INVALID_TEXT.genus,
    ],
    ['22008', 'date/time field value out of range', PLANT_INVALID_TEXT.date],
    [
      '22P02',
      'invalid input value for enum plant_type',
      PLANT_SAVE_ERROR_TEXT.invalid,
    ],
  ])('traduce el rechazo %s de la base', (code, message, text) => {
    const error = toPlantSaveError({ code, message, details: null }, 400)
    expect(error.reason).toBe('invalid')
    expect(error.message).toBe(text)
  })

  it('un permiso denegado o un 500 son fallos del servidor', () => {
    expect(
      toPlantSaveError({ code: '42501', message: 'permission denied' }, 403)
        .reason,
    ).toBe('failed')
    expect(toPlantSaveError({ message: 'boom' }, 500).message).toBe(
      PLANT_SAVE_ERROR_TEXT.failed,
    )
  })
})

describe('plantSaveErrorFrom', () => {
  it('conserva un PlantSaveError y convierte lo demás en fallo', () => {
    const known = new PlantSaveError('offline')
    expect(plantSaveErrorFrom(known)).toBe(known)
    expect(plantSaveErrorFrom(new Error('x')).reason).toBe('failed')
  })
})

describe('insertPlant y updatePlant: la foto principal de plant_photos (#186)', () => {
  const PLANT = '00000000-0000-4000-8000-000000000001'
  const INSERT = {
    id: PLANT,
    entered_name: 'Phalaenopsis amabilis',
    genus_id: 'genus-phal',
    type: 'species',
    acquired_on: '2026-11-01',
  } as const
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    initSupabase(CONFIG)
    setSessionTokenSource(() => Promise.resolve('token_de_prueba'))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    setSessionTokenSource(null)
  })

  function reply(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  function sent(index: number) {
    const [input, init] = fetchMock.mock.calls[index] ?? []
    const url = new URL(input instanceof Request ? input.url : String(input))
    const body = typeof init?.body === 'string' ? init.body : '{}'
    return {
      url,
      method: init?.method ?? 'GET',
      body: JSON.parse(body) as Record<string, unknown>,
    }
  }

  function expectMainPhotoOnly(url: URL) {
    expect(url.searchParams.get('select')).toBe(
      COLLECTION_PLANT_SELECT.replaceAll(' ', ''),
    )
    expect(url.searchParams.get('plant_photos.order')).toBe('position.asc')
    expect(url.searchParams.get('plant_photos.limit')).toBe('1')
  }

  it('al registrar pide la principal embebida y no envía las columnas de foto', async () => {
    fetchMock.mockResolvedValue(
      reply(plantRow({ id: PLANT, plant_photos: [] }), 201),
    )
    const plant = await insertPlant(INSERT)
    expect(plant.photoPath).toBeNull()
    expect(plant.photoInBloom).toBe(false)
    const request = sent(0)
    expect(request.method).toBe('POST')
    expectMainPhotoOnly(request.url)
    for (const column of ['photo_path', 'thumbnail_path', 'photo_in_bloom']) {
      expect(request.body).not.toHaveProperty(column)
    }
  })

  it('al reintentar con el mismo id lee la planta guardada con su principal', async () => {
    fetchMock
      .mockResolvedValueOnce(
        reply(
          {
            code: '23505',
            message:
              'duplicate key value violates unique constraint "plants_pkey"',
          },
          409,
        ),
      )
      .mockResolvedValueOnce(reply(plantRow({ id: PLANT })))
    const plant = await insertPlant(INSERT)
    expect(plant.photoPath).toBe('user_prueba/planta-1.webp')
    expect(plant.photoInBloom).toBe(true)
    const read = sent(1)
    expect(read.method).toBe('GET')
    expectMainPhotoOnly(read.url)
  })

  it('al editar pide la principal embebida en la respuesta', async () => {
    fetchMock.mockResolvedValue(reply(plantRow({ id: PLANT })))
    const plant = await updatePlant(PLANT, 'user_prueba', {
      nickname: 'La blanca',
    })
    expect(plant.thumbnailPath).toBe('user_prueba/planta-1-mini.webp')
    const request = sent(0)
    expect(request.method).toBe('PATCH')
    expectMainPhotoOnly(request.url)
    expect(request.body).toEqual({ nickname: 'La blanca' })
  })
})
