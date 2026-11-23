import type { ErrorEvent } from '@sentry/react'
import { describe, expect, it } from 'vitest'
import { SessionTokenError } from '../lib/supabase.ts'
import {
  comesFromBrowserExtension,
  isNoise,
  isUpdateReload,
  isOfflineFailure,
} from './noise.ts'

function eventFrom(filename: string): ErrorEvent {
  return {
    type: undefined,
    exception: { values: [{ stacktrace: { frames: [{ filename }] } }] },
  }
}

describe('isOfflineFailure', () => {
  it.each([
    'Failed to fetch',
    'Failed to fetch (x.supabase.co)',
    'NetworkError when attempting to fetch resource.',
    'Load failed',
    'Failed to fetch dynamically imported module: https://orki.app/assets/App.js',
    'Importing a module script failed.',
  ])('sin conexión, "%s" es ruido', (message) => {
    expect(isOfflineFailure(new TypeError(message), false)).toBe(true)
  })

  it('con conexión, un fallo de red sí se envía', () => {
    expect(isOfflineFailure(new TypeError('Failed to fetch'), true)).toBe(false)
  })

  it('sin conexión, otro error sí se envía', () => {
    expect(isOfflineFailure(new TypeError('x is undefined'), false)).toBe(false)
  })

  it('los errores de la app con motivo offline son ruido', () => {
    expect(isOfflineFailure(new SessionTokenError('offline'), true)).toBe(true)
    expect(isOfflineFailure(new SessionTokenError('failed'), true)).toBe(false)
  })

  it('el error de Clerk sin conexión es ruido', () => {
    const error = new Error('Clerk sin red')
    error.name = 'ClerkOfflineError'
    expect(isOfflineFailure(error, true)).toBe(true)
  })

  it('acepta valores que no son errores', () => {
    expect(isOfflineFailure(undefined, false)).toBe(false)
    expect(isOfflineFailure('Failed to fetch', false)).toBe(true)
  })
})

describe('comesFromBrowserExtension', () => {
  it.each([
    'chrome-extension://abcdef/content.js',
    'moz-extension://1234/script.js',
    'safari-web-extension://1234/script.js',
  ])('%s es de una extensión', (filename) => {
    expect(comesFromBrowserExtension(eventFrom(filename))).toBe(true)
  })

  it('un script de la app no lo es', () => {
    expect(
      comesFromBrowserExtension(eventFrom('https://orki.app/assets/index.js')),
    ).toBe(false)
  })

  it('un evento sin trazas no lo es', () => {
    expect(comesFromBrowserExtension({ type: undefined })).toBe(false)
  })
})

describe('isNoise', () => {
  it('combina las dos reglas', () => {
    const appEvent = eventFrom('https://orki.app/assets/index.js')

    expect(isNoise(appEvent, new Error('fallo real'), true)).toBe(false)
    expect(isNoise(appEvent, new TypeError('Failed to fetch'), false)).toBe(
      true,
    )
    expect(
      isNoise(eventFrom('chrome-extension://x/a.js'), new Error('x'), true),
    ).toBe(true)
  })
})

describe('isUpdateReload', () => {
  const chunk = new TypeError(
    'Failed to fetch dynamically imported module: https://orqui.app/assets/CreditsPage-BJFUgrOu.js',
  )

  it('un chunk que no llegó mientras la página se recarga por una versión nueva es ruido', () => {
    expect(isUpdateReload(chunk, true)).toBe(true)
    expect(
      isNoise(
        eventFrom('https://orqui.app/assets/index.js'),
        chunk,
        true,
        true,
      ),
    ).toBe(true)
  })

  it('sin recarga en curso (fallo repetido), con conexión, sí se envía', () => {
    expect(isUpdateReload(chunk, false)).toBe(false)
    expect(
      isNoise(eventFrom('https://orqui.app/assets/index.js'), chunk, true),
    ).toBe(false)
  })

  it('otro error durante la recarga sí se envía', () => {
    expect(isUpdateReload(new Error('fallo real'), true)).toBe(false)
  })
})
