import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLANTAS, USUARIO } from './soporte/datos.ts'
import { expect, test } from './soporte/fixtures.ts'

// Baja de un ejemplar (#16): dar de baja y reactivar, y eliminar para
// siempre (con todas sus fotos y miniaturas, #219). Editar los datos y las
// fotos está en editar-planta.spec.ts (#266).

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/photos/fixtures',
)
const FOTO_WEBP = readFileSync(path.join(FIXTURES, 'sin-metadatos.webp'))

const detalle = (id: string) => `/coleccion/${id}`

test(
  'dar de baja y reactivar',
  { tag: '@logica' },
  async ({ page, supabase, revisarAccesibilidad }) => {
    await page.goto(detalle(PLANTAS.nobile))
    // En «Gestionar planta», plegado al final de la ficha (#265).
    await page.getByRole('button', { name: 'Gestionar planta' }).click()
    await page
      .getByRole('region', { name: 'Gestionar planta' })
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
    await page.getByRole('button', { name: 'Gestionar planta' }).click()
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

    await page.getByRole('button', { name: 'Gestionar planta' }).click()
    await page
      .getByRole('region', { name: 'Gestionar planta' })
      .getByRole('button', { name: 'Eliminar planta' })
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
