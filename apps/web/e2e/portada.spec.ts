import type { Page } from '@playwright/test'
import { expect, test } from './soporte/fixtures.ts'

// Portada (#179, #200): la maqueta de escritorio a 1536 px y la de celular a
// 360 px (el ancho más estrecho que se soporta). Sin sesión, en los perfiles
// de escritorio; el de celular ya tiene su pantalla y se prueba igual.

const TITULO = 'Tu colección de orquídeas, en un solo lugar'
const VENTAJAS = [
  '¿Ya la tengo?',
  'Registra una orquídea',
  'Organiza tu colección',
]

test.use({ sesion: { usuario: null } })

async function sinDesplazamientoHorizontal(page: Page) {
  const anchos = await page.evaluate(() => ({
    documento: document.documentElement.scrollWidth,
    ventana: document.documentElement.clientWidth,
  }))
  expect(anchos.documento).toBeLessThanOrEqual(anchos.ventana)
}

/**
 * Espera a que la app haya sustituido la portada prerrenderada de index.html
 * (#204) por la suya. Hasta entonces los localizadores pueden casar con la
 * prerrenderada, que la app quita de golpe: una medida a medias saldría de un
 * elemento ya retirado.
 */
async function portadaDeLaApp(page: Page) {
  await expect(page.locator('#portada-previa')).toHaveCount(0)
  await expect(
    page.getByRole('heading', { name: TITULO, level: 1 }),
  ).toBeVisible()
}

async function fotoCargada(page: Page) {
  const foto = page.getByRole('img', {
    name: 'Phalaenopsis rosada en floración',
  })
  await expect(foto).toBeVisible()
  await expect
    .poll(() =>
      foto.evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth,
      ),
    )
    .toBeGreaterThan(0)
  return foto
}

test('a 360 px: una columna, sin desplazamiento horizontal y acciones de 44 px', async ({
  page,
  revisarAccesibilidad,
}) => {
  await page.setViewportSize({ width: 360, height: 780 })
  await page.goto('/')
  await portadaDeLaApp(page)
  await sinDesplazamientoHorizontal(page)

  // La cabecera queda solo con el logotipo, centrado: las acciones están en
  // el Hero.
  const cabecera = page.getByRole('banner')
  const logotipo = cabecera.getByRole('link', { name: 'Inicio de orqui.app' })
  await expect(logotipo).toBeVisible()
  const cajaLogotipo = await logotipo.boundingBox()
  expect(
    Math.abs((cajaLogotipo?.x ?? 0) + (cajaLogotipo?.width ?? 0) / 2 - 180),
  ).toBeLessThanOrEqual(2)
  await expect(
    cabecera.getByRole('link', { name: 'Iniciar sesión' }),
  ).toBeHidden()

  const portada = page.getByRole('region', { name: TITULO })
  const crear = portada.getByRole('link', { name: 'Crear cuenta gratis' })
  const entrar = portada.getByRole('link', { name: 'Iniciar sesión' })
  const cajaCrear = await crear.boundingBox()
  const cajaEntrar = await entrar.boundingBox()
  expect(cajaCrear?.height).toBeGreaterThanOrEqual(44)
  expect(cajaEntrar?.height).toBeGreaterThanOrEqual(44)
  // Una debajo de otra, a todo el ancho.
  expect(cajaEntrar?.y).toBeGreaterThan((cajaCrear?.y ?? 0) + 44)
  expect(cajaCrear?.width).toBeGreaterThan(300)

  // La foto, debajo de las acciones y apaisada (2:1); sin dibujo botánico.
  const foto = await fotoCargada(page)
  const cajaFoto = await foto.boundingBox()
  expect(cajaFoto?.y).toBeGreaterThan((cajaEntrar?.y ?? 0) + 44)
  expect((cajaFoto?.width ?? 0) / (cajaFoto?.height ?? 1)).toBeCloseTo(2, 1)
  await expect(page.locator('.orki-hero__art')).toHaveCount(0)

  // Ventajas apiladas.
  const ventajas = page.getByRole('heading', { level: 2 })
  await expect(ventajas).toHaveText(VENTAJAS)
  const primera = await ventajas.nth(0).boundingBox()
  const segunda = await ventajas.nth(1).boundingBox()
  expect(segunda?.y).toBeGreaterThan(primera?.y ?? 0)

  // Pie: una fila por enlace, de 44 px, una debajo de otra.
  const pie = page.getByRole('contentinfo')
  await expect(
    pie.getByText('Tu colección de orquídeas, en un solo lugar.'),
  ).toBeVisible()
  const privacidad = await pie
    .getByRole('link', { name: 'Privacidad' })
    .boundingBox()
  const creditos = await pie
    .getByRole('link', { name: 'Créditos y fuentes' })
    .boundingBox()
  expect(privacidad?.height).toBeGreaterThanOrEqual(44)
  expect(creditos?.height).toBeGreaterThanOrEqual(44)
  expect(creditos?.y).toBeGreaterThanOrEqual(
    (privacidad?.y ?? 0) + (privacidad?.height ?? 0),
  )
  expect(privacidad?.width).toBeGreaterThan(300)
  await revisarAccesibilidad('portada a 360 px')
})

