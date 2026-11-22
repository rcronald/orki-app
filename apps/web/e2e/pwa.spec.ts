import type { Page } from '@playwright/test'
import { expect, test } from './soporte/fixtures.ts'

// La PWA (#7, #18): el manifiesto, el service worker de producción
// registrado de verdad y el arranque sin conexión, desde la caché del service
// worker, de la pantalla inicial y del inventario (copia local, solo lectura).
//
// Aquí el service worker está activo (en el resto de pruebas se bloquea):
// sirve el HTML y los chunks desde su caché, así que estas pruebas no dependen
// de las rutas de Playwright para la app, solo para Supabase.

test.use({ serviceWorkers: 'allow' })

/** Espera a que el service worker esté activo y controle la página. */
async function esperarServiceWorker(page: Page) {
  const script = await page.evaluate(async () => {
    const registro = await navigator.serviceWorker.ready
    return registro.active?.scriptURL ?? null
  })
  expect(script).toMatch(/\/sw\.js$/)
  // clientsClaim: toma el control de la pestaña abierta sin recargar.
  await expect
    .poll(() =>
      page.evaluate(() => navigator.serviceWorker.controller !== null),
    )
    .toBe(true)
}

test('manifiesto instalable', async ({ page, request }) => {
  await page.goto('/')
  const enlace = page.locator('link[rel="manifest"]')
  await expect(enlace).toHaveCount(1)
  const direccion = new URL(
    (await enlace.getAttribute('href')) ?? '',
    page.url(),
  ).toString()

  const respuesta = await request.get(direccion)
  expect(respuesta.ok()).toBe(true)
  const manifiesto = (await respuesta.json()) as {
    name: string
    short_name: string
    lang: string
    start_url: string
    scope: string
    display: string
    theme_color: string
    icons: { src: string; sizes: string; purpose?: string }[]
  }
  expect(manifiesto).toMatchObject({
    name: 'Orki',
    short_name: 'Orki',
    lang: 'es',
    start_url: '/',
    scope: '/',
    display: 'standalone',
  })
  expect(
    await page.locator('meta[name="theme-color"]').getAttribute('content'),
  ).toBe(manifiesto.theme_color)
  const tamanos = manifiesto.icons.map((icono) => icono.sizes)
  expect(tamanos).toEqual(expect.arrayContaining(['192x192', '512x512']))
  expect(manifiesto.icons.some((icono) => icono.purpose === 'maskable')).toBe(
    true,
  )
  for (const icono of manifiesto.icons) {
    const imagen = await request.get(new URL(icono.src, direccion).toString())
    expect(imagen.ok(), icono.src).toBe(true)
    expect(imagen.headers()['content-type']).toBe('image/png')
  }
})

test.describe('sin sesión', () => {
  test.use({ sesion: { usuario: null } })

  test('la pantalla inicial arranca sin conexión', async ({
    page,
    context,
    browserName,
    baseURL,
  }) => {
    await page.goto('/')
    await expect(
      page.getByRole('heading', { name: 'Orki', level: 1 }),
    ).toBeVisible()
    await esperarServiceWorker(page)

    if (browserName === 'firefox') {
      // En Firefox, el modo sin conexión de Playwright corta también lo que
      // respondería el service worker (NS_ERROR_OFFLINE, comprobado), así que
      // se corta el servidor de la app: cualquier petición que llegue a la
      // red falla y solo puede responder la caché del service worker.
      await context.route(`${baseURL ?? ''}/**`, (route) =>
        route.abort('internetdisconnected'),
      )
    } else {
      await context.setOffline(true)
    }
    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'Orki', level: 1 }),
    ).toBeVisible()
    await expect(
      page.getByText('Tu colección de orquídeas, siempre a mano.'),
    ).toBeVisible()
    // Las demás rutas también se abren desde la caché (navigateFallback).
    await page.goto('/catalogo')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })
})

test('el inventario se abre sin conexión con la copia local', async ({
  page,
  context,
  browserName,
  revisarAccesibilidad,
}) => {
  // Fuera de Chromium, Playwright no intercepta las peticiones de una página
  // que controla un service worker: la colección no llegaría del Supabase
  // simulado y no habría copia local que abrir. La pantalla inicial sin
  // conexión sí se prueba en todos los motores (arriba).
  test.skip(
    browserName !== 'chromium',
    'Playwright solo intercepta la red de una página con service worker en Chromium.',
  )
  await page.goto('/coleccion')
  await expect(
    page.getByRole('heading', { name: 'Phalaenopsis amabilis', level: 2 }),
  ).toBeVisible()
  await esperarServiceWorker(page)

  // Sin red, Clerk no carga (docs/sin-conexion.md): la app usa el último
  // usuario recordado y su copia en IndexedDB, en solo lectura.
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByText('Sin conexión', { exact: true })).toBeVisible()
  await expect(page.getByRole('main').getByRole('article')).toHaveCount(5)
  await page
    .getByRole('searchbox', { name: 'Buscar en tu colección' })
    .fill('nobile')
  await expect(page.getByRole('main').getByRole('article')).toHaveCount(1)
  await expect(
    page.getByRole('link', { name: 'Registrar orquídea' }),
  ).toHaveCount(0)
  await revisarAccesibilidad('inventario sin conexión')
})
