import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLANTAS, USUARIO } from './soporte/datos.ts'
import { expect, test } from './soporte/fixtures.ts'

// Detalle, edición y baja de un ejemplar (#16): editar los datos y las fotos
// (#221), dar de baja y reactivar, y eliminar para siempre (con todas sus
// fotos y miniaturas, #219).

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/photos/fixtures',
)
const FOTO_WEBP = readFileSync(path.join(FIXTURES, 'sin-metadatos.webp'))
const FOTO_JPG = path.join(FIXTURES, 'sin-metadatos.jpg')

const detalle = (id: string) => `/coleccion/${id}`

test(
  'editar los datos de una planta',
  { tag: '@logica' },
  async ({ page, supabase, revisarAccesibilidad }) => {
    await page.goto(detalle(PLANTAS.amabilis))
    await expect(
      page.getByRole('heading', { name: 'Phalaenopsis amabilis', level: 1 }),
    ).toBeVisible()
    // axe del detalle: fotos-de-referencia.spec.ts, en la misma pantalla.

    await page.getByRole('link', { name: 'Editar' }).click()
    await expect(
      page.getByRole('heading', { name: 'Editar orquídea', level: 1 }),
    ).toBeVisible()
    await revisarAccesibilidad('edición')

    await page.getByRole('textbox', { name: 'Apodo' }).fill('La reina')
    await page
      .getByRole('group', { name: 'Color de la flor' })
      .getByRole('button', { name: 'Bicolor' })
      .click()
    await page.getByRole('button', { name: 'Guardar cambios' }).click()

    await expect(page).toHaveURL(new RegExp(`${detalle(PLANTAS.amabilis)}$`))
    await expect(page.getByText('Guardaste los cambios.')).toBeVisible()
    await expect(
      page.getByRole('definition').filter({ hasText: 'La reina' }),
    ).toBeVisible()
    expect(
      supabase.plantasDe(USUARIO).find((p) => p.id === PLANTAS.amabilis),
    ).toMatchObject({ nickname: 'La reina', flower_color: 'bicolor' })
  },
)

test('editar las fotos: quitar la principal y añadir otras', async ({
  page,
  supabase,
  revisarAccesibilidad,
}) => {
  // Cattleya maxima con dos fotos guardadas, con sus archivos en el bucket.
  const carpeta = `${USUARIO}/${PLANTAS.maxima}`
  for (const version of ['a', 'b']) {
    for (const archivo of [
      `${carpeta}/photo-${version}.webp`,
      `${carpeta}/thumb-${version}.webp`,
    ]) {
      supabase.archivos.set(archivo, { tipo: 'image/webp', bytes: FOTO_WEBP })
    }
  }
  Object.assign(
    supabase.datos.plantas.find((p) => p.id === PLANTAS.maxima) ?? {},
    {
      photo_path: `${carpeta}/photo-a.webp`,
      thumbnail_path: `${carpeta}/thumb-a.webp`,
    },
  )
  // La copia de la migración crea la principal; la segunda, detrás.
  expect(supabase.fotosDe(PLANTAS.maxima)).toHaveLength(1)
  supabase.fotos.push({
    ...supabase.fotosDe(PLANTAS.maxima)[0],
    id: '99999999-9999-4999-8999-999999999999',
    photo_path: `${carpeta}/photo-b.webp`,
    thumbnail_path: `${carpeta}/thumb-b.webp`,
    position: 1,
  })

  await page.goto(`${detalle(PLANTAS.maxima)}/editar`)
  const galeria = page.getByRole('region', { name: 'Fotos (opcional)' })
  await expect(galeria.locator('.orki-gallery__count')).toContainText('2 de 6')
  await expect(
    galeria.getByRole('img', { name: 'Foto principal' }),
  ).toHaveAttribute('src', /^blob:/)

  // Quitar la principal: la siguiente pasa a serlo; se borra al guardar.
  await galeria.getByRole('button', { name: 'Quitar foto principal' }).click()
  await expect(
    galeria.getByText('Una foto guardada se borrará al guardar los cambios.'),
  ).toBeVisible()
  await expect(galeria.locator('.orki-gallery__count')).toContainText('1 de 6')
  expect(supabase.fotosDe(PLANTAS.maxima)).toHaveLength(2)

  const selector = page.waitForEvent('filechooser')
  await galeria.getByRole('button', { name: 'Elegir fotos' }).click()
  await (await selector).setFiles([FOTO_JPG, FOTO_JPG])
  await expect(page.locator('.orki-gallery__item--preparing')).toHaveCount(0)
  await expect(galeria.locator('.orki-gallery__count')).toContainText('3 de 6')
  await revisarAccesibilidad('edición de las fotos')

  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(page).toHaveURL(new RegExp(`${detalle(PLANTAS.maxima)}$`))
  await expect(page.getByText('Guardaste los cambios.')).toBeVisible()

  const fotos = supabase.fotosDe(PLANTAS.maxima)
  expect(fotos).toHaveLength(3)
  // La que era la segunda es ahora la principal; las nuevas, detrás.
  expect(fotos[0]?.photo_path).toBe(`${carpeta}/photo-b.webp`)
  expect(
    supabase.datos.plantas.find((p) => p.id === PLANTAS.maxima)?.photo_path,
  ).toBe(`${carpeta}/photo-b.webp`)
  // Sin huérfanos: los archivos de la quitada ya no están.
  await expect
    .poll(() => supabase.archivos.has(`${carpeta}/photo-a.webp`))
    .toBe(false)
  expect(supabase.archivos.has(`${carpeta}/thumb-a.webp`)).toBe(false)
})

