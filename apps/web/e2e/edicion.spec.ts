import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLANTAS, USUARIO } from './soporte/datos.ts'
import { expect, test } from './soporte/fixtures.ts'

// Detalle, edición y baja de un ejemplar (#16): editar los datos, dar de baja
// y reactivar, y eliminar para siempre (con su foto y su miniatura).

const FOTO_WEBP = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../src/photos/fixtures/sin-metadatos.webp',
  ),
)

const detalle = (id: string) => `/coleccion/${id}`

test('editar los datos de una planta', async ({
  page,
  supabase,
  revisarAccesibilidad,
}) => {
  await page.goto(detalle(PLANTAS.amabilis))
  await expect(
    page.getByRole('heading', { name: 'Phalaenopsis amabilis', level: 1 }),
  ).toBeVisible()
  await revisarAccesibilidad('detalle')

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
})

test('dar de baja y reactivar', async ({
  page,
  supabase,
  revisarAccesibilidad,
}) => {
  await page.goto(detalle(PLANTAS.nobile))
  await page
    .getByRole('region', { name: 'Acciones' })
    .getByRole('button', { name: 'Dar de baja' })
    .click()
  const dialogo = page.getByRole('dialog', { name: 'Dar de baja esta planta' })
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
  await page.getByRole('link', { name: 'Volver a mi colección' }).click()
  await expect(
    page.getByRole('list', { name: 'Resumen de tu colección' }),
  ).toContainText('4 orquídeas')

  await page.goto(detalle(PLANTAS.nobile))
  await page.getByRole('button', { name: 'Reactivar' }).click()
  await expect(
    page.getByText('Reactivaste la planta: vuelve a contar en tu colección.'),
  ).toBeVisible()
  expect(
    supabase.plantasDe(USUARIO).find((p) => p.id === PLANTAS.nobile)?.status,
  ).toBe('active')
})

test('eliminar una planta con foto', async ({
  page,
  supabase,
  revisarAccesibilidad,
}) => {
  // Cattleya maxima con foto y miniatura en el bucket.
  const carpeta = `${USUARIO}/${PLANTAS.maxima}`
  const foto = `${carpeta}/photo-11111111-1111-4111-8111-111111111111.webp`
  const miniatura = `${carpeta}/thumb-11111111-1111-4111-8111-111111111111.webp`
  for (const archivo of [foto, miniatura]) {
    supabase.archivos.set(archivo, { tipo: 'image/webp', bytes: FOTO_WEBP })
  }
  Object.assign(
    supabase.datos.plantas.find((p) => p.id === PLANTAS.maxima) ?? {},
    { photo_path: foto, thumbnail_path: miniatura },
  )

  await page.goto(detalle(PLANTAS.maxima))
  await expect(
    page.getByRole('img', { name: 'Foto de Cattleya maxima' }),
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
  expect(supabase.plantasDe(USUARIO).some((p) => p.id === PLANTAS.maxima)).toBe(
    false,
  )
  await expect.poll(() => supabase.archivos.has(foto)).toBe(false)
  expect(supabase.archivos.has(miniatura)).toBe(false)
})
