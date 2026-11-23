import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { OTRO_USUARIO, PLANTAS, USUARIO } from './soporte/datos.ts'
import { expect, test } from './soporte/fixtures.ts'
import { ORIGEN_SUPABASE } from './soporte/supabase-simulado.ts'

// Varias fotos por planta (#219): las reglas de plant_photos en el Supabase
// simulado, para que el formulario con galería (#221) se pueda probar contra
// ellas, y el borrado de una planta con fotos secundarias desde la app.
//
// Las peticiones a plant_photos las hace la página con fetch y el token del
// Clerk simulado, como las haría supabase-js: hoy ninguna pantalla las usa.

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

test('plant_photos: dueño, posiciones, máximo y sincronización con plants', async ({
  page,
  supabase,
}) => {
  const planta = () => supabase.datos.plantas.find((p) => p.id === PLANTA)

  // La primera foto es la principal y pasa a las columnas de plants.
  const creada = await pedir(page, 'POST', 'plant_photos', foto('b', 1))
  expect(creada.status).toBe(201)
  expect(planta()?.photo_path).toBe(`${CARPETA}/photo-b.webp`)

  // Una en una posición más baja pasa a ser la principal.
  await pedir(page, 'POST', 'plant_photos', foto('a', 0, { in_bloom: true }))
  expect(planta()).toMatchObject({
    photo_path: `${CARPETA}/photo-a.webp`,
    photo_in_bloom: true,
  })

  // Leer en orden.
  const lista = await pedir(
    page,
    'GET',
    `plant_photos?plant_id=eq.${PLANTA}&order=position.asc`,
  )
  expect(
    (lista.body as { position: number }[]).map((fila) => fila.position),
  ).toEqual([0, 1])

  // Posición ocupada: 23505. Fuera de rango (la séptima): 23514.
  const ocupada = await pedir(page, 'POST', 'plant_photos', foto('c', 1))
  expect(ocupada).toMatchObject({ status: 409, body: { code: '23505' } })
  const septima = await pedir(page, 'POST', 'plant_photos', foto('g', 6))
  expect(septima).toMatchObject({ status: 400, body: { code: '23514' } })

  // Rutas fuera de la carpeta de la planta: 23514.
  const fuera = await pedir(page, 'POST', 'plant_photos', {
    ...foto('c', 2),
    photo_path: `${USUARIO}/${PLANTAS.amabilis}/photo-c.webp`,
  })
  expect(fuera).toMatchObject({ status: 400, body: { code: '23514' } })

  // Otra persona no ve ni escribe estas fotos.
  const ajena = await pedir(
    page,
    'GET',
    `plant_photos?plant_id=eq.${PLANTA}`,
    undefined,
    OTRO_USUARIO,
  )
  expect(ajena.body).toEqual([])
  const intrusa = await pedir(
    page,
    'POST',
    'plant_photos',
    { ...foto('x', 3), user_id: USUARIO },
    OTRO_USUARIO,
  )
  expect(intrusa).toMatchObject({ status: 403, body: { code: '42501' } })

  // Solo se cambian las columnas permitidas; reordenar en una sentencia.
  const [principal] = supabase.fotosDe(PLANTA)
  const cambio = await pedir(
    page,
    'PATCH',
    `plant_photos?id=eq.${principal.id}`,
    { plant_id: PLANTAS.amabilis },
  )
  expect(cambio).toMatchObject({ status: 403, body: { code: '42501' } })
  await pedir(page, 'PATCH', `plant_photos?id=eq.${principal.id}`, {
    position: 4,
    note: 'Ya no es la principal',
  })
  expect(planta()?.photo_path).toBe(`${CARPETA}/photo-b.webp`)

  // Quitar la principal promueve la siguiente; sin fotos, la planta queda sin foto.
  const [nueva] = supabase.fotosDe(PLANTA)
  await pedir(page, 'DELETE', `plant_photos?id=eq.${nueva.id}`)
  expect(planta()?.photo_path).toBe(`${CARPETA}/photo-a.webp`)
  await pedir(page, 'DELETE', `plant_photos?plant_id=eq.${PLANTA}`)
  expect(planta()).toMatchObject({
    photo_path: null,
    thumbnail_path: null,
    photo_in_bloom: false,
  })
})

test('plant_photos: lo que escribe en plants la app de una foto se refleja en la principal', async ({
  page,
  supabase,
}) => {
  await pedir(page, 'POST', 'plant_photos', foto('b', 1))
  await pedir(page, 'POST', 'plant_photos', foto('a', 0))

  // Sustituir la foto desde plants cambia la principal, sin añadir otra.
  await pedir(page, 'PATCH', `plants?id=eq.${PLANTA}`, {
    photo_path: `${CARPETA}/photo-n.webp`,
    thumbnail_path: `${CARPETA}/thumb-n.webp`,
  })
  expect(
    supabase.fotosDe(PLANTA).map((fila) => [fila.position, fila.photo_path]),
  ).toEqual([
    [0, `${CARPETA}/photo-n.webp`],
    [1, `${CARPETA}/photo-b.webp`],
  ])

  // Quitarla desde plants borra solo la principal y devuelve la siguiente.
  const quitada = await pedir(page, 'PATCH', `plants?id=eq.${PLANTA}`, {
    photo_path: null,
    thumbnail_path: null,
  })
  expect(quitada.body).toMatchObject([
    { photo_path: `${CARPETA}/photo-b.webp` },
  ])
  expect(supabase.fotosDe(PLANTA)).toHaveLength(1)

  // Una sola de las dos rutas se rechaza.
  const sola = await pedir(page, 'PATCH', `plants?id=eq.${PLANTA}`, {
    thumbnail_path: null,
  })
  expect(sola).toMatchObject({ status: 400, body: { code: '23514' } })
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
