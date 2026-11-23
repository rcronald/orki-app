import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { ADMIN, ESPECIES, GENEROS, PLANTAS, USUARIO } from './soporte/datos.ts'
import { expect, test } from './soporte/fixtures.ts'
import type { SupabaseSimulado } from './soporte/supabase-simulado.ts'

// Objetivos táctiles de 44 × 44 px (#174). Recorre las pantallas principales a
// 360 px, con sesión y sin ella, mide el área pulsable de cada control visible
// (enlaces, botones, campos, casillas, pestañas, chips) y falla si alguno
// mide menos de 44 px de alto o de ancho y no está en EXCEPCIONES. Las
// excepciones y su motivo están también en docs/piezas-de-interfaz.md
// («Objetivos táctiles»).
//
// Área pulsable:
// - la caja del control;
// - en una casilla o un botón de opción, la de su etiqueta si es mayor (al
//   pulsar la etiqueta se marca la casilla);
// - en un enlace estirado (su ::after absoluto cubre la tarjeta, como
//   orki-card__link), la de la tarjeta;
// - una etiqueta que hace de control porque su campo está oculto (el botón
//   de elegir fotos) se mide ella.
// No se miden los controles ocultos ni los de 1 px (sr-only, «Saltar al
// contenido» hasta que recibe el foco).

const MINIMO = 44

interface Control {
  tag: string
  nombre: string
  clase: string
  ancho: number
  alto: number
  /** Enlace dentro de un párrafo, una lista o un pie de foto con más texto. */
  enTexto: boolean
}

interface Excepcion {
  motivo: string
  coincide: (control: Control, pantalla: string) => boolean
}

/**
 * Controles que pueden medir menos de 44 px. Que la lista sea corta: un
 * control principal nuevo que no llegue a 44 px se arregla, no se añade aquí.
 */
const EXCEPCIONES: Excepcion[] = [
  {
    // WCAG 2.5.8 exime los objetivos dentro de una frase: su tamaño lo marca
    // el texto. Licencias, DOI y fuentes del catálogo y de las fotos,
    // créditos, privacidad y el pie del backoffice.
    motivo: 'enlace dentro de un texto',
    coincide: (c) => c.tag === 'a' && c.enTexto,
  },
  {
    // Herramienta interna de escritorio: el nombre es un enlace del texto de
    // la celda (21 px de alto en una fila de 45) y la fila entera no es
    // pulsable. Cumple AA (2.5.8, 24 px por el espaciado). La casilla de la
    // misma fila sí mide 48 × 44.
    motivo: 'nombre de especie en la tabla del backoffice',
    coincide: (c, pantalla) =>
      pantalla.startsWith('backoffice') &&
      c.tag === 'a' &&
      c.clase.includes('scientific-name'),
  },
]

/** Los controles visibles de la página, con su área pulsable. */
function controlesVisibles(page: Page): Promise<Control[]> {
  return page.evaluate(() => {
    const SELECTOR = [
      'a[href]',
      'button',
      'input:not([type=hidden])',
      'select',
      'textarea',
      'summary',
      '[role=button]',
      '[role=tab]',
      '[role=link]',
      '[role=menuitem]',
      '[role=checkbox]',
      '[role=radio]',
      '[role=switch]',
      'label',
    ].join(', ')
    const caja = (el: Element) => el.getBoundingClientRect()
    const area = (r: DOMRect) => r.width * r.height
    const controles: Control[] = []
    for (const el of document.querySelectorAll(SELECTOR)) {
      const html = el as HTMLElement
      const campo = el.querySelector('input')
      // Una etiqueta solo cuenta si hace de control (su campo no se ve).
      if (el.tagName === 'LABEL') {
        if (!campo) continue
        const r = caja(campo)
        if (r.width > 2 && r.height > 2) continue
      }
      if (el.closest('[inert], [aria-hidden=true]')) continue
      if (!html.checkVisibility({ checkVisibilityCSS: true })) continue
      let r = caja(el)
      if (r.width <= 2 || r.height <= 2) continue
      if (
        el instanceof HTMLInputElement &&
        (el.type === 'checkbox' || el.type === 'radio')
      ) {
        const etiqueta = el.closest('label') ?? el.labels?.[0]
        if (etiqueta && area(caja(etiqueta)) > area(r)) r = caja(etiqueta)
      }
      const despues = getComputedStyle(el, '::after')
      if (
        despues.position === 'absolute' &&
        despues.content !== 'none' &&
        html.offsetParent
      ) {
        const tarjeta = caja(html.offsetParent)
        if (area(tarjeta) > area(r)) r = tarjeta
      }
      let enTexto = false
      if (el.tagName === 'A') {
        const bloque = el.closest('p, li, dd, figcaption, small')
        enTexto =
          bloque !== null &&
          (bloque.textContent ?? '').trim().length >
            (el.textContent ?? '').trim().length + 5
      }
      const nombre =
        el.getAttribute('aria-label') ??
        (el instanceof HTMLInputElement ? el.labels?.[0]?.textContent : null) ??
        [
          html.innerText,
          ...[...el.querySelectorAll('img[alt]')].map(
            (img) => (img as HTMLImageElement).alt,
          ),
        ].join(' ')
      controles.push({
        tag: el.tagName.toLowerCase(),
        nombre: (nombre || '(sin nombre)').replace(/\s+/g, ' ').trim(),
        clase: el.getAttribute('class') ?? '',
        // Redondeado: Firefox mide 43,99994 px en un control de 44 px.
        ancho: Math.round(r.width),
        alto: Math.round(r.height),
        enTexto,
      })
    }
    return controles
  })
}

