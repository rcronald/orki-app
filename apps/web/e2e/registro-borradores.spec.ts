import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { ESPECIES, GENEROS, USUARIO } from './soporte/datos.ts'
import { expect, test } from './soporte/fixtures.ts'

// Un borrador anterior no sustituye a la especie recién elegida (#296): con un
// borrador de Cattleya maxima guardado, «Registrar esta especie» en la ficha
// de Vanda coerulea (y «Registrarla con este nombre» en «¿Ya la tengo?») abre
// la elección entre «Continuar borrador» y «Registrar Vanda coerulea». Elegir
// registrar Vanda no borra el borrador de Cattleya: se retoma después, con su
// foto. A 360 px, sin desplazamiento horizontal.

const FOTO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/photos/fixtures/sin-metadatos.jpg',
)

const nombre = (page: Page) => page.getByRole('combobox', { name: 'Nombre' })
const eleccion = (page: Page) =>
  page.getByRole('heading', { name: '¿Qué quieres registrar?', level: 2 })
const continuar = (page: Page) =>
  page.getByRole('button', { name: /^Continuar borrador Cattleya maxima/ })
const registrarVanda = (page: Page) =>
  page.getByRole('button', { name: /^Registrar Vanda coerulea/ })
const galeria = (page: Page) =>
  page.getByRole('region', { name: 'Fotos (opcional)' })

/** Sin desplazamiento horizontal (WCAG 1.4.10). */
async function sinDesplazamientoHorizontal(page: Page) {
  const sobra = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  )
  expect(sobra).toBeLessThanOrEqual(0)
}

/** Fotos guardadas en IndexedDB para los borradores (orki-registro). */
function fotosDeBorradores(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const abrir = indexedDB.open('orki-registro', 1)
        abrir.onupgradeneeded = () =>
          abrir.result.createObjectStore('foto-pendiente')
        abrir.onerror = () => resolve(-1)
        abrir.onsuccess = () => {
          const db = abrir.result
          const claves = db
            .transaction('foto-pendiente', 'readonly')
            .objectStore('foto-pendiente')
            .getAllKeys()
          claves.onsuccess = () => {
            resolve(claves.result.length)
            db.close()
          }
          claves.onerror = () => resolve(-1)
        }
      }),
  )
}

/**
 * Deja guardado un borrador de Cattleya maxima (enlazada al catálogo) con una
 * foto. El WebKit de Playwright no guarda Blob en IndexedDB (como la
 * navegación privada de Safari): allí el borrador va sin la foto.
 */
async function borradorDeCattleya(page: Page, conFoto: boolean) {
  await page.goto('/coleccion/nueva')
  await nombre(page).fill('Cattleya maxima')
  await expect(page.getByText('Coincidencia en el catálogo')).toBeVisible()
  const selector = page.waitForEvent('filechooser')
  await galeria(page).getByRole('button', { name: 'Elegir fotos' }).click()
  await (await selector).setFiles([FOTO])
  await expect(page.locator('.orki-gallery__item--preparing')).toHaveCount(0)
  if (conFoto) await expect.poll(() => fotosDeBorradores(page)).toBe(1)
}

test.use({ viewport: { width: 360, height: 900 } })

