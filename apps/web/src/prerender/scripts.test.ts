import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LAST_USER_KEY } from '../auth/offline-identity.ts'
import {
  ATRIBUTO_PORTADA_PREVIA,
  PLANTILLA_PORTADA_PREVIA_ID,
  PORTADA_PREVIA_ID,
} from './portada-previa.ts'
import { SCRIPT_DE_CUERPO, scriptDeCabecera } from './scripts.ts'

// Los scripts en línea de la portada prerrenderada (#204), ejecutados como
// los ejecutaría el navegador al leer index.html.

const FOTO = {
  srcset: '/assets/portada-648-a.avif 648w, /assets/portada-960-b.avif 960w',
  sizes: '(max-width: 720px) calc(100vw - 32px), 56vw',
}

function ejecutar(script: string) {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- es el script que el build escribe en index.html
  const ejecutable = new Function(script) as () => void
  ejecutable()
}

function precargas() {
  return document.head.querySelectorAll('link[rel="preload"][as="image"]')
}

function muestra() {
  return document.documentElement.hasAttribute(ATRIBUTO_PORTADA_PREVIA)
}

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  localStorage.clear()
})

afterEach(() => {
  document.documentElement.removeAttribute(ATRIBUTO_PORTADA_PREVIA)
  for (const enlace of precargas()) enlace.remove()
  document.body.innerHTML = ''
  window.history.replaceState(null, '', '/')
  vi.restoreAllMocks()
})

describe('script del <head>', () => {
  it('en `/` sin nadie recordado: muestra la portada y precarga la foto con prioridad alta', () => {
    ejecutar(scriptDeCabecera(FOTO))

    expect(muestra()).toBe(true)
    const [precarga, ...otras] = precargas()
    expect(otras).toHaveLength(0)
    expect(precarga).toHaveAttribute('imagesrcset', FOTO.srcset)
    expect(precarga).toHaveAttribute('imagesizes', FOTO.sizes)
    expect(precarga).toHaveAttribute('type', 'image/avif')
    expect(precarga).toHaveAttribute('fetchpriority', 'high')
  })

  it('con un usuario recordado en el dispositivo no hace nada: `/` lleva a la colección', () => {
    localStorage.setItem(LAST_USER_KEY, 'user_recordado')
    ejecutar(scriptDeCabecera(FOTO))
    expect(muestra()).toBe(false)
    expect(precargas()).toHaveLength(0)
  })

  it('un usuario recordado vacío cuenta como nadie, igual que offline-identity', () => {
    localStorage.setItem(LAST_USER_KEY, '')
    ejecutar(scriptDeCabecera(FOTO))
    expect(muestra()).toBe(true)
  })

  it('en cualquier otra ruta no hace nada ni descarga la foto', () => {
    window.history.replaceState(null, '', '/coleccion')
    ejecutar(scriptDeCabecera(FOTO))
    expect(muestra()).toBe(false)
    expect(precargas()).toHaveLength(0)
  })

  it('con el aviso de cuenta eliminada en el historial no hace nada: la app pinta la portada con su aviso', () => {
    window.history.replaceState(
      { usr: { accountDeleted: true }, key: 'a', idx: 0 },
      '',
      '/',
    )
    ejecutar(scriptDeCabecera(FOTO))
    expect(muestra()).toBe(false)
  })

  it('sin almacenamiento (modo privado) se trata como sin nadie recordado', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Bloqueado', 'SecurityError')
    })
    ejecutar(scriptDeCabecera(FOTO))
    expect(muestra()).toBe(true)
  })
})

describe('script tras #root', () => {
  function documentoDelBuild() {
    document.body.innerHTML = `<div id="root"></div><template id="${PLANTILLA_PORTADA_PREVIA_ID}"><h1>Portada</h1><img class="orki-hero__photo" alt="Foto"></template>`
  }

  it('si toca mostrarla, copia la plantilla a un contenedor justo antes de #root', () => {
    documentoDelBuild()
    document.documentElement.setAttribute(ATRIBUTO_PORTADA_PREVIA, '')
    ejecutar(SCRIPT_DE_CUERPO)

    const contenedor = document.getElementById(PORTADA_PREVIA_ID)
    expect(contenedor?.nextElementSibling?.id).toBe('root')
    expect(contenedor?.querySelector('h1')).toHaveTextContent('Portada')
    expect(document.getElementById('root')).toBeEmptyDOMElement()
    expect(document.getElementById(PLANTILLA_PORTADA_PREVIA_ID)).toBeNull()
  })

  it('si no toca, solo quita la plantilla', () => {
    documentoDelBuild()
    ejecutar(SCRIPT_DE_CUERPO)
    expect(document.getElementById(PORTADA_PREVIA_ID)).toBeNull()
    expect(document.getElementById(PLANTILLA_PORTADA_PREVIA_ID)).toBeNull()
    expect(document.querySelector('h1')).toBeNull()
  })
})
