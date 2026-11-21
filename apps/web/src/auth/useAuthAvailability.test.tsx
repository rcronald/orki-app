import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFakeClerk, setFakeClerk } from '../test/clerk-mock.tsx'
import {
  AUTH_LOAD_TIMEOUT_MS,
  useAuthAvailability,
} from './useAuthAvailability.ts'

vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))

function setOnline(online: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online)
}

beforeEach(() => {
  resetFakeClerk()
  setOnline(true)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useAuthAvailability', () => {
  it.each([
    ['ready', 'ready'],
    ['degraded', 'ready'],
    ['loading', 'loading'],
    ['error', 'failed'],
  ] as const)('con Clerk en %s devuelve %s', (status, expected) => {
    setFakeClerk({ status })

    const { result } = renderHook(() => useAuthAvailability())

    expect(result.current).toBe(expected)
  })

  it('deja de esperar a Clerk al agotar el tiempo', () => {
    vi.useFakeTimers()
    setFakeClerk({ status: 'loading' })
    const { result } = renderHook(() => useAuthAvailability())

    act(() => {
      vi.advanceTimersByTime(AUTH_LOAD_TIMEOUT_MS - 1)
    })
    expect(result.current).toBe('loading')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe('failed')
  })

  it('pasa a ready si Clerk carga después del límite', () => {
    vi.useFakeTimers()
    setFakeClerk({ status: 'loading' })
    const { result, rerender } = renderHook(() => useAuthAvailability())
    act(() => {
      vi.advanceTimersByTime(AUTH_LOAD_TIMEOUT_MS)
    })
    expect(result.current).toBe('failed')

    setFakeClerk({ status: 'ready' })
    rerender()

    expect(result.current).toBe('ready')
  })

  it('sin conexión no espera al límite de tiempo', () => {
    setOnline(false)
    setFakeClerk({ status: 'loading' })

    const { result } = renderHook(() => useAuthAvailability())

    expect(result.current).toBe('offline')
  })

  it('sigue los eventos de conexión del navegador', () => {
    setFakeClerk({ status: 'loading' })
    const { result } = renderHook(() => useAuthAvailability())
    expect(result.current).toBe('loading')

    setOnline(false)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(result.current).toBe('offline')

    setOnline(true)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(result.current).toBe('loading')
  })

  it('con Clerk ya cargado, perder la conexión no cambia nada', () => {
    const { result } = renderHook(() => useAuthAvailability())

    setOnline(false)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })

    expect(result.current).toBe('ready')
  })
})
