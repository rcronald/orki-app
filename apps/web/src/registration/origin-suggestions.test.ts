import { describe, expect, it } from 'vitest'
import { plant } from '../test/collection.ts'
import {
  knownOrigins,
  ORIGIN_SUGGESTION_LIMIT,
  suggestOrigins,
} from './origin-suggestions.ts'

describe('sugerencias de origen', () => {
  it('agrupa sin mayúsculas, tildes ni espacios sobrantes y muestra la forma más reciente', () => {
    const origins = knownOrigins([
      plant({ origin: 'vivero sol', createdAt: '2026-10-01T10:00:00Z' }),
      plant({ origin: ' Vivéro  Sol ', createdAt: '2026-11-01T10:00:00Z' }),
      plant({ origin: null }),
    ])
    expect(origins).toEqual([
      { key: 'vivero sol', label: 'Vivéro Sol', count: 2 },
    ])
  })

  it('ordena por uso y, a igual uso, por el más reciente', () => {
    const origins = knownOrigins([
      plant({ origin: 'Feria', createdAt: '2026-11-20T10:00:00Z' }),
      plant({ origin: 'Vivero Sol', createdAt: '2026-01-01T10:00:00Z' }),
      plant({ origin: 'Vivero Sol', createdAt: '2026-01-02T10:00:00Z' }),
      plant({ origin: 'Intercambio', createdAt: '2026-11-21T10:00:00Z' }),
      // Las dadas de baja también cuentan.
      plant({ origin: 'Feria', status: 'gifted' }),
      plant({ origin: 'Feria', status: 'lost' }),
    ])
    expect(origins.map((origin) => origin.label)).toEqual([
      'Feria',
      'Vivero Sol',
      'Intercambio',
    ])
  })

  it('filtra por cada palabra, en cualquier orden, sin tildes ni mayúsculas', () => {
    const origins = knownOrigins([
      plant({ origin: 'Orquídeas del Valle' }),
      plant({ origin: 'Vivero Sol' }),
    ])
    expect(suggestOrigins(origins, 'VALLE orquideas')).toEqual([
      expect.objectContaining({ label: 'Orquídeas del Valle' }),
    ])
    expect(suggestOrigins(origins, '')).toEqual([])
    expect(suggestOrigins(origins, '   ')).toEqual([])
    expect(suggestOrigins(origins, 'feria')).toEqual([])
  })

  it('no repite el origen ya escrito tal cual, pero sí si cambia la forma', () => {
    const origins = knownOrigins([plant({ origin: 'Vivero Sol' })])
    expect(suggestOrigins(origins, 'Vivero Sol')).toEqual([])
    expect(suggestOrigins(origins, 'vivero sol')).toHaveLength(1)
  })

  it(`muestra como mucho ${String(ORIGIN_SUGGESTION_LIMIT)}`, () => {
    const origins = knownOrigins(
      Array.from({ length: 10 }, (_, index) =>
        plant({ origin: `Vivero ${String(index)}` }),
      ),
    )
    expect(suggestOrigins(origins, 'vivero')).toHaveLength(
      ORIGIN_SUGGESTION_LIMIT,
    )
  })
})
