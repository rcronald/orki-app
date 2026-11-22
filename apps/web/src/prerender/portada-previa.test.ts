import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ATRIBUTO_PORTADA_PREVIA,
  esperarFotoDePortadaPrevia,
  PORTADA_PREVIA_ID,
  quitarPortadaPrevia,
} from './portada-previa.ts'

// Portada prerrenderada (#204): cuándo la app deja de esperar a su foto y
// cómo se retira.

function portadaPrevia({ completa = false } = {}) {
  const contenedor = document.createElement('div')
  contenedor.id = PORTADA_PREVIA_ID
  // El logotipo va antes en el HTML: la que cuenta es la foto.
  contenedor.innerHTML =
    '<img class="orki-nav__logo" alt="orqui.app"><img class="orki-hero__photo" alt="Foto">'
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

describe('esperarFotoDePortadaPrevia', () => {
  it('sin portada prerrenderada se resuelve enseguida', async () => {
    await expect(esperarFotoDePortadaPrevia()).resolves.toBeUndefined()
  })

  it('espera a que la foto termine (aquí, sin conexión: falla) y a un fotograma', async () => {
    const foto = portadaPrevia()
    let resuelta = false
    const espera = esperarFotoDePortadaPrevia().then(() => {
      resuelta = true
    })
    await new Promise((r) => setTimeout(r, 30))
    expect(resuelta).toBe(false)

    foto.dispatchEvent(new Event('error'))
    await espera
    expect(resuelta).toBe(true)
  })

  it('con la foto ya descargada, la espera tras decodificarla', async () => {
    const foto = portadaPrevia({ completa: true })
    const decode = vi.fn(() => Promise.resolve())
    Object.defineProperty(foto, 'decode', { value: decode })
    await esperarFotoDePortadaPrevia()
    expect(decode).toHaveBeenCalledOnce()
  })

  it('si la foto no termina, deja de esperar a los 2 s', async () => {
    vi.useFakeTimers()
    portadaPrevia()
    let resuelta = false
    void esperarFotoDePortadaPrevia().then(() => {
      resuelta = true
    })
    await vi.advanceTimersByTimeAsync(1999)
    expect(resuelta).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(resuelta).toBe(true)
  })
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
