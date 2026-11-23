import type { Page } from '@playwright/test'
import { TEXTO_A, TEXTO_B } from '../medicion/version-b.ts'
import { expect, test as base } from './soporte/fixtures.ts'
import {
  servirVersiones,
  type ServidorDeVersiones,
} from './soporte/servidor-de-versiones.ts'

// Actualización de la app tras un despliegue (#278). Dos builds, A y B
// (npm run build:e2e; B solo cambia un texto de los créditos, ver
// medicion/version-b.ts), servidos en el mismo origen por un servidor propio
// de cada prueba que pasa de A a B cuando la prueba «despliega» y responde 404
// a los assets que ya no existen, como Vercel.
//
// Antes del #278, con el service worker en 'autoUpdate', B tomaba el control
// de la pestaña abierta con A, borraba los chunks de A del precaché y, al ir a
// /creditos, el import() de CreditsPage-<hash de A>.js daba 404 y salía
// «Algo salió mal» (con el error enviado a Sentry). Aquí se comprueba que ya
// no pasa: ninguna prueba muestra la pantalla de fallo ni envía nada a
// Sentry (la fixture falla si la app informa un error).

const test = base.extend<{ servidor: ServidorDeVersiones }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright exige desestructurar el primer argumento
  servidor: async ({}, use) => {
    const servidor = await servirVersiones('a')
    await use(servidor)
    await servidor.cerrar()
  },
  baseURL: async ({ servidor }, use) => {
    await use(servidor.url)
  },
})

const AVISO = 'Hay una versión nueva de orqui.app.'

/** Espera a que el service worker controle la página. */
async function esperarControl(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => navigator.serviceWorker.controller !== null),
    )
    .toBe(true)
}

/** Lo que hace el navegador al navegar o la app al volver a la pestaña. */
async function buscarVersionNueva(page: Page) {
  await page.evaluate(async () => {
    const registro = await navigator.serviceWorker.getRegistration()
    await registro?.update()
  })
}

/** Va a los créditos con el enlace del pie, sin recargar (React Router). */
async function irACreditos(page: Page) {
  await page
    .getByRole('contentinfo')
    .getByRole('link', { name: 'Créditos y fuentes' })
    .click()
}

async function pantallaDeFalloAusente(page: Page) {
  await expect(
    page.getByRole('heading', { name: 'Algo salió mal' }),
  ).toHaveCount(0)
}

