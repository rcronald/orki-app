import { describe, expect, it } from 'vitest'
import { DEFAULT_FILTERS } from '../collection/filters.ts'
import { readFilters, writeFilters } from './filter-params.ts'

const params = (search: string) => new URLSearchParams(search)

describe('readFilters', () => {
  it('sin parámetros, los filtros por defecto (solo activas)', () => {
    expect(readFilters(params(''))).toEqual(DEFAULT_FILTERS)
    expect(readFilters(params('q=phal'))).toEqual(DEFAULT_FILTERS)
  })

  it('lee estado, géneros, colores, orígenes y validaciones repetidos', () => {
    expect(
      readFilters(
        params(
          'estado=lost&genero=g1&genero=g2&color=white&color=pink&origen=Vivero%20Sol&origen=feria%2C%20lima&validacion=unidentifiable&validacion=pending',
        ),
      ),
    ).toEqual({
      status: 'lost',
      genera: ['g1', 'g2'],
      colors: ['white', 'pink'],
      origins: ['vivero sol', 'feria, lima'],
      validations: ['unidentifiable', 'pending'],
    })
  })

  it('ignora valores desconocidos, vacíos y repetidos', () => {
    expect(
      readFilters(
        params(
          'estado=borrada&genero=&genero=g1&genero=g1&color=verde&color=Blanco&color=white&color=white&origen=%20%20&origen=Sol&origen=sol&validacion=rechazada&validacion=pending&validacion=pending',
        ),
      ),
    ).toEqual({
      status: 'active',
      genera: ['g1'],
      colors: ['white'],
      origins: ['sol'],
      validations: ['pending'],
    })
  })
})

describe('writeFilters', () => {
  it('conserva la búsqueda y no escribe el estado por defecto', () => {
    expect(writeFilters(params('q=phal'), DEFAULT_FILTERS).toString()).toBe(
      'q=phal',
    )
  })

  it('sustituye los filtros anteriores', () => {
    const next = writeFilters(params('q=phal&genero=viejo&estado=lost'), {
      status: 'gifted',
      genera: ['g1'],
      colors: ['bicolor'],
      origins: ['vivero sol'],
      validations: ['unidentifiable', 'pending'],
    })
    expect(next.toString()).toBe(
      'q=phal&estado=gifted&genero=g1&color=bicolor&origen=vivero+sol&validacion=unidentifiable&validacion=pending',
    )
  })

  it('lo escrito se vuelve a leer igual', () => {
    const filters = {
      status: 'lost' as const,
      genera: ['g1', 'g2'],
      colors: ['white' as const],
      origins: ['feria, lima'],
      validations: ['unidentifiable' as const],
    }
    expect(readFilters(writeFilters(params(''), filters))).toEqual(filters)
  })
})
