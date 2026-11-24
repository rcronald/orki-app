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

    test('la primera visita no recarga la página al instalarse el service worker', async ({
      page,
    }) => {
      let cargas = 0
      page.on('load', () => {
        cargas += 1
      })
      await page.goto('/')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await page.evaluate(() => {
        document.documentElement.dataset.sinRecargar = 'sí'
      })
      // clientsClaim: toma el control de esta pestaña (controllerchange).
      await esperarControl(page)
      await page.evaluate(() => navigator.serviceWorker.ready)
      expect(
        await page.evaluate(() => document.documentElement.dataset.sinRecargar),
      ).toBe('sí')
      expect(cargas).toBe(1)
      expect(
        await page.evaluate(() =>
          sessionStorage.getItem('orki:recarga-por-version'),
        ),
      ).toBeNull()
      await expect(page.getByText(AVISO)).toHaveCount(0)
    })

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

  // Safari cancela los import() en curso al empezar una navegación a otra
  // página, antes de irse. Ese fallo no es un despliegue: recargar la página
  // de antes interrumpía la navegación (#278, visto en WebKit con
  // objetivos-tactiles.spec.ts). Sin etiqueta: es justo lo que cambia con el
  // motor.
  test('ir a otra página mientras llega el chunk de la app no recarga la de antes', async ({
    page,
  }) => {
    let soltar = () => {}
    const retenido = new Promise<void>((resolver) => {
      soltar = resolver
    })
    let primera = true
    await page.route(/\/assets\/App-[^/]+\.js$/, async (ruta) => {
      if (primera) {
        primera = false
        await retenido
      }
      await ruta.continue().catch(() => undefined)
    })
    const pedido = page.waitForRequest(/\/assets\/App-[^/]+\.js$/)
    // Sin esperar a «load»: en WebKit el chunk retenido puede retrasarlo.
    await page.goto('/', { waitUntil: 'commit' })
    await pedido
    // El chunk de la app está a medio llegar cuando se va a otra página.
    const navegacion = page.goto('/catalogo')
    soltar()
    await navegacion
    await expect(
      page.getByRole('heading', { name: 'Catálogo', level: 1 }),
    ).toBeVisible()
    await expect(page).toHaveURL(/\/catalogo$/)
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem('orki:recarga-por-version'),
      ),
    ).toBeNull()
  })

  // Al volver atrás en el historial a otro documento, WebKit cancela los
  // import() en curso y los rechaza unos milisegundos antes de beforeunload
  // (#308; al pulsar un enlace es al revés). Aquí el que está a medias es el
  // registro del service worker, que se pide al montar la app. En una
  // pantalla de trabajo (el registro de la cuenta) el rechazo llegaba a
  // Sentry; en otra (los créditos), la red de seguridad del #278 se ponía a
  // recargar y dejaba su marca a la página de antes. La persona no veía nada:
  // la página se iba igual. Sin etiqueta: es justo lo que cambia con el motor.
  for (const { ruta, titulo } of [
    { ruta: '/registro', titulo: /Crear cuenta/ },
    { ruta: '/creditos', titulo: /Créditos/ },
  ]) {
    test(`volver atrás desde ${ruta} con el registro del service worker a medias no recarga ni lo informa`, async ({
      page,
      servidor,
    }) => {
      const privacidad = page.getByRole('heading', {
        level: 1,
        name: /privacidad/i,
      })
      const registroDelSw = /\/assets\/virtual_pwa-register-[^/]+\.js$/
      // Con el SDK de Sentry ya en marcha (deja window.orkiErrorDePrueba):
      // antes, un error se guarda en el búfer y se pierde con la página.
      const sentryListo = () =>
        page.waitForFunction(
          () =>
            typeof (window as { orkiErrorDePrueba?: unknown })
              .orkiErrorDePrueba === 'function',
        )
      // Se retiene también el de la página de antes: si llegara, WebKit lo
      // reutilizaría de su caché en memoria y el de la otra no saldría a la
      // red. Ir a la otra página lo cancela, antes de beforeunload, sin
      // consecuencias (la prueba de arriba).
      const deAntes = servidor.retener(registroDelSw)
      const retenido = servidor.retener(registroDelSw)
      await page.goto('/privacidad')
      await expect(privacidad).toBeVisible()
      await deAntes.pedida
      await sentryListo()

      await page.goto(ruta, { waitUntil: 'commit' })
      await expect(page).toHaveTitle(titulo)
      await retenido.pedida
      await sentryListo()

      // El registro del service worker está a medias al volver atrás.
      await page.goBack({ waitUntil: 'commit' })
      deAntes.soltar()
      retenido.soltar()
      await expect(privacidad).toBeVisible()
      await expect(page).toHaveURL(/\/privacidad$/)
      // Ni recarga ni marca: la red de seguridad sigue entera.
      expect(
        await page.evaluate(() =>
          sessionStorage.getItem('orki:recarga-por-version'),
        ),
      ).toBeNull()
    })
  }

  test(
    'una ruta diferida que ya no existe recarga una vez con la versión nueva',
    { tag: '@logica' },
    async ({ page, servidor }) => {
      // Una página de la app ya pintada por React (en la portada, un clic
      // antes de que la app sustituya la prerrenderada cargaría B entera).
      // Se espera también al chunk de Sentry, que llega tras el primer
      // pintado: si se pidiera ya con B servido, daría 404 y la recarga
      // (correcta) se llevaría el clic en «Créditos y fuentes».
      const sentry = page.waitForResponse(/\/assets\/sentry-[^/]+\.js$/)
      await page.goto('/privacidad')
      await expect(
        page.getByRole('heading', { level: 1, name: /privacidad/i }),
      ).toBeVisible()
      await sentry
      await page.waitForLoadState('networkidle')

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
