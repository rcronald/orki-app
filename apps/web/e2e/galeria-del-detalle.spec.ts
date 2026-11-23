import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { PLANTAS, USUARIO } from './soporte/datos.ts'
import { expect, test } from './soporte/fixtures.ts'
import type { SupabaseSimulado } from './soporte/supabase-simulado.ts'

// Galería del detalle de una planta (#183): varias fotos, el visor a pantalla
// completa, la fecha y la nota de una foto, la principal y el orden, a 360 y a
// 1440 px, con axe, y sin conexión.

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FOTO = readFileSync(
  path.join(RAIZ, 'src/photos/fixtures/sin-metadatos.webp'),
)
// Otra imagen, de 240 px de ancho, para reconocer la miniatura de la cuarta.
const OTRA = readFileSync(
  path.join(RAIZ, 'src/assets/ilustraciones/cabecera-240.webp'),
)

const PLANTA = PLANTAS.maxima
const NOMBRE = 'Cattleya maxima'
const CARPETA = `${USUARIO}/${PLANTA}`
const ruta = (tipo: 'photo' | 'thumb', n: number) =>
  `${CARPETA}/${tipo}-${String(n)}.webp`

/** Cattleya maxima con `cuantas` fotos; la tercera, con fecha y nota. */
function conFotos(supabase: SupabaseSimulado, cuantas: number) {
  for (let n = 1; n <= cuantas; n += 1) {
    supabase.archivos.set(ruta('photo', n), { tipo: 'image/webp', bytes: FOTO })
    supabase.archivos.set(ruta('thumb', n), {
      tipo: 'image/webp',
      bytes: n === 4 ? OTRA : FOTO,
    })
    supabase.fotos.push({
      id: `aaaaaaaa-0000-4000-8000-00000000000${String(n)}`,
      plant_id: PLANTA,
      user_id: USUARIO,
      photo_path: ruta('photo', n),
      thumbnail_path: ruta('thumb', n),
      in_bloom: n === 3,
      taken_at: n === 3 ? '2026-10-05' : null,
      note: n === 3 ? 'Primera vara floral' : null,
      position: n - 1,
      created_at: '2026-11-20T12:00:00.000Z',
    })
  }
  Object.assign(supabase.datos.plantas.find((p) => p.id === PLANTA) ?? {}, {
    photo_path: ruta('photo', 1),
    thumbnail_path: ruta('thumb', 1),
  })
}

const galeria = (page: Page) => page.getByRole('region', { name: 'Fotos' })
const miniaturas = (page: Page) =>
  galeria(page)
    .getByRole('list', { name: 'Elegir la foto que se ve' })
    .getByRole('button')
const fotoGrande = (page: Page) =>
  galeria(page).getByRole('button', { name: /^Ver en grande: / })

/** Sin desplazamiento horizontal (medidas redondeadas). */
async function sinDesplazamientoHorizontal(page: Page) {
  const { ancho, visible } = await page.evaluate(() => ({
    ancho: Math.round(document.documentElement.scrollWidth),
    visible: Math.round(document.documentElement.clientWidth),
  }))
  expect(ancho).toBeLessThanOrEqual(visible)
}

