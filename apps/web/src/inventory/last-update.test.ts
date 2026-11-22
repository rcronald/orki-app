import { describe, expect, it } from 'vitest'
import { lastUpdateText } from './last-update.ts'

// Fechas locales: el texto se da en la hora del dispositivo.
const NOW = new Date(2026, 10, 21, 12, 0)

describe('lastUpdateText', () => {
  it('hoy: solo la hora', () => {
    const text = lastUpdateText(new Date(2026, 10, 21, 9, 5).toISOString(), NOW)
    expect(text).toMatch(/^Última actualización: hoy a las 9:05/)
  })

  it('otro día del año: día, mes y hora', () => {
    const text = lastUpdateText(
      new Date(2026, 10, 20, 18, 30).toISOString(),
      NOW,
    )
    expect(text).toContain('20 de noviembre')
    expect(text).toContain('18:30')
  })

  it('otro año: solo la fecha', () => {
    const text = lastUpdateText(new Date(2025, 0, 3, 8, 0).toISOString(), NOW)
    expect(text).toContain('3 de enero de 2025')
  })

  it('sin copia o con una fecha rota, lo dice', () => {
    expect(lastUpdateText(null, NOW)).toBe(
      'Aún no hay una copia guardada en este dispositivo.',
    )
    expect(lastUpdateText('no-es-fecha', NOW)).toBe(
      'Fecha de la copia desconocida.',
    )
  })
})