test.describe('con el service worker', () => {
  test.use({ serviceWorkers: 'allow' })

  test.beforeEach(({ browserName }) => {
    test.skip(
      browserName !== 'chromium',
      'Playwright solo intercepta la red de una página con service worker en Chromium (README, «Qué se prueba y qué se simula»).',
    )
  })

  test.describe('sin sesión', () => {
    test.use({ sesion: { usuario: null } })

    test('la pestaña vieja sigue cargando sus rutas y «Actualizar» trae la versión nueva', async ({
      page,
      servidor,
      revisarAccesibilidad,
    }) => {
      await page.goto('/')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await esperarControl(page)
      await expect(page.getByText(AVISO)).toHaveCount(0)

      servidor.desplegar('b')
      await buscarVersionNueva(page)
      // B se instala y espera: el aviso aparece en la portada.
      await expect(
        page.locator('[aria-live="polite"]').filter({ hasText: AVISO }),
      ).toBeVisible({
        timeout: 15_000,
      })
      await revisarAccesibilidad('aviso de versión nueva en la portada')

      // La pestaña sigue con A: su service worker aún tiene sus chunks.
      await irACreditos(page)
      await expect(page.getByText(TEXTO_A)).toBeVisible()
      await pantallaDeFalloAusente(page)
      await expect(page.getByText(AVISO)).toBeVisible()

      await page.getByRole('button', { name: 'Actualizar' }).click()
      // Recarga con B en la misma ruta.
      await expect(page.getByText(TEXTO_B)).toBeVisible()
      await expect(page).toHaveURL(/\/creditos$/)
      await expect(page.getByText(AVISO)).toHaveCount(0)
      await pantallaDeFalloAusente(page)
      expect(servidor.noEncontrados).toEqual([])
    })

    test('«Cerrar el aviso» lo oculta y deja el foco en el contenido', async ({
      page,
      servidor,
    }) => {
      await page.goto('/creditos')
      await expect(page.getByText(TEXTO_A)).toBeVisible()
      await esperarControl(page)
      servidor.desplegar('b')
      await buscarVersionNueva(page)
      const cerrar = page.getByRole('button', { name: 'Cerrar el aviso' })
      await expect(cerrar).toBeVisible({ timeout: 15_000 })
      await cerrar.click()
      await expect(page.getByText(AVISO)).toHaveCount(0)
      await expect(page.locator('#contenido')).toBeFocused()
      // Sigue en A hasta que se acepte o se cierren las pestañas.
      await expect(page.getByText(TEXTO_A)).toBeVisible()
    })
  })

  test('si otra pestaña acepta, la que está en el registro no pierde lo escrito y pasa a B al salir', async ({
    page,
    context,
    servidor,
  }) => {
    await page.goto('/coleccion/nueva')
    const nombre = page.getByRole('combobox', { name: 'Nombre' })
    await nombre.fill('Vanda Pachara Delight')
    await esperarControl(page)
    // Una marca en la página: si se recarga, desaparece.
    await page.evaluate(() => {
      document.documentElement.dataset.sinRecargar = 'sí'
    })

    const otra = await context.newPage()
    await otra.goto('/coleccion')
    await expect(otra.getByRole('heading', { level: 1 })).toBeVisible()
    await esperarControl(otra)

    servidor.desplegar('b')
    await buscarVersionNueva(otra)
    await expect(otra.getByText(AVISO)).toBeVisible({ timeout: 15_000 })
    // En el registro no aparece: «Actualizar» recargaría a medio escribir.
    await expect(page.getByText(AVISO)).toHaveCount(0)

    await otra.getByRole('button', { name: 'Actualizar' }).click()
    await expect(otra.getByText(AVISO)).toHaveCount(0)
    await expect(otra.getByRole('heading', { level: 1 })).toBeVisible()

    // La versión B ya controla las dos pestañas; el registro no se recargó.
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const registro = await navigator.serviceWorker.getRegistration()
          return registro?.waiting === null && registro.active !== null
        }),
      )
      .toBe(true)
    await expect(nombre).toHaveValue('Vanda Pachara Delight')
    expect(
      await page.evaluate(() => document.documentElement.dataset.sinRecargar),
    ).toBe('sí')

    // Al salir del registro, la pestaña carga B: se recarga en la ruta nueva.
    // El chunk de A de los créditos se llega a pedir (React empieza a pintar
    // la ruta antes de la recarga) y da 404, sin consecuencias.
    await irACreditos(page)
    await expect(page.getByText(TEXTO_B)).toBeVisible()
    await pantallaDeFalloAusente(page)
  })
})

test.describe('sin service worker', () => {
  test.use({ sesion: { usuario: null } })

  test(
    'una ruta diferida que ya no existe recarga una vez con la versión nueva',
    { tag: '@logica' },
    async ({ page, servidor }) => {
      // Una página de la app ya pintada por React (en la portada, un clic
      // antes de que la app sustituya la prerrenderada cargaría B entera).
      await page.goto('/privacidad')
      await expect(
        page.getByRole('heading', { level: 1, name: /privacidad/i }),
      ).toBeVisible()

      // Sin service worker (primera visita, o un navegador sin él), el
      // código de A pide sus chunks al servidor, que ya sirve B.
      servidor.desplegar('b')
      await irACreditos(page)

      await expect(page.getByText(TEXTO_B)).toBeVisible()
      await expect(page).toHaveURL(/\/creditos$/)
      await pantallaDeFalloAusente(page)
      expect(
        servidor.noEncontrados.some((r) => r.includes('CreditsPage')),
      ).toBe(true)
      // La marca contra los bucles queda en la sesión de la pestaña.
      expect(
        await page.evaluate(() =>
          sessionStorage.getItem('orki:recarga-por-version'),
        ),
      ).toMatch(/^\d+$/)
    },
  )
})
