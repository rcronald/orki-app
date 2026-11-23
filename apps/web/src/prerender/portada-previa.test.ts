import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ATRIBUTO_PORTADA_PREVIA,
  esperarFotoDePortadaPrevia,
  PORTADA_PREVIA_ID,
  ESPERA_CLIC_TARDIO_MS,
  quitarPortadaPrevia,
  seguirPulsacionesEnPortadaPrevia,
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

describe('una interacción en curso al retirar la portada prerrenderada', () => {
  const PIE =
    '<a href="/registro">Crear cuenta</a><footer><a href="/privacidad">Privacidad</a><a href="/creditos">Créditos</a></footer>'

  // La prerrenderada y, en #root, la de la app (como en la confirmación en
  // que AppRouter llama a quitarPortadaPrevia).
  function dosPortadas() {
    const previa = document.createElement('div')
    previa.id = PORTADA_PREVIA_ID
    previa.innerHTML = PIE
    const raiz = document.createElement('div')
    raiz.id = 'root'
    document.body.append(previa, raiz)
    seguirPulsacionesEnPortadaPrevia()
    raiz.innerHTML = PIE
    const deLaApp = raiz.querySelector<HTMLAnchorElement>(
      'a[href="/privacidad"]',
    )!
    const clics = vi.fn((evento: Event) => evento.preventDefault())
    deLaApp.addEventListener('click', clics)
    return {
      previo: previa.querySelector<HTMLAnchorElement>('a[href="/privacidad"]')!,
      deLaApp,
      clics,
    }
  }

  function puntero(tipo: string, destino: Element) {
    destino.dispatchEvent(
      new PointerEvent(tipo, {
        bubbles: true,
        isPrimary: true,
        pointerId: 1,
        button: 0,
      }),
    )
  }

  it('el foco pasa al mismo enlace de la portada de la app', () => {
    const { previo, deLaApp } = dosPortadas()
    previo.focus()
    quitarPortadaPrevia()
    expect(deLaApp).toHaveFocus()
  })

  it('pulsado en la prerrenderada y soltado en la de la app, la app da el clic', async () => {
    vi.useFakeTimers()
    const { previo, deLaApp, clics } = dosPortadas()
    puntero('pointerdown', previo)
    quitarPortadaPrevia()
    puntero('pointerup', deLaApp)
    expect(clics).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(0)
    expect(clics).toHaveBeenCalledOnce()
    // Un clic del navegador que llega tarde (el de un toque) no se repite.
    deLaApp.click()
    expect(clics).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(ESPERA_CLIC_TARDIO_MS)
    deLaApp.click()
    expect(clics).toHaveBeenCalledTimes(2)
  })

  it('si el navegador da el clic, la app no lo repite', async () => {
    vi.useFakeTimers()
    const { previo, deLaApp, clics } = dosPortadas()
    puntero('pointerdown', previo)
    quitarPortadaPrevia()
    puntero('pointerup', deLaApp)
    deLaApp.click()
    await vi.advanceTimersByTimeAsync(ESPERA_CLIC_TARDIO_MS)
    expect(clics).toHaveBeenCalledOnce()
  })

  it('soltado en otro sitio o cancelado, no hay clic', async () => {
    vi.useFakeTimers()
    const { previo, deLaApp, clics } = dosPortadas()
    puntero('pointerdown', previo)
    quitarPortadaPrevia()
    puntero('pointerup', document.body)
    puntero('pointerdown', deLaApp)
    puntero('pointerup', deLaApp)
    await vi.advanceTimersByTimeAsync(ESPERA_CLIC_TARDIO_MS)
    expect(clics).not.toHaveBeenCalled()
  })

  it('una pulsación que empieza en la de la app no se toca', async () => {
    vi.useFakeTimers()
    const { deLaApp, clics } = dosPortadas()
    quitarPortadaPrevia()
    puntero('pointerdown', deLaApp)
    puntero('pointerup', deLaApp)
    await vi.advanceTimersByTimeAsync(ESPERA_CLIC_TARDIO_MS)
    expect(clics).not.toHaveBeenCalled()
  })
})
