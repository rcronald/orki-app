import { describe, expect, it } from 'vitest'
import { isShowcaseRoute, SHOWCASE_PATH } from './route.ts'

describe('isShowcaseRoute', () => {
  it('abre la muestra en su ruta fuera de producción', () => {
    expect(SHOWCASE_PATH).toBe('/muestra')
    expect(isShowcaseRoute('/muestra', 'dev')).toBe(true)
    expect(isShowcaseRoute('/muestra/', 'dev')).toBe(true)
  })

  it('nunca la abre en producción', () => {
    expect(isShowcaseRoute('/muestra', 'prod')).toBe(false)
    expect(isShowcaseRoute('/muestra/', 'prod')).toBe(false)
  })

  it('no la abre en otras rutas', () => {
    for (const pathname of ['/', '/muestras', '/muestra/otra', '/Muestra']) {
      expect(isShowcaseRoute(pathname, 'dev')).toBe(false)
    }
  })
})
