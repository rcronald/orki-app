import type { Locator, Page } from '@playwright/test'
import { PLANTAS } from './soporte/datos.ts'
import { expect, test } from './soporte/fixtures.ts'

// El foco no queda tapado por las barras que se quedan fijas al desplazar la
// página (WCAG 2.4.11, #151): las acciones del formulario de registro y
// edición, fijas abajo. El inventario ya no tiene barras fijas (#208): el
// buscador va en su sitio y registrar, en la cabecera; aquí se comprueba que
// siga sin tenerlas y que el foco se vea al recorrerlo. axe no lo comprueba:
// hace falta llegar con el tabulador, que es cuando el navegador desplaza la
// página.
//
// Pantalla de celular en todos los perfiles. Safari y el WebKit de Playwright
// solo llevan el tabulador a los campos de formulario (no a enlaces ni a
// botones), así que las comprobaciones de enlaces y botones van solo en
// Chromium.

test.use({ viewport: { width: 390, height: 664 } })

/** Pulsa `tecla` hasta que el foco llega a `destino` (o falla). */
async function tabularHasta(page: Page, destino: Locator, tecla = 'Tab') {
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press(tecla)
    if (await destino.evaluate((el) => el === document.activeElement)) return
  }
  throw new Error('El tabulador no llegó al destino')
}

/** El elemento con el foco no se solapa con la barra. */
async function noLoTapa(page: Page, barra: Locator) {
  const caja = await barra.boundingBox()
  const foco = await page.evaluate(() => {
    const r = document.activeElement?.getBoundingClientRect()
    return r ? { top: r.top, bottom: r.bottom } : null
  })
  expect(caja).not.toBeNull()
  expect(foco).not.toBeNull()
  if (!caja || !foco) return
  const solapa = foco.bottom > caja.y && foco.top < caja.y + caja.height
  expect(solapa, 'el control con el foco queda debajo de la barra').toBe(false)
}

test('registro: el campo de la fecha no queda bajo las acciones', async ({
  page,
}) => {
  await page.goto('/coleccion/nueva')
  const fecha = page.getByLabel('Fecha de adquisición')
  await expect(fecha).toBeVisible()
  await tabularHasta(page, fecha)
  await noLoTapa(page, page.locator('[data-barra-inferior]'))
})

test('edición: los chips del tipo no quedan bajo las acciones', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'WebKit no tabula a los botones')
  await page.goto(`/coleccion/${PLANTAS.amabilis}/editar`)
  const tipo = page.getByRole('button', { name: 'Especie', exact: true })
  await expect(tipo).toBeVisible()
  await tabularHasta(page, tipo)
  await noLoTapa(page, page.locator('[data-barra-inferior]'))
})

/** El elemento con el foco está entero dentro de la ventana. */
async function focoALaVista(page: Page) {
  const dentro = await page.evaluate(() => {
    const r = document.activeElement?.getBoundingClientRect()
    return r ? r.top >= 0 && r.bottom <= window.innerHeight : false
  })
  expect(dentro, 'el control con el foco queda fuera de la vista').toBe(true)
}

test('inventario: sin barras fijas, el foco se ve en el pie y en las tarjetas', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'WebKit no tabula a los enlaces')
  await page.goto('/coleccion')
  const tarjetas = page.getByRole('main').getByRole('article')
  await expect(tarjetas).toHaveCount(5)

  // Nada en la página queda fijo al desplazarla.
  const fijos = await page.evaluate(
    () =>
      [...document.querySelectorAll('body *')].filter((el) =>
        ['fixed', 'sticky'].includes(getComputedStyle(el).position),
      ).length,
  )
  expect(fijos).toBe(0)
  await expect(
    page.locator('[data-barra-superior], [data-barra-inferior]'),
  ).toHaveCount(0)

  // Hacia abajo, hasta el pie.
  const pie = page.getByRole('link', { name: 'Privacidad' })
  await tabularHasta(page, pie)
  await focoALaVista(page)

  // Hacia arriba, por las tarjetas.
  for (const nombre of [
    'Phalaenopsis amabilis',
    'Cattleya maxima',
    'Dendrobium nobile',
    'Masdevallia veitchiana',
    'Oncidium Sharry Baby',
  ]) {
    await tabularHasta(
      page,
      page.getByRole('link', { name: nombre, exact: true }),
      'Shift+Tab',
    )
    await focoALaVista(page)
  }
})
