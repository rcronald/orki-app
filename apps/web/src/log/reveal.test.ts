import { afterEach, describe, expect, it, vi } from 'vitest'
import { revealInScroller } from './reveal.ts'

// Llevar el control con el foco a la vista del diálogo (#267), con cajas
// inventadas: jsdom no calcula el diseño.

function box(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 390,
    width: 390,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }
}

/** Un diálogo de 420 px que desplaza 1000 px de contenido, y un control. */
function setup(target: { top: number; height: number }, scrollTop = 0) {
  const scroller = document.createElement('div')
  const control = document.createElement('input')
  scroller.append(control)
  vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(box(0, 420))
  vi.spyOn(control, 'getBoundingClientRect').mockReturnValue(
    box(target.top, target.height),
  )
  Object.defineProperty(scroller, 'scrollHeight', { value: 1420 })
  Object.defineProperty(scroller, 'clientHeight', { value: 420 })
  scroller.scrollTop = scrollTop
  const scrollBy = vi.fn()
  scroller.scrollBy = scrollBy
  return { scroller, control, scrollBy }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('revealInScroller', () => {
  it('un control que asoma por abajo sube hasta verse entero, con margen', () => {
    // Como el título en WebKit a 390 × 400: 361 a 412, el 76 % visible.
    const { scroller, control, scrollBy } = setup({ top: 361, height: 51 })
    vi.stubGlobal('visualViewport', { offsetTop: 0, height: 400 })
    expect(revealInScroller(scroller, control)).toBe(20)
    expect(scrollBy).toHaveBeenCalledWith({ top: 20, behavior: 'instant' })
  })

  it('mide contra el área visible: el teclado encoge el viewport visual', () => {
    const { scroller, control } = setup({ top: 300, height: 50 })
    vi.stubGlobal('visualViewport', { offsetTop: 0, height: 320 })
    // 350 - (320 - 8)
    expect(revealInScroller(scroller, control)).toBe(38)
  })

  it('un control por encima baja hasta su borde de arriba', () => {
    const { scroller, control } = setup({ top: -60, height: 50 }, 500)
    expect(revealInScroller(scroller, control)).toBe(-68)
  })

  it('si es más alto que el hueco, muestra su parte de arriba', () => {
    const { scroller, control } = setup({ top: 200, height: 600 })
    expect(revealInScroller(scroller, control)).toBe(192)
  })

  it('si ya se ve entero, no se mueve', () => {
    const { scroller, control, scrollBy } = setup({ top: 100, height: 50 })
    expect(revealInScroller(scroller, control)).toBe(0)
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('no pasa del final del contenido', () => {
    const { scroller, control } = setup({ top: 500, height: 50 }, 990)
    expect(revealInScroller(scroller, control)).toBe(10)
  })
})
