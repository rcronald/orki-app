import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { PLANTAS, USUARIO } from './soporte/datos.ts'
import { expect, test } from './soporte/fixtures.ts'
import { ORIGEN_SUPABASE } from './soporte/supabase-simulado.ts'

// Varias fotos por planta (#219): el borrado de una planta con fotos
// secundarias desde la app. Las reglas de plant_photos (dueño, posiciones,
// máximo, rutas y sincronización con plants) se prueban contra la base de
// verdad en supabase/tests/fotos_de_plantas.sql, no aquí (#259).
//
// Las fotos de partida se crean con fetch desde la página y el token del
// Clerk simulado, como las crearía supabase-js.

const FOTO_WEBP = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../src/photos/fixtures/sin-metadatos.webp',
  ),
)

const PLANTA = PLANTAS.maxima
const CARPETA = `${USUARIO}/${PLANTA}`

function token(usuario: string): string {
  const datos = JSON.stringify({ sub: usuario, app_role: null })
  return `simulado.${Buffer.from(datos).toString('base64').replace(/=+$/, '')}`
}

interface Respuesta {
  status: number
  body: unknown
}

/** Una petición a PostgREST desde la página, con la sesión de `usuario`. */
async function pedir(
  page: Page,
  metodo: string,
  ruta: string,
  cuerpo?: unknown,
  usuario = USUARIO,
): Promise<Respuesta> {
  return page.evaluate(
    async ({ url, metodo, cuerpo, autorizacion }) => {
      const respuesta = await fetch(url, {
        method: metodo,
        headers: {
          authorization: `Bearer ${autorizacion}`,
          'content-type': 'application/json',
          prefer: 'return=representation',
        },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      })
      const texto = await respuesta.text()
      return {
        status: respuesta.status,
        body: texto ? (JSON.parse(texto) as unknown) : null,
      }
    },
    {
      url: `${ORIGEN_SUPABASE}/rest/v1/${ruta}`,
      metodo,
      cuerpo,
      autorizacion: token(usuario),
    },
  )
}

const foto = (version: string, position: number, extra = {}) => ({
  plant_id: PLANTA,
  photo_path: `${CARPETA}/photo-${version}.webp`,
  thumbnail_path: `${CARPETA}/thumb-${version}.webp`,
  position,
  ...extra,
})

test.beforeEach(async ({ page }) => {
  // Una página de la app sin consultas a Supabase, para hacer fetch desde ella.
  await page.goto('/privacidad')
})

test('eliminar una planta con varias fotos borra todas sus filas y sus archivos', async ({
  page,
  supabase,
}) => {
  // Tres fotos de la galería, con sus archivos en el bucket.
  for (const [position, version] of ['a', 'b', 'c'].entries()) {
    for (const archivo of [
      `${CARPETA}/photo-${version}.webp`,
      `${CARPETA}/thumb-${version}.webp`,
    ]) {
      supabase.archivos.set(archivo, { tipo: 'image/webp', bytes: FOTO_WEBP })
    }
    await pedir(page, 'POST', 'plant_photos', foto(version, position))
  }
  const ajena = `${USUARIO}/${PLANTAS.amabilis}/photo-z.webp`
  supabase.archivos.set(ajena, { tipo: 'image/webp', bytes: FOTO_WEBP })
  expect(supabase.fotosDe(PLANTA)).toHaveLength(3)

  await page.goto(`/coleccion/${PLANTA}`)
  // El detalle muestra la principal, que la base copió a plants.
  await expect(
    page.getByRole('img', { name: /^Foto principal de Cattleya maxima/ }),
  ).toBeVisible()
  await page
    .getByRole('region', { name: 'Acciones' })
    .getByRole('button', { name: 'Eliminar' })
    .click()
  await page
    .getByRole('dialog', { name: '¿Eliminar esta planta para siempre?' })
    .getByRole('button', { name: 'Eliminar definitivamente' })
    .click()

  await expect(page).toHaveURL(/\/coleccion$/)
  expect(supabase.fotosDe(PLANTA)).toEqual([])
  await expect
    .poll(() =>
      [...supabase.archivos.keys()].filter((archivo) =>
        archivo.startsWith(`${CARPETA}/`),
      ),
    )
    .toEqual([])
  expect(supabase.archivos.has(ajena)).toBe(true)
})