test('en escritorio: dos columnas, foto a toda la altura hasta el borde y ventajas en fila', async ({
  page,
  revisarAccesibilidad,
}) => {
  await page.setViewportSize({ width: 1536, height: 1024 })
  await page.goto('/')
  await portadaDeLaApp(page)
  await sinDesplazamientoHorizontal(page)

  const cabecera = page.getByRole('banner')
  await expect(
    cabecera.getByRole('link', { name: 'Iniciar sesión' }),
  ).toBeVisible()
  await expect(
    cabecera.getByRole('link', { name: 'Crear cuenta gratis' }),
  ).toBeVisible()

  const titulo = await page
    .getByRole('heading', { name: TITULO, level: 1 })
    .boundingBox()
  const hero = await page.getByRole('region', { name: TITULO }).boundingBox()
  const foto = await (await fotoCargada(page)).boundingBox()
  // La foto a la derecha del texto, hasta el borde derecho y a toda la
  // altura del bloque, que empieza justo debajo de la cabecera.
  expect(foto?.x).toBeGreaterThan((titulo?.x ?? 0) + (titulo?.width ?? 0) - 1)
  expect((foto?.x ?? 0) + (foto?.width ?? 0)).toBeCloseTo(1536, 0)
  expect(foto?.y).toBeCloseTo(hero?.y ?? 0, 0)
  expect(foto?.height).toBeCloseTo(hero?.height ?? 0, 0)
  const cajaCabecera = await cabecera.boundingBox()
  expect(hero?.y).toBeCloseTo(
    (cajaCabecera?.y ?? 0) + (cajaCabecera?.height ?? 0),
    0,
  )

  const ventajas = page.getByRole('heading', { level: 2 })
  await expect(ventajas).toHaveText(VENTAJAS)
  const cajas = await Promise.all(
    [0, 1, 2].map((i) => ventajas.nth(i).boundingBox()),
  )
  expect(new Set(cajas.map((caja) => Math.round(caja?.y ?? 0))).size).toBe(1)

  // Pie: los enlaces a la derecha.
  const pie = page.getByRole('contentinfo')
  const creditos = await pie
    .getByRole('link', { name: 'Créditos y fuentes' })
    .boundingBox()
  expect(creditos?.x).toBeGreaterThan(1536 / 2)
  await revisarAccesibilidad('portada en escritorio')
})

