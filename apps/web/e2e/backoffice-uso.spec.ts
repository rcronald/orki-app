import type { Page } from '@playwright/test'
import { ADMIN } from './soporte/datos.ts'
import { expect, test } from './soporte/fixtures.ts'

// Uso del backoffice del catálogo (#257): el detalle y el alta se abren a la
// vista con el foco en su título, el aviso de resultado se ve sin desplazarse
// (y se anuncia una sola vez), la lista de géneros del alta no sale del área
// visible y «Editar» queda alineado con su fila en «Géneros». Corre en
// escritorio y en el perfil de celular.

test.use({ sesion: { usuario: ADMIN, rol: 'catalog_admin' } })

async function abrir(page: Page, busqueda = '') {
  await page.goto(`/administracion/catalogo${busqueda}`)
  await expect(
    page
      .getByRole('table', {
        name: /Especies del catálogo|Géneros del catálogo/,
      })
      .getByRole('rowheader')
      .first(),
  ).toBeVisible()
}

/** El aviso se ve (la copia sin rol) y se anuncia una vez (la región). */
async function avisoALaVista(page: Page, texto: RegExp) {
  const anuncios = page.getByRole('status').filter({ hasText: texto })
  await expect(anuncios).toHaveCount(1)
  const copia = page.locator('p[aria-hidden="true"]').filter({ hasText: texto })
  await expect(copia).toHaveCount(1)
  await expect(copia).toBeInViewport()
}

test('el detalle se abre a la vista con el foco en su título', async ({
  page,
}) => {
  await abrir(page)
  await page.getByRole('link', { name: 'Vanda coerulea' }).click()
  const titulo = page.getByRole('heading', {
    name: 'Detalle de Vanda coerulea',
  })
  await expect(titulo).toBeFocused()
  await expect(titulo).toBeInViewport()
  await expect(page.getByRole('button', { name: 'Editar' })).toBeInViewport()
})

test('alta: a la vista, la lista de géneros dentro de la ventana y el aviso junto al detalle', async ({
  page,
}) => {
  await abrir(page)
  await page.getByRole('button', { name: 'Añadir especie o híbrido' }).click()
  const titulo = page.getByRole('heading', { name: 'Alta en el catálogo' })
  await expect(titulo).toBeFocused()
  await expect(titulo).toBeInViewport()

  const genero = page.getByRole('combobox', { name: 'Género' }).last()
  await genero.pressSequentially('van')
  const opcion = page.getByRole('option', { name: 'Vanda' })
  await expect(opcion).toBeVisible()
  // La lista entera dentro de la ventana (se espera: el desplazamiento que
  // la trae puede llegar un momento después).
  const lista = page.getByRole('listbox')
  const alto = page.viewportSize()?.height ?? 0
  await expect
    .poll(async () => {
      const caja = await lista.boundingBox()
      return caja === null ? Infinity : Math.round(caja.y + caja.height)
    })
    .toBeLessThanOrEqual(alto)
  await opcion.click()
  await page
    .getByRole('textbox', { name: 'Nombre científico' })
    .fill('Vanda tricolor')
  await page.getByRole('button', { name: 'Dar de alta', exact: true }).click()

  await expect(
    page.getByRole('heading', { name: 'Detalle de Vanda tricolor' }),
  ).toBeFocused()
  await avisoALaVista(page, /Se dio de alta «Vanda tricolor»/)
})

test('cambio por lote: el aviso se ve sin desplazarse', async ({ page }) => {
  await abrir(page)
  const casilla = page.getByRole('checkbox', {
    name: 'Seleccionar Vanda coerulea',
  })
  await casilla.scrollIntoViewIfNeeded()
  await casilla.check()
  await page
    .getByRole('combobox', { name: 'Nuevo estado' })
    .selectOption('observed')
  await page.getByRole('button', { name: 'Cambiar el estado' }).click()
  await page.getByRole('button', { name: 'Cambiar a «Observada»' }).click()
  await avisoALaVista(page, /1 especie pasó a «Observada»/)
})

test('géneros: «Editar» queda alineado con el texto de su fila', async ({
  page,
}) => {
  await abrir(page, '?pestana=generos')
  const fila = page.getByRole('row', { name: /Cattleya/ })
  // La caja del texto, no la de la celda (que ocupa todo el alto de la fila).
  const nombre = await fila.getByRole('rowheader').evaluate((celda) => {
    const rango = document.createRange()
    rango.selectNodeContents(celda)
    const { y, height } = rango.getBoundingClientRect()
    return { y, height }
  })
  const editar = await fila
    .getByRole('button', { name: 'Editar el género Cattleya' })
    .boundingBox()
  expect(nombre).not.toBeNull()
  expect(editar).not.toBeNull()
  if (nombre && editar) {
    // Centros a la misma altura (redondeado; la celda y el botón miden
    // distinto en cada motor).
    const centro = (caja: { y: number; height: number }) =>
      Math.round(caja.y + caja.height / 2)
    expect(Math.abs(centro(nombre) - centro(editar))).toBeLessThanOrEqual(2)
  }
})
