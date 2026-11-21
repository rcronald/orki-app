import { describe, expect, it } from 'vitest'
import { SessionTokenError } from '../lib/supabase.ts'
import {
  PLANT_INVALID_TEXT,
  PLANT_SAVE_ERROR_TEXT,
  PlantSaveError,
  plantSaveErrorFrom,
  toPlantSaveError,
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

  it('reconoce que faltó el token de sesión, como lo devuelve supabase-js', () => {
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
