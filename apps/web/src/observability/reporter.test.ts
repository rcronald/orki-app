import { describe, expect, it, vi } from 'vitest'
import {
  createErrorReporter,
  errorReporter,
  PENDING_LIMIT,
  readRelease,
} from './reporter.ts'
import type { SentryHandle, SentryModule, SentrySettings } from './types.ts'

const SETTINGS: SentrySettings = {
  dsn: 'https://clave@o1.ingest.sentry.io/2',
  environment: 'dev',
  release: 'abc1234',
}

function setup({ failLoad = false } = {}) {
  const handle = {
    captureException: vi.fn<SentryHandle['captureException']>(),
    setUserId: vi.fn<SentryHandle['setUserId']>(),
  }
  const startSentry = vi.fn<SentryModule['startSentry']>(() => handle)
  const loadSdk = vi.fn(() =>
    failLoad
      ? Promise.reject(new Error('sin red'))
      : Promise.resolve({ startSentry }),
  )
  let scheduled: (() => void) | undefined
  const target = new EventTarget()
  const reporter = createErrorReporter({
    loadSdk,
    schedule: (task) => {
      scheduled = task
    },
    target,
  })
  const runScheduled = async () => {
    scheduled?.()
    // Deja que se resuelva el import simulado.
    await vi.waitFor(() => {
      expect(loadSdk).toHaveBeenCalled()
    })
    await Promise.resolve()
    await Promise.resolve()
  }
  const fireError = (error: unknown) => {
    const event = new Event('error') as Event & { error: unknown }
    event.error = error
    target.dispatchEvent(event)
  }
  const fireRejection = (reason: unknown) => {
    const event = new Event('unhandledrejection') as Event & {
      reason: unknown
    }
    event.reason = reason
    target.dispatchEvent(event)
  }
  return {
    reporter,
    handle,
    startSentry,
    loadSdk,
    runScheduled,
    fireError,
    fireRejection,
    isScheduled: () => scheduled !== undefined,
  }
}

describe('createErrorReporter', () => {
  it('no descarga nada hasta el momento programado', () => {
    const { reporter, loadSdk, isScheduled } = setup()

    reporter.start(SETTINGS)

    expect(isScheduled()).toBe(true)
    expect(loadSdk).not.toHaveBeenCalled()
  })

  it('envía después los errores ocurridos antes de cargar el SDK', async () => {
    const { reporter, handle, startSentry, runScheduled, fireError } = setup()
    const early = new Error('antes de cargar')
    const caught = new Error('del límite de errores')

    reporter.start(SETTINGS)
    fireError(early)
    reporter.report(caught, { componentStack: '\n    at Rota' })
    await runScheduled()

    expect(startSentry).toHaveBeenCalledWith(SETTINGS, null)
    expect(handle.captureException.mock.calls).toEqual([
      [early, undefined],
      [caught, { componentStack: '\n    at Rota' }],
    ])
  })

  it('guarda también las promesas rechazadas sin capturar', async () => {
    const { reporter, handle, runScheduled, fireRejection } = setup()

    reporter.start(SETTINGS)
    fireRejection('motivo')
    await runScheduled()

    expect(handle.captureException).toHaveBeenCalledWith('motivo', undefined)
  })

  it(`guarda como mucho ${PENDING_LIMIT} errores`, async () => {
    const { reporter, handle, runScheduled, fireError } = setup()

    reporter.start(SETTINGS)
    for (let i = 0; i < PENDING_LIMIT + 5; i++) fireError(new Error(`${i}`))
    await runScheduled()

    expect(handle.captureException).toHaveBeenCalledTimes(PENDING_LIMIT)
  })

  it('con el SDK cargado, deja de escuchar y reporta directamente', async () => {
    const { reporter, handle, runScheduled, fireError } = setup()

    reporter.start(SETTINGS)
    await runScheduled()
    fireError(new Error('ya lo escucha el SDK'))
    const later = new Error('después')
    reporter.report(later)

    expect(handle.captureException.mock.calls).toEqual([[later, undefined]])
  })

  it('pasa el id del usuario al iniciar y cuando cambia', async () => {
    const { reporter, handle, startSentry, runScheduled } = setup()

    reporter.start(SETTINGS)
    reporter.setUserId('user_2abc')
    await runScheduled()
    reporter.setUserId(null)

    expect(startSentry).toHaveBeenCalledWith(SETTINGS, 'user_2abc')
    expect(handle.setUserId).toHaveBeenCalledWith(null)
  })

  it('si el SDK no carga, olvida los errores y la app sigue', async () => {
    const { reporter, handle, runScheduled, fireError } = setup({
      failLoad: true,
    })

    reporter.start(SETTINGS)
    fireError(new Error('x'))
    await runScheduled()

    expect(() => {
      reporter.report(new Error('y'))
    }).not.toThrow()
    expect(handle.captureException).not.toHaveBeenCalled()
  })

  it('solo arranca una vez', () => {
    const { reporter, loadSdk, runScheduled } = setup()

    reporter.start(SETTINGS)
    reporter.start(SETTINGS)
    void runScheduled()

    expect(loadSdk).toHaveBeenCalledTimes(1)
  })

  it('sin SDK en el build, no escucha ni programa nada', () => {
    const schedule = vi.fn()
    const target = { addEventListener: vi.fn(), removeEventListener: vi.fn() }
    const reporter = createErrorReporter({ loadSdk: null, schedule, target })

    reporter.start(SETTINGS)
    reporter.report(new Error('x'))

    expect(schedule).not.toHaveBeenCalled()
    expect(target.addEventListener).not.toHaveBeenCalled()
  })
})

describe('errorReporter de la app', () => {
  it('sin VITE_SENTRY_DSN en el build, no programa la carga', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame')

    errorReporter.start(SETTINGS)

    expect(raf).not.toHaveBeenCalled()
    raf.mockRestore()
  })
})

describe('readRelease', () => {
  it('lee la versión de la etiqueta meta', () => {
    const doc = new DOMParser().parseFromString(
      '<head><meta name="orki-release" content="abc1234"></head>',
      'text/html',
    )
    expect(readRelease(doc)).toBe('abc1234')
  })

  it('sin etiqueta, no hay versión', () => {
    expect(readRelease(new DOMParser().parseFromString('', 'text/html'))).toBe(
      undefined,
    )
  })
})
