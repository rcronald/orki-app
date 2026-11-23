import { describe, expect, it } from 'vitest'
import {
  MAX_PLANT_NOTES_LENGTH,
  normalizePlantNotes,
  plantNotesLength,
} from './notes.ts'

describe('notas de la planta (#265)', () => {
  it('quita los espacios y saltos de los extremos y conserva los de dentro', () => {
    expect(normalizePlantNotes('  Llegó sin flor.\n\nRiego.  \n')).toBe(
      'Llegó sin flor.\n\nRiego.',
    )
  })

  it('vacío o solo espacios es «sin notas» (null), como pide la base', () => {
    expect(normalizePlantNotes('')).toBeNull()
    expect(normalizePlantNotes(' \n\t ')).toBeNull()
  })

  it('cuenta caracteres como la base, no unidades de UTF-16', () => {
    expect(plantNotesLength('  ñandú  ')).toBe(5)
    expect(plantNotesLength('🌸')).toBe(1)
    expect(MAX_PLANT_NOTES_LENGTH).toBe(2000)
  })
})
