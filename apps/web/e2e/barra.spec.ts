import type { Page } from '@playwright/test'
import { ADMIN } from './soporte/datos.ts'
import { expect, test } from './soporte/fixtures.ts'

// Barra de la app con sesión y menú «Tu cuenta» (#207): la misma en todas las
// pantallas con sesión, en escritorio y a 360 px (el ancho más estrecho que
// se soporta), con el menú abierto y revisado con axe.

async function sinDesplazamientoHorizontal(page: Page) {
  const anchos = await page.evaluate(() => ({
    documento: document.documentElement.scrollWidth,
    ventana: document.documentElement.clientWidth,
  }))
  expect(anchos.documento).toBeLessThanOrEqual(anchos.ventana)
}

for (const ancho of [1440, 360]) {
  test(
    `a ${ancho} px: logotipo, «Mi colección», «Catálogo» y el menú «Tu cuenta»`,
    { tag: ancho > 720 ? '@escritorio' : [] },
    async ({ page, revisarAccesibilidad }) => {
      await page.setViewportSize({ width: ancho, height: 800 })
      await page.goto('/coleccion')
      await expect(
        page.getByRole('heading', { name: 'Mi colección', level: 1 }),
      ).toBeVisible()

      const barra = page.getByRole('banner')
      await expect(
        barra.getByRole('link', { name: 'Inicio de orqui.app' }),
      ).toBeVisible()
      const pestana = barra.getByRole('link', { name: 'Mi colección' })
      await expect(pestana).toBeVisible()
      await expect(pestana).toHaveAttribute('aria-current', 'page')
      const cuenta = barra.getByRole('button', { name: 'Tu cuenta' })
      await expect(cuenta).toBeVisible()
      // Sin lupa en la barra.
      await expect(barra.getByRole('searchbox')).toHaveCount(0)
      await expect(barra.locator('.lucide-search')).toHaveCount(0)
      // «Tu cuenta» se ve en escritorio; en el celular queda la foto.
      // (Hasta 720 px el texto sigue para el lector, recortado a 1 px.)
      const etiqueta = await cuenta.getByText('Tu cuenta').boundingBox()
      if (ancho > 720) expect(etiqueta?.width ?? 0).toBeGreaterThan(40)
      else expect(etiqueta?.width ?? 0).toBeLessThanOrEqual(1)
      await sinDesplazamientoHorizontal(page)
      // «Catálogo» (#232), la segunda pestaña: logotipo, pestañas y cuenta caben
      // sin solaparse, también a 360 px.
      const catalogo = barra.getByRole('link', { name: 'Catálogo' })
      await expect(catalogo).toBeVisible()
      await expect(catalogo).not.toHaveAttribute('aria-current')
      const logotipo = barra.getByRole('link', { name: 'Inicio de orqui.app' })
      const enOrden = await Promise.all(
        [logotipo, pestana, catalogo, cuenta].map((c) => c.boundingBox()),
      )
      for (let i = 1; i < enOrden.length; i += 1) {
        const antes = enOrden[i - 1]
        expect(
          Math.round((antes?.x ?? 0) + (antes?.width ?? 0)),
        ).toBeLessThanOrEqual(Math.round(enOrden[i]?.x ?? 0))
      }
      // Los 44 px de estos controles los mide objetivos-tactiles.spec.ts.

      await cuenta.click()
      await expect(cuenta).toHaveAttribute('aria-expanded', 'true')
      const menu = page.getByRole('menu', { name: 'Tu cuenta' })
      await expect(menu).toBeVisible()
      await expect(menu.getByRole('menuitem')).toHaveText([
        'Tu cuenta',
        'Cerrar sesión',
      ])
      await expect(
        menu.getByRole('menuitem', { name: 'Tu cuenta' }),
      ).toBeFocused()
      await sinDesplazamientoHorizontal(page)
      const cajaMenu = await page.locator('.orki-menu__popup').boundingBox()
      expect(cajaMenu?.x ?? -1).toBeGreaterThanOrEqual(0)
      expect((cajaMenu?.x ?? 0) + (cajaMenu?.width ?? 0)).toBeLessThanOrEqual(
        ancho,
      )
      await revisarAccesibilidad(`menú «Tu cuenta» a ${ancho} px`)

      // Con el teclado: flechas, Escape devuelve el foco al botón.
      await page.keyboard.press('ArrowDown')
      await expect(
        menu.getByRole('menuitem', { name: 'Cerrar sesión' }),
      ).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(menu).toBeHidden()
      await expect(cuenta).toBeFocused()

      // «Tu cuenta» lleva a la pantalla de cuenta; la pestaña deja de ser la
      // actual.
      await cuenta.click()
      await menu.getByRole('menuitem', { name: 'Tu cuenta' }).click()
      await expect(page).toHaveURL(/\/cuenta$/)
      await expect(
        page.getByRole('heading', { name: 'Tu cuenta', level: 1 }),
      ).toBeVisible()
      await expect(pestana).not.toHaveAttribute('aria-current')
    },
  )
}

test('la barra es la misma en el detalle, el registro y la cuenta', async ({
  page,
}) => {
  for (const ruta of ['/coleccion/nueva', '/cuenta']) {
    await page.goto(ruta)
    const barra = page.getByRole('banner')
    await expect(barra).toHaveClass(/orki-appbar/)
    await expect(barra.getByRole('button', { name: 'Tu cuenta' })).toBeVisible()
  }
  await page.goto('/coleccion')
  await page
    .getByRole('main')
    .getByRole('article')
    .first()
    .getByRole('link')
    .click()
  await expect(
    page.getByRole('banner').getByRole('link', { name: 'Mi colección' }),
  ).toHaveAttribute('aria-current', 'page')
})

test.describe('sin nombre en la cuenta', () => {
  test.use({ sesion: { usuario: 'user_sin_nombre', nombre: null } })

  test(
    'el avatar muestra el icono de perfil y el menú el correo',
    { tag: '@logica' },
    async ({ page }) => {
      await page.goto('/coleccion')
      const cuenta = page.getByRole('button', { name: 'Tu cuenta' })
      await expect(cuenta.locator('.orki-avatar .lucide-user')).toHaveCount(1)
      await cuenta.click()
      await expect(page.getByText('persona@orki.invalid')).toBeVisible()
    },
  )
})

test.describe('administrador', () => {
  test.use({ sesion: { usuario: ADMIN, rol: 'catalog_admin' } })

  test(
    'el menú ofrece «Administración»',
    { tag: '@logica' },
    async ({ page }) => {
      await page.goto('/coleccion')
      await page.getByRole('button', { name: 'Tu cuenta' }).click()
      await expect(page.getByRole('menuitem')).toHaveText([
        'Tu cuenta',
        'Administración',
        'Cerrar sesión',
      ])
    },
  )
})
