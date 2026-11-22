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

  // La cabecera queda solo con el logotipo, centrado: las acciones están en
  // el Hero.
  const cabecera = page.getByRole('banner')
  const logotipo = cabecera.getByRole('link', { name: 'Inicio de orqui.apps' })
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
