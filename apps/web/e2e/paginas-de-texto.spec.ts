import type { Page } from '@playwright/test'
import { expect, test } from './soporte/fixtures.ts'

// Páginas de texto (#202, #203): privacidad y créditos, a 360 px y en
// escritorio, con axe. Públicas: sin sesión.

test.use({ sesion: { usuario: null } })

async function sinDesplazamientoHorizontal(page: Page) {
  const anchos = await page.evaluate(() => ({
    documento: document.documentElement.scrollWidth,
    ventana: document.documentElement.clientWidth,
  }))
  expect(anchos.documento).toBeLessThanOrEqual(anchos.ventana)
}

const INDICE = [
  'Qué datos guardamos',
  'Quién puede verlos',
  'Qué se guarda en tu dispositivo',
  'Cómo eliminar tu cuenta',
]

for (const [nombre, ancho, alto] of [
  ['a 360 px', 360, 780],
  ['en escritorio', 1536, 1024],
] as const) {
  test(`privacidad ${nombre}: índice, foco en la sección y volver`, async ({
    page,
    revisarAccesibilidad,
  }) => {
    await page.setViewportSize({ width: ancho, height: alto })
    await page.goto('/')
    // Desde el pie de la portada: «Volver al inicio».
    await page
      .getByRole('contentinfo')
      .getByRole('link', { name: 'Privacidad' })
      .click()
    await expect(
      page.getByRole('heading', { name: 'Privacidad', level: 1 }),
    ).toBeVisible()
    await sinDesplazamientoHorizontal(page)
    const indice = page.getByRole('navigation', { name: 'En esta página' })
    await expect(indice.getByRole('link')).toHaveText(INDICE)
    // Una fila por enlace, de 44 px.
    const cajas = await Promise.all(
      INDICE.map((texto) =>
        indice.getByRole('link', { name: texto }).boundingBox(),
      ),
    )
    for (const [i, caja] of cajas.entries()) {
      expect(caja?.height).toBeGreaterThanOrEqual(44)
      if (i > 0) expect(caja?.y).toBeGreaterThan(cajas[i - 1]?.y ?? 0)
    }
    await revisarAccesibilidad(`privacidad ${nombre}`)

    // Con el teclado: el foco va al título de la sección, que queda a la
    // vista, y el enlace de volver no cambia.
    await indice.getByRole('link', { name: 'Cómo eliminar tu cuenta' }).focus()
    await page.keyboard.press('Enter')
    const titulo = page.getByRole('heading', {
      name: 'Cómo eliminar tu cuenta',
      level: 2,
    })
    await expect(titulo).toBeFocused()
    await expect(titulo).toBeInViewport()
    await expect(page).toHaveURL(/\/privacidad#privacidad-eliminar$/)
    const volver = page.getByRole('link', { name: 'Volver al inicio' })
    await expect(volver).toHaveAttribute('href', '/')
    await volver.click()
    await expect(page).toHaveURL(/\/$/)
  })
}

test('privacidad desde crear cuenta: «Volver al registro»', async ({
  page,
}) => {
  await page.goto('/registro')
  await page.getByRole('main').getByRole('link', { name: 'Privacidad' }).click()
  await page.getByRole('link', { name: 'Volver al registro' }).click()
  await expect(page).toHaveURL(/\/registro$/)
})

test('privacidad abierta directamente: «Volver al inicio»', async ({
  page,
}) => {
  await page.goto('/privacidad')
  await expect(
    page.getByRole('link', { name: 'Volver al inicio' }),
  ).toBeVisible()
})

test.describe('con sesión', () => {
  test.use({ sesion: { usuario: 'user_prueba_e2e' } })

  test('privacidad desde la colección: «Volver a Mi colección»', async ({
    page,
  }) => {
    await page.goto('/coleccion')
    await page
      .getByRole('contentinfo')
      .getByRole('link', { name: 'Privacidad' })
      .click()
    await page.getByRole('link', { name: 'Volver a Mi colección' }).click()
    await expect(page).toHaveURL(/\/coleccion$/)
    await expect(
      page.getByRole('heading', { name: 'Mi colección', level: 1 }),
    ).toBeVisible()
  })
})
