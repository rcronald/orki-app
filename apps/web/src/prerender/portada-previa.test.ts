import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ATRIBUTO_PORTADA_PREVIA,
  PORTADA_PREVIA_ID,
  quitarPortadaPrevia,
} from './portada-previa.ts'

// Portada prerrenderada (#204): cómo se retira.

function portadaPrevia({ completa = false } = {}) {
  const contenedor = document.createElement('div')
  contenedor.id = PORTADA_PREVIA_ID
  // El logotipo va antes en el HTML: la que cuenta es la foto.
  contenedor.innerHTML =
    '<img class="orki-nav__logo" alt="orqui.apps"><img class="orki-hero__photo" alt="Foto">'
  document.body.append(contenedor)
  document.documentElement.setAttribute(ATRIBUTO_PORTADA_PREVIA, '')
  const foto = contenedor.querySelector<HTMLImageElement>('.orki-hero__photo')!
  Object.defineProperty(foto, 'complete', { value: completa })
  return foto
}

afterEach(() => {
  document.body.innerHTML = ''
  document.documentElement.removeAttribute(ATRIBUTO_PORTADA_PREVIA)
  vi.useRealTimers()
})

describe('quitarPortadaPrevia', () => {
  it('quita el contenedor y la marca de <html>', () => {
    portadaPrevia()
    quitarPortadaPrevia()
    expect(document.getElementById(PORTADA_PREVIA_ID)).toBeNull()
    expect(document.documentElement).not.toHaveAttribute(
      ATRIBUTO_PORTADA_PREVIA,
    )
  })

  it('sin portada prerrenderada no hace nada', () => {
    expect(() => quitarPortadaPrevia()).not.toThrow()
  })
})
