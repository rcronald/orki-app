import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { PublicHome } from '../pages/PublicHome.tsx'
import { HERO_AVIF_SRCSET, HERO_SIZES } from '../pages/hero-photo-sources.ts'
import { PLANTILLA_PORTADA_PREVIA_ID } from './portada-previa.ts'
import { SCRIPT_DE_CUERPO, scriptDeCabecera } from './scripts.ts'

// Entrada del prerrenderizado de la portada (#204). No la importa la app: la
// ejecuta el plugin del build (prerender/portada-previa-plugin.ts) con el
// ejecutor de módulos de Vite. Las direcciones de los archivos salen como las
// del código fuente (/src/assets/...) y el plugin las cambia por las del
// build, con su hash.

export interface PortadaRenderizada {
  /** Script en línea para el principio del <head>. */
  cabecera: string
  /** Plantilla con PublicHome en `/` sin sesión y su script, tras #root. */
  cuerpo: string
}

export function renderizarPortada(): PortadaRenderizada {
  const html = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/']}>
      <PublicHome />
    </MemoryRouter>,
  )
  return {
    cabecera: scriptDeCabecera({ srcset: HERO_AVIF_SRCSET, sizes: HERO_SIZES }),
    cuerpo: `<template id="${PLANTILLA_PORTADA_PREVIA_ID}">${html}</template><script>${SCRIPT_DE_CUERPO}</script>`,
  }
}
