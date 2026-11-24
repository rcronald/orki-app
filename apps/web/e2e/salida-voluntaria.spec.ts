import type { Page } from '@playwright/test'
import { ADMIN, PLANTAS, USUARIO } from './soporte/datos.ts'
import { expect, test } from './soporte/fixtures.ts'

// Cerrar sesión por voluntad propia lleva siempre al inicio, sin pasar por
// «Iniciar sesión» ni dejar un redirect_url, también en el peor orden: Clerk
// avisa de que ya no hay sesión antes de que el enrutador pinte `/`. React
// Router navega en una transición (puede tardar en pintarse en un
// dispositivo lento); el aviso de Clerk, en cambio, se pinta enseguida, aún
// en la pantalla protegida. Antes de corregirlo, la ruta protegida veía «sin
// sesión» sin la marca de salida pendiente (PendingSignOut ya la había
// borrado) y mandaba a iniciar sesión para volver a ella; en el CI pasaba a
// veces en WebKit (cuenta.spec.ts y acceso.spec.ts).
//
// salidaInmediata (medicion/clerk-simulado.tsx) fuerza ese orden sin
// depender de tiempos: signOut() avisa sin esperar a la red simulada.

const TITULO_PORTADA = 'Tu colección de orquídeas, en un solo lugar'

async function terminaEnLaPortada(page: Page) {
  await expect(
    page.getByRole('heading', { name: TITULO_PORTADA, level: 1 }),
  ).toBeVisible()
  // Clerk ya cerró la sesión: ya no queda la salida pendiente que protegía
  // la vuelta al inicio. Aun así, se sigue en la portada.
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem('orki-salida-pendiente')),
    )
    .toBeNull()
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem('orki-sesion-simulada')),
    )
    .toBe(JSON.stringify({ usuario: null, rol: null }))
  await expect(page).toHaveURL(/^http:\/\/[^/]+\/$/)
  await expect(
    page.getByRole('heading', { name: TITULO_PORTADA, level: 1 }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tu cuenta' })).toHaveCount(0)
}

async function cerrarDesdeElMenu(page: Page) {
  await page.getByRole('button', { name: 'Tu cuenta' }).click()
  await page.getByRole('menuitem', { name: 'Cerrar sesión' }).click()
}

test.describe('con Clerk que confirma el cierre enseguida', () => {
  test.use({ sesion: { usuario: USUARIO, salidaInmediata: true } })

  test(
    '«Cerrar sesión» de la pantalla de cuenta lleva al inicio',
    { tag: '@logica' },
    async ({ page }) => {
      await page.goto('/cuenta')
      await page
        .getByRole('main')
        .getByRole('button', { name: 'Cerrar sesión' })
        .click()
      await terminaEnLaPortada(page)
    },
  )

  const pantallas: { ruta: string; titulo: string }[] = [
    { ruta: '/cuenta', titulo: 'Tu cuenta' },
    { ruta: '/coleccion', titulo: 'Mi colección' },
    { ruta: `/coleccion/${PLANTAS.maxima}`, titulo: 'Cattleya maxima' },
  ]
  for (const { ruta, titulo } of pantallas) {
    test(
      `el menú de la barra, desde «${titulo}», lleva al inicio`,
      { tag: '@logica' },
      async ({ page }) => {
        await page.goto(ruta)
        await expect(
          page.getByRole('heading', { name: titulo, level: 1 }),
        ).toBeVisible()
        await cerrarDesdeElMenu(page)
        await terminaEnLaPortada(page)
      },
    )
  }

  test(
    'el menú de la barra, desde el registro con un borrador, lleva al inicio',
    { tag: '@logica' },
    async ({ page }) => {
      await page.goto('/coleccion/nueva')
      await expect(
        page.getByRole('heading', { name: 'Registrar una orquídea', level: 1 }),
      ).toBeVisible()
      await page.getByRole('combobox', { name: 'Nombre' }).fill('Cattleya max')
      await expect
        .poll(() =>
          page.evaluate(() =>
            Object.keys(localStorage).some((clave) =>
              clave.startsWith('orki:registro:borrador:'),
            ),
          ),
        )
        .toBe(true)
      await cerrarDesdeElMenu(page)
      await terminaEnLaPortada(page)
    },
  )
})

test.describe('administración, con Clerk que confirma el cierre enseguida', () => {
  test.use({
    sesion: { usuario: ADMIN, rol: 'catalog_admin', salidaInmediata: true },
  })

  test(
    'el menú de la barra, desde el backoffice, lleva al inicio',
    { tag: '@logica' },
    async ({ page }) => {
      await page.goto('/administracion/catalogo')
      await expect(
        page.getByRole('heading', {
          name: 'Administración del catálogo',
          level: 1,
        }),
      ).toBeVisible()
      await cerrarDesdeElMenu(page)
      await terminaEnLaPortada(page)
    },
  )
})
