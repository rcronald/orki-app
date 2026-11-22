import type { Page } from '@playwright/test'
import { expect, test } from './soporte/fixtures.ts'

// Portada (#179, #192): la maqueta de escritorio a 1440 px y la de celular a
// 360 px (el ancho más estrecho que se soporta). Sin sesión, en los perfiles
// de escritorio; el de celular ya tiene su pantalla y se prueba igual.

const TITULO = 'Tu colección de orquídeas, en un solo lugar'

test.use({ sesion: { usuario: null } })

async function sinDesplazamientoHorizontal(page: Page) {
  const anchos = await page.evaluate(() => ({
    documento: document.documentElement.scrollWidth,
    ventana: document.documentElement.clientWidth,
  }))
  expect(anchos.documento).toBeLessThanOrEqual(anchos.ventana)
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
  await expect(
    page.getByRole('heading', { name: TITULO, level: 1 }),
  ).toBeVisible()
  await sinDesplazamientoHorizontal(page)

  // La cabecera queda solo con el logotipo: las acciones están en el Hero.
  const cabecera = page.getByRole('banner')
  await expect(
    cabecera.getByRole('link', { name: 'Inicio de orqui.apps' }),
  ).toBeVisible()
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

  // La foto, debajo de las acciones; el dibujo botánico, oculto.
  const foto = await fotoCargada(page)
  expect((await foto.boundingBox())?.y).toBeGreaterThan(
    (cajaEntrar?.y ?? 0) + 44,
  )
  await expect(page.locator('img.orki-hero__art')).toBeHidden()

  // Ventajas apiladas.
  const ventajas = page.getByRole('heading', { level: 2 })
  await expect(ventajas).toHaveText([
    'Organiza tus plantas',
    'Nombres confiables',
    '¿Ya la tengo?',
  ])
  const primera = await ventajas.nth(0).boundingBox()
  const segunda = await ventajas.nth(1).boundingBox()
  expect(segunda?.y).toBeGreaterThan(primera?.y ?? 0)
  await expect(
    page.getByText('Más de 32 000 especies e híbridos.'),
  ).toBeVisible()
  await revisarAccesibilidad('portada a 360 px')
})

test('en escritorio: dos columnas, foto hasta el borde y ventajas en fila', async ({
  page,
  revisarAccesibilidad,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: TITULO, level: 1 }),
  ).toBeVisible()
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
  const foto = await (await fotoCargada(page)).boundingBox()
  // La foto a la derecha del texto y hasta el borde derecho de la página.
  expect(foto?.x).toBeGreaterThan((titulo?.x ?? 0) + (titulo?.width ?? 0) - 1)
  expect((foto?.x ?? 0) + (foto?.width ?? 0)).toBeCloseTo(1440, 0)
  await expect(page.locator('img.orki-hero__art')).toBeVisible()

  const ventajas = page.getByRole('heading', { level: 2 })
  const cajas = await Promise.all(
    [0, 1, 2].map((i) => ventajas.nth(i).boundingBox()),
  )
  expect(new Set(cajas.map((caja) => Math.round(caja?.y ?? 0))).size).toBe(1)
  await expect(
    page.getByText(
      'Más de 32 000 especies e híbridos, con sus sinónimos y nombres comunes.',
    ),
  ).toBeVisible()
  // Cada frase en dos líneas como máximo (24 px de interlineado).
  for (const frase of await page.locator('.orki-feature__text').all()) {
    expect((await frase.boundingBox())?.height).toBeLessThanOrEqual(48)
  }
  await revisarAccesibilidad('portada en escritorio')
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
