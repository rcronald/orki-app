import { describe, expect, it } from 'vitest'
import { authPageFor, SIGN_IN_PATH, SIGN_UP_PATH } from './paths.ts'

describe('authPageFor', () => {
  it.each([
    [SIGN_IN_PATH, 'sign-in'],
    [`${SIGN_IN_PATH}/`, 'sign-in'],
    [SIGN_UP_PATH, 'sign-up'],
    [`${SIGN_UP_PATH}//`, 'sign-up'],
  ] as const)('%s es una pantalla de acceso', (pathname, page) => {
    expect(authPageFor(pathname)).toBe(page)
  })

  it.each(['/', '/muestra', '/iniciar-sesion/otra', '/registros'])(
    '%s no es una pantalla de acceso',
    (pathname) => {
      expect(authPageFor(pathname)).toBeNull()
    },
  )
})
