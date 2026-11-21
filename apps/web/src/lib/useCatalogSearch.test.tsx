import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CATALOG_SEARCH_ERROR_TEXT,
  CatalogSearchError,
  type CatalogSearchOptions,
} from './catalogSearch.ts'
import { SEARCH_DEBOUNCE_MS, useCatalogSearch } from './useCatalogSearch.ts'

// El hook se prueba con una función de búsqueda simulada: cada llamada queda
// pendiente hasta que la prueba la resuelve o la rechaza, así se controla el
// orden en que llegan las respuestas.

interface PendingCall {
  query: string
  options: CatalogSearchOptions | undefined
  resolve: (results: string[]) => void
  reject: (error: unknown) => void
}

let calls: PendingCall[] = []

const search = vi.fn(
  (query: string, options?: CatalogSearchOptions) =>
    new Promise<string[]>((resolve, reject) => {
      calls.push({ query, options, resolve, reject })
    }),
)

function render(initialQuery: string, enabled = true) {
  return renderHook(
    ({ query, on }: { query: string; on: boolean }) =>
      useCatalogSearch(search, query, { enabled: on, maxResults: 5 }),
    { initialProps: { query: initialQuery, on: enabled } },
  )
}

async function waitDebounce() {
  await act(() => vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS))
}

async function respond(call: PendingCall | undefined, results: string[]) {
  await act(async () => {
    call?.resolve(results)
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  calls = []
  search.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useCatalogSearch', () => {
  it('con menos de 2 caracteres está inactivo y no busca', async () => {
    const { result, rerender } = render('')
    expect(result.current).toEqual({ status: 'idle', results: [], error: null })

    rerender({ query: ' p ', on: true })
    await waitDebounce()
    expect(result.current.status).toBe('idle')
    expect(search).not.toHaveBeenCalled()
  })

  it('desactivado no busca aunque haya texto', async () => {
    const { result } = render('phal', false)
    await waitDebounce()

    expect(result.current.status).toBe('idle')
    expect(search).not.toHaveBeenCalled()
  })

  it('espera a que se deje de escribir y hace una sola petición', async () => {
    const { result, rerender } = render('ph')
    expect(result.current.status).toBe('loading')

    await act(() => vi.advanceTimersByTimeAsync(100))
    rerender({ query: 'pha', on: true })
    await act(() => vi.advanceTimersByTimeAsync(100))
    rerender({ query: 'phal ', on: true })
    await act(() => vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 1))
    expect(search).not.toHaveBeenCalled()

    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(search).toHaveBeenCalledOnce()
    expect(calls[0]?.query).toBe('phal')
    expect(calls[0]?.options?.maxResults).toBe(5)
    expect(calls[0]?.options?.signal).toBeInstanceOf(AbortSignal)
  })

  it('la espera es configurable', async () => {
    renderHook(() => useCatalogSearch(search, 'phal', { debounceMs: 600 }))
    await act(() => vi.advanceTimersByTimeAsync(599))
    expect(search).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(search).toHaveBeenCalledOnce()
  })

  it('pasa de cargando a resultados', async () => {
    const { result } = render('phal')
    await waitDebounce()
    expect(result.current.status).toBe('loading')
    expect(result.current.results).toEqual([])

    await respond(calls[0], ['Phalaenopsis amabilis'])
    expect(result.current).toEqual({
      status: 'success',
      results: ['Phalaenopsis amabilis'],
      error: null,
    })
  })

  it('sin coincidencias, el estado es vacío', async () => {
    const { result } = render('stanhopea')
    await waitDebounce()
    await respond(calls[0], [])

    expect(result.current.status).toBe('empty')
  })

  it('una respuesta tardía de una consulta anterior no pisa la nueva', async () => {
    const { result, rerender } = render('phal')
    await waitDebounce()
    const old = calls[0]

    rerender({ query: 'catt', on: true })
    // La petición anterior se cancela al cambiar la consulta.
    expect(old?.options?.signal?.aborted).toBe(true)
    await waitDebounce()
    const current = calls[1]
    expect(current?.query).toBe('catt')

    // Llega la respuesta de "phal" aunque se canceló: no se muestra.
    await respond(old, ['Phalaenopsis amabilis'])
    expect(result.current.status).toBe('loading')
    expect(result.current.results).toEqual([])

    await respond(current, ['Cattleya maxima'])
    expect(result.current.results).toEqual(['Cattleya maxima'])
  })

  it('ni siquiera si la respuesta anterior llega después de la nueva', async () => {
    const { result, rerender } = render('phal')
    await waitDebounce()
    const old = calls[0]
    rerender({ query: 'catt', on: true })
    await waitDebounce()

    await respond(calls[1], ['Cattleya maxima'])
    await respond(old, ['Phalaenopsis amabilis'])
    expect(result.current).toEqual({
      status: 'success',
      results: ['Cattleya maxima'],
      error: null,
    })
  })

  it('al escribir de nuevo no se ven los resultados anteriores mientras carga', async () => {
    const { result, rerender } = render('phal')
    await waitDebounce()
    await respond(calls[0], ['Phalaenopsis amabilis'])
    expect(result.current.status).toBe('success')

    rerender({ query: 'phal x', on: true })
    expect(result.current.status).toBe('loading')
    expect(result.current.results).toEqual([])
  })

  it('al desmontar cancela la espera y la petición en curso', async () => {
    const { unmount, rerender } = render('phal')
    await waitDebounce()
    const inFlight = calls[0]

    rerender({ query: 'catt', on: true })
    unmount()
    expect(inFlight?.options?.signal?.aborted).toBe(true)

    // La espera de "catt" ya no dispara ninguna petición.
    await act(() => vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS * 2))
    expect(search).toHaveBeenCalledOnce()
  })

  it('un fallo del servidor o de la red da el estado de error con su mensaje', async () => {
    const { result } = render('phal')
    await waitDebounce()
    await act(async () => {
      calls[0]?.reject(new CatalogSearchError('failed'))
      await Promise.resolve()
    })

    expect(result.current).toEqual({
      status: 'error',
      results: [],
      error: { reason: 'failed', message: CATALOG_SEARCH_ERROR_TEXT.failed },
    })
  })

  it('sin conexión, el mensaje es distinto', async () => {
    const { result } = render('phal')
    await waitDebounce()
    await act(async () => {
      calls[0]?.reject(new CatalogSearchError('offline'))
      await Promise.resolve()
    })

    expect(result.current.status).toBe('error')
    expect(result.current.error).toEqual({
      reason: 'offline',
      message: CATALOG_SEARCH_ERROR_TEXT.offline,
    })
    expect(CATALOG_SEARCH_ERROR_TEXT.offline).not.toBe(
      CATALOG_SEARCH_ERROR_TEXT.failed,
    )
  })

  it('un error inesperado cuenta como fallo', async () => {
    const { result } = render('phal')
    await waitDebounce()
    await act(async () => {
      calls[0]?.reject(new Error('inesperado'))
      await Promise.resolve()
    })

    expect(result.current.error?.reason).toBe('failed')
  })

  it('tras un error, escribir de nuevo vuelve a buscar', async () => {
    const { result, rerender } = render('phal')
    await waitDebounce()
    await act(async () => {
      calls[0]?.reject(new CatalogSearchError('offline'))
      await Promise.resolve()
    })

    rerender({ query: 'phala', on: true })
    expect(result.current.status).toBe('loading')
    await waitDebounce()
    await respond(calls[1], ['Phalaenopsis amabilis'])
    expect(result.current.status).toBe('success')
  })
})