/** Mide la pantalla y falla con la lista de los controles pequeños. */
async function medir(page: Page, pantalla: string) {
  await test.step(`Objetivos de 44 px: ${pantalla}`, async () => {
    const controles = await controlesVisibles(page)
    expect(controles.length, `sin controles en «${pantalla}»`).toBeGreaterThan(
      0,
    )
    const pequenos = controles
      .filter((c) => c.ancho < MINIMO || c.alto < MINIMO)
      .filter((c) => !EXCEPCIONES.some((e) => e.coincide(c, pantalla)))
      .map((c) => `${c.tag} «${c.nombre}»: ${c.ancho} × ${c.alto} px`)
    expect(pequenos, `Controles de menos de 44 px en «${pantalla}»`).toEqual([])
  })
}

/** Abre la ruta y mide cuando `listo` se ve. */
async function abrirYMedir(
  page: Page,
  pantalla: string,
  ruta: string,
  listo: (page: Page) => Locator,
) {
  await page.goto(ruta)
  await expect(listo(page)).toBeVisible()
  await medir(page, pantalla)
}

const titulo = (nombre: string | RegExp) => (page: Page) =>
  page.getByRole('heading', { name: nombre, level: 1 })

test.use({ viewport: { width: 360, height: 780 } })

// Las barras, también a 390 px y en escritorio: la de la app (logotipo,
// pestañas y «Tu cuenta») y la pública (en escritorio, «Catálogo» y los
// botones de acceso; hasta 720 px solo el logotipo).
const ANCHOS_DE_LAS_BARRAS = [360, 390, 1440]

/** Cada control visible de la barra mide al menos 44 × 44 px. */
async function barraDe44(page: Page, cuantos: number) {
  const controles = page
    .getByRole('banner')
    .locator('a:visible, button:visible')
  await expect(controles).toHaveCount(cuantos)
  for (const control of await controles.all()) {
    const caja = await control.boundingBox()
    const nombre =
      (await control.getAttribute('aria-label')) ??
      (await control.textContent()) ??
      ''
    expect(Math.round(caja?.width ?? 0), nombre).toBeGreaterThanOrEqual(MINIMO)
    expect(Math.round(caja?.height ?? 0), nombre).toBeGreaterThanOrEqual(MINIMO)
  }
}

for (const ancho of ANCHOS_DE_LAS_BARRAS) {
  test(
    `a ${String(ancho)} px, la barra de la app: logotipo, pestañas y cuenta`,
    { tag: ancho > 720 ? '@escritorio' : [] },
    async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: 800 })
      await page.goto('/coleccion')
      await expect(titulo('Mi colección')(page)).toBeVisible()
      // Logotipo, «Mi colección», «Catálogo» y «Tu cuenta».
      await barraDe44(page, 4)
    },
  )
}

