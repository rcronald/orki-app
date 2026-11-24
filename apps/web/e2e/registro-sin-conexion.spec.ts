import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrowserContext, Page, Route } from '@playwright/test'
import { GENEROS, USUARIO } from './soporte/datos.ts'
import { ORIGEN_SUPABASE } from './soporte/supabase-simulado.ts'
import { expect, test } from './soporte/fixtures.ts'

// Perder la conexión mientras se registra una planta (#296): con la sesión
// identificada en el dispositivo, el formulario sigue activo y lo completado
// (también las fotos) queda en el borrador; «Registrar orquídea» espera, con
// su motivo, y nada se envía solo al volver la conexión. A 360 px.

const FOTO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/photos/fixtures/sin-metadatos.jpg',
)

const nombre = (page: Page) => page.getByRole('combobox', { name: 'Nombre' })
const registrar = (page: Page) =>
  page.getByRole('button', { name: 'Registrar orquídea' })
const galeria = (page: Page) =>
  page.getByRole('region', { name: 'Fotos (opcional)' })

const GUARDADO =
  'Sin conexión. Borrador guardado en este dispositivo. Podrás registrarla cuando vuelva la conexión.'
const SIN_GUARDAR =
  'Sin conexión. No pudimos guardar el borrador en este dispositivo: no cierres esta pantalla. Podrás registrarla cuando vuelva la conexión.'

const cortar = (route: Route) => route.abort('internetdisconnected')

async function sinConexion(context: BrowserContext) {
  await context.route(`${ORIGEN_SUPABASE}/**`, cortar)
  await context.setOffline(true)
}

async function conConexion(context: BrowserContext) {
  await context.unroute(`${ORIGEN_SUPABASE}/**`, cortar)
  await context.setOffline(false)
}

async function elegirFoto(page: Page) {
  const selector = page.waitForEvent('filechooser')
  await galeria(page).getByRole('button', { name: 'Elegir fotos' }).click()
  await (await selector).setFiles([FOTO])
  await expect(page.locator('.orki-gallery__item--preparing')).toHaveCount(0)
}

/** Sin desplazamiento horizontal (WCAG 1.4.10). */
async function sinDesplazamientoHorizontal(page: Page) {
  const sobra = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  )
  expect(sobra).toBeLessThanOrEqual(0)
}

test.use({ viewport: { width: 360, height: 900 } })

test('perder la conexión mientras se registra una planta: se sigue completando el borrador y se registra al volver', async ({
  page,
  context,
  supabase,
  browserName,
  revisarAccesibilidad,
}) => {
  await page.goto('/coleccion/nueva')
  await nombre(page).fill('La naranja')
  // Los géneros frecuentes ya cargaron con conexión.
  const cattleya = page
    .getByRole('group', { name: 'Género' })
    .getByRole('button', { name: 'Cattleya' })
  await expect(cattleya).toBeVisible()
  // Una foto con conexión: carga el módulo que prepara las fotos, que en la
  // app instalada ya está en el precaché del service worker (aquí bloqueado).
  await elegirFoto(page)
  await expect(galeria(page).getByRole('img')).toHaveCount(1)

  // El WebKit de Playwright no guarda Blob en IndexedDB (como la navegación
  // privada de Safari): la app lo dice en vez de prometer el borrador.
  const aviso = browserName === 'webkit' ? SIN_GUARDAR : GUARDADO
  await sinConexion(context)
  await expect(page.getByText(aviso)).toBeVisible()
  // El campo de nombre sigue activo, con el texto intacto.
  await expect(nombre(page)).toBeEnabled()
  await expect(nombre(page)).toHaveValue('La naranja')
  await nombre(page).fill('La naranja del mercado')
  await expect(nombre(page)).toHaveAccessibleDescription(
    'Sin conexión no podemos buscar en el catálogo; al volver se comprobará el nombre.',
  )
  await cattleya.click()
  await page
    .getByRole('group', { name: 'Tipo' })
    .getByRole('button', { name: 'No sé' })
    .click()
  await page.getByRole('combobox', { name: 'Origen' }).fill('Feria de Lima')

  // Otra foto, ya sin conexión.
  await elegirFoto(page)
  await expect(galeria(page).getByRole('img')).toHaveCount(2)
  await expect(page.getByText(aviso)).toBeVisible()

  await expect(registrar(page)).toHaveAttribute('aria-disabled', 'true')
  await expect(registrar(page)).toHaveAccessibleDescription(aviso)
  // Sigue en el orden del foco y no envía (Playwright no pulsa un botón con
  // aria-disabled: se usa el teclado).
  await registrar(page).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/coleccion\/nueva$/)
  await sinDesplazamientoHorizontal(page)
  await revisarAccesibilidad('registro sin conexión, con el borrador')

  // Al volver, nada se envía solo: la persona pulsa.
  await conConexion(context)
  await expect(page.getByText(aviso)).toHaveCount(0)
  await expect(registrar(page)).not.toHaveAttribute('aria-disabled')
  await expect(nombre(page)).toHaveValue('La naranja del mercado')
  expect(
    supabase
      .plantasDe(USUARIO)
      .some((p) => p.entered_name === 'La naranja del mercado'),
  ).toBe(false)

  await registrar(page).click()
  await expect(page).toHaveURL(/\/coleccion$/)
  const nueva = supabase
    .plantasDe(USUARIO)
    .find((p) => p.entered_name === 'La naranja del mercado')
  expect(nueva).toMatchObject({
    genus_id: GENEROS.cattleya,
    type: 'unknown',
    origin: 'Feria de Lima',
    validation: 'pending',
  })
  expect(supabase.fotosDe(nueva?.id ?? '')).toHaveLength(2)
})

test(
  'un nombre escrito sin conexión se comprueba al volver: el exacto se enlaza solo',
  { tag: '@logica' },
  async ({ page, context, supabase }) => {
    await page.goto('/coleccion/nueva')
    await expect(
      page
        .getByRole('group', { name: 'Género' })
        .getByRole('button', { name: 'Cattleya' }),
    ).toBeVisible()
    await sinConexion(context)
    await nombre(page).fill('Vanda coerulea')
    await expect(page.getByText('Coincidencia en el catálogo')).toHaveCount(0)
    await expect(page.getByRole('listbox')).toHaveCount(0)

    await conConexion(context)
    await expect(page.getByText('Coincidencia en el catálogo')).toBeVisible()
    await registrar(page).click()
    await expect(page).toHaveURL(/\/coleccion$/)
    expect(
      supabase
        .plantasDe(USUARIO)
        .find((p) => p.entered_name === 'Vanda coerulea'),
    ).toMatchObject({ validation: 'validated', genus_id: GENEROS.vanda })
  },
)