for (const { ancho, alto } of [
  { ancho: 1440, alto: 900 },
  { ancho: 360, alto: 760 },
]) {
  test(
    `ver varias fotos y recorrerlas en el visor a ${String(ancho)} px`,
    { tag: ancho > 720 ? '@escritorio' : [] },
    async ({ page, supabase, revisarAccesibilidad }) => {
      await page.setViewportSize({ width: ancho, height: alto })
      conFotos(supabase, 4)
      await page.goto(`/coleccion/${PLANTA}`)
      await expect(
        page.getByRole('heading', { name: NOMBRE, level: 1 }),
      ).toBeVisible()
      await expect(miniaturas(page)).toHaveCount(4)
      await expect(galeria(page).getByText('4 de 6')).toBeVisible()
      await expect(
        galeria(page).getByRole('img', { name: `Foto principal de ${NOMBRE}` }),
      ).toHaveAttribute('src', /^blob:/)
      // «Volver a Mi colección» con 44 px de alto (#174).
      const volver = page.getByRole('link', { name: 'Volver a Mi colección' })
      const caja = await volver.boundingBox()
      expect(Math.round(caja?.height ?? 0)).toBeGreaterThanOrEqual(44)
      await sinDesplazamientoHorizontal(page)
      await revisarAccesibilidad(
        `detalle con varias fotos a ${String(ancho)} px`,
      )

      // Elegir la tercera: se ve en grande con su fecha y su nota.
      await miniaturas(page).nth(2).click()
      await expect(miniaturas(page).nth(2)).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      await expect(fotoGrande(page)).toHaveAccessibleName(
        `Ver en grande: Foto 3 de 4 de ${NOMBRE}, en flor`,
      )
      await expect(galeria(page).getByText('Primera vara floral')).toBeVisible()
      await expect(
        galeria(page).getByText('Foto del 5 de octubre de 2026'),
      ).toBeVisible()

      // El visor, con el teclado.
      await fotoGrande(page).focus()
      await page.keyboard.press('Enter')
      const visor = page.getByRole('dialog', { name: `Fotos de ${NOMBRE}` })
      await expect(visor).toBeVisible()
      await expect(visor.getByRole('button', { name: 'Cerrar' })).toBeFocused()
      await expect(visor.getByText('Foto 3 de 4')).toBeVisible()
      await expect(
        visor.getByRole('img', { name: `Foto 3 de 4 de ${NOMBRE}, en flor` }),
      ).toHaveAttribute('src', /^blob:/)
      await sinDesplazamientoHorizontal(page)
      await revisarAccesibilidad(`visor a ${String(ancho)} px`)

      await page.keyboard.press('ArrowRight')
      await expect(visor.getByText('Foto 4 de 4')).toBeVisible()
      await expect(
        visor.getByRole('button', { name: 'Foto siguiente' }),
      ).toHaveAttribute('aria-disabled', 'true')
      await visor.getByRole('button', { name: 'Foto anterior' }).click()
      await page.keyboard.press('ArrowLeft')
      await expect(visor.getByText('Foto 2 de 4')).toBeVisible()
      await expect(
        visor.getByRole('img', { name: `Foto 2 de 4 de ${NOMBRE}` }),
      ).toHaveAttribute('src', /^blob:/)

      await page.keyboard.press('Escape')
      await expect(visor).toBeHidden()
      await expect(fotoGrande(page)).toBeFocused()
      await expect(miniaturas(page).nth(1)).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    },
  )
}

test(
  'editar la fecha y la nota de una foto',
  { tag: '@logica' },
  async ({ page, supabase, revisarAccesibilidad }) => {
    conFotos(supabase, 3)
    await page.goto(`/coleccion/${PLANTA}`)
    await miniaturas(page).nth(1).click()
    await galeria(page)
      .getByRole('button', { name: 'Editar fecha y nota' })
      .click()

    const formulario = galeria(page).getByRole('form', {
      name: 'Fecha y nota de la foto',
    })
    const fecha = formulario.getByLabel('Fecha de la foto (opcional)')
    await expect(fecha).toBeFocused()
    await fecha.fill('2999-01-01')
    await formulario.getByRole('button', { name: 'Guardar' }).click()
    await expect(
      formulario.getByText('La fecha no puede ser posterior a hoy.'),
    ).toBeVisible()
    await revisarAccesibilidad('fecha y nota con un error')

    await fecha.fill('2026-11-01')
    await formulario.getByLabel('Nota (opcional)').fill('  Hojas nuevas  ')
    await formulario.getByRole('button', { name: 'En flor' }).click()
    await formulario.getByRole('button', { name: 'Guardar' }).click()

    await expect(
      galeria(page).getByText('Guardaste la fecha y la nota de la foto.'),
    ).toBeVisible()
    await expect(galeria(page).getByText('Hojas nuevas')).toBeVisible()
    await expect(
      galeria(page).getByText('Foto del 1 de noviembre de 2026'),
    ).toBeVisible()
    await expect(
      galeria(page).getByRole('button', { name: 'Editar fecha y nota' }),
    ).toBeFocused()
    expect(supabase.fotosDe(PLANTA)[1]).toMatchObject({
      taken_at: '2026-11-01',
      note: 'Hojas nuevas',
      in_bloom: true,
    })
  },
)