test.describe('sin sesión', () => {
  test.use({ sesion: { usuario: null } })

  for (const ancho of ANCHOS_DE_LAS_BARRAS) {
    test(
      `a ${String(ancho)} px, la barra pública`,
      { tag: ancho > 720 ? '@escritorio' : [] },
      async ({ page }) => {
        await page.setViewportSize({ width: ancho, height: 800 })
        await page.goto('/creditos')
        await expect(titulo('Créditos y fuentes')(page)).toBeVisible()
        // Hasta 720 px, solo el logotipo; en escritorio, además «Catálogo»,
        // «Iniciar sesión» y «Crear cuenta gratis».
        await barraDe44(page, ancho > 720 ? 4 : 1)
      },
    )
  }

  test('portada, catálogo, créditos, privacidad y acceso', async ({ page }) => {
    await abrirYMedir(
      page,
      'portada',
      '/',
      titulo('Tu colección de orquídeas, en un solo lugar'),
    )
    await abrirYMedir(page, 'catálogo', '/catalogo', (p) =>
      p.getByText('5 géneros · 6 especies'),
    )
    await abrirYMedir(page, 'catálogo por letra', '/catalogo?letra=p', (p) =>
      p.getByRole('link', { name: /Phalaenopsis/ }),
    )
    await abrirYMedir(
      page,
      'búsqueda en el catálogo',
      '/catalogo?q=cattleya',
      (p) => p.getByRole('link', { name: /Cattleya maxima/ }),
    )
    await abrirYMedir(
      page,
      'género',
      `/catalogo/genero/${GENEROS.phalaenopsis}`,
      (p) => p.getByText('1 especie · Página 1 de 1'),
    )
    await abrirYMedir(
      page,
      'ficha con foto de referencia',
      `/catalogo/especie/${ESPECIES.cattleyaMaxima}`,
      titulo('Cattleya maxima'),
    )
    await abrirYMedir(
      page,
      'créditos',
      '/creditos',
      titulo('Créditos y fuentes'),
    )
    await abrirYMedir(page, 'privacidad', '/privacidad', titulo('Privacidad'))
    await abrirYMedir(page, 'iniciar sesión', '/iniciar-sesion', (p) =>
      p.getByRole('button', { name: 'Entrar con la cuenta de prueba' }),
    )
    await abrirYMedir(page, 'crear la cuenta', '/registro', (p) =>
      p.getByRole('link', { name: 'Privacidad' }),
    )
  })
})

