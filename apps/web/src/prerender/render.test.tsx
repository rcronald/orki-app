import { describe, expect, it } from 'vitest'
import { HERO_AVIF_SRCSET, HERO_SIZES } from '../pages/hero-photo-sources.ts'
import { PLANTILLA_PORTADA_PREVIA_ID } from './portada-previa.ts'
import { renderizarPortada } from './render.tsx'
import { ATRIBUTO_SRC_DIFERIDO, ATRIBUTO_SRCSET_DIFERIDO } from './scripts.ts'

// Lo que el build mete en index.html (#204): la portada de `/` sin sesión,
// con los mismos textos, enlaces y foto que pinta la app.

/** El contenido de la plantilla, ya en el documento (como al copiarla). */
function plantilla(): HTMLElement {
  const contenedor = document.createElement('div')
  contenedor.innerHTML = renderizarPortada().cuerpo
  const elemento = contenedor.querySelector<HTMLTemplateElement>(
    `template#${PLANTILLA_PORTADA_PREVIA_ID}`,
  )
  if (elemento === null) throw new Error('Falta la plantilla')
  const portada = document.createElement('div')
  portada.append(document.importNode(elemento.content, true))
  return portada
}

describe('renderizarPortada', () => {
  it('la plantilla tiene la portada entera: cabecera, título, acciones, foto, ventajas y pie', () => {
    const portada = plantilla()
    expect(portada.querySelector('header.orki-nav')).not.toBeNull()
    expect(portada.querySelector('h1')).toHaveTextContent(
      'Tu colección de orquídeas, en un solo lugar',
    )
    expect(
      [...portada.querySelectorAll('.orki-hero__actions a')].map((a) => [
        a.textContent,
        a.getAttribute('href'),
      ]),
    ).toEqual([
      ['Crear cuenta gratis', '/registro'],
      ['Iniciar sesión', '/iniciar-sesion'],
    ])
    expect(portada.querySelectorAll('h2')).toHaveLength(3)
    expect(portada.querySelector('footer.orki-footer')).not.toBeNull()
  })

  it('la foto lleva las mismas fuentes que precarga el script del <head>', () => {
    const { cabecera } = renderizarPortada()
    const source = plantilla().querySelector('picture source')
    expect(source).toHaveAttribute(ATRIBUTO_SRCSET_DIFERIDO, HERO_AVIF_SRCSET)
    expect(source).toHaveAttribute('sizes', HERO_SIZES)
    expect(cabecera).toContain(JSON.stringify(HERO_AVIF_SRCSET))
    expect(cabecera).toContain(JSON.stringify(HERO_SIZES))
    expect(plantilla().querySelector('img.orki-hero__photo')).toHaveAttribute(
      'fetchpriority',
      'high',
    )
  })

  it('sin direcciones reales de archivos: ningún navegador puede pedir la foto por adelantado', () => {
    const { cuerpo } = renderizarPortada()
    expect(cuerpo).not.toMatch(/ src(set)?="(?!data:)/i)
    const foto = plantilla().querySelector('img.orki-hero__photo')
    expect(foto).not.toHaveAttribute('src')
    expect(foto).toHaveAttribute(ATRIBUTO_SRC_DIFERIDO)
    // El logotipo va en línea (data URL): no se descarga y se queda como está.
    expect(plantilla().querySelector('img.orki-nav__logo')).toHaveAttribute(
      'src',
      expect.stringMatching(/^data:image\/svg\+xml/),
    )
  })

  it('sin el aviso de cuenta eliminada', () => {
    expect(plantilla().querySelector('[role="status"]')).toBeNull()
  })
})
