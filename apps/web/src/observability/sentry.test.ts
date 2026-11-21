import { afterEach, describe, expect, it, vi } from 'vitest'
import { SentryTestError, throwTestError } from './sentry.ts'

afterEach(() => {
  vi.useRealTimers()
})

describe('throwTestError', () => {
  it('lanza el error de prueba fuera de la llamada, en un setTimeout', () => {
    vi.useFakeTimers()

    expect(() => {
      throwTestError()
    }).not.toThrow()
    expect(() => vi.runAllTimers()).toThrow(SentryTestError)
  })
})