test.describe('con sesión', () => {
  test('Mi colección en cuadrícula y en lista, con los filtros abiertos', async ({
    page,
  }) => {
    await page.goto('/coleccion')
    await expect(page.getByRole('main').getByRole('article')).toHaveCount(5)
    await page.getByRole('button', { name: 'Filtros' }).click()
    await expect(
      page.getByRole('region', { name: 'Filtros de la colección' }),
    ).toBeVisible()
    await medir(page, 'Mi colección en cuadrícula')
    await page
      .getByRole('group', { name: 'Vista' })
      .getByRole('button', { name: 'Lista' })
      .click()
    await expect(
      page
        .getByRole('group', { name: 'Vista' })
        .getByRole('button', { name: 'Lista' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await medir(page, 'Mi colección en lista')
    await page.getByRole('button', { name: 'Tu cuenta' }).click()
    await expect(page.getByRole('menu', { name: 'Tu cuenta' })).toBeVisible()
    await medir(page, 'menú «Tu cuenta»')
  })

  test('registro, edición, «¿Ya la tengo?», ficha, cuenta y páginas de texto', async ({
    page,
  }) => {
    await abrirYMedir(
      page,
      'registro',
      '/coleccion/nueva',
      titulo('Registrar una orquídea'),
    )
    await abrirYMedir(
      page,
      'edición',
      `/coleccion/${PLANTAS.amabilis}/editar`,
      (p) => p.getByRole('textbox', { name: 'Apodo' }),
    )
    await abrirYMedir(
      page,
      '¿Ya la tengo?',
      '/ya-la-tengo?q=Phalaenopsis+amabilis',
      (p) => p.getByRole('link', { name: 'Ver en mi colección' }),
    )
    await abrirYMedir(
      page,
      'ficha con sesión',
      `/catalogo/especie/${ESPECIES.phalaenopsisAmabilis}`,
      (p) => p.getByRole('link', { name: 'Ver en mi colección' }),
    )
    await abrirYMedir(page, 'Tu cuenta', '/cuenta', titulo('Tu cuenta'))
    await abrirYMedir(
      page,
      'créditos con sesión',
      '/creditos',
      titulo('Créditos y fuentes'),
    )
    await abrirYMedir(
      page,
      'privacidad con sesión',
      '/privacidad',
      titulo('Privacidad'),
    )
  })

  test('detalle con galería y visor', async ({ page, supabase }) => {
    conFotos(supabase, PLANTAS.maxima, 4)
    await page.goto(`/coleccion/${PLANTAS.maxima}`)
    const galeria = page.getByRole('region', { name: 'Fotos' })
    await expect(
      galeria
        .getByRole('list', { name: 'Elegir la foto que se ve' })
        .locator('li'),
    ).toHaveCount(4)
    await medir(page, 'detalle')
    // La ficha (#265): el orden de las fotos, las notas en edición y
    // «Gestionar planta» abierto.
    await galeria.getByRole('button', { name: 'Ordenar fotos' }).click()
    await page.getByRole('button', { name: 'Añadir notas' }).click()
    await page.getByRole('button', { name: 'Gestionar planta' }).click()
    await expect(
      page.getByRole('button', { name: 'Eliminar planta' }),
    ).toBeVisible()
    await medir(page, 'ficha: orden, notas y gestionar planta')
    await galeria.getByRole('button', { name: /^Ver en grande: / }).click()
    const visor = page.getByRole('dialog', { name: 'Fotos de Cattleya maxima' })
    await expect(visor.getByText('Foto 1 de 4')).toBeVisible()
    await medir(page, 'visor')
  })
})

test.describe('backoffice', () => {
  test.use({ sesion: { usuario: ADMIN, rol: 'catalog_admin' } })

  test('especies, detalle y propuestas', async ({ page }) => {
    await page.goto('/administracion/catalogo')
    await expect(page.getByRole('rowheader')).toHaveCount(6)
    await medir(page, 'backoffice: especies')

    // La casilla sigue de 24 px; lo que mide 44 es su etiqueta, y al
    // pulsarla (fuera de la casilla) la marca.
    const casilla = page.getByRole('checkbox', {
      name: 'Seleccionar Cattleya maxima',
    })
    const visible = await casilla.boundingBox()
    expect(Math.round(visible?.width ?? 0)).toBe(24)
    const etiqueta = page.locator('label', { has: casilla })
    const area = await etiqueta.boundingBox()
    expect(Math.round(area?.width ?? 0)).toBeGreaterThanOrEqual(MINIMO)
    expect(Math.round(area?.height ?? 0)).toBeGreaterThanOrEqual(MINIMO)
    await etiqueta.click({ position: { x: 2, y: 40 } })
    await expect(casilla).toBeChecked()

    await page.goto(
      `/administracion/catalogo?especie=${ESPECIES.cattleyaTrianae}`,
    )
    await expect(
      page.getByRole('region', { name: 'Detalle de Cattleya trianae' }),
    ).toBeVisible()
    await medir(page, 'backoffice: detalle de especie')

    await page.goto('/administracion/catalogo')
    await page.getByRole('tab', { name: /^Por validar/ }).click()
    await expect(page.getByText('2 grupos por validar')).toBeVisible()
    await medir(page, 'backoffice: propuestas')
  })
})

const FOTO = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../src/photos/fixtures/sin-metadatos.webp',
  ),
)

/** La planta con `cuantas` fotos, para que el detalle tenga galería. */
function conFotos(supabase: SupabaseSimulado, planta: string, cuantas: number) {
  const carpeta = `${USUARIO}/${planta}`
  for (let n = 1; n <= cuantas; n += 1) {
    const foto = `${carpeta}/photo-${String(n)}.webp`
    const miniatura = `${carpeta}/thumb-${String(n)}.webp`
    supabase.archivos.set(foto, { tipo: 'image/webp', bytes: FOTO })
    supabase.archivos.set(miniatura, { tipo: 'image/webp', bytes: FOTO })
    supabase.fotos.push({
      id: `aaaaaaaa-0000-4000-8000-00000000000${String(n)}`,
      plant_id: planta,
      user_id: USUARIO,
      photo_path: foto,
      thumbnail_path: miniatura,
      in_bloom: false,
      taken_at: null,
      note: null,
      position: n - 1,
      created_at: '2026-11-20T12:00:00.000Z',
    })
  }
  Object.assign(supabase.datos.plantas.find((p) => p.id === planta) ?? {}, {
    photo_path: `${carpeta}/photo-1.webp`,
    thumbnail_path: `${carpeta}/thumb-1.webp`,
  })
}
