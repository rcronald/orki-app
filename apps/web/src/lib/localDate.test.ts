import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isCalendarDate, localDateString } from './localDate.ts'

// Con una zona horaria con desfase respecto a UTC: Node aplica el cambio de
// process.env.TZ al momento (cada archivo de prueba va en su propio proceso).
const previousTz = process.env.TZ

beforeAll(() => {
  process.env.TZ = 'America/Lima'
})

afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ
  else process.env.TZ = previousTz
})

describe('localDateString', () => {
  it('da la fecha local, no la de UTC', () => {
    // 20:00 en Lima (UTC−5) es ya el día siguiente en UTC.
    const evening = new Date('2026-11-22T01:00:00Z')
    expect(evening.toISOString().slice(0, 10)).toBe('2026-11-22')
    expect(localDateString(evening)).toBe('2026-11-21')
  })

  it('también por delante de UTC', () => {
    process.env.TZ = 'Asia/Tokyo'
    try {
      // 05:00 del 22 en Tokio (UTC+9) es aún el 21 en UTC.
      const morning = new Date('2026-11-21T20:00:00Z')
      expect(localDateString(morning)).toBe('2026-11-22')
    } finally {
      process.env.TZ = 'America/Lima'
    }
  })

  it('rellena con ceros el mes y el día', () => {
    expect(localDateString(new Date(2026, 0, 5, 9, 30))).toBe('2026-01-05')
  })
})

describe('isCalendarDate', () => {
  it.each(['2026-11-21', '2024-02-29', '0001-01-01'])('acepta %s', (value) => {
    expect(isCalendarDate(value)).toBe(true)
  })

  it.each([
    '',
    '2026-02-30',
    '2025-02-29',
    '2026-13-01',
    '21/11/2026',
    '0000-01-01',
  ])('rechaza «%s»', (value) => {
    expect(isCalendarDate(value)).toBe(false)
  })
})
