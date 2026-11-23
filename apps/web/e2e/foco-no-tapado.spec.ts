import type { Locator, Page } from '@playwright/test'
import { PLANTAS } from './soporte/datos.ts'
import { expect, test } from './soporte/fixtures.ts'

// El foco no queda tapado por barras que se quedan fijas al desplazar la
// página (WCAG 2.4.11, #151). Ya no hay ninguna: el inventario dejó de
// tenerlas en el #208 (el buscador va en su sitio y registrar, en la
// cabecera) y el registro y la edición en el #221 (las acciones van al final
// del formulario). Aquí se comprueba que sigan sin tenerlas y que el foco se
// vea al recorrerlas. axe no lo comprueba: hace falta llegar con el
// tabulador, que es cuando el navegador desplaza la página.
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

/**
 * El elemento con el foco se ve: al menos la mitad de su alto queda dentro de
 * la ventana. WCAG 2.4.11 pide que no quede tapado del todo por contenido de
 * la página; sin barras fijas, lo único que puede recortarlo es el borde de
 * la ventana. No se exige que quepa entero: Firefox y WebKit en Linux no
 * desplazan la página si el control ya asoma casi completo por abajo (visto
 * en el CI, #237), y eso no es un fallo de la app. Se espera a que se cumpla
 * porque el desplazamiento puede llegar un momento después del foco.
 */
async function focoALaVista(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const r = document.activeElement?.getBoundingClientRect()
          if (!r || r.height === 0) return false
          const visible =
            Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0)
          return visible / r.height >= 0.5
        }),
      { message: 'el control con el foco queda fuera de la vista' },
    )
    .toBe(true)
}

/** Nada en la página queda fijo al desplazarla. */
async function sinBarrasFijas(page: Page) {
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
}

test('registro: sin barras fijas, el foco se ve en la fecha y en el origen', async ({
  page,
}) => {
  await page.goto('/coleccion/nueva')
  const fecha = page.getByLabel('Fecha de adquisición')
  await expect(fecha).toBeVisible()
  await sinBarrasFijas(page)
  await tabularHasta(page, fecha)
  await focoALaVista(page)
  await tabularHasta(page, page.getByRole('combobox', { name: 'Origen' }))
  await focoALaVista(page)
})

test('edición: sin barras fijas, el foco se ve en el tipo y en las acciones del final', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'WebKit no tabula a los botones')
  await page.goto(`/coleccion/${PLANTAS.amabilis}/editar`)
  const tipo = page.getByRole('button', { name: 'Especie', exact: true })
  await expect(tipo).toBeVisible()
  await sinBarrasFijas(page)
  await tabularHasta(page, tipo)
  await focoALaVista(page)
  await tabularHasta(
    page,
    page.getByRole('button', { name: 'Guardar cambios' }),
  )
  await focoALaVista(page)
})

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