test(
  'hacer principal y reordenar: la tarjeta del inventario muestra la nueva principal',
  { tag: '@logica' },
  async ({ page, supabase, revisarAccesibilidad }) => {
    conFotos(supabase, 4)
    await page.goto('/coleccion')
    await page.getByRole('link', { name: NOMBRE }).click()
    await expect(miniaturas(page)).toHaveCount(4)

    // Mover la segunda después: pasa al tercer lugar.
    await miniaturas(page).nth(1).click()
    await galeria(page).getByRole('button', { name: 'Mover después' }).click()
    await expect(
      galeria(page).getByText('Foto movida al lugar 3 de 4.'),
    ).toBeVisible()
    expect(supabase.fotosDe(PLANTA).map((f) => f.photo_path)).toEqual([
      ruta('photo', 1),
      ruta('photo', 3),
      ruta('photo', 2),
      ruta('photo', 4),
    ])

    // Hacer principal la cuarta.
    await miniaturas(page).nth(3).click()
    const principal = galeria(page).getByRole('button', {
      name: 'Hacer principal',
    })
    await principal.click()
    await expect(
      galeria(page).getByText(
        'Ahora es la foto principal. Tu colección ya la muestra.',
      ),
    ).toBeVisible()
    await expect(principal).toHaveAttribute('aria-disabled', 'true')
    await expect(miniaturas(page).first()).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(supabase.fotosDe(PLANTA)[0]?.photo_path).toBe(ruta('photo', 4))
    expect(
      supabase.datos.plantas.find((p) => p.id === PLANTA)?.thumbnail_path,
    ).toBe(ruta('thumb', 4))
    await revisarAccesibilidad('galería tras hacer principal')

    // La tarjeta del inventario, ya con la nueva (la imagen de 240 px).
    await page.getByRole('link', { name: 'Volver a Mi colección' }).click()
    const tarjeta = page
      .getByRole('article', { name: NOMBRE })
      .locator('img.orki-card__photo')
    await expect
      .poll(() => tarjeta.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBe(240)
  },
)

test('sin conexión: solo la principal, el motivo y nada que cambiar', async ({
  page,
  context,
  supabase,
  revisarAccesibilidad,
}) => {
  conFotos(supabase, 3)
  // Otro detalle con conexión: sin el service worker (bloqueado en estas
  // pruebas), el chunk del detalle tiene que estar ya cargado.
  await page.goto(`/coleccion/${PLANTAS.amabilis}`)
  await page.getByRole('link', { name: 'Volver a Mi colección' }).click()
  await expect(
    page.getByRole('article', { name: NOMBRE }).locator('img'),
  ).toHaveAttribute('src', /^blob:/)

  // Sin red: las rutas de Playwright responderían igual, así que Supabase
  // también se corta.
  const cortar = (route: { abort: (code: string) => Promise<void> }) =>
    route.abort('internetdisconnected')
  await context.route('https://supabase.orki.invalid/**', cortar)
  await context.setOffline(true)
  await page.getByRole('link', { name: NOMBRE }).click()
  await expect(
    galeria(page).getByText(
      'Sin conexión: solo está disponible la foto principal. Las demás fotos se verán con conexión.',
    ),
  ).toBeVisible()
  await expect(
    galeria(page).getByRole('img', { name: `Foto principal de ${NOMBRE}` }),
  ).toHaveAttribute('src', /^blob:/)
  await expect(miniaturas(page)).toHaveCount(0)
  await expect(
    galeria(page).getByRole('button', { name: 'Añadir o quitar fotos' }),
  ).toHaveAttribute('aria-disabled', 'true')
  await revisarAccesibilidad('galería sin conexión')

  // Al volver la conexión, aparecen las demás.
  await context.unroute('https://supabase.orki.invalid/**', cortar)
  await context.setOffline(false)
  await expect(miniaturas(page)).toHaveCount(3)
})