test(
  'dar de baja y reactivar',
  { tag: '@logica' },
  async ({ page, supabase, revisarAccesibilidad }) => {
    await page.goto(detalle(PLANTAS.nobile))
    await page
      .getByRole('region', { name: 'Acciones' })
      .getByRole('button', { name: 'Dar de baja' })
      .click()
    const dialogo = page.getByRole('dialog', {
      name: 'Dar de baja esta planta',
    })
    await expect(dialogo).toBeVisible()
    await revisarAccesibilidad('dar de baja')
    await dialogo.getByRole('radio', { name: 'La regalé' }).check()
    await dialogo.getByRole('button', { name: 'Dar de baja' }).click()

    await expect(dialogo).toBeHidden()
    await expect(
      page.getByText(/Diste de baja la planta: regalada\./),
    ).toBeVisible()
    expect(
      supabase.plantasDe(USUARIO).find((p) => p.id === PLANTAS.nobile)?.status,
    ).toBe('gifted')

    // Ya no cuenta en la colección activa.
    await page.getByRole('link', { name: 'Volver a Mi colección' }).click()
    await expect(page.locator('.orki-pagehead__meta')).toContainText(
      '4 ejemplares',
    )

    await page.goto(detalle(PLANTAS.nobile))
    await page.getByRole('button', { name: 'Reactivar' }).click()
    await expect(
      page.getByText('Reactivaste la planta: vuelve a contar en tu colección.'),
    ).toBeVisible()
    expect(
      supabase.plantasDe(USUARIO).find((p) => p.id === PLANTAS.nobile)?.status,
    ).toBe('active')
  },
)

test(
  'eliminar una planta con varias fotos: todas sus filas y sus archivos',
  { tag: '@logica' },
  async ({ page, supabase, revisarAccesibilidad }) => {
    // Cattleya maxima con tres fotos en la galería, con sus archivos en el
    // bucket, y un archivo de otra planta que no se debe tocar.
    const carpeta = `${USUARIO}/${PLANTAS.maxima}`
    for (const version of ['a', 'b', 'c']) {
      for (const archivo of [
        `${carpeta}/photo-${version}.webp`,
        `${carpeta}/thumb-${version}.webp`,
      ]) {
        supabase.archivos.set(archivo, { tipo: 'image/webp', bytes: FOTO_WEBP })
      }
    }
    Object.assign(
      supabase.datos.plantas.find((p) => p.id === PLANTAS.maxima) ?? {},
      {
        photo_path: `${carpeta}/photo-a.webp`,
        thumbnail_path: `${carpeta}/thumb-a.webp`,
      },
    )
    // La copia de la migración crea la principal; las otras dos, detrás.
    expect(supabase.fotosDe(PLANTAS.maxima)).toHaveLength(1)
    for (const [i, version] of ['b', 'c'].entries()) {
      supabase.fotos.push({
        ...supabase.fotosDe(PLANTAS.maxima)[0],
        id: `9999999${String(i)}-9999-4999-8999-999999999999`,
        photo_path: `${carpeta}/photo-${version}.webp`,
        thumbnail_path: `${carpeta}/thumb-${version}.webp`,
        position: i + 1,
      })
    }
    const ajena = `${USUARIO}/${PLANTAS.amabilis}/photo-z.webp`
    supabase.archivos.set(ajena, { tipo: 'image/webp', bytes: FOTO_WEBP })

    await page.goto(detalle(PLANTAS.maxima))
    await expect(
      page.getByRole('img', { name: /^Foto principal de Cattleya maxima/ }),
    ).toBeVisible()

    await page
      .getByRole('region', { name: 'Acciones' })
      .getByRole('button', { name: 'Eliminar' })
      .click()
    const dialogo = page.getByRole('dialog', {
      name: '¿Eliminar esta planta para siempre?',
    })
    await revisarAccesibilidad('eliminar')
    await dialogo
      .getByRole('button', { name: 'Eliminar definitivamente' })
      .click()

    await expect(page).toHaveURL(/\/coleccion$/)
    await expect(page.getByText(/Eliminaste de tu colección/)).toBeVisible()
    await expect(
      page.getByRole('article', { name: 'Cattleya maxima' }),
    ).toHaveCount(0)
    expect(
      supabase.plantasDe(USUARIO).some((p) => p.id === PLANTAS.maxima),
    ).toBe(false)
    expect(supabase.fotosDe(PLANTAS.maxima)).toEqual([])
    await expect
      .poll(() =>
        [...supabase.archivos.keys()].filter((archivo) =>
          archivo.startsWith(`${carpeta}/`),
        ),
      )
      .toEqual([])
    expect(supabase.archivos.has(ajena)).toBe(true)
  },
)