test('registrar Vanda coerulea teniendo un borrador de Cattleya maxima, desde la ficha del catálogo: se elige y el borrador se conserva', async ({
  page,
  supabase,
  browserName,
  revisarAccesibilidad,
}) => {
  const guardaFotos = browserName !== 'webkit'
  await borradorDeCattleya(page, guardaFotos)

  await page.goto(`/catalogo/especie/${ESPECIES.vandaCoerulea}`)
  await page.getByRole('link', { name: 'Registrar esta especie' }).click()
  await expect(page).toHaveURL(/\/coleccion\/nueva\?nombre=Vanda\+coerulea$/)

  // Se ven los dos nombres y se elige: el formulario no abre con ninguno.
  await expect(eleccion(page)).toBeFocused()
  await expect(nombre(page)).toHaveCount(0)
  await expect(
    page
      .getByRole('region', { name: '¿Qué quieres registrar?' })
      .getByRole('status'),
  ).toHaveText(
    `Tienes un borrador guardado de Cattleya maxima${guardaFotos ? ' (1 foto)' : ''}. Puedes continuarlo o registrar Vanda coerulea; el borrador se conserva hasta que lo descartes.`,
  )
  await expect(continuar(page)).toHaveAccessibleName(
    `Continuar borrador Cattleya maxima${guardaFotos ? ' (1 foto)' : ''}`,
  )
  for (const boton of [continuar(page), registrarVanda(page)]) {
    const caja = await boton.boundingBox()
    expect(Math.round(caja?.height ?? 0)).toBeGreaterThanOrEqual(44)
  }
  await sinDesplazamientoHorizontal(page)
  await revisarAccesibilidad('registro: elegir entre el borrador y la especie')

  await registrarVanda(page).click()
  // La especie queda enlazada como si se hubiera elegido (#280).
  await expect(nombre(page)).toHaveValue('Vanda coerulea')
  await expect(page.getByText('Coincidencia en el catálogo')).toBeVisible()
  await expect(nombre(page)).toBeFocused()
  await expect(
    page.getByText(/^Tu borrador de Cattleya maxima.* sigue guardado\.$/),
  ).toBeVisible()
  await expect(galeria(page).locator('.orki-gallery__count')).toContainText(
    '0 de 6',
  )
  await sinDesplazamientoHorizontal(page)
  await revisarAccesibilidad(
    'registro de la especie con otro borrador guardado',
  )

  await page.getByRole('button', { name: 'Registrar orquídea' }).click()
  await expect(page).toHaveURL(/\/coleccion$/)
  expect(
    supabase
      .plantasDe(USUARIO)
      .find((p) => p.species_id === ESPECIES.vandaCoerulea),
  ).toMatchObject({ entered_name: 'Vanda coerulea', genus_id: GENEROS.vanda })

  // El borrador de Cattleya sigue ahí, con su foto.
  await page.getByRole('link', { name: 'Registrar orquídea' }).click()
  await expect(
    page.getByText('Recuperamos lo que estabas escribiendo.'),
  ).toBeVisible()
  await expect(nombre(page)).toHaveValue('Cattleya maxima')
  if (guardaFotos) await expect(galeria(page).getByRole('img')).toHaveCount(1)
})

test('registrar Vanda coerulea teniendo un borrador de Cattleya maxima, desde «¿Ya la tengo?»: «Continuar borrador» con el teclado', async ({
  page,
  browserName,
}) => {
  await borradorDeCattleya(page, browserName !== 'webkit')

  await page.goto('/ya-la-tengo')
  await page
    .getByRole('searchbox', { name: 'Nombre de la orquídea' })
    .pressSequentially('Vanda coerulea')
  await page.getByRole('link', { name: 'Registrarla con este nombre' }).click()
  await expect(page).toHaveURL(/\/coleccion\/nueva\?nombre=Vanda\+coerulea$/)
  await expect(eleccion(page)).toBeFocused()
  await expect(registrarVanda(page)).toBeVisible()

  // WebKit solo tabula a los campos de formulario: allí el foco se pone en
  // el botón y se pulsa Enter.
  if (browserName === 'webkit') await continuar(page).focus()
  else await page.keyboard.press('Tab')
  await expect(continuar(page)).toBeFocused()
  await page.keyboard.press('Enter')

  await expect(nombre(page)).toHaveValue('Cattleya maxima')
  await expect(
    page.getByText('Recuperamos lo que estabas escribiendo.'),
  ).toBeVisible()
  await expect(page.getByText(/sigue guardado/)).toHaveCount(0)
})

test(
  'con un borrador de la misma especie, no se pregunta',
  { tag: '@logica' },
  async ({ page }) => {
    await page.goto('/coleccion/nueva')
    await nombre(page).fill('Vanda coerulea')
    await expect(page.getByText('Coincidencia en el catálogo')).toBeVisible()
    await page.getByRole('combobox', { name: 'Origen' }).fill('Vivero Sol')

    await page.goto(`/catalogo/especie/${ESPECIES.vandaCoerulea}`)
    await page.getByRole('link', { name: 'Registrar esta especie' }).click()
    await expect(nombre(page)).toHaveValue('Vanda coerulea')
    await expect(eleccion(page)).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: 'Origen' })).toHaveValue(
      'Vivero Sol',
    )
  },
)