// Portada prerrenderada (#204): el index.html del build trae la portada y
// precarga su foto, así se ve sin esperar al chunk de la app ni a Clerk.
test.describe('portada prerrenderada', () => {
  const FOTO = /\/assets\/portada-\d+-[\w-]+\.(avif|jpg)$/

  /** El chunk de la app no llega nunca: solo se ve lo que trae el HTML. */
  async function sinChunkDeLaApp(page: Page) {
    await page.route(/\/assets\/App-[\w-]+\.js$/, () => {
      // Sin responder.
    })
  }

  function fotosPedidas(page: Page) {
    const pedidas: string[] = []
    page.on('request', (peticion) => {
      if (FOTO.test(new URL(peticion.url()).pathname)) {
        pedidas.push(new URL(peticion.url()).pathname)
      }
    })
    return pedidas
  }

  test('el HTML inicial trae la portada y la precarga de su foto', async ({
    request,
  }) => {
    const html = await (await request.get('/')).text()
    expect(html).toContain('<template id="portada-previa-plantilla">')
    expect(html).toContain(TITULO)
    expect(html).toMatch(/imagesrcset/)
    // Todas las direcciones son las del build y existen.
    expect(html).not.toContain('/src/')
    // Pero la plantilla no lleva ningún src ni srcset de archivo: Firefox
    // descargaría la foto en cualquier ruta (su lector previo del HTML no
    // respeta que un <template> sea inerte).
    const plantilla = html.slice(html.indexOf('<template'))
    expect(plantilla).not.toMatch(/\ssrc(set)?="(?!data:)/i)
    const direcciones = new Set(
      html.match(/\/assets\/portada-\d+-[\w-]+\.(avif|jpg)/g) ?? [],
    )
    expect(direcciones.size).toBeGreaterThanOrEqual(5)
    for (const direccion of direcciones) {
      expect((await request.get(direccion)).ok(), direccion).toBe(true)
    }
  })

  test('se pinta entera sin el chunk de la app, con su foto', async ({
    page,
  }) => {
    await sinChunkDeLaApp(page)
    const pedidas = fotosPedidas(page)
    // Sin el chunk, WebKit no llega a disparar «load».
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(
      page.getByRole('heading', { name: TITULO, level: 1 }),
    ).toBeVisible()
    await expect(page.locator('#portada-previa')).toHaveCount(1)
    await expect(
      page.getByRole('link', { name: 'Crear cuenta gratis' }).first(),
    ).toHaveAttribute('href', '/registro')
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(VENTAJAS)
    const foto = await fotoCargada(page)
    // La precarga pide la misma variante que elige el <img>.
    const elegida = await foto.evaluate(
      (img: HTMLImageElement) => new URL(img.currentSrc).pathname,
    )
    expect(new Set(pedidas)).toEqual(new Set([elegida]))
  })

  for (const ancho of [360, 1536]) {
    test(`a ${ancho} px, al sustituirla por la de la app nada se mueve`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: ancho, height: 900 })
      // El chunk de la app espera hasta que la prueba lo suelta.
      let soltar = () => {}
      const suelto = new Promise<void>((resolver) => {
        soltar = resolver
      })
      await page.route(/\/assets\/App-[\w-]+\.js$/, async (ruta) => {
        await suelto
        await ruta.continue()
      })
      await page.goto('/', { waitUntil: 'domcontentloaded' })
      await expect(page.locator('#portada-previa')).toHaveCount(1)
      await fotoCargada(page)
      const cajas = () =>
        page.evaluate(() =>
          [
            '.orki-nav',
            'h1',
            '.orki-hero__actions',
            'img.orki-hero__photo',
            '.orki-features',
            'footer',
          ].map((selector) => {
            const caja = document
              .querySelector(selector)
              ?.getBoundingClientRect()
            return caja
              ? [caja.x, caja.y, caja.width, caja.height].map(Math.round)
              : null
          }),
        )
      const antes = await cajas()
      expect(antes).not.toContain(null)

      soltar()
      await portadaDeLaApp(page)
      expect(await cajas()).toEqual(antes)
    })
  }

  test('al llegar la app queda una sola portada, sin volver a pedir la foto', async ({
    page,
  }) => {
    const pedidas = fotosPedidas(page)
    await page.goto('/')
    await expect(page.locator('#portada-previa')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(
      page.getByRole('heading', { name: TITULO, level: 1 }),
    ).toBeVisible()
    const foto = await fotoCargada(page)
    // El <img> de la app reutiliza la variante AVIF ya descargada. (WebKit
    // pide además el JPEG de respaldo: React le pone `src` antes de meterlo
    // en el <picture>. Pasaba ya antes de la portada prerrenderada; ver
    // docs/medicion-de-carga.md.)
    const elegida = await foto.evaluate(
      (img: HTMLImageElement) => new URL(img.currentSrc).pathname,
    )
    expect(pedidas.filter((ruta) => ruta.endsWith('.avif'))).toEqual([elegida])
  })

  test('en otra ruta no se usa ni se pide la foto', async ({ page }) => {
    const pedidas = fotosPedidas(page)
    await page.goto('/catalogo')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: TITULO })).toHaveCount(0)
    expect(pedidas).toEqual([])
  })

  test.describe('con un usuario recordado en el dispositivo', () => {
    test.use({ sesion: { usuario: 'user_prueba_e2e' } })

    test('no se pinta: `/` lleva a la colección', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('orki-ultimo-usuario', 'user_prueba_e2e')
      })
      const pedidas = fotosPedidas(page)
      await page.goto('/')
      await expect(page).toHaveURL(/\/coleccion$/)
      await expect(
        page.getByRole('heading', { name: 'Mi colección', level: 1 }),
      ).toBeVisible()
      expect(pedidas).toEqual([])
    })
  })
})

test.describe('con sesión', () => {
  test.use({ sesion: { usuario: 'user_prueba_e2e' } })

  test('el inicio lleva a la colección sin pintar la portada', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/coleccion$/)
    await expect(
      page.getByRole('heading', { name: 'Mi colección', level: 1 }),
    ).toBeVisible()
  })
})
